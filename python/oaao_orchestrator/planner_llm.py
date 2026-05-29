"""LLM-backed run planner — JSON task list + optional report-result pass."""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from oaao_orchestrator.planner_catalog import (
    ability_hints_for,
    catalog_from_request,
    planner_agent_guide,
)
from oaao_orchestrator.tasks.models import AbilityHint, RunPlan, RunTaskSpec, RunTaskType

logger = logging.getLogger(__name__)

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


class PlannerTaskDraft(BaseModel):
    id: str = ""
    title: str = ""
    type: str = ""
    agent_kind: str | None = None
    requires_ask: bool = False
    ask_message: str | None = None


class PlannerOutputDraft(BaseModel):
    tasks: list[PlannerTaskDraft] = Field(default_factory=list)
    abilities: list[AbilityHint] = Field(default_factory=list)
    report_after: list[str] = Field(
        default_factory=list,
        description="Run-task ids that trigger one report-result replan after completion.",
    )
    slide_action: str | None = Field(
        default=None,
        description="regenerate | continue | new — slide deck intent for this turn (agent decides).",
    )
    use_material_id: str | None = Field(
        default=None,
        description="conversation_materials material_id (e.g. slide-{project_id}) to continue or replace.",
    )
    needs_vault_rag: bool = Field(
        default=False,
        description="When true, include vault_rag before slide_designer if handbook/source grounding is needed.",
    )
    needs_web_search: bool = Field(
        default=False,
        description="When true, include web_search agent for public internet / news / availability (not workspace vault).",
    )
    apply_skill_ids: list[str] = Field(
        default_factory=list,
        description="skill_id values from skills_catalog to apply this turn (e.g. bound_template:tid).",
    )
    suggest_skill: dict[str, Any] | None = Field(
        default=None,
        description="When user articulated reusable logic with no catalog match — preview for user to save.",
    )
    conversation_title: str | None = Field(
        default=None,
        description="Optional sidebar title for a new chat thread (planner-suggested).",
    )
    inference_delta: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Bounded per-turn sampling nudges for auto_tune (temperature, top_p, top_k, "
            "presence_penalty, frequency_penalty, max_tokens). Small deltas only — not full presets."
        ),
    )


class ReportResultDraft(BaseModel):
    append: list[PlannerTaskDraft] = Field(default_factory=list)


def planner_mode(req: object | None = None) -> str:
    raw = getattr(req, "run_planner_mode", None) if req is not None else None
    if raw is not None and str(raw).strip():
        return str(raw).strip().lower()
    return os.environ.get("OAAO_RUN_PLANNER_MODE", "llm").strip().lower()


def planner_enabled(req: object | None = None) -> bool:
    return planner_mode(req) not in ("0", "false", "no", "off", "stub")


def _extract_json_object(text: str) -> dict[str, Any] | None:
    from oaao_orchestrator.json_utils import extract_json_object

    return extract_json_object(text)


DEFAULT_PLANNER_SYSTEM_REF = "materials/prompts/planning/planner_system.md"


def _planner_system_prompt(
    *,
    allowed_agents: list[str],
    max_tasks: int,
    agent_guide: str,
    planner_payload: dict[str, Any] | None = None,
) -> str:
    """Load planner system text from purpose ``prompt.system_ref`` (markdown only)."""
    from oaao_orchestrator.planning_prompt import render_planner_system_prompt

    return render_planner_system_prompt(
        allowed_agents=allowed_agents,
        max_tasks=max_tasks,
        agent_guide=agent_guide,
        planner_payload=planner_payload,
    )


def _report_system_prompt(*, agent_guide: str) -> str:
    from oaao_orchestrator.planning_prompt import render_report_system_prompt

    return render_report_system_prompt(agent_guide=agent_guide)


def _apply_public_web_planner_overrides(req: object, draft: PlannerOutputDraft) -> None:
    """Align planner JSON with globe / turn_intent public-web routing (skip vault unless scoped)."""
    from oaao_orchestrator.planner import _explicit_vault_scope, _public_web_turn

    if _explicit_vault_scope(req) or not _public_web_turn(req):
        return
    draft.needs_web_search = True
    draft.needs_vault_rag = False


def _last_user_message(messages: list[dict[str, Any]]) -> str:
    for row in reversed(messages):
        if not isinstance(row, dict):
            continue
        if str(row.get("role") or "").lower() != "user":
            continue
        content = row.get("content")
        if isinstance(content, str):
            return content.strip()
    return ""


def _planner_max_tokens() -> int:
    try:
        return max(128, min(2048, int(os.environ.get("OAAO_RUN_PLANNER_MAX_TOKENS", "512"))))
    except (TypeError, ValueError):
        return 512


