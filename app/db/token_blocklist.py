import asyncio
import hashlib
import threading
from datetime import datetime, timezone
from typing import Set

from app.db.connection import get_conn

_revoked_tokens: Set[str] = set()
_revoked_lock = threading.Lock()


def init_token_blocklist():
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS revoked_tokens (
            token_hash TEXT PRIMARY KEY,
            expire_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_revoked_expire ON revoked_tokens(expire_at);"
    )
    conn.commit()

    now_iso = datetime.now(timezone.utc).isoformat()
    rows = conn.execute(
        "SELECT token_hash FROM revoked_tokens WHERE expire_at > ?", (now_iso,)
    ).fetchall()
    with _revoked_lock:
        _revoked_tokens.update(r["token_hash"] for r in rows)


def revoke_token(token: str, expire_at: int):
    """expire_at は JWT の exp クレーム（UNIX タイムスタンプ）"""
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expire_at_iso = datetime.fromtimestamp(expire_at, tz=timezone.utc).isoformat()
    with _revoked_lock:
        _revoked_tokens.add(token_hash)
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO revoked_tokens (token_hash, expire_at) VALUES (?, ?)",
        (token_hash, expire_at_iso),
    )
    conn.commit()


def is_token_revoked(token: str) -> bool:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with _revoked_lock:
        return token_hash in _revoked_tokens


async def cleanup_token_blocklist_loop(interval: int = 3600):
    await asyncio.sleep(1)
    while True:
        try:
            now_iso = datetime.now(timezone.utc).isoformat()

            def _cleanup() -> Set[str]:
                conn = get_conn()
                conn.execute(
                    "DELETE FROM revoked_tokens WHERE expire_at <= ?", (now_iso,)
                )
                conn.commit()
                rows = conn.execute(
                    "SELECT token_hash FROM revoked_tokens WHERE expire_at > ?",
                    (now_iso,),
                ).fetchall()
                return {r["token_hash"] for r in rows}

            valid_hashes = await asyncio.to_thread(_cleanup)
            with _revoked_lock:
                _revoked_tokens.clear()
                _revoked_tokens.update(valid_hashes)
        except Exception:
            pass
        await asyncio.sleep(interval)
