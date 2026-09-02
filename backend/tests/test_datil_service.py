"""Unit tests for Dátil / SRI electronic invoice helpers."""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

from services.datil_service import (  # noqa: E402
    ambiente,
    build_emisor,
    build_invoice_payload,
    cents_to_amount,
    default_event_iva_percent,
    einvoice_config_from_registration,
    friendly_datil_error,
    infer_id_type,
    is_configured,
    iva_percent,
    mock_enabled,
    mock_issue_response,
    payment_medio,
    record_datil_exchange,
    split_iva_inclusive,
)


def test_ambiente_defaults_to_pruebas(monkeypatch):
    monkeypatch.delenv("DATIL_AMBIENTE", raising=False)
    assert ambiente() == 1
    monkeypatch.setenv("DATIL_AMBIENTE", "1")
    assert ambiente() == 1
    monkeypatch.setenv("DATIL_AMBIENTE", "2")
    assert ambiente() == 2
    monkeypatch.setenv("DATIL_AMBIENTE", "99")
    assert ambiente() == 1


def test_split_iva_inclusive_15():
    base, iva = split_iva_inclusive(1150, 15)
    assert base + iva == 1150
    assert base == 1000
    assert iva == 150


def test_split_iva_zero_percent():
    assert split_iva_inclusive(500, 0) == (500, 0)


def test_cents_to_amount():
    assert cents_to_amount(1250) == 12.5
    assert cents_to_amount(0) == 0.0


def test_infer_id_type_cedula_ruc_final():
    assert infer_id_type("1710034065") == ("05", "1710034065")
    assert infer_id_type("1790012345001") == ("04", "1790012345001")
    assert infer_id_type(None) == ("07", "9999999999999")
    assert infer_id_type("", "consumidor_final") == ("07", "9999999999999")
    assert infer_id_type("AB123456", "pasaporte") == ("06", "AB123456")
    assert infer_id_type("1710034065", "cedula") == ("05", "1710034065")
    assert infer_id_type("A12-34567", "exterior") == ("08", "A12-34567")
    assert infer_id_type("A12-34567", "08") == ("08", "A12-34567")
    assert infer_id_type("A12-34567", "identificacion del exterior") == (
        "08",
        "A12-34567",
    )


def test_payment_medio():
    assert payment_medio("nuvei") == "tarjeta_credito"
    assert payment_medio("deuna") == "tarjeta_credito"
    assert payment_medio("transfer") == "transferencia"
    assert payment_medio("cash") == "efectivo"
    assert payment_medio("unknown") == "otros"


def test_build_invoice_payload_ambiente_and_totals(monkeypatch):
    monkeypatch.setenv("DATIL_AMBIENTE", "1")
    monkeypatch.setenv("DATIL_IVA_PERCENT", "15")
    monkeypatch.setenv("DATIL_EMISOR_RUC", "0999999999001")
    monkeypatch.setenv("DATIL_EMISOR_RAZON_SOCIAL", "TYS SAS")
    monkeypatch.setenv("DATIL_EMISOR_DIRECCION", "Quito")

    payload = build_invoice_payload(
        order={
            "id": "ord-1",
            "order_number": "TYS-000001",
            "payment_method": "nuvei",
            "quantity_total": 2,
            "subtotal_cents": 2000,
            "fees_cents": 300,
            "total_cents": 2300,
            "discount_total_cents": 0,
            "buyer": {
                "name": "Ana Pérez",
                "email": "ana@example.com",
                "document_id": "1710034065",
                "document_type": "cedula",
                "phone": "0991234567",
                "address": "Av. Amazonas",
            },
            "items": [
                {
                    "ticket_type": "General",
                    "quantity": 2,
                    "unit_price_cents": 1000,
                    "subtotal_cents": 2000,
                }
            ],
        },
        event={"title": "Concierto demo"},
        sequential=7,
    )
    assert payload["ambiente"] == 1
    assert payload["tipo_emision"] == 1
    assert payload["secuencial"] == 7
    assert payload["emisor"]["ruc"] == "0999999999001"
    assert payload["comprador"]["tipo_identificacion"] == "05"
    assert payload["comprador"]["identificacion"] == "1710034065"
    assert payload["pagos"][0]["medio"] == "tarjeta_credito"
    assert len(payload["items"]) == 2  # tickets + service fee
    total = payload["totales"]["importe_total"]
    base = payload["totales"]["total_sin_impuestos"]
    iva = payload["totales"]["impuestos"][0]["valor"]
    assert round(base + iva, 2) == round(total, 2)
    assert abs(total - 23.0) < 0.02
    assert payload["totales"]["impuestos"][0]["codigo_porcentaje"] == "4"


