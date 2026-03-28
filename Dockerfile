FROM python:3.13-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-editable

ADD . /app

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-editable

FROM python:3.13-slim

COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --from=builder /app /app

WORKDIR /app

EXPOSE 8000

VOLUME [ "/app/data" ]

CMD [".venv/bin/uvicorn", "main:app", "--host=0.0.0.0", "--port=8000"]