async def llm_chat_completion_text(
    *,
    url: str,
    api_key: str | None,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.2,
    timeout_s: float = 60.0,
    max_tokens: int | None = None,
) -> str | None:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": max(0.0, min(1.0, temperature)),
        "stream": False,
    }
    if max_tokens is not None and max_tokens > 0:
        body["max_tokens"] = int(max_tokens)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=15.0)) as client:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code < 200 or resp.status_code >= 300:
                logger.warning("planner_http_%s", resp.status_code)
                return None
            data = resp.json()
    except Exception:
        logger.exception("planner_request_failed")
        return None

    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices:
        return None
    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(msg, dict):
        return None
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for seg in content:
            if (
                isinstance(seg, dict)
                and seg.get("type") == "text"
                and isinstance(seg.get("text"), str)
            ):
                parts.append(seg["text"])
        return "".join(parts) if parts else None
    return None


def _coerce_task_type(raw: str) -> RunTaskType | None:
    key = (raw or "").strip().lower()
    try:
        return RunTaskType(key)
    except ValueError:
        return None


def _dedupe_agent_kind_tasks(specs: list[RunTaskSpec]) -> list[RunTaskSpec]:
    """Keep at most one type=agent row per agent_kind (prefer execution over ask-only duplicates)."""
    by_kind: dict[str, list[int]] = {}
    for i, spec in enumerate(specs):
        if spec.type != RunTaskType.AGENT:
            continue
        kind = (spec.agent_kind or "").strip()
        if not kind:
            continue
        by_kind.setdefault(kind, []).append(i)

    drop: set[int] = set()
    for kind, idxs in by_kind.items():
        if len(idxs) <= 1:
            continue
        if kind == "slide_designer" and any(
            isinstance((specs[i].params or {}).get("slide_phase"), str)
            and str((specs[i].params or {}).get("slide_phase")).strip()
            for i in idxs
        ):
            continue

        def _rank(i: int) -> tuple[int, int]:
            s = specs[i]
            ask = 1 if bool(s.params.get("requires_ask")) else 0
            return (ask, i)

        keep = min(idxs, key=_rank)
        for i in idxs:
            if i != keep:
                drop.add(i)

    if not drop:
        return specs
    return [s for i, s in enumerate(specs) if i not in drop]


def _normalize_tasks(
    drafts: list[PlannerTaskDraft],
    *,
    allowed_agents: list[str],
    require_vault: bool,
    require_attachments: bool,
) -> list[RunTaskSpec]:
    allowed_set = {a.strip() for a in allowed_agents if a.strip()}
    specs: list[RunTaskSpec] = []
    seen: set[str] = set()
    for i, d in enumerate(drafts, start=1):
        t = _coerce_task_type(d.type)
        if t is None:
            continue
        tid = (d.id or "").strip() or f"rt-{i}"
        if tid in seen:
            tid = f"rt-{i}-{len(seen)}"
        seen.add(tid)
        title = (d.title or "").strip() or tid
        agent_kind = (d.agent_kind or "").strip() or None
        if t == RunTaskType.AGENT:  # noqa: SIM102
            if not agent_kind or (allowed_set and agent_kind not in allowed_set):
                continue
        params: dict[str, Any] = {}
        if t == RunTaskType.AGENT and d.requires_ask:
            params["requires_ask"] = True
            am = (d.ask_message or "").strip()
            if am:
                params["ask_message"] = am
        specs.append(
            RunTaskSpec(
                id=tid,
                title=title,
                type=t,
                agent_kind=agent_kind,
                params=params,
            )
        )

    if require_vault and not any(s.type == RunTaskType.VAULT_RAG for s in specs):
        specs.insert(
            0,
            RunTaskSpec(
                id="rt-vault-rag", title="Search knowledge base", type=RunTaskType.VAULT_RAG
            ),
        )
    if require_attachments and not any(s.type == RunTaskType.ATTACHMENTS for s in specs):
        insert_at = next(
            (i for i, s in enumerate(specs) if s.type == RunTaskType.LLM_STREAM),
            len(specs),
        )
        specs.insert(
            insert_at,
            RunTaskSpec(
                id="rt-attachments", title="Process attachments", type=RunTaskType.ATTACHMENTS
            ),
        )
    if not any(s.type == RunTaskType.LLM_STREAM for s in specs):
        specs.append(
            RunTaskSpec(id="rt-llm-stream", title="Compose reply", type=RunTaskType.LLM_STREAM),
        )

    # Single llm_stream, always last.
    streams = [s for s in specs if s.type == RunTaskType.LLM_STREAM]
    non_streams = [s for s in specs if s.type != RunTaskType.LLM_STREAM]
    if len(streams) > 1:
        non_streams.extend(streams[:-1])
        streams = streams[-1:]
    specs = non_streams + streams

    vault_idxs = [i for i, s in enumerate(specs) if s.type == RunTaskType.VAULT_RAG]
    if len(vault_idxs) > 1:
        keep = vault_idxs[0]
        for i in vault_idxs:
            if len((specs[i].title or "").strip()) > len((specs[keep].title or "").strip()):
                keep = i
        specs = [s for i, s in enumerate(specs) if s.type != RunTaskType.VAULT_RAG or i == keep]

    specs = _dedupe_agent_kind_tasks(specs)

    total = len(specs)
    for idx, spec in enumerate(specs, start=1):
        spec.index = idx
        spec.total = total
    return specs


