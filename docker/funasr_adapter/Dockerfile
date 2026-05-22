FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY python/funasr_adapter/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY python/funasr_adapter/ /app/funasr_adapter/

ENV PYTHONUNBUFFERED=1
ENV FUNASR_ADAPTER_MODE=stub
ENV FUNASR_PORT=8765

EXPOSE 8765

CMD ["uvicorn", "funasr_adapter.app:app", "--host", "0.0.0.0", "--port", "8765"]
