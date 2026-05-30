/**
 * Unified [info] worker client — one poll for turn scores + productivity status + strip items.
 *
 * @see docs/design/chat-ui-areas.md § [info]
 * @module chat-info-worker
 */

import { mountRuiIconSync } from './oaao-rui-icons.js?v=20260530-strip-hash-upgrade-v187';
import { mountStripFromEnvelope } from './strip-chip-shell.js';
import { reorderAssistantRowAreas } from './productivity-strip-host.js';

const INFO_WORKER_STYLE_ID = 'oaao-chat-info-worker-styles';
const INFO_WORKER_STYLE_REV = '20260530-strip-hash-upgrade-v187';

const INFO_WORKER_POLL_INTERVAL_MS = 5000;
const INFO_WORKER_POLL_MAX_ATTEMPTS = 48;
const INFO_WORKER_DOM_WAIT_MS = 300;
const INFO_WORKER_DOM_WAIT_MAX = 20;

/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const pollTimerByConversation = new Map();

/** @type {Map<number, boolean>} */
const pollInFlightByConversation = new Map();

/** @type {Map<number, number>} */
const pollGenerationByConversation = new Map();

/** @type {Map<number, Set<number>>} */
const pendingInfoMessageIdsByConversation = new Map();

/**
 * @param {number} conversationId
 * @param {number} messageId
 */
export function registerPendingInfoMessage(conversationId, messageId) {
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    if (cid < 1 || mid < 1) return;
    let set = pendingInfoMessageIdsByConversation.get(cid);
    if (!(set instanceof Set)) {
        set = new Set();
        pendingInfoMessageIdsByConversation.set(cid, set);
    }
    set.add(mid);
}

/**
 * @param {number} conversationId
 * @param {number} messageId
 */
export function unregisterPendingInfoMessage(conversationId, messageId) {
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    if (cid < 1 || mid < 1) return;
    const set = pendingInfoMessageIdsByConversation.get(cid);
    if (!(set instanceof Set)) return;
    set.delete(mid);
    if (set.size < 1) {
        pendingInfoMessageIdsByConversation.delete(cid);
    }
}

/**
 * @param {number} conversationId
 * @returns {number[]}
 */
export function getPendingInfoMessageIds(conversationId) {
    const cid = Math.floor(Number(conversationId));
    const set = pendingInfoMessageIdsByConversation.get(cid);
    if (!(set instanceof Set) || set.size < 1) return [];
    return [...set].sort((a, b) => a - b);
}

/**
 * @param {number} conversationId
 */
export function clearPendingInfoMessages(conversationId) {
    pendingInfoMessageIdsByConversation.delete(Math.floor(Number(conversationId)));
}

/** @type {Map<string, { pendingCalendar: boolean, pendingTodo: boolean }>} */
const localPendingByMessage = new Map();

/**
 * @param {unknown} worker
 * @returns {boolean}
 */
function workerOnlyLast(worker) {
    if (!worker || typeof worker !== 'object') return true;
    const row = /** @type {Record<string, unknown>} */ (worker);
    if (!Object.prototype.hasOwnProperty.call(row, 'only_last')) return true;
    return Boolean(row.only_last);
}

/**
 * @param {unknown[]} workers
 * @returns {boolean}
 */
function productivityRegistryUsesOnlyLast(workers) {
    if (!Array.isArray(workers)) return true;
    for (const worker of workers) {
        const pill = String(/** @type {Record<string, unknown>} */ (worker)?.pill_kind ?? '').toLowerCase();
        if (pill !== 'calendar' && pill !== 'todo') continue;
        if (workerOnlyLast(worker)) return true;
    }
    return false;
}

/**
 * @param {number} messageId
 * @param {number | null | undefined} latestAssistantMessageId
 * @returns {boolean}
 */
export function productivityAppliesToMessage(messageId, latestAssistantMessageId) {
    const mid = Math.floor(Number(messageId));
    const latest = Math.floor(Number(latestAssistantMessageId));
    if (mid < 1) return false;
    if (latest < 1) return true;
    return mid === latest;
}

/**
 * Drop Cal/Todo pills, local pending, and strip on assistant rows that are no longer latest.
 *
 * @param {HTMLElement | Document} mount
 * @param {number} conversationId
 * @param {number} latestAssistantMessageId
 * @param {(mount: HTMLElement | Document, messageId: number) => HTMLElement | null} getAssistantRow
 */