def _slide_resume_project_id(slide_designer_cfg: dict[str, Any] | None) -> str | None:
    if not isinstance(slide_designer_cfg, dict):
        return None
    pid = slide_designer_cfg.get("resume_project_id")
    if isinstance(pid, str) and pid.strip():
        return pid.strip()
    return None


def _slide_template_selected(slide_designer_cfg: dict[str, Any] | None) -> bool:
    if not isinstance(slide_designer_cfg, dict):
        return False
    return bool(str(slide_designer_cfg.get("template_id") or "").strip())


def _slide_regenerate_mode(slide_designer_cfg: dict[str, Any] | None) -> bool:
    """User asked to redo the deck — never auto-continue the previous project."""
    return isinstance(slide_designer_cfg, dict) and bool(slide_designer_cfg.get("regenerate_deck"))


def _slide_continuation_mode(slide_designer_cfg: dict[str, Any] | None) -> bool:
    """Resume existing deck — only when planner (or explicit UI) set continuation."""
    if not isinstance(slide_designer_cfg, dict):
        return False
    if _slide_regenerate_mode(slide_designer_cfg):
        return False
    if slide_designer_cfg.get("start_new_deck") and _slide_template_selected(slide_designer_cfg):
        return False
    return bool(slide_designer_cfg.get("continuation"))


def _project_id_from_material_id(material_id: str) -> str | None:
    mid = (material_id or "").strip()
    if mid.startswith("slide-"):
        pid = mid[6:].strip()
        return pid or None
    return None


def _resolve_material_project_id(
    material_id: str,
    *,
    slide_designer_cfg: dict[str, Any] | None,
    conv_materials: list[Any] | None,
) -> str | None:
    pid = _project_id_from_material_id(material_id)
    if pid:
        return pid
    if not isinstance(conv_materials, list):
        return None
    want = material_id.strip()
    for row in conv_materials:
        if not isinstance(row, dict):
            continue
        if str(row.get("material_id") or "").strip() != want:
            continue
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        if isinstance(meta, dict):
            mp = str(meta.get("project_id") or "").strip()
            if mp:
                return mp
    if isinstance(slide_designer_cfg, dict):
        hint = str(slide_designer_cfg.get("resume_project_id") or "").strip()
        if hint:
            return hint
    return None


def _turn_reuses_prior_grounding(
    draft: PlannerOutputDraft,
    slide_designer_cfg: dict[str, Any] | None,
) -> bool:
    """Continue / regenerate / composer material — prior vault fetch must be refreshed, not assumed."""
    action = (draft.slide_action or "").strip().lower()
    if action in ("regenerate", "continue"):
        return True
    if not isinstance(slide_designer_cfg, dict):
        return False
    if slide_designer_cfg.get("regenerate_deck") or slide_designer_cfg.get("continuation"):
        return True
    if str(slide_designer_cfg.get("active_material_id") or "").strip():
        return True
    if str(slide_designer_cfg.get("resume_project_id") or "").strip():  # noqa: SIM103
        return True

    return False


def merge_planner_slide_intent(
    draft: PlannerOutputDraft,
    slide_designer_cfg: dict[str, Any] | None,
    *,
    conv_materials: list[Any] | None = None,
) -> dict[str, Any] | None:
    """Apply planner slide_action / use_material_id — no keyword heuristics on user text."""
    base: dict[str, Any] = dict(slide_designer_cfg) if isinstance(slide_designer_cfg, dict) else {}
    action = (draft.slide_action or "").strip().lower()
    material_id = (draft.use_material_id or "").strip()
    if not material_id and isinstance(base.get("active_material_id"), str):
        material_id = str(base.get("active_material_id") or "").strip()

    if action == "regenerate":
        base["regenerate_deck"] = True
        base.pop("continuation", None)
        base.pop("resume_project_id", None)
        if material_id:
            base["active_material_id"] = material_id
        return base

    if action == "continue":
        pid = _resolve_material_project_id(
            material_id,
            slide_designer_cfg=base,
            conv_materials=conv_materials,
        )
        if pid:
            base["continuation"] = True
            base["resume_project_id"] = pid
            if material_id:
                base["active_material_id"] = material_id
            base.pop("regenerate_deck", None)
            base.pop("start_new_deck", None)
        return base

    if action == "new":
        base.pop("continuation", None)
        base.pop("resume_project_id", None)
        base.pop("regenerate_deck", None)
        return base

    return base or None


