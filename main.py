import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from app.routers.auth import check_auth
from app.routers import auth, images, proxy
from app.db.images import cleanup_upload_loop, init_db
from app.db.proxy_cache import cleanup_proxy_loop, init_proxy_cache
from app.db.token_blocklist import cleanup_token_blocklist_loop, init_token_blocklist
from app.db.users import init_users


PROTECTED_PAGES = ["/upload.html", "/images.html"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_proxy_cache()
    init_users()
    init_token_blocklist()
    asyncio.create_task(cleanup_upload_loop())
    asyncio.create_task(cleanup_proxy_loop())
    asyncio.create_task(cleanup_token_blocklist_loop())
    yield


app = FastAPI(title="Image Server API", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def resolve_real_ip(request: Request, call_next):
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        request.scope["client"] = (cf_ip.strip(), 0)
    elif forwarded := request.headers.get("X-Forwarded-For"):
        request.scope["client"] = (forwarded.split(",")[0].strip(), 0)
    return await call_next(request)


app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(proxy.router, tags=["proxy"])
app.include_router(images.router, prefix="/image", tags=["images"])

app.mount("/", StaticFiles(directory="static", html=True), name="static")


@app.middleware("http")
async def check_auth_for_protected_pages(request: Request, call_next):
    path = request.url.path

    if path in PROTECTED_PAGES:
        try:
            await check_auth(request)
        except Exception:
            return RedirectResponse(url="/login.html")

    return await call_next(request)
