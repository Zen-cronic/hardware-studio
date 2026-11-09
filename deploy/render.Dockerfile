# syntax=docker/dockerfile:1
# Linux x64 is required by the locked native CAD and reconstruction wheels.
FROM node:24.22.1-bookworm-slim AS build
ENV DEBIAN_FRONTEND=noninteractive \
    PYENV_ROOT=/opt/pyenv \
    VIRTUAL_ENV=/opt/pyenv/versions/.victoria-hardware \
    POETRY_VIRTUALENVS_CREATE=false \
    PLAYWRIGHT_BROWSERS_PATH=/opt/chromium \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
ENV PATH="/opt/pyenv/versions/.victoria-hardware/bin:/opt/pyenv/bin:/root/.local/bin:${PATH}"
RUN test "$(uname -m)" = x86_64 && apt-get update && apt-get install -y --no-install-recommends \
    build-essential git curl ca-certificates xz-utils ffmpeg libssl-dev zlib1g-dev \
    libbz2-dev libreadline-dev libsqlite3-dev libffi-dev liblzma-dev libncursesw5-dev \
    libgdbm-dev tk-dev uuid-dev libgl1 libegl1 libgomp1 pipx gosu util-linux procps \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY deploy/render-python.sh /tmp/render-python.sh
RUN bash /tmp/render-python.sh
COPY pyproject.toml poetry.lock .python-version ./
RUN poetry install --only main --no-root --no-interaction && poetry cache clear --all pypi -n
COPY package.json package-lock.json ./
RUN npm ci && npx --no-install playwright install --with-deps chromium
COPY . .
ENV VITE_COLLAB_PATH=/collab
RUN npm run build && npm prune --omit=dev && npm cache clean --force \
    && chmod -R a+rX /opt/pyenv /opt/chromium
# Keep OS/browser licenses in the image; exact native notices require release review.
ENV NODE_ENV=production \
    CAD_PYTHON=/opt/pyenv/versions/.victoria-hardware/bin/python \
    HOST=0.0.0.0 PORT=10000 COLLAB_TRANSPORT=shared \
    DATA_DIR=/var/data/hardware-studio \
    AI_BUDGET_USD=0 AI_REQUEST_RESERVATION_USD=1 \
    HEAVY_WORKER_CONCURRENCY=1 HEAVY_WORKER_QUEUE_LIMIT=2 \
    AI_PROVIDER_CONCURRENCY=1 \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
EXPOSE 10000
CMD ["bash", "/app/deploy/render-start.sh"]
