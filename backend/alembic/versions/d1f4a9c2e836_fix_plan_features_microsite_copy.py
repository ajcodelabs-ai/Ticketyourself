"""Data fix: update seeded plan 'features' copy (Microsite -> Página).

seeds.py only inserts a SubscriptionPlan row when its code doesn't exist yet
and never updates existing rows, so the "microsite" -> "página" UI rename
never reached already-seeded environments (staging/prod). This updates the
two affected plans' `features` bullet list, but only when it still holds the
exact original text — if an admin already edited it via the plans UI, this
leaves it untouched.

Revision ID: d1f4a9c2e836
Revises: d5c2e9f3b721
Create Date: 2026-08-27
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "d1f4a9c2e836"
down_revision = "d5c2e9f3b721"
branch_labels = None
depends_on = None

PLAN_FEATURE_FIXES = [
    (
        "evento_unico",
        ["1 evento", "Hasta 200 tickets", "Microsite del evento", "Soporte por email"],
        ["1 evento", "Hasta 200 tickets", "Página del evento", "Soporte por email"],
    ),
    (
        "basico",
        [
            "Hasta 5 eventos activos",
            "Hasta 500 tickets por evento",
            "Microsite del organizador",
            "Reportes básicos",
        ],
        [
            "Hasta 5 eventos activos",
            "Hasta 500 tickets por evento",
            "Página del organizador",
            "Reportes básicos",
        ],
    ),
]


def _apply(direction: str) -> None:
    stmt = sa.text(
        """
        UPDATE subscription_plans
        SET features = CAST(:new_features AS jsonb)
        WHERE code = :code AND features = CAST(:old_features AS jsonb)
        """
    )
    bind = op.get_bind()
    for code, old_features, new_features in PLAN_FEATURE_FIXES:
        from_features, to_features = (
            (old_features, new_features) if direction == "up" else (new_features, old_features)
        )
        bind.execute(
            stmt,
            {
                "code": code,
                "old_features": json.dumps(from_features),
                "new_features": json.dumps(to_features),
            },
        )


def upgrade() -> None:
    _apply("up")


def downgrade() -> None:
    _apply("down")
