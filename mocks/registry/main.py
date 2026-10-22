from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException

app = FastAPI(title="CreditPath Registry Mock", version="1.0.0", docs_url="/docs")
DATA = json.loads((Path(__file__).parent / "data.json").read_text(encoding="utf-8"))


@app.get("/health")
@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "registry-mock"}


@app.get("/readyz")
def ready() -> dict[str, str]:
    return {"status": "ready", "service": "registry-mock"}


@app.get("/registry/{inn}")
def get_company(inn: str) -> dict:
    if not inn.isdigit() or len(inn) not in (10, 12):
        raise HTTPException(status_code=400, detail="ИНН должен содержать 10 или 12 цифр")
    company = DATA.get(inn)
    if company is None:
        raise HTTPException(status_code=404, detail="Компания не найдена в реестре")
    return company
