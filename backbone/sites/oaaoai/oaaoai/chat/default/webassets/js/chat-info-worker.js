/**
 * Unified [info] worker client — one poll for turn scores + productivity status + strip items.
 *
 * @see docs/design/chat-ui-areas.md § [info]
 * @module chat-info-worker
 */

import { mountStripFromEnvelope } from './strip-chip-shell.js';

const INFO_WORKER_STYLE_ID = 'oaao-chat-info-worker-styles';
const INFO_WORKER_STYLE_REV = '20260529-info-worker-v163';

const INFO_WORKER_POLL_INTERVAL_MS = 2500;
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

function ensureInfoWorkerStyles() {
    if (typeof document === 'undefined') return;
    const prev = document.getElementById(INFO_WORKER_STYLE_ID);
    if (prev?.dataset.oaaoRev === INFO_WORKER_STYLE_REV) return;
    prev?.remove();
    const style = document.createElement('style');
    style.id = INFO_WORKER_STYLE_ID;
    style.dataset.oaaoRev = INFO_WORKER_STYLE_REV;
    style.textContent = `
.oaao-chat-info-pill--calendar.oaao-chat-info-pill--pending,
.oaao-chat-info-pill--todo.oaao-chat-info-pill--pending {
  animation: oaao-info-pill-pulse 1.1s ease-in-out infinite;
}
@keyframes oaao-info-pill-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.oaao-chat-info-pill--ready { cursor: pointer; }
.oaao-chat-info-pill__icon { display: inline-flex; width: 12px; height: 12px; margin-right: 3px; vertical-align: -1px; }
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
export function applyInfoWorkerPendingPills(outer, conversationId, messageId, applyTurnScore = null) {
    if (!(outer instanceof HTMLElement)) return;
    registerPendingInfoMessage(conversationId, messageId);
    let wrap = outer.querySelector('[data-oaao-chat="turn-score"]');
    if (!(wrap instanceof HTMLElement)) {
        wrap = document.createElement('div');
        wrap.dataset.oaaoChat = 'turn-score';
        wrap.dataset.oaaoChatArea = 'info';
        wrap.className = 'oaao-chat-area oaao-chat-area--info oaao-chat-turn-score-pills';
        wrap.setAttribute('aria-label', 'Turn information');
        const stateAnchor =
            outer.querySelector('[data-oaao-chat-area="state"]') ||
            outer.querySelector('[data-oaao-chat="assistant-summary-wrap"]') ||
            outer.querySelector('.oaao-chat-assistant-toolbar');
        if (stateAnchor instanceof HTMLElement) {
            outer.insertBefore(wrap, stateAnchor);
        } else {
            outer.append(wrap);
        }
    }
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
    const label = kind === 'calendar' ? 'Cal' : 'Todo';
    let pill = wrap.querySelector(`[data-oaao-info-pill="${kind}"]`);
    if (!(pill instanceof HTMLElement)) {
        pill = document.createElement('span');
        pill.dataset.oaaoInfoPill = kind;
        pill.className = `oaao-chat-turn-score-pill oaao-chat-info-pill oaao-chat-info-pill--${kind}`;
        pill.setAttribute('role', 'note');
        const mainSpan = document.createElement('span');
        mainSpan.className = 'oaao-chat-turn-score-pill__main';
        pill.append(mainSpan);
        wrap.append(pill);
    }
    pill.classList.remove(
        'oaao-chat-info-pill--pending',
        'oaao-chat-info-pill--ready',
        'oaao-chat-turn-score-pill--pending',
    );
    const mainEl = pill.querySelector('.oaao-chat-turn-score-pill__main');
    if (!(mainEl instanceof HTMLElement)) return;

    if (status === 'pending') {
        pill.classList.add('oaao-chat-info-pill--pending', 'oaao-chat-turn-score-pill--pending');
        mainEl.textContent = `${label} …`;
        pill.title = kind === 'calendar' ? 'Calendar worker running…' : 'Todo worker running…';
        pill.tabIndex = -1;
        return;
    }

    const count = Math.max(0, Math.floor(Number(state.count) || 0));
    pill.classList.add('oaao-chat-info-pill--ready');
    mainEl.textContent = count > 1 ? `${label} ${count}` : label;
    pill.title =
        kind === 'calendar'
            ? 'Calendar suggestion ready — see strip below'
            : 'Todo suggestion ready — see strip below';
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
 * @param {Record<string, unknown>} productivity
 * @param {number} conversationId
 * @param {number} messageId
 */
function mergeProductivityWithLocalPending(productivity, conversationId, messageId) {
    const key = `${Math.floor(Number(conversationId))}:${Math.floor(Number(messageId))}`;
    const local = localPendingByMessage.get(key);
    /** @type {Record<string, { status?: string, count?: number }>} */
    const out =
        productivity && typeof productivity === 'object'
            ? /** @type {Record<string, { status?: string, count?: number }>} */ ({ ...productivity })
            : {};
    if (local?.pendingCalendar && out.calendar?.status !== 'ready') {
        out.calendar = { ...(out.calendar ?? {}), status: 'pending', count: 0 };
    }
    if (local?.pendingTodo && out.todo?.status !== 'ready') {
        out.todo = { ...(out.todo ?? {}), status: 'pending', count: 0 };
    }
    if (out.calendar?.status === 'ready' || out.calendar?.status === 'idle') {
        if (local) local.pendingCalendar = false;
    }
    if (out.todo?.status === 'ready' || out.todo?.status === 'idle') {
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
) {
    if (!(outer instanceof HTMLElement) || !messageBundle || typeof messageBundle !== 'object') return;

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

    const productivity = mergeProductivityWithLocalPending(
        messageBundle.productivity,
        conversationId,
        messageId,
    );
    renderProductivityInfoPill(wrap, 'calendar', productivity.calendar ?? { status: 'idle' });
    renderProductivityInfoPill(wrap, 'todo', productivity.todo ?? { status: 'idle' });

    const items = messageBundle.strip_items;
    if (Array.isArray(items) && items.length > 0) {
        mountStripFromEnvelope(outer, { items }, conversationId, messageId, stripCtx ?? {});
    }
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
 *   onRescorePending?: (cid: number) => void,
 *   activeConversationId: () => number | null,
 *   triggerRescore?: boolean,
 * }} opts
 */
export function scheduleInfoWorkerPoll(conversationId, mount, opts) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return;
    cancelInfoWorkerPoll(cid);
    const generation = pollGenerationByConversation.get(cid) ?? 0;

    const getPendingIds =
        typeof opts.getPendingMessageIds === 'function'
            ? () => opts.getPendingMessageIds(cid)
            : () => getPendingInfoMessageIds(cid);

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
        if (opts.activeConversationId() !== cid) return;
        if (pollInFlightByConversation.get(cid)) {
            scheduleNext(INFO_WORKER_DOM_WAIT_MS);
            return;
        }

        const pendingIds = getPendingIds();
        if (pendingIds.length < 1) {
            cancelInfoWorkerPoll(cid);
            return;
        }

        if (typeof opts.ensureWatchRowReady === 'function') {
            let allReady = true;
            for (const mid of pendingIds) {
                if (!opts.ensureWatchRowReady(mid)) {
                    allReady = false;
                    break;
                }
            }
            if (!allReady) {
                domWaitAttempts += 1;
                if (domWaitAttempts < INFO_WORKER_DOM_WAIT_MAX) {
                    scheduleNext(INFO_WORKER_DOM_WAIT_MS);
                    return;
                }
            }
        }

        pollInFlightByConversation.set(cid, true);
        attempts += 1;
        try {
            const pack = await fetchInfoWorker(opts.chatApiUrl, cid, pendingIds, opts.getScopeQuery);
            domWaitAttempts = 0;
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
                    );
                    if (infoWorkerDomReadyForMessage(mount, mid)) {
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

            if (getPendingIds().length < 1 || attempts >= INFO_WORKER_POLL_MAX_ATTEMPTS) {
                cancelInfoWorkerPoll(cid);
                return;
            }
        } catch (err) {
            if (String(/** @type {Error} */ (err)?.message ?? err) === 'no_pending_info_messages') {
                cancelInfoWorkerPoll(cid);
                return;
            }
            if (attempts >= INFO_WORKER_POLL_MAX_ATTEMPTS) {
                cancelInfoWorkerPoll(cid);
                return;
            }
        } finally {
            pollInFlightByConversation.delete(cid);
        }

        if (pollGenerationByConversation.get(cid) !== generation) return;
        if (getPendingIds().length < 1) {
            cancelInfoWorkerPoll(cid);
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
