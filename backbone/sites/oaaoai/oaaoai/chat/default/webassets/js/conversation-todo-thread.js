/**
 * CS-6-S6 — Thread strip for open conversation-linked todos.
 *
 * Compact by default (count + expand). Resolve via checkmark — not full "Mark complete" rows.
 *
 * @module conversation-todo-thread
 */

import { oaaoT } from '../../../core/default/js/oaao-i18n.js';
import { todoApiUrl } from './conversation-todo-suggest.js';

/** @param {string} key @param {string} fallback */
function pt(key, fallback) {
    return oaaoT(key, fallback);
}

/**
 * @param {HTMLElement} host
 * @param {boolean} expanded
 */
function setThreadTodoExpanded(host, expanded) {
    host.dataset.oaaoTodoExpanded = expanded ? '1' : '0';
    const list = host.querySelector('[data-oaao-thread-todo-list]');
    if (list instanceof HTMLElement) {
        list.classList.toggle('hidden', !expanded);
    }
    const toggle = host.querySelector('[data-oaao-thread-todo-toggle]');
    if (toggle instanceof HTMLButtonElement) {
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
}

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 */
export async function refreshThreadTodoStrip(mount, conversationId) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return;

    const chatRoot =
        mount?.closest?.('[data-module="oaao-chat"]') ??
        (mount?.dataset?.module === 'oaao-chat' ? mount : null);
    if (chatRoot instanceof HTMLElement && chatRoot.dataset.oaaoChatMount === 'bubble') {
        return;
    }

    let host = mount.querySelector('[data-oaao-chat="thread-todo-strip"]');
    const wasExpanded = host instanceof HTMLElement && host.dataset.oaaoTodoExpanded === '1';

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

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 min-w-0';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.dataset.oaaoThreadTodoToggle = '1';
        toggle.className =
            'flex flex-1 min-w-0 items-center gap-2 m-0 p-0 border-0 bg-transparent cursor-pointer font-inherit text-left';
        toggle.setAttribute('aria-expanded', wasExpanded ? 'true' : 'false');

        const title = document.createElement('span');
        title.className =
            'text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold truncate';
        title.textContent = `${pt('productivity.todo.open_panel', 'Open todos')} (${rows.length})`;

        const chevron = document.createElement('span');
        chevron.className = 'shrink-0 text-[0.625rem] fg-[var(--grid-caption)]';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = wasExpanded ? '▾' : '▸';

        toggle.append(title, chevron);
        toggle.addEventListener('click', () => {
            const next = host.dataset.oaaoTodoExpanded !== '1';
            setThreadTodoExpanded(host, next);
            chevron.textContent = next ? '▾' : '▸';
        });

        header.append(toggle);
        host.append(header);

        const list = document.createElement('div');
        list.dataset.oaaoThreadTodoList = '1';
        list.className = wasExpanded
            ? 'flex flex-col gap-1 pl-1'
            : 'hidden flex flex-col gap-1 pl-1';

        for (const row of rows) {
            const item = document.createElement('div');
            item.className = 'flex items-center gap-2 min-w-0';
            const lbl = document.createElement('span');
            lbl.className = 'flex-1 min-w-0 text-[0.8125rem] truncate fg-[var(--grid-ink)]';
            lbl.textContent = String(row.title || '');
            const doneBtn = document.createElement('button');
            doneBtn.type = 'button';
            doneBtn.className =
                'shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit fg-[var(--grid-caption)] hover:fg-[var(--grid-ink)]';
            doneBtn.setAttribute('aria-label', pt('productivity.todo.resolve', 'Resolve'));
            doneBtn.title = pt('productivity.todo.resolve', 'Resolve');
            doneBtn.textContent = '✓';
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
            list.append(item);
        }

        host.append(list);
        setThreadTodoExpanded(host, wasExpanded);
    } catch {
        host.classList.add('hidden');
    }
}
