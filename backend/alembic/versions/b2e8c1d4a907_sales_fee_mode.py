"""sales_fee_rules.fee_mode exclusive fixed|percent

Revision ID: b2e8c1d4a907
Revises: a9c3e7f1b204
Create Date: 2026-08-27

"""

from alembic import op
import sqlalchemy as sa

revision = "b2e8c1d4a907"
down_revision = "a9c3e7f1b204"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sales_fee_rules",
        sa.Column(
            "fee_mode",
            sa.String(20),
            nullable=False,
            server_default="percent",
        ),
    )
    op.execute(
        sa.text(
            """
            UPDATE sales_fee_rules
            SET fee_mode = CASE
                WHEN fee_percent_bps > 0 THEN 'percent'
                ELSE 'fixed'
            END
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE sales_fee_rules
            SET fee_fixed_cents = 0
            WHERE fee_mode = 'percent'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE sales_fee_rules
            SET fee_percent_bps = 0
            WHERE fee_mode = 'fixed'
            """
        )
    )


def downgrade() -> None:
    op.drop_column("sales_fee_rules", "fee_mode")
