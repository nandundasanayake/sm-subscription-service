from datetime import datetime
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field

from models.domain_models import BillingCycle, SubscriptionStatus, PaymentStatus


# ── Request Schemas ────────────────────────────────────────────────────────────

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


class SubscriptionCreate(BaseModel):
    """Payload to initiate a new subscription checkout."""
    user_id: str
    package_id: UUID

    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user_abc123",
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

    class Config:
        json_schema_extra = {
            "example": {
                "app_id": "scanme",
                "name": "Enterprise",
                "price": 49.00,
                "billing_cycle": "monthly",
                "features": ["Unlimited events", "Team collaboration", "Custom API access"],
            }
        }


class PackageUpdate(BaseModel):
    """Payload to update an existing package (all fields optional)."""
    app_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    price: Optional[float] = Field(default=None, ge=0)
    billing_cycle: Optional[BillingCycle] = None
    features: Optional[List[str]] = None

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Pro Plus",
                "price": 19.99,
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


# ── Response Schemas ───────────────────────────────────────────────────────────

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
