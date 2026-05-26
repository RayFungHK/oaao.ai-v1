"""SQLite DDL + upsert for mined rows."""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SYSTEM_COLUMNS = (
    ("_mine_row_id", "INTEGER PRIMARY KEY AUTOINCREMENT"),
    ("_fetched_at", "TEXT NOT NULL"),
    ("_run_id", "INTEGER NOT NULL"),
    ("_source_key", "TEXT"),
)


def _safe_ident(name: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_]", "_", name or "data").strip("_")
    return clean or "data"


def _sql_type(raw: str) -> str:
    t = (raw or "TEXT").upper()
    if t in ("TEXT", "REAL", "INTEGER", "BLOB"):
        return t
    if t in ("INT", "BIGINT", "BOOL", "BOOLEAN"):
        return "INTEGER"
    if t in ("FLOAT", "DOUBLE", "NUMERIC", "DECIMAL"):
        return "REAL"
    return "TEXT"


def sqlite_abs_path(root: str, relative: str) -> Path:
    rel = relative.replace("\\", "/").lstrip("/")
    if ".." in rel.split("/"):
        raise ValueError("invalid_sqlite_path")
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def schema_signature(schema: dict[str, Any]) -> tuple[str, list[str], list[str]]:
    table = _safe_ident(str(schema.get("table_name") or "data"))
    cols_raw = schema.get("columns") if isinstance(schema.get("columns"), list) else []
    columns: list[tuple[str, str]] = []
    for c in cols_raw:
        if not isinstance(c, dict):
            continue
        name = _safe_ident(str(c.get("name") or ""))
        if not name or name.startswith("_"):
            continue
        columns.append((name, _sql_type(str(c.get("sql_type") or "TEXT"))))
    if not columns:
        raise ValueError("schema_has_no_columns")
    nk_raw = schema.get("natural_key") if isinstance(schema.get("natural_key"), list) else []
    natural_key = [_safe_ident(str(k)) for k in nk_raw if str(k).strip()]
    natural_key = [k for k in natural_key if k in {n for n, _ in columns}]
    return table, [f"{n} {t}" for n, t in columns], natural_key


def ensure_table(conn: sqlite3.Connection, schema: dict[str, Any]) -> tuple[str, list[str], list[str]]:
    table, col_defs, natural_key = schema_signature(schema)
    parts = [f"{n} {t}" for n, t in SYSTEM_COLUMNS]
    parts.extend(col_defs)
    ddl = f"CREATE TABLE IF NOT EXISTS {table} ({', '.join(parts)})"
    conn.execute(ddl)
    if natural_key:
        idx = f"idx_{table}_nk"
        conn.execute(
            f"CREATE UNIQUE INDEX IF NOT EXISTS {idx} ON {table} ({', '.join(natural_key)})"
        )
    conn.commit()
    col_names = [c.split()[0] for c in col_defs]
    return table, col_names, natural_key


def schemas_compatible(stored: dict[str, Any] | None, incoming: dict[str, Any]) -> bool:
    if not stored:
        return True
    try:
        t1, c1, nk1 = schema_signature(stored)
        t2, c2, nk2 = schema_signature(incoming)
    except ValueError:
        return False
    return t1 == t2 and c1 == c2 and nk1 == nk2


def upsert_rows(
    conn: sqlite3.Connection,
    *,
    table: str,
    col_names: list[str],
    natural_key: list[str],
    rows: list[dict[str, Any]],
    run_id: int,
    source_key: str,
    fetched_at: str | None = None,
) -> tuple[int, int]:
    ts = fetched_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    inserted = 0
    updated = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        values = {k: row.get(k) for k in col_names if k in row}
        if not values:
            continue
        sys_vals = {"_fetched_at": ts, "_run_id": run_id, "_source_key": source_key}
        if natural_key:
            where = " AND ".join(f"{k} = ?" for k in natural_key)
            params = [values.get(k) for k in natural_key]
            cur = conn.execute(f"SELECT _mine_row_id FROM {table} WHERE {where} LIMIT 1", params)
            existing = cur.fetchone()
            if existing:
                set_clause = ", ".join(f"{k} = ?" for k in values) + ", _fetched_at = ?, _run_id = ?, _source_key = ?"
                conn.execute(
                    f"UPDATE {table} SET {set_clause} WHERE _mine_row_id = ?",
                    [*values.values(), ts, run_id, source_key, existing[0]],
                )
                updated += 1
                continue
        keys = list(values.keys()) + ["_fetched_at", "_run_id", "_source_key"]
        placeholders = ", ".join("?" for _ in keys)
        conn.execute(
            f"INSERT INTO {table} ({', '.join(keys)}) VALUES ({placeholders})",
            [*values.values(), ts, run_id, source_key],
        )
        inserted += 1
    conn.commit()
    return inserted, updated


def merge_rows_for_schema(batches: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Flatten multi-source row lists for schema inference."""
    out: list[dict[str, Any]] = []
    for rows in batches:
        for row in rows:
            if isinstance(row, dict):
                out.append(row)
            if len(out) >= 500:
                return out
    return out


def infer_schema_from_rows(rows: list[dict[str, Any]], *, table_name: str = "data") -> dict[str, Any]:
    keys: list[str] = []
    for row in rows[:50]:
        if not isinstance(row, dict):
            continue
        for k in row:
            if k not in keys:
                keys.append(str(k))
    columns = [{"name": k, "sql_type": "TEXT"} for k in keys[:32]]
    natural_key = keys[:2] if len(keys) >= 2 else (keys[:1] if keys else [])
    return {
        "table_name": table_name,
        "columns": columns,
        "natural_key": natural_key,
    }
