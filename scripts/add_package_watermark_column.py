"""
One-off migration: add Package.has_watermark (BOOLEAN) to the existing
`packages` table, and turn it on for the Free tier package.

Same story as add_package_limits_column.py — there's no Alembic wiring, and
Base.metadata.create_all() never alters existing tables, so this script adds
the column in place. Every existing row is backfilled to FALSE, then the
package(s) named "Free" (the same name GET /api/v1/subscriptions resolves the
virtual Free tier from) are flipped to TRUE. Idempotent — safe to re-run, and
the Free-tier flip only happens when the column is first added, so it never
overrides a later manual change made through the admin UI.

Usage:
    cd sm-subscription-service
    venv\\Scripts\\python.exe scripts\\add_package_watermark_column.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect, text

from database import engine


def column_exists(inspector, table_name: str, column_name: str) -> bool:
    return any(col["name"] == column_name for col in inspector.get_columns(table_name))


def main():
    inspector = inspect(engine)
    dialect = engine.dialect.name

    if column_exists(inspector, "packages", "has_watermark"):
        print("'has_watermark' column already exists on 'packages' — nothing to do.")
        return

    with engine.begin() as conn:
        if dialect == "postgresql":
            conn.execute(text(
                "ALTER TABLE packages "
                "ADD COLUMN IF NOT EXISTS has_watermark BOOLEAN NOT NULL DEFAULT FALSE"
            ))
        elif dialect == "sqlite":
            conn.execute(text(
                "ALTER TABLE packages ADD COLUMN has_watermark BOOLEAN NOT NULL DEFAULT 0"
            ))
        else:
            raise RuntimeError(
                f"Unsupported dialect '{dialect}' — add an ALTER TABLE branch for it."
            )

        result = conn.execute(text(
            "UPDATE packages SET has_watermark = TRUE WHERE LOWER(name) = 'free'"
        ))

    print(f"Added 'has_watermark' column to 'packages' ({dialect}); "
          f"enabled it on {result.rowcount} Free package(s).")


if __name__ == "__main__":
    main()
