import os, mimetypes
import datetime as dt
from PIL import Image
from pathlib import Path
from typing import Optional


def safe_basename(name: str) -> Optional[str]:
    base = os.path.basename(name)
    return (
        "".join(c if c.isalnum() or c in (".", "-", "_") else "_" for c in base) or None
    )


def get_timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S")


def unique_name(dirpath: Path, original: str) -> str:
    prefix = get_timestamp()
    base = safe_basename(original)
    name = f"{prefix}_{base}"
    n = 1
    while (dirpath / name).exists():
        name = f"{prefix}_{base}-{n}"
        n += 1
    return name


def fit_within(
    img: Image.Image, max_w: Optional[int], max_h: Optional[int]
) -> Image.Image:
    if not max_w and not max_h:
        return img
    mw = int(max_w) if max_w else 10**9
    mh = int(max_h) if max_h else 10**9
    if img.width <= mw and img.height <= mh:
        return img
    im = img.copy()
    im.thumbnail((mw, mh))
    return im


def resize_longest_side(img: Image.Image, max_len: int = 2048) -> Image.Image:
    """長辺が max_len を超えていたら縮小（アスペクト比維持）"""
    w, h = img.size
    if max(w, h) <= max_len:
        return img  # リサイズ不要

    if w >= h:
        new_w = max_len
        new_h = int(h * (max_len / w))
    else:
        new_h = max_len
        new_w = int(w * (max_len / h))

    return img.resize((new_w, new_h), Image.LANCZOS)


def guess_mime(path: Path, fallback="application/octet-stream") -> str:
    mime, _ = mimetypes.guess_type(str(path))
    return mime or fallback


