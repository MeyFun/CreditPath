from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..models import AuditLog, User

GENESIS_HASH = "0" * 64
AUDIT_LOCK_KEY = 917_421


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=_json_default)


def _canonical_time(value: datetime) -> str:
    # PostgreSQL возвращает aware datetime, SQLite — naive. Для стабильного хеша
    # трактуем naive-значение как UTC; в рабочем контуре используется PostgreSQL.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _calculate_hash(previous_hash: str, payload: dict[str, Any]) -> str:
    return hashlib.sha256((previous_hash + _canonical(payload)).encode("utf-8")).hexdigest()


def write_audit(
    db: Session,
    *,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: str | int | None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    actor_label: str | None = None,
) -> AuditLog:
    """Добавляет запись аудита. Не коммитит транзакцию."""
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": AUDIT_LOCK_KEY})

    previous = db.scalar(select(AuditLog).order_by(AuditLog.id.desc()).limit(1))
    previous_hash = previous.entry_hash if previous else GENESIS_HASH
    created_at = datetime.now(timezone.utc)
    entry = AuditLog(
        created_at=created_at,
        actor_id=actor.id if actor else None,
        actor_label=actor_label or (actor.full_name if actor else "Система"),
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        before=before,
        after=after,
        previous_hash=previous_hash,
        entry_hash="",
    )
    payload = {
        "created_at": _canonical_time(created_at),
        "actor_id": entry.actor_id,
        "actor_label": entry.actor_label,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entry.entity_id,
        "before": before,
        "after": after,
        "previous_hash": previous_hash,
    }
    entry.entry_hash = _calculate_hash(previous_hash, payload)
    db.add(entry)
    db.flush()
    return entry


def verify_audit_chain(db: Session) -> dict[str, Any]:
    entries = list(db.scalars(select(AuditLog).order_by(AuditLog.id.asc())).all())
    previous_hash = GENESIS_HASH
    for index, entry in enumerate(entries, start=1):
        payload = {
            "created_at": _canonical_time(entry.created_at),
            "actor_id": entry.actor_id,
            "actor_label": entry.actor_label,
            "action": entry.action,
            "entity_type": entry.entity_type,
            "entity_id": entry.entity_id,
            "before": entry.before,
            "after": entry.after,
            "previous_hash": entry.previous_hash,
        }
        expected = _calculate_hash(previous_hash, payload)
        if entry.previous_hash != previous_hash or entry.entry_hash != expected:
            return {
                "valid": False,
                "checked": index,
                "broken_at": entry.id,
                "message": f"Цепочка нарушена на записи #{entry.id}",
            }
        previous_hash = entry.entry_hash
    return {
        "valid": True,
        "checked": len(entries),
        "broken_at": None,
        "message": f"Цепочка целостна: проверено {len(entries)} записей",
    }
