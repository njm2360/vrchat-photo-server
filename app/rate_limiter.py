import time
import threading
from collections import defaultdict

from fastapi import Request

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 900


_lock = threading.Lock()
_attempts: dict[str, list[float]] = defaultdict(list)


def make_key(request: Request, username: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{ip}:{username}"


def is_rate_limited(key: str) -> bool:
    now = time.monotonic()
    cutoff = now - WINDOW_SECONDS
    with _lock:
        _attempts[key] = [t for t in _attempts[key] if t > cutoff]
        return len(_attempts[key]) >= MAX_ATTEMPTS


def record_failure(key: str) -> None:
    with _lock:
        _attempts[key].append(time.monotonic())


def reset_attempts(key: str) -> None:
    with _lock:
        _attempts.pop(key, None)
