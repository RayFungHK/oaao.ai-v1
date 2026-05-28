#!/usr/bin/env python3
"""
Run polish regression batch locally.

Quick-only (no LLM):
  python scripts/run_polish_batch.py

Live LLM (needs endpoint env):
  set OAAO_POLISH_TEST_BASE_URL=http://host:port/v1
  set OAAO_POLISH_TEST_MODEL=gemma-...
  set OAAO_POLISH_TEST_API_KEY=...   # optional
  python scripts/run_polish_batch.py --live

All styles for one sample:
  python scripts/run_polish_batch.py --live --sample llm_kv_weights_zh_hant --all-styles
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# Allow ``python scripts/run_polish_batch.py`` from repo python/ root.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import httpx

from oaao_orchestrator.asr_common import (
    POLISH_STYLES,
    build_polish_system_prompt,
    build_polish_user_content,
    polish_transcript,
)
from oaao_orchestrator.polish_assess import (
    POLISH_BATCH_SAMPLES,
    assess_llm_polish,
    assess_quick_polish,
)


def _polish_cfg(*, locale: str, style: str) -> dict:
    base = (os.environ.get("OAAO_POLISH_TEST_BASE_URL") or os.environ.get("OAAO_POLISH_BASE_URL") or "").strip()
    model = (os.environ.get("OAAO_POLISH_TEST_MODEL") or os.environ.get("OAAO_POLISH_MODEL") or "").strip()
    if not base or not model:
        raise SystemExit(
            "Set OAAO_POLISH_TEST_BASE_URL and OAAO_POLISH_TEST_MODEL for --live "
            "(or OAAO_POLISH_BASE_URL / OAAO_POLISH_MODEL)."
        )
    cfg: dict = {
        "base_url": base.rstrip("/"),
        "model": model,
        "locale": locale,
        "display_locale": locale,
        "polish_style": style,
    }
    api_key = (os.environ.get("OAAO_POLISH_TEST_API_KEY") or os.environ.get("OAAO_POLISH_API_KEY") or "").strip()
    if api_key:
        cfg["api_key_env"] = "__inline__"
        os.environ["__inline__"] = api_key
    timeout = os.environ.get("OAAO_POLISH_TEST_TIMEOUT_SEC", "15").strip()
    try:
        cfg["timeout_sec"] = float(timeout)
    except ValueError:
        cfg["timeout_sec"] = 15.0
    max_out = os.environ.get("OAAO_POLISH_TEST_MAX_OUTPUT_TOKENS", "").strip()
    if max_out:
        try:
            cfg["max_output_tokens"] = int(max_out)
        except ValueError:
            pass
    return cfg


def _print_header(title: str) -> None:
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def _print_assessment(assessment) -> None:
    status = "PASS" if assessment.passed else "FAIL"
    print(f"[{status}] mode={assessment.mode}")
    print(f"  raw ({len(assessment.raw)}): {assessment.raw}")
    print(f"  out ({len(assessment.polished)}): {assessment.polished}")
    for check in assessment.checks:
        mark = "ok" if check.passed else "FAIL"
        detail = f" — {check.detail}" if check.detail else ""
        print(f"    [{mark}] {check.name}{detail}")


def _print_prompt_preview(raw: str, locale: str, style: str) -> None:
    system = build_polish_system_prompt(locale=locale)
    user = build_polish_user_content(raw=raw, locale=locale, polish_style=style)
    print(f"--- system ({len(system)} chars) ---")
    print(system)
    print(f"--- user ({len(user)} chars) ---")
    print(user)


async def _run_live(raw: str, locale: str, style: str) -> tuple[str | None, str | None]:
    cfg = _polish_cfg(locale=locale, style=style)
    async with httpx.AsyncClient() as client:
        return await polish_transcript(client, raw_text=raw, polish_cfg=cfg)


async def _run_batch(args: argparse.Namespace) -> int:
    samples = POLISH_BATCH_SAMPLES
    if args.sample:
        samples = [s for s in samples if s["id"] == args.sample]
        if not samples:
            raise SystemExit(f"Unknown sample id: {args.sample}")

    failures = 0
    for sample in samples:
        sample_id = sample["id"]
        raw = sample["raw"]
        locale = sample.get("locale", "zh-Hant")
        styles = list(POLISH_STYLES) if args.all_styles else [sample.get("style", "natural")]

        _print_header(f"sample={sample_id} locale={locale}")
        if sample.get("notes"):
            print(sample["notes"])

        quick = assess_quick_polish(raw)
        _print_assessment(quick)
        if not quick.passed:
            failures += 1

        for style in styles:
            if args.show_prompt:
                _print_header(f"prompt preview style={style}")
                _print_prompt_preview(raw, locale, style)

            if not args.live:
                continue

            _print_header(f"LLM polish style={style}")
            polished, err = await _run_live(raw, locale, style)
            if err:
                print(f"  polish_error: {err}")
            if not polished:
                print("  (empty polished output)")
                failures += 1
                continue

            llm = assess_llm_polish(raw, polished, locale=locale, style=style)
            _print_assessment(llm)
            if not llm.passed:
                failures += 1

    print()
    if failures:
        print(f"BATCH FAILED — {failures} assessment(s) failed.")
        return 1
    print("BATCH PASSED.")
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (AttributeError, OSError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Polish regression batch runner")
    parser.add_argument("--live", action="store_true", help="Call configured LLM endpoint")
    parser.add_argument("--sample", metavar="ID", help="Run one sample id only")
    parser.add_argument("--all-styles", action="store_true", help="Run professional/natural/concise")
    parser.add_argument("--show-prompt", action="store_true", help="Print system+user prompts")
    parser.add_argument("--json", action="store_true", help="Reserved for machine-readable output")
    args = parser.parse_args()

    if args.json and not args.live:
        out = []
        for sample in POLISH_BATCH_SAMPLES:
            if args.sample and sample["id"] != args.sample:
                continue
            q = assess_quick_polish(sample["raw"])
            out.append(q.to_dict())
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0 if all(x["passed"] for x in out) else 1

    return asyncio.run(_run_batch(args))


if __name__ == "__main__":
    raise SystemExit(main())
