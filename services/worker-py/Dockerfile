FROM python:3.11-slim

WORKDIR /app

# Install Pandoc and headless LibreOffice with fallback
RUN apt-get update && \
    (apt-get install -y --no-install-recommends pandoc libreoffice-writer-nogpu || \
     apt-get install -y --no-install-recommends pandoc libreoffice-writer || \
     apt-get install -y --no-install-recommends pandoc) && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["python", "main.py"]
