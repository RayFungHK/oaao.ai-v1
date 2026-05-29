/**
 * Plain-text summary for calendar event notes (popup, sidebar, storage caps).
 *
 * @module calendar-notes
 */

/** @type {number} */
export const CALENDAR_NOTES_POPUP_MAX = 220;

/** @type {number} */
export const CALENDAR_NOTES_STORAGE_MAX = 480;

/**
 * @param {string} raw
 * @param {number} [maxLen]
 */
export function summarizeCalendarNotes(raw, maxLen = CALENDAR_NOTES_POPUP_MAX) {
    let s = String(raw ?? '').trim();
    if (!s) return '';

    s = s.replace(/^#{1,6}\s+/gm, '');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/\*([^*]+)\*/g, '$1');
    s = s.replace(/^---+$/gm, '');
    s = s.replace(/`([^`]+)`/g, '$1');

    const paras = s
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
    const seen = new Set();
    const uniq = [];
    for (const p of paras) {
        const key = p.slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(p);
    }
    s = uniq.join(' ').replace(/\s+/g, ' ').trim();

    const cap = Math.max(40, Math.floor(maxLen));
    if (s.length <= cap) return s;
    return `${s.slice(0, cap)}…`;
}
