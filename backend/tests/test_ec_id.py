"""Ecuador cédula / RUC checksum."""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

from services.ec_id import (  # noqa: E402
    buyer_document_error,
    is_valid_ec_cedula,
    is_valid_ec_ruc,
    law_document_error,
    resolve_law_document_id,
)


def test_known_cedula():
    assert is_valid_ec_cedula("1710034065") is True
    assert is_valid_ec_cedula("1710034066") is False
    assert is_valid_ec_cedula("1234567890") is False
    assert is_valid_ec_cedula("171003406") is False


def test_cedula_third_digit_can_be_six():
    assert is_valid_ec_cedula("1760000008") is True
    assert is_valid_ec_cedula("1770000006") is False


def test_cedula_province_and_third_digit_bounds():
    assert is_valid_ec_cedula("0060000003") is False  # province 00
    assert is_valid_ec_cedula("1780000004") is False  # third digit 8


def test_natural_ruc():
    assert is_valid_ec_ruc("1710034065001") is True
    assert is_valid_ec_ruc("1710034065000") is False
    assert is_valid_ec_ruc("1760000008001") is True  # 3rd digit 6, persona natural


def test_private_ruc_extended_sequential():
    # 0992547545001 — 3er dígito 9, secuencial ≥ 1_000_000 (SRI omite módulo 11)
    assert is_valid_ec_ruc("0992547545001") is True
    assert is_valid_ec_ruc("0992547545000") is False


def test_public_ruc():
    assert is_valid_ec_ruc("1760000150001") is True
    assert is_valid_ec_ruc("1760000150000") is False


def test_buyer_document_error():
    assert buyer_document_error("cedula", "1710034065") is None
    assert buyer_document_error("cédula", "1710034065") is None
    assert "verificador" in (buyer_document_error("cedula", "1234567890") or "")
    assert "10 dígitos" in (buyer_document_error("cedula", "123") or "")
    assert buyer_document_error("ruc", "1710034065001") is None
    assert buyer_document_error("ruc", "1710034065")
    assert buyer_document_error("pasaporte", "AB123") is None
    assert buyer_document_error("exterior", "1020304050") is None
    assert buyer_document_error("consumidor_final", "") is None
    # QA numbers that look like Pichincha cédulas but fail the check digit
    assert is_valid_ec_cedula("1719205510") is False
    assert is_valid_ec_cedula("1719429053") is False


def test_law_document_does_not_reuse_foreign_id():
    assert resolve_law_document_id("", "exterior", "1020304050") == ""
    err = law_document_error("senior", "", "exterior", "1020304050")
    assert err and "cédula ecuatoriana" in err.lower()
    assert law_document_error("senior", "1710034065", "exterior", "1020304050") is None
