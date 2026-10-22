"""Проверка и генерация синтетических ИНН.

Контрольная сумма реализована по алгоритму ФНС:
- 10 цифр (юрлицо): веса 2,4,10,3,5,9,4,6,8; цифра = (сумма mod 11) mod 10;
- 12 цифр (ИП): 11-я цифра — веса 7,2,4,10,3,5,9,4,6,8;
  12-я — веса 3,7,2,4,10,3,5,9,4,6,8; тот же mod 11 mod 10.
"""

from __future__ import annotations

from typing import Literal

WEIGHTS_10 = (2, 4, 10, 3, 5, 9, 4, 6, 8)
WEIGHTS_11 = (7, 2, 4, 10, 3, 5, 9, 4, 6, 8)
WEIGHTS_12 = (3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8)


def _checksum(digits: str, weights: tuple[int, ...]) -> int:
    return (sum(int(digit) * weight for digit, weight in zip(digits, weights)) % 11) % 10


def validate_inn(value: str | None) -> tuple[bool, str]:
    """Возвращает (валиден, человекочитаемая причина)."""
    if not value:
        return False, "Укажите ИНН"
    inn = value.strip()
    if not inn.isdigit():
        return False, "ИНН должен содержать только цифры"
    if len(inn) not in (10, 12):
        return False, "ИНН юрлица состоит из 10 цифр, ИП — из 12"
    if len(inn) == 10:
        if _checksum(inn[:9], WEIGHTS_10) != int(inn[9]):
            return False, "Неверная контрольная сумма ИНН"
        return True, ""
    first = _checksum(inn[:10], WEIGHTS_11)
    second = _checksum(inn[:11], WEIGHTS_12)
    if first != int(inn[10]) or second != int(inn[11]):
        return False, "Неверная контрольная сумма ИНН"
    return True, ""


def generate_inn(base: str, kind: Literal["legal", "individual"] = "legal") -> str:
    """Генерирует валидный синтетический ИНН из базы без контрольных цифр."""
    digits = "".join(char for char in base if char.isdigit())
    if not digits:
        raise ValueError("База ИНН должна содержать цифры")
    if kind == "legal":
        base9 = digits[:9].rjust(9, "0")
        return base9 + str(_checksum(base9, WEIGHTS_10))
    base10 = digits[:10].rjust(10, "0")
    eleventh = str(_checksum(base10, WEIGHTS_11))
    twelfth = str(_checksum(base10 + eleventh, WEIGHTS_12))
    return base10 + eleventh + twelfth