def apply_slide_continuation_to_specs(
    specs: list[RunTaskSpec],
    slide_designer_cfg: dict[str, Any] | None,
) -> list[RunTaskSpec]:
    """SD-5 — user-selected deck: single continue task instead of fan-out."""
    if not _slide_continuation_mode(slide_designer_cfg):
        return specs
    pid = _slide_resume_project_id(slide_designer_cfg)
    if not pid:
        return specs
    pid = pid.strip()
    for spec in specs:
        if spec.type != RunTaskType.AGENT or (spec.agent_kind or "").strip() != "slide_designer":
            continue
        params = dict(spec.params or {})
        params["slide_phase"] = "continue"
        params["project_id"] = pid
        params["resume_project_id"] = pid
        spec.params = params
        break
    return specs


def _default_slide_designer_ask_message(
    user_msg: str,
    *,
    template_selected: bool,
    handbook: bool = True,
) -> str:
    cjk = any("\u4e00" <= ch <= "\u9fff" for ch in user_msg)
    if template_selected:
        return (
            "已選擇簡報模板。要依目前內容開始製作簡報（大綱、逐頁、匯出）嗎？"
            if cjk
            else "You selected a slide template. Start building the deck (outline, pages, export) now?"
        )
    if handbook:
        return (
            "我可以啟動簡報設計，依手冊內容產出教學簡報（大綱、逐頁 HTML、匯出）。要繼續嗎？"
            if cjk
            else "I can run the slide designer to build a teaching deck (outline, per-slide HTML, export). Proceed?"
        )
    return (
        "我可以啟動簡報設計，依你的需求製作簡報（大綱、逐頁 HTML、匯出）。要繼續嗎？"
        if cjk
        else "I can run the slide designer to build your deck (outline, per-slide HTML, export). Proceed?"
    )


def _user_explicitly_requests_slide_build(user_msg: str) -> bool:
    """Skip confirmation when the user already gave a clear go-ahead."""
    s = (user_msg or "").strip().lower()
    if not s:
        return False
    cues = (
        "開始製作",
        "直接做",
        "馬上",
        "立即執行",
        "開始做簡報",
        "做簡報吧",
        "now",
        "go ahead",
        "start building",
        "build the deck",
        "run slide designer",
        "proceed with slide",
    )
    return any(c in s for c in cues)


def ensure_slide_designer_requires_ask(
    specs: list[RunTaskSpec],
    *,
    messages: list[dict[str, Any]] | None,
    slide_designer_cfg: dict[str, Any] | None,
) -> list[RunTaskSpec]:
    """Require agent-ask before slide_designer unless continuation, regenerate, or explicit go-ahead."""
    if _slide_continuation_mode(slide_designer_cfg) or _slide_regenerate_mode(slide_designer_cfg):
        return specs
    user_msg = _last_user_message(messages or [])
    if _user_explicitly_requests_slide_build(user_msg):
        return specs
    template_selected = _slide_template_selected(slide_designer_cfg)
    for spec in specs:
        if spec.type != RunTaskType.AGENT or (spec.agent_kind or "").strip() != "slide_designer":
            continue
        phase = str((spec.params or {}).get("slide_phase") or "").strip().lower()
        if phase in ("page", "export"):
            continue
        params = dict(spec.params or {})
        if bool(params.get("requires_ask")):
            continue
        params["requires_ask"] = True
        if not str(params.get("ask_message") or "").strip():
            params["ask_message"] = _default_slide_designer_ask_message(
                user_msg,
                template_selected=template_selected,
            )
        spec.params = params
    return specs


def _plan_signals_handbook_vol_teaching(specs: list[RunTaskSpec]) -> bool:
    """Planner titled a step handbook/vol but omitted slide_designer (common LLM oversight)."""
    for spec in specs:
        title = (spec.title or "").strip()
        if not title:
            continue
        blob = title.lower()
        has_handbook = "handbook" in blob or "手冊" in title
        has_vol = "vol" in blob or "volume" in blob or "冊" in title or "卷" in title
        if has_handbook and has_vol:
            return True
    return False


def inject_web_search_for_planner_intent(
    specs: list[RunTaskSpec],
    *,
    allowed_agents: list[str],
    needs_web_search: bool,
) -> list[RunTaskSpec]:
    if not needs_web_search:
        return specs
    allowed_set = {a.strip() for a in allowed_agents if a.strip()}
    if "web_search" not in allowed_set:
        return specs
    if any(
        s.type == RunTaskType.AGENT and (s.agent_kind or "").strip() == "web_search"
        for s in specs
    ):
        return specs
    streams = [i for i, s in enumerate(specs) if s.type == RunTaskType.LLM_STREAM]
    insert_at = streams[0] if streams else len(specs)
    task = RunTaskSpec(
        id="rt-web-search",
        title="Search the web",
        type=RunTaskType.AGENT,
        agent_kind="web_search",
        params={"requires_ask": False},
    )
    out = list(specs)
    out.insert(insert_at, task)
    total = len(out)
    for idx, spec in enumerate(out, start=1):
        spec.index = idx
        spec.total = total
    return out


