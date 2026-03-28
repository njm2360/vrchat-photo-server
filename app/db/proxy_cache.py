import asyncio
import datetime as dt
from pathlib import Path
from typing import List

from app.db.connection import get_conn


def init_proxy_cache():
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS proxy_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            file_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expire_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_proxy_expire ON proxy_cache(expire_at);"
    )
    conn.commit()


async def insert_or_update_proxy_cache(url: str, file_path: str, ttl: int = 86400):
    now = dt.datetime.now(dt.timezone.utc)
    expire_at = (now + dt.timedelta(seconds=ttl)).isoformat()
    now_iso = now.isoformat()

    def _upsert():
        conn = get_conn()
        conn.execute(
            """
            INSERT INTO proxy_cache (url, file_path, created_at, expire_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET
                file_path=excluded.file_path,
                created_at=excluded.created_at,
                expire_at=excluded.expire_at
            """,
            (url, file_path, now_iso, expire_at),
        )
        conn.commit()

    await asyncio.to_thread(_upsert)


async def get_valid_proxy_cache(url: str) -> str | None:
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    def _query():
        conn = get_conn()
        row = conn.execute(
            "SELECT file_path FROM proxy_cache WHERE url=? AND expire_at > ?",
            (url, now_iso),
        ).fetchone()
        return row["file_path"] if row else None

    return await asyncio.to_thread(_query)


async def delete_expired_proxy_cache() -> int:
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    def _run() -> int:
        conn = get_conn()
        rows = conn.execute(
            "SELECT id, file_path FROM proxy_cache WHERE expire_at <= ?",
            (now_iso,),
        ).fetchall()
        ids: List[int] = []
        for r in rows:
            try:
                fpath = Path(r["file_path"])
                if fpath.exists():
                    fpath.unlink()
            except Exception:
                pass
            ids.append(r["id"])
        if ids:
            conn.execute(
                f"DELETE FROM proxy_cache WHERE id IN ({','.join('?' for _ in ids)})",
                ids,
            )
            conn.commit()
        return len(ids)

    return await asyncio.to_thread(_run)


async def cleanup_proxy_loop(interval: int = 3600):
    await asyncio.sleep(1)
    while True:
        try:
            await delete_expired_proxy_cache()
        except Exception:
            pass
        await asyncio.sleep(interval)
