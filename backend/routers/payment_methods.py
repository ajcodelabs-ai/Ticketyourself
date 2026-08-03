"""Payment method catalog — public list for wizard and checkout."""

from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from db_helpers import row_to_dict
from orm_models import PaymentMethodCatalog

router = APIRouter(prefix="/api/payment-methods", tags=["payment-methods"])


class PaymentMethodOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    code: str
    name: str
    kind: str
    sort_order: int
    is_active: bool
    description: Optional[str] = None


@router.get("", response_model=List[PaymentMethodOut])
async def list_payment_methods(session: AsyncSession = Depends(get_db)):
    """Active catalog entries ordered for the organizer wizard / checkout."""
    result = await session.execute(
        select(PaymentMethodCatalog)
        .where(PaymentMethodCatalog.is_active.is_(True))
        .order_by(
            PaymentMethodCatalog.sort_order.asc(), PaymentMethodCatalog.name.asc()
        )
    )
    return [PaymentMethodOut(**row_to_dict(r)) for r in result.scalars().all()]
