# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system pytch && useradd --system --gid pytch --home /app pytch

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY --chown=pytch:pytch . .
RUN chmod +x scripts/entrypoint.sh && mkdir -p media/uploads && chown -R pytch:pytch media

USER pytch
EXPOSE 8000

ENTRYPOINT ["scripts/entrypoint.sh"]
# No `--forwarded-allow-ips *`: forwarding headers are trusted only from the proxy (see TRUSTED_PROXY_CIDRS).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
