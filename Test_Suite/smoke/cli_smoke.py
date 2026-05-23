"""
CLI smoke — Message In → Hook Chain → Response Out, without UI / FastAPI / PHP.

Usage:
    cd oaao.ai-v1/python
    python -m Test_Suite.smoke.cli_smoke "Hello orchestrator"

Optional env:
    OAAO_TRACE=1      Print every captured StreamEnvelope (phase/kind/text)
    OAAO_AGENT_KIND   Defaults to ``echo`` (a synthesized stub registered here)

The script registers an `EchoAgent` (success path) that emits start/end envelopes
mimicking real agent behaviour, runs it through `AgentRegistry`, then prints the
resulting `AgentResult` + captured envelopes. No real LLM / HTTP / DB calls.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# Allow `python -m Test_Suite.smoke.cli_smoke` from oaao.ai-v1/python or repo root
_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent
_PY = _REPO_ROOT / "python"
for p in (_REPO_ROOT, _PY):
    sp = str(p)
    if sp not in sys.path:
        sys.path.insert(0, sp)

from oaao_orchestrator.agents.registry import (  # noqa: E402
    AgentResult,
    register_agent,
    reset_agent_registry_for_tests,
)
from oaao_orchestrator.pipeline import RunContext  # noqa: E402
from oaao_orchestrator.streaming.events import (  # noqa: E402
    KIND_END,
    KIND_START,
    PHASE_AGENT,
    StreamEnvelope,
)

from Test_Suite.mocks.mock_core import MockCore  # noqa: E402


class EchoAgent:
    """Minimal happy-path agent — emits start/end and echoes user message."""

    agent_kind = "echo"

    async def run(self, *, run, run_task, ctx) -> AgentResult:  # noqa: ANN001
        last_user = ""
        for msg in reversed(ctx.messages or []):
            if msg.get("role") == "user":
                last_user = str(msg.get("content") or "")
                break
        await run.append(
            StreamEnvelope(
                phase=PHASE_AGENT,
                kind=KIND_START,
                step_id=run_task.id,
                text=f"echo:start kind={self.agent_kind}",
                payload={"agent_kind": self.agent_kind, "task_id": run_task.id},
            )
        )
        reply = f"[echo] you said: {last_user!r}"
        await run.append(
            StreamEnvelope(
                phase=PHASE_AGENT,
                kind=KIND_END,
                step_id=run_task.id,
                text="echo:end",
                payload={"reply": reply},
            )
        )
        return AgentResult(success=True, extra={"reply": reply})


async def _run(message: str, agent_kind: str, trace: bool) -> int:
    reset_agent_registry_for_tests()
    register_agent(EchoAgent())

    core = MockCore()
    ctx = RunContext(
        conversation_id="cli-smoke",
        user_id="cli",
        purpose_id="default_chat",
        mode_id="default",
        messages=[{"role": "user", "content": message}],
    )
    result = await core.run_agent(agent_kind=agent_kind, task_id="rt-1", ctx=ctx)

    print("=" * 60)
    print(f"INPUT  : {message!r}")
    print(f"AGENT  : {agent_kind}")
    print(f"RESULT : success={result.success} error={result.error!r}")
    print(f"REPLY  : {result.extra.get('reply')!r}")
    print("=" * 60)
    if trace:
        print("ENVELOPES:")
        for e in core.envelopes:
            print(
                f"  - phase={e.phase:<8} kind={e.kind:<8} step={e.step_id or '-':<10} "
                f"text={(e.text or '')[:60]!r}"
            )
            if e.payload:
                print(f"      payload={json.dumps(e.payload, ensure_ascii=False)[:200]}")
    return 0 if result.success else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="oaao orchestrator CLI smoke (no UI / HTTP)")
    ap.add_argument("message", nargs="?", default="hello", help="user message to send")
    ap.add_argument(
        "--agent",
        default=os.environ.get("OAAO_AGENT_KIND", "echo"),
        help="agent_kind to dispatch (default: echo)",
    )
    ap.add_argument(
        "--trace",
        action="store_true",
        default=bool(os.environ.get("OAAO_TRACE")),
        help="Print every captured StreamEnvelope",
    )
    ns = ap.parse_args()
    return asyncio.run(_run(ns.message, ns.agent, ns.trace))


if __name__ == "__main__":
    raise SystemExit(main())
