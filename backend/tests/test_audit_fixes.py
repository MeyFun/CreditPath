from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from app.config import DEFAULT_JWT_SECRET, resolve_jwt_secret
from app.models import Application, Product
from app.services.scoring_config import load_default_config, validate_config
from sqlalchemy import select

from tests.conftest import login, make_application, user_by_name

SUBMIT = {"signer_position": "ceo", "authority_confirmed": True, "consent_bki": True, "consent_personal_data": True}


def test_known_or_empty_jwt_secret_is_replaced():
    assert resolve_jwt_secret("my-own-secret") == "my-own-secret"
    for value in ("", DEFAULT_JWT_SECRET):
        generated = resolve_jwt_secret(value)
        assert generated not in ("", DEFAULT_JWT_SECRET) and len(generated) >= 32


def test_stalled_pipelines_resume_after_restart(db, monkeypatch):
    import app.services.workflow as workflow

    stalled = make_application(db, user=user_by_name(db, "client1"), status="ENRICHMENT")
    finished = make_application(db, user=user_by_name(db, "client1"), status="IN_REVIEW")
    resumed: list[int] = []
    monkeypatch.setattr(workflow, "run_pipeline", lambda application_id, *args: resumed.append(application_id))

    workflow.resume_stalled_pipelines()

    assert stalled.id in resumed
    assert finished.id not in resumed


def test_broken_scoring_config_is_rejected_before_saving(client):
    config = load_default_config()
    validate_config(config)
    config["age"] = {}
    with pytest.raises(ValueError):
        validate_config(config)

    response = client.post("/api/admin/scoring-config", headers=login(client, "admin"), json={"config": config})

    assert response.status_code == 422


def test_non_numeric_scoring_weight_is_rejected():
    config = load_default_config()
    config["collateral"]["bonus"] = "много"
    with pytest.raises(ValueError):
        validate_config(config)


def test_submit_rejects_purpose_of_another_product(client, db, monkeypatch):
    import app.api.client as client_api

    monkeypatch.setattr(client_api, "run_pipeline", lambda *args, **kwargs: None)
    monkeypatch.setattr(client_api, "fetch_registry", lambda inn: {"name": "ООО «Тест»"})
    draft = make_application(db, user=user_by_name(db, "client1"))
    draft.purpose = "equipment"  # цель другого продукта: в ответе на запрос её не исправить
    db.commit()

    response = client.post(f"/api/client/applications/{draft.id}/submit", headers=login(client, "client1"), json=SUBMIT)

    assert response.status_code == 422
    db.expire_all()
    assert db.get(Application, draft.id).status == "DRAFT"


def test_changing_product_rechecks_current_purpose(client, db):
    draft = make_application(db, user=user_by_name(db, "client1"))
    equipment = db.scalar(select(Product).where(Product.code == "EQUIPMENT"))

    response = client.put(
        f"/api/client/applications/{draft.id}",
        headers=login(client, "client1"),
        json={"product_id": equipment.id},
    )

    assert response.status_code == 422


def test_client_never_receives_scoring_score(client, db):
    application = make_application(db, user=user_by_name(db, "client1"), status="IN_REVIEW", score=55)
    headers = login(client, "client1")

    detail = client.get(f"/api/client/applications/{application.id}", headers=headers).json()
    listing = client.get("/api/client/applications", headers=headers).json()

    assert detail["scoring_score"] is None
    assert all(item["scoring_score"] is None for item in listing)


def test_negative_paging_is_a_validation_error(client):
    admin = login(client, "admin")

    assert client.get("/api/admin/audit?limit=-1", headers=admin).status_code == 422
    assert client.get("/api/admin/audit?offset=-5", headers=admin).status_code == 422
    assert client.get("/api/notifications?limit=0", headers=login(client, "client1")).status_code == 422


def test_registry_lookup_requires_login(client):
    assert client.get("/api/public/registry/9900000017").status_code == 401


def test_unknown_login_is_rejected_like_wrong_password(client):
    unknown = client.post("/api/auth/login", json={"username": "nobody-here", "password": "x"})

    assert unknown.status_code == 401
    assert unknown.json()["detail"] == "Неверный логин или пароль"


def test_upload_checks_file_signature(client, db):
    draft = make_application(db, user=user_by_name(db, "client1"))
    headers = login(client, "client1")
    url = f"/api/client/applications/{draft.id}/documents"

    fake = client.post(url, headers=headers, files={"file": ("x.pdf", b"not a pdf", "application/pdf")})
    real = client.post(url, headers=headers, files={"file": ("x.pdf", b"%PDF-1.4 ok", "application/pdf")})

    assert fake.status_code == 415
    assert real.status_code == 201, real.text


def test_resubmit_of_discontinued_product_is_explained(client, db):
    rejected = make_application(db, user=user_by_name(db, "client1"), status="REJECTED", product_code="OVERDRAFT")
    product = db.get(Product, rejected.product_id)
    product.is_active = False
    db.commit()
    try:
        response = client.post(f"/api/client/applications/{rejected.id}/resubmit", headers=login(client, "client1"))
        assert response.status_code == 409
    finally:
        product.is_active = True
        db.commit()


def test_expired_offer_is_not_counted_as_approved(client, db):
    client2 = user_by_name(db, "client2")
    headers = login(client, "client2")
    before = client.get("/api/client/dashboard", headers=headers).json()
    expired = make_application(db, user=client2, status="APPROVED")
    expired.final_outcome = "approve"
    expired.approved_amount = Decimal("1000000")
    expired.offer_expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    db.commit()

    after = client.get("/api/client/dashboard", headers=headers).json()

    assert after["counts"]["approved"] == before["counts"]["approved"]
    assert after["total_approved_amount"] == before["total_approved_amount"]


def test_static_openapi_matches_application():
    """Обновить файл: python -c "import json; from app.main import app; open('../docs/openapi.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + '\n')"."""
    import json
    from pathlib import Path

    from app.main import app

    published = json.loads((Path(__file__).resolve().parents[2] / "docs" / "openapi.json").read_text(encoding="utf-8"))
    assert published == app.openapi(), "docs/openapi.json устарел: перегенерируйте его командой из docstring"
