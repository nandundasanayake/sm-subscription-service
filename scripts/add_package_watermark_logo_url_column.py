"""
One-off migration: add Package.watermark_logo_url (VARCHAR, nullable) to the
existing `packages` table.

Same approach as add_package_watermark_column.py — no Alembic here, and
Base.metadata.create_all() never alters existing tables. Existing rows get
NULL, meaning "use the ingestion worker's default logo / text watermark".
Idempotent — safe to run more than once.

Must run BEFORE restarting the service on the new code: the Package model
selects this column, so every package query fails until it exists.

Usage:
    cd sm-subscription-service
    venv\\Scripts\\python.exe scripts\\add_package_watermark_logo_url_column.py
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

    if column_exists(inspector, "packages", "watermark_logo_url"):
        print("'watermark_logo_url' column already exists on 'packages' — nothing to do.")
        return

    with engine.begin() as conn:
        if dialect == "postgresql":
            conn.execute(text(
                "ALTER TABLE packages ADD COLUMN IF NOT EXISTS watermark_logo_url VARCHAR(1024)"
            ))
        elif dialect == "sqlite":
            conn.execute(text(
                "ALTER TABLE packages ADD COLUMN watermark_logo_url VARCHAR(1024)"
            ))
        else:
            raise RuntimeError(
                f"Unsupported dialect '{dialect}' — add an ALTER TABLE branch for it."
            )

    print(f"Added 'watermark_logo_url' column to 'packages' ({dialect}).")


if __name__ == "__main__":
    main()
