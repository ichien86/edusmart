from fastapi import FastAPI
import os
import sys

app = FastAPI(title="EduAssess Python Worker (CAS & Ingestion)")

@app.get("/healthz")
def health():
    return {"status": "ok", "service": "worker-py"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
