from __future__ import annotations

from app.models import EnrichmentSnapshot
from app.services.news import ClientContext, personal_feed

from tests.conftest import login, make_application, user_by_name


def _titles(feed):
    return {item["title"] for item in feed}


def test_feed_differs_for_trade_ooo_and_it_ip(db):
    trade = personal_feed(db, ClientContext(opf="ООО", okved="46.73", age_months=160))
    it_ip = personal_feed(db, ClientContext(opf="ИП", okved="62.01", age_months=80))

    assert "Оптовая торговля: сезонная закупка до конца квартала" in _titles(trade)
    assert "Оптовая торговля: сезонная закупка до конца квартала" not in _titles(it_ip)
    assert "IT-компаниям: кредит на оборудование и рабочие места" in _titles(it_ip)
    assert "Для ИП: какие документы понадобятся" in _titles(it_ip)
    assert "Для ИП: какие документы понадобятся" not in _titles(trade)
    # Персональные новости идут выше общих и объясняют, почему показаны.
    assert trade[0]["personal"] is True and trade[0]["reasons"]
    assert trade[-1]["personal"] is False


def test_feed_changes_with_application_status(db):
    before = personal_feed(db, ClientContext(opf="ООО", okved="46.73"))
    after = personal_feed(db, ClientContext(opf="ООО", okved="46.73", statuses={"DISBURSED"}))
    title = "Средства перечислены: график платежей и досрочное погашение"
    assert title not in _titles(before)
    assert title in _titles(after)


def test_young_business_targeting(db):
    young = personal_feed(db, ClientContext(opf="ООО", okved="49.41", age_months=10))
    old = personal_feed(db, ClientContext(opf="ООО", okved="49.41", age_months=120))
    title = "Молодому бизнесу: с чего начать кредитную историю"
    assert title in _titles(young)
    assert title not in _titles(old)


def test_admin_publishes_targeted_news_and_client_sees_it(client, db):
    client1 = user_by_name(db, "client1")
    application = make_application(db, user=client1, status="IN_REVIEW")
    db.add(
        EnrichmentSnapshot(
            application_id=application.id,
            registry_data={"okved": "46.73", "registration_date": "2012-04-18"},
            registry_ok=True,
        )
    )
    db.commit()

    created = client.post(
        "/api/admin/news",
        headers=login(client, "admin"),
        json={
            "title": "Только для оптовиков ОКВЭД 46",
            "body": "Проверка таргетинга ленты.",
            "category": "industry",
            "targeting": {"okved_prefixes": ["46"], "opf": ["ООО"]},
        },
    )
    assert created.status_code == 201, created.text

    feed = client.get("/api/client/news", headers=login(client, "client1"))
    assert feed.status_code == 200, feed.text
    body = feed.json()
    assert body["profile"]["okved"] == "46.73"
    item = next(entry for entry in body["items"] if entry["title"] == "Только для оптовиков ОКВЭД 46")
    assert "ОКВЭД 46.73" in item["reasons"][0]

    other = client.get("/api/client/news", headers=login(client, "client3"))
    assert all(entry["title"] != "Только для оптовиков ОКВЭД 46" for entry in other.json()["items"])

    hidden = client.patch(
        f"/api/admin/news/{created.json()['id']}", headers=login(client, "admin"), json={"is_active": False}
    )
    assert hidden.status_code == 200
    feed = client.get("/api/client/news", headers=login(client, "client1")).json()
    assert all(entry["title"] != "Только для оптовиков ОКВЭД 46" for entry in feed["items"])


def test_news_targeting_validation(client):
    headers = login(client, "admin")
    bad = client.post(
        "/api/admin/news",
        headers=headers,
        json={"title": "Тест", "body": "Тест", "targeting": {"okved_prefixes": ["abc"]}},
    )
    assert bad.status_code == 422
    bad = client.post(
        "/api/admin/news",
        headers=headers,
        json={"title": "Тест", "body": "Тест", "targeting": {"products": ["NOPE"]}},
    )
    assert bad.status_code == 422
    assert client.get("/api/admin/news", headers=login(client, "client1")).status_code == 403
