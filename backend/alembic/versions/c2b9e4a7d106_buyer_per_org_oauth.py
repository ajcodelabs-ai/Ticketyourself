"""Per-organizer buyer emails + social login identities

Revision ID: c2b9e4a7d106
Revises: f4b8d2c1e905
Create Date: 2026-09-01
"""

import sqlalchemy as sa

from alembic import op

revision = "c2b9e4a7d106"
down_revision = "f4b8d2c1e905"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key")
    op.execute("DROP INDEX IF EXISTS ix_users_email")
    op.execute("CREATE INDEX ix_users_email ON users (email)")

    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.Text(),
        nullable=True,
    )

    # Existing buyers were global (organizer_id NULL). Attach them to the org
    # of their most recent order, then leftover rows to demo-org if it exists.
    op.execute("""
        UPDATE users AS u
        SET organizer_id = sub.organizer_id
        FROM (
            SELECT DISTINCT ON (buyer_user_id)
                buyer_user_id,
                organizer_id
            FROM ticket_orders
            WHERE buyer_user_id IS NOT NULL
            ORDER BY buyer_user_id, created_at DESC
        ) AS sub
        WHERE u.id = sub.buyer_user_id
          AND u.role = 'buyer'
          AND u.organizer_id IS NULL
        """)
    op.execute("""
        UPDATE users AS u
        SET organizer_id = (
            SELECT id FROM organizers WHERE slug = 'demo-org' LIMIT 1
        )
        WHERE u.role = 'buyer'
          AND u.organizer_id IS NULL
          AND EXISTS (SELECT 1 FROM organizers WHERE slug = 'demo-org')
        """)

    op.execute("""
        CREATE UNIQUE INDEX uq_users_platform_email
        ON users (lower(email))
        WHERE role IN ('organizer', 'super_admin')
        """)
    op.execute("""
        CREATE UNIQUE INDEX uq_users_buyer_org_email
        ON users (organizer_id, lower(email))
        WHERE role = 'buyer'
        """)

    op.create_table(
        "user_oauth_identities",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("organizer_id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("provider_subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.UniqueConstraint(
            "organizer_id",
            "provider",
            "provider_subject",
            name="uq_oauth_org_provider_sub",
        ),
    )
    op.create_index(
        "ix_user_oauth_identities_user_id",
        "user_oauth_identities",
        ["user_id"],
    )
    op.create_index(
        "ix_user_oauth_identities_organizer_id",
        "user_oauth_identities",
        ["organizer_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_user_oauth_identities_organizer_id", table_name="user_oauth_identities"
    )
    op.drop_index(
        "ix_user_oauth_identities_user_id", table_name="user_oauth_identities"
    )
    op.drop_table("user_oauth_identities")
    op.execute("DROP INDEX IF EXISTS uq_users_buyer_org_email")
    op.execute("DROP INDEX IF EXISTS uq_users_platform_email")
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.Text(),
        nullable=False,
    )
    op.execute("DROP INDEX IF EXISTS ix_users_email")
    op.execute("CREATE UNIQUE INDEX ix_users_email ON users (email)")
