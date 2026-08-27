"""sales_fee_rules matrix + event.platform_fee_bearer

Revision ID: a9c3e7f1b204
Revises: c8a1e4f2b017
Create Date: 2026-08-27

"""

from alembic import op
import sqlalchemy as sa

revision = "a9c3e7f1b204"
down_revision = "c8a1e4f2b017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_fee_rules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("plan_code", sa.String(40), nullable=False),
        sa.Column("pricing_type", sa.String(20), nullable=False),
        sa.Column("min_price_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_price_cents", sa.Integer(), nullable=True),
        sa.Column("fee_fixed_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fee_percent_bps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_sales_fee_rules_plan_code", "sales_fee_rules", ["plan_code"]
    )
    op.create_index(
        "ix_sales_fee_rules_lookup",
        "sales_fee_rules",
        ["plan_code", "pricing_type", "active"],
    )
    op.add_column(
        "events",
        sa.Column(
            "platform_fee_bearer",
            sa.String(20),
            nullable=False,
            server_default="buyer",
        ),
    )


def downgrade() -> None:
    op.drop_column("events", "platform_fee_bearer")
    op.drop_index("ix_sales_fee_rules_lookup", table_name="sales_fee_rules")
    op.drop_index("ix_sales_fee_rules_plan_code", table_name="sales_fee_rules")
    op.drop_table("sales_fee_rules")
