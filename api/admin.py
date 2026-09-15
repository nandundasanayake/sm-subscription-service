import os
import secrets as secrets_module
from datetime import datetime, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from jose import jwt
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models.domain_models import Application, Package, Subscription
from schemas import (
    AdminLoginRequest,
    ApplicationCreate,
    ApplicationResponse,
    PackageCreate,
    PackageUpdate,
    PackageResponse,
    SubscriptionStatusUpdate,
    SubscriptionResponse,
    TokenResponse,
)
from api.dependencies import JWT_ALGORITHM, JWT_SECRET, require_admin

# Stopgap single-account admin login — not a real user/role system.
# INSECURE DEFAULTS, must be overridden via .env before any shared deployment.
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ADMIN_TOKEN_EXPIRE_MINUTES = int(os.getenv("ADMIN_TOKEN_EXPIRE_MINUTES", "480"))

# Unauthenticated: this is where an admin token is obtained in the first place.
public_router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])

# Everything else under /api/v1/admin requires a valid admin-flagged token.
router = APIRouter(
    prefix="/api/v1/admin",
    tags=["Admin"],
    dependencies=[Depends(require_admin)],
)


@public_router.post(
    "/login",
    response_model=TokenResponse,
    summary="Admin login",
)
def admin_login(payload: AdminLoginRequest):
    """Exchange admin username/password for a JWT carrying admin claims."""
    valid_username = secrets_module.compare_digest(payload.username, ADMIN_USERNAME)
    valid_password = secrets_module.compare_digest(payload.password, ADMIN_PASSWORD)
    if not (valid_username and valid_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    expire = datetime.utcnow() + timedelta(minutes=ADMIN_TOKEN_EXPIRE_MINUTES)
    token = jwt.encode(
        {
            "sub": payload.username,
            "is_admin": True,
            "role": "admin",
            "exp": expire,
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return TokenResponse(access_token=token)


# ── Application Endpoints ──────────────────────────────────────────────────────


@router.get(
    "/applications",
    response_model=List[ApplicationResponse],
    summary="Retrieve all registered applications",
)
def get_all_applications(db: Session = Depends(get_db)):
    """Return every registered application/tenant in the system."""
    apps = db.query(Application).order_by(Application.created_at.desc()).all()
    return apps


@router.post(
    "/applications",
    response_model=ApplicationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new application",
)
def create_application(payload: ApplicationCreate, db: Session = Depends(get_db)):
    """Register a new application/tenant in the subscription service."""
    existing = (
        db.query(Application)
        .filter(Application.app_id == payload.app_id.strip())
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Application with app_id '{payload.app_id}' already exists.",
        )

    new_app = Application(
        app_id=payload.app_id.strip(),
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else None,
    )
    db.add(new_app)
    db.commit()
    db.refresh(new_app)
    return new_app


# ── Package Endpoints ──────────────────────────────────────────────────────────


@router.get(
    "/packages",
    response_model=List[PackageResponse],
    summary="Retrieve all packages",
)
def get_all_packages(
    app_id: Optional[str] = Query(None, description="Optional Application ID to filter packages"),
    db: Session = Depends(get_db),
):
    """Return every package in the system, optionally filtered by app_id."""
    query = db.query(Package)
    if app_id:
        query = query.filter(Package.app_id == app_id.strip())
    packages = query.order_by(Package.created_at.desc()).all()
    return packages


@router.post(
    "/packages",
    response_model=PackageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new package",
)
def create_package(payload: PackageCreate, db: Session = Depends(get_db)):
    """Insert a new package into the database."""
    new_package = Package(
        app_id=payload.app_id,
        name=payload.name,
        price=payload.price,
        billing_cycle=payload.billing_cycle,
        features=payload.features,
    )
    db.add(new_package)
    db.commit()
    db.refresh(new_package)
    return new_package


@router.put(
    "/packages/{package_id}",
    response_model=PackageResponse,
    summary="Update an existing package",
)
def update_package(
    package_id: UUID,
    payload: PackageUpdate,
    db: Session = Depends(get_db),
):
    """Update the fields of an existing package (only supplied fields are changed)."""
    package = db.query(Package).filter(Package.id == package_id).first()
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Package '{package_id}' not found",
        )

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(package, field, value)

    db.commit()
    db.refresh(package)
    return package


@router.delete(
    "/packages/{package_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete a package",
)
def delete_package(
    package_id: UUID,
    db: Session = Depends(get_db),
):
    """Delete a package by its ID."""
    package = db.query(Package).filter(Package.id == package_id).first()
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Package '{package_id}' not found",
        )

    try:
        # Delete associated subscriptions first to satisfy foreign key constraints
        db.query(Subscription).filter(Subscription.package_id == package_id).delete(
            synchronize_session=False
        )
        db.delete(package)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to delete package: {str(e)}",
        )

    return {"message": f"Package '{package_id}' deleted successfully"}


# ── Subscription Endpoints ─────────────────────────────────────────────────────


@router.get(
    "/subscriptions",
    response_model=List[SubscriptionResponse],
    summary="Retrieve all subscriptions",
)
def get_all_subscriptions(db: Session = Depends(get_db)):
    """Return every subscription with its related package details."""
    subscriptions = (
        db.query(Subscription)
        .options(joinedload(Subscription.package))
        .order_by(Subscription.created_at.desc())
        .all()
    )
    return subscriptions


@router.patch(
    "/subscriptions/{subscription_id}/status",
    response_model=SubscriptionResponse,
    summary="Update a subscription's status",
)
def update_subscription_status(
    subscription_id: UUID,
    payload: SubscriptionStatusUpdate,
    db: Session = Depends(get_db),
):
    """Manually change a subscription's status (e.g. PENDING → ACTIVE)."""
    subscription = (
        db.query(Subscription)
        .options(joinedload(Subscription.package))
        .filter(Subscription.id == subscription_id)
        .first()
    )
    if not subscription:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subscription '{subscription_id}' not found",
        )

    subscription.status = payload.status
    db.commit()
    db.refresh(subscription)
    return subscription
