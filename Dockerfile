FROM python:3.12-slim

WORKDIR /app

# Install deps first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Most hosts inject $PORT; default to 8100 locally.
ENV PORT=8100
EXPOSE 8100

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
