"""Ecuador cédula / RUC checksum (SRI / Registro Civil).

Cédula: módulo 10, coeficientes 2-1-2-1-2-1-2-1-2.
RUC natural: cédula + establecimiento ≠ 000.
RUC privado (3er dígito 9): módulo 11, salvo secuencial extendido (≥ 1_000_000).
RUC público (3er dígito 6): módulo 11, coeficientes 3-2-7-6-5-4-3-2.

El 3er dígito de persona natural admite 0–6 (ciudades grandes). Provincia 30
= registrados en el exterior.
"""

from __future__ import annotations

import re
import unicodedata

MODULO_10_COEFFICIENTS = (2, 1, 2, 1, 2, 1, 2, 1, 2)
MODULO_11_PRIVATE = (4, 3, 2, 7, 6, 5, 4, 3, 2)
MODULO_11_PUBLIC = (3, 2, 7, 6, 5, 4, 3, 2)
FOREIGN_RESIDENT_PROVINCE = 30
_DIGITS = re.compile(r"\D")


def digits_only(value: str | None) -> str:
    return _DIGITS.sub("", value or "")


def _norm_type(document_type: str | None) -> str:
    raw = unicodedata.normalize("NFKD", document_type or "")
    stripped = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return stripped.strip().lower().replace(" ", "_")


def looks_like_ec_cedula(value: str | None) -> bool:
    return bool(value and re.fullmatch(r"\d{10}", digits_only(value)))


def is_cedula_document_type(document_type: str | None) -> bool:
    return _norm_type(document_type) in {"cedula", "05"}


def resolve_law_document_id(
    law_document_id: str | None,
    buyer_document_type: str | None,
    buyer_document_id: str | None,
) -> str:
    """Verification ID for ley discounts.

    A 10-digit foreign ID (Colombia, etc.) must not be reused as an Ecuador
    cédula just because it happens to be 10 digits.
    """
    explicit = (law_document_id or "").strip()
    if explicit:
        return explicit
    if is_cedula_document_type(buyer_document_type):
        return (buyer_document_id or "").strip()
    return ""


def _valid_province(code: int) -> bool:
    return 1 <= code <= 24 or code == FOREIGN_RESIDENT_PROVINCE


def _modulo10(first_nine: str, check: int) -> bool:
    total = 0
    for digit, coef in zip(first_nine, MODULO_10_COEFFICIENTS):
        product = int(digit) * coef
        total += product - 9 if product >= 10 else product
    expected = (10 - (total % 10)) % 10
    return expected == check


def _modulo11(initial: str, check: int, coefficients: tuple[int, ...]) -> bool:
    total = sum(int(d) * c for d, c in zip(initial, coefficients))
    remainder = total % 11
    expected = 0 if remainder == 0 else 11 - remainder
    return expected == check


def is_valid_ec_cedula(value: str | None) -> bool:
    number = digits_only(value)
    if len(number) != 10:
        return False
    province = int(number[0:2])
    if not _valid_province(province):
        return False
    third = int(number[2])
    if province != FOREIGN_RESIDENT_PROVINCE and third > 6:
        return False
    return _modulo10(number[:9], int(number[9]))


def _has_extended_private_sequential(number: str) -> bool:
    """SRI: skip módulo 11 when the 7-digit sequential is ≥ 1_000_000."""
    if number[3] == "0":
        return False
    return int(number[3:10]) >= 1_000_000


def _valid_natural_ruc(number: str) -> bool:
    third = int(number[2])
    if third > 6:
        return False
    if int(number[10:13]) < 1:
        return False
    return is_valid_ec_cedula(number[:10])


def _valid_private_ruc(number: str) -> bool:
    if int(number[2]) != 9:
        return False
    if int(number[10:13]) < 1:
        return False
    if not _valid_province(int(number[0:2])):
        return False
    if _has_extended_private_sequential(number):
        return True
    return _modulo11(number[:9], int(number[9]), MODULO_11_PRIVATE)


def _valid_public_ruc(number: str) -> bool:
    if int(number[2]) != 6:
        return False
    if int(number[9:13]) < 1:
        return False
    if not _valid_province(int(number[0:2])):
        return False
    return _modulo11(number[:8], int(number[8]), MODULO_11_PUBLIC)


def is_valid_ec_ruc(value: str | None) -> bool:
    number = digits_only(value)
    if len(number) != 13:
        return False
    if not _valid_province(int(number[0:2])):
        return False
    third = int(number[2])
    if third <= 6 and _valid_natural_ruc(number):
        return True
    if third == 6:
        return _valid_public_ruc(number)
    if third == 9:
        return _valid_private_ruc(number)
    return False


def buyer_document_error(
    document_type: str | None, document_id: str | None
) -> str | None:
    """Spanish message if cédula/RUC is invalid; None if the type is skipped."""
    kind = _norm_type(document_type)
    number = digits_only(document_id)
    if kind in {"cedula", "05"}:
        if len(number) != 10:
            return "Cédula inválida. Debe tener exactamente 10 dígitos."
        if not is_valid_ec_cedula(document_id):
            return (
                "Cédula inválida. Los 10 dígitos no pasan el dígito verificador "
                "del Registro Civil (no es una cédula ecuatoriana válida)."
            )
        return None
    if kind in {"ruc", "04"}:
        if len(number) != 13:
            return "RUC inválido. Debe tener exactamente 13 dígitos."
        if not is_valid_ec_ruc(document_id):
            return (
                "RUC inválido. Revisá el dígito verificador y el establecimiento. "
                "Persona natural: cédula ecuatoriana válida + 001."
            )
        return None
    return None


def law_document_error(
    category: str | None,
    law_document_id: str | None,
    buyer_document_type: str | None = None,
    buyer_document_id: str | None = None,
    *,
    require_document: bool = True,
) -> str | None:
    """Senior discount needs a real Ecuador cédula; foreign 10-digit IDs do not qualify."""
    cat = (category or "").strip().lower()
    if cat not in {"senior", "disability"}:
        return None
    doc = resolve_law_document_id(
        law_document_id, buyer_document_type, buyer_document_id
    )
    if cat == "senior":
        if require_document and not doc:
            return (
                "Para el descuento de tercera edad indicá una cédula ecuatoriana "
                "en el documento de verificación."
            )
        if doc and not is_valid_ec_cedula(doc):
            return (
                "Para tercera edad el documento de verificación debe ser una "
                "cédula ecuatoriana válida. Un pasaporte o ID del exterior no aplica."
            )
        return None
    if not doc:
        return (
            "Para el descuento por discapacidad indicá el número de carné "
            "CONADIS o cédula."
        )
    if is_cedula_document_type(buyer_document_type) and looks_like_ec_cedula(doc):
        if not is_valid_ec_cedula(doc):
            return "El documento de verificación no es una cédula ecuatoriana válida."
    return None
