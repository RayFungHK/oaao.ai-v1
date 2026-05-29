"""UX-1 — Personalization survey wizard (random theme → 3 param options → fine-tune)."""

from __future__ import annotations

import json
import logging
import random
from typing import Any

import httpx

from oaao_orchestrator.corpus.llm import _extract_json_array, _extract_json_object, chat_completion_text
from oaao_orchestrator.preference_profile import (
    align_guided_option_id,
    derive_preference_profile_from_guided,
)

logger = logging.getLogger(__name__)

# theme_id → (label_en, scenario_prompt_en)
_THEME_SCENARIOS: dict[str, tuple[str, str]] = {
    "daily": (
        "Daily life",
        "A friend asks you for advice: they want to plan a relaxed weekend trip nearby. "
        "In 2–3 short sentences, suggest how you would help them decide.",
    ),
    "corporate": (
        "Workplace",
        "Your team lead asks you to open a weekly sync. "
        "In 2–3 short sentences, explain how you would kick off the meeting.",
    ),
    "research": (
        "Research",
        "A colleague with no technical background asks about a surprising result in your project. "
        "In 2–3 short sentences, explain how you would respond.",
    ),
}

_THEME_LABELS_ZH: dict[str, str] = {
    "daily": "日常生活",
    "corporate": "職場",
    "research": "研究",
}

_THEME_SCENARIOS_ZH: dict[str, str] = {
    "daily": (
        "朋友請你幫忙：想規劃一個輕鬆的週末短途旅行。"
        "請用 2–3 句簡短說明你會如何協助他們做決定。"
    ),
    "corporate": (
        "團隊主管請你主持每週例會開場。"
        "請用 2–3 句簡短說明你會如何開始這場會議。"
    ),
    "research": (
        "一位非技術背景的同事詢問專案中一個出乎意料的結果。"
        "請用 2–3 句簡短說明你會如何回應。"
    ),
}

_OPTION_IDS = ("option_a", "option_b", "option_c")

_PROFILE_DEFAULTS: dict[str, dict[str, float | int]] = {
    "option_a": {"temperature": 0.3, "top_p": 0.8, "presence_penalty": 0.0, "max_tokens": 256},
    "option_b": {"temperature": 0.9, "top_p": 0.95, "frequency_penalty": 0.5, "max_tokens": 256},
    "option_c": {"temperature": 0.1, "top_p": 0.5, "top_k": 20, "presence_penalty": 0.2, "max_tokens": 256},
}


def _locale_is_zh(locale: str) -> bool:
    loc = (locale or "en").strip().lower().replace("_", "-")
    return loc.startswith("zh")


def _localized_theme_fields(theme_id: str, locale: str) -> tuple[str, str]:
    if theme_id not in _THEME_SCENARIOS:
        return ("Custom", "")
    label_en, scenario_en = _THEME_SCENARIOS[theme_id]
    if _locale_is_zh(locale):
        return (
            _THEME_LABELS_ZH.get(theme_id, label_en),
            _THEME_SCENARIOS_ZH.get(theme_id, scenario_en),
        )
    return (label_en, scenario_en)


def pick_random_theme(locale: str = "en") -> dict[str, str]:
    theme_id = random.choice(list(_THEME_SCENARIOS.keys()))
    label, scenario = _localized_theme_fields(theme_id, locale)
    return {
        "theme_id": theme_id,
        "theme_label": label,
        "scenario_prompt": scenario,
    }


def _llm_ready(llm_cfg: dict[str, Any] | None) -> bool:
    return bool(
        llm_cfg
        and str(llm_cfg.get("base_url") or "").strip()
        and str(llm_cfg.get("model") or "").strip()
    )


def _clamp_params(raw: dict[str, Any]) -> dict[str, float | int]:
    out: dict[str, float | int] = {}

    def _f(key: str, lo: float, hi: float) -> None:
        v = raw.get(key)
        if v is None or v == "":
            return
        try:
            n = float(v)
        except (TypeError, ValueError):
            return
        out[key] = round(max(lo, min(hi, n)), 3 if key != "top_k" else 0)

    _f("temperature", 0.0, 2.0)
    _f("top_p", 0.0, 1.0)
    if "top_k" in raw:
        try:
            k = int(float(raw["top_k"]))
            out["top_k"] = max(1, min(200, k))
        except (TypeError, ValueError):
            pass
    _f("presence_penalty", -2.0, 2.0)
    _f("frequency_penalty", -2.0, 2.0)
    if "max_tokens" in raw:
        try:
            mt = int(float(raw["max_tokens"]))
            out["max_tokens"] = max(256, min(8192, mt))
        except (TypeError, ValueError):
            pass
    return out


def _parse_options_rows(text: str) -> list[dict[str, Any]]:
    obj = _extract_json_object(text or "")
    if isinstance(obj, dict):
        for key in ("options", "samples", "choices", "items"):
            val = obj.get(key)
            if isinstance(val, list):
                return [r for r in val if isinstance(r, dict)]
    rows = _extract_json_array(text or "")
    if isinstance(rows, list):
        return [r for r in rows if isinstance(r, dict)]
    return []


def _normalize_option(row: dict[str, Any], *, index: int = 0) -> dict[str, Any] | None:
    oid = str(row.get("id") or row.get("option_id") or "").strip()
    if oid not in _OPTION_IDS and 0 <= index < len(_OPTION_IDS):
        oid = _OPTION_IDS[index]
    if oid not in _OPTION_IDS:
        return None
    text = str(row.get("text") or row.get("sample") or row.get("reply") or "").strip()
    if not text:
        return None
    mp_raw = row.get("model_params") or row.get("params") or row.get("inference")
    if not isinstance(mp_raw, dict):
        mp_raw = {
            k: row[k]
            for k in (
                "temperature",
                "top_p",
                "top_k",
                "presence_penalty",
                "frequency_penalty",
                "max_tokens",
            )
            if k in row
        }
    params = _clamp_params(mp_raw if isinstance(mp_raw, dict) else {})
    if not params:
        params = dict(_PROFILE_DEFAULTS.get(oid, {}))
    if not params:
        return None
    return {
        "id": oid,
        "style_label": str(row.get("style_label") or row.get("label") or oid).strip() or oid,
        "text": text[:1200],
        "model_params": params,
    }


