"""Calendar/todo compose injection — PHP-owned ``module_prompts.compose_assistant`` only.

Each module registers ``content`` on send; Python concatenates slots — no compose .md templates.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

_COMPOSE_PREFIX = "Keep the assistant reply fluent. Place each fence block right after its related section.\n\n"


def format_upcoming_calendar_events(events: list[Any] | None) -> str:
    if not events:
        return "(none)"
    lines: list[str] = []
    for row in events[:32]:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        start = str(row.get("start_at") or "").strip()
        end = str(row.get("end_at") or "").strip()
        loc = str(row.get("location") or "").strip()
        if not title and not start:
            continue
        bit = title or "Event"
        if start:
            bit += f" · {start}"
            if end and end != start:
                bit += f" – {end}"
        if loc:
            bit += f" @ {loc}"
        lines.append(f"- {bit}")
    return "\n".join(lines) if lines else "(none)"


def format_open_todo_items(items: list[Any] | None) -> str:
    if not items:
        return "(none)"
    lines: list[str] = []
    for row in items[:40]:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if title:
            lines.append(f"- {title}")
    return "\n".join(lines) if lines else "(none)"


def productivity_template_variables(chat_request: object | None) -> dict[str, str]:
    """Template vars for post-turn classifiers — prefer PHP ``module_prompts.after_turn``."""
    mp = getattr(chat_request, "module_prompts", None) if chat_request else None
    if isinstance(mp, dict):
        after = mp.get("after_turn")
        if isinstance(after, dict):
            for row in after.values():
                if isinstance(row, dict) and isinstance(row.get("variables"), dict):
                    vars_ = row["variables"]
                    return {
                        "upcoming_calendar_events": str(
                            vars_.get("upcoming_calendar_events") or "(none)"
                        ),
                        "open_todo_items": str(vars_.get("open_todo_items") or "(none)"),
                    }

    events = getattr(chat_request, "upcoming_calendar_events", None) if chat_request else None
    todos = getattr(chat_request, "open_todo_items", None) if chat_request else None
    ev_list = events if isinstance(events, list) else []
    todo_list = todos if isinstance(todos, list) else []
    return {
        "upcoming_calendar_events": format_upcoming_calendar_events(ev_list),
        "open_todo_items": format_open_todo_items(todo_list),
    }


def _module_prompts(chat_request: object | None) -> dict[str, Any]:
    raw = getattr(chat_request, "module_prompts", None) if chat_request else None
    return raw if isinstance(raw, dict) else {}


def compose_assistant_blocks(chat_request: object | None) -> list[str]:
    """Ordered compose blocks from PHP ``module_prompts.compose_assistant`` slot content."""
    compose = _module_prompts(chat_request).get("compose_assistant")
    if not isinstance(compose, dict) or not compose:
        return []
    blocks: list[str] = []
    for _slot, row in compose.items():
        if not isinstance(row, dict):
            continue
        content = str(row.get("content") or "").strip()
        if content:
            blocks.append(content)
            continue
        ref = str(row.get("template_ref") or "").strip()
        if ref:
            rendered = render_compose_spec(
                {
                    "template_ref": ref,
                    "variables": row.get("variables")
                    if isinstance(row.get("variables"), dict)
                    else {},
                }
            )
            if rendered.strip():
                blocks.append(rendered.strip())
    return blocks


def render_compose_spec(spec: dict[str, Any]) -> str:
    """Legacy: render post-turn-style template_ref if a slot still sends one."""
    ref = str(spec.get("template_ref") or "").strip()
    if not ref:
        return ""
    variables = spec.get("variables")
    if not isinstance(variables, dict):
        variables = {}
    from oaao_orchestrator.prompt_template import (
        load_template_body,
        prompts_subdir,
        render_template_text,
    )

    body = load_template_body(
        ref=ref,
        search_dirs=(prompts_subdir("productivity"),),
    )
    if not body.strip():
        return ""
    return render_template_text(body, variables)


def inject_compose_response_fences(*, req: Any, messages_for_llm: list[Any]) -> None:
    """Inject PHP compose slot content — llm_stream compose only."""
    blocks = compose_assistant_blocks(req)
    if not blocks:
        logger.info("compose_response_fences skipped reason=module_prompts.compose_assistant_empty")
        return

    body = _COMPOSE_PREFIX + "\n\n".join(blocks)
    from oaao_orchestrator.vault_rag.messages import inject_system_message

    inject_system_message(messages_for_llm, body)
    snip = body.replace("\n", " ")[:160]
    logger.info(
        "compose_response_fences injected slots=%s chars=%s snip=%r",
        len(blocks),
        len(body),
        snip,
    )
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug("compose_response_fences body=%s", body)
    _persist_compose_inject_debug(req, body)


def _persist_compose_inject_debug(req: Any, body: str) -> None:
    principal_raw = getattr(req, "run_principal", None)
    if not isinstance(principal_raw, str) or not principal_raw.strip():
        return
    try:
        from oaao_orchestrator._internal_secret import require_internal_secret
        from oaao_orchestrator.chat_persist import merge_assistant_meta
        from oaao_orchestrator.run_principal import RunPrincipal, verify_token

        principal = verify_token(principal_raw, secret=require_internal_secret())
        if not isinstance(principal, RunPrincipal):
            return
        merge_assistant_meta(
            principal=principal,
            patch={
                "orchestrator_prompt_debug": {
                    "compose_injected": body,
                    "compose_injected_chars": len(body),
                    "compose_injected_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                }
            },
        )
    except Exception:
        logger.debug("compose_inject_debug_persist_skipped", exc_info=True)


inject_compose_productivity_context = inject_compose_response_fences

# Back-compat for tests importing compose_assistant_specs
compose_assistant_specs = compose_assistant_blocks