def enrich_composer_web_search_plan(
    plan: RunPlan,
    req: object,
    *,
    allowed_agents: list[str],
) -> RunPlan:
    """Apply composer globe toggle only — no keyword routing.

    When the user explicitly enabled Web search in the composer, inject ``web_search``
    if the LLM planner omitted it. Public-web vs vault routing otherwise stays in
    ``PlannerOutputDraft.needs_web_search`` / ``needs_vault_rag``.
    """
    if not bool(getattr(req, "enable_web_search", False)):
        return plan
    allowed_set = {a.strip() for a in allowed_agents if a.strip()}
    if "web_search" not in allowed_set:
        return plan

    has_web = any(
        s.type == RunTaskType.AGENT and (s.agent_kind or "").strip() == "web_search"
        for s in plan.tasks
    )
    tasks = list(plan.tasks)
    if not has_web:
        tasks = inject_web_search_for_planner_intent(
            tasks,
            allowed_agents=allowed_agents,
            needs_web_search=True,
        )
    plan.tasks = tasks
    total = len(plan.tasks)
    for idx, spec in enumerate(plan.tasks, start=1):
        spec.index = idx
        spec.total = total
    return plan


def inject_slide_designer_for_teaching_intent(
    specs: list[RunTaskSpec],
    *,
    allowed_agents: list[str],
    messages: list[dict[str, Any]] | None,
    slide_designer_cfg: dict[str, Any] | None,
) -> list[RunTaskSpec]:
    """Append slide_designer (with requires_ask) when the user clearly targets handbook vol teaching."""
    allowed_set = {a.strip() for a in allowed_agents if a.strip()}
    if "slide_designer" not in allowed_set:
        return specs
    if any(
        s.type == RunTaskType.AGENT and (s.agent_kind or "").strip() == "slide_designer"
        for s in specs
    ):
        return specs
    if isinstance(slide_designer_cfg, dict) and slide_designer_cfg.get("continuation"):
        return specs

    from oaao_orchestrator.slide_project.conversation_intent import (
        wants_slide_designer_inject,
    )

    template_selected = _slide_template_selected(slide_designer_cfg)
    user_msg = _last_user_message(messages or [])
    if not wants_slide_designer_inject(
        user_msg,
        slide_designer_cfg=slide_designer_cfg,
        plan_handbook_vol=_plan_signals_handbook_vol_teaching(specs),
    ):
        return specs

    if template_selected:
        logger.info(
            "inject_slide_designer_template template_id=%r user_snip=%r",
            (slide_designer_cfg or {}).get("template_id"),
            user_msg[:120],
        )
        ask_msg = _default_slide_designer_ask_message(user_msg, template_selected=True)
        slide_task = RunTaskSpec(
            id="rt-slide-designer-template",
            title="Slide designer (selected template)",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
            params={"requires_ask": True, "ask_message": ask_msg},
        )
    else:
        logger.info(
            "inject_slide_designer_teaching user_snip=%r plan_handbook_vol=%s",
            user_msg[:120],
            _plan_signals_handbook_vol_teaching(specs),
        )

        ask_msg = _default_slide_designer_ask_message(user_msg, template_selected=False)
        slide_task = RunTaskSpec(
            id="rt-slide-designer-teaching",
            title="Slide designer (handbook teaching)",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
            params={"requires_ask": True, "ask_message": ask_msg},
        )
    streams = [i for i, s in enumerate(specs) if s.type == RunTaskType.LLM_STREAM]
    insert_at = streams[0] if streams else len(specs)
    out = list(specs)
    out.insert(insert_at, slide_task)
    total = len(out)
    for idx, spec in enumerate(out, start=1):
        spec.index = idx
        spec.total = total
    return out


