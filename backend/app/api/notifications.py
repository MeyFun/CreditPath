from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Notification, User
from ..schemas import MessageOut, NotificationsResponse
from ..security import get_current_user

router = APIRouter(prefix="/notifications", tags=["Уведомления"])


@router.get("", response_model=NotificationsResponse)
def list_notifications(
    only_unread: bool = False,
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    query = select(Notification).where(Notification.user_id == user.id)
    if only_unread:
        query = query.where(Notification.is_read.is_(False))
    items = db.scalars(query.order_by(Notification.created_at.desc()).limit(limit)).all()
    unread = int(
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id, Notification.is_read.is_(False)
            )
        )
        or 0
    )
    return {"items": items, "unread": unread}


@router.post("/{notification_id}/read", response_model=MessageOut)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MessageOut:
    item = db.get(Notification, notification_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status_code=404, detail="Уведомление не найдено")
    item.is_read = True
    db.commit()
    return MessageOut(message="Уведомление прочитано")


@router.post("/read-all", response_model=MessageOut)
def mark_all_read(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> MessageOut:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    db.commit()
    return MessageOut(message="Все уведомления прочитаны")
