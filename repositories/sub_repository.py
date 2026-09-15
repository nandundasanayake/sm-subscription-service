from datetime import datetime, timedelta
from typing import Optional, List
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from models.domain_models import (
    BillingCycle,
    Payment,
    PaymentStatus,
    Subscription,
    SubscriptionStatus,
)

# Simplified fixed-length periods for the dummy payment flow — good enough
# for testing checkout end-to-end; a real provider integration would rely on
# the gateway's own subscription/period semantics instead of approximating.
_BILLING_PERIOD_BY_CYCLE = {
    BillingCycle.MONTHLY: timedelta(days=30),
    BillingCycle.YEARLY: timedelta(days=365),
}


class SubscriptionRepository:
    """Handles all database operations for Subscription entities."""

    def __init__(self, db: Session):
        self.db = db

    # ── Create ─────────────────────────────────────────────────────────────

    def create_pending_subscription(
        self, user_id: str, package_id: UUID
    ) -> Subscription:
        """Create a new subscription with PENDING status."""
        subscription = Subscription(
            user_id=user_id,
            package_id=package_id,
            status=SubscriptionStatus.PENDING,
        )
        self.db.add(subscription)
        self.db.commit()
        self.db.refresh(subscription)
        return subscription

    # ── Read ───────────────────────────────────────────────────────────────

    def get_by_id(self, subscription_id: UUID) -> Optional[Subscription]:
        """Fetch a single subscription by its primary key."""
        return (
            self.db.query(Subscription)
            .options(joinedload(Subscription.package), joinedload(Subscription.payments))
            .filter(Subscription.id == subscription_id)
            .first()
        )

    def get_by_user_id(self, user_id: str) -> List[Subscription]:
        """Return all subscriptions for a given user, newest first."""
        return (
            self.db.query(Subscription)
            .options(joinedload(Subscription.package), joinedload(Subscription.payments))
            .filter(Subscription.user_id == user_id)
            .order_by(Subscription.created_at.desc())
            .all()
        )

    def get_active_by_user_id(self, user_id: str) -> Optional[Subscription]:
        """Return the current active subscription for a user (if any)."""
        return (
            self.db.query(Subscription)
            .options(joinedload(Subscription.package))
            .filter(
                Subscription.user_id == user_id,
                Subscription.status == SubscriptionStatus.ACTIVE,
            )
            .first()
        )

    # ── Update ─────────────────────────────────────────────────────────────

    def update_status(
        self, subscription_id: UUID, new_status: SubscriptionStatus
    ) -> Optional[Subscription]:
        """Update the status of an existing subscription."""
        subscription = self.db.query(Subscription).filter(
            Subscription.id == subscription_id
        ).first()
        if subscription:
            subscription.status = new_status
            self.db.commit()
            self.db.refresh(subscription)
        return subscription

    # ── Payments ───────────────────────────────────────────────────────────

    def create_payment_record(
        self, subscription_id: UUID, amount: float, session_id: str
    ) -> Payment:
        """Record a PENDING payment tied to a checkout session, so the
        webhook/callback can later find its subscription by session id."""
        payment = Payment(
            subscription_id=subscription_id,
            amount=amount,
            status=PaymentStatus.PENDING,
            gateway_reference=session_id,
        )
        self.db.add(payment)
        self.db.commit()
        self.db.refresh(payment)
        return payment

    def get_payment_by_session_id(self, session_id: str) -> Optional[Payment]:
        """Look up a payment by the gateway's checkout session id."""
        return (
            self.db.query(Payment)
            .filter(Payment.gateway_reference == session_id)
            .first()
        )

    def activate_subscription_from_payment(self, payment: Payment) -> Optional[Subscription]:
        """Mark a payment COMPLETED and its subscription ACTIVE, setting the
        new billing period from the package's billing cycle."""
        subscription = (
            self.db.query(Subscription)
            .options(joinedload(Subscription.package), joinedload(Subscription.payments))
            .filter(Subscription.id == payment.subscription_id)
            .first()
        )
        if not subscription:
            return None

        period_length = _BILLING_PERIOD_BY_CYCLE[subscription.package.billing_cycle]
        now = datetime.utcnow()

        subscription.status = SubscriptionStatus.ACTIVE
        subscription.current_period_start = now
        subscription.current_period_end = now + period_length
        payment.status = PaymentStatus.COMPLETED

        self.db.commit()
        self.db.refresh(subscription)
        return subscription
