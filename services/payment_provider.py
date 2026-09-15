"""Payment provider adapter interface.

This defines the boundary between the subscription service and whatever
payment gateway actually processes money. Swapping DummyPaymentProvider for
a real Stripe/Razorpay adapter later means writing a class that implements
PaymentProvider — nothing in api/routers.py or api/webhooks.py should need
to change.
"""

import uuid
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass
class CheckoutSession:
    session_id: str
    checkout_url: str


@dataclass
class PaymentVerification:
    session_id: str
    paid: bool
    raw_status: str


class PaymentProvider(Protocol):
    """Structural interface every payment gateway adapter must satisfy."""

    def create_checkout_session(
        self, amount: float, currency: str, metadata: dict[str, Any]
    ) -> CheckoutSession:
        """Start a checkout and return where the user should be sent to pay."""
        ...

    def verify_payment(self, session_id: str) -> PaymentVerification:
        """Independently confirm a session actually paid (never trust a
        webhook payload alone — look the session up with the gateway)."""
        ...


class DummyPaymentProvider:
    """Fake gateway for local dev/testing — no real money or network calls.

    create_checkout_session mints a random session id and points the caller
    at our own mock checkout page. verify_payment always reports success
    since there's no external processor to actually check; real confirmation
    in this dummy flow instead comes from POST /api/v1/webhooks/dummy, which
    simulates the gateway's callback.
    """

    def __init__(self, base_url: str = ""):
        self.base_url = base_url.rstrip("/")

    def create_checkout_session(
        self, amount: float, currency: str, metadata: dict[str, Any]
    ) -> CheckoutSession:
        session_id = f"dummy_{uuid.uuid4().hex}"
        checkout_url = f"{self.base_url}/dummy-checkout?session_id={session_id}"
        return CheckoutSession(session_id=session_id, checkout_url=checkout_url)

    def verify_payment(self, session_id: str) -> PaymentVerification:
        return PaymentVerification(session_id=session_id, paid=True, raw_status="succeeded")


_provider = DummyPaymentProvider()


def get_payment_provider() -> PaymentProvider:
    """FastAPI dependency — the single place that decides which adapter is active."""
    return _provider
