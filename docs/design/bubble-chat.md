# Bubble Chat

Ephemeral quick-turn chat in a **fullscreen overlay** — not listed in the CHATS sidebar.

## Behavior

| Rule | Implementation |
|------|----------------|
| One overlay at a time | `openBubbleChat()` toggles — second click closes |
| Reopen = fresh UI | Do not resume from `sessionStorage`; `conversation_id` starts at 0 each open |
| Short TTL | `ChatBubbleConversation::ttlSeconds()` (default 90m, env `OAAO_BUBBLE_CHAT_TTL_SECONDS`) in `params_json.expires_at` |
| Not in sidebar | `ChatConversationScope::listForUser` skips `kind: bubble` |
| Same send/stream | `POST /chat/api/send` with `bubble: true` on first turn; **same SSE + six-area render pipeline** as workspace chat via `getChatPanelBridge()` |
| Productivity hooks on | Calendar / todo post-turn LLM hooks still run; full `[info]` / `[strip]` via shared stream handler |
| Persistent agents off | `conversation_kind: bubble` + `skip_persistent_agent_hooks` — no `slide_designer` planner injection, skill suggest/upgrade, or auto-title |
| Composer UI | Reuses `chat-panel.js` `mountBubbleChatComposer` (context ring, planner dropup, web search, vault/library slots) |
| Close = discard | Close button / Escape → sync `clearSession()` + `conversation_delete` (async); server thread purged on TTL/list anyway |

## UI

- Header button `#workspace-bubble-chat-trigger` (message bubble icon).
- **Fullscreen** dark blue stage; conversation column **max-width 48rem (768px)** centered.
- User / assistant messages: **dashed-border** boxes only (identity chrome + per-turn toolbar hidden).
- Composer docked at **bottom** of the column (same chrome as workspace chat).
- Module: `chat/default/webassets/js/bubble-chat.js` + `css/oaao-bubble-chat.css`.

## Ops

- Purge expired bubbles on `GET /chat/api/conversations` (per user).
- Rebuild not required for PHP; hard refresh after JS/CSS deploy.
- Asset rev: `OAAO_CHAT_SHELL_ASSET_REV` / `bubble-fullscreen-v210` — sync `chat-panel.js`, `core.main.php`, `bubble-chat.js`.
