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
