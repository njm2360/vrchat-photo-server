import asyncio
from pathlib import Path
from typing import Optional
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.db.connection import BASE_DIR, get_conn


@dataclass
class ImageRecord:
    id: int
    orig_filename: str
    stored_filename: str
    content_type: Optional[str]
    width: int
    height: int
    size_bytes: int
    uploaded_at: str
    expires_at: str
    path: str
    thumb_path: Optional[str] = None


def init_db():
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orig_filename TEXT NOT NULL,
            stored_filename TEXT NOT NULL UNIQUE,
            content_type TEXT,
            width INTEGER,
            height INTEGER,
            size_bytes INTEGER,
            uploaded_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            path TEXT NOT NULL,
            uploaded_by INTEGER REFERENCES users(id),
            thumb_path TEXT
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_expires_at ON images(expires_at);")
    conn.commit()


async def get_image_record(filename: str) -> Optional[ImageRecord]:
    def _query():
        conn = get_conn()
        row = conn.execute(
            """
            SELECT id, orig_filename, stored_filename, content_type,
                width, height, size_bytes, uploaded_at, expires_at, path, thumb_path
            FROM images WHERE stored_filename=?
            """,
            (filename,),
        ).fetchone()
        return ImageRecord(**dict(row)) if row else None

    return await asyncio.to_thread(_query)


def resolve_image_path(row: ImageRecord) -> Path:
    return BASE_DIR / Path(row.path)


async def insert_image_record(
    *,
    orig_filename: str,
    stored_filename: str,
    content_type: str,
    width: int,
    height: int,
    size_bytes: int,
    uploaded_at: datetime,
    expires_at: datetime,
    path: Path,
    uploaded_by: int,
    thumb_path: Optional[Path] = None,
):
    relative_path = path.relative_to(BASE_DIR)
    relative_thumb = str(thumb_path.relative_to(BASE_DIR)) if thumb_path else None

    def _insert():
        conn = get_conn()
        conn.execute(
            """
            INSERT INTO images (
                orig_filename, stored_filename, content_type,
                width, height, size_bytes,
                uploaded_at, expires_at, path, uploaded_by, thumb_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                orig_filename,
                stored_filename,
                content_type,
                width,
                height,
                size_bytes,
                uploaded_at.isoformat(),
                expires_at.isoformat(),
                str(relative_path),
                uploaded_by,
                relative_thumb,
            ),
        )
        conn.commit()

    await asyncio.to_thread(_insert)


async def delete_image_record(stored_filename: str, user_id: int) -> bool:
    def _run() -> bool:
        conn = get_conn()
        row = conn.execute(
            "SELECT id, path, thumb_path, uploaded_by FROM images WHERE stored_filename=?",
            (stored_filename,),
        ).fetchone()
        if not row:
            return False
        if row["uploaded_by"] != user_id:
            return False
        fpath = BASE_DIR / Path(row["path"])
        try:
            if fpath.exists():
                fpath.unlink()
        except Exception:
            pass
        if row["thumb_path"]:
            try:
                tpath = BASE_DIR / Path(row["thumb_path"])
                if tpath.exists():
                    tpath.unlink()
            except Exception:
                pass
        conn.execute("DELETE FROM images WHERE id=?", (row["id"],))

        conn.commit()
        return True

    return await asyncio.to_thread(_run)


async def list_images_by_user(
    user_id: int, limit: int = 20, offset: int = 0
) -> tuple[list[ImageRecord], int]:
    def _query():
        conn = get_conn()
        total = conn.execute(
            "SELECT COUNT(*) FROM images WHERE uploaded_by=?", (user_id,)
        ).fetchone()[0]
        rows = conn.execute(
            """
            SELECT id, orig_filename, stored_filename, content_type,
                width, height, size_bytes, uploaded_at, expires_at, path, thumb_path
            FROM images WHERE uploaded_by=?
            ORDER BY uploaded_at DESC
            LIMIT ? OFFSET ?
            """,
            (user_id, limit, offset),
        ).fetchall()
        return [ImageRecord(**dict(r)) for r in rows], total

    return await asyncio.to_thread(_query)


async def delete_expired_now() -> int:
    now = datetime.now(timezone.utc)

    def _run() -> int:
        now_iso = now.isoformat()
        conn = get_conn()
        rows = conn.execute(
            "SELECT id, path, expires_at FROM images WHERE expires_at <= ?",
            (now_iso,),
        ).fetchall()
        for r in rows:
            fpath = BASE_DIR / Path(r["path"])
            try:
                if fpath.exists():
                    fpath.unlink()
            except Exception:
                pass
            if r["thumb_path"]:
                tpath = BASE_DIR / Path(r["thumb_path"])
                try:
                    if tpath.exists():
                        tpath.unlink()
                except Exception:
                    pass

        # expire + 30日 を過ぎたレコードは削除
        cutoff = (now - timedelta(days=30)).isoformat()
        old_rows = conn.execute(
            "SELECT id FROM images WHERE expires_at <= ?",
            (cutoff,),
        ).fetchall()
        ids = [r["id"] for r in old_rows]
        if ids:
            conn.execute(
                f"DELETE FROM images WHERE id IN ({','.join('?' for _ in ids)})",
                ids,
            )
            conn.commit()
            return len(ids)
        return 0

    return await asyncio.to_thread(_run)


async def cleanup_upload_loop(interval: int = 60):
    await asyncio.sleep(1)
    while True:
        try:
            await delete_expired_now()
        except Exception:
            pass
        await asyncio.sleep(interval)
