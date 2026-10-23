#!/usr/bin/env python3
"""Сквозной e2e-сценарий CreditPath для запущенного docker compose.

По умолчанию обращается к http://localhost:8080/api (nginx).
При запуске внутри backend-контейнера: BASE_URL=http://localhost:8000/api.
Требуется только httpx (он есть в backend-образе).
"""

from __future__ import annotations

import os
import sys
import time
import uuid

import httpx

BASE_URL = os.getenv("E2E_BASE_URL", "http://localhost:8080/api").rstrip("/")
PASSWORD = os.getenv("E2E_PASSWORD", "DemoPass123!")
TIMEOUT = float(os.getenv("E2E_TIMEOUT", "90"))

# Подтверждения заявителя при отправке заявки.
SUBMIT_BODY = {
    "signer_position": "ceo",
    "authority_confirmed": True,
    "consent_bki": True,
    "consent_personal_data": True,
}

SCENARIOS = [
    {
        "name": "Здоровая компания",
        "inn": "9900000017",
        "product": "OBOROT",
        "amount": 3_000_000,
        "term": 24,
        "purpose": "working_capital",
        "expected": "APPROVED",
        "needs_info": False,
    },
    {
        "name": "Активная просрочка",
        "inn": "9900000024",
        "product": "OBOROT",
        "amount": 3_000_000,
        "term": 24,
        "purpose": "working_capital",
        "expected": "REJECTED",
        "needs_info": False,
    },
    {
        "name": "Сумма выше комфортной",
        "inn": "9900000031",
        "product": "OBOROT",
        "amount": 8_000_000,
        "term": 24,
        "purpose": "working_capital",
        "expected": "APPROVED_CHANGED",
        "needs_info": False,
    },
    {
        "name": "Нет финпоказателей",
        "inn": "9900000049",
        "product": "OBOROT",
        "amount": 1_500_000,
        "term": 18,
        "purpose": "working_capital",
        "expected": "APPROVED",
        "needs_info": True,
    },
    {
        "name": "Ликвидированная компания",
        "inn": "9900000056",
        "product": "OBOROT",
        "amount": 1_000_000,
        "term": 12,
        "purpose": "working_capital",
        "expected": "REJECTED",
        "needs_info": False,
    },
    {
        "name": "ИП и оборудование",
        "inn": "990000001246",
        "product": "EQUIPMENT",
        "amount": 3_000_000,
        "term": 36,
        "purpose": "equipment",
        "expected": "APPROVED",
        "needs_info": False,
        "collateral": True,
    },
    {
        "name": "Молодая компания",
        "inn": "9900000063",
        "product": "OBOROT",
        "amount": 900_000,
        "term": 24,
        "purpose": "working_capital",
        "expected": "APPROVED_CHANGED",
        "needs_info": False,
    },
    {
        "name": "Рисковый ОКВЭД",
        "inn": "9900000070",
        "product": "OBOROT",
        "amount": 1_500_000,
        "term": 18,
        "purpose": "working_capital",
        "expected": "REJECTED",
        "needs_info": False,
    },
]

NONEXISTENT_INN = "9900000088"


class E2EFailure(Exception):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise E2EFailure(message)


class Client:
    def __init__(self) -> None:
        self.http = httpx.Client(base_url=BASE_URL, timeout=30)
        self.tokens: dict[str, dict[str, str]] = {}

    def login(self, username: str) -> None:
        response = self.http.post("/auth/login", json={"username": username, "password": PASSWORD})
        check(response.status_code == 200, f"Не удалось войти как {username}: {response.status_code} {response.text}")
        self.tokens[username] = {"Authorization": f"Bearer {response.json()['access_token']}"}

    def headers(self, username: str) -> dict[str, str]:
        if username not in self.tokens:
            self.login(username)
        return self.tokens[username]

    def get(self, path: str, username: str) -> dict:
        response = self.http.get(path, headers=self.headers(username))
        check(response.status_code == 200, f"GET {path}: {response.status_code} {response.text}")
        return response.json()

    def post(self, path: str, username: str, payload: dict | None = None, headers: dict | None = None) -> dict:
        request_headers = dict(self.headers(username))
        if headers:
            request_headers.update(headers)
        response = self.http.post(path, headers=request_headers, json=payload)
        check(
            response.status_code in (200, 201, 202),
            f"POST {path}: {response.status_code} {response.text}",
        )
        return response.json()

    def close(self) -> None:
        self.http.close()


