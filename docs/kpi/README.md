# W1-S2 — KPI snapshots

This directory receives daily JSON snapshots produced by
[scripts/kpi_snapshot.sh](../../scripts/kpi_snapshot.sh).

- One file per UTC day, named `YYYY-MM-DD.json`.
- Schema documented in [docs/W1_S2_Baseline_KPI.md](../W1_S2_Baseline_KPI.md).
- Hand-edit nothing; let the script overwrite when re-run on the same day.
- Snapshots are intentionally checked in so historical trend is auditable
  without a metrics backend.
