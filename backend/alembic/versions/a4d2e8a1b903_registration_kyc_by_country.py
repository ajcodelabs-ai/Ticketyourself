"""registration KYC by country

Revision ID: a4d2e8a1b903
Revises: f3c1a8b2d904
Create Date: 2026-08-08 13:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a4d2e8a1b903"
down_revision: Union[str, Sequence[str], None] = "f3c1a8b2d904"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "registration_countries",
        sa.Column("code", sa.String(length=2), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "requires_compliance",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("legal_id_label", sa.String(length=80), nullable=True),
        sa.Column("legal_id_pattern", sa.String(length=120), nullable=True),
        sa.Column("form_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "compliance_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.PrimaryKeyConstraint("code"),
    )

    op.add_column(
        "organizers",
        sa.Column("country_code", sa.String(length=2), nullable=False, server_default="EC"),
    )
    op.add_column(
        "organizers",
        sa.Column("social_links", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "organizers",
        sa.Column("is_pep", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("organizers", sa.Column("pep_details", sa.Text(), nullable=True))
    op.add_column(
        "organizers",
        sa.Column(
            "uafe_declaration", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
    )
    op.add_column(
        "organizers",
        sa.Column(
            "org_references", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
    )
    op.add_column(
        "organizers", sa.Column("signup_plan_code", sa.String(length=40), nullable=True)
    )

    # Migrate required_document_sets: org_type PK → (country_code, org_type)
    op.add_column(
        "required_document_sets",
        sa.Column("country_code", sa.String(length=2), nullable=True),
    )
    op.execute("UPDATE required_document_sets SET country_code = '*'")
    op.alter_column(
        "required_document_sets",
        "country_code",
        existing_type=sa.String(length=2),
        nullable=False,
    )
    op.drop_constraint(
        "required_document_sets_pkey", "required_document_sets", type_="primary"
    )
    op.create_primary_key(
        "required_document_sets_pkey",
        "required_document_sets",
        ["country_code", "org_type"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "required_document_sets_pkey", "required_document_sets", type_="primary"
    )
    op.drop_column("required_document_sets", "country_code")
    op.create_primary_key(
        "required_document_sets_pkey", "required_document_sets", ["org_type"]
    )

    op.drop_column("organizers", "signup_plan_code")
    op.drop_column("organizers", "org_references")
    op.drop_column("organizers", "uafe_declaration")
    op.drop_column("organizers", "pep_details")
    op.drop_column("organizers", "is_pep")
    op.drop_column("organizers", "social_links")
    op.drop_column("organizers", "country_code")
    op.drop_table("registration_countries")
