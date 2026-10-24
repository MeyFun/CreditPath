from __future__ import annotations

from tests.conftest import login, make_application, user_by_name

BODY = {
    "code": "LEASING",
    "name": "Лизинг техники",
    "short_description": "Техника в лизинг",
    "min_amount": 500000,
    "max_amount": 5000000,
    "min_term_months": 6,
    "max_term_months": 48,
    "rate": 15.5,
    "purposes": [{"code": "trucks", "label": "Грузовой транспорт"}, {"code": "tools", "label": "Станки"}],
}


def test_admin_creates_product_with_purposes(client):
    headers = login(client, "admin")
    created = client.post("/api/admin/products", headers=headers, json=BODY)
    assert created.status_code == 201, created.text
    assert [item["code"] for item in created.json()["purposes"]] == ["trucks", "tools"]
    assert client.post("/api/admin/products", headers=headers, json=BODY).status_code == 409
    public = client.get("/api/public/products").json()
    assert "LEASING" in {item["code"] for item in public}


def test_product_validation_rejects_bad_input(client):
    headers = login(client, "admin")
    assert client.post("/api/admin/products", headers=headers, json={**BODY, "code": "BAD", "purposes": []}).status_code == 422
    dup = [{"code": "a1", "label": "Первая"}, {"code": "a1", "label": "Вторая"}]
    assert client.post("/api/admin/products", headers=headers, json={**BODY, "code": "DUP", "purposes": dup}).status_code == 422
    inverted = {**BODY, "code": "INV", "min_amount": 9000000}
    assert client.post("/api/admin/products", headers=headers, json=inverted).status_code == 422


def test_non_admin_cannot_create_product(client):
    assert client.post("/api/admin/products", headers=login(client, "client1"), json=BODY).status_code == 403


def test_admin_edits_purposes_but_not_in_use(client, db):
    headers = login(client, "admin")
    product = next(item for item in client.get("/api/admin/products", headers=headers).json() if item["code"] == "OBOROT")
    used = make_application(db, user=user_by_name(db, "client1"), status="DRAFT")
    used_code = used.purpose
    purposes = product["purposes"]
    added = client.patch(
        f"/api/admin/products/{product['id']}",
        headers=headers,
        json={"purposes": [*purposes, {"code": "seasonal", "label": "Сезонные закупки"}]},
    )
    assert added.status_code == 200, added.text
    assert "seasonal" in {item["code"] for item in added.json()["purposes"]}
    without_used = [item for item in added.json()["purposes"] if item["code"] != used_code]
    blocked = client.patch(f"/api/admin/products/{product['id']}", headers=headers, json={"purposes": without_used})
    assert blocked.status_code == 409
    assert "незавершённые" in blocked.json()["detail"]


def test_admin_creates_client_with_profile_inn(client, db, monkeypatch):
    import app.api.admin as admin_api

    monkeypatch.setattr(admin_api, "fetch_registry", lambda inn: {"name": "ООО «Тест»", "director": "Иванов Иван"})
    headers = login(client, "admin")
    body = {"username": "newclient", "full_name": "Иванов Иван Иванович", "password": "Secret123", "role": "client", "company_inn": "9900000017"}
    created = client.post("/api/admin/users", headers=headers, json=body)
    assert created.status_code == 201, created.text
    assert created.json()["company_inn"] == "9900000017"
    assert client.post("/api/admin/users", headers=headers, json=body).status_code == 409
    assert login(client, "newclient", "Secret123")
    assert client.post("/api/admin/users", headers=login(client, "client1"), json={**body, "username": "x1y2z3"}).status_code == 403


def test_admin_user_validation(client):
    headers = login(client, "admin")
    weak = {"username": "weakuser", "full_name": "Слабый Пароль", "password": "12345678", "role": "client"}
    assert client.post("/api/admin/users", headers=headers, json=weak).status_code == 422
    staff_inn = {**weak, "password": "Secret123", "role": "employee", "company_inn": "9900000017"}
    assert client.post("/api/admin/users", headers=headers, json=staff_inn).status_code == 422
    bad_inn = {**weak, "password": "Secret123", "company_inn": "9900000018"}
    assert client.post("/api/admin/users", headers=headers, json=bad_inn).status_code == 422


def _new_product(client, headers, code: str) -> dict:
    created = client.post("/api/admin/products", headers=headers, json={**BODY, "code": code})
    assert created.status_code == 201, created.text
    return created.json()


def test_new_product_and_purpose_reach_client_and_pipeline(client, db, monkeypatch):
    import app.api.client as client_api

    monkeypatch.setattr(client_api, "run_pipeline", lambda *args, **kwargs: None)
    monkeypatch.setattr(client_api, "fetch_registry", lambda inn: {"name": "ООО «Северный Ветер»"})
    admin = login(client, "admin")
    product = _new_product(client, admin, "FLOW")
    customer = login(client, "client1")

    catalog = {item["code"]: item for item in client.get("/api/public/products").json()}
    assert [p["code"] for p in catalog["FLOW"]["purposes"]] == ["trucks", "tools"]

    draft = client.post("/api/client/applications", headers=customer, json={
        "product_id": product["id"], "amount": 1000000, "term_months": 12, "purpose": "tools",
        "company_inn": "9900000017", "company_name": "ООО «Северный Ветер»",
    })
    assert draft.status_code == 201, draft.text
    assert draft.json()["purpose_label"] == "Станки"
    submit = client.post(f"/api/client/applications/{draft.json()['id']}/submit", headers=customer, json={
        "signer_position": "ceo", "authority_confirmed": True, "consent_bki": True, "consent_personal_data": True,
    })
    assert submit.status_code == 202, submit.text


def test_hidden_product_disappears_for_client(client):
    admin = login(client, "admin")
    product = _new_product(client, admin, "HIDDEN")
    hidden = client.patch(f"/api/admin/products/{product['id']}", headers=admin, json={"is_active": False})
    assert hidden.status_code == 200

    assert "HIDDEN" not in {item["code"] for item in client.get("/api/public/products").json()}
    draft = client.post("/api/client/applications", headers=login(client, "client1"), json={
        "product_id": product["id"], "amount": 1000000, "term_months": 12, "purpose": "tools",
    })
    assert draft.status_code == 404


def test_admin_deletes_unused_product_but_not_used_one(client, db):
    admin = login(client, "admin")
    unused = _new_product(client, admin, "TEMP")

    removed = client.delete(f"/api/admin/products/{unused['id']}", headers=admin)
    assert removed.status_code == 204
    assert "TEMP" not in {item["code"] for item in client.get("/api/admin/products", headers=admin).json()}
    assert client.delete(f"/api/admin/products/{unused['id']}", headers=admin).status_code == 404

    make_application(db, user=user_by_name(db, "client1"), product_code="OVERDRAFT")
    overdraft = next(item for item in client.get("/api/admin/products", headers=admin).json() if item["code"] == "OVERDRAFT")
    blocked = client.delete(f"/api/admin/products/{overdraft['id']}", headers=admin)
    assert blocked.status_code == 409
    assert "Скройте" in blocked.json()["detail"]
    assert client.delete(f"/api/admin/products/{overdraft['id']}", headers=login(client, "client1")).status_code == 403