def test_consumidor_final_payload(monkeypatch):
    monkeypatch.setenv("DATIL_AMBIENTE", "1")
    monkeypatch.setenv("DATIL_EMISOR_RUC", "0999999999001")
    payload = build_invoice_payload(
        order={
            "order_number": "TYS-9",
            "payment_method": "cash",
            "quantity_total": 1,
            "subtotal_cents": 1000,
            "fees_cents": 0,
            "total_cents": 1000,
            "buyer": {"name": "Invitado", "email": "a@b.com"},
            "items": [
                {
                    "ticket_type": "General",
                    "quantity": 1,
                    "subtotal_cents": 1000,
                }
            ],
        },
        event={"title": "Show"},
        sequential=1,
    )
    assert payload["comprador"]["tipo_identificacion"] == "07"
    assert payload["comprador"]["identificacion"] == "9999999999999"
    assert payload["pagos"][0]["medio"] == "efectivo"


def test_build_emisor_from_organizer(monkeypatch):
    monkeypatch.delenv("DATIL_EMISOR_RUC", raising=False)
    emisor = build_emisor(
        organizer={"legal_id": "1790012345001", "company_name": "Org Demo"},
        organizer_config={
            "establecimiento": "2",
            "punto_emision": "3",
            "direccion": "Guayaquil",
        },
    )
    assert emisor["ruc"] == "1790012345001"
    assert emisor["establecimiento"]["codigo"] == "002"
    assert emisor["establecimiento"]["punto_emision"] == "003"


def test_invoicing_ready_uses_organizer_ruc(monkeypatch):
    from services.einvoice_service import invoicing_ready

    monkeypatch.delenv("DATIL_MOCK", raising=False)
    monkeypatch.setenv("DATIL_API_KEY", "key")
    monkeypatch.setenv("DATIL_CERT_PASSWORD", "secret")
    monkeypatch.delenv("DATIL_EMISOR_RUC", raising=False)
    assert invoicing_ready({"legal_id": "1790012345001", "company_name": "Org"})
    assert not invoicing_ready({"legal_id": "", "company_name": "Org"})
    assert not invoicing_ready(
        {"legal_id": "1790012345001", "einvoice_config": {"enabled": False}}
    )


def test_is_configured_does_not_need_env_ruc(monkeypatch):
    monkeypatch.delenv("DATIL_MOCK", raising=False)
    monkeypatch.setenv("DATIL_API_KEY", "key")
    monkeypatch.setenv("DATIL_CERT_PASSWORD", "secret")
    monkeypatch.delenv("DATIL_EMISOR_RUC", raising=False)
    assert is_configured() is True
    monkeypatch.delenv("DATIL_API_KEY", raising=False)
    assert is_configured() is False


