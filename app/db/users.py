from typing import Optional
from dataclasses import dataclass

from app.db.connection import get_conn


@dataclass
class User:
    id: int
    username: str
    password_hash: Optional[str]


def init_users():
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT
        );
        """
    )
    conn.commit()


def create_user(username: str, password_hash: str):
    conn = get_conn()
    conn.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        (username, password_hash),
    )
    conn.commit()


def get_user(username: str) -> Optional[User]:
    conn = get_conn()
    row = conn.execute(
        "SELECT id, username, password_hash FROM users WHERE username=?",
        (username,),
    ).fetchone()
    return User(**dict(row)) if row else None
