"""CS-2-S8 — inject library_search only when composer attached library_doc_ids."""

from __future__ import annotations

from oaao_orchestrator.tasks.models import RunTaskSpec, RunTaskType


def library_doc_ids_from_request(req: object) -> list[int]:
    raw = getattr(req, "library_doc_ids", None) or []
    if not isinstance(raw, list):
        return []
    out: list[int] = []
    for item in raw:
        try:
            n = int(item)
        except (TypeError, ValueError):
            continue
        if n > 0:
            out.append(n)
    return sorted(set(out))


def inject_library_search_when_attached(
    specs: list[RunTaskSpec],
    req: object,
) -> list[RunTaskSpec]:
    """
    Attach-only Soft-RAG: never run library search without explicit ``library_doc_ids``.
    Inserts ``library_search`` agent before ``llm_stream`` when ids are present.
    """
    doc_ids = library_doc_ids_from_request(req)
    if not doc_ids:
        return specs

    if any(
        s.type == RunTaskType.AGENT and (s.agent_kind or "").strip() == "library_search"
        for s in specs
    ):
        return specs

    lib_task = RunTaskSpec(
        id="rt-library-search",
        title="Search attached library documents",
        type=RunTaskType.AGENT,
        agent_kind="library_search",
        params={"document_ids": doc_ids},
    )

    stream_idx = next(
        (i for i, t in enumerate(specs) if t.type == RunTaskType.LLM_STREAM),
        len(specs),
    )
    out = list(specs)
    out.insert(stream_idx, lib_task)
    total = len(out)
    for i, spec in enumerate(out, start=1):
        spec.index = i
        spec.total = total
    return out


def apply_library_attach_to_plan(plan: RunPlan, req: object) -> RunPlan:
    """Ensure attach-only library_search is scheduled when ``library_doc_ids`` is set."""
    from oaao_orchestrator.tasks.models import RunPlan as _RunPlan

    if not isinstance(plan, _RunPlan):
        return plan
    plan.tasks = inject_library_search_when_attached(list(plan.tasks), req)
    return plan
