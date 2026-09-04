"""electronic invoices (Dátil / SRI Ecuador)

Revision ID: d8f2a1c9e704
Revises: c2b9e4a7d106
Create Date: 2026-09-01
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "d8f2a1c9e704"
down_revision = "c2b9e4a7d106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizers", sa.Column("einvoice_config", JSONB(), nullable=True))

    op.create_table(
        "einvoice_sequences",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("issuer_key", sa.String(length=80), nullable=False),
        sa.Column("next_value", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("issuer_key", name="uq_einvoice_sequences_issuer_key"),
    )
    op.create_index(
        "ix_einvoice_sequences_issuer_key", "einvoice_sequences", ["issuer_key"]
    )

    op.create_table(
        "electronic_invoices",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("order_id", sa.String(length=36), nullable=False),
        sa.Column("organizer_id", sa.String(length=36), nullable=False),
        sa.Column("event_id", sa.String(length=36), nullable=True),
        sa.Column("datil_id", sa.String(length=80), nullable=True),
        sa.Column("clave_acceso", sa.String(length=49), nullable=True),
        sa.Column("secuencial", sa.Integer(), nullable=False),
        sa.Column("numero", sa.String(length=20), nullable=True),
        sa.Column("ambiente", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "estado", sa.String(length=30), nullable=False, server_default="PENDING"
        ),
        sa.Column("payload", JSONB(), nullable=True),
        sa.Column("datil_response", JSONB(), nullable=True),
        sa.Column("ride_url", sa.Text(), nullable=True),
        sa.Column("xml_url", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["ticket_orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organizer_id"], ["organizers.id"]),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.UniqueConstraint("order_id", name="uq_electronic_invoices_order_id"),
    )
    op.create_index(
        "ix_electronic_invoices_order_id", "electronic_invoices", ["order_id"]
    )
    op.create_index(
        "ix_electronic_invoices_organizer_id", "electronic_invoices", ["organizer_id"]
    )
    op.create_index(
        "ix_electronic_invoices_event_id", "electronic_invoices", ["event_id"]
    )
    op.create_index(
        "ix_electronic_invoices_datil_id", "electronic_invoices", ["datil_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_electronic_invoices_datil_id", table_name="electronic_invoices")
    op.drop_index("ix_electronic_invoices_event_id", table_name="electronic_invoices")
    op.drop_index(
        "ix_electronic_invoices_organizer_id", table_name="electronic_invoices"
    )
    op.drop_index("ix_electronic_invoices_order_id", table_name="electronic_invoices")
    op.drop_table("electronic_invoices")
    op.drop_index("ix_einvoice_sequences_issuer_key", table_name="einvoice_sequences")
    op.drop_table("einvoice_sequences")
    op.drop_column("organizers", "einvoice_config")
