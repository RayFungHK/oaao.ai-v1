from __future__ import annotations

from collections.abc import Callable

from oaao_orchestrator.plugins.builtins.accs import AccsPlugin
from oaao_orchestrator.plugins.builtins.iqs import IqsPlugin
from oaao_orchestrator.plugins.spec import PostStreamPlugin

PluginFactory = Callable[[], PostStreamPlugin]


def default_plugin_factories() -> dict[str, PluginFactory]:
    return {
        "iqs": lambda: IqsPlugin(),
        "accs": lambda: AccsPlugin(),
    }
