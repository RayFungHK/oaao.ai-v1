/**
 * CS-5 — Planner step: condense fields before calendar_events_save.
 *
 * @module calendar-planner-api
 */

import { summarizeCalendarNotes, CALENDAR_NOTES_STORAGE_MAX } from './calendar-notes.js';

/**
 * @param {string} path
 */
function calendarApiUrl(path) {
    const prefix =
        (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    const base = `${prefix}/calendar/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

/**
 * @param {Record<string, unknown>} fields
 */
export async function planCalendarEventFields(fields) {
    const draft = {
        title: String(fields.title ?? '').trim(),
        notes: String(fields.notes ?? '').trim(),
        start_at: String(fields.start_at ?? ''),
        end_at: String(fields.end_at ?? ''),
        location: String(fields.location ?? '').trim(),
        locale: String(fields.locale ?? '').trim(),
    };

    try {
        const res = await fetch(calendarApiUrl('calendar_events_plan'), {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(draft),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success && data?.data && typeof data.data === 'object') {
            return {
                title: String(data.data.title ?? draft.title),
                notes: String(data.data.notes ?? draft.notes),
                location: String(data.data.location ?? draft.location),
                planner_source: String(data.data.source ?? ''),
            };
        }
    } catch (err) {
        console.warn('[calendar-planner] plan failed, using local summarize', err);
    }

    return {
        title: draft.title || 'Scheduled event',
        notes: summarizeCalendarNotes(draft.notes, CALENDAR_NOTES_STORAGE_MAX),
        location: draft.location,
        planner_source: 'client',
    };
}
