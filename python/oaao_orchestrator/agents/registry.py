"""
Agent registry — ``agent_kind`` → ``AgentRunner`` (Phase 3+ implementations).

Phase 0: empty by default; call ``register_agent`` or extend ``default_agent_factories``.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any, Protocol, runtime_checkable

from oaao_orchestrator.pipeline import RunContext
from oaao_orchestrator.streaming.session import StreamRun
from oaao_orchestrator.tasks.models import AgentResult, RunTaskSpec

logger = logging.getLogger(__name__)

AgentFactory = Callable[[], "AgentRunner"]


@runtime_checkable
class AgentRunner(Protocol):
    """Executes one ``RunTaskSpec`` with type ``agent`` — emits progress via ``StreamRun.append``."""

    agent_kind: str

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
    ) -> AgentResult:
        ...


class AgentRegistry:
    def __init__(self) -> None:
        self._runners: dict[str, AgentRunner] = {}

    def register(self, runner: AgentRunner) -> None:
        kind = runner.agent_kind.strip()
        if not kind:
            raise ValueError("agent_kind must be non-empty")
        if kind in self._runners:
            logger.warning("overwriting agent_kind=%s in AgentRegistry", kind)
        self._runners[kind] = runner

    def register_factory(self, agent_kind: str, factory: AgentFactory) -> None:
        runner = factory()
        if runner.agent_kind != agent_kind:
            raise ValueError(
                f"factory produced agent_kind={runner.agent_kind!r}, expected {agent_kind!r}"
            )
        self.register(runner)

    def get(self, agent_kind: str) -> AgentRunner | None:
        return self._runners.get(agent_kind)

    def kinds(self) -> tuple[str, ...]:
        return tuple(sorted(self._runners))

    async def run(
        self,
        *,
        run: StreamRun,
        run_task: RunTaskSpec,
        ctx: RunContext,
        agent_kind: str | None = None,
    ) -> AgentResult:
        kind = (agent_kind or run_task.agent_kind or "").strip()
        if not kind:
            return AgentResult(success=False, error="missing_agent_kind")
        runner = self.get(kind)
        if runner is None:
            return AgentResult(success=False, error=f"unknown_agent_kind:{kind}")
        return await runner.run(run=run, run_task=run_task, ctx=ctx)


def default_agent_factories() -> dict[str, AgentFactory]:
    """Built-in agents — vault_rag (Phase 3) + vertical stubs (Phase 4)."""

    def _vault_rag_factory() -> AgentRunner:
        from oaao_orchestrator.agents.vault_rag import VaultRagAgent  # noqa: PLC0415

        return VaultRagAgent()

    from oaao_orchestrator.agents import slide_designer as _slide_designer_mod  # noqa: F401, PLC0415
    from oaao_orchestrator.agents.stub_vertical import STUB_AGENT_DEFS, stub_agent_factory  # noqa: PLC0415

    factories: dict[str, AgentFactory] = {
        "vault_rag": _vault_rag_factory,
        "slide_designer": lambda: _slide_designer_mod.SlideDesignerAgent(),
    }
    for kind in STUB_AGENT_DEFS:
        if kind == "slide_designer":
            continue
        factories[kind] = stub_agent_factory(kind)
    return factories


def build_agent_registry(*, extra_factories: dict[str, AgentFactory] | None = None) -> AgentRegistry:
    registry = AgentRegistry()
    merged: dict[str, AgentFactory] = {**default_agent_factories()}
    if extra_factories:
        merged.update(extra_factories)
    for kind, factory in merged.items():
        registry.register_factory(kind, factory)
    return registry


_default_registry: AgentRegistry | None = None


def get_agent_registry() -> AgentRegistry:
    global _default_registry
    if _default_registry is None:
        _default_registry = build_agent_registry()
    return _default_registry


def register_agent(runner: AgentRunner) -> None:
    """Import-time hook for optional agent modules (Phase 3+)."""
    get_agent_registry().register(runner)


def reset_agent_registry_for_tests() -> None:
    """Test-only — rebuild empty registry."""
    global _default_registry
    _default_registry = build_agent_registry()
