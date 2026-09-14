import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Float, DateTime, ForeignKey, Text, Enum as SAEnum
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship
import enum

from database import Base


# ── Enums ──────────────────────────────────────────────────────────────────────

class BillingCycle(str, enum.Enum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class SubscriptionStatus(str, enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUNDED = "refunded"


# ── Models ─────────────────────────────────────────────────────────────────────

class Application(Base):
    __tablename__ = "applications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id = Column(String(100), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<Application {self.app_id} – {self.name}>"


class Package(Base):
    __tablename__ = "packages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    app_id = Column(String(100), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    price = Column(Float, nullable=False)
    billing_cycle = Column(SAEnum(BillingCycle), nullable=False, default=BillingCycle.MONTHLY)
    features = Column(ARRAY(String), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    subscriptions = relationship("Subscription", back_populates="package")

    def __repr__(self):
        return f"<Package {self.name} – {self.billing_cycle.value}>"


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(255), nullable=False, index=True)
    package_id = Column(UUID(as_uuid=True), ForeignKey("packages.id"), nullable=False)
    status = Column(
        SAEnum(SubscriptionStatus),
        nullable=False,
        default=SubscriptionStatus.PENDING,
    )
    current_period_start = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    package = relationship("Package", back_populates="subscriptions")
    payments = relationship("Payment", back_populates="subscription")

    def __repr__(self):
        return f"<Subscription user={self.user_id} status={self.status.value}>"


class Payment(Base):
    __tablename__ = "payments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subscription_id = Column(
        UUID(as_uuid=True), ForeignKey("subscriptions.id"), nullable=False
    )
    amount = Column(Float, nullable=False)
    status = Column(
        SAEnum(PaymentStatus), nullable=False, default=PaymentStatus.PENDING
    )
    gateway_reference = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    subscription = relationship("Subscription", back_populates="payments")

    def __repr__(self):
        return f"<Payment {self.id} – {self.status.value}>"
