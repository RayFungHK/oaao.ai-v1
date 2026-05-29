/**
 * CS-6-S2 — Header todos dropdown (mirrors notification-panel pattern).
 */

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

function todoApiUrl(path) {
    const base = `${mountPrefix()}/todo/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : '';
}

function sessionActive() {
    return document.body?.classList.contains('oaao-session-active') === true;
}

function activeWorkspaceId() {
    const root = document.getElementById('workspace-view');
    const ds = root?.dataset?.oaaoActiveWorkspaceId?.trim() ?? '';
    if (!ds) return null;
    const n = Number(ds);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * @param {HTMLElement | null} badge
 * @param {number} count
 */
function setBadgeCount(badge, count) {
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.remove('hidden');
    } else {
        badge.textContent = '';
        badge.classList.add('hidden');
    }
}

/**
 * @param {HTMLElement} panel
 * @param {HTMLElement | null} badge
 * @param {Array<Record<string, unknown>>} rows
 */
function renderTodoList(panel, badge, rows) {
    panel.textContent = '';
    const header = document.createElement('div');
    header.className =
        'flex items-center justify-between gap-2 px-3 py-2 border-b border-solid border-[var(--grid-line)]';
    const hTitle = document.createElement('span');
    hTitle.className = 'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)]';
    hTitle.textContent = 'Todos';
    const filterSel = document.createElement('select');
    filterSel.className =
        'text-[0.75rem] rounded border border-solid border-[var(--grid-line)] px-1.5 py-0.5 bg-[var(--grid-paper)] font-inherit';
    for (const opt of [
        ['open', 'Open'],
        ['done', 'Done'],
        ['all', 'All'],
    ]) {
        const o = document.createElement('option');
        o.value = opt[0];
        o.textContent = opt[1];
        filterSel.append(o);
    }
    header.append(hTitle, filterSel);
    panel.append(header);

    const listWrap = document.createElement('div');
    listWrap.dataset.oaaoTodosList = '1';
    panel.append(listWrap);

    const renderRows = (status) => {
        listWrap.textContent = '';
        const filtered =
            status === 'all'
                ? rows
                : rows.filter((r) => String(r.status || '') === status);
        if (filtered.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'px-3 py-3 text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0';
            empty.textContent = 'No todos.';
            listWrap.append(empty);
            return;
        }
        for (const row of filtered) {
            const item = document.createElement('div');
            item.className =
                'flex flex-col gap-1 px-3 py-2 border-b border-solid border-[var(--grid-line)] last:border-b-0';
            const title = document.createElement('div');
            title.className = 'text-[0.8125rem] fw-medium fg-[var(--grid-ink)]';
            title.textContent = String(row.title || 'Untitled');
            item.append(title);
            if (row.context_snippet) {
                const snip = document.createElement('div');
                snip.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)] line-clamp-2';
                snip.textContent = String(row.context_snippet);
                item.append(snip);
            }
            const actions = document.createElement('div');
            actions.className = 'flex flex-wrap gap-2';
            const cid = Number(row.conversation_id ?? 0);
            if (cid > 0) {
                const chatLink = document.createElement('button');
                chatLink.type = 'button';
                chatLink.className =
                    'border-0 bg-transparent p-0 text-[0.75rem] fg-[var(--grid-accent)] cursor-pointer font-inherit underline';
                chatLink.textContent = 'Open chat';
                chatLink.addEventListener('click', () => {
                    document.dispatchEvent(
                        new CustomEvent('oaao:navigate-chat', { detail: { conversation_id: cid } }),
                    );
                });
                actions.append(chatLink);
            }
            if (String(row.status || '') === 'open') {
                const doneBtn = document.createElement('button');
                doneBtn.type = 'button';
                doneBtn.className =
                    'text-[0.75rem] px-2 py-0.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
                doneBtn.textContent = 'Done';
                const todoId = Number(row.todo_id ?? 0);
                doneBtn.addEventListener('click', () => {
                    void fetch(todoApiUrl('todos_resolve'), {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({ todo_id: todoId }),
                    }).then(() => refreshTodos(panel, badge));
                });
                actions.append(doneBtn);
            } else if (String(row.status || '') === 'done') {
                const reopenBtn = document.createElement('button');
                reopenBtn.type = 'button';
                reopenBtn.className =
                    'text-[0.75rem] px-2 py-0.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
                reopenBtn.textContent = 'Reopen';
                const todoId = Number(row.todo_id ?? 0);
                reopenBtn.addEventListener('click', () => {
                    void fetch(todoApiUrl('todos_save'), {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({ todo_id: todoId, title: String(row.title || ''), status: 'open' }),
                    }).then(() => refreshTodos(panel, badge));
                });
                actions.append(reopenBtn);
            }
            if (actions.childElementCount > 0) item.append(actions);
            listWrap.append(item);
        }
    };

    renderRows(filterSel.value);
    filterSel.addEventListener('change', () => renderRows(filterSel.value));
}

/**
 * @param {HTMLElement} panel
 * @param {HTMLElement | null} badge
 */
async function refreshTodos(panel, badge) {
    if (!sessionActive()) {
        setBadgeCount(badge, 0);
        panel.textContent = '';
        return;
    }
    const wid = activeWorkspaceId();
    const q = new URLSearchParams({ status: 'all' });
    if (wid != null) q.set('workspace_id', String(wid));
    try {
        const res = await fetch(`${todoApiUrl('todos_list')}?${q}`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
            panel.textContent = '';
            const err = document.createElement('p');
            err.className = 'px-3 py-3 text-[0.8125rem] fg-[var(--grid-danger)] m-0';
            err.textContent = typeof data.message === 'string' ? data.message : 'Could not load todos.';
            panel.append(err);
            return;
        }
        const rows = Array.isArray(data.data?.todos) ? data.data.todos : [];
        const openCount = Number(data.data?.open_count ?? 0);
        setBadgeCount(badge, openCount);
        renderTodoList(panel, badge, rows);
    } catch {
        panel.textContent = '';
        const err = document.createElement('p');
        err.className = 'px-3 py-3 text-[0.8125rem] fg-[var(--grid-danger)] m-0';
        err.textContent = 'Could not load todos.';
        panel.append(err);
    }
}

/** Wire todos icon in workspace header (left of notifications). */
export function wireWorkspaceTodos() {
    const trigger = document.getElementById('workspace-todos-trigger');
    const anchor = document.getElementById('workspace-todos-anchor');
    const panel = document.getElementById('workspace-todos-panel');
    const badge = document.getElementById('workspace-todos-badge');
    if (!trigger || !panel || !anchor || trigger.dataset.oaaoTodosBound === '1') return;
    if (!sessionActive()) return;
    trigger.dataset.oaaoTodosBound = '1';

    let open = false;

    const close = () => {
        open = false;
        anchor.classList.add('hidden');
        anchor.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    };

    const openPanel = () => {
        open = true;
        anchor.classList.remove('hidden');
        anchor.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        void refreshTodos(panel, badge);
    };

    trigger.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (open) close();
        else openPanel();
    });

    document.addEventListener(
        'click',
        (ev) => {
            if (!open) return;
            if (!(ev.target instanceof Node)) return;
            if (trigger.contains(ev.target) || anchor.contains(ev.target)) return;
            close();
        },
        true,
    );

    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') close();
    });

    document.addEventListener('oaao:todos-changed', () => {
        if (open) void refreshTodos(panel, badge);
        else void refreshTodos(panel, badge);
    });

    void refreshTodos(panel, badge);
}
