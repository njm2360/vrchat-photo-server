import os
from PIL import Image
from io import BytesIO
from pathlib import Path
from typing import Optional
from datetime import datetime, timedelta, timezone
from fastapi.responses import FileResponse
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Query

from app.db.images import (
    get_image_record,
    insert_image_record,
    resolve_image_path,
    list_images_by_user,
    delete_image_record,
)
from app.db.users import User
from app.models.image import ImageListItem, ImageListResponse, UploadResponse
from app.utils import safe_basename, unique_name, fit_within, guess_mime
from app.routers.auth import require_user


BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

STORAGE_DIR = Path("data/upload")
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

THUMB_DIR = Path("data/thumbnails")
THUMB_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_DIM = 2048
THUMB_SIZE = 96

router = APIRouter()


@router.post("/upload", response_model=UploadResponse, status_code=201)
async def upload(
    user: User = Depends(require_user),
    file: UploadFile = File(...),
    max_width: Optional[int] = Form(None, ge=1, le=MAX_DIM),
    max_height: Optional[int] = Form(None, ge=1, le=MAX_DIM),
    rotate: int = Form(0),
    expire_days: int = Form(..., ge=1, le=365),
):
    contents = await file.read()

    if rotate not in (0, 90, 180, 270):
        raise HTTPException(400, detail="rotate must be 0, 90, 180, or 270")

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(413, detail="File too large")

    try:
        img = Image.open(BytesIO(contents))
        img.verify()
        img = Image.open(BytesIO(contents))
    except Exception:
        raise HTTPException(400, detail="Invalid image")

    original_format = img.format or "PNG"

    if rotate:
        img = img.rotate(-rotate, expand=True)

    processed = fit_within(img, max_width, max_height)

    stored_name = unique_name(STORAGE_DIR, safe_basename(file.filename or "upload.png"))
    stored_path = STORAGE_DIR / stored_name
    tmp_path = stored_path.with_suffix(".tmp")
    thumb_path: Path | None = None

    try:
        if original_format == "JPEG" and processed.mode in ("RGBA", "P"):
            processed = processed.convert("RGB")

        with BytesIO() as buf:
            processed.save(buf, format=original_format)
            data = buf.getvalue()

        with open(tmp_path, "wb") as f:
            f.write(data)
        tmp_path.replace(stored_path)

        thumb_img = processed.copy()
        thumb_img.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
        thumb_name = Path(stored_name).stem + ".webp"
        thumb_path = THUMB_DIR / thumb_name
        thumb_img.save(thumb_path, format="WEBP", quality=80)

        content_type = Image.MIME.get(original_format, "application/octet-stream")

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=expire_days)

        await insert_image_record(
            orig_filename=file.filename or stored_name,
            stored_filename=stored_name,
            content_type=content_type,
            width=processed.width,
            height=processed.height,
            size_bytes=len(data),
            uploaded_at=now,
            expires_at=expires_at,
            path=stored_path,
            uploaded_by=user.id,
            thumb_path=thumb_path,
        )

    except Exception:
        for p in (tmp_path, stored_path, thumb_path):
            if p is not None:
                p.unlink(missing_ok=True)
        raise HTTPException(500, detail="Internal server error")

    return UploadResponse(
        url=f"{BASE_URL}/image/{stored_name}",
        thumb_url=f"{BASE_URL}/image/thumb/{stored_name}",
        stored_filename=stored_name,
        orig_filename=file.filename or stored_name,
        content_type=content_type,
        width=processed.width,
        height=processed.height,
        size_bytes=len(data),
        uploaded_at=now.isoformat() + "Z",
        expires_at=expires_at.isoformat() + "Z",
    )


@router.delete("/{filename}", status_code=204)
async def delete_image(filename: str, user: User = Depends(require_user)):
    safe = safe_basename(filename)
    if not safe:
        raise HTTPException(400, "Bad request")
    deleted = await delete_image_record(safe, user.id)
    if not deleted:
        raise HTTPException(404, "Not found")


@router.get("/list", response_model=ImageListResponse)
async def list_images(
    user: User = Depends(require_user),
    n: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    now = datetime.now(timezone.utc)
    records, total = await list_images_by_user(user.id, limit=n, offset=offset)

    items = []
    for r in records:
        expires_at = datetime.fromisoformat(r.expires_at)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        thumb_url = (
            f"{BASE_URL}/image/thumb/{r.stored_filename}" if r.thumb_path else None
        )
        items.append(
            ImageListItem(
                orig_filename=r.orig_filename,
                stored_filename=r.stored_filename,
                url=f"{BASE_URL}/image/{r.stored_filename}",
                thumb_url=thumb_url,
                width=r.width,
                height=r.height,
                size_bytes=r.size_bytes,
                uploaded_at=r.uploaded_at,
                expires_at=r.expires_at,
                expired=expires_at <= now,
            )
        )
    return ImageListResponse(items=items, total=total, offset=offset, n=n)


@router.get("/thumb/{filename}")
async def get_thumb(filename: str):
    safe = safe_basename(filename)
    if not safe:
        raise HTTPException(400, "Bad request")

    result = await get_image_record(safe)
    if not result or not result.thumb_path:
        raise HTTPException(404, "Not found")

    tpath = Path("data") / Path(result.thumb_path)
    if not tpath.exists():
        raise HTTPException(404, "Not found")

    return FileResponse(tpath, media_type="image/webp")


@router.get("/{filename}")
async def get_image(filename: str):
    safe = safe_basename(filename)
    if not safe:
        raise HTTPException(400, "Bad request")

    result = await get_image_record(safe)
    if not result:
        raise HTTPException(404, "Not found")

    expires_at = datetime.fromisoformat(result.expires_at)
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(410, "File expired")

    fpath = resolve_image_path(result)
    if not fpath.exists():
        raise HTTPException(500, "Internal server error")

    return FileResponse(fpath, media_type=result.content_type or guess_mime(fpath))