export function pruneStaleOnlyLastProductivity(
    mount,
    conversationId,
    latestAssistantMessageId,
    getAssistantRow,
) {
    const cid = Math.floor(Number(conversationId));
    const latest = Math.floor(Number(latestAssistantMessageId));
    if (cid < 1 || latest < 1) return;

    const root =
        mount instanceof HTMLElement && mount.matches('[data-module="oaao-chat"]')
            ? mount
            : mount instanceof HTMLElement
              ? mount.querySelector('[data-module="oaao-chat"]')
              : document.querySelector('[data-module="oaao-chat"]');
    if (!(root instanceof HTMLElement)) return;

    root.querySelectorAll('.oaao-chat-assistant-row').forEach((row) => {
        if (!(row instanceof HTMLElement)) return;
        const bubble = row.querySelector('[data-oaao-msg-role="assistant"][data-oaao-msg-id]');
        const mid = Math.floor(Number(bubble?.getAttribute('data-oaao-msg-id') ?? 0));
        if (mid < 1 || mid === latest) return;

        localPendingByMessage.delete(`${cid}:${mid}`);
        unregisterPendingInfoMessage(cid, mid);

        const wrap = row.querySelector('[data-oaao-chat="turn-score"]');
        if (wrap instanceof HTMLElement) {
            renderProductivityInfoPill(wrap, 'calendar', { status: 'idle' });
            renderProductivityInfoPill(wrap, 'todo', { status: 'idle' });
        }

        row.querySelectorAll('[data-oaao-strip-chip]').forEach((chip) => chip.remove());
        const strip = row.querySelector('[data-oaao-chat-area="strip"]');
        if (strip instanceof HTMLElement && !strip.querySelector('[data-oaao-strip-chip]')) {
            strip.remove();
        }
        reorderAssistantRowAreas(row);
    });
}

function ensureInfoWorkerStyles() {
    if (typeof document === 'undefined') return;
    const prev = document.getElementById(INFO_WORKER_STYLE_ID);
    if (prev?.dataset.oaaoRev === INFO_WORKER_STYLE_REV) return;
    prev?.remove();
    const style = document.createElement('style');
    style.id = INFO_WORKER_STYLE_ID;
    style.dataset.oaaoRev = INFO_WORKER_STYLE_REV;
    style.textContent = `
.oaao-chat-info-pill.oaao-chat-turn-score-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.oaao-chat-info-pill--pending {
  color: color-mix(in srgb, var(--grid-caption,#888) 92%, var(--grid-ink,#111));
  background: color-mix(in srgb, var(--grid-caption,#888) 8%, transparent);
  border-color: color-mix(in srgb, var(--grid-caption,#888) 24%, transparent);
}
.oaao-chat-info-pill--pending .oaao-chat-info-pill__icon {
  animation: oaao-info-pill-icon-blink 1s ease-in-out infinite;
}
@keyframes oaao-info-pill-icon-blink {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.92); }
}
.oaao-chat-info-pill--ready {
  color: color-mix(in srgb, #16a34a 92%, var(--grid-ink,#111));
  background: color-mix(in srgb, #16a34a 10%, transparent);
  border-color: color-mix(in srgb, #16a34a 30%, transparent);
  cursor: pointer;
}
.oaao-chat-info-pill--error {
  color: color-mix(in srgb, #dc2626 92%, var(--grid-ink,#111));
  background: color-mix(in srgb, #dc2626 10%, transparent);
  border-color: color-mix(in srgb, #dc2626 30%, transparent);
}
.oaao-chat-info-pill__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.oaao-chat-info-pill__icon-svg {
  display: inline-flex;
  width: 12px;
  height: 12px;
}
.oaao-chat-info-pill__icon-svg svg {
  width: 12px;
  height: 12px;
  display: block;
}
`;
    document.head.append(style);
}

/**
 * Show blinking Cal / Todo pills on [info] row immediately after stream end.
 *
 * @param {HTMLElement} outer
 * @param {number} conversationId
 * @param {number} messageId
 * @param {(outer: HTMLElement, row: Record<string, unknown>) => void} [applyTurnScore]
 */