def test_mock_disabled_in_production(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("DATIL_MOCK", "true")
    assert mock_enabled() is False


def test_mock_issue_response_autorizado():
    data = mock_issue_response(
        {
            "secuencial": 2,
            "emisor": {
                "establecimiento": {"codigo": "001", "punto_emision": "001"}
            },
        },
        idempotency_key="order-abc",
    )
    assert data["estado"] == "AUTORIZADO"
    assert data["secuencial"] == 2
    assert data["mock"] is True
    assert data["id"].startswith("mock_")


def test_invoicing_ready_mock_without_keys(monkeypatch):
    from services.einvoice_service import invoicing_ready

    monkeypatch.setenv("ENV", "development_local")
    monkeypatch.setenv("DATIL_MOCK", "true")
    monkeypatch.delenv("DATIL_API_KEY", raising=False)
    monkeypatch.delenv("DATIL_CERT_PASSWORD", raising=False)
    monkeypatch.delenv("DATIL_EMISOR_RUC", raising=False)
    assert invoicing_ready({"legal_id": "0992547545001", "company_name": "Org"})


def test_einvoice_config_from_registration():
    cfg = einvoice_config_from_registration(
        company_name="Shows EC",
        legal_id="1790012345001",
        org_type="company",
        country_code="EC",
        legal_name="Shows Ecuador S.A.",
        legal_address="Av. Amazonas 100, Quito",
        establecimiento="2",
        punto_emision="3",
    )
    assert cfg["ruc"] == "1790012345001"
    assert cfg["razon_social"] == "Shows Ecuador S.A."
    assert cfg["direccion"] == "Av. Amazonas 100, Quito"
    assert cfg["establecimiento"] == "002"
    assert cfg["punto_emision"] == "003"
    assert cfg["iva_percent"] == 15
    assert (
        einvoice_config_from_registration(
            company_name="CO Org",
            legal_id="900123456",
            country_code="CO",
        )
        is None
    )


def test_iva_percent_prefers_event_over_env(monkeypatch):
    monkeypatch.setenv("DATIL_IVA_PERCENT", "15")
    assert iva_percent(event={"iva_percent": 0}) == 0
    assert iva_percent(organizer_config={"iva_percent": 5}) == 5
    assert default_event_iva_percent(pricing_type="paid", country_code="EC") == 15
    assert default_event_iva_percent(pricing_type="free") == 0


def test_build_invoice_payload_uses_event_iva(monkeypatch):
    monkeypatch.setenv("DATIL_AMBIENTE", "1")
    monkeypatch.setenv("DATIL_IVA_PERCENT", "15")
    payload = build_invoice_payload(
        order={
            "order_number": "TYS-IVA",
            "payment_method": "cash",
            "quantity_total": 1,
            "subtotal_cents": 1000,
            "fees_cents": 0,
            "total_cents": 1000,
            "buyer": {"name": "Ana", "email": "a@b.com", "document_id": "1710034065"},
            "items": [
                {"ticket_type": "General", "quantity": 1, "subtotal_cents": 1000}
            ],
        },
        event={"title": "Show", "iva_percent": 0},
        organizer={"legal_id": "1790012345001", "company_name": "Org"},
        sequential=1,
    )
    assert payload["totales"]["impuestos"][0]["codigo_porcentaje"] == "0"
    assert payload["emisor"]["ruc"] == "1790012345001"


def test_friendly_datil_error_punto_emision():
    body = (
        '{"errors":[{"details":"Punto de emision no existe",'
        '"message":"Punto de emision no existe","code":"INVALID_RECEIPT"}]}'
    )
    msg = friendly_datil_error(body)
    assert "punto de emisión" in msg.lower()
    assert "app.datil.co" in msg
    assert "errors" not in msg


def test_friendly_datil_error_plain_text():
    assert "clave" in friendly_datil_error("Clave de certificado inválida").lower()


def test_record_datil_exchange_redacts_secrets(tmp_path):
    payload = {
        "emisor": {"ruc": "0992547545001", "establecimiento": {"codigo": "001"}},
        "info_adicional": [{"nombre": "Orden", "valor": "TYS-000499"}],
        "secuencial": 1,
    }
    path = record_datil_exchange(
        method="POST",
        url="https://link.datil.co/invoices/issue",
        payload=payload,
        status_code=400,
        response_text='{"errors":[{"code":"INVALID_RECEIPT"}]}',
        idempotency_key="abc-secret-key",
        log_dir=tmp_path,
    )
    dumped = path.read_text(encoding="utf-8")
    assert "TYS-000499" in dumped
    assert "0992547545001" in dumped
    assert '"status_code": 400' in dumped
    assert "[redacted, sent]" in dumped
    assert "X-Password" in dumped
    assert dumped.count("abc-secret-key") == 1  # idempotency only, not as header secret
    assert path.name.endswith("_TYS-000499_400.json")
