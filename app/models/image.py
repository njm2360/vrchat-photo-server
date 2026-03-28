from typing import List, Optional
from pydantic import BaseModel


class UploadResponse(BaseModel):
    url: str
    thumb_url: Optional[str] = None
    stored_filename: str
    orig_filename: str
    content_type: str
    width: int
    height: int
    size_bytes: int
    uploaded_at: str
    expires_at: str


class ImageListItem(BaseModel):
    orig_filename: str
    stored_filename: str
    url: str
    thumb_url: Optional[str] = None
    width: int
    height: int
    size_bytes: int
    uploaded_at: str
    expires_at: str
    expired: bool


class ImageListResponse(BaseModel):
    items: List[ImageListItem]
    total: int
    offset: int
    n: int
