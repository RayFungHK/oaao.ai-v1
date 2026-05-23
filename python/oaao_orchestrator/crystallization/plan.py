"""Build RunPlan from a crystallized tool chain."""

from __future__ import annotations

from oaao_orchestrator.tasks.models import RunPlan, RunTaskSpec, RunTaskType


def build_plan_from_tool_chain(tool_chain: list[str]) -> RunPlan:
    """Map sealed agent kinds to executable run tasks (always ends with llm_stream)."""
    specs: list[RunTaskSpec] = []
    report_after: list[str] = []
    for i, kind in enumerate(tool_chain):
        tid = f"rt-skill-{i}-{kind.replace('/', '-')[:24]}"
        if kind == "vault_rag":
            specs.append(
                RunTaskSpec(
                    id=tid,
                    title="Search knowledge base",
                    type=RunTaskType.VAULT_RAG,
                    agent_kind="vault_rag",
                )
            )
            report_after.append(tid)
        elif kind == "llm_stream":
            specs.append(
                RunTaskSpec(
                    id=tid,
                    title="Generate response",
                    type=RunTaskType.LLM_STREAM,
                )
            )
        else:
            specs.append(
                RunTaskSpec(
                    id=tid,
                    title=f"Run {kind}",
                    type=RunTaskType.AGENT,
                    agent_kind=kind,
                )
            )
            report_after.append(tid)

    if not specs or specs[-1].type != RunTaskType.LLM_STREAM:
        specs.append(
            RunTaskSpec(
                id="rt-skill-llm",
                title="Generate response",
                type=RunTaskType.LLM_STREAM,
            )
        )

    total = len(specs)
    for idx, spec in enumerate(specs, start=1):
        spec.index = idx
        spec.total = total

    return RunPlan(tasks=specs, report_after_task_ids=report_after)
