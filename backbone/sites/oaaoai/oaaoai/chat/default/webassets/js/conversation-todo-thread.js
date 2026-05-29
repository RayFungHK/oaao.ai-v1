/**
 * CS-6-S6 — Thread strip for open conversation-linked todos.
 *
 * @module conversation-todo-thread
 */

import { todoApiUrl } from './conversation-todo-suggest.js';

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 */
export async function refreshThreadTodoStrip(mount, conversationId) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return;

    let host = mount.querySelector('[data-oaao-chat="thread-todo-strip"]');
    if (!(host instanceof HTMLElement)) {
        host = document.createElement('div');
        host.dataset.oaaoChat = 'thread-todo-strip';
        host.className =
            'hidden shrink-0 flex flex-col gap-1 px-3 py-2 border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel)]/60';
        const msgs = mount.querySelector('[data-oaao-chat="messages"]');
        if (msgs instanceof HTMLElement) {
            msgs.parentElement?.insertBefore(host, msgs);
        } else {
            mount.prepend(host);
        }
    }

    const q = new URLSearchParams({ status: 'open', conversation_id: String(cid) });
    try {
        const res = await fetch(`${todoApiUrl('todos_list')}?${q}`, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok || !data?.success) {
            host.classList.add('hidden');
            host.replaceChildren();
            return;
        }
        const rows = Array.isArray(data?.data?.todos) ? data.data.todos : [];
        if (rows.length === 0) {
            host.classList.add('hidden');
            host.replaceChildren();
            return;
        }

        host.classList.remove('hidden');
        host.replaceChildren();

        const title = document.createElement('p');
        title.className = 'm-0 text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold';
        title.textContent = `Open todos (${rows.length})`;
        host.append(title);

        for (const row of rows) {
            const item = document.createElement('div');
            item.className = 'flex items-center gap-2 min-w-0';
            const lbl = document.createElement('span');
            lbl.className = 'flex-1 min-w-0 text-[0.8125rem] truncate fg-[var(--grid-ink)]';
            lbl.textContent = String(row.title || '');
            const doneBtn = document.createElement('button');
            doneBtn.type = 'button';
            doneBtn.className =
                'shrink-0 text-[0.75rem] px-2 py-0.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
            doneBtn.textContent = 'Resolve';
            const todoId = Number(row.todo_id ?? 0);
            doneBtn.addEventListener('click', () => {
                void fetch(todoApiUrl('todos_resolve'), {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ todo_id: todoId }),
                }).then(() => {
                    document.dispatchEvent(new CustomEvent('oaao:todos-changed'));
                    void refreshThreadTodoStrip(mount, cid);
                });
            });
            item.append(lbl, doneBtn);
            host.append(item);
        }
    } catch {
        host.classList.add('hidden');
    }
}
