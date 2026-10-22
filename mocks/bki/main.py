from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException

app = FastAPI(title="CreditPath BKI Mock", version="1.0.0", docs_url="/docs")
DATA = json.loads((Path(__file__).parent / "data.json").read_text(encoding="utf-8"))


@app.get("/health")
@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "bki-mock"}


@app.get("/readyz")
def ready() -> dict[str, str]:
    return {"status": "ready", "service": "bki-mock"}


@app.get("/bki/{inn}")
def get_credit_history(inn: str) -> dict:
    if not inn.isdigit() or len(inn) not in (10, 12):
        raise HTTPException(status_code=400, detail="ИНН должен содержать 10 или 12 цифр")
    record = DATA.get(inn)
    if record is None:
        raise HTTPException(status_code=404, detail="Кредитная история не найдена")
    return record
