/**
 * CS-5-S3 — Calendar workspace panel: list + month (RazyUI CalendarView).
 *
 * @module calendar-panel
 */

import { oaaoT } from '../../../core/default/js/oaao-i18n.js';
import { summarizeCalendarNotes, CALENDAR_NOTES_STORAGE_MAX } from './calendar-notes.js';
import { planCalendarEventFields } from './calendar-planner-api.js';

/** @type {'list' | 'month'} */
let activeView = 'month';

/** @type {Array<Record<string, unknown>>} */
let cachedEvents = [];

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

/**
 * @param {string} path
 */
function prefixed(path) {
    const prefix = mountPrefix();
    const p = path.startsWith('/') ? path : `/${path}`;
    return prefix ? `${prefix}${p}`.replace(/\/{2,}/g, '/') : p;
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

/** @type {Promise<typeof import('../../../core/default/razyui/component/CalendarView.js').default>|null} */
let calendarViewCtorPromise = null;

async function loadCalendarViewCtor() {
    if (!calendarViewCtorPromise) {
        calendarViewCtorPromise = import(
            /* webpackIgnore: true */ prefixed('/webassets/core/default/razyui/component/CalendarView.js'),
        ).then((m) => m.default ?? m);
    }
    return calendarViewCtorPromise;
}

/**
 * @param {string} eventId
 */
function calendarRowById(eventId) {
    const id = String(eventId ?? '');
    return cachedEvents.find((r) => String(r.event_id ?? '') === id) ?? null;
}

/**
 * @param {Record<string, unknown>} row
 */
function rowToCalendarEvent(row) {
    const id = String(row.event_id ?? '');
    const startRaw = String(row.start_at ?? '');
    const endRaw = String(row.end_at ?? '');
    const notesRaw = String(row.notes ?? '');
    return {
        id,
        title: String(row.title || 'Untitled'),
        start: startRaw ? new Date(startRaw) : new Date(),
        end: endRaw ? new Date(endRaw) : new Date(),
        description: summarizeCalendarNotes(notesRaw),
        color: row.status === 'cancelled' ? 'hsl(0, 65%, 55%)' : 'hsl(216, 72%, 56%)',
    };
}

/**
 * @param {string} s
 */
function escapeCalendarFormHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

/**
 * RazyUI CalendarView CRUD form — native date/time inputs (no DatePicker widgets; avoids Dialog layout break).
 *
 * @param {'add' | 'edit'} mode
 * @param {{ id?: string, title?: string, start?: Date, end?: Date }} event
 * @param {string} [notesFull]
 */
function calendarEventFormHtml(mode, event, notesFull = '') {
    const start = event.start instanceof Date ? event.start : new Date();
    const end =
        event.end instanceof Date ? event.end : new Date(start.getTime() + 3600000);
    const pad = (n) => String(n).padStart(2, '0');
    const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const endDate = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
    const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
    const desc =
        mode === 'edit'
            ? summarizeCalendarNotes(notesFull, CALENDAR_NOTES_STORAGE_MAX)
            : '';
    const idHidden =
        mode === 'edit'
            ? `<input type="hidden" name="id" value="${escapeCalendarFormHtml(event.id ?? '')}"/>`
            : '';
    const titleVal = mode === 'edit' ? escapeCalendarFormHtml(event.title || '') : '';
    return `
        <form method="POST" class="oaao-calendar-event-form">
            ${idHidden}
            <label class="oaao-cal-field">
                <span class="oaao-cal-field-label">${escapeCalendarFormHtml(oaaoT('productivity.calendar.label_title', 'Title'))}</span>
                <input type="text" name="title" class="oaao-cal-field-input" value="${titleVal}" placeholder="${escapeCalendarFormHtml(oaaoT('calendar.new_event', 'New event'))}" required autocomplete="off"/>
            </label>
            <div class="oaao-cal-form-row">
                <label class="oaao-cal-field">
                    <span class="oaao-cal-field-label">${escapeCalendarFormHtml(oaaoT('productivity.calendar.label_start', 'Start'))} — ${escapeCalendarFormHtml(oaaoT('calendar.form.date', 'Date'))}</span>
                    <input type="date" name="date" class="oaao-cal-field-input" value="${date}"/>
                </label>
                <label class="oaao-cal-field">
                    <span class="oaao-cal-field-label">${escapeCalendarFormHtml(oaaoT('productivity.calendar.label_start', 'Start'))} — ${escapeCalendarFormHtml(oaaoT('calendar.form.time', 'Time'))}</span>
                    <input type="time" name="startTime" class="oaao-cal-field-input" value="${startTime}"/>
                </label>
            </div>
            <div class="oaao-cal-form-row">
                <label class="oaao-cal-field">
                    <span class="oaao-cal-field-label">${escapeCalendarFormHtml(oaaoT('productivity.calendar.label_end', 'End'))} — ${escapeCalendarFormHtml(oaaoT('calendar.form.date', 'Date'))}</span>
                    <input type="date" name="endDate" class="oaao-cal-field-input" value="${endDate}"/>
                </label>
                <label class="oaao-cal-field">
                    <span class="oaao-cal-field-label">${escapeCalendarFormHtml(oaaoT('productivity.calendar.label_end', 'End'))} — ${escapeCalendarFormHtml(oaaoT('calendar.form.time', 'Time'))}</span>
                    <input type="time" name="endTime" class="oaao-cal-field-input" value="${endTime}"/>
                </label>
            </div>
            <label class="oaao-cal-field">
                <span class="oaao-cal-field-label">${escapeCalendarFormHtml(oaaoT('productivity.calendar.label_notes', 'Notes'))}</span>
                <textarea name="description" class="oaao-cal-field-input oaao-cal-field-textarea" rows="3" placeholder="${escapeCalendarFormHtml(oaaoT('calendar.form.notes_placeholder', 'Optional notes'))}">${escapeCalendarFormHtml(desc)}</textarea>
            </label>
        </form>`;
}

/**
 * @param {{ id?: string, title?: string, start?: Date, end?: Date, description?: string }} ev
 */
async function persistCalendarEvent(ev) {
    const wid = activeWorkspaceId();
    const eventId = ev.id && /^\d+$/.test(String(ev.id)) ? Number(ev.id) : 0;
    const row = eventId > 0 ? calendarRowById(String(eventId)) : null;
    const notesRaw = String(ev.description ?? row?.notes ?? '');
    const startAt = ev.start instanceof Date ? ev.start.toISOString() : new Date().toISOString();
    const endAt = ev.end instanceof Date ? ev.end.toISOString() : new Date().toISOString();
    const planned = await planCalendarEventFields({
        title: String(ev.title || 'Untitled'),
        notes: notesRaw,
        start_at: startAt,
        end_at: endAt,
        location: row?.location != null ? String(row.location) : '',
    });
    const payload = {
        ...(eventId > 0 ? { event_id: eventId } : {}),
        title: planned.title,
        start_at: startAt,
        end_at: endAt,
        notes: planned.notes,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        ...(wid != null ? { workspace_id: wid } : {}),
    };
    const result = await calendarFetchJson('calendar_events_save', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    if (result.res.ok && result.data?.success && result.data?.data?.event_id) {
        ev.id = String(result.data.data.event_id);
    }
    return result;
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

/**
 * Wide list window so month navigation and sidebar upcoming rows stay in sync.
 *
 * @param {Date} [anchor]
 */
function calendarEventsListRange(anchor = new Date()) {
    const y = anchor.getFullYear();
    return {
        from: new Date(y - 1, 0, 1).toISOString(),
        to: new Date(y + 2, 11, 31, 23, 59, 59, 999).toISOString(),
    };
}

/**
 * @param {Date} [anchor]
 */
async function fetchCalendarEvents(anchor = new Date()) {
    const wid = activeWorkspaceId();
    const { from, to } = calendarEventsListRange(anchor);
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

/** @returns {Date} */
function calendarVisibleAnchorDate() {
    const ctrl = monthCalendar?.getControl?.();
    const d = ctrl?.date;
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
}

/**
 * @param {HTMLElement|null} listHost
 */
function renderCalendarSidebarSchedule(listHost) {
    const host =
        listHost instanceof HTMLElement
            ? listHost
            : document.getElementById('workspace-calendar-schedule-list');
    if (!(host instanceof HTMLElement)) return;

    const heading = document.querySelector(
        '#workspace-calendar-sidebar-section [data-i18n="calendar.schedule_heading"]',
    );
    if (heading instanceof HTMLElement) {
        heading.textContent = oaaoT('calendar.schedule_heading', 'Schedule');
    }

    host.replaceChildren();
    const now = Date.now();
    const upcoming = [...cachedEvents]
        .filter((row) => {
            const end = row.end_at ? new Date(String(row.end_at)).getTime() : NaN;
            return Number.isFinite(end) && end >= now;
        })
        .sort((a, b) => String(a.start_at ?? '').localeCompare(String(b.start_at ?? '')));

    if (!upcoming.length) {
        const empty = document.createElement('p');
        empty.className = 'm-0 px-2 text-[0.8125rem] fg-[var(--grid-caption)]';
        empty.textContent = oaaoT('calendar.schedule_empty', 'No upcoming events.');
        host.append(empty);
        return;
    }

    for (const row of upcoming) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'w-full text-left rounded-[8px] border-0 bg-transparent px-2 py-1.5 cursor-pointer font-inherit hover:bg-[var(--grid-line)]/30 flex flex-col gap-0.5 min-w-0';
        const title = document.createElement('span');
        title.className = 'text-[0.8125rem] fw-medium fg-[var(--grid-ink)] truncate';
        title.textContent = String(row.title || 'Untitled');
        const when = document.createElement('span');
        when.className = 'text-[0.75rem] fg-[var(--grid-caption)]';
        const start = row.start_at ? new Date(String(row.start_at)) : null;
        when.textContent = start ? start.toLocaleString() : '';
        btn.append(title, when);
        btn.addEventListener('click', () => {
            const root = document.querySelector('.oaao-calendar-root');
            if (!(root instanceof HTMLElement)) return;
            activeView = 'month';
            const monthHost = root.querySelector('[data-oaao-calendar="month-view"]');
            const listView = root.querySelector('[data-oaao-calendar="list-view"]');
            if (listView instanceof HTMLElement) {
                listView.classList.add('hidden');
                listView.classList.remove('flex');
            }
            if (monthHost instanceof HTMLElement) {
                monthHost.classList.remove('hidden');
            }
            root.querySelectorAll('[data-oaao-calendar-view]').forEach((el) => {
                if (!(el instanceof HTMLElement)) return;
                const on = el.getAttribute('data-oaao-calendar-view') === 'month';
                el.classList.toggle('fw-semibold', on);
                el.classList.toggle('bg-[var(--grid-line)]/35', on);
                el.classList.toggle('bg-[var(--grid-paper)]', !on);
            });
            const ctrl = monthCalendar?.getControl?.();
            if (ctrl && start) {
                ctrl.date = start;
                ctrl.view = 'month';
            }
            void refreshCalendarPanel(root);
        });
        host.append(btn);
    }

    const JIT = globalThis.JIT;
    if (JIT?.hydrate) JIT.hydrate(host);
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

    const events = await fetchCalendarEvents(calendarVisibleAnchorDate());
    monthHost.replaceChildren();

    let CalendarViewCtor;
    try {
        CalendarViewCtor = await loadCalendarViewCtor();
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
    mountEl.className = 'flex flex-1 min-h-[480px] w-full';
    monthHost.append(mountEl);

    const calendarRoot = monthHost.closest('.oaao-calendar-root');
    monthCalendar = new CalendarViewCtor(mountEl, {
        view: 'month',
        events,
        onEventClick: () => {
            requestAnimationFrame(() => {
                const popup = mountEl.querySelector('.cal-popup:not([hidden])');
                const JIT = globalThis.JIT;
                if (popup instanceof HTMLElement && JIT?.hydrate) {
                    JIT.hydrate(popup);
                }
            });
        },
        onNavigate: () => {
            void refreshCalendarPanel(calendarRoot instanceof HTMLElement ? calendarRoot : null);
        },
        crud: {
            renderAddContent: (start, end) => {
                const s = start instanceof Date ? start : new Date();
                const e = end instanceof Date ? end : new Date(s.getTime() + 3600000);
                return calendarEventFormHtml('add', { start: s, end: e });
            },
            renderEditContent: (event) => {
                const row = calendarRowById(String(event?.id ?? ''));
                const notesFull = row ? String(row.notes ?? '') : String(event?.description ?? '');
                return calendarEventFormHtml('edit', event, notesFull);
            },
            onAfterAdd: async (ev) => {
                await persistCalendarEvent(ev);
                await refreshCalendarPanel(calendarRoot instanceof HTMLElement ? calendarRoot : null);
            },
            onAfterEdit: async (ev) => {
                await persistCalendarEvent(ev);
                await refreshCalendarPanel(calendarRoot instanceof HTMLElement ? calendarRoot : null);
            },
            onAfterDelete: async (ev) => {
                if (ev?.id) await deleteCalendarEvent(String(ev.id));
                await refreshCalendarPanel(calendarRoot instanceof HTMLElement ? calendarRoot : null);
            },
        },
    });
    const JIT = globalThis.JIT;
    if (JIT?.hydrate) JIT.hydrate(mountEl);
}

/**
 * @param {HTMLElement|null} root
 */
async function refreshCalendarPanel(root) {
    if (!(root instanceof HTMLElement)) return;
    const listHost = root.querySelector('[data-oaao-calendar="list-view"]');
    const monthHost = root.querySelector('[data-oaao-calendar="month-view"]');
    await fetchCalendarEvents(calendarVisibleAnchorDate());
    renderCalendarSidebarSchedule(null);
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
    const titleEl = root.querySelector('[data-i18n="calendar.title"]');
    if (titleEl instanceof HTMLElement) {
        titleEl.textContent = oaaoT('calendar.title', 'Calendar');
    }
    viewBtns.forEach((btn) => {
        const v = btn.getAttribute('data-oaao-calendar-view');
        if (v === 'list' && btn instanceof HTMLElement) {
            btn.textContent = oaaoT('calendar.view.list', 'List');
        }
        if (v === 'month' && btn instanceof HTMLElement) {
            btn.textContent = oaaoT('calendar.view.month', 'Month');
        }
    });
    if (newBtn instanceof HTMLElement) {
        newBtn.textContent = oaaoT('calendar.new_event', 'New event');
    }

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
            await persistCalendarEvent({
                title: oaaoT('calendar.new_event', 'New event'),
                start,
                end,
            });
            await refreshCalendarPanel(root);
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
    const sidebarSection = document.getElementById('workspace-calendar-sidebar-section');
    if (JIT?.hydrate && sidebarSection) JIT.hydrate(sidebarSection);
}

/** Workspace shell entry (see {@code workspace.js} dynamic panel loader). */
export async function mountShellPanel(mount) {
    await mountCalendarPanel(mount);
}

export function teardownShellPanel() {
    if (monthCalendar && typeof monthCalendar.destroy === 'function') {
        monthCalendar.destroy();
    }
    monthCalendar = null;
    cachedEvents = [];
}

export default mountShellPanel;
