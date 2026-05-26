"""Tests for mine SQLite upsert logic."""

from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

from oaao_orchestrator.mine.sqlite_store import ensure_table, infer_schema_from_rows, upsert_rows


def test_upsert_inserts_and_updates_by_natural_key() -> None:
    schema = infer_schema_from_rows(
        [{"symbol": "0700.HK", "price": 380.0}, {"symbol": "9988.HK", "price": 80.5}],
        table_name="prices",
    )
    schema["natural_key"] = ["symbol"]

    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "t.sqlite"
        conn = sqlite3.connect(str(db))
        table, col_names, natural_key = ensure_table(conn, schema)

        ins1, upd1 = upsert_rows(
            conn,
            table=table,
            col_names=col_names,
            natural_key=natural_key,
            rows=[{"symbol": "0700.HK", "price": 380.0}],
            run_id=1,
            source_key="s1",
        )
        assert ins1 == 1 and upd1 == 0

        ins2, upd2 = upsert_rows(
            conn,
            table=table,
            col_names=col_names,
            natural_key=natural_key,
            rows=[{"symbol": "0700.HK", "price": 381.0}],
            run_id=2,
            source_key="s1",
        )
        assert ins2 == 0 and upd2 == 1

        cur = conn.execute(f"SELECT COUNT(*), MAX(price) FROM {table}")
        count, max_price = cur.fetchone()
        assert count == 1
        assert float(max_price) == 381.0
        conn.close()


def test_json_path_rows() -> None:
    from oaao_orchestrator.mine.json_path import rows_from_json_path

    payload = {"data": {"items": [{"a": 1}, {"a": 2}]}}
    rows = rows_from_json_path(payload, "data.items")
    assert len(rows) == 2
    assert rows[0]["a"] == 1
