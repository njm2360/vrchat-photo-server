import os
import secrets
import httpx
import bcrypt
from typing import Optional
from urllib.parse import urlencode
from jose import jwt, JWTError

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi_login import LoginManager
from fastapi_login.exceptions import InvalidCredentialsException

from app.db.users import User
from app.models.auth import LoginData
from app.rate_limiter import is_rate_limited, make_key, record_failure, reset_attempts

SECRET = os.getenv("SECRET_KEY")
if not SECRET:
    raise RuntimeError("SECRET_KEY environment variable is not set")

COOKIE_NAME = "auth"


router = APIRouter()

manager = LoginManager(SECRET, token_url="/auth/login", use_cookie=True)
manager.cookie_name = COOKIE_NAME


@manager.user_loader()
def load_user(username: str) -> Optional[User]:
    from app.db.users import get_user

    return get_user(username)


async def check_auth(request: Request) -> None:
    from app.db.token_blocklist import is_token_revoked

    token = request.cookies.get(COOKIE_NAME)
    if token and is_token_revoked(token):
        raise Exception("revoked")
    await manager(request)


async def require_user(request: Request) -> User:
    from app.db.token_blocklist import is_token_revoked

    token = request.cookies.get(COOKIE_NAME)
    if token and is_token_revoked(token):
        raise HTTPException(status_code=401, detail="Session has been revoked")
    return await manager(request)


@router.post("/login")
def login(data: LoginData, request: Request):
    key = make_key(request, data.username)
    if is_rate_limited(key):
        raise HTTPException(
            status_code=429, detail="Too many login attempts. Try again later."
        )
    user = load_user(data.username)
    if (
        not user
        or not user.password_hash
        or not bcrypt.checkpw(data.password.encode(), user.password_hash.encode())
    ):
        record_failure(key)
        raise InvalidCredentialsException
    reset_attempts(key)
    token = manager.create_access_token(data={"sub": data.username})
    resp = JSONResponse({"msg": "login success"})
    manager.set_cookie(resp, token)
    return resp


@router.post("/logout")
def logout(request: Request):
    from app.db.token_blocklist import revoke_token

    token = request.cookies.get(COOKIE_NAME)
    if token:
        try:
            payload = jwt.decode(token, SECRET, algorithms=["HS256"])
            exp = int(payload.get("exp", 0))
        except JWTError:
            exp = 0
        if exp:
            revoke_token(token, exp)
    resp = JSONResponse({"msg": "logout success"})
    resp.delete_cookie(manager.cookie_name)
    return resp