export function applyInfoWorkerPendingPills(
    outer,
    conversationId,
    messageId,
    applyTurnScore = null,
    latestAssistantMessageId = null,
) {
    if (!(outer instanceof HTMLElement)) return;
    const mid = Math.floor(Number(messageId));
    if (
        latestAssistantMessageId != null &&
        !productivityAppliesToMessage(mid, latestAssistantMessageId)
    ) {
        return;
    }
    registerPendingInfoMessage(conversationId, messageId);
    let wrap = outer.querySelector('[data-oaao-chat="turn-score"]');
    if (!(wrap instanceof HTMLElement)) {
        wrap = document.createElement('div');
        wrap.dataset.oaaoChat = 'turn-score';
        wrap.dataset.oaaoChatArea = 'info';
        wrap.className = 'oaao-chat-area oaao-chat-area--info oaao-chat-turn-score-pills';
        wrap.setAttribute('aria-label', 'Turn information');
    } else if (!wrap.dataset.oaaoChatArea) {
        wrap.dataset.oaaoChatArea = 'info';
    }
    if (!wrap.isConnected) {
        outer.append(wrap);
    }
    reorderAssistantRowAreas(outer);
    if (typeof applyTurnScore === 'function' && !wrap.querySelector('[data-oaao-turn-score-pill="iqs"]')) {
        applyTurnScore(outer, {
            assistant_message_id: Math.floor(Number(messageId)),
            iqs: 0,
            accs: 0,
        });
    }
    seedInfoWorkerPending(conversationId, messageId, { calendar: true, todo: true });
    renderProductivityInfoPill(wrap, 'calendar', { status: 'pending' });
    renderProductivityInfoPill(wrap, 'todo', { status: 'pending' });
}

/** @type {Record<'calendar' | 'todo', { lucide: string, title: string }>} */
const INFO_PILL_META = {
    calendar: { lucide: 'calendar', title: 'Calendar' },
    todo: { lucide: 'list-todo', title: 'Todos' },
};

/**
 * @param {number} conversationId
 * @param {number} messageId
 * @returns {boolean}
 */
export function hasLocalProductivityPending(conversationId, messageId) {
    const key = `${Math.floor(Number(conversationId))}:${Math.floor(Number(messageId))}`;
    const local = localPendingByMessage.get(key);
    return Boolean(local?.pendingCalendar || local?.pendingTodo);
}

/**
 * @param {HTMLElement} pill
 * @param {'calendar' | 'todo'} kind
 */
function mountInfoPillIcon(pill, kind) {
    const meta = INFO_PILL_META[kind];
    let iconWrap = pill.querySelector('.oaao-chat-info-pill__icon');
    if (!(iconWrap instanceof HTMLElement)) {
        iconWrap = document.createElement('span');
        iconWrap.className = 'oaao-chat-info-pill__icon';
        iconWrap.setAttribute('aria-hidden', 'true');
        pill.prepend(iconWrap);
    }
    mountRuiIconSync(iconWrap, meta.lucide, { size: 12, strokeWidth: 2, class: 'oaao-chat-info-pill__icon-svg' });
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} conversationId
 */
export function resyncPendingInfoMessagesFromDom(mount, conversationId) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return;
    const root =
        mount instanceof HTMLElement && mount.matches('[data-module="oaao-chat"]')
            ? mount
            : mount instanceof HTMLElement
              ? mount.querySelector('[data-module="oaao-chat"]')
              : document.querySelector('[data-module="oaao-chat"]');
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll('.oaao-chat-assistant-row').forEach((row) => {
        if (!(row instanceof HTMLElement)) return;
        const bubble = row.querySelector('[data-oaao-msg-role="assistant"][data-oaao-msg-id]');
        const mid = Math.floor(Number(bubble?.getAttribute('data-oaao-msg-id') ?? 0));
        if (mid < 1) return;
        if (row.querySelector('.oaao-chat-info-pill--pending')) {
            registerPendingInfoMessage(cid, mid);
        }
    });
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} messageId
 * @returns {boolean}
 */
function domHasPendingProductivityPill(mount, messageId) {
    const mid = Math.floor(Number(messageId));
    if (mid < 1) return false;
    const root =
        mount instanceof HTMLElement && mount.matches('[data-module="oaao-chat"]')
            ? mount
            : mount instanceof HTMLElement
              ? mount.querySelector('[data-module="oaao-chat"]')
              : document.querySelector('[data-module="oaao-chat"]');
    if (!(root instanceof HTMLElement)) return false;
    const row = root.querySelector(`[data-oaao-msg-id="${mid}"]`)?.closest('.oaao-chat-assistant-row');
    return Boolean(row?.querySelector('.oaao-chat-info-pill--pending'));
}

