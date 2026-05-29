# Personalization tag mapping (UX-1-S5 / S8)

## Storage (`preferences_json`)

| Key | Visibility | Purpose |
|-----|------------|---------|
| `preference_tags` | Settings chips | Hashtag labels from guided wizard (`#簡潔`, `#平衡語氣`, …) |
| `preference_tags_summary` | Settings one-line summary | Human-readable join of tag labels |
| `preference_system_instruction` | Hidden (not shown as editable prose) | Composed instruction block for planner + composer |
| `model_params` | Advanced / internal | Bounded inference overrides |
| `personalization_survey.wizard` | Audit | Guided answers + theme + rationale |

## Guided wizard (UX-1-S4 decision)

- **Product choice:** **5-step guided wizard** with shared scenario, sample replies per option, auto `model_params` (no manual sliders in wizard).
- **Skip:** Intro screen offers **Skip for now** (closes dialog; does not write survey completion).
- Legacy 10–30 question flow is **deprecated**; orchestrator `survey_samples` remains for API compatibility only.

## Mapping source of truth

- Python: `python/oaao_orchestrator/preference_profile.py` (`_OPTION_ID_TAGS`, `_TAG_INSTRUCTION_ZH`)
- PHP: `oaaoai\user\UserPreferenceProfile` (mirrors ZH tags + instructions for save/re-tune without orchestrator round-trip)

## Runtime injection

1. `send.php` merges `UserPreferenceProfile::forOrchestratorPayload()` into `user_personalization`.
2. `user_personalization.apply_user_personalization` prepends style block to composer messages.
3. `planner_llm.plan_run_with_llm` appends the same style block to the planner system prompt.

## Option id alignment (wizard stability)

LLM-generated option ids are aligned to `q{step}_{variant}` via `align_guided_option_id()` using fallback option order + label match so `_GUIDED_PARAM_HINTS` and tag maps stay consistent.

## Bounded params

See `GUIDED_PARAM_HINTS` in `personalization_wizard.py` and `UserModelParams::normalize()` for clamp ranges. Finalize merges hints then applies LLM deltas, then clamp.

## Thumbs + downvote tune (UX-1-S10–S12)

| Story | Behavior | Code |
|-------|----------|------|
| S10 | New downvote applies bounded `model_params` delta + audit row | `UserFeedbackModelTune`, `message_feedback.php` |
| S11 | Downvote triggers orchestrator `POST /v1/personalization/feedback_judge` (heuristic stub); stores `feedback_judge_audit` | `FeedbackJudgeClient`, `personalization_feedback_judge.py` |
| S12 | Profile merge + wizard→send contract | `UserPreferenceProfileTest`, `test_cs6_productivity_e2e.py` |

Chat UI: thumb click updates local button state only (no `loadMessages()` refetch).
