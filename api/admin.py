import os
import secrets as secrets_module
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from jose import jwt
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models.domain_models import Application, Package, Subscription, SubscriptionStatus
from schemas import (
    AdminLoginRequest,
    ApplicationCreate,
    ApplicationUpdate,
    ApplicationResponse,
    PackageCreate,
    PackageUpdate,
    PackageResponse,
    PaginatedResponse,
    SubscriptionStatusUpdate,
    SubscriptionResponse,
    TokenResponse,
)
from api.dependencies import JWT_ALGORITHM, JWT_SECRET, require_admin


class PageParams:
    """Shared `?page=&size=` query params for every paginated admin list
    endpoint — page is 1-indexed, size is capped to keep any single request
    from pulling an unbounded number of rows."""

    def __init__(
        self,
        page: int = Query(1, ge=1, description="1-indexed page number"),
        size: int = Query(10, ge=1, le=100, description="Rows per page (max 100)"),
    ):
        self.page = page
        self.size = size

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size

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
    response_model=PaginatedResponse[ApplicationResponse],
    summary="Retrieve registered applications (paginated)",
)
def get_all_applications(
    pagination: PageParams = Depends(),
    db: Session = Depends(get_db),
):
    """Return a page of registered applications/tenants, newest first."""
    query = db.query(Application).order_by(Application.created_at.desc())
    total = query.count()
    apps = query.offset(pagination.offset).limit(pagination.size).all()
    return PaginatedResponse(items=apps, total=total, page=pagination.page, size=pagination.size)


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


@router.put(
    "/applications/{application_id}",
    response_model=ApplicationResponse,
    summary="Update an existing application",
)
def update_application(
    application_id: UUID,
    payload: ApplicationUpdate,
    db: Session = Depends(get_db),
):
    """Update the fields of an existing application (only supplied fields are changed)."""
    app_obj = db.query(Application).filter(Application.id == application_id).first()
    if not app_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application '{application_id}' not found",
        )

    update_data = payload.model_dump(exclude_unset=True)

    if "app_id" in update_data:
        new_app_id = update_data["app_id"].strip()
        clashing = (
            db.query(Application)
            .filter(Application.app_id == new_app_id, Application.id != application_id)
            .first()
        )
        if clashing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Application with app_id '{new_app_id}' already exists.",
            )
        update_data["app_id"] = new_app_id

    if "name" in update_data:
        update_data["name"] = update_data["name"].strip()

    if "description" in update_data and update_data["description"] is not None:
        update_data["description"] = update_data["description"].strip() or None

    for field, value in update_data.items():
        setattr(app_obj, field, value)

    db.commit()
    db.refresh(app_obj)
    return app_obj


@router.delete(
    "/applications/{application_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete an application",
)
def delete_application(
    application_id: UUID,
    db: Session = Depends(get_db),
):
    """Delete an application by its ID, along with every package registered
    under its `app_id` — and, transitively, their subscriptions and payments.

    Package.app_id is a loose string, not a foreign key to this table (see
    models/domain_models.py), so the database itself won't cascade a delete
    here. We reproduce that cascade manually: load each matching Package as
    an ORM object and `db.delete()` it individually (never a bulk
    `Query.delete()`, which bypasses ORM cascades entirely) so SQLAlchemy's
    unit-of-work walks Package -> Subscription -> Payment bottom-up via the
    `cascade="all, delete-orphan"` relationships already in place, leaving no
    orphaned rows behind.
    """
    app_obj = db.query(Application).filter(Application.id == application_id).first()
    if not app_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Application '{application_id}' not found",
        )

    try:
        packages = db.query(Package).filter(Package.app_id == app_obj.app_id).all()
        for package in packages:
            db.delete(package)

        # Subscription has no app_id of its own — every row is reached via
        # its (non-nullable) package_id, so the loop above already accounts
        # for all of them. Nothing to separately query here.

        db.delete(app_obj)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to delete application: {str(e)}",
        )

    return {"message": f"Application '{application_id}' deleted successfully"}


# ── Package Endpoints ──────────────────────────────────────────────────────────


@router.get(
    "/packages",
    response_model=PaginatedResponse[PackageResponse],
    summary="Retrieve packages (paginated)",
)
def get_all_packages(
    app_id: Optional[str] = Query(None, description="Optional Application ID to filter packages"),
    pagination: PageParams = Depends(),
    db: Session = Depends(get_db),
):
    """Return a page of packages, optionally filtered by app_id, newest first."""
    query = db.query(Package)
    if app_id:
        query = query.filter(Package.app_id == app_id.strip())
    query = query.order_by(Package.created_at.desc())
    total = query.count()
    packages = query.offset(pagination.offset).limit(pagination.size).all()
    return PaginatedResponse(items=packages, total=total, page=pagination.page, size=pagination.size)


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
        limits=payload.limits.model_dump(),
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
        # Package.subscriptions and Subscription.payments both cascade
        # "all, delete-orphan" (see models/domain_models.py), so deleting the
        # package alone removes its subscriptions and their payments too —
        # no manual bulk-delete needed (that used to bypass the ORM cascade
        # entirely and hit the payments_subscription_id_fkey constraint).
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
    response_model=PaginatedResponse[SubscriptionResponse],
    summary="Retrieve subscriptions (paginated)",
)
def get_all_subscriptions(
    app_id: Optional[str] = Query(None, description="Optional Application ID to filter subscriptions by their package"),
    status_filter: Optional[str] = Query(None, alias="status", description="Optional status to filter by (active, pending, cancelled, expired)"),
    pagination: PageParams = Depends(),
    db: Session = Depends(get_db),
):
    """Return a page of subscriptions with their related package details, newest first."""
    query = db.query(Subscription).options(joinedload(Subscription.package))
    if app_id:
        query = query.join(Package, Subscription.package_id == Package.id).filter(Package.app_id == app_id.strip())
    if status_filter:
        try:
            query = query.filter(Subscription.status == SubscriptionStatus(status_filter.strip().lower()))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status '{status_filter}'. Must be one of: {[s.value for s in SubscriptionStatus]}",
            )
    query = query.order_by(Subscription.created_at.desc())
    total = query.count()
    subscriptions = query.offset(pagination.offset).limit(pagination.size).all()
    return PaginatedResponse(items=subscriptions, total=total, page=pagination.page, size=pagination.size)


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