/**
 * Message ids that still need Cal/Todo info_worker polling.
 *
 * @param {HTMLElement | Document} mount
 * @param {number} conversationId
 * @returns {number[]}
 */
export function getProductivityPendingMessageIds(mount, conversationId, latestAssistantMessageId = null) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return [];
    resyncPendingInfoMessagesFromDom(mount, cid);
    const latest =
        latestAssistantMessageId != null && Number(latestAssistantMessageId) > 0
            ? Math.floor(Number(latestAssistantMessageId))
            : null;
    return getPendingInfoMessageIds(cid).filter((mid) => {
        if (latest != null && latest > 0 && mid !== latest) return false;
        return hasLocalProductivityPending(cid, mid) || domHasPendingProductivityPill(mount, mid);
    });
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} conversationId
 * @returns {boolean}
 */
export function conversationProductivityWorkPending(mount, conversationId, latestAssistantMessageId = null) {
    return (
        getProductivityPendingMessageIds(mount, conversationId, latestAssistantMessageId).length > 0
    );
}

/**
 * @deprecated Use {@link conversationProductivityWorkPending} for poll scheduling.
 * @param {HTMLElement | Document} mount
 * @param {number} conversationId
 * @returns {boolean}
 */
export function conversationInfoWorkPending(mount, conversationId) {
    return conversationProductivityWorkPending(mount, conversationId);
}

/**
 * @param {HTMLElement} wrap
 * @param {'calendar' | 'todo'} kind
 * @param {{ status?: string, count?: number }} state
 */
