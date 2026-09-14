import uuid
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import engine, Base, SessionLocal
from models.domain_models import Application, Package, BillingCycle
from api.routers import router as subscription_router, package_router
from api.admin import router as admin_router

# Create all tables on startup (dev convenience – use Alembic for production)
Base.metadata.create_all(bind=engine)


def seed_database():
    """Seed initial application and package data into the database if not present."""
    db = SessionLocal()
    try:
        # Seed default Application
        existing_app = db.query(Application).filter(Application.app_id == "scanme").first()
        if not existing_app:
            scanme_app = Application(
                app_id="scanme",
                name="ScanMe Platform",
                description="Core ScanMe event photography platform.",
            )
            db.add(scanme_app)

        packages_to_seed = [
            {
                "id": uuid.UUID("11111111-1111-1111-1111-111111111111"),
                "app_id": "scanme",
                "name": "Free",
                "price": 0.00,
                "billing_cycle": BillingCycle.MONTHLY,
                "features": ["1 event per month", "Up to 50 photos per event", "Basic face matching"],
            },
            {
                "id": uuid.UUID("123e4567-e89b-12d3-a456-426614174000"),
                "app_id": "scanme",
                "name": "Pro",
                "price": 15.00,
                "billing_cycle": BillingCycle.MONTHLY,
                "features": ["Unlimited events", "Advanced AI face matching", "Custom branding"],
            },
            {
                "id": uuid.UUID("99999999-9999-9999-9999-999999999999"),
                "app_id": "scanme",
                "name": "Enterprise",
                "price": 49.00,
                "billing_cycle": BillingCycle.MONTHLY,
                "features": ["Everything in Pro", "Unlimited photos per event", "Team collaboration (5 seats)"],
            },
        ]

        for pkg_data in packages_to_seed:
            existing = db.query(Package).filter(Package.id == pkg_data["id"]).first()
            if not existing:
                pkg = Package(**pkg_data)
                db.add(pkg)

        db.commit()
        print("Successfully seeded initial application and packages (Free, Pro, Enterprise)!")
    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
    finally:
        db.close()


seed_database()

app = FastAPI(
    title="ScanMe Subscription Service",
    version="0.1.0",
    description="Manages packages, subscriptions, and payment records.",
)

# ── CORS Middleware ────────────────────────────────────────────────────────────
origins = [
    "http://localhost:3000",
    "http://localhost:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(subscription_router)
app.include_router(package_router)
app.include_router(admin_router)


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/", tags=["Health"])
def read_root():
    return {"message": "Subscription Microservice is running successfully! 🚀"}