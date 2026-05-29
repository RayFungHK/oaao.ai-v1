# Release notes (PLAT-1) — seed content

Platform operators publish **What's New** posts from **Platform → Settings → Release notes / News** (`platform-release-notes-panel.js`). Workspace users read them via the notification menu or `openWhatsNewDialog()` (`GET /user/api/release_notes_list`).

## First post (roadmap)

Copy the body from:

| Locale   | File |
| -------- | ---- |
| English  | [2026-05-29-roadmap-en.md](./2026-05-29-roadmap-en.md) |
| 繁體中文 | [2026-05-29-roadmap-zh-Hant.md](./2026-05-29-roadmap-zh-Hant.md) |

Suggested CMS fields (both locales):

- **post_type:** `news` (or `changelog` if you prefer)
- **slug:** `2026-05-29-platform-roadmap` (unique per row; append `-zh` for zh-Hant if needed)
- **version:** from `backbone/config/oaaoai/build_info.json` → `version` (e.g. `0.9.0-dev`)
- **build_id:** current `build_id` at publish time (snapshot for `since_build` filtering)
- **status:** `published` after review

Publish **English first**, then duplicate row for **zh-Hant** with the translated body. Fan-out notifications follow your PLAT-1 notification wiring when publish runs.

## Source of truth for this roadmap

Derived from `git log --since=2026-05-27` on branch `p0-sprint-w1-w13-test`, plus **uncommitted / untracked** work in the working tree as of **2026-05-29** (inference v2, personalization wizard, todo module, library editor, etc.).