export function renderProductivityInfoPill(wrap, kind, state = {}) {
    ensureInfoWorkerStyles();
    const status = String(state.status ?? 'idle').toLowerCase();
    if (status === 'idle') {
        wrap.querySelector(`[data-oaao-info-pill="${kind}"]`)?.remove();
        return;
    }
    const meta = INFO_PILL_META[kind];
    let pill = wrap.querySelector(`[data-oaao-info-pill="${kind}"]`);
    if (!(pill instanceof HTMLElement)) {
        pill = document.createElement('span');
        pill.dataset.oaaoInfoPill = kind;
        pill.className = `oaao-chat-turn-score-pill oaao-chat-info-pill oaao-chat-info-pill--${kind}`;
        pill.setAttribute('role', 'status');
        wrap.append(pill);
    }
    mountInfoPillIcon(pill, kind);
    pill.classList.remove(
        'oaao-chat-info-pill--pending',
        'oaao-chat-info-pill--ready',
        'oaao-chat-info-pill--error',
        'oaao-chat-turn-score-pill--pending',
    );
    pill.onclick = null;
    const count = Math.max(0, Math.floor(Number(state.count) || 0));

    if (status === 'pending') {
        pill.classList.add('oaao-chat-info-pill--pending', 'oaao-chat-turn-score-pill--pending');
        pill.title = `${meta.title} — processing`;
        pill.setAttribute('aria-label', `${meta.title} processing`);
        pill.tabIndex = -1;
        return;
    }

    if (status === 'error') {
        pill.classList.add('oaao-chat-info-pill--error');
        pill.title = `${meta.title} — worker failed`;
        pill.setAttribute('aria-label', `${meta.title} failed`);
        pill.tabIndex = -1;
        return;
    }

    pill.classList.add('oaao-chat-info-pill--ready');
    pill.title =
        count > 0
            ? `${meta.title} — ${count} suggestion${count > 1 ? 's' : ''} in strip`
            : `${meta.title} — see strip below`;
    pill.setAttribute('aria-label', pill.title);
    pill.tabIndex = 0;
    pill.onclick = () => {
        const row = pill.closest('.oaao-chat-assistant-row');
        const strip = row?.querySelector('[data-oaao-chat-area="strip"]');
        strip?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
}

/**
 * Seed local pending flags at stream end (planner queued post-turn work).
 *
 * @param {number} conversationId
 * @param {number} messageId
 * @param {{ calendar?: boolean, todo?: boolean }} flags
 */
export function seedInfoWorkerPending(conversationId, messageId, flags = {}) {
    const key = `${Math.floor(Number(conversationId))}:${Math.floor(Number(messageId))}`;
    localPendingByMessage.set(key, {
        pendingCalendar: Boolean(flags.calendar ?? true),
        pendingTodo: Boolean(flags.todo ?? true),
    });
}

/**
 * @param {unknown} productivity
 * @returns {Record<string, { status?: string, count?: number }>}
 */
function normalizeProductivityFromApi(productivity) {
    if (!productivity || typeof productivity !== 'object' || Array.isArray(productivity)) {
        return {};
    }
    return /** @type {Record<string, { status?: string, count?: number }>} */ ({ ...productivity });
}

/**
 * @param {Record<string, { status?: string, count?: number }>} out
 * @param {unknown[]} stripItems
 */
function bumpProductivityFromStripItems(out, stripItems) {
    let cal = 0;
    let todo = 0;
    for (const raw of stripItems) {
        if (!raw || typeof raw !== 'object') continue;
        const item = /** @type {Record<string, unknown>} */ (raw);
        const agent = String(item.agent ?? '').toLowerCase();
        const action = String(item.action_id ?? '').toLowerCase();
        if (agent === 'calendar_schedule' || action.includes('calendar')) {
            cal += 1;
        }
        if (agent === 'todo_extract' || action.includes('todo')) {
            todo += 1;
        }
    }
    if (cal > 0) {
        out.calendar = { status: 'ready', count: cal };
    }
    if (todo > 0) {
        out.todo = { status: 'ready', count: todo };
    }
    return out;
}

/**
 * @param {Record<string, { status?: string, count?: number }>} productivity
 * @param {number} conversationId
 * @param {number} messageId
 */
function mergeProductivityWithLocalPending(
    productivity,
    conversationId,
    messageId,
    latestAssistantMessageId = null,
) {
    const key = `${Math.floor(Number(conversationId))}:${Math.floor(Number(messageId))}`;
    const mid = Math.floor(Number(messageId));
    if (
        latestAssistantMessageId != null &&
        !productivityAppliesToMessage(mid, latestAssistantMessageId)
    ) {
        localPendingByMessage.delete(key);
        return normalizeProductivityFromApi(productivity);
    }
    const local = localPendingByMessage.get(key);
    /** @type {Record<string, { status?: string, count?: number }>} */
    const out = normalizeProductivityFromApi(productivity);
    if (local?.pendingCalendar && out.calendar?.status !== 'ready' && out.calendar?.status !== 'idle') {
        out.calendar = { ...(out.calendar ?? {}), status: 'pending', count: 0 };
    }
    if (local?.pendingTodo && out.todo?.status !== 'ready' && out.todo?.status !== 'idle') {
        out.todo = { ...(out.todo ?? {}), status: 'pending', count: 0 };
    }
    if (
        out.calendar?.status === 'ready' ||
        out.calendar?.status === 'idle' ||
        out.calendar?.status === 'error'
    ) {
        if (local) local.pendingCalendar = false;
    }
    if (out.todo?.status === 'ready' || out.todo?.status === 'idle' || out.todo?.status === 'error') {
        if (local) local.pendingTodo = false;
    }
    if (local && !local.pendingCalendar && !local.pendingTodo) {
        localPendingByMessage.delete(key);
    }
    return out;
}

/**
 * @param {HTMLElement} outer
 * @param {Record<string, unknown>} messageBundle
 * @param {number} conversationId
 * @param {number} messageId
 * @param {Record<string, unknown>} [stripCtx]
 * @param {(outer: HTMLElement, turnScore: Record<string, unknown>) => void} applyTurnScore
 * @param {(conversationId: number, messageId: number, apiRow: Record<string, unknown>) => Record<string, unknown>} [resolveTurnScoreRow]
 */
export function applyInfoWorkerMessageBundle(
    outer,
    messageBundle,
    conversationId,
    messageId,
    stripCtx,
    applyTurnScore,
    resolveTurnScoreRow = null,
    latestAssistantMessageId = null,
) {
    if (!(outer instanceof HTMLElement) || !messageBundle || typeof messageBundle !== 'object') return;

    const mid = Math.floor(Number(messageId));
    const applies = productivityAppliesToMessage(mid, latestAssistantMessageId);

    const apiRow = messageBundle.turn_score;
    if (apiRow && typeof apiRow === 'object') {
        const row =
            typeof resolveTurnScoreRow === 'function'
                ? resolveTurnScoreRow(
                      conversationId,
                      messageId,
                      /** @type {Record<string, unknown>} */ (apiRow),
                  )
                : /** @type {Record<string, unknown>} */ (apiRow);
        applyTurnScore(outer, row);
    } else if (typeof applyTurnScore === 'function' && !outer.querySelector('[data-oaao-turn-score-pill="iqs"]')) {
        applyTurnScore(outer, {
            assistant_message_id: Math.floor(Number(messageId)),
            iqs: 0,
            accs: 0,
        });
    }

    let wrap = outer.querySelector('[data-oaao-chat="turn-score"]');
    if (!(wrap instanceof HTMLElement)) return;

    let productivity = mergeProductivityWithLocalPending(
        messageBundle.productivity,
        conversationId,
        messageId,
        latestAssistantMessageId,
    );
    let items = messageBundle.strip_items;
    if (!applies) {
        productivity = {};
        items = [];
        unregisterPendingInfoMessage(Math.floor(Number(conversationId)), mid);
    }
    if (Array.isArray(items) && items.length > 0) {
        productivity = bumpProductivityFromStripItems(productivity, items);
    }
    renderProductivityInfoPill(wrap, 'calendar', productivity.calendar ?? { status: 'idle' });
    renderProductivityInfoPill(wrap, 'todo', productivity.todo ?? { status: 'idle' });

    if (applies && Array.isArray(items) && items.length > 0) {
        mountStripFromEnvelope(outer, { items }, conversationId, messageId, stripCtx ?? {});
    }
    reorderAssistantRowAreas(outer);
}

/**
 * @param {string} chatApiUrlFn
 * @param {number} conversationId
 * @param {number[]} messageIds
 * @param {() => Record<string, string>} getScopeQuery
 */
export async function fetchInfoWorker(chatApiUrlFn, conversationId, messageIds, getScopeQuery) {
    const cid = Math.floor(Number(conversationId));
    const ids = [...new Set(messageIds.map((id) => Math.floor(Number(id))).filter((id) => id > 0))].sort(
        (a, b) => a - b,
    );
    if (cid < 1 || ids.length < 1) {
        throw new Error('no_pending_info_messages');
    }
    const params = {
        conversation_id: String(cid),
        message_ids: ids.join(','),
        ...getScopeQuery(),
    };
    const res = await fetch(chatApiUrlFn('info_worker', params), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success || !data?.data) {
        throw new Error(typeof data?.message === 'string' ? data.message : 'info_worker_failed');
    }
    return /** @type {Record<string, unknown>} */ (data.data);
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} messageId
 */
export function infoWorkerTurnScoresReadyForMessage(mount, messageId) {
    const mid = Math.floor(Number(messageId));
    if (mid < 1) return true;
    const root =
        mount instanceof HTMLElement && mount.matches('[data-module="oaao-chat"]')
            ? mount
            : mount instanceof HTMLElement
              ? mount.querySelector('[data-module="oaao-chat"]')
              : document.querySelector('[data-module="oaao-chat"]');
    if (!(root instanceof HTMLElement)) return false;
    const row = root.querySelector(`[data-oaao-msg-id="${mid}"]`)?.closest('.oaao-chat-assistant-row');
    if (!(row instanceof HTMLElement)) return false;
    if (!row.querySelector('[data-oaao-turn-score-pill="iqs"]')) return false;
    const pending = row.querySelector(
        '[data-oaao-turn-score-pill="iqs"].oaao-chat-turn-score-pill--pending, [data-oaao-turn-score-pill="accs"].oaao-chat-turn-score-pill--pending',
    );
    return !pending;
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} messageId
 */
export function infoWorkerProductivityReadyForMessage(mount, messageId) {
    const mid = Math.floor(Number(messageId));
    if (mid < 1) return true;
    const root =
        mount instanceof HTMLElement && mount.matches('[data-module="oaao-chat"]')
            ? mount
            : mount instanceof HTMLElement
              ? mount.querySelector('[data-module="oaao-chat"]')
              : document.querySelector('[data-module="oaao-chat"]');
    if (!(root instanceof HTMLElement)) return false;
    const row = root.querySelector(`[data-oaao-msg-id="${mid}"]`)?.closest('.oaao-chat-assistant-row');
    if (!(row instanceof HTMLElement)) return false;
    return !row.querySelector('.oaao-chat-info-pill--pending');
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} messageId
 */
export function infoWorkerDomReadyForMessage(mount, messageId) {
    return (
        infoWorkerTurnScoresReadyForMessage(mount, messageId) &&
        infoWorkerProductivityReadyForMessage(mount, messageId)
    );
}

/**
 * @param {number} conversationId
 */
export function infoWorkerPollIsActive(conversationId) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return false;
    return pollTimerByConversation.has(cid) || pollInFlightByConversation.get(cid) === true;
}

