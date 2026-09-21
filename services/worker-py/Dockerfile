FROM python:3.11-slim

WORKDIR /app

ENV PIP_PROGRESS_BAR=off
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir --progress-bar off -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["python", "main.py"]
