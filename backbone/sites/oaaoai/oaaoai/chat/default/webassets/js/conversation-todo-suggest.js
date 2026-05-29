/**
 * CS-6-S4/S5 — Todo suggestion chip on assistant message + save.
 *
 * @module conversation-todo-suggest
 */

/** @type {Set<string>} */
const todoSuggestionDismissed = new Set();

/**
 * @param {number} conversationId
 * @param {number} messageId
 */
function dismissKey(conversationId, messageId) {
    return `${Math.floor(Number(conversationId))}:${Math.floor(Number(messageId))}`;
}

/**
 * @param {number} conversationId
 * @param {number} messageId
 */
export function dismissTodoSuggestion(conversationId, messageId) {
    todoSuggestionDismissed.add(dismissKey(conversationId, messageId));
}

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

/**
 * @param {string} path
 */
export function todoApiUrl(path) {
    const base = `${mountPrefix()}/todo/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

async function loadDialogCtor() {
    const prefix = mountPrefix();
    const base = prefix ? `${prefix}/webassets/core/default/razyui/razyui.js` : '/webassets/core/default/razyui/razyui.js';
    const razyui = await import(/* webpackIgnore: true */ base.replace(/\/{2,}/g, '/'));
    return razyui.load('Dialog');
}

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {number} messageId
 * @param {Record<string, unknown>} payload
 * @param {() => Record<string, unknown>} workspaceBodyFields
 */
async function openAddToTodosDialog(mount, conversationId, messageId, payload, workspaceBodyFields) {
    const Dialog = await loadDialogCtor();
    const body = document.createElement('div');
    body.className = 'flex flex-col gap-3 min-w-0';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className =
        'w-full rounded-[8px] border border-solid border-[var(--grid-line)] px-3 py-2 text-[0.875rem] font-inherit';
    titleInput.value = String(payload.title || '');

    const hint = document.createElement('p');
    hint.className = 'm-0 text-[0.75rem] fg-[var(--grid-ink-muted)] line-clamp-3';
    hint.textContent = String(payload.context_snippet || '').slice(0, 240);

    body.append(titleInput, hint);

    Dialog.open({
        title: 'Add to todos',
        content: body,
        size: 'sm',
        buttons: [
            { text: 'Cancel', color: 'muted', action: async () => true },
            {
                text: 'Add',
                color: 'accent',
                action: async () => {
                    const title = titleInput.value.trim();
                    if (!title) return false;
                    const extra = workspaceBodyFields();
                    const res = await fetch(todoApiUrl('todos_save'), {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({
                            title,
                            status: 'open',
                            context_snippet: String(payload.context_snippet || ''),
                            conversation_id: conversationId,
                            message_id: messageId,
                            priority: String(payload.priority || 'normal'),
                            workspace_id: extra.workspace_id ?? null,
                        }),
                    });
                    const data = await res.json().catch(() => null);
                    if (!res.ok || !data?.success) return false;
                    dismissTodoSuggestion(conversationId, messageId);
                    const chip = mount.querySelector(
                        `[data-oaao-todo-suggest="${dismissKey(conversationId, messageId)}"]`,
                    );
                    chip?.remove();
                    document.dispatchEvent(new CustomEvent('oaao:todos-changed'));
                    return true;
                },
            },
        ],
    });
}

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {number} messageId
 * @param {Record<string, unknown>} payload
 * @param {() => Record<string, unknown>} workspaceBodyFields
 */
export function renderTodoSuggestChip(mount, conversationId, messageId, payload, workspaceBodyFields) {
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    if (cid < 1 || mid < 1) return;
    const key = dismissKey(cid, mid);
    if (todoSuggestionDismissed.has(key)) return;

    const msgsHost = mount.querySelector('[data-oaao-chat="messages"]');
    if (!(msgsHost instanceof HTMLElement)) return;
    const bubble = msgsHost.querySelector(`[data-oaao-msg-id="${mid}"]`);
    if (!(bubble instanceof HTMLElement)) return;
    const outer = bubble.closest('.oaao-chat-assistant-row');
    if (!(outer instanceof HTMLElement)) return;
    if (outer.querySelector(`[data-oaao-todo-suggest="${key}"]`)) return;

    const chip = document.createElement('div');
    chip.dataset.oaaoTodoSuggest = key;
    chip.className =
        'flex flex-wrap items-center gap-2 w-full min-w-0 rounded-xl border border-solid border-violet-4/40 bg-violet-1/25 px-3 py-2';

    const label = document.createElement('span');
    label.className = 'flex-1 min-w-0 text-[0.8125rem] fg-[var(--grid-ink)] truncate';
    label.textContent = String(payload.title || 'Add to todos?');

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
    addBtn.textContent = 'Add to todos';

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] border-none bg-transparent fg-[var(--grid-caption)] cursor-pointer font-inherit underline';
    dismissBtn.textContent = 'Dismiss';

    addBtn.addEventListener('click', () => {
        void openAddToTodosDialog(mount, cid, mid, payload, workspaceBodyFields);
    });
    dismissBtn.addEventListener('click', () => {
        dismissTodoSuggestion(cid, mid);
        chip.remove();
    });

    chip.append(label, addBtn, dismissBtn);
    outer.append(chip);
}

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {number} messageId
 * @param {Record<string, unknown>} payload
 * @param {() => Record<string, unknown>} workspaceBodyFields
 */
/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {number} messageId
 * @param {Record<string, unknown>} payload
 */
export function renderTodoResolveChip(mount, conversationId, messageId, payload) {
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    const todoId = Math.floor(Number(payload.todo_id ?? 0));
    if (cid < 1 || mid < 1 || todoId < 1) return;

    const msgsHost = mount.querySelector('[data-oaao-chat="messages"]');
    if (!(msgsHost instanceof HTMLElement)) return;
    const bubble = msgsHost.querySelector(`[data-oaao-msg-id="${mid}"]`);
    if (!(bubble instanceof HTMLElement)) return;
    const outer = bubble.closest('.oaao-chat-assistant-row');
    if (!(outer instanceof HTMLElement)) return;
    if (outer.querySelector(`[data-oaao-todo-resolve="${todoId}"]`)) return;

    const chip = document.createElement('div');
    chip.dataset.oaaoTodoResolve = String(todoId);
    chip.className =
        'flex flex-wrap items-center gap-2 w-full min-w-0 rounded-xl border border-solid border-emerald-4/40 bg-emerald-1/20 px-3 py-2';

    const label = document.createElement('span');
    label.className = 'flex-1 min-w-0 text-[0.8125rem] fg-[var(--grid-ink)] truncate';
    label.textContent = `Mark done: ${String(payload.title || 'Todo')}`;

    const resolveBtn = document.createElement('button');
    resolveBtn.type = 'button';
    resolveBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
    resolveBtn.textContent = 'Resolve';

    resolveBtn.addEventListener('click', () => {
        void fetch(todoApiUrl('todos_resolve'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ todo_id: todoId }),
        }).then(() => {
            chip.remove();
            document.dispatchEvent(new CustomEvent('oaao:todos-changed'));
        });
    });

    chip.append(label, resolveBtn);
    outer.append(chip);
}

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {number} messageId
 * @param {Record<string, unknown>} payload
 */
export function handleTodoResolveSuggestedStream(mount, conversationId, messageId, payload) {
    renderTodoResolveChip(mount, conversationId, messageId, payload);
}

export function handleTodoItemSuggestedStream(
    mount,
    conversationId,
    messageId,
    payload,
    workspaceBodyFields,
) {
    renderTodoSuggestChip(mount, conversationId, messageId, payload, workspaceBodyFields);
}

export default {
    handleTodoItemSuggestedStream,
    handleTodoResolveSuggestedStream,
    renderTodoSuggestChip,
    renderTodoResolveChip,
    dismissTodoSuggestion,
    todoApiUrl,
};
