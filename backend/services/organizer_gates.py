"""Shared "can this organizer publish?" gate.

Used by both the event publish endpoint (routers/events.py) and the
microsite publish endpoint (routers/microsite.py) so the plan/verification/
contract requirements can't drift out of sync between the two.
"""

from fastapi import HTTPException


def require_publish_gates(organizer: dict, *, subject: str) -> None:
    """Raise a 403 if `organizer` hasn't cleared plan/verification/contract.

    `subject` is the Spanish noun phrase for what's being published (e.g.
    "eventos" or "tu microsite"), used to keep the error copy natural.
    """
    if organizer.get("subscription_status") in (None, "none"):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "plan_not_paid",
                "message": f"Debés pagar tu plan antes de publicar {subject}.",
            },
        )
    v_status = organizer.get("verification_fee_status") or "none"
    if v_status not in ("paid", "waived"):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "verification_fee_pending",
                "message": (
                    "Debés completar el pago de verificación de cuenta "
                    "antes de publicar."
                ),
            },
        )
    if (organizer.get("contract_status") or "none") != "signed":
        raise HTTPException(
            status_code=403,
            detail={
                "error": "contract_not_signed",
                "message": f"Debés firmar el contrato (OneShot) antes de publicar {subject}.",
            },
        )