/**
 * @param {number} conversationId
 */
export function cancelInfoWorkerPoll(conversationId) {
    const cid = Number(conversationId);
    pollGenerationByConversation.set(cid, (pollGenerationByConversation.get(cid) ?? 0) + 1);
    const t = pollTimerByConversation.get(cid);
    if (t) {
        clearTimeout(t);
        pollTimerByConversation.delete(cid);
    }
}

/**
 * @param {number} conversationId
 * @param {HTMLElement | Document} mount
 * @param {{
 *   watchMessageId?: number | null,
 *   chatApiUrl: (action: string, params?: Record<string, string>) => string,
 *   getScopeQuery: () => Record<string, string>,
 *   getAssistantRow: (mount: HTMLElement | Document, messageId: number) => HTMLElement | null,
 *   applyTurnScore: (outer: HTMLElement, row: Record<string, unknown>) => void,
 *   buildStripCtx: (mount: HTMLElement, conversationId: number) => Record<string, unknown>,
 *   mergeTurnScoreIntoCache?: (cid: number, mid: number, row: Record<string, unknown>) => void,
 *   resolveTurnScoreRow?: (cid: number, mid: number, apiRow: Record<string, unknown>) => Record<string, unknown>,
 *   ensureWatchRowReady?: (messageId: number) => boolean,
 *   getPendingMessageIds?: (conversationId: number) => number[],
 *   getLatestAssistantMessageId?: (conversationId: number) => number | null,
 *   onRescorePending?: (cid: number) => void,
 *   onPendingIdle?: (conversationId: number) => void,
 *   activeConversationId: () => number | null,
 *   triggerRescore?: boolean,
 * }} opts
 */
