from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Notification, ROLE_ADMIN, User


def notify(
    db: Session,
    *,
    user_id: int,
    title: str,
    body: str,
    application_id: int | None = None,
    kind: str = "info",
) -> Notification:
    item = Notification(
        user_id=user_id,
        application_id=application_id,
        title=title,
        body=body,
        kind=kind,
    )
    db.add(item)
    return item


def notify_admins(
    db: Session,
    *,
    title: str,
    body: str,
    application_id: int | None = None,
    kind: str = "warning",
) -> None:
    admins = db.scalars(select(User).where(User.role == ROLE_ADMIN, User.is_active.is_(True))).all()
    for admin in admins:
        notify(db, user_id=admin.id, title=title, body=body, application_id=application_id, kind=kind)