def _fallback_options(theme: dict[str, str], locale: str) -> list[dict[str, Any]]:
    """Deterministic three options when the LLM JSON is incomplete."""
    zh = _locale_is_zh(locale)
    scenario = str(theme.get("scenario_prompt") or "")
    if zh:
        packs = (
            (
                "option_a",
                "穩健直率",
                "我可以先問你偏好的氛圍（例如親近自然或小城鎮），再幫你縮小選項並推薦在地好去處。",
            ),
            (
                "option_b",
                "創意熱情",
                "聽起來很棒！我們可以一起腦力激盪幾個夢幻目的地，再幫你找出獨特、少人知的亮點。",
            ),
            (
                "option_c",
                "分析精準",
                "我會依交通時間與放鬆因素評估附近目的地，再提供結構化比較，協助你做出選擇。",
            ),
        )
    else:
        packs = (
            (
                "option_a",
                "Reliable & Direct",
                "I can help you narrow down options by asking about your preferred vibe, like nature or a cozy town. "
                "Once we pick a direction, I'll find the best local spots for you.",
            ),
            (
                "option_b",
                "Creative & Enthusiastic",
                "Oh, that sounds lovely! Let's brainstorm some dreamy destinations based on what makes you feel most relaxed. "
                "I'll pull up some unique, hidden gems to make it special!",
            ),
            (
                "option_c",
                "Analytical & Precise",
                "To assist, I will evaluate nearby destinations based on travel time and relaxation factors. "
                "I can then present a structured comparison of your best options.",
            ),
        )
    out: list[dict[str, Any]] = []
    for oid, label, text in packs:
        params = dict(_PROFILE_DEFAULTS.get(oid, {}))
        if not params:
            continue
        out.append(
            {
                "id": oid,
                "style_label": label,
                "text": text if scenario else text,
                "model_params": params,
            },
        )
    return out


def _merge_options_with_fallback(
    parsed: list[dict[str, Any]],
    theme: dict[str, str],
    locale: str,
) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    for i, row in enumerate(parsed):
        norm = _normalize_option(row, index=i)
        if norm is not None:
            options.append(norm)

    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for opt in options:
        if opt["id"] in seen:
            continue
        seen.add(opt["id"])
        deduped.append(opt)

    if len(deduped) >= 3:
        return deduped[:3]

    for fb in _fallback_options(theme, locale):
        if fb["id"] in seen:
            continue
        seen.add(fb["id"])
        deduped.append(fb)
        if len(deduped) >= 3:
            break

    return deduped[:3]


async def run_personalization_survey_samples(payload: dict[str, Any]) -> dict[str, Any]:
    """Step 2 API: random theme (unless provided) + exactly 3 options with distinct model_params."""
    llm_cfg = payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None
    if not _llm_ready(llm_cfg):
        return {"ok": False, "error": "llm_not_configured"}

    locale = str(payload.get("locale") or "en").strip() or "en"
    theme_in = str(payload.get("theme_id") or "").strip()
    scenario_in = str(payload.get("scenario_prompt") or "").strip()

    if theme_in in _THEME_SCENARIOS:
        theme_label, scenario = _localized_theme_fields(theme_in, locale)
        theme = {
            "theme_id": theme_in,
            "theme_label": theme_label,
            "scenario_prompt": scenario_in or scenario,
        }
    elif scenario_in:
        theme = {
            "theme_id": "custom",
            "theme_label": "自訂" if _locale_is_zh(locale) else "Custom",
            "scenario_prompt": scenario_in,
        }
    else:
        theme = pick_random_theme(locale)

    scenario = theme["scenario_prompt"]
    theme_id = theme["theme_id"]
    theme_label = theme["theme_label"]

    lang_rule = (
        "Write style_label and text in Traditional Chinese (繁體中文)."
        if _locale_is_zh(locale)
        else "Write style_label and text in English."
    )

    system = (
        "You design a personalization wizard for chat inference parameters. "
        "Return JSON only — no markdown fences."
    )
    user = (
        f"Locale: {locale}\n"
        f"{lang_rule}\n"
        f"Theme category: {theme_label} ({theme_id})\n\n"
        f"User scenario (assistant should respond to this):\n{scenario}\n\n"
        "Create exactly 3 DISTINCT options. Each option must:\n"
        "1) Use a clearly different inference profile (temperature, top_p, penalties — spread them apart).\n"
        "2) Include a 1–3 sentence sample reply matching that profile for the scenario.\n"
        "3) Use ids option_a, option_b, option_c exactly once each.\n\n"
        "Return either a JSON array of 3 objects OR one object with an \"options\" array:\n"
        '[{"id":"option_a","style_label":"<short label>","text":"<reply>",'
        '"model_params":{"temperature":0.7,"top_p":0.9,...}}, ...]\n'
        "model_params may include: temperature, top_p, top_k, presence_penalty, "
        "frequency_penalty, max_tokens (all numeric)."
    )

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            text = await chat_completion_text(
                client,
                llm_cfg=llm_cfg,
                system=system,
                user=user,
                temperature=0.75,
            )
    except Exception as exc:
        logger.exception("personalization_survey_samples_failed")
        return {"ok": False, "error": str(exc) or "samples_failed"}

    rows = _parse_options_rows(text or "")
    deduped = _merge_options_with_fallback(rows, theme, locale)

    if len(deduped) < 3:
        logger.warning(
            "personalization_survey_samples_insufficient options=%s raw=%s",
            len(deduped),
            (text or "")[:300],
        )
        return {"ok": False, "error": "invalid_options_json", "raw": (text or "")[:500]}

    if len(rows) < 3:
        logger.info("personalization_survey_samples_used_fallback parsed=%s", len(rows))

    return {
        "ok": True,
        "theme_id": theme_id,
        "theme_label": theme_label,
        "scenario_prompt": scenario,
        "options": deduped[:3],
        # Legacy alias for older clients
        "samples": deduped[:3],
    }


def _normalize_user_adjustments(raw: Any) -> dict[str, float | int | None]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, float | int | None] = {}
    for key in (
        "temperature",
        "top_p",
        "top_k",
        "presence_penalty",
        "frequency_penalty",
        "max_tokens",
    ):
        if key not in raw:
            continue
        v = raw[key]
        if v is None or v == "":
            out[key] = None
            continue
        try:
            if key in ("max_tokens", "top_k"):
                out[key] = int(float(v))
            else:
                out[key] = float(v)
        except (TypeError, ValueError):
            continue
    return out


def _merge_finalize_params(
    base: dict[str, float | int],
    user_adj: dict[str, float | int | None],
) -> dict[str, float | int]:
    merged: dict[str, Any] = dict(base)
    for key, val in user_adj.items():
        if val is None:
            merged.pop(key, None)
        else:
            merged[key] = val
    return _clamp_params(merged)


def _find_option_row(raw_samples: list[Any], selected_id: str) -> dict[str, Any] | None:
    for row in raw_samples:
        if not isinstance(row, dict):
            continue
        if str(row.get("id") or "").strip() == selected_id:
            return row
    return None


