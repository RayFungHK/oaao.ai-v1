# Release notes publish runbook (PLAT-1)

Platform operators publish **changelog** or **news** posts from the platform host. Workspace users receive an in-app notification (`kind=release`) and can open **What's New**.

## Prerequisites

- Platform host (`kind=platform`) with platform-operator account.
- PostgreSQL core tables (`oaao_release_post`, `oaao_notification`) — created on first PG bootstrap or when opening Platform → Release notes.
- Optional: set `OAAO_SKIP_RELEASE_NEWS_SEED=1` to disable automatic seed of the first news post (`whats-new-2026-05-late`).

## Publish flow (CMS UI)

1. Open **Settings → Release notes** on the platform host.
2. Create or edit a draft: set **type** (`changelog` | `news`), **locale** (`en`, `zh-Hant`, …), title, Markdown body.
3. Click **Publish**. The API:
   - Sets `status=published`, `published_at`, and snapshots `version` / `build_id` from `OaaoBuildInfo` when omitted.
   - Runs the first fan-out batch; the UI polls `release_posts_fanout_tick` until `done=true`.
4. Verify on a tenant workspace: notification bell shows the post; clicking opens What's New focused on `release_post_id`.

## Publish flow (API)

| Step | Endpoint | Notes |
|------|----------|--------|
| Save draft | `POST /platform/api/release_posts_save` | JSON: `title`, `body_md`, `post_type`, `locale`, optional `slug`, `version`, `build_id` |
| Publish | `POST /platform/api/release_posts_publish` | `{ "release_post_id": N }` — starts fan-out |
| Resume fan-out | `POST /platform/api/release_posts_fanout_tick` | Repeat until `data.done` is true |

Fan-out creates one `oaao_notification` per active user (`disabled=0`), batched (`ReleasePostFanout::BATCH_SIZE`, default 250).

## Workspace verification

- `GET /user/api/release_notes_list` — lists published posts; filter with `since_build` using `ReleaseBuildCompare::postVisibleSinceBuild`.
- User menu **build** line opens What's New with since-build highlight (`PLAT-1-S8`).
- Notification payload includes `release_post_id`, `release_build_id`, `release_version`.

## Automated tests

```bash
./vendor/bin/phpunit --testsuite oaaoai \
  backbone/sites/oaaoai/oaaoai/core/default/tests/ReleaseBuildCompareTest.php \
  backbone/sites/oaaoai/oaaoai/core/default/tests/ReleasePostFanoutTest.php
```

## First-run seed

On PostgreSQL core bootstrap, `ReleasePostFirstNewsSeed` inserts bilingual `news` posts from `docs/release-notes/2026-05-29-roadmap-*.md` (slug `whats-new-2026-05-late`) and fan-outs notifications for the English post only.

Manual trigger (platform operator):

```http
POST /platform/api/release_posts_seed_first_news
```

Idempotent — skips when slug already exists. Disable auto-seed with `OAAO_SKIP_RELEASE_NEWS_SEED=1`.

## Rollback / re-run fan-out

- To stop fan-out mid-flight: set `fanout_status='done'` on the post (manual SQL) — no automatic undo of notifications.
- To re-notify: clone post as new slug or add a new post; avoid republishing the same `release_post_id` without clearing notifications.

## Related code

- `Oaaoai\Core\ReleasePostFanout`
- `Oaaoai\Core\ReleaseBuildCompare`
- `platform/default/controller/api/release_posts_*.php`
- `core/default/webassets/js/whats-new-dialog.js`, `notification-panel.js`

## Half-day ops checklist (CS-W12 batch)

1. **PHPUnit (oaaoai suite)** — personalization, feedback tune, release fan-out:
   ```bash
   ./vendor/bin/phpunit --testsuite oaaoai
   ```
2. **Python** — judge + productivity + library attach:
   ```bash
   cd python && pytest tests/test_personalization_feedback_judge.py tests/test_cs6_productivity_e2e.py tests/test_library_attach_contract.py -q
   ```
3. **Orchestrator** — restart after Python route changes (`personalization/feedback_judge`).
4. **Release seed** — idempotent `POST /platform/api/release_posts_seed_first_news` or rely on PG bootstrap (unless `OAAO_SKIP_RELEASE_NEWS_SEED=1`).
5. **Smoke** — workspace chat thumb (no full history reload); calendar/todo chip i18n; invite mail locale (`mail_locale` on `users_invite` optional).
