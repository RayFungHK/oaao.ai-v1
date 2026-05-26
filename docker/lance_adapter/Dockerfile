FROM python:3.12-slim-bookworm

WORKDIR /app

COPY python/lance_adapter/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY python/lance_adapter/ /app/lance_adapter/

ENV PYTHONUNBUFFERED=1
ENV LANCE_ADAPTER_MODE=stub
ENV LANCE_PORT=8787

EXPOSE 8787

CMD ["uvicorn", "lance_adapter.app:app", "--host", "0.0.0.0", "--port", "8787"]
