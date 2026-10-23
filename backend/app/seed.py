"""Идемпотентный seed: продукты, версия скоринга, демонстрационные учётные записи.

Запускается автоматически при старте контейнера после Alembic.
Повторный запуск не сбрасывает изменения администратора.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .models import NewsItem, Product, ROLE_ADMIN, ROLE_CLIENT, ROLE_EMPLOYEE, ScoringConfig, User
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


# Синтетические новости. days — сколько дней назад опубликована.
NEWS = [
    {"days": 1, "category": "general", "title": "Кабинет: статус заявки теперь обновляется сам",
     "body": "Страница заявки следит за изменениями и показывает решение сотрудника без перезагрузки.", "targeting": {}},
    {"days": 6, "category": "general", "title": "Как банк смотрит на заявку: проверка, скоринг, решение человека",
     "body": "Автоматические проверки готовят предварительную оценку, финальное решение всегда принимает сотрудник банка.", "targeting": {}},
    {"days": 2, "category": "industry", "title": "Оптовая торговля: сезонная закупка до конца квартала",
     "body": "Для компаний с ОКВЭД 46 оборотный кредит можно оформить на срок до 36 месяцев с гибким графиком под оборачиваемость склада.",
     "targeting": {"okved_prefixes": ["46"]}},
    {"days": 4, "category": "industry", "title": "Розница: как пережить кассовый разрыв в низкий сезон",
     "body": "Овердрафт закрывает краткие разрывы между выручкой и платежами поставщикам. Проценты — только на использованную сумму.",
     "targeting": {"okved_prefixes": ["47"]}},
    {"days": 3, "category": "industry", "title": "IT-компаниям: кредит на оборудование и рабочие места",
     "body": "Серверы, ноутбуки и сетевое оборудование можно взять в кредит под залог приобретаемой техники.",
     "targeting": {"okved_prefixes": ["62", "63"]}},
    {"days": 5, "category": "industry", "title": "Перевозчикам: обновление автопарка",
     "body": "Кредит на оборудование подходит для покупки коммерческого транспорта. Предмет покупки выступает залогом.",
     "targeting": {"okved_prefixes": ["49", "52"]}},
    {"days": 7, "category": "industry", "title": "Строительство: финансирование под контракт",
     "body": "Подготовьте договор с заказчиком и отчётность — это ускорит рассмотрение оборотного кредита.",
     "targeting": {"okved_prefixes": ["41", "42", "43"]}},
    {"days": 2, "category": "segment", "title": "Для ИП: какие документы понадобятся",
     "body": "Индивидуальному предпринимателю достаточно ИНН и сведений о доходах за последний год; реестровые данные подтянутся автоматически.",
     "targeting": {"opf": ["ИП"]}},
    {"days": 8, "category": "segment", "title": "Для ООО: кто может подать заявку от имени компании",
     "body": "Заявку подаёт руководитель или сотрудник с полномочиями. При отправке подтверждаются полномочия и согласие на запрос в БКИ.",
     "targeting": {"opf": ["ООО"]}},
    {"days": 3, "category": "segment", "title": "Молодому бизнесу: с чего начать кредитную историю",
     "body": "Если компании меньше двух лет, начните с небольшой суммы и короткого срока — это повышает шансы на одобрение.",
     "targeting": {"max_age_months": 24}},
    {"days": 0, "category": "application", "title": "Нужны уточнения: как быстро ответить банку",
     "body": "Ответьте на запрос в карточке заявки и приложите документы — проверки продолжатся автоматически.",
     "targeting": {"statuses": ["NEED_INFO"]}},
    {"days": 0, "category": "application", "title": "Заявка одобрена: что проверить в оферте",
     "body": "Сверьте сумму, срок, ставку и ежемесячный платёж. Оферта действует ограниченное время.",
     "targeting": {"statuses": ["APPROVED", "APPROVED_CHANGED"]}},
    {"days": 0, "category": "application", "title": "Средства перечислены: график платежей и досрочное погашение",
     "body": "График платежей доступен в карточке заявки. Досрочное погашение — без комиссии.",
     "targeting": {"statuses": ["DISBURSED"]}},
    {"days": 1, "category": "application", "title": "После отказа: как подать заявку повторно",
     "body": "Повторную заявку рассмотрит другой сотрудник. Учтите причины отказа и обновите данные.",
     "targeting": {"statuses": ["REJECTED"]}},
    {"days": 9, "category": "product", "title": "Клиентам с кредитом на оборудование: страхование залога",
     "body": "Застрахованный залог снижает риски бизнеса при поломке или утрате техники.",
     "targeting": {"products": ["EQUIPMENT"]}},
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
        if db.scalar(select(NewsItem).limit(1)) is None:
            now = datetime.now(timezone.utc)
            for item in NEWS:
                db.add(
                    NewsItem(
                        title=item["title"],
                        body=item["body"],
                        category=item["category"],
                        targeting=item["targeting"],
                        published_at=now - timedelta(days=item["days"]),
                    )
                )
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
