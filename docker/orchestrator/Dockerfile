# Python orchestrator sidecar — OpenAI-compatible streaming SSE for workspace chat.
FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-chi-tra \
        docker.io \
        docker-compose \
        fontconfig \
        fonts-crosextra-carlito \
        fonts-liberation \
        libreoffice-impress \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-core \
        poppler-utils \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        libffi-dev \
        shared-mime-info \
        fonts-noto-cjk \
    && mkdir -p /var/oaao/font-cache \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

COPY python/requirements.txt /app/python/requirements.txt
COPY python/requirements-dev.txt /app/python/requirements-dev.txt
# requirements-dev.txt includes -r requirements.txt (uvicorn, fastapi, …).
RUN pip install --no-cache-dir -r /app/python/requirements-dev.txt

COPY VERSION /app/VERSION
COPY build/oaao_build_info.json /app/build/oaao_build_info.json
COPY python/ /app/python/

ENV PYTHONPATH=/app/python
ENV PYTHONUNBUFFERED=1

EXPOSE 8103

# Use python -m so CMD works even if pip scripts are off PATH.
CMD ["python", "-m", "uvicorn", "oaao_orchestrator.app:app", "--host", "0.0.0.0", "--port", "8103"]