def wait_for(
    client: Client,
    application_id: int,
    statuses: set[str],
    username: str = "client1",
    timeout: float = TIMEOUT,
) -> dict:
    deadline = time.time() + timeout
    last_status = "?"
    while time.time() < deadline:
        detail = client.get(f"/client/applications/{application_id}", username)
        last_status = detail["status"]
        if last_status in statuses:
            return detail
        time.sleep(1.2)
    raise E2EFailure(f"Заявка {application_id} не достигла {statuses}, последний статус: {last_status}")


def find_employee(client: Client, application_id: int) -> tuple[str, dict]:
    deadline = time.time() + 45
    while time.time() < deadline:
        for username in ("employee1", "employee2", "employee3"):
            response = client.http.get(
                f"/employee/applications/{application_id}", headers=client.headers(username)
            )
            if response.status_code == 200:
                return username, response.json()
        time.sleep(0.8)
    raise E2EFailure(f"Заявка {application_id} не назначена ни одному демо-сотруднику")


def decide(client: Client, application_id: int, detail: dict) -> dict:
    username, employee_detail = find_employee(client, application_id)
    check(employee_detail["status"] == "IN_REVIEW", f"Заявка не в статусе IN_REVIEW у сотрудника: {employee_detail['status']}")
    draft = employee_detail.get("decision_draft") or {}
    outcome = draft.get("outcome")
    if outcome == "approve_changed":
        payload = {
            "action": "approve_changed",
            "approved_amount": draft.get("proposed_amount"),
            "approved_term_months": draft.get("proposed_term_months"),
            "comment": "E2E: условия скорректированы по прозрачным правилам.",
        }
    elif outcome == "reject":
        payload = {
            "action": "reject",
            "comment": "E2E: " + "; ".join(draft.get("reasons", ["Основания указаны в скоринге."])[:2]),
        }
    else:
        payload = {"action": "approve", "comment": "E2E: проверки пройдены, параметры подтверждены."}
    result = client.post(f"/employee/applications/{application_id}/decision", username, payload)
    check(result["status"] in {"APPROVED", "APPROVED_CHANGED", "REJECTED"}, f"Неожиданный статус решения: {result['status']}")
    return result


