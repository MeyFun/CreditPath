"""Идемпотентный seed: продукты, версия скоринга, демонстрационные учётные записи.

Запускается автоматически при старте контейнера после Alembic.
Повторный запуск не сбрасывает изменения администратора.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .models import Product, ROLE_ADMIN, ROLE_CLIENT, ROLE_EMPLOYEE, ScoringConfig, User
from .security import hash_password
from .services.scoring_config import load_default_config

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("creditpath.seed")


PRODUCTS = [
    {
        "code": "OBOROT",
        "name": "Оборотный кредит",
        "short_description": "На закупку товара, расчёты с поставщиками и пополнение склада",
        "description": "Финансирование текущей деятельности компании. Без залога, аннуитетные платежи, досрочное погашение без комиссии.",
        "min_amount": Decimal("300000"),
        "max_amount": Decimal("30000000"),
        "min_term_months": 3,
        "max_term_months": 36,
        "rate": Decimal("14.50"),
        "min_business_age_months": 6,
        "requires_collateral": False,
        "revenue_limit_ratio": Decimal("0.400"),
        "purposes": [
            {"code": "working_capital", "label": "Пополнение оборотных средств"},
            {"code": "purchases", "label": "Закупка товара и материалов"},
            {"code": "refinancing", "label": "Рефинансирование кредита"},
        ],
        "sort_order": 1,
    },
    {
        "code": "EQUIPMENT",
        "name": "Кредит на оборудование",
        "short_description": "Покупка и модернизация оборудования, техники и транспорта",
        "description": "Инвестиционный кредит под залог приобретаемого оборудования. Увеличенный срок и пониженная ставка.",
        "min_amount": Decimal("500000"),
        "max_amount": Decimal("50000000"),
        "min_term_months": 6,
        "max_term_months": 60,
        "rate": Decimal("13.80"),
        "min_business_age_months": 12,
        "requires_collateral": True,
        "revenue_limit_ratio": Decimal("0.450"),
        "purposes": [
            {"code": "equipment", "label": "Покупка оборудования и транспорта"},
            {"code": "modernization", "label": "Модернизация производства"},
        ],
        "sort_order": 2,
    },
    {
        "code": "OVERDRAFT",
        "name": "Овердрафт",
        "short_description": "Короткое финансирование кассовых разрывов и текущих платежей",
        "description": "Возобновляемая кредитная линия для покрытия краткосрочных разрывов ликвидности. Проценты — только на использованную сумму.",
        "min_amount": Decimal("300000"),
        "max_amount": Decimal("15000000"),
        "min_term_months": 1,
        "max_term_months": 12,
        "rate": Decimal("16.90"),
        "min_business_age_months": 6,
        "requires_collateral": False,
        "revenue_limit_ratio": Decimal("0.250"),
        "purposes": [
            {"code": "cash_gap", "label": "Кассовые разрывы"},
            {"code": "payroll", "label": "Выплата зарплат и налогов"},
        ],
        "sort_order": 3,
    },
]


DEMO_USERS = [
    {
        "username": "client1",
        "full_name": "Смирнов Артём Владимирович",
        "role": ROLE_CLIENT,
        "company_inn": "9900000017",
    },
    {
        "username": "client2",
        "full_name": "Орлов Денис Павлович",
        "role": ROLE_CLIENT,
        "company_inn": "9900000031",
    },
    {
        # Связанное лицо: ИП принадлежит родственнице сотрудника employee3.
        # Её заявки система никогда не назначит employee3.
        "username": "client3",
        "full_name": "Кузнецова Мария Сергеевна",
        "role": ROLE_CLIENT,
        "company_inn": "990000001246",
        "related_employee": "employee3",
    },
    {
        "username": "employee1",
        "full_name": "Романова Екатерина Валерьевна",
        "role": ROLE_EMPLOYEE,
        "company_inn": None,
    },
    {
        "username": "employee2",
        "full_name": "Воронов Иван Борисович",
        "role": ROLE_EMPLOYEE,
        "company_inn": None,
    },
    {
        "username": "employee3",
        "full_name": "Белова Мария Андреевна",
        "role": ROLE_EMPLOYEE,
        "company_inn": None,
    },
    {
        "username": "admin",
        "full_name": "Соколов Михаил Андреевич",
        "role": ROLE_ADMIN,
        "company_inn": None,
    },
]


def seed() -> None:
    db = SessionLocal()
    try:
        for item in PRODUCTS:
            exists = db.scalar(select(Product).where(Product.code == item["code"]))
            if exists is None:
                db.add(Product(**item))
        if db.scalar(select(ScoringConfig).limit(1)) is None:
            config = load_default_config()
            db.add(ScoringConfig(version=int(config.get("version", 1)), config=config, is_active=True))
        if settings.seed_demo:
            for item in DEMO_USERS:
                exists = db.scalar(select(User).where(User.username == item["username"]))
                if exists is None:
                    db.add(
                        User(
                            username=item["username"],
                            full_name=item["full_name"],
                            role=item["role"],
                            company_inn=item["company_inn"],
                            password_hash=hash_password(settings.demo_password),
                        )
                    )
            db.flush()
            for item in DEMO_USERS:
                if "related_employee" in item:
                    user = db.scalar(select(User).where(User.username == item["username"]))
                    employee = db.scalar(select(User).where(User.username == item["related_employee"]))
                    if user and employee and user.related_employee_id is None:
                        user.related_employee_id = employee.id
        db.commit()
        logger.info("Seed завершён: продукты, скоринг и демонстрационные учётные записи готовы")
    except Exception:
        db.rollback()
        logger.exception("Seed завершился ошибкой")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
