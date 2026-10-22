from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import ScoringConfig

REQUIRED_TOP_LEVEL = {
    "base_score",
    "age",
    "amount_to_revenue",
    "profit",
    "bki",
    "debt_load",
    "okved",
    "collateral",
    "decision",
}


def load_default_config(path: Path | None = None) -> dict[str, Any]:
    with open(path or settings.scoring_config_path, encoding="utf-8") as source:
        data = yaml.safe_load(source)
    if not isinstance(data, dict):
        raise ValueError("Конфигурация скоринга должна быть объектом")
    validate_config(data)
    return data


def validate_config(config: dict[str, Any]) -> None:
    missing = REQUIRED_TOP_LEVEL - set(config)
    if missing:
        raise ValueError(f"В конфигурации не хватает разделов: {', '.join(sorted(missing))}")
    if not isinstance(config.get("base_score"), (int, float)):
        raise ValueError("base_score должен быть числом")
    if not 0 <= float(config["base_score"]) <= 100:
        raise ValueError("base_score должен быть в диапазоне 0–100")
    for section in ("age", "amount_to_revenue", "profit", "bki", "debt_load", "okved", "collateral", "decision"):
        if not isinstance(config.get(section), dict):
            raise ValueError(f"Раздел {section} должен быть объектом")
    decision = config["decision"]
    if not (0 <= float(decision.get("changed_threshold", -1)) < float(decision.get("approve_threshold", 101)) <= 100):
        raise ValueError("Пороги решения заданы некорректно")
    if int(decision.get("offer_valid_days", 0)) < 1:
        raise ValueError("Срок действия оферты должен быть положительным")
    if not isinstance(config["okved"].get("risky_prefixes"), list):
        raise ValueError("okved.risky_prefixes должен быть списком")


def get_active_config(db: Session) -> tuple[dict[str, Any], ScoringConfig | None]:
    row = db.scalar(
        select(ScoringConfig)
        .where(ScoringConfig.is_active.is_(True))
        .order_by(ScoringConfig.version.desc())
        .limit(1)
    )
    if row is None:
        return load_default_config(), None
    return deepcopy(row.config), row
