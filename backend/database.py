"""
PostgreSQL async engine + session factory (SQLAlchemy 2.x).
"""
import os
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.environ["DATABASE_URL"]  # postgresql+asyncpg://user:pass@host/db

# PgBouncer in transaction mode requires prepared statements to be disabled.
# asyncpg caches prepared statements by default; setting statement_cache_size=0
# disables that cache so every connection from the pool is PgBouncer-safe.
_connect_args = {}
if os.environ.get("PGBOUNCER", "").lower() in ("1", "true", "yes"):
    _connect_args = {"statement_cache_size": 0, "prepared_statement_cache_size": 0}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,       # PgBouncer multiplexes; keep SQLAlchemy pool small
    max_overflow=10,
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def close_db() -> None:
    await engine.dispose()
