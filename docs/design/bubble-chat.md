# Bubble Chat

Ephemeral quick-turn chat in a **single** workspace dialog — not listed in the CHATS sidebar.

## Behavior

| Rule | Implementation |
|------|----------------|
| One dialog at a time | `openBubbleChat()` focuses existing `activeDialog` while open |
| Reopen = fresh UI | Do not resume from `sessionStorage`; `conversationId` starts at 0 each open |
| Short TTL | `ChatBubbleConversation::ttlSeconds()` (default 90m, env `OAAO_BUBBLE_CHAT_TTL_SECONDS`) in `params_json.expires_at` |
| Not in sidebar | `ChatConversationScope::listForUser` skips `kind: bubble` |
| Same send/stream | `POST /chat/api/send` with `bubble: true` on first turn; same composer payload (planner, web search, vault, context) |
| Productivity hooks on | Calendar / todo / todo_resolve post-turn LLM hooks still run; SSE chips via `conversation-calendar-suggest` / `conversation-todo-suggest` |
| Persistent agents off | `conversation_kind: bubble` + `skip_persistent_agent_hooks` — no `slide_designer` planner injection, skill suggest/upgrade, or auto-title |
| Composer UI | Reuses `chat-panel.js` `mountBubbleChatComposer` (context ring, planner dropup, web search toggle, vault/library slots) |
| Close = discard | Dialog `onClose` → sync `clearSession()` + `conversation_delete` (async); server thread purged on TTL/list anyway |

## UI

- Header button `#workspace-bubble-chat-trigger` (message bubble icon).
- Module: `chat/default/webassets/js/bubble-chat.js`.

## Ops

- Purge expired bubbles on `GET /chat/api/conversations` (per user).
- Rebuild not required for PHP; hard refresh after JS deploy.
