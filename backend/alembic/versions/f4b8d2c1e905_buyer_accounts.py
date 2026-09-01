"""Buyer accounts: display_name/phone on users + buyer_user_id on orders

Revision ID: f4b8d2c1e905
Revises: e3a1b7c4d902
Create Date: 2026-08-31
"""

import sqlalchemy as sa

from alembic import op

revision = "f4b8d2c1e905"
down_revision = "e3a1b7c4d902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("display_name", sa.String(length=140), nullable=True)
    )
    op.add_column("users", sa.Column("phone", sa.String(length=40), nullable=True))

    op.add_column(
        "ticket_orders",
        sa.Column("buyer_user_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_ticket_orders_buyer_user_id", "ticket_orders", ["buyer_user_id"]
    )
    op.create_foreign_key(
        "fk_ticket_orders_buyer_user_id",
        "ticket_orders",
        "users",
        ["buyer_user_id"],
        ["id"],
    )

    op.add_column(
        "season_pass_purchases",
        sa.Column("buyer_user_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_season_pass_purchases_buyer_user_id",
        "season_pass_purchases",
        ["buyer_user_id"],
    )
    op.create_foreign_key(
        "fk_season_pass_purchases_buyer_user_id",
        "season_pass_purchases",
        "users",
        ["buyer_user_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_season_pass_purchases_buyer_user_id",
        "season_pass_purchases",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_season_pass_purchases_buyer_user_id", table_name="season_pass_purchases"
    )
    op.drop_column("season_pass_purchases", "buyer_user_id")

    op.drop_constraint(
        "fk_ticket_orders_buyer_user_id", "ticket_orders", type_="foreignkey"
    )
    op.drop_index("ix_ticket_orders_buyer_user_id", table_name="ticket_orders")
    op.drop_column("ticket_orders", "buyer_user_id")

    op.drop_column("users", "phone")
    op.drop_column("users", "display_name")
