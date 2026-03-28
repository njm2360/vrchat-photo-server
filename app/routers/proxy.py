import httpx
import hashlib
from PIL import Image
from io import BytesIO
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from fastapi import APIRouter, Query, HTTPException, Request
from fastapi.responses import FileResponse

from app.db.proxy_cache import get_valid_proxy_cache, insert_or_update_proxy_cache
from app.utils import fit_within
from app.security import is_private_address

router = APIRouter()

CACHE_DIR = Path("./data/cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

CACHE_EXPIRE = 86400  # 1日
MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024  # 50MB
MAX_DIM = 2048


async def _ssrf_guard(req: httpx.Request) -> None:
    if is_private_address(str(req.url)):
        raise HTTPException(400, "Invalid URL")


@router.get("/proxy")
async def proxy_image(
    request: Request,
    url: str = Query(..., description="画像URL"),
    cache: Optional[bool] = Query(default=True, description="キャッシュ可否"),
    max_dim: int = Query(
        default=MAX_DIM, ge=1, le=MAX_DIM, description="最大辺長 (px)"
    ),
):
    extra_params = {
        k: v
        for k, v in request.query_params.items()
        if k not in ("url", "cache", "max_dim")
    }
    scheme, netloc, path, query, fragment = urlsplit(url)
    merged = dict(parse_qsl(query))
    merged.update(extra_params)
    final_url = urlunsplit((scheme, netloc, path, urlencode(merged), fragment))

    if cache:
        cache_file = await get_valid_proxy_cache(final_url)
        if cache_file and Path(cache_file).exists():
            return FileResponse(cache_file, media_type="image/png")

    try:
        async with httpx.AsyncClient(
            timeout=10,
            event_hooks={"request": [_ssrf_guard]},
        ) as client:
            r = await client.get(final_url, follow_redirects=True)
            if r.status_code != 200:
                raise HTTPException(502, "Failed to fetch image")
            if "image" not in r.headers.get("content-type", ""):
                raise HTTPException(400, "Not an image")
            if len(r.content) > MAX_DOWNLOAD_SIZE:
                raise HTTPException(413, "Image too large")
            raw = r.content
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, "Failed to download")

    try:
        img = Image.open(BytesIO(raw))
    except Exception:
        raise HTTPException(400, "Invalid image")

    if max(img.size) > max_dim:
        img = fit_within(img, max_dim, max_dim)

    key = hashlib.sha256(final_url.encode()).hexdigest()
    file_path = str(CACHE_DIR / f"{key}.png")
    img.save(file_path, "PNG")

    try:
        await insert_or_update_proxy_cache(final_url, file_path, ttl=86400)
    except Exception:
        Path(file_path).unlink(missing_ok=True)
        raise HTTPException(500, "Internal server error")

    return FileResponse(file_path, media_type="image/png")
