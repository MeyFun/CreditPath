from __future__ import annotations

import os
import uuid
from decimal import Decimal
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_creditpath.db"
os.environ["JWT_SECRET"] = "test-secret-only"
os.environ["DEMO_PASSWORD"] = "DemoPass123!"
os.environ["UPLOAD_DIR"] = ".test_uploads"
os.environ["SEED_DEMO"] = "true"
os.environ["RESUME_PIPELINES"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Application, Product, User  # noqa: E402
from app.seed import seed  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def prepared_database():
    Path(".test_uploads").mkdir(exist_ok=True)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    seed()
    yield
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    try:
        Path("test_creditpath.db").unlink(missing_ok=True)
    except PermissionError:
        pass


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def login(client: TestClient, username: str, password: str = "DemoPass123!") -> dict[str, str]:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def make_application(
    db,
    *,
    user: User,
    status: str = "DRAFT",
    assigned: User | None = None,
    previous: Application | None = None,
    product_code: str = "OBOROT",
    score: int | None = None,
) -> Application:
    product = db.scalar(select(Product).where(Product.code == product_code))
    assert product is not None
    application = Application(
        public_number=f"TEST-{uuid.uuid4().hex[:10].upper()}",
        user_id=user.id,
        product_id=product.id,
        company_inn=user.company_inn or "9900000017",
        company_name="ООО «Тестовая Компания»",
        amount=Decimal("1000000"),
        term_months=12,
        purpose=product.purposes[0]["code"],
        collateral=product.requires_collateral,
        status=status,
        assigned_employee_id=assigned.id if assigned else None,
        previous_application_id=previous.id if previous else None,
        scoring_score=score,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def user_by_name(db, username: str) -> User:
    user = db.scalar(select(User).where(User.username == username))
    assert user is not None
    return user
