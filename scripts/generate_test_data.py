#!/usr/bin/env python3
"""Генератор синтетических ИНН и данных для registry-mock / bki-mock.

Скрипт детерминированный: повторный запуск даёт те же файлы. Все ИНН валидны
по контрольной сумме и начинаются с префикса 99, чтобы подчеркнуть синтетику.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEIGHTS_10 = (2, 4, 10, 3, 5, 9, 4, 6, 8)
WEIGHTS_11 = (7, 2, 4, 10, 3, 5, 9, 4, 6, 8)
WEIGHTS_12 = (3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8)


def checksum(digits: str, weights: tuple[int, ...]) -> int:
    return (sum(int(digit) * weight for digit, weight in zip(digits, weights)) % 11) % 10


def inn10(base9: str) -> str:
    return base9 + str(checksum(base9, WEIGHTS_10))


def inn12(base10: str) -> str:
    eleventh = str(checksum(base10, WEIGHTS_11))
    twelfth = str(checksum(base10 + eleventh, WEIGHTS_12))
    return base10 + eleventh + twelfth


COMPANIES = [
    {
        "inn": inn10("990000001"),
        "name": "ООО «Северный Ветер»",
        "legal_form": "Общество с ограниченной ответственностью",
        "registration_date": "2012-04-18",
        "status": "Действующая",
        "okved": "46.73",
        "okved_name": "Торговля оптовая лесоматериалами, строительными материалами",
        "director": "Смирнов Артём Владимирович",
        "address": "г. Москва, ул. Примерная, д. 12, офис 304",
        "founders": [{"name": "Смирнов Артём Владимирович", "share": 100}],
        "authorized_capital": 1_500_000,
        "revenue": 120_000_000,
        "profit": 18_000_000,
        "employees": 84,
        "financial_year": 2025,
        "scenario": "healthy",
        "bki": {
            "current_debt": 9_500_000,
            "active_overdue": False,
            "current_overdue_amount": 0,
            "max_overdue_days": 0,
            "closed_overdue_12m": False,
            "closed_overdue_last": None,
            "credit_history_years": 11,
            "contracts_paid": 9,
            "contracts_active": 1,
        },
    },
    {
        "inn": inn10("990000002"),
        "name": "ООО «Гранит-Снаб»",
        "legal_form": "Общество с ограниченной ответственностью",
        "registration_date": "2015-09-03",
        "status": "Действующая",
        "okved": "47.52",
        "okved_name": "Торговля розничная строительными материалами",
        "director": "Мельников Олег Иванович",
        "address": "г. Екатеринбург, ул. Промышленная, д. 8",
        "founders": [{"name": "Мельников Олег Иванович", "share": 70}, {"name": "Мельникова Анна Олеговна", "share": 30}],
        "authorized_capital": 800_000,
        "revenue": 80_000_000,
        "profit": 7_000_000,
        "employees": 42,
        "financial_year": 2025,
        "scenario": "active_overdue",
        "bki": {
            "current_debt": 12_000_000,
            "active_overdue": True,
            "current_overdue_amount": 2_400_000,
            "max_overdue_days": 46,
            "closed_overdue_12m": True,
            "closed_overdue_last": "2026-02-11",
            "credit_history_years": 7,
            "contracts_paid": 4,
            "contracts_active": 2,
        },
    },
    {
        "inn": inn10("990000003"),
        "name": "ООО «Торговый Дом Волга»",
        "legal_form": "Общество с ограниченной ответственностью",
        "registration_date": "2014-06-27",
        "status": "Действующая",
        "okved": "46.49",
        "okved_name": "Торговля оптовая прочими потребительскими товарами",
        "director": "Орлов Денис Павлович",
        "address": "г. Нижний Новгород, ул. Речная, д. 21",
        "founders": [{"name": "Орлов Денис Павлович", "share": 100}],
        "authorized_capital": 1_000_000,
        "revenue": 10_000_000,
        "profit": 1_300_000,
        "employees": 18,
        "financial_year": 2025,
        "scenario": "large_amount",
        "bki": {
            "current_debt": 6_000_000,
            "active_overdue": False,
            "current_overdue_amount": 0,
            "max_overdue_days": 0,
            "closed_overdue_12m": False,
            "closed_overdue_last": None,
            "credit_history_years": 6,
            "contracts_paid": 5,
            "contracts_active": 1,
        },
    },
    {
        "inn": inn10("990000004"),
        "name": "ООО «Тихий Двор»",
        "legal_form": "Общество с ограниченной ответственностью",
        "registration_date": "2016-02-11",
        "status": "Действующая",
        "okved": "55.10",
        "okved_name": "Деятельность гостиниц и прочих мест для временного проживания",
        "director": "Лебедева Ирина Сергеевна",
        "address": "г. Казань, ул. Садовая, д. 5",
        "founders": [{"name": "Лебедева Ирина Сергеевна", "share": 100}],
        "authorized_capital": 500_000,
        "revenue": None,
        "profit": None,
        "employees": 12,
        "financial_year": 2025,
        "scenario": "no_financials",
        "bki": {
            "current_debt": 0,
            "active_overdue": False,
            "current_overdue_amount": 0,
            "max_overdue_days": 0,
            "closed_overdue_12m": False,
            "closed_overdue_last": None,
            "credit_history_years": 4,
            "contracts_paid": 2,
            "contracts_active": 0,
        },
    },
    {
        "inn": inn10("990000005"),
        "name": "ООО «Архив-Строй»",
        "legal_form": "Общество с ограниченной ответственностью",
        "registration_date": "2013-11-08",
        "status": "Ликвидирована",
        "okved": "41.20",
        "okved_name": "Строительство жилых и нежилых зданий",
        "director": "Ковалёв Пётр Андреевич",
        "address": "г. Самара, ул. Заводская, д. 3",
        "founders": [{"name": "Ковалёв Пётр Андреевич", "share": 100}],
        "authorized_capital": 300_000,
        "revenue": 15_000_000,
        "profit": 400_000,
        "employees": 0,
        "financial_year": 2024,
        "scenario": "liquidated",
        "bki": {
            "current_debt": 0,
            "active_overdue": False,
            "current_overdue_amount": 0,
            "max_overdue_days": 0,
            "closed_overdue_12m": False,
            "closed_overdue_last": None,
            "credit_history_years": 10,
            "contracts_paid": 7,
            "contracts_active": 0,
        },
    },
    {
        "inn": inn12("9900000012"),
        "name": "ИП Кузнецова Мария Сергеевна",
        "legal_form": "Индивидуальный предприниматель",
        "registration_date": "2019-07-16",
        "status": "Действующая",
        "okved": "62.01",
        "okved_name": "Разработка компьютерного программного обеспечения",
        "director": "Кузнецова Мария Сергеевна",
        "address": "г. Санкт-Петербург, ул. Невская, д. 44",
        "founders": [{"name": "Кузнецова Мария Сергеевна", "share": 100}],
        "authorized_capital": 0,
        "revenue": 25_000_000,
        "profit": 3_000_000,
        "employees": 6,
        "financial_year": 2025,
        "scenario": "individual_entrepreneur",
        "bki": {
            "current_debt": 2_000_000,
            "active_overdue": False,
            "current_overdue_amount": 0,
            "max_overdue_days": 0,
            "closed_overdue_12m": False,
            "closed_overdue_last": None,
            "credit_history_years": 6,
            "contracts_paid": 3,
            "contracts_active": 1,
        },
    },
    {
        "inn": inn10("990000006"),
        "name": "ООО «Старт Логистик»",
        "legal_form": "Общество с ограниченной ответственностью",
        "registration_date": "2025-12-10",
        "status": "Действующая",
        "okved": "49.41",
        "okved_name": "Деятельность автомобильного грузового транспорта",
        "director": "Громов Никита Андреевич",
        "address": "г. Новосибирск, ул. Транспортная, д. 17",
        "founders": [{"name": "Громов Никита Андреевич", "share": 100}],
        "authorized_capital": 200_000,
        "revenue": 5_000_000,
        "profit": 400_000,
        "employees": 4,
        "financial_year": 2025,
        "scenario": "young_company",
        "bki": {
            "current_debt": 200_000,
            "active_overdue": False,
            "current_overdue_amount": 0,
            "max_overdue_days": 0,
            "closed_overdue_12m": False,
            "closed_overdue_last": None,
            "credit_history_years": 1,
            "contracts_paid": 1,
            "contracts_active": 0,
        },
    },
    {
        "inn": inn10("990000007"),
        "name": "ООО «Удача Плюс»",
        "legal_form": "Общество с ограниченной ответственностью",
        "registration_date": "2018-08-22",
        "status": "Действующая",
        "okved": "92.00",
        "okved_name": "Деятельность по организации и проведению азартных игр и заключению пари",
        "director": "Азаров Виктор Львович",
        "address": "г. Сочи, ул. Курортная, д. 7",
        "founders": [{"name": "Азаров Виктор Львович", "share": 100}],
        "authorized_capital": 100_000,
        "revenue": 2_000_000,
        "profit": -200_000,
        "employees": 3,
        "financial_year": 2025,
        "scenario": "risky_okved",
        "bki": {
            "current_debt": 1_600_000,
            "active_overdue": False,
            "current_overdue_amount": 0,
            "max_overdue_days": 0,
            "closed_overdue_12m": True,
            "closed_overdue_last": "2026-01-20",
            "credit_history_years": 5,
            "contracts_paid": 2,
            "contracts_active": 1,
        },
    },
]

NONEXISTENT_INN = inn10("990000008")


def build_registry() -> dict[str, dict]:
    result = {}
    for company in COMPANIES:
        payload = {key: value for key, value in company.items() if key not in {"bki", "scenario"}}
        payload["is_financial_data_available"] = payload["revenue"] is not None and payload["profit"] is not None
        result[company["inn"]] = payload
    return result


def build_bki() -> dict[str, dict]:
    result = {}
    for company in COMPANIES:
        bki = dict(company["bki"])
        bki.update(
            {
                "inn": company["inn"],
                "company_name": company["name"],
                "credit_history_found": True,
                "history": [
                    {
                        "date": "2024-03-12",
                        "type": "Кредит",
                        "amount": max(500_000, bki["current_debt"] // 2),
                        "status": "Закрыт",
                    },
                    {
                        "date": "2025-11-05",
                        "type": "Кредитная линия",
                        "amount": bki["current_debt"],
                        "status": "Действует",
                    },
                ],
            }
        )
        result[company["inn"]] = bki
    return result


def main() -> None:
    registry_dir = ROOT / "mocks" / "registry"
    bki_dir = ROOT / "mocks" / "bki"
    registry_dir.mkdir(parents=True, exist_ok=True)
    bki_dir.mkdir(parents=True, exist_ok=True)
    (registry_dir / "data.json").write_text(
        json.dumps(build_registry(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (bki_dir / "data.json").write_text(
        json.dumps(build_bki(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Сценарии:")
    for company in COMPANIES:
        print(f"  {company['inn']:<14} {company['scenario']:<24} {company['name']}")
    print(f"  {NONEXISTENT_INN:<14} {'not_in_registry':<24} синтетический ИНН без записи в реестре")
    print("Готово: моки и данные обновлены.")


if __name__ == "__main__":
    main()
