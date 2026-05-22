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
    && mkdir -p /var/oaao/font-cache \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

COPY python/requirements.txt /app/python/requirements.txt
COPY python/requirements-dev.txt /app/python/requirements-dev.txt
RUN pip install --no-cache-dir -r /app/python/requirements-dev.txt

COPY python/ /app/python/

ENV PYTHONPATH=/app/python
ENV PYTHONUNBUFFERED=1

EXPOSE 8103

CMD ["uvicorn", "oaao_orchestrator.app:app", "--host", "0.0.0.0", "--port", "8103"]
