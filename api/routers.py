from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from database import get_db
from models.domain_models import Package
from schemas import SubscriptionCreate, SubscriptionResponse, PackageResponse
from repositories.sub_repository import SubscriptionRepository

router = APIRouter(prefix="/api/v1/subscriptions", tags=["Subscriptions"])
package_router = APIRouter(prefix="/api/v1/packages", tags=["Packages"])


# ── Public Package Endpoints ───────────────────────────────────────────────────


@package_router.get(
    "",
    response_model=List[PackageResponse],
    summary="Retrieve public packages",
)
def get_public_packages(
    app_id: Optional[str] = Query(None, description="Optional Application ID to filter packages (e.g. scanme)"),
    db: Session = Depends(get_db),
):
    """
    Retrieve available pricing packages.

    If `app_id` is specified, returns only packages belonging to that platform.
    If omitted/null, returns all active packages.
    """
    query = db.query(Package)
    if app_id:
        query = query.filter(Package.app_id == app_id.strip())
    return query.order_by(Package.created_at.desc()).all()


@router.post(
    "",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Initiate a subscription checkout",
)
def initiate_checkout(
    payload: SubscriptionCreate,
    db: Session = Depends(get_db),
):
    """
    Creates a new **pending** subscription for the given user and package.

    The caller should use the returned subscription ID to proceed with
    payment via the configured payment gateway.
    """
    repo = SubscriptionRepository(db)
    subscription = repo.create_pending_subscription(
        user_id=payload.user_id,
        package_id=payload.package_id,
    )
    return subscription


@router.get(
    "/{user_id}",
    response_model=List[SubscriptionResponse],
    summary="Check subscription access for a user",
)
def check_access(
    user_id: str,
    db: Session = Depends(get_db),
):
    """
    Returns **all** subscriptions for the specified user, newest first.

    Use the `status` field on each subscription to determine access:
    - `active`  → user has valid access
    - `pending` → awaiting payment confirmation
    - `expired` / `cancelled` → no access
    """
    repo = SubscriptionRepository(db)
    subscriptions = repo.get_by_user_id(user_id)
    if not subscriptions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No subscriptions found for user '{user_id}'",
        )
    return subscriptions
