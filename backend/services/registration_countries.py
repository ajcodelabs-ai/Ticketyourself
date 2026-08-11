"""
Registration countries / jurisdictions — admin-configurable KYC settings.

Public list (active only) used by /registro; full CRUD for super_admin.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orm_models import RegistrationCountry

# Sensible Ecuador UAFE / PEP / references seed (editable by admin).
EC_COMPLIANCE_SCHEMA: Dict[str, Any] = {
    "pep": {
        "label": "Persona políticamente expuesta (PEP)",
        "description": (
            "Indica si tú o un familiar cercano ocupa o ha ocupado un cargo "
            "público relevante."
        ),
        "require_details_if_true": True,
    },
    "uafe": {
        "label": "Declaración UAFE",
        "description": (
            "Declaración de origen de fondos y conocimiento de obligaciones "
            "frente a la UAFE (Ecuador)."
        ),
        "fields": [
            {
                "key": "funds_origin_declared",
                "type": "boolean",
                "label": "Declaro que los fondos provienen de actividades lícitas",
                "required": True,
            },
            {
                "key": "funds_origin_detail",
                "type": "text",
                "label": "Descripción del origen de los fondos",
                "required": True,
            },
            {
                "key": "accepts_uafe_obligations",
                "type": "boolean",
                "label": "Acepto las obligaciones de prevención de lavado de activos",
                "required": True,
            },
        ],
    },
    "references": {
        "label": "Referencias",
        "description": "Al menos una referencia comercial o personal.",
        "min_count": 1,
        "max_count": 5,
        "fields": [
            {"key": "name", "type": "text", "label": "Nombre", "required": True},
            {"key": "phone", "type": "text", "label": "Teléfono", "required": True},
            {
                "key": "relation",
                "type": "text",
                "label": "Relación / cargo",
                "required": False,
            },
        ],
    },
}

EC_FORM_SCHEMA: Dict[str, Any] = {
    "sections": ["identity", "contact", "social", "compliance"],
    "social_fields": ["instagram", "facebook", "tiktok", "x", "website"],
}

DEFAULT_COUNTRIES: List[Dict[str, Any]] = [
    {
        "code": "EC",
        "name": "Ecuador",
        "is_active": True,
        "requires_compliance": True,
        "legal_id_label": "RUC / Cédula",
        "legal_id_pattern": r"^(\d{10}|\d{13})$",
        "form_schema": EC_FORM_SCHEMA,
        "compliance_schema": EC_COMPLIANCE_SCHEMA,
        "sort_order": 0,
    },
    {
        "code": "CO",
        "name": "Colombia",
        "is_active": True,
        "requires_compliance": False,
        "legal_id_label": "NIT / Cédula",
        "legal_id_pattern": None,
        "form_schema": {
            "sections": ["identity", "contact", "social"],
            "social_fields": ["instagram", "facebook", "tiktok", "x", "website"],
        },
        "compliance_schema": None,
        "sort_order": 10,
    },
    {
        "code": "PE",
        "name": "Perú",
        "is_active": True,
        "requires_compliance": False,
        "legal_id_label": "RUC / DNI",
        "legal_id_pattern": None,
        "form_schema": {
            "sections": ["identity", "contact", "social"],
            "social_fields": ["instagram", "facebook", "tiktok", "x", "website"],
        },
        "compliance_schema": None,
        "sort_order": 20,
    },
    {
        "code": "MX",
        "name": "México",
        "is_active": True,
        "requires_compliance": False,
        "legal_id_label": "RFC / CURP",
        "legal_id_pattern": None,
        "form_schema": {
            "sections": ["identity", "contact", "social"],
            "social_fields": ["instagram", "facebook", "tiktok", "x", "website"],
        },
        "compliance_schema": None,
        "sort_order": 30,
    },
    {
        "code": "US",
        "name": "Estados Unidos",
        "is_active": True,
        "requires_compliance": False,
        "legal_id_label": "Tax ID / SSN (últimos 4)",
        "legal_id_pattern": None,
        "form_schema": {
            "sections": ["identity", "contact", "social"],
            "social_fields": ["instagram", "facebook", "tiktok", "x", "website"],
        },
        "compliance_schema": None,
        "sort_order": 40,
    },
]


def _row_to_dict(row: RegistrationCountry) -> Dict[str, Any]:
    return {
        "code": row.code,
        "name": row.name,
        "is_active": row.is_active,
        "requires_compliance": row.requires_compliance,
        "legal_id_label": row.legal_id_label,
        "legal_id_pattern": row.legal_id_pattern,
        "form_schema": row.form_schema,
        "compliance_schema": row.compliance_schema,
        "sort_order": row.sort_order,
        "updated_at": row.updated_at,
        "updated_by": row.updated_by,
    }


async def list_countries(
    session: AsyncSession, *, active_only: bool = False
) -> List[Dict[str, Any]]:
    stmt = select(RegistrationCountry).order_by(
        RegistrationCountry.sort_order, RegistrationCountry.name
    )
    if active_only:
        stmt = stmt.where(RegistrationCountry.is_active.is_(True))
    result = await session.execute(stmt)
    return [_row_to_dict(r) for r in result.scalars().all()]


async def get_country(
    session: AsyncSession, code: str
) -> Optional[RegistrationCountry]:
    return await session.get(RegistrationCountry, code.upper().strip())


async def get_country_or_404(session: AsyncSession, code: str) -> RegistrationCountry:
    row = await get_country(session, code)
    if not row:
        raise HTTPException(404, f"Country '{code}' not found")
    return row


async def upsert_country(
    session: AsyncSession,
    code: str,
    data: Dict[str, Any],
    admin_id: Optional[str] = None,
) -> Dict[str, Any]:
    code = code.upper().strip()
    if len(code) != 2:
        raise HTTPException(400, "country code must be ISO-2")
    row = await session.get(RegistrationCountry, code)
    now = datetime.now(timezone.utc)
    allowed = {
        "name",
        "is_active",
        "requires_compliance",
        "legal_id_label",
        "legal_id_pattern",
        "form_schema",
        "compliance_schema",
        "sort_order",
    }
    if row is None:
        name = data.get("name")
        if not name:
            raise HTTPException(400, "name is required")
        row = RegistrationCountry(
            code=code,
            name=str(name).strip(),
            is_active=bool(data.get("is_active", True)),
            requires_compliance=bool(data.get("requires_compliance", False)),
            legal_id_label=data.get("legal_id_label"),
            legal_id_pattern=data.get("legal_id_pattern"),
            form_schema=data.get("form_schema"),
            compliance_schema=data.get("compliance_schema"),
            sort_order=int(data.get("sort_order") or 0),
            updated_at=now,
            updated_by=admin_id,
        )
        session.add(row)
    else:
        for key, val in data.items():
            if key in allowed and val is not None:
                setattr(row, key, val)
        row.updated_at = now
        row.updated_by = admin_id
    await session.flush()
    return _row_to_dict(row)


def validate_compliance_payload(
    country: RegistrationCountry,
    *,
    is_pep: bool,
    pep_details: Optional[str],
    uafe_declaration: Optional[Dict[str, Any]],
    org_references: Optional[List[Dict[str, Any]]],
) -> None:
    """Raise HTTPException if compliance required and payload incomplete."""
    if not country.requires_compliance:
        return
    schema = country.compliance_schema or {}

    pep_cfg = schema.get("pep") or {}
    if pep_cfg.get("require_details_if_true") and is_pep:
        if not (pep_details or "").strip():
            raise HTTPException(400, "pep_details is required when is_pep is true")

    uafe_cfg = schema.get("uafe") or {}
    fields = uafe_cfg.get("fields") or []
    if fields:
        if not isinstance(uafe_declaration, dict):
            raise HTTPException(400, "uafe_declaration is required for this country")
        for field in fields:
            if not field.get("required"):
                continue
            key = field["key"]
            val = uafe_declaration.get(key)
            if field.get("type") == "boolean":
                if val is not True:
                    raise HTTPException(400, f"uafe_declaration.{key} must be true")
            elif not (isinstance(val, str) and val.strip()):
                raise HTTPException(400, f"uafe_declaration.{key} is required")

    refs_cfg = schema.get("references") or {}
    min_count = int(refs_cfg.get("min_count") or 0)
    if min_count > 0:
        refs = org_references or []
        if len(refs) < min_count:
            raise HTTPException(
                400, f"At least {min_count} reference(s) required for this country"
            )
        for i, ref in enumerate(refs):
            if not isinstance(ref, dict):
                raise HTTPException(400, f"references[{i}] must be an object")
            for field in refs_cfg.get("fields") or []:
                if (
                    field.get("required")
                    and not str(ref.get(field["key"]) or "").strip()
                ):
                    raise HTTPException(
                        400, f"references[{i}].{field['key']} is required"
                    )