def _fallback_finalize_params(
    selected_row: dict[str, Any],
    user_adj: dict[str, float | int | None],
) -> dict[str, float | int]:
    mp = selected_row.get("model_params")
    base: dict[str, Any] = mp if isinstance(mp, dict) else {}
    if not base:
        oid = str(selected_row.get("id") or "").strip()
        base = dict(_PROFILE_DEFAULTS.get(oid, _PROFILE_DEFAULTS["option_a"]))
    params = _clamp_params(base)
    if user_adj:
        return _merge_finalize_params(params, user_adj)
    return params


GUIDED_SURVEY_TOTAL = 5

# Partial inference hints per guided option (merged at finalize).
_GUIDED_PARAM_HINTS: dict[str, dict[str, float | int]] = {
    "q1_concise": {"temperature": 0.25, "top_p": 0.75, "max_tokens": 512},
    "q1_balanced": {"temperature": 0.55, "top_p": 0.88, "max_tokens": 1024},
    "q1_detailed": {"temperature": 0.65, "top_p": 0.92, "max_tokens": 2048},
    "q1_very_detailed": {"temperature": 0.7, "top_p": 0.95, "max_tokens": 3072},
    "q2_factual": {"temperature": 0.2, "top_p": 0.7, "presence_penalty": 0.1},
    "q2_balanced": {"temperature": 0.55, "top_p": 0.9},
    "q2_creative": {"temperature": 0.95, "top_p": 0.98, "frequency_penalty": 0.35},
    "q2_playful": {"temperature": 1.1, "top_p": 0.99, "frequency_penalty": 0.55},
    "q3_steady": {"frequency_penalty": 0.0, "presence_penalty": 0.0},
    "q3_mixed": {"frequency_penalty": 0.25, "presence_penalty": 0.15},
    "q3_varied": {"frequency_penalty": 0.55, "presence_penalty": 0.35},
    "q4_brief": {"max_tokens": 768, "presence_penalty": -0.1},
    "q4_balanced": {"max_tokens": 1536},
    "q4_thorough": {"max_tokens": 3072, "presence_penalty": 0.25},
    "q5_steady": {"temperature": 0.35, "top_p": 0.82, "top_k": 40, "max_tokens": 1536},
    "q5_expressive": {"temperature": 0.92, "top_p": 0.97, "frequency_penalty": 0.45, "max_tokens": 2048},
}


