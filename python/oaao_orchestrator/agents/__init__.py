"""
Agent runners — register via ``register_agent`` or ``default_agent_factories``.

Importing this package does not register agents until Phase 3+ modules call ``register_agent``.
"""

from oaao_orchestrator.agents.registry import (
    AgentFactory,
    AgentRegistry,
    AgentRunner,
    build_agent_registry,
    default_agent_factories,
    get_agent_registry,
    register_agent,
    reset_agent_registry_for_tests,
)

__all__ = [
    "AgentFactory",
    "AgentRegistry",
    "AgentRunner",
    "build_agent_registry",
    "default_agent_factories",
    "get_agent_registry",
    "register_agent",
    "reset_agent_registry_for_tests",
]