def inject_slide_designer_for_turn_intent(
    specs: list[RunTaskSpec],
    *,
    allowed_agents: list[str],
    messages: list[dict[str, Any]] | None,
    slide_designer_cfg: dict[str, Any] | None,
    req: object,
) -> list[RunTaskSpec]:
    """Append slide_designer when ``planning.intent`` scored slide need (promotional / generic decks)."""
    turn_intent = getattr(req, "turn_intent", None)
    if not isinstance(turn_intent, dict) or not turn_intent.get("needs_slide_designer"):
        return specs
    allowed_set = {a.strip() for a in allowed_agents if a.strip()}
    if "slide_designer" not in allowed_set:
        return specs
    if any(
        s.type == RunTaskType.AGENT and (s.agent_kind or "").strip() == "slide_designer"
        for s in specs
    ):
        return specs
    if isinstance(slide_designer_cfg, dict) and slide_designer_cfg.get("continuation"):
        return specs

    user_msg = _last_user_message(messages or [])
    template_selected = _slide_template_selected(slide_designer_cfg)
    if template_selected:
        ask_msg = _default_slide_designer_ask_message(user_msg, template_selected=True)
        slide_task = RunTaskSpec(
            id="rt-slide-designer-intent-template",
            title="Slide designer (selected template)",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
            params={"requires_ask": True, "ask_message": ask_msg},
        )
    else:
        logger.info("inject_slide_designer_turn_intent user_snip=%r", user_msg[:120])
        ask_msg = _default_slide_designer_ask_message(
            user_msg,
            template_selected=False,
            handbook=False,
        )
        slide_task = RunTaskSpec(
            id="rt-slide-designer-intent",
            title="Slide designer",
            type=RunTaskType.AGENT,
            agent_kind="slide_designer",
            params={"requires_ask": True, "ask_message": ask_msg},
        )
    streams = [i for i, s in enumerate(specs) if s.type == RunTaskType.LLM_STREAM]
    insert_at = streams[0] if streams else len(specs)
    out = list(specs)
    out.insert(insert_at, slide_task)
    total = len(out)
    for idx, spec in enumerate(out, start=1):
        spec.index = idx
        spec.total = total
    return out


def apply_slide_fanout_to_specs(
    specs: list[RunTaskSpec],
    messages: list[dict[str, Any]] | None,
    slide_designer_cfg: dict[str, Any] | None = None,
) -> list[RunTaskSpec]:
    from oaao_orchestrator.slide_project.fanout import expand_slide_designer_fanout

    continuation = _slide_continuation_mode(slide_designer_cfg)
    expanded = expand_slide_designer_fanout(
        specs,
        messages,
        continuation=continuation,
    )
    total = len(expanded)
    for idx, spec in enumerate(expanded, start=1):
        spec.index = idx
        spec.total = total
    return expanded


def apply_template_deck_plan_adjustments(
    specs: list[RunTaskSpec],
    slide_designer_cfg: dict[str, Any] | None,
) -> list[RunTaskSpec]:
    """When slide_designer builds the deck, skip generic compose prose in chat."""
    has_slide = any(
        s.type == RunTaskType.AGENT and (s.agent_kind or "").strip() == "slide_designer"
        for s in specs
    )
    if not has_slide:
        return specs
    return [s for s in specs if s.type != RunTaskType.LLM_STREAM]


def planner_output_to_run_plan(
    draft: PlannerOutputDraft,
    *,
    allowed_agents: list[str],
    require_vault: bool,
    require_attachments: bool,
    catalog: dict[str, AbilityHint] | None = None,
    messages: list[dict[str, Any]] | None = None,
    slide_designer_cfg: dict[str, Any] | None = None,
    conv_materials: list[Any] | None = None,
) -> RunPlan:
    from oaao_orchestrator.conversation_title import normalize_conversation_title

    slide_cfg = merge_planner_slide_intent(
        draft,
        slide_designer_cfg,
        conv_materials=conv_materials,
    )
    vault_scope = require_vault
    if bool(draft.needs_web_search) and not bool(draft.needs_vault_rag):
        require_vault = False
    else:
        require_vault = require_vault or bool(draft.needs_vault_rag)
    if vault_scope and _turn_reuses_prior_grounding(draft, slide_cfg):
        require_vault = True
    specs = _normalize_tasks(
        draft.tasks,
        allowed_agents=allowed_agents,
        require_vault=require_vault,
        require_attachments=require_attachments,
    )
    specs = inject_web_search_for_planner_intent(
        specs,
        allowed_agents=allowed_agents,
        needs_web_search=bool(draft.needs_web_search),
    )
    specs = inject_slide_designer_for_teaching_intent(
        specs,
        allowed_agents=allowed_agents,
        messages=messages,
        slide_designer_cfg=slide_cfg,
    )
    specs = ensure_slide_designer_requires_ask(
        specs,
        messages=messages,
        slide_designer_cfg=slide_cfg,
    )
    specs = apply_slide_continuation_to_specs(specs, slide_cfg)
    specs = apply_slide_fanout_to_specs(specs, messages, slide_cfg)
    specs = apply_template_deck_plan_adjustments(specs, slide_cfg)
    cat = catalog
    abilities = (
        list(draft.abilities)
        if draft.abilities
        else ability_hints_for(
            [s.agent_kind for s in specs if s.agent_kind],
            catalog=cat,
        )
    )
    apply_ids = [
        x.strip()
        for x in (draft.apply_skill_ids or [])
        if isinstance(x, str) and x.strip()
    ][:12]
    inf_delta = (
        dict(draft.inference_delta)
        if isinstance(draft.inference_delta, dict) and draft.inference_delta
        else None
    )
    return RunPlan(
        tasks=specs,
        abilities=abilities,
        report_after_task_ids=[x.strip() for x in draft.report_after if x.strip()],
        slide_designer=slide_cfg,
        conversation_title=normalize_conversation_title(draft.conversation_title) or None,
        apply_skill_ids=apply_ids,
        inference_delta=inf_delta,
    )