def run() -> None:
    client = Client()
    try:
        print(f"CreditPath e2e · {BASE_URL}")
        for username in ("client1", "employee1", "employee2", "employee3", "admin"):
            client.login(username)
        products = client.http.get("/public/products").json()
        check(len(products) == 3, f"Ожидались 3 продукта, получено {len(products)}")
        by_code = {item["code"]: item for item in products}

        missing = client.http.get(f"/public/registry/{NONEXISTENT_INN}")
        check(missing.status_code == 404, "Несуществующий ИНН должен возвращать 404 на форме")
        print(f"✓ Несуществующий ИНН {NONEXISTENT_INN}: 404 на проверке формы")

        for index, scenario in enumerate(SCENARIOS, start=1):
            print(f"\n[{index}/{len(SCENARIOS)}] {scenario['name']} · {scenario['inn']}")
            product = by_code[scenario["product"]]
            registry_response = client.http.get(f"/public/registry/{scenario['inn']}")
            check(
                registry_response.status_code == 200,
                f"Реестр не вернул компанию {scenario['inn']}: {registry_response.status_code}",
            )
            company = registry_response.json()["company"]
            payload = {
                "product_id": product["id"],
                "amount": scenario["amount"],
                "term_months": scenario["term"],
                "purpose": scenario["purpose"],
                "company_inn": scenario["inn"],
                "company_name": company["name"],
                "collateral": scenario.get("collateral", False),
            }
            application = client.post("/client/applications", "client1", payload)
            application_id = application["id"]
            if index == 1:
                pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF\n"
                upload = client.http.post(
                    f"/client/applications/{application_id}/documents",
                    headers=client.headers("client1"),
                    files={"file": ("demo-document.pdf", pdf, "application/pdf")},
                )
                check(upload.status_code == 201, f"Не удалось загрузить документ: {upload.status_code} {upload.text}")
                print("  ✓ Документ PDF загружен в черновик")
            key = uuid.uuid4().hex
            submitted = client.post(
                f"/client/applications/{application_id}/submit",
                "client1",
                SUBMIT_BODY,
                headers={"Idempotency-Key": key},
            )
            check(submitted["status"] == "SUBMITTED", "После отправки ожидался SUBMITTED")
            # Идемпотентность: повторная отправка с тем же ключом не создаёт ошибку.
            repeated = client.post(
                f"/client/applications/{application_id}/submit",
                "client1",
                SUBMIT_BODY,
                headers={"Idempotency-Key": key},
            )
            check(repeated["id"] == application_id, "Idempotency-Key вернул другую заявку")

            if scenario["needs_info"]:
                detail = wait_for(client, application_id, {"NEED_INFO", "IN_REVIEW", "APPROVED", "APPROVED_CHANGED", "REJECTED"})
                check(detail["status"] == "NEED_INFO", f"Ожидался NEED_INFO, получен {detail['status']}")
                print("  → NEED_INFO: автоматическая проверка запросила данные")
                detail = client.post(
                    f"/client/applications/{application_id}/respond",
                    "client1",
                    {
                        "comment": "E2E: добавлены финансовые показатели за 2025 год.",
                        "declared_revenue": 6_000_000,
                        "declared_profit": 800_000,
                    },
                )
                check(detail["status"] == "VALIDATION", "После ответа ожидался VALIDATION")
                detail = wait_for(client, application_id, {"IN_REVIEW", "NEED_INFO", "REJECTED"})
                check(detail["status"] == "IN_REVIEW", f"После ответа ожидался IN_REVIEW, получен {detail['status']}")
            else:
                detail = wait_for(
                    client,
                    application_id,
                    {"IN_REVIEW", "NEED_INFO", "APPROVED", "APPROVED_CHANGED", "REJECTED"},
                )

            if detail["status"] == "NEED_INFO":
                raise E2EFailure(f"Неожиданный запрос данных: {detail.get('decision_draft')}")
            if detail["status"] == "IN_REVIEW":
                final = decide(client, application_id, detail)
            else:
                # Защита от преждевременного финального статуса: решение всё равно должен фиксировать человек.
                raise E2EFailure(f"Заявка вышла из автоматического конвейера в {detail['status']} без решения сотрудника")
            final = client.get(f"/client/applications/{application_id}", "client1")
            check(
                final["status"] == scenario["expected"],
                f"Ожидался {scenario['expected']}, получен {final['status']}",
            )
            check(final["final_outcome"] is not None, "Не зафиксирован итог решения")
            print(
                f"  ✓ {final['status']} · {final['final_outcome']} · "
                f"сумма {final['approved_amount'] or final['amount']:.0f} ₽"
            )

            if index == 1:
                accepted = client.post(f"/client/applications/{application_id}/offer", "client1", {"accept": True})
                check(accepted["status"] == "OFFER_ACCEPTED", "Оферта не принята")
                signed = client.post(f"/client/applications/{application_id}/sign", "client1")
                check(signed["status"] == "SIGNED", "Договор не подписан")
                disbursed = client.post(f"/client/applications/{application_id}/disburse", "client1")
                check(disbursed["status"] == "DISBURSED", "Демо-средства не зачислены")
                print("  ✓ Оферта принята → демо-подписание → демо-зачисление")

        admin_verify = client.get("/admin/audit/verify", "admin")
        check(admin_verify["valid"] is True, "Нарушена целостность цепочки аудита")
        audit = client.get("/admin/audit?limit=5", "admin")
        check(len(audit) > 0, "Журнал аудита пуст")
        risk_audits = client.get("/admin/audit?action=application.risk_override&limit=50", "admin")
        check(len(risk_audits) > 0, "Не зафиксировано ни одного риск-исключения")
        print(
            f"\n✓ Аудит: цепочка целостна, проверено {admin_verify['checked']} записей; "
            f"риск-исключений: {len(risk_audits)}"
        )

        # Администратор не может принять кредитное решение.
        test_application = client.post(
            "/client/applications",
            "client2",
            {
                "product_id": by_code["OBOROT"]["id"],
                "amount": 1_000_000,
                "term_months": 12,
                "purpose": "working_capital",
                "company_inn": "9900000031",
                "collateral": False,
            },
        )
        forbidden = client.http.post(
            f"/employee/applications/{test_application['id']}/decision",
            headers=client.headers("admin"),
            json={"action": "approve"},
        )
        check(forbidden.status_code == 403, "Администратор не должен иметь доступ к кредитным решениям")

        # Рабочие учётки сотрудника и администратора не действуют как заявитель.
        for username in ("admin", "employee1"):
            staff_dashboard = client.http.get("/client/dashboard", headers=client.headers(username))
            check(staff_dashboard.status_code == 403, f"{username} не должен иметь клиентский кабинет")
        print("✓ Сотрудник и администратор: клиентский кабинет закрыт (403)")

        # Связанное лицо: заявка client3 никогда не назначается employee3.
        equipment = by_code["EQUIPMENT"]
        related_company = client.http.get("/public/registry/990000001246").json()["company"]
        related_application = client.post(
            "/client/applications",
            "client3",
            {
                "product_id": equipment["id"],
                "amount": 1_000_000,
                "term_months": 24,
                "purpose": equipment["purposes"][0]["code"],
                "company_inn": "990000001246",
                "company_name": related_company["name"],
                "collateral": True,
            },
        )
        client.post(
            f"/client/applications/{related_application['id']}/submit",
            "client3",
            {**SUBMIT_BODY, "signer_position": "entrepreneur"},
            headers={"Idempotency-Key": uuid.uuid4().hex},
        )
        related_status = wait_for(
            client, related_application["id"], {"IN_REVIEW", "NEED_INFO", "REJECTED"}, username="client3"
        )
        check(related_status["status"] == "IN_REVIEW", "Заявка связанного лица не дошла до рассмотрения")
        assigned_to, related_detail = find_employee(client, related_application["id"])
        check(assigned_to != "employee3", "Заявка связанного лица назначена связанному сотруднику")
        check(related_detail.get("related_party") is True, "Сотрудник не видит отметку о связанном лице")
        print(f"✓ Связанное лицо: заявка client3 назначена {assigned_to}, не employee3")

        # Персональная лента: client1 (ОКВЭД 46) и client3 (ИП, ОКВЭД 62) видят разное.
        feed1 = client.get("/client/news", "client1")
        feed3 = client.get("/client/news", "client3")
        titles1 = {item["title"] for item in feed1["items"]}
        titles3 = {item["title"] for item in feed3["items"]}
        check(titles1 != titles3, "Ленты разных клиентов не должны совпадать")
        published = client.post(
            "/admin/news",
            "admin",
            {"title": "E2E: новость для ОКВЭД 46", "body": "Проверка таргетинга.", "category": "industry",
             "targeting": {"okved_prefixes": ["46"]}},
        )
        check(
            any(item["title"] == published["title"] for item in client.get("/client/news", "client1")["items"]),
            "Новость для ОКВЭД 46 не появилась у client1",
        )
        check(
            all(item["title"] != published["title"] for item in client.get("/client/news", "client3")["items"]),
            "Новость для ОКВЭД 46 не должна попадать к client3",
        )
        print("✓ Новостная лента: персональная подборка и таргетинг администратора работают")

        print("\nE2E успешно завершён: все четыре исхода и служебные проверки пройдены.")
    finally:
        client.close()


if __name__ == "__main__":
    try:
        run()
    except E2EFailure as exc:
        print(f"\nE2E FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(f"\nE2E ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
