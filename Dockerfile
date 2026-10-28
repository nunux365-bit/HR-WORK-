FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies first (cached layer)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy project files
COPY backend /app/backend
COPY frontend /app/frontend
COPY data /app/data

# Initialize SQLite tables if not present
RUN python -m backend.database.init_db

ENV PORT=8080
ENV HOST=0.0.0.0
ENV FLASK_ENV=production
ENV FLASK_DEBUG=false

EXPOSE 8080

# Single worker with 8 threads keeps SQLite safe and fast on Google Cloud Run
CMD exec gunicorn backend.server:app --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 8 --timeout 120

