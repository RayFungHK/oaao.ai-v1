/**
 * CS-6-S4/S5 — Todo suggestion chip on assistant message + save.
 *
 * @module conversation-todo-suggest
 */

import { oaaoT } from '../../../core/default/js/oaao-i18n.js';

/** @param {string} key @param {string} fallback */
function pt(key, fallback) {
    return oaaoT(key, fallback);
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} fallback
 */
function chipLabelText(payload, fallback) {
    const t = String(payload.title || '').trim();
    if (!t || /knowledge-base|vault search|scoped or ran|pipeline task/i.test(t)) {
        return fallback;
    }
    return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

/** @type {Set<string>} */
const todoSuggestionDismissed = new Set();

/**
 * @param {number} conversationId
 * @param {number} messageId
 * @param {string} [suffix]
 */
function dismissKey(conversationId, messageId, suffix = '') {
    const base = `${Math.floor(Number(conversationId))}:${Math.floor(Number(messageId))}`;
    const s = String(suffix ?? '').trim();
    return s ? `${base}:${s}` : base;
}

/**
 * @param {number} conversationId
 * @param {number} messageId
 */
export function dismissTodoSuggestion(conversationId, messageId, suffix = '') {
    todoSuggestionDismissed.add(dismissKey(conversationId, messageId, suffix));
}

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

/**
 * @param {string} path
 */
function prefixed(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    const prefix = mountPrefix();
    return prefix ? `${prefix}${p}`.replace(/\/{2,}/g, '/') : p;
}

/**
 * @param {string} path
 */
export function todoApiUrl(path) {
    const base = `${mountPrefix()}/todo/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

/** @type {Promise<typeof import('../../../core/default/webassets/razyui/component/Dialog.js').default>|null} */
let dialogCtorPromise = null;

async function loadDialogCtor() {
    if (!dialogCtorPromise) {
        dialogCtorPromise = import(
            /* webpackIgnore: true */ prefixed('/webassets/core/default/razyui/component/Dialog.js'),
        ).then((m) => m.default);
    }
    return dialogCtorPromise;
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
 * @param {Array<Record<string, unknown>>} items
 * @param {() => Record<string, unknown>} workspaceBodyFields
 */
async function openAddMultipleTodosDialog(mount, conversationId, messageId, items, workspaceBodyFields) {
    const Dialog = await loadDialogCtor();
    const body = document.createElement('div');
    body.className = 'flex flex-col gap-3 min-w-0 max-h-[min(360px,50vh)] overflow-y-auto';

    const rows = [];
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const wrap = document.createElement('label');
        wrap.className =
            'flex items-start gap-2 rounded-[8px] border border-solid border-[var(--grid-line)] px-3 py-2 cursor-pointer';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.className = 'mt-1 shrink-0';
        const col = document.createElement('div');
        col.className = 'flex flex-col gap-1 flex-1 min-w-0';
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className =
            'w-full rounded-[6px] border border-solid border-[var(--grid-line)] px-2 py-1.5 text-[0.875rem] font-inherit';
        titleInput.value = String(item.title || '');
        const hint = document.createElement('span');
        hint.className = 'text-[0.6875rem] fg-[var(--grid-caption)] line-clamp-2';
        hint.textContent = String(item.context_snippet || '').slice(0, 120);
        col.append(titleInput, hint);
        wrap.append(cb, col);
        body.append(wrap);
        rows.push({ cb, titleInput, item });
    }

    void new Dialog({
        title: pt('productivity.todo.dialog_title_multi', 'Add to todos'),
        content: body,
        size: 'md',
        closable: true,
        buttons: [
            { text: pt('productivity.common.cancel', 'Cancel'), color: 'muted', role: 'cancel' },
            {
                text: pt('productivity.todo.add_all', 'Add selected'),
                color: 'accent',
                close: false,
                action: async () => {
                    const extra = workspaceBodyFields();
                    let added = 0;
                    for (let i = 0; i < rows.length; i += 1) {
                        const { cb, titleInput, item } = rows[i];
                        if (!(cb instanceof HTMLInputElement) || !cb.checked) continue;
                        const title = titleInput.value.trim();
                        if (!title) continue;
                        const res = await fetch(todoApiUrl('todos_save'), {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                            body: JSON.stringify({
                                title,
                                status: 'open',
                                context_snippet: String(item.context_snippet || ''),
                                conversation_id: conversationId,
                                message_id: messageId,
                                priority: String(item.priority || 'normal'),
                                workspace_id: extra.workspace_id ?? null,
                            }),
                        });
                        const data = await res.json().catch(() => null);
                        if (res.ok && data?.success) added += 1;
                    }
                    if (added < 1) return false;
                    dismissTodoSuggestion(conversationId, messageId, 'batch');
                    mount
                        .querySelector(`[data-oaao-todo-suggest="${dismissKey(conversationId, messageId, 'batch')}"]`)
                        ?.remove();
                    document.dispatchEvent(new CustomEvent('oaao:todos-changed'));
                    return true;
                },
            },
        ],
    });
}

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

    void new Dialog({
        title: pt('productivity.todo.dialog_title', 'Add to todos'),
        content: body,
        size: 'sm',
        closable: true,
        buttons: [
            { text: pt('productivity.common.cancel', 'Cancel'), color: 'muted', role: 'cancel' },
            {
                text: pt('productivity.common.add', 'Add'),
                color: 'accent',
                close: false,
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
    const suffix = String(payload.suggestion_index ?? '');
    const key = dismissKey(cid, mid, suffix);
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
    label.textContent = chipLabelText(payload, pt('productivity.todo.add_prompt', 'Add to todos?'));
    label.title = String(payload.title || '');

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
    addBtn.textContent = pt('productivity.todo.add', 'Add to todos');

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] border-none bg-transparent fg-[var(--grid-caption)] cursor-pointer font-inherit underline';
    dismissBtn.textContent = pt('productivity.dismiss', 'Dismiss');

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
export function renderTodoItemsSuggestChip(mount, conversationId, messageId, payload, workspaceBodyFields) {
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    if (cid < 1 || mid < 1) return;
    const key = dismissKey(cid, mid, 'batch');
    if (todoSuggestionDismissed.has(key)) return;

    const raw = payload.items;
    if (!Array.isArray(raw) || raw.length < 2) return;
    const items = raw.filter((row) => row && typeof row === 'object' && String(row.title || '').trim());
    if (items.length < 2) return;

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
    label.className = 'flex-1 min-w-0 text-[0.8125rem] fg-[var(--grid-ink)]';
    const n = items.length;
    label.textContent = oaaoT('productivity.todo.add_multi_prompt', 'Add {count} todos?', { count: n });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
    addBtn.textContent = pt('productivity.todo.add', 'Add to todos');

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] border-none bg-transparent fg-[var(--grid-caption)] cursor-pointer font-inherit underline';
    dismissBtn.textContent = pt('productivity.dismiss', 'Dismiss');

    addBtn.addEventListener('click', () => {
        void openAddMultipleTodosDialog(mount, cid, mid, items, workspaceBodyFields);
    });
    dismissBtn.addEventListener('click', () => {
        dismissTodoSuggestion(cid, mid, 'batch');
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

export function handleTodoItemsSuggestedStream(
    mount,
    conversationId,
    messageId,
    payload,
    workspaceBodyFields,
) {
    renderTodoItemsSuggestChip(mount, conversationId, messageId, payload, workspaceBodyFields);
}

export default {
    handleTodoItemSuggestedStream,
    handleTodoItemsSuggestedStream,
    handleTodoResolveSuggestedStream,
    renderTodoSuggestChip,
    renderTodoItemsSuggestChip,
    renderTodoResolveChip,
    dismissTodoSuggestion,
    todoApiUrl,
};