def _normalize_guided_answers(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        oid = str(row.get("id") or row.get("option_id") or "").strip()
        if not oid:
            continue
        out.append(
            {
                "id": oid,
                "label": str(row.get("label") or "").strip(),
                "step_index": int(row.get("step_index") or len(out)),
            },
        )
    return out


def _guided_scores(answers: list[dict[str, Any]]) -> dict[str, float]:
    """Axis scores in [0,1] from cumulative picks (higher = more expressive / longer / varied)."""
    scores = {"length": 0.45, "creativity": 0.45, "variety": 0.45, "depth": 0.45}
    for row in answers:
        oid = str(row.get("id") or "")
        if oid.startswith("q1_"):
            scores["length"] = {
                "q1_concise": 0.15,
                "q1_balanced": 0.45,
                "q1_detailed": 0.72,
                "q1_very_detailed": 0.92,
            }.get(oid, scores["length"])
        elif oid.startswith("q2_"):
            scores["creativity"] = {
                "q2_factual": 0.12,
                "q2_balanced": 0.48,
                "q2_creative": 0.78,
                "q2_playful": 0.95,
            }.get(oid, scores["creativity"])
        elif oid.startswith("q3_"):
            scores["variety"] = {
                "q3_steady": 0.18,
                "q3_mixed": 0.5,
                "q3_varied": 0.88,
            }.get(oid, scores["variety"])
        elif oid.startswith("q4_"):
            scores["depth"] = {
                "q4_brief": 0.2,
                "q4_balanced": 0.5,
                "q4_thorough": 0.9,
            }.get(oid, scores["depth"])
    return scores


def _merge_param_hints_from_answers(answers: list[dict[str, Any]]) -> dict[str, float | int]:
    merged: dict[str, Any] = {}
    for row in answers:
        oid = str(row.get("id") or "")
        hint = _GUIDED_PARAM_HINTS.get(oid)
        if hint:
            merged.update(hint)
        mp = row.get("model_params")
        if isinstance(mp, dict):
            merged.update(mp)
    return _clamp_params(merged)


def _resolve_guided_theme(payload: dict[str, Any], locale: str) -> dict[str, str]:
    """One shared scenario per wizard run (step 0 picks random theme unless client sends theme)."""
    theme_in = str(payload.get("theme_id") or "").strip()
    scenario_in = str(payload.get("scenario_prompt") or "").strip()
    if theme_in in _THEME_SCENARIOS:
        theme_label, scenario = _localized_theme_fields(theme_in, locale)
        return {
            "theme_id": theme_in,
            "theme_label": theme_label,
            "scenario_prompt": scenario_in or scenario,
        }
    if scenario_in:
        return {
            "theme_id": "custom",
            "theme_label": "自訂" if _locale_is_zh(locale) else "Custom",
            "scenario_prompt": scenario_in,
        }
    return pick_random_theme(locale)


def _option_sample_text(row: dict[str, Any]) -> str:
    return str(row.get("sample") or row.get("text") or row.get("reply") or "").strip()


def _fallback_option_sample(
    option_id: str,
    theme_id: str,
    locale: str,
    *,
    label: str = "",
) -> str:
    """Deterministic assistant reply samples for the shared scenario (no LLM)."""
    zh = _locale_is_zh(locale)
    tid = theme_id if theme_id in _THEME_SCENARIOS else "daily"

    if zh:
        daily = {
            "q1_concise": "週末想放鬆：先定「車程不超過 1.5 小時」，通常就能縮到 2–3 個好點。",
            "q1_balanced": "我們可以從親近自然、小鎮散步、市區看展各排一個方向，我幫你比時間與預算。",
            "q1_detailed": "先問你偏好早起或睡飽、預算與交通，再給兩條路線的時間表、花費與雨天備案。",
            "q1_very_detailed": "可分三天節奏：交通入住、主活動餐飲、緩衝返程，並附 checklist 與備選景點。",
            "q2_factual": "依你提供的日期，附近 90 分鐘內有三個公園客流較低，按距離排序如下……",
            "q2_balanced": "聽起來不錯！我會先確認你想省錢還是省時間，再給兩套週末安排。",
            "q2_creative": "太棒了！我們可以腦力激盪「秘境咖啡」「夕陽步道」這類點子，再挑 2 個最順路的。",
            "q2_playful": "週末出逃計畫啟動！先選「躺平系」還是「暴走系」，我再幫你配美食與驚喜小站～",
            "q3_steady": "建議路線：A 公園 → B 老街午餐 → C 咖啡。需要我幫你查營業時間嗎？",
            "q3_mixed": "今天可以走「自然 + 小鎮」組合；下次若想省車程，也能改成市區一日遊。",
            "q3_varied": "這次用「海邊晨走 + 午後市集」；下次你想試「山林溫泉」我也能換個版本。",
            "q4_brief": "好的，定下目的地後跟我說，我再補一條交通提醒。",
            "q4_balanced": "若你選 A，我建議週六出發；並附上停車與票務連結，需要嗎？",
            "q4_thorough": "我會整理：交通、住宿、餐廳預約、備用雨天方案與預算表，你確認後就能出發。",
            "q5_steady": "我可以先問你偏好的氛圍（自然或小城），再縮小選項並推薦在地好去處。",
            "q5_expressive": "聽起來很棒！我們一起腦力激盪幾個夢幻點子，再找出少人知的亮點！",
        }
        corporate = {
            "q1_concise": "例會開場：本週三件重點、一個風險、需要決策的一項 — 十分鐘內結束。",
            "q1_balanced": "開場先同步目標與議程，再請各組 2 分鐘更新，最後留 5 分鐘決策與行動項。",
            "q1_detailed": "我會用議程表帶：上週行動項回顧、指標、阻塞、資源需求，並在結尾確認 owner 與 deadline。",
            "q1_very_detailed": "完整開場含：背景、OKR 進度、跨組依賴、風險登錄、決策記錄模板與會後 follow-up 清單。",
            "q2_factual": "本週數據：交付率 92%、阻塞 2 件；建議優先處理客戶 A 的整合問題。",
            "q2_balanced": "大家辛苦了。我們先慶祝小勝，再聚焦兩個阻塞 — 我有一個分擔人力建議。",
            "q2_creative": "不如把例會變「站立 + 速寫牆」：用視覺化把阻塞畫出來，或許能激發新解法。",
            "q2_playful": "歡迎來到本週闖關現場！先來個 30 秒暖場，再一起把「魔王關卡」拆解掉！",
            "q3_steady": "議程：1) 目標 2) 進度 3) 風險 4) 決策 — 與上週格式相同。",
            "q3_mixed": "今天用時間軸敘述進度；下週若趕時間，可改回條列重點版。",
            "q3_varied": "這週用故事線開場；下週可換成儀表板數字開場，保持新鮮感。",
            "q4_brief": "收到，決策後我會把會議紀要一頁摘要寄出。",
            "q4_balanced": "我會在會後整理 action items，並在 Slack 釘選連結與負責人。",
            "q4_thorough": "會後我提供：決策記錄、風險更新、依賴圖、下週檢查點與模板連結。",
            "q5_steady": "我會依議程主持：先目標、再進度、最後決策與行動項，保持節奏清楚。",
            "q5_expressive": "讓我們用能量滿滿的開場帶動討論，再把點子收斂成可執行的下一步！",
        }
        research = {
            "q1_concise": "那個異常值可能來自樣本偏差；建議先重跑對照組再解釋給同事。",
            "q1_balanced": "結果意外但合理：可能是季節因素。我會用兩句話說明圖表，再給一個下一步。",
            "q1_detailed": "我會用「發生了什麼 → 可能原因 → 我們多確定」三段，附一張簡圖給非技術同事。",
            "q1_very_detailed": "完整說明含：實驗設計、對照、統計顯著性、限制、建議驗證實驗與白話摘要。",
            "q2_factual": "圖表顯示處理組 +8%，p<0.05；最可能原因是參數 X 的閾值改變。",
            "q2_balanced": "這個發現很有趣。我們可以先向同事展示趨勢，再一起設計一個小實驗驗證。",
            "q2_creative": "如果把異常當線索，或許能導向新假設 — 我腦中有兩個便宜驗證法。",
            "q2_playful": "數據在跟我們說悄悄話！我們來玩「兩分鐘假說接龍」，看哪個最值得一試～",
            "q3_steady": "解釋結構固定：現象 → 原因 → 建議；每次會議都用同一套。",
            "q3_mixed": "今天用圖表開場；下次可用類比故事，但結尾仍回到三點結論。",
            "q3_varied": "這次用比喻「像溫度計」；下次可換成流程圖，幫不同背景的人理解。",
            "q4_brief": "若需要，我可以把一頁摘要寄給相關人。",
            "q4_balanced": "我會附簡圖與 FAQ 兩則，並約 15 分鐘 walkthrough。",
            "q4_thorough": "我準備：簡報、方法附錄、限制說明、建議實驗清單與給主管的一頁版。",
            "q5_steady": "我會依交通時間與放鬆因素評估選項，再提供結構化比較協助你決定。",
            "q5_expressive": "我們可以腦力激盪幾個方向，再找出獨特、少人知的亮點來驗證！",
        }
        bank = {"daily": daily, "corporate": corporate, "research": research}.get(tid, daily)
    else:
        daily = {
            "q1_concise": "For a relaxed weekend, cap drive time at 90 minutes — that usually leaves 2–3 solid picks.",
            "q1_balanced": "We can compare nature, small-town, or city options on time, cost, and vibe.",
            "q1_detailed": "I'll ask sleep style, budget, and transport, then share two itineraries with rain backups.",
            "q1_very_detailed": "A 3-day rhythm plan with checklists, backups, and return-day buffer — want that format?",
            "q2_factual": "Three low-crowd parks within 90 minutes, sorted by distance — dates pending your pick.",
            "q2_balanced": "Sounds good — tell me save-money vs save-time and I'll propose two weekend paths.",
            "q2_creative": "Love it! Let's brainstorm hidden cafés and sunset trails, then pick the two easiest combos.",
            "q2_playful": "Weekend escape mode on! Couch-potato or adventure arc — I'll match food and surprise stops.",
            "q3_steady": "Route: Park A → lunch on Main St → café C. Want me to check hours?",
            "q3_mixed": "This time nature + town; next time we can swap to a city-only day if you prefer.",
            "q3_varied": "Today: coastal walk + market; next trip I can pitch hot-spring hills instead.",
            "q4_brief": "Once you pick, ping me — I'll add one transit note.",
            "q4_balanced": "If you choose A, I'd leave Saturday open and share parking + ticket links.",
            "q4_thorough": "I'll bundle transit, lodging, reservations, rain plan, and a budget sheet to confirm.",
            "q5_steady": "I'll ask your vibe (nature vs cozy town), narrow options, and recommend local spots.",
            "q5_expressive": "Let's brainstorm dreamy ideas and pull a few unique, low-crowd gems!",
        }
        bank = daily

    if option_id in bank:
        return bank[option_id]

    label_l = label.lower()
    if zh:
        if "條列" in label or "list" in label_l:
            return "① 先定目標 ② 列 2–3 方案 ③ 比時間/預算 ④ 你選定後我再補細節。"
        if "敘事" in label or "narrat" in label_l:
            return "想像週六早上出發、中午在小巷吃午餐、傍晚看夕陽 — 一路都很順的路線其實是……"
        if "對話" in label or "convers" in label_l or "互動" in label:
            return "嘿，週末想出門嗎？你比較想「躺平」還是「小冒險」？我先聽你說～"
        return f"（範例）若採「{label or option_id}」風格，我會針對同一情境用對應語氣回覆 2–3 句。"
    if "list" in label_l or "bullet" in label_l:
        return "1) Goal 2) Options 3) Trade-offs 4) Your pick — then I'll add details."
    if "narrat" in label_l or "story" in label_l:
        return "Picture Saturday morning out, lunch in the old town, sunset on the coast — here's the smooth path…"
    if "convers" in label_l or "chat" in label_l:
        return "Hey — weekend mood: chill or mini-adventure? Tell me what sounds good first."
    return f"(Sample) With “{label or option_id}”, I'd answer the same situation in that style."


def _ensure_option_samples(
    options: list[dict[str, Any]],
    ref_options: list[dict[str, Any]],
    theme: dict[str, str],
    step_index: int,
) -> list[dict[str, Any]]:
    locale = str(theme.get("locale") or "en")
    for opt in options:
        if _option_sample_text(opt):
            continue
        oid = str(opt.get("id") or "")
        ref = next((r for r in ref_options if str(r.get("id")) == oid), None)
        if ref and _option_sample_text(ref):
            opt["sample"] = _option_sample_text(ref)
            continue
        opt["sample"] = _fallback_option_sample(
            oid,
            str(theme.get("theme_id") or "daily"),
            locale,
            label=str(opt.get("label") or ""),
        )
    return options


def _guided_step_payload(
    *,
    step_index: int,
    theme: dict[str, str],
    raw_fallback: dict[str, Any],
    options: list[dict[str, Any]],
    source: str,
    locale: str,
    prompt: str = "",
    answers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    theme_out = {
        "theme_id": theme["theme_id"],
        "theme_label": theme["theme_label"],
        "scenario_prompt": theme["scenario_prompt"],
    }
    ref = raw_fallback.get("options") if isinstance(raw_fallback.get("options"), list) else []
    theme_loc = {**theme, "locale": locale}
    opts = _ensure_option_samples(list(options), ref, theme_loc, step_index)
    cumulative = _merge_param_hints_from_answers(_normalize_guided_answers(answers))
    return {
        "ok": True,
        "step_index": step_index,
        "total_steps": GUIDED_SURVEY_TOTAL,
        "phase": raw_fallback.get("phase", "question"),
        "prompt": prompt or str(raw_fallback.get("prompt") or ""),
        "options": opts,
        "option_count": len(opts),
        "narrowed": bool(raw_fallback.get("narrowed")),
        "source": source,
        "cumulative_model_params": cumulative,
        **theme_out,
    }


def _fallback_guided_step(step_index: int, answers: list[dict[str, Any]], locale: str) -> dict[str, Any]:
    zh = _locale_is_zh(locale)
    scores = _guided_scores(answers)
    spread = max(scores.values()) - min(scores.values())
    narrow = step_index >= 3 or spread < 0.22

    if step_index == 0:
        prompt = (
            "你希望助理回覆時，篇幅通常多長？"
            if zh
            else "How long should the assistant’s replies usually be?"
        )
        options = [
            ("q1_concise", "簡短扼要", "Keep it short — a few sentences is enough."),
            ("q1_balanced", "適中", "Medium length — enough detail without rambling."),
            ("q1_detailed", "較詳盡", "Fairly detailed when it helps."),
            ("q1_very_detailed", "非常詳盡", "Thorough explanations when needed."),
        ]
        if zh:
            options = [
                ("q1_concise", "簡短扼要", "幾句話就夠，重點清楚。"),
                ("q1_balanced", "適中", "有細節但不囉嗦。"),
                ("q1_detailed", "較詳盡", "需要時會多解釋一些。"),
                ("q1_very_detailed", "非常詳盡", "願意深入說明步驟與理由。"),
            ]
    elif step_index == 1:
        prompt = (
            "回覆的「創意／想像力」你偏好哪一種？"
            if zh
            else "How creative or imaginative should replies feel?"
        )
        if scores["length"] < 0.35:
            options = [
                ("q2_factual", "偏事實穩健", "Stick to facts; minimal flair."),
                ("q2_balanced", "平衡", "Clear and practical with a little warmth."),
                ("q2_creative", "較有創意", "More ideas and fresh angles."),
            ]
            if zh:
                options = [
                    ("q2_factual", "偏事實穩健", "以事實與步驟為主，少花俏。"),
                    ("q2_balanced", "平衡", "清楚實用，帶一點溫度。"),
                    ("q2_creative", "較有創意", "多一點想法與新角度。"),
                ]
        else:
            options = [
                ("q2_balanced", "平衡", "Practical with some personality."),
                ("q2_creative", "較有創意", "Brainstorm-friendly and lively."),
                ("q2_playful", "活潑有趣", "Light, enthusiastic tone when fitting."),
            ]
            if zh:
                options = [
                    ("q2_balanced", "平衡", "實用為主，也有一點個性。"),
                    ("q2_creative", "較有創意", "適合腦力激盪、語氣活潑。"),
                    ("q2_playful", "活潑有趣", "合適時會輕鬆、有熱情。"),
                ]
    elif step_index == 2:
        prompt = (
            "用詞與句式你比較喜歡哪種？"
            if zh
            else "Do you prefer steady wording or more variety?"
        )
        options = [
            ("q3_steady", "穩定一致", "Same calm tone and structure each time."),
            ("q3_mixed", "適度變化", "Mostly consistent with occasional variety."),
            ("q3_varied", "多樣變化", "Noticeably different phrasing across replies."),
        ]
        if zh:
            options = [
                ("q3_steady", "穩定一致", "語氣與結構每次都差不多。"),
                ("q3_mixed", "適度變化", "大致一致，偶爾換個說法。"),
                ("q3_varied", "多樣變化", "每次用詞與句式明顯不同。"),
            ]
    elif step_index == 3:
        prompt = (
            "遇到需要跟進時，助理應該多「主動展開」還是「點到為止」？"
            if zh
            else "When follow-up helps, how deep should the assistant go?"
        )
        if narrow and scores["depth"] > 0.55:
            options = [
                ("q4_balanced", "平衡", "Follow up when useful, not excessive."),
                ("q4_thorough", "深入展開", "Proactive detail and next steps."),
            ]
            if zh:
                options = [
                    ("q4_balanced", "平衡", "有需要才延伸，不囉嗦。"),
                    ("q4_thorough", "深入展開", "主動補充細節與下一步。"),
                ]
        elif narrow:
            options = [
                ("q4_brief", "點到為止", "Short follow-ups only."),
                ("q4_balanced", "平衡", "Follow up when it clearly helps."),
            ]
            if zh:
                options = [
                    ("q4_brief", "點到為止", "跟進簡短就好。"),
                    ("q4_balanced", "平衡", "有幫助時才多說一點。"),
                ]
        else:
            options = [
                ("q4_brief", "點到為止", "Brief follow-ups."),
                ("q4_balanced", "平衡", "Balanced follow-through."),
                ("q4_thorough", "深入展開", "Thorough follow-ups and structure."),
            ]
            if zh:
                options = [
                    ("q4_brief", "點到為止", "跟進簡短就好。"),
                    ("q4_balanced", "平衡", "有需要才適度延伸。"),
                    ("q4_thorough", "深入展開", "願意主動補充與整理。"),
                ]
    else:
        prompt = (
            "最後請在兩種整體風格中選一個（我們會自動設定參數，無需手動調滑桿）。"
            if zh
            else "Pick one of two overall styles — we’ll set parameters for you (no manual sliders)."
        )
        steady_mp = _GUIDED_PARAM_HINTS["q5_steady"]
        expressive_mp = _GUIDED_PARAM_HINTS["q5_expressive"]
        base = _merge_param_hints_from_answers(answers)
        if scores["creativity"] + scores["variety"] > 1.05:
            options = [
                (
                    "q5_expressive",
                    "熱情夥伴" if zh else "Warm partner",
                    "Enthusiastic, varied, idea-friendly tone." if not zh else "熱情、多變、適合腦力激盪的語氣。",
                    _clamp_params({**base, **expressive_mp}),
                ),
                (
                    "q5_steady",
                    "穩健助手" if zh else "Steady assistant",
                    "Calm, consistent, fact-forward tone." if not zh else "沉穩、一致、以事實與步驟為主。",
                    _clamp_params({**base, **steady_mp}),
                ),
            ]
        else:
            options = [
                (
                    "q5_steady",
                    "穩健助手" if zh else "Steady assistant",
                    "Calm, consistent, fact-forward tone." if not zh else "沉穩、一致、以事實與步驟為主。",
                    _clamp_params({**base, **steady_mp}),
                ),
                (
                    "q5_expressive",
                    "熱情夥伴" if zh else "Warm partner",
                    "Enthusiastic, varied, idea-friendly tone." if not zh else "熱情、多變、適合腦力激盪的語氣。",
                    _clamp_params({**base, **expressive_mp}),
                ),
            ]

    opt_rows: list[dict[str, Any]] = []
    for item in options:
        oid, label, hint = item[0], item[1], item[2]
        row: dict[str, Any] = {"id": oid, "label": label, "hint": hint}
        if len(item) > 3 and isinstance(item[3], dict):
            row["model_params"] = item[3]
        else:
            hint_mp = _GUIDED_PARAM_HINTS.get(oid)
            if hint_mp:
                row["model_params"] = _clamp_params(dict(hint_mp))
        opt_rows.append(row)

    return {
        "step_index": step_index,
        "total_steps": GUIDED_SURVEY_TOTAL,
        "phase": "final" if step_index >= GUIDED_SURVEY_TOTAL - 1 else "question",
        "prompt": prompt,
        "options": opt_rows,
        "option_count": len(opt_rows),
        "narrowed": narrow or step_index >= GUIDED_SURVEY_TOTAL - 1,
    }


def _parse_guided_step_obj(text: str) -> dict[str, Any] | None:
    obj = _extract_json_object(text or "")
    if not isinstance(obj, dict):
        return None
    prompt = str(obj.get("prompt") or obj.get("question") or "").strip()
    raw_opts = obj.get("options")
    if not prompt or not isinstance(raw_opts, list) or len(raw_opts) < 2:
        return None
    options: list[dict[str, Any]] = []
    for i, row in enumerate(raw_opts):
        if not isinstance(row, dict):
            continue
        oid = str(row.get("id") or f"opt_{i}").strip()
        label = str(row.get("label") or "").strip()
        if not oid or not label:
            continue
        hint = str(row.get("hint") or row.get("description") or "").strip()
        sample = _option_sample_text(row)
        opt: dict[str, Any] = {"id": oid, "label": label, "hint": hint}
        if sample:
            opt["sample"] = sample[:1200]
        mp = row.get("model_params")
        if isinstance(mp, dict):
            opt["model_params"] = _clamp_params(mp)
        options.append(opt)
    if len(options) < 2:
        return None
    return {"prompt": prompt, "options": options[:5]}


async def run_personalization_survey_guided_step(payload: dict[str, Any]) -> dict[str, Any]:
    """Guided wizard: next question (3–5 options, or 2 when narrowed / final step)."""
    llm_cfg = payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None
    if not _llm_ready(llm_cfg):
        return {"ok": False, "error": "llm_not_configured"}

    try:
        step_index = int(payload.get("step_index") or 0)
    except (TypeError, ValueError):
        step_index = 0
    if step_index < 0 or step_index >= GUIDED_SURVEY_TOTAL:
        return {"ok": False, "error": "invalid_step_index"}

    locale = str(payload.get("locale") or "en").strip() or "en"
    answers = _normalize_guided_answers(payload.get("answers") or payload.get("guided_answers"))
    theme = _resolve_guided_theme(payload, locale)
    scenario = theme["scenario_prompt"]
    raw_fallback = _fallback_guided_step(step_index, answers, locale)

    def _as_response(
        options: list[dict[str, Any]],
        prompt: str,
        source: str,
        *,
        error: str = "",
    ) -> dict[str, Any]:
        out = _guided_step_payload(
            step_index=step_index,
            theme=theme,
            raw_fallback=raw_fallback,
            options=options,
            source=source,
            locale=locale,
            prompt=prompt,
            answers=answers,
        )
        if error:
            out["error"] = error
        return out

    fallback_resp = _as_response(
        list(raw_fallback["options"]),
        str(raw_fallback.get("prompt") or ""),
        "fallback",
    )

    lang_rule = (
        "Write prompt, label, hint, and sample in Traditional Chinese (繁體中文)."
        if _locale_is_zh(locale)
        else "Write prompt, label, hint, and sample in English."
    )
    history = json.dumps(
        [{"id": a["id"], "label": a.get("label", "")} for a in answers],
        ensure_ascii=False,
    )
    opt_count = fallback_resp["option_count"]
    min_opts = 2 if fallback_resp.get("narrowed") or step_index >= GUIDED_SURVEY_TOTAL - 1 else 3
    skeleton = json.dumps(
        [{"id": o["id"], "label": o["label"]} for o in fallback_resp["options"]],
        ensure_ascii=False,
    )

    system = (
        "You design a 5-step chat-style personalization wizard. "
        "CRITICAL: every option must include a distinct sample reply to the SAME shared scenario "
        "(2–3 sentences, in-character as the assistant). Users compare samples, not jargon. "
        "Never mention temperature, top_p, or inference parameters. Return JSON only."
    )
    user = (
        f"Locale: {locale}\n{lang_rule}\n"
        f"Theme: {theme['theme_label']} ({theme['theme_id']})\n\n"
        f"SHARED SCENARIO (all samples must answer this same situation):\n{scenario}\n\n"
        f"Step {step_index + 1} of {GUIDED_SURVEY_TOTAL}.\n"
        f"Previous answers: {history}\n"
        f"Axis scores (0–1, internal): {json.dumps(_guided_scores(answers))}\n\n"
        f"Question focus: refine one preference dimension; later steps must reflect earlier picks.\n"
        f"Provide {min_opts}–{opt_count} options "
        f"({'exactly 2' if min_opts == 2 else '3 to 5'}). "
        "Samples must be visibly different in tone/structure/length for this step.\n"
        f"Option id skeleton (prefer these ids): {skeleton}\n\n"
        "Return JSON:\n"
        '{"prompt":"<question>","options":[{"id":"...","label":"...","hint":"<one line>","sample":"<2-3 sentence reply>"}]}\n'
    )

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            text = await chat_completion_text(
                client,
                llm_cfg=llm_cfg,
                system=system,
                user=user,
                temperature=0.65,
            )
    except Exception as exc:
        logger.exception("personalization_survey_guided_step_failed")
        return _as_response(
            list(fallback_resp["options"]),
            str(fallback_resp.get("prompt") or ""),
            "fallback",
            error=str(exc)[:200],
        )

    parsed = _parse_guided_step_obj(text or "")
    if parsed is None:
        return fallback_resp

    fb_opts = list(fallback_resp["options"])
    merged_opts: list[dict[str, Any]] = []
    for i, row in enumerate(parsed["options"]):
        raw_oid = str(row.get("id") or "").strip()
        fb_match = next((o for o in fb_opts if o["id"] == raw_oid), None)
        if fb_match is None and i < len(fb_opts):
            fb_match = fb_opts[i]
        label = str(row.get("label") or (fb_match or {}).get("label") or raw_oid).strip()
        oid = align_guided_option_id(
            raw_oid,
            label=label,
            step_index=step_index,
            option_index=i,
            fallback_options=fb_opts,
        )
        hint = str(row.get("hint") or (fb_match or {}).get("hint") or "").strip()
        sample = _option_sample_text(row) or (fb_match and _option_sample_text(fb_match)) or ""
        opt: dict[str, Any] = {
            "id": oid or f"q{step_index}_{i}",
            "label": label,
            "hint": hint,
        }
        if sample:
            opt["sample"] = sample
        if fb_match and isinstance(fb_match.get("model_params"), dict):
            opt["model_params"] = fb_match["model_params"]
        elif isinstance(row.get("model_params"), dict):
            opt["model_params"] = row["model_params"]
        merged_opts.append(opt)

    if len(merged_opts) < min_opts:
        merged_opts = list(fallback_resp["options"])

    return _as_response(
        merged_opts[:5],
        str(parsed["prompt"] or fallback_resp.get("prompt") or ""),
        "llm",
    )


async def _finalize_from_guided_answers(payload: dict[str, Any]) -> dict[str, Any]:
    llm_cfg = payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None
    if not _llm_ready(llm_cfg):
        return {"ok": False, "error": "llm_not_configured"}

    answers = _normalize_guided_answers(payload.get("guided_answers") or payload.get("answers"))
    if len(answers) < GUIDED_SURVEY_TOTAL:
        return {"ok": False, "error": "guided_answers_incomplete"}

    selected_id = str(payload.get("selected_id") or answers[-1].get("id") or "").strip()
    last_row = next((a for a in reversed(answers) if str(a.get("id")) == selected_id), answers[-1])
    locale = str(payload.get("locale") or "en").strip() or "en"
    base_params = _merge_param_hints_from_answers(answers)
    last_mp = last_row.get("model_params") if isinstance(last_row.get("model_params"), dict) else {}
    if last_mp:
        base_params = _clamp_params({**base_params, **last_mp})

    lang_rule = (
        "Write rationale in Traditional Chinese (繁體中文)."
        if _locale_is_zh(locale)
        else "Write rationale in English."
    )
    lines = [
        f"- Step {a.get('step_index', i) + 1}: {a.get('id')} — {a.get('label', '')}"
        for i, a in enumerate(answers)
    ]
    system = (
        "You map plain-language personalization survey answers to ONE chat inference parameter set. "
        "Return JSON only — no markdown. Do not expose jargon to the user in rationale."
    )
    scenario = str(payload.get("scenario_prompt") or "").strip()
    theme_label = str(payload.get("theme_label") or "").strip()
    scenario_block = f"\nShared scenario:\n{scenario}\n" if scenario else ""

    user = (
        f"Locale: {locale}\n{lang_rule}\n"
        f"Theme: {theme_label or 'n/a'}{scenario_block}\n"
        "User answers (5 steps):\n"
        + "\n".join(lines)
        + f"\n\nFinal pick id: {selected_id}\n"
        f"Baseline merged hints: {json.dumps(base_params, ensure_ascii=False)}\n\n"
        "Return numeric overrides only where needed:\n"
        "temperature, top_p, top_k, presence_penalty, frequency_penalty, max_tokens\n"
        'Include "rationale": one short friendly sentence (no parameter names).'
    )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            text = await chat_completion_text(
                client,
                llm_cfg=llm_cfg,
                system=system,
                user=user,
                temperature=0.2,
            )
    except Exception as exc:
        logger.exception("personalization_survey_guided_finalize_failed")
        if not base_params:
            return {"ok": False, "error": str(exc) or "finalize_failed"}
        profile = derive_preference_profile_from_guided(answers, locale=locale)
        return {
            "ok": True,
            "model_params": base_params,
            "rationale": str(last_row.get("label") or "").strip(),
            "selected_id": selected_id,
            "source": "fallback",
            **profile,
        }

    obj = _extract_json_object(text or "")
    if not obj:
        profile = derive_preference_profile_from_guided(answers, locale=locale)
        return {
            "ok": True,
            "model_params": base_params,
            "rationale": "",
            "selected_id": selected_id,
            "source": "fallback",
            **profile,
        }

    rationale = str(obj.pop("rationale", "") or "").strip()
    params = _clamp_params(obj)
    if not params:
        params = base_params
    else:
        params = _clamp_params({**base_params, **params})
    if not params:
        return {"ok": False, "error": "empty_params"}

    profile = derive_preference_profile_from_guided(answers, locale=locale)

    return {
        "ok": True,
        "model_params": params,
        "rationale": rationale,
        "selected_id": selected_id,
        "source": "llm",
        **profile,
    }


async def run_personalization_survey_finalize(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Formulaic finalize: guided 5-answer trail, or legacy samples + pick (+ optional slider edits).
    """
    guided = payload.get("guided_answers") or payload.get("answers")
    if isinstance(guided, list) and len(_normalize_guided_answers(guided)) >= GUIDED_SURVEY_TOTAL:
        return await _finalize_from_guided_answers(payload)

    llm_cfg = payload.get("llm_cfg") if isinstance(payload.get("llm_cfg"), dict) else None
    if not _llm_ready(llm_cfg):
        return {"ok": False, "error": "llm_not_configured"}

    selected_id = str(payload.get("selected_id") or "").strip()
    raw_samples = payload.get("options") or payload.get("samples")
    if not selected_id or not isinstance(raw_samples, list) or not raw_samples:
        return {"ok": False, "error": "options_and_selection_required"}

    selected_row = _find_option_row(raw_samples, selected_id)
    if selected_row is None:
        return {"ok": False, "error": "selected_option_not_found"}

    user_adj = _normalize_user_adjustments(
        payload.get("user_model_params") or payload.get("user_adjustments"),
    )

    locale = str(payload.get("locale") or "en").strip() or "en"
    scenario = str(payload.get("scenario_prompt") or "").strip()
    theme_id = str(payload.get("theme_id") or "").strip()
    theme_label = str(payload.get("theme_label") or "").strip()

    catalog_lines: list[str] = []
    for row in raw_samples:
        if not isinstance(row, dict):
            continue
        sid = str(row.get("id") or "").strip()
        if not sid:
            continue
        label = str(row.get("style_label") or sid).strip()
        text = str(row.get("text") or "").strip()[:500]
        mp = row.get("model_params") if isinstance(row.get("model_params"), dict) else {}
        catalog_lines.append(
            f"- {sid} ({label})\n"
            f"  sample: {json.dumps(text, ensure_ascii=False)}\n"
            f"  model_params: {json.dumps(mp, ensure_ascii=False)}"
        )

    lang_rule = (
        "Write rationale in Traditional Chinese (繁體中文)."
        if _locale_is_zh(locale)
        else "Write rationale in English."
    )

    user_block = ""
    if user_adj:
        user_block = (
            "\n\nUser fine-tune on the confirm step (enabled sliders only; null = leave unset):\n"
            f"{json.dumps(user_adj, ensure_ascii=False)}\n"
            "Treat non-null slider values as hard constraints. "
            "Omit keys that are null from the final output (do not override)."
        )

    system = (
        "You finalize default chat inference parameters after a personalization wizard. "
        "The user compared several AI reply styles, each with proposed model_params. "
        "Synthesize ONE coherent parameter set — do not copy a single option blindly; "
        "blend toward the picked style while using the full option grid as reference. "
        "Return JSON only — no markdown fences."
    )
    user = (
        f"Locale: {locale}\n{lang_rule}\n"
        f"Theme: {theme_label or theme_id or 'n/a'}\n"
        f"Scenario:\n{scenario}\n\n"
        "All options shown to the user:\n"
        + "\n".join(catalog_lines)
        + f"\n\nUser PICKED option id: {selected_id}\n"
        f"Picked style label: {str(selected_row.get('style_label') or '').strip()}\n"
        f"Picked sample text:\n{str(selected_row.get('text') or '').strip()[:800]}"
        f"{user_block}\n\n"
        "Return one JSON object with numeric fields only where you recommend an override "
        "(use null for keys that should stay at server default / unset):\n"
        "temperature (0–2), top_p (0–1), top_k (1–200), presence_penalty (-2–2), "
        "frequency_penalty (-2–2), max_tokens (256–8192 optional).\n"
        'Include "rationale": one short sentence explaining the blend.'
    )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            text = await chat_completion_text(
                client,
                llm_cfg=llm_cfg,
                system=system,
                user=user,
                temperature=0.2,
            )
    except Exception as exc:
        logger.exception("personalization_survey_finalize_failed")
        params = _fallback_finalize_params(selected_row, user_adj)
        if not params:
            return {"ok": False, "error": str(exc) or "finalize_failed"}
        return {
            "ok": True,
            "model_params": params,
            "rationale": str(selected_row.get("style_label") or "").strip(),
            "selected_id": selected_id,
            "source": "fallback",
        }

    obj = _extract_json_object(text or "")
    if not obj:
        params = _fallback_finalize_params(selected_row, user_adj)
        if not params:
            return {"ok": False, "error": "invalid_finalize_json", "raw": (text or "")[:500]}
        return {
            "ok": True,
            "model_params": params,
            "rationale": "",
            "selected_id": selected_id,
            "source": "fallback",
        }

    rationale = str(obj.pop("rationale", "") or "").strip()
    params = _clamp_params(obj)
    if user_adj:
        params = _merge_finalize_params(params, user_adj) if params else _fallback_finalize_params(
            selected_row,
            user_adj,
        )
    if not params:
        params = _fallback_finalize_params(selected_row, user_adj)
    if not params:
        return {"ok": False, "error": "empty_params"}

    return {
        "ok": True,
        "model_params": params,
        "rationale": rationale,
        "selected_id": selected_id,
        "source": "llm",
    }


async def run_personalization_survey_infer(payload: dict[str, Any]) -> dict[str, Any]:
    """Alias for finalize (pick → blended inference params)."""
    return await run_personalization_survey_finalize(payload)