async def plan_run_with_llm(
    req: object,
    *,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
    allowed_agents: list[str],
) -> RunPlan | None:
    from oaao_orchestrator.planner import _composer_auto_vault_rag, _vault_rag_needed

    max_tasks = max(2, min(12, int(os.environ.get("OAAO_RUN_PLANNER_MAX_TASKS", "8"))))
    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    require_vault = _vault_rag_needed(req)
    require_attachments = bool(getattr(req, "chat_attachments", None) or [])

    catalog = catalog_from_request(req)
    agent_guide = planner_agent_guide(allowed_agents, catalog=catalog)

    conv_materials = getattr(req, "conversation_materials", None) or []
    material_lines: list[str] = []
    if isinstance(conv_materials, list):
        for row in conv_materials[:12]:
            if not isinstance(row, dict):
                continue
            mid = str(row.get("material_id") or "").strip()
            title = str(row.get("title") or "").strip()
            kind = str(row.get("kind") or "").strip()
            if not mid:
                continue
            meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
            pid = str(meta.get("project_id") or "").strip() if isinstance(meta, dict) else ""
            extra = f" project_id={pid}" if pid else ""
            material_lines.append(f"- {mid} ({kind or 'file'}): {title or mid}{extra}")

    composer_auto = _composer_auto_vault_rag(req)
    if composer_auto:
        vault_scope_flag = (
            "optional — Auto Source (no manual vault picks); set needs_vault_rag=true only "
            "for internal handbook/docs, not for public web/news/product launch questions"
        )
    else:
        vault_scope_flag = "yes" if require_vault else "no"
    flags = [
        f"vault_scope={vault_scope_flag}",
        f"attachments={'yes' if require_attachments else 'no'}",
        f"allowed_agents={', '.join(allowed_agents) or 'none'}",
    ]
    if bool(getattr(req, "enable_web_search", False)):
        flags.append(
            "composer_web_search=yes — user enabled Web search in composer; "
            "set needs_web_search=true unless the turn is vault-only handbook lookup",
        )
    turn_intent = getattr(req, "turn_intent", None)
    if isinstance(turn_intent, dict) and turn_intent.get("needs_web_search"):
        web_score = turn_intent.get("analysis", {})
        score_txt = ""
        if isinstance(web_score, dict):
            try:
                score_txt = f" web_search={float(web_score.get('web_search', 0)):.2f}"
            except (TypeError, ValueError):
                score_txt = ""
        flags.append(
            f"turn_intent_web_search=yes{score_txt} — planning.intent hook scored public-web need; "
            "set needs_web_search=true and needs_vault_rag=false unless vault handbook is also required",
        )
        cutoff_txt = str(turn_intent.get("llm_knowledge_cutoff") or "").strip()
        if cutoff_txt:
            flags.append(f"llm_knowledge_cutoff={cutoff_txt}")
    if composer_auto:
        flags.append(
            "composer_auto_source=yes — no manual vault picks; for public web/news/product "
            "launch questions set needs_web_search=true and needs_vault_rag=false; use "
            "needs_vault_rag=true only when the user needs internal handbook or uploaded docs",
        )
    sd_cfg = getattr(req, "slide_designer", None)
    if isinstance(sd_cfg, dict):
        tid = str(sd_cfg.get("template_id") or "").strip()
        if tid:
            flags.append(f"slide_template_id={tid}")
            flags.append(
                "slide_template_selected=yes — user chose a published PPTX template (template_id above); "
                "include slide_designer to build the deck. Set requires_ask=true on that slide_designer task "
                "unless the user explicitly asked to start building immediately (template choice is not consent)."
            )
        amid = str(sd_cfg.get("active_material_id") or "").strip()
        if amid:
            flags.append(f"composer_active_material_id={amid}")
        rid = str(sd_cfg.get("resume_project_id") or "").strip()
        if rid:
            flags.append(
                f"hint_resume_project_id={rid} (use slide_action continue/regenerate; do not assume)"
            )
        if amid or rid:
            flags.append(
                "turn_reuses_conversation_material=yes — refresh vault RAG when vault_scope=yes; "
                "set slide_action continue/regenerate and use_material_id when redoing a deck",
            )
        if sd_cfg.get("start_new_deck"):
            flags.append(
                "slide_start_new_deck=yes (published template chip — prefer slide_action=new unless user wants redo)"
            )
    if material_lines:
        flags.append("conversation_materials:\n" + "\n".join(material_lines))
        flags.append(
            "conversation_materials_note=catalog only (IDs/titles/project_id) — not vault passage text; "
            "on continue/regenerate/reuse set needs_vault_rag=true when vault_scope=yes and include vault_rag "
            "before slide_designer",
        )
    grounding = getattr(req, "conversation_material_grounding", None) or []
    if isinstance(grounding, list) and grounding:
        g_lines: list[str] = []
        for row in grounding[:8]:
            if not isinstance(row, dict):
                continue
            mid = str(row.get("material_id") or "").strip()
            title = str(row.get("title") or mid or "material").strip()
            kind = str(row.get("kind") or "").strip()
            if not mid and not title:
                continue
            extra = f" ({kind})" if kind else ""
            g_lines.append(f"- {mid or title}: {title}{extra}")
        if g_lines:
            flags.append("material_grounding_available=yes")
            flags.append(
                "material_grounding_note=prior-turn MD/RAG excerpts are already injected into the run "
                "(conversation material container); agents should use them while vault_rag may still refresh",
            )
            flags.append("material_grounding:\n" + "\n".join(g_lines))
    from oaao_orchestrator.micro_skills.registry import (
        catalog_from_request as micro_skills_catalog_from_request,
    )
    from oaao_orchestrator.micro_skills.registry import (
        catalog_summary_for_planner,
    )

    skill_entries = micro_skills_catalog_from_request(req)
    if skill_entries:
        flags.append("skills_catalog:\n" + catalog_summary_for_planner(skill_entries))
    planner_payload = getattr(req, "planner", None)
    messages = [
        {
            "role": "system",
            "content": _planner_system_prompt(
                allowed_agents=allowed_agents,
                max_tasks=max_tasks,
                agent_guide=agent_guide,
                planner_payload=planner_payload if isinstance(planner_payload, dict) else None,
            ),
        },
        {
            "role": "user",
            "content": "Plan tasks for this turn.\n"
            + "\n".join(flags)
            + f"\n\nUser message:\n{user_msg[:4000]}",
        },
    ]
    text = await llm_chat_completion_text(
        url=chat_completions_url,
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=0.15,
    )
    if not text:
        return None
    obj = _extract_json_object(text)
    if not obj:
        logger.warning("planner_json_parse_failed")
        return None
    try:
        draft = PlannerOutputDraft.model_validate(obj)
    except ValidationError:
        logger.warning("planner_schema_invalid")
        return None
    _apply_public_web_planner_overrides(req, draft)
    sd_cfg = getattr(req, "slide_designer", None)
    slide_cfg = sd_cfg if isinstance(sd_cfg, dict) else None
    require_vault_norm = False if composer_auto else require_vault
    return planner_output_to_run_plan(
        draft,
        allowed_agents=allowed_agents,
        require_vault=require_vault_norm,
        require_attachments=require_attachments,
        catalog=catalog,
        messages=list(getattr(req, "messages", []) or []),
        slide_designer_cfg=slide_cfg,
        conv_materials=conv_materials if isinstance(conv_materials, list) else None,
    )


