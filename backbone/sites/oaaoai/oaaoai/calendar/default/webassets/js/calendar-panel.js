/**
 * CS-5-S3 — Calendar workspace panel: list + month (RazyUI CalendarView).
 *
 * @module calendar-panel
 */

/** @type {'list' | 'month'} */
let activeView = 'month';

/** @type {Array<Record<string, unknown>>} */
let cachedEvents = [];

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

function calendarApiUrl(path) {
    const base = `${mountPrefix()}/calendar/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

/**
 * @param {number|null} workspaceId
 */
function scopeQuery(workspaceId) {
    const q = new URLSearchParams();
    if (workspaceId != null && workspaceId > 0) {
        q.set('workspace_id', String(workspaceId));
    }
    const s = q.toString();
    return s ? `?${s}` : '';
}

function activeWorkspaceId() {
    const root = document.getElementById('workspace-view');
    const ds = root?.dataset?.oaaoActiveWorkspaceId?.trim() ?? '';
    if (!ds) return null;
    const n = Number(ds);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

async function calendarFetchJson(path, options = {}) {
    const res = await fetch(calendarApiUrl(path), {
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
        ...options,
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    return { res, data };
}

/** @returns {Promise<{ load: (name: string) => Promise<unknown> }>} */
async function loadRazyui() {
    const mod = await import(/* webpackIgnore: true */ 'razyui');
    return /** @type {{ load: (name: string) => Promise<unknown> }} */ (mod.default ?? mod);
}

/**
 * @param {Record<string, unknown>} row
 */
function rowToCalendarEvent(row) {
    const id = String(row.event_id ?? '');
    const startRaw = String(row.start_at ?? '');
    const endRaw = String(row.end_at ?? '');
    return {
        id,
        title: String(row.title || 'Untitled'),
        start: startRaw ? new Date(startRaw) : new Date(),
        end: endRaw ? new Date(endRaw) : new Date(),
        description: String(row.notes ?? ''),
        color: row.status === 'cancelled' ? 'hsl(0, 65%, 55%)' : 'hsl(216, 72%, 56%)',
    };
}

/**
 * @param {{ id?: string, title?: string, start?: Date, end?: Date, description?: string }} ev
 */
async function persistCalendarEvent(ev) {
    const wid = activeWorkspaceId();
    const eventId = ev.id && /^\d+$/.test(String(ev.id)) ? Number(ev.id) : 0;
    const payload = {
        ...(eventId > 0 ? { event_id: eventId } : {}),
        title: String(ev.title || 'Untitled'),
        start_at: ev.start instanceof Date ? ev.start.toISOString() : new Date().toISOString(),
        end_at: ev.end instanceof Date ? ev.end.toISOString() : new Date().toISOString(),
        notes: String(ev.description ?? ''),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        ...(wid != null ? { workspace_id: wid } : {}),
    };
    return calendarFetchJson('calendar_events_save', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/**
 * @param {string} eventId
 */
async function deleteCalendarEvent(eventId) {
    return calendarFetchJson('calendar_event_delete', {
        method: 'POST',
        body: JSON.stringify({ event_id: Number(eventId) }),
    });
}

async function fetchCalendarEvents() {
    const wid = activeWorkspaceId();
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();
    const q = new URLSearchParams(scopeQuery(wid).replace(/^\?/, ''));
    q.set('from', from);
    q.set('to', to);
    const { res, data } = await calendarFetchJson(`calendar_events_list?${q}`);
    if (!res.ok || !data?.success) {
        cachedEvents = [];
        return [];
    }
    cachedEvents = Array.isArray(data?.data?.events) ? data.data.events : [];
    return cachedEvents.map(rowToCalendarEvent);
}

/**
 * @param {HTMLElement} listHost
 */
function renderListView(listHost) {
    listHost.replaceChildren();
    if (!cachedEvents.length) {
        const empty = document.createElement('p');
        empty.className = 'm-0 text-[0.875rem] fg-[var(--grid-caption)]';
        empty.textContent = 'No upcoming events.';
        listHost.append(empty);
        return;
    }
    const sorted = [...cachedEvents].sort(
        (a, b) => String(a.start_at ?? '').localeCompare(String(b.start_at ?? '')),
    );
    for (const row of sorted) {
        const card = document.createElement('article');
        card.className =
            'rounded-[10px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-3 py-2 flex flex-col gap-0.5';
        const title = document.createElement('h3');
        title.className = 'm-0 text-[0.9375rem] fw-semibold fg-[var(--grid-ink)]';
        title.textContent = String(row.title || 'Untitled');
        const when = document.createElement('p');
        when.className = 'm-0 text-[0.8125rem] fg-[var(--grid-caption)]';
        const start = row.start_at ? new Date(String(row.start_at)) : null;
        when.textContent = start ? start.toLocaleString() : '';
        card.append(title, when);
        if (row.location) {
            const loc = document.createElement('p');
            loc.className = 'm-0 text-[0.75rem] fg-[var(--grid-caption)]';
            loc.textContent = String(row.location);
            card.append(loc);
        }
        const cid = Number(row.conversation_id ?? 0);
        if (cid > 0) {
            const link = document.createElement('button');
            link.type = 'button';
            link.className =
                'self-start border-0 bg-transparent p-0 text-[0.75rem] fg-[var(--grid-accent)] cursor-pointer font-inherit underline';
            link.textContent = 'Open source chat';
            link.addEventListener('click', () => {
                document.dispatchEvent(
                    new CustomEvent('oaao:navigate-chat', { detail: { conversation_id: cid } }),
                );
            });
            card.append(link);
        }
        listHost.append(card);
    }
}

/** @type {import('../../../../../core/default/razyui/component/CalendarView.js').default | null} */
let monthCalendar = null;

/**
 * @param {HTMLElement} monthHost
 */
async function renderMonthView(monthHost) {
    monthHost.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'text-[0.8125rem] fg-[var(--grid-caption)]';
    loading.textContent = 'Loading calendar…';
    monthHost.append(loading);

    const events = await fetchCalendarEvents();
    monthHost.replaceChildren();

    let CalendarViewCtor;
    try {
        const razyui = await loadRazyui();
        if (typeof razyui?.load !== 'function') {
            throw new Error('RazyUI loader missing .load');
        }
        const loaded = await razyui.load('CalendarView');
        CalendarViewCtor = loaded?.default ?? loaded;
        if (typeof CalendarViewCtor !== 'function') {
            throw new Error('CalendarView export invalid');
        }
    } catch (err) {
        console.error('[calendar-panel] CalendarView load failed', err);
        const fail = document.createElement('p');
        fail.className = 'm-0 text-[0.875rem] fg-[var(--grid-caution,#b45309)]';
        fail.textContent = 'Could not load calendar view. Hard refresh and try again.';
        monthHost.append(fail);
        return;
    }

    const mountEl = document.createElement('div');
    mountEl.className = 'h-full min-h-[420px] w-full';
    monthHost.append(mountEl);

    monthCalendar = new CalendarViewCtor(mountEl, {
        view: 'month',
        events,
        crud: {
            onAfterAdd: async (ev) => {
                await persistCalendarEvent(ev);
                await refreshCalendarPanel(monthHost.closest('.oaao-calendar-root'));
            },
            onAfterEdit: async (ev) => {
                await persistCalendarEvent(ev);
                await refreshCalendarPanel(monthHost.closest('.oaao-calendar-root'));
            },
            onAfterDelete: async (ev) => {
                if (ev?.id) await deleteCalendarEvent(String(ev.id));
                await refreshCalendarPanel(monthHost.closest('.oaao-calendar-root'));
            },
        },
    });
}

/**
 * @param {HTMLElement|null} root
 */
async function refreshCalendarPanel(root) {
    if (!(root instanceof HTMLElement)) return;
    const listHost = root.querySelector('[data-oaao-calendar="list-view"]');
    const monthHost = root.querySelector('[data-oaao-calendar="month-view"]');
    await fetchCalendarEvents();
    if (listHost instanceof HTMLElement && activeView === 'list') {
        renderListView(listHost);
    }
    if (monthHost instanceof HTMLElement && activeView === 'month') {
        if (monthCalendar && typeof monthCalendar.setEvents === 'function') {
            monthCalendar.setEvents(cachedEvents.map(rowToCalendarEvent));
        } else {
            await renderMonthView(monthHost);
        }
    }
}

/**
 * @param {HTMLElement} root
 */
function wireCalendarPanel(root) {
    const listHost = root.querySelector('[data-oaao-calendar="list-view"]');
    const monthHost = root.querySelector('[data-oaao-calendar="month-view"]');
    const viewBtns = root.querySelectorAll('[data-oaao-calendar-view]');
    const newBtn = root.querySelector('[data-oaao-calendar="new-event"]');

    function setView(view) {
        activeView = view === 'list' ? 'list' : 'month';
        viewBtns.forEach((btn) => {
            const on = btn.getAttribute('data-oaao-calendar-view') === activeView;
            btn.classList.toggle('fw-semibold', on);
            btn.classList.toggle('bg-[var(--grid-line)]/35', on);
            btn.classList.toggle('bg-[var(--grid-paper)]', !on);
        });
        if (listHost instanceof HTMLElement) {
            listHost.classList.toggle('hidden', activeView !== 'list');
            listHost.classList.toggle('flex', activeView === 'list');
        }
        if (monthHost instanceof HTMLElement) {
            monthHost.classList.toggle('hidden', activeView !== 'month');
        }
        void refreshCalendarPanel(root);
    }

    viewBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const v = btn.getAttribute('data-oaao-calendar-view');
            setView(v === 'list' ? 'list' : 'month');
        });
    });

    if (newBtn) {
        newBtn.addEventListener('click', async () => {
            const start = new Date();
            start.setMinutes(0, 0, 0);
            const end = new Date(start.getTime() + 3600000);
            await persistCalendarEvent({ title: 'New event', start, end });
            setView('list');
        });
    }

    document.addEventListener('oaao-workspace-scope-changed', () => {
        void refreshCalendarPanel(root);
    });

    setView('month');
}

export async function mountCalendarPanel(host) {
    const root =
        host?.querySelector?.('.oaao-calendar-root') ||
        host?.closest?.('.oaao-calendar-root') ||
        document.querySelector('.oaao-calendar-root');
    if (!(root instanceof HTMLElement)) return;
    wireCalendarPanel(root);
    const JIT = globalThis.JIT;
    if (JIT?.hydrate) JIT.hydrate(root);
}

export default { mountCalendarPanel };
