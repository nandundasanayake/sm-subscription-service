"""
One-off migration: add Package.limits (JSON) to the existing `packages` table.

This project has no Alembic wiring yet (main.py just runs
Base.metadata.create_all(), which only creates missing tables — it never
alters existing ones). This script is the safe stand-in: it adds the new
column without touching any existing rows or columns, and it's idempotent
(safe to run more than once).

Usage:
    cd sm-subscription-service
    venv\\Scripts\\python.exe scripts\\add_package_limits_column.py
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

    if column_exists(inspector, "packages", "limits"):
        print("'limits' column already exists on 'packages' — nothing to do.")
        return

    with engine.begin() as conn:
        if dialect == "postgresql":
            # DEFAULT '{}'::json backfills every existing row with an empty
            # object at the same time the column is added (metadata-only
            # operation on PG 11+, since JSON has no NOT NULL check to
            # revalidate) — no separate UPDATE pass needed, no data lost.
            conn.execute(text(
                "ALTER TABLE packages "
                "ADD COLUMN IF NOT EXISTS limits JSON NOT NULL DEFAULT '{}'::json"
            ))
        elif dialect == "sqlite":
            # SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS guard,
            # but the exists-check above already makes this call idempotent.
            # DEFAULT '{}' backfills existing rows as it does on Postgres.
            conn.execute(text(
                "ALTER TABLE packages ADD COLUMN limits JSON NOT NULL DEFAULT '{}'"
            ))
        else:
            raise RuntimeError(
                f"Unsupported dialect '{dialect}' — add an ALTER TABLE branch for it."
            )

    print(f"Added 'limits' column to 'packages' ({dialect}).")


if __name__ == "__main__":
    main()