async def plan_report_result_tasks(
    req: object,
    *,
    completed_task: RunTaskSpec,
    chat_completions_url: str,
    api_key: str | None,
    model: str,
    allowed_agents: list[str],
    remaining_tasks: list[RunTaskSpec],
) -> list[RunTaskSpec]:
    if any(t.type == RunTaskType.LLM_STREAM for t in remaining_tasks):
        # Already queued final answer.
        pass
    catalog = catalog_from_request(req)
    agent_guide = planner_agent_guide(allowed_agents, catalog=catalog)
    user_msg = _last_user_message(getattr(req, "messages", []) or [])
    messages = [
        {"role": "system", "content": _report_system_prompt(agent_guide=agent_guide)},
        {
            "role": "user",
            "content": (
                f"Completed task: {completed_task.id} ({completed_task.type}) — {completed_task.title}\n"
                f"Remaining queued: {[t.id + ':' + str(t.type) for t in remaining_tasks]}\n"
                f"User message:\n{user_msg[:3000]}"
            ),
        },
    ]
    text = await llm_chat_completion_text(
        url=chat_completions_url,
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=0.1,
        timeout_s=45.0,
        max_tokens=_planner_max_tokens(),
    )
    if not text:
        return []
    obj = _extract_json_object(text)
    if not obj:
        return []
    try:
        draft = ReportResultDraft.model_validate(obj)
    except ValidationError:
        return []

    plan = planner_output_to_run_plan(
        PlannerOutputDraft(tasks=draft.append),
        allowed_agents=allowed_agents,
        require_vault=False,
        require_attachments=False,
        catalog=catalog,
    )
    # Report pass must not inject llm_stream or duplicate vault if already done.
    out = [t for t in plan.tasks if t.type != RunTaskType.LLM_STREAM]
    if completed_task.type == RunTaskType.VAULT_RAG:
        out = [t for t in out if t.type != RunTaskType.VAULT_RAG]
    return out
