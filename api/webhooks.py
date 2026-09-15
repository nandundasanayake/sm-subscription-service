from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models.domain_models import PaymentStatus
from schemas import DummyWebhookPayload, SubscriptionResponse
from repositories.sub_repository import SubscriptionRepository
from services.payment_provider import PaymentProvider, get_payment_provider

# Public: this is where the (dummy) payment gateway calls us back, not the
# end user's browser — there is no end-user JWT to check here. A real
# provider integration would verify the request's signature (e.g. Stripe's
# Stripe-Signature header) instead of trusting the payload outright.
router = APIRouter(prefix="/api/v1/webhooks", tags=["Webhooks"])


@router.post(
    "/dummy",
    response_model=SubscriptionResponse,
    summary="Simulate the payment gateway confirming a successful checkout",
)
def dummy_payment_webhook(
    payload: DummyWebhookPayload,
    db: Session = Depends(get_db),
    provider: PaymentProvider = Depends(get_payment_provider),
):
    """
    Stands in for a real gateway's success webhook. Given a checkout
    session id, finds the pending payment/subscription it belongs to,
    independently confirms the session actually paid via the provider's
    verify_payment (never trust the payload alone), and — if so — activates
    the subscription and sets its new billing period from the package's
    billing cycle.
    """
    repo = SubscriptionRepository(db)
    payment = repo.get_payment_by_session_id(payload.session_id)
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No checkout session found for '{payload.session_id}'",
        )

    if payment.status == PaymentStatus.COMPLETED:
        # Already processed — return the current state instead of re-activating
        # (webhooks can be retried/delivered more than once by a real gateway).
        return repo.get_by_id(payment.subscription_id)

    verification = provider.verify_payment(payload.session_id)
    if not verification.paid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Session '{payload.session_id}' has not completed payment (status: {verification.raw_status})",
        )

    subscription = repo.activate_subscription_from_payment(payment)
    if not subscription:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription for this payment no longer exists",
        )
    return subscription
