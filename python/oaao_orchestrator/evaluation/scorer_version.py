"""Canonical IQS / ACCS scorer versions — bump when dimensions or formulas change."""

from __future__ import annotations

from oaao_orchestrator.evaluation.iqs import DIMENSION_WEIGHTS

IQS_SCORER_VERSION = "iqs_v2"
ACCS_SCORER_VERSION = "accs_v2"

IQS_DIMENSION_KEYS = frozenset(DIMENSION_WEIGHTS.keys())
ACCS_DIMENSION_KEYS = frozenset({"alignment", "accuracy", "hallucination_penalty"})

LEGACY_SCORER_VERSIONS = frozenset({"", "post_stream_v1"})


def combined_scorer_version() -> str:
    return f"{IQS_SCORER_VERSION}+{ACCS_SCORER_VERSION}"


def parse_stored_version(raw: str | None) -> tuple[str, str]:
    s = (raw or "").strip()
    if s in LEGACY_SCORER_VERSIONS:
        return "", ""
    if "+" in s:
        left, right = s.split("+", 1)
        return left.strip(), right.strip()
    if s == IQS_SCORER_VERSION:
        return IQS_SCORER_VERSION, ""
    if s == ACCS_SCORER_VERSION:
        return "", ACCS_SCORER_VERSION
    return "", ""


def scorer_versions_payload() -> dict[str, str]:
    return {
        "iqs": IQS_SCORER_VERSION,
        "accs": ACCS_SCORER_VERSION,
        "combined": combined_scorer_version(),
    }


def _dims_match(keys: frozenset[str], dims: dict | None) -> bool:
    if not dims:
        return False
    return frozenset(str(k) for k in dims.keys()) == keys


def needs_iqs_rescore(
    *,
    stored_version: str | None,
    iqs: float,
    iqs_dims: dict | None,
) -> bool:
    if iqs <= 0:
        return True
    sv = (stored_version or "").strip()
    if sv in LEGACY_SCORER_VERSIONS:
        return True
    iqs_v, _ = parse_stored_version(sv)
    if iqs_v != IQS_SCORER_VERSION:
        return True
    return not _dims_match(IQS_DIMENSION_KEYS, iqs_dims)


def needs_accs_rescore(
    *,
    stored_version: str | None,
    accs: float,
    accs_dims: dict | None,
    iqs_action: str | None = None,
) -> bool:
    action = (iqs_action or "").strip().lower()
    if action in ("clarify", "hard_clarify"):
        return False
    if accs <= 0:
        return True
    sv = (stored_version or "").strip()
    if sv in LEGACY_SCORER_VERSIONS:
        return True
    _, accs_v = parse_stored_version(sv)
    if accs_v != ACCS_SCORER_VERSION:
        return True
    return not _dims_match(ACCS_DIMENSION_KEYS, accs_dims)


def merge_scorer_version(existing: str | None, plugin: str) -> str:
    iqs_v, accs_v = parse_stored_version(existing)
    if plugin == "iqs":
        iqs_v = IQS_SCORER_VERSION
    elif plugin == "accs":
        accs_v = ACCS_SCORER_VERSION
    if iqs_v and accs_v:
        return f"{iqs_v}+{accs_v}"
    return iqs_v or accs_v or combined_scorer_version()
