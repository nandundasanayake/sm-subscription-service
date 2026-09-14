from typing import Optional, List
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from models.domain_models import Subscription, SubscriptionStatus


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
