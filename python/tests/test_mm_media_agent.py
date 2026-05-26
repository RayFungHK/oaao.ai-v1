"""MmMediaAgent registry and binding guards."""

from oaao_orchestrator.agents.mm_media import MM_AGENT_KINDS, MmMediaAgent
from oaao_orchestrator.agents.registry import get_agent_registry, reset_agent_registry_for_tests


def test_mm_agent_kinds_registered():
    reset_agent_registry_for_tests()
    reg = get_agent_registry()
    for kind in MM_AGENT_KINDS:
        assert reg.get(kind) is not None
        assert reg.get(kind).agent_kind == kind


def test_mm_agent_requires_binding_key():
    agent = MmMediaAgent("mm_generate")
    assert agent.agent_kind == "mm_generate"
