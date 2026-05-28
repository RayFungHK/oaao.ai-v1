"""Assess ASR polish output — used by pytest batch and ``scripts/run_polish_batch.py``."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from oaao_orchestrator.quick_punctuate import (
    finalize_polish_output,
    punctuation_score,
    quick_punctuate_transcript,
    sentence_break_score,
)

# Canonical regression samples (extend here).
POLISH_BATCH_SAMPLES: list[dict[str, Any]] = [
    {
        "id": "llm_kv_weights_zh_hant",
        "raw": (
            "我想知道 ai 入边嘅 llm 系乜嘢？，意思 kv 系乜理权重系乜理，"
            "同埋点样可以学习。"
        ),
        "locale": "zh-Hant",
        "style": "professional",
        "notes": "Voice composer regression — colloquial ASR + mixed script + term typos.",
    },
    {
        "id": "llm_kv_weights_voice_long",
        "raw": (
            "我想知道 ai 入边嘅 m 系乜嘢？，嚟 kv 系乜嘢嚟，同埋权众系乜嘢嚟"
            "可唔可以介绍一啲书本俾我学习 ai。"
        ),
        "locale": "zh-Hant",
        "style": "professional",
        "notes": "Production voice regression — long live ASR with quick punctuate.",
    },
    {
        "id": "llm_kv_weights_raw_asr",
        "raw": "我想知道 ai 入邊嘅 llm 系乜嘢嚟嘅乜嘢叫做 kv 乜嘢叫做权重同埋我可以點樣去學習呢啲嘢",
        "locale": "zh-Hant",
        "style": "natural",
        "notes": "Chat-style raw Cantonese without prior quick punctuate.",
    },
]

# Simplified-only chars that should not appear in zh-Hant LLM polish.
_ZH_HANT_SIMPLIFIED_MARKERS = frozenset("边国学点权里为这说么过还时没发对经现问题实际录语转写")

# Colloquial / ASR debris that LLM polish should remove or rewrite.
_COLLOQUIAL_MARKERS = ("系乜嘢", "系乜理", "入边", "点样", "同埋", "嘅")


def normalize_for_polish_compare(text: str) -> str:
    """Strip whitespace and punctuation for raw-vs-polished content comparison."""
    s = re.sub(r"\s+", "", (text or ""))
    return re.sub(r"[，。！？、；：,.!?]", "", s)


def count_colloquial_markers(text: str) -> int:
    return sum(1 for m in _COLLOQUIAL_MARKERS if m in (text or ""))


def looks_like_raw_asr(text: str, *, locale: str = "") -> bool:
    """Heuristic — text still looks like colloquial ASR, not written Chinese."""
    s = (text or "").strip()
    if not s:
        return False
    if _contains_any(s, ("系乜理", "入边", "点样", "\\1")):
        return True
    loc = (locale or "").lower().replace("_", "-")
    if loc.startswith("zh-hant") or loc in ("zh-tw", "zh-hk"):
        simp_hits = sum(1 for c in _ZH_HANT_SIMPLIFIED_MARKERS if c in s)
        colloquial = count_colloquial_markers(s)
        if simp_hits >= 2 or (colloquial >= 2 and simp_hits >= 1):
            return True
    return count_colloquial_markers(s) >= 3


def is_substantive_llm_polish(
    raw: str,
    polished: str,
    *,
    locale: str = "",
) -> bool:
    """
    True when polished text meaningfully differs from raw ASR — not just punctuation.

    Prevents false ``LLM polished`` when quick punctuate already added ？/，.
    """
    raw_s = (raw or "").strip()
    pol_s = (polished or "").strip()
    if not pol_s or not raw_s:
        return bool(pol_s and pol_s != raw_s)

    raw_n = normalize_for_polish_compare(raw_s)
    pol_n = normalize_for_polish_compare(pol_s)
    if not pol_n or pol_n == raw_n:
        return False

    return True


def polish_weak_output(
    polish_input: str,
    llm_out: str,
    *,
    locale: str = "",
) -> bool:
    """True when LLM was invoked on raw-ish ASR but returned no meaningful rewrite."""
    if not looks_like_raw_asr(polish_input, locale=locale):
        return False
    return not is_substantive_llm_polish(polish_input, llm_out, locale=locale)


def score_polish_quality(raw: str, polished: str, *, locale: str = "") -> int:
    """
    0–100 semantic quality of the polished transcript.

    Scores written-language signals (colloquial cleanup, punctuation, script, structure).
    Does **not** treat raw-vs-polished character difference as quality.
    """
    raw_s = (raw or "").strip()
    pol_s = (polished or "").strip()
    if not pol_s:
        return 0

    loc = (locale or "").lower().replace("_", "-")

    # Unchanged colloquial ASR — low semantic quality regardless of punctuation tweaks.
    if raw_s:
        raw_n = normalize_for_polish_compare(raw_s)
        pol_n = normalize_for_polish_compare(pol_s)
        if raw_n and pol_n == raw_n and looks_like_raw_asr(pol_s, locale=locale):
            return max(0, min(22, 8 + punctuation_score(pol_s) * 4))

    score = 28

    if not looks_like_raw_asr(pol_s, locale=locale):
        score += 28

    colloq_pol = count_colloquial_markers(pol_s)
    score -= min(24, colloq_pol * 8)

    breaks = sentence_break_score(pol_s)
    score += min(20, breaks * 7)

    punct = punctuation_score(pol_s)
    score += min(14, punct * 5)

    if loc.startswith("zh-hant") or loc in ("zh-tw", "zh-hk"):
        simp_hits = sum(1 for c in _ZH_HANT_SIMPLIFIED_MARKERS if c in pol_s)
        score -= min(18, simp_hits * 6)

    if raw_s:
        colloq_raw = count_colloquial_markers(raw_s)
        score += min(12, max(0, colloq_raw - colloq_pol) * 4)

        raw_len = len(raw_s)
        if raw_len > 0:
            ratio = len(pol_s) / raw_len
            if ratio < 0.55:
                score -= int((0.55 - ratio) * 50)

    if not raw_s and not looks_like_raw_asr(pol_s, locale=locale):
        score += 8

    return max(0, min(100, score))


@dataclass
class PolishCheck:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class PolishAssessment:
    raw: str
    polished: str
    mode: str
    checks: list[PolishCheck] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    @property
    def failed(self) -> list[PolishCheck]:
        return [c for c in self.checks if not c.passed]

    def to_dict(self) -> dict[str, Any]:
        return {
            "raw": self.raw,
            "polished": self.polished,
            "mode": self.mode,
            "passed": self.passed,
            "checks": [
                {"name": c.name, "passed": c.passed, "detail": c.detail} for c in self.checks
            ],
        }


def _contains_any(text: str, tokens: tuple[str, ...]) -> bool:
    return any(t in text for t in tokens)


def assess_quick_polish(raw: str, polished: str | None = None) -> PolishAssessment:
    """Rule-based quick punctuate — must not leak regex artifacts."""
    out = (polished or quick_punctuate_transcript(raw)).strip()
    checks: list[PolishCheck] = [
        PolishCheck("non_empty", bool(out), "output empty"),
        PolishCheck("no_regex_artifacts", "\\1" not in out and "\\2" not in out, out[:120]),
        PolishCheck(
            "punctuation_added",
            punctuation_score(out) >= max(1, punctuation_score(raw)),
            f"punct raw={punctuation_score(raw)} out={punctuation_score(out)}",
        ),
    ]
    return PolishAssessment(raw=raw, polished=out, mode="quick", checks=checks)


def assess_llm_polish(
    raw: str,
    polished: str,
    *,
    locale: str = "zh-Hant",
    style: str = "professional",
) -> PolishAssessment:
    """Stricter checks — catches 'LLM polished' that is still colloquial / simplified."""
    pol = (polished or "").strip()
    loc = (locale or "zh-Hant").lower()
    checks: list[PolishCheck] = [
        PolishCheck("non_empty", bool(pol), "output empty"),
        PolishCheck("no_regex_artifacts", "\\1" not in pol and "\\2" not in pol, pol[:120]),
        PolishCheck(
            "not_unchanged_colloquial",
            not (
                pol.replace(" ", "") == raw.replace(" ", "")
                or (
                    _contains_any(pol, _COLLOQUIAL_MARKERS)
                    and _contains_any(raw, _COLLOQUIAL_MARKERS)
                    and abs(len(pol) - len(raw)) <= 3
                )
            ),
            "output nearly identical to raw colloquial ASR",
        ),
        PolishCheck(
            "sentence_breaks",
            sentence_break_score(pol) >= 2,
            f"breaks={sentence_break_score(pol)}",
        ),
        PolishCheck(
            "llm_term",
            _contains_any(pol.upper(), ("LLM",)) or "大型語言模型" in pol,
            "expected LLM or 大型語言模型",
        ),
        PolishCheck(
            "kv_term",
            _contains_any(pol.upper(), ("KV", "KV CACHE", "KV CACHE")) or "KV Cache" in pol,
            "expected KV / KV Cache",
        ),
        PolishCheck(
            "weight_term",
            "權重" in pol or "权重" in pol,
            "expected 權重",
        ),
    ]

    if loc.startswith("zh-hant") or loc in ("zh-tw", "zh-hk"):
        simplified_hits = [c for c in _ZH_HANT_SIMPLIFIED_MARKERS if c in pol]
        checks.append(
            PolishCheck(
                "traditional_script",
                len(simplified_hits) <= 1,
                f"simplified chars in output: {''.join(simplified_hits) or 'ok'}",
            )
        )
        checks.append(
            PolishCheck(
                "no_colloquial_debris",
                not _contains_any(pol, ("系乜理", "入边", "\\1")),
                "ASR debris still present",
            )
        )

    if style == "professional":
        checks.append(
            PolishCheck(
                "professional_wording",
                not _contains_any(pol, ("系乜嘢", "点样", "同埋")),
                "still colloquial (系乜嘢/点样/同埋)",
            )
        )

    finalized = finalize_polish_output(pol, raw)
    checks.append(
        PolishCheck(
            "finalize_keeps_llm",
            sentence_break_score(finalized) >= 2,
            finalized[:120],
        )
    )

    return PolishAssessment(raw=raw, polished=pol, mode=f"llm:{style}", checks=checks)


def assess_pipeline(
    raw: str,
    *,
    quick_out: str | None = None,
    llm_out: str | None = None,
    locale: str = "zh-Hant",
    style: str = "professional",
) -> list[PolishAssessment]:
    results = [assess_quick_polish(raw, quick_out)]
    if llm_out is not None:
        results.append(assess_llm_polish(raw, llm_out, locale=locale, style=style))
    return results
