import uuid

from fastapi import APIRouter, Header, Request

from app.core.deps import DB, CurrentUser
from app.modules.payments import service
from app.modules.payments.schemas import MockCompleteRequest, PaymentOut, RazorpayVerifyRequest

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("/mine", response_model=list[PaymentOut])
async def my_payments(user: CurrentUser, db: DB) -> list[PaymentOut]:
    return await service.my_payments(db, user)


@router.post("/{payment_id}/mock/complete", response_model=PaymentOut)
async def mock_complete(payment_id: uuid.UUID, body: MockCompleteRequest, user: CurrentUser, db: DB) -> PaymentOut:
    return await service.complete_mock(db, user, payment_id, body.outcome)


@router.post("/{payment_id}/verify", response_model=PaymentOut)
async def verify(payment_id: uuid.UUID, body: RazorpayVerifyRequest, user: CurrentUser, db: DB) -> PaymentOut:
    return await service.verify_razorpay(db, user, payment_id, body)


@router.post("/webhooks/razorpay")
async def razorpay_webhook(
    request: Request,
    db: DB,
    x_razorpay_signature: str | None = Header(None),
    x_razorpay_event_id: str | None = Header(None),
) -> dict:
    await service.handle_razorpay_webhook(db, await request.body(), x_razorpay_signature, x_razorpay_event_id)
    return {"ok": True}
