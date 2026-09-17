import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from database import get_db
from models.domain_models import Package, SubscriptionStatus
from schemas import CheckoutResponse, SubscriptionCreate, SubscriptionResponse, PackageResponse
from repositories.sub_repository import SubscriptionRepository
from api.dependencies import get_current_user_id
from services.payment_provider import PaymentProvider, get_payment_provider

router = APIRouter(prefix="/api/v1/subscriptions", tags=["Subscriptions"])
package_router = APIRouter(prefix="/api/v1/packages", tags=["Packages"])

# A fixed, arbitrary namespace UUID (not tied to any real DNS/URL) used only
# to derive deterministic ids for virtual subscriptions below.
_VIRTUAL_SUBSCRIPTION_NAMESPACE = uuid.UUID("6f6a6e7e-0000-4000-8000-76697274756c")


def _get_free_package(db: Session) -> Optional[Package]:
    """The package that backs the Free tier for users with no active
    subscription. Prefers a package literally named "Free"; falls back to
    the cheapest $0 package if none is named that. Not app_id-scoped — there
    is no app context on a bare user_id today, only one app ("scanme")
    exists, and every consumer of this only reads .package.limits, so this
    is fine until real multi-tenant Free tiers are needed."""
    return (
        db.query(Package)
        .filter(Package.name.ilike("free"))
        .order_by(Package.created_at.asc())
        .first()
        or db.query(Package)
        .filter(Package.price == 0)
        .order_by(Package.created_at.asc())
        .first()
    )


def _build_virtual_free_subscription(user_id: str, free_package: Package) -> SubscriptionResponse:
    """A subscription that doesn't exist as a `subscriptions` row — synthesized
    so that a user who never bought anything still gets a real, active
    subscription back with a real package attached, driving their Free-tier
    limits entirely from that package's `limits` in the database instead of
    a number hardcoded in every consuming service."""
    now = datetime.utcnow()
    return SubscriptionResponse(
        id=uuid.uuid5(_VIRTUAL_SUBSCRIPTION_NAMESPACE, f"virtual-free:{user_id}"),
        user_id=user_id,
        package_id=free_package.id,
        status=SubscriptionStatus.ACTIVE,
        current_period_start=None,
        current_period_end=None,
        created_at=now,
        updated_at=now,
        package=PackageResponse.model_validate(free_package),
    )


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
    response_model=CheckoutResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Initiate a subscription checkout",
)
def initiate_checkout(
    payload: SubscriptionCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
    provider: PaymentProvider = Depends(get_payment_provider),
):
    """
    Creates a new **pending** subscription for the authenticated user and
    package, opens a checkout session with the configured payment provider,
    and returns where to send the user to pay.

    The subscription only moves from PENDING to ACTIVE once the gateway
    confirms payment — for the dummy provider, that happens via
    POST /api/v1/webhooks/dummy.
    """
    package = db.query(Package).filter(Package.id == payload.package_id).first()
    if not package:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Package '{payload.package_id}' not found",
        )

    repo = SubscriptionRepository(db)
    subscription = repo.create_pending_subscription(
        user_id=user_id,
        package_id=payload.package_id,
    )

    checkout = provider.create_checkout_session(
        amount=package.price,
        currency="usd",
        metadata={"subscription_id": str(subscription.id), "user_id": user_id},
    )
    repo.create_payment_record(
        subscription_id=subscription.id,
        amount=package.price,
        session_id=checkout.session_id,
    )

    subscription = repo.get_by_id(subscription.id)  # reload with package/payments populated

    return CheckoutResponse(
        subscription=SubscriptionResponse.model_validate(subscription),
        checkout_url=checkout.checkout_url,
        session_id=checkout.session_id,
    )


@router.get(
    "/{user_id}",
    response_model=List[SubscriptionResponse],
    summary="Check subscription access for a user",
)
def check_access(
    user_id: str,
    db: Session = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    Returns **all** subscriptions for the specified user, newest first.

    The `user_id` path value is never trusted for the lookup itself — the
    authenticated caller (from the JWT) must match it, or the request is
    rejected. This prevents one user from reading another user's subscriptions.

    Use the `status` field on each subscription to determine access:
    - `active`  → user has valid access
    - `pending` → awaiting payment confirmation
    - `expired` / `cancelled` → no access

    If none of the user's subscriptions are `active` (including having none
    at all), this never 404s — it synthesizes a *virtual* subscription
    against whatever package is configured as the Free tier and puts it
    first in the list, so every caller always gets a real, active package to
    read limits from (the Free tier's limits then live entirely in that
    package's `limits` column, not as a hardcoded fallback in every
    consuming service). A 404 is only raised in the genuinely broken case
    where the user has no subscriptions *and* no Free package is configured
    at all.
    """
    if user_id != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You may only view your own subscriptions",
        )

    repo = SubscriptionRepository(db)
    subscriptions = repo.get_by_user_id(current_user_id)

    if any(s.status == SubscriptionStatus.ACTIVE for s in subscriptions):
        return subscriptions

    free_package = _get_free_package(db)
    if not free_package:
        if subscriptions:
            return subscriptions
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No subscriptions found for user '{current_user_id}', "
                "and no default Free package is configured"
            ),
        )

    virtual = _build_virtual_free_subscription(current_user_id, free_package)
    return [virtual, *subscriptions]