/**
 * Poll [info] for Cal/Todo only — never chains {@code turn_scores_rescore} (background orchestrator workers).
 *
 * @param {number} conversationId
 * @param {HTMLElement | Document} mount
 * @param {Parameters<typeof scheduleInfoWorkerPoll>[2]} [opts]
 */
export function scheduleProductivityInfoWorkerPoll(conversationId, mount, opts = {}) {
    scheduleInfoWorkerPoll(conversationId, mount, {
        ...opts,
        triggerRescore: false,
    });
}

export function scheduleInfoWorkerPoll(conversationId, mount, opts) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return;
    cancelInfoWorkerPoll(cid);
    const generation = pollGenerationByConversation.get(cid) ?? 0;

    const getLatestMid = () => {
        if (typeof opts.getLatestAssistantMessageId === 'function') {
            const v = opts.getLatestAssistantMessageId(cid);
            return v != null && Number(v) > 0 ? Math.floor(Number(v)) : null;
        }
        return null;
    };

    const getPendingIds = () => {
        const latest = getLatestMid();
        if (typeof opts.getPendingMessageIds === 'function') {
            return opts.getPendingMessageIds(cid, latest);
        }
        return getProductivityPendingMessageIds(mount, cid, latest);
    };

    let attempts = 0;
    let domWaitAttempts = 0;
    let rescoreTriggered = false;

    const scheduleNext = (delayMs) => {
        if (pollGenerationByConversation.get(cid) !== generation) return;
        const timer = setTimeout(() => void tick(), delayMs);
        pollTimerByConversation.set(cid, timer);
    };

    const tick = async () => {
        if (pollGenerationByConversation.get(cid) !== generation) return;
        pollTimerByConversation.delete(cid);
        const activeCid =
            typeof opts.activeConversationId === 'function' ? opts.activeConversationId() : cid;
        if (activeCid !== cid) {
            if (conversationProductivityWorkPending(mount, cid, getLatestMid())) {
                scheduleNext(INFO_WORKER_POLL_INTERVAL_MS);
            }
            return;
        }
        if (typeof opts.chatApiUrl !== 'function' || typeof opts.getScopeQuery !== 'function') {
            return;
        }
        resyncPendingInfoMessagesFromDom(mount, cid);
        if (pollInFlightByConversation.get(cid)) {
            scheduleNext(INFO_WORKER_DOM_WAIT_MS);
            return;
        }

        let pendingIds = getPendingIds();
        const latestForPending = getLatestMid();
        if (
            pendingIds.length < 1 &&
            !conversationProductivityWorkPending(mount, cid, latestForPending)
        ) {
            cancelInfoWorkerPoll(cid);
            opts.onPendingIdle?.(cid);
            return;
        }
        pendingIds = getPendingIds();

        if (typeof opts.ensureWatchRowReady === 'function') {
            let allReady = true;
            for (const mid of pendingIds) {
                if (!opts.ensureWatchRowReady(mid)) {
                    allReady = false;
                    break;
                }
            }
            if (!allReady) {
                const hasInfoPills = pendingIds.some((mid) => {
                    const row = opts.getAssistantRow(mount, mid);
                    return Boolean(row?.querySelector('[data-oaao-info-pill]'));
                });
                if (!hasInfoPills) {
                    domWaitAttempts += 1;
                    if (domWaitAttempts < INFO_WORKER_DOM_WAIT_MAX) {
                        scheduleNext(INFO_WORKER_DOM_WAIT_MS);
                        return;
                    }
                }
            }
        }

        pollInFlightByConversation.set(cid, true);
        attempts += 1;
        try {
            const pack = await fetchInfoWorker(opts.chatApiUrl, cid, pendingIds, opts.getScopeQuery);
            domWaitAttempts = 0;
            const packLatest = Math.floor(Number(pack.latest_assistant_message_id) || 0);
            const latestMid = packLatest > 0 ? packLatest : getLatestMid();
            if (latestMid != null && latestMid > 0 && productivityRegistryUsesOnlyLast(pack.workers)) {
                pruneStaleOnlyLastProductivity(mount, cid, latestMid, opts.getAssistantRow);
            }
            const messages =
                pack.messages && typeof pack.messages === 'object'
                    ? /** @type {Record<string, Record<string, unknown>>} */ (pack.messages)
                    : {};

            for (const [midStr, bundle] of Object.entries(messages)) {
                const mid = Math.floor(Number(midStr));
                if (mid < 1 || !bundle) continue;
                if (!pendingIds.includes(mid)) continue;
                const row = bundle.turn_score;
                if (row && typeof row === 'object' && opts.mergeTurnScoreIntoCache) {
                    opts.mergeTurnScoreIntoCache(cid, mid, /** @type {Record<string, unknown>} */ (row));
                }
                const outer = opts.getAssistantRow(mount, mid);
                if (outer instanceof HTMLElement) {
                    applyInfoWorkerMessageBundle(
                        outer,
                        bundle,
                        cid,
                        mid,
                        opts.buildStripCtx(mount instanceof HTMLElement ? mount : document.body, cid),
                        opts.applyTurnScore,
                        opts.resolveTurnScoreRow ?? null,
                        latestMid,
                    );
                    if (infoWorkerProductivityReadyForMessage(mount, mid)) {
                        unregisterPendingInfoMessage(cid, mid);
                    }
                } else if (typeof opts.ensureWatchRowReady === 'function') {
                    opts.ensureWatchRowReady(mid);
                }
            }

            const rescorePending = Number(pack.rescore_pending) || 0;
            if (opts.triggerRescore !== false && !rescoreTriggered && rescorePending > 0) {
                rescoreTriggered = true;
                opts.onRescorePending?.(cid);
            }

            const stillPending = conversationProductivityWorkPending(mount, cid, latestMid);
            if (!stillPending || attempts >= INFO_WORKER_POLL_MAX_ATTEMPTS) {
                cancelInfoWorkerPoll(cid);
                opts.onPendingIdle?.(cid);
                return;
            }
        } catch (err) {
            if (String(/** @type {Error} */ (err)?.message ?? err) === 'no_pending_info_messages') {
                cancelInfoWorkerPoll(cid);
                opts.onPendingIdle?.(cid);
                return;
            }
            if (attempts >= INFO_WORKER_POLL_MAX_ATTEMPTS) {
                cancelInfoWorkerPoll(cid);
                opts.onPendingIdle?.(cid);
                return;
            }
        } finally {
            pollInFlightByConversation.delete(cid);
        }

        if (pollGenerationByConversation.get(cid) !== generation) return;
        if (!conversationProductivityWorkPending(mount, cid, getLatestMid())) {
            cancelInfoWorkerPoll(cid);
            opts.onPendingIdle?.(cid);
            return;
        }
        scheduleNext(INFO_WORKER_POLL_INTERVAL_MS);
    };

    for (const mid of getPendingIds()) {
        opts.ensureWatchRowReady?.(mid);
    }
    scheduleNext(0);
}

export {
    INFO_WORKER_POLL_INTERVAL_MS,
    INFO_WORKER_POLL_MAX_ATTEMPTS,
};
