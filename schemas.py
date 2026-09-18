from datetime import datetime
from typing import Generic, Optional, List, TypeVar
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from models.domain_models import BillingCycle, SubscriptionStatus, PaymentStatus


# ── Pagination ─────────────────────────────────────────────────────────────────

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard envelope for every paginated admin list endpoint."""
    items: List[T]
    total: int = Field(..., description="Total number of matching rows, across all pages")
    page: int = Field(..., description="1-indexed page number returned")
    size: int = Field(..., description="Max rows per page that was requested")


# ── Package Limits ─────────────────────────────────────────────────────────────
# Structured, enforceable plan limits stored in Package.limits (JSON). This is
# separate from `features`, which is just the marketing bullet list shown on
# pricing pages. In every field below, null or -1 means "unlimited".

class PhotographerLimits(BaseModel):
    """Per-photographer usage caps enforced for a subscription package."""
    max_events: Optional[int] = Field(default=None, examples=[3])
    storage_limit_gb: Optional[int] = Field(default=None, examples=[5])
    max_photos_per_event: Optional[int] = Field(default=None, examples=[100])
    event_link_expiry_days: Optional[int] = Field(default=None, examples=[7])

    @field_validator(
        "max_events", "storage_limit_gb", "max_photos_per_event", "event_link_expiry_days"
    )
    @classmethod
    def normalize_unlimited(cls, v: Optional[int]) -> Optional[int]:
        """Treat -1 as the canonical "unlimited" value, same as null."""
        return None if v is not None and v < 0 else v

    class Config:
        json_schema_extra = {
            "example": {
                "max_events": 3,
                "storage_limit_gb": 5,
                "max_photos_per_event": 100,
                "event_link_expiry_days": 7,
            }
        }


class PackageLimits(BaseModel):
    """Envelope for all limit categories attached to a package."""
    photographer_limits: PhotographerLimits = Field(default_factory=PhotographerLimits)


# ── Request Schemas ────────────────────────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    """Credentials for POST /api/v1/admin/login."""
    username: str = Field(..., min_length=1, examples=["admin"])
    password: str = Field(..., min_length=1, examples=["admin123"])

class ApplicationCreate(BaseModel):
    """Payload to register a new application/tenant."""
    app_id: str = Field(..., min_length=1, max_length=100, examples=["scanme"])
    name: str = Field(..., min_length=1, max_length=255, examples=["ScanMe Platform"])
    description: Optional[str] = Field(default=None, examples=["Core ScanMe event photography platform."])

    class Config:
        json_schema_extra = {
            "example": {
                "app_id": "scanme",
                "name": "ScanMe Platform",
                "description": "Core ScanMe event photography platform.",
            }
        }


class ApplicationUpdate(BaseModel):
    """Payload to update an existing application (all fields optional)."""
    app_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "name": "ScanMe Platform (Renamed)",
                "description": "Updated description.",
            }
        }


class SubscriptionCreate(BaseModel):
    """Payload to initiate a new subscription checkout.

    user_id is intentionally NOT part of this payload — it is derived from
    the authenticated caller's JWT (see api/dependencies.py), never trusted
    from client input.
    """
    package_id: UUID

    class Config:
        json_schema_extra = {
            "example": {
                "package_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            }
        }



class PackageCreate(BaseModel):
    """Payload to create a new package."""
    app_id: str = Field(..., min_length=1, max_length=100, examples=["scanme"])
    name: str = Field(..., min_length=1, max_length=255, examples=["Pro"])
    price: float = Field(..., ge=0, examples=[15.00])
    billing_cycle: BillingCycle = Field(default=BillingCycle.MONTHLY, examples=["monthly"])
    features: Optional[List[str]] = Field(default=None, examples=[["Unlimited events", "Custom branding"]])
    limits: PackageLimits = Field(default_factory=PackageLimits)

    class Config:
        json_schema_extra = {
            "example": {
                "app_id": "scanme",
                "name": "Enterprise",
                "price": 49.00,
                "billing_cycle": "monthly",
                "features": ["Unlimited events", "Team collaboration", "Custom API access"],
                "limits": {
                    "photographer_limits": {
                        "max_events": None,
                        "storage_limit_gb": 50,
                        "max_photos_per_event": None,
                        "event_link_expiry_days": 30,
                    }
                },
            }
        }


class PackageUpdate(BaseModel):
    """Payload to update an existing package (all fields optional)."""
    app_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    price: Optional[float] = Field(default=None, ge=0)
    billing_cycle: Optional[BillingCycle] = None
    features: Optional[List[str]] = None
    limits: Optional[PackageLimits] = None

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Pro Plus",
                "price": 19.99,
                "limits": {
                    "photographer_limits": {
                        "max_events": 10,
                        "storage_limit_gb": 20,
                        "max_photos_per_event": 500,
                        "event_link_expiry_days": 14,
                    }
                },
            }
        }


class SubscriptionStatusUpdate(BaseModel):
    """Payload to manually update a subscription's status."""
    status: SubscriptionStatus = Field(..., examples=["active"])

    class Config:
        json_schema_extra = {
            "example": {
                "status": "active",
            }
        }


class DummyWebhookPayload(BaseModel):
    """Payload for POST /api/v1/webhooks/dummy — simulates the payment
    gateway telling us a checkout session finished successfully."""
    session_id: str = Field(..., min_length=1, examples=["dummy_3f9a1c2b8e7d4a1a9c0b6e2f1a2b3c4d"])


# ── Response Schemas ───────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    """Response for POST /api/v1/admin/login."""
    access_token: str
    token_type: str = "bearer"


class ApplicationResponse(BaseModel):
    id: UUID
    app_id: str
    name: str
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PackageResponse(BaseModel):
    id: UUID
    app_id: str
    name: str
    price: float
    billing_cycle: BillingCycle
    features: Optional[List[str]] = None
    limits: PackageLimits = Field(default_factory=PackageLimits)

    class Config:
        from_attributes = True


class PaymentResponse(BaseModel):
    id: UUID
    subscription_id: UUID
    amount: float
    status: PaymentStatus
    gateway_reference: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class SubscriptionResponse(BaseModel):
    id: UUID
    user_id: str
    package_id: UUID
    status: SubscriptionStatus
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    package: Optional[PackageResponse] = None
    payments: Optional[List[PaymentResponse]] = None

    class Config:
        from_attributes = True


class CheckoutResponse(BaseModel):
    """Response for POST /api/v1/subscriptions: the pending subscription plus
    where to send the user to pay."""
    subscription: SubscriptionResponse
    checkout_url: str
    session_id: str
