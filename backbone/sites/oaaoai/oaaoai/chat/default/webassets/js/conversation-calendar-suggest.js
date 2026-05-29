/**
 * CS-5-S5/S6 — Calendar event suggestion chip on assistant message + save dialog.
 *
 * @module conversation-calendar-suggest
 */

/** @type {Set<string>} */
const calendarSuggestionDismissed = new Set();

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
export function dismissCalendarSuggestion(conversationId, messageId) {
    calendarSuggestionDismissed.add(dismissKey(conversationId, messageId));
}

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

/**
 * @param {string} path
 */
export function calendarApiUrl(path) {
    const base = `${mountPrefix()}/calendar/api`.replace(/\/{2,}/g, '/');
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
 * @param {string} iso
 */
function toDatetimeLocalValue(iso) {
    const raw = String(iso ?? '').trim();
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {number} messageId
 * @param {Record<string, unknown>} payload
 * @param {() => Record<string, unknown>} workspaceBodyFields
 */
async function openAddToCalendarDialog(mount, conversationId, messageId, payload, workspaceBodyFields) {
    const Dialog = await loadDialogCtor();
    const body = document.createElement('div');
    body.className = 'flex flex-col gap-3 min-w-0';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className =
        'w-full rounded-[8px] border border-solid border-[var(--grid-line)] px-3 py-2 text-[0.875rem] font-inherit';
    titleInput.value = String(payload.title || '');

    const startInput = document.createElement('input');
    startInput.type = 'datetime-local';
    startInput.className = titleInput.className;
    startInput.value = toDatetimeLocalValue(String(payload.start_at || ''));

    const endInput = document.createElement('input');
    endInput.type = 'datetime-local';
    endInput.className = titleInput.className;
    endInput.value = toDatetimeLocalValue(String(payload.end_at || ''));

    const locationInput = document.createElement('input');
    locationInput.type = 'text';
    locationInput.className = titleInput.className;
    locationInput.placeholder = 'Location (optional)';
    locationInput.value = String(payload.location || '');

    const notesInput = document.createElement('textarea');
    notesInput.rows = 3;
    notesInput.className =
        'w-full rounded-[8px] border border-solid border-[var(--grid-line)] px-3 py-2 text-[0.8125rem] font-inherit resize-y';
    notesInput.value = String(payload.notes || '');

    const mkLabel = (text) => {
        const l = document.createElement('label');
        l.className = 'text-[0.75rem] fw-medium fg-[var(--grid-caption)]';
        l.textContent = text;
        return l;
    };

    body.append(
        mkLabel('Title'),
        titleInput,
        mkLabel('Start'),
        startInput,
        mkLabel('End'),
        endInput,
        mkLabel('Location'),
        locationInput,
        mkLabel('Notes'),
        notesInput,
    );

    void new Dialog({
        title: 'Add to calendar',
        content: body,
        size: 'md',
        closable: true,
        buttons: [
            { text: 'Cancel', color: 'muted', role: 'cancel' },
            {
                text: 'Save event',
                color: 'accent',
                close: false,
                action: async (ctrl) => {
                    const startVal = startInput.value.trim();
                    const endVal = endInput.value.trim();
                    const startAt = startVal ? new Date(startVal).toISOString() : String(payload.start_at || '');
                    const endAt = endVal ? new Date(endVal).toISOString() : String(payload.end_at || '');
                    const res = await fetch(calendarApiUrl('calendar_events_save'), {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({
                            title: titleInput.value.trim(),
                            start_at: startAt,
                            end_at: endAt,
                            all_day: Boolean(payload.all_day),
                            timezone: String(payload.timezone || 'UTC'),
                            location: locationInput.value.trim(),
                            notes: notesInput.value.trim(),
                            conversation_id: conversationId,
                            message_id: messageId,
                            ...workspaceBodyFields(),
                        }),
                    });
                    const data = await res.json().catch(() => null);
                    if (!res.ok || !data?.success) return false;
                    dismissCalendarSuggestion(conversationId, messageId);
                    const chip = mount.querySelector(
                        `[data-oaao-calendar-suggest="${dismissKey(conversationId, messageId)}"]`,
                    );
                    const chipOuter = chip?.closest('.oaao-chat-assistant-row');
                    chip?.remove();
                    if (chipOuter instanceof HTMLElement) {
                        const calLink = document.createElement('button');
                        calLink.type = 'button';
                        calLink.className =
                            'text-[0.75rem] border-0 bg-transparent p-0 fg-[var(--grid-accent)] underline cursor-pointer font-inherit';
                        calLink.textContent = 'View in Calendar';
                        calLink.addEventListener('click', () => {
                            document.dispatchEvent(new CustomEvent('oaao:navigate-calendar'));
                        });
                        chipOuter.append(calLink);
                    }
                    ctrl.close();
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
export function renderCalendarSuggestChip(mount, conversationId, messageId, payload, workspaceBodyFields) {
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    if (cid < 1 || mid < 1) return;
    const key = dismissKey(cid, mid);
    if (calendarSuggestionDismissed.has(key)) return;

    const msgsHost = mount.querySelector('[data-oaao-chat="messages"]');
    if (!(msgsHost instanceof HTMLElement)) return;
    const bubble = msgsHost.querySelector(`[data-oaao-msg-id="${mid}"]`);
    if (!(bubble instanceof HTMLElement)) return;
    const outer = bubble.closest('.oaao-chat-assistant-row');
    if (!(outer instanceof HTMLElement)) return;
    if (outer.querySelector(`[data-oaao-calendar-suggest="${key}"]`)) return;

    const chip = document.createElement('div');
    chip.dataset.oaaoCalendarSuggest = key;
    chip.className =
        'flex flex-wrap items-center gap-2 w-full min-w-0 rounded-xl border border-solid border-sky-4/40 bg-sky-1/25 px-3 py-2';

    const label = document.createElement('span');
    label.className = 'flex-1 min-w-0 text-[0.8125rem] fg-[var(--grid-ink)] truncate';
    label.textContent = String(payload.title || 'Add to calendar?');

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
    addBtn.textContent = 'Add to calendar';

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] border-none bg-transparent fg-[var(--grid-caption)] cursor-pointer font-inherit underline';
    dismissBtn.textContent = 'Dismiss';

    addBtn.addEventListener('click', () => {
        void openAddToCalendarDialog(mount, cid, mid, payload, workspaceBodyFields);
    });
    dismissBtn.addEventListener('click', () => {
        dismissCalendarSuggestion(cid, mid);
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
export function handleCalendarEventSuggestedStream(
    mount,
    conversationId,
    messageId,
    payload,
    workspaceBodyFields,
) {
    renderCalendarSuggestChip(mount, conversationId, messageId, payload, workspaceBodyFields);
}

export default {
    handleCalendarEventSuggestedStream,
    renderCalendarSuggestChip,
    dismissCalendarSuggestion,
    calendarApiUrl,
};
