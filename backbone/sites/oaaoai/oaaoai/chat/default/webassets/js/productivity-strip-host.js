/**
 * Shared [strip] area helpers — no calendar/todo module imports (safe for chat-panel ui_stage).
 *
 * @module productivity-strip-host
 */

/**
 * Canonical assistant-row order — docs/design/chat-ui-areas.md (top → bottom).
 *
 * @param {HTMLElement} outer
 */
export function reorderAssistantRowAreas(outer) {
    if (!(outer instanceof HTMLElement)) return;

    /**
     * @param {string} selector
     * @returns {HTMLElement | null}
     */
    const pick = (selector) => {
        const el = outer.querySelector(selector);
        return el instanceof HTMLElement ? el : null;
    };

    const info = pick('[data-oaao-chat-area="info"]') ?? pick('[data-oaao-chat="turn-score"]');
    const state =
        pick('[data-oaao-chat-area="state"]') ?? pick('[data-oaao-chat="assistant-summary-wrap"]');

    /** @type {(HTMLElement | null)[]} */
    const candidates = [
        pick('[data-oaao-chat="assistant-identity"]'),
        pick('[data-oaao-chat="inline-task-steps"]'),
        pick('[data-oaao-chat="pipeline-blocks"]'),
        pick('[data-oaao-chat="pipeline-chrome"]'),
        pick('[data-oaao-msg-role="assistant"]'),
        pick('[data-oaao-chat="pipeline-after-blocks"]'),
        info,
        state,
        pick('[data-oaao-chat="assistant-truncation-wrap"]'),
        pick('[data-oaao-chat="run-retry-banner"]'),
        pick('[data-oaao-chat-area="strip"]'),
        pick('.oaao-chat-assistant-toolbar'),
    ];

    /** @type {Set<HTMLElement>} */
    const seen = new Set();
    for (const el of candidates) {
        if (!(el instanceof HTMLElement) || seen.has(el)) continue;
        seen.add(el);
        outer.append(el);
    }
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} messageId
 * @returns {{ outer: HTMLElement | null, msgsHost: HTMLElement | null }}
 */
export function resolveProductivityOuter(mount, messageId) {
    const mid = Math.floor(Number(messageId));
    if (mid < 1) return { outer: null, msgsHost: null };
    /** @type {HTMLElement[]} */
    const roots = [];
    /** @type {Set<HTMLElement>} */
    const seen = new Set();
    const addRoot = (el) => {
        if (!(el instanceof HTMLElement) || seen.has(el)) return;
        if (
            el.dataset.oaaoChatMount === 'bubble-bridge' ||
            el.closest('#oaao-chat-bubble-bridge-bootstrap')
        ) {
            return;
        }
        seen.add(el);
        roots.push(el);
    };
    if (mount instanceof HTMLElement) {
        addRoot(mount);
        const closest = mount.closest('[data-module="oaao-chat"]');
        if (closest instanceof HTMLElement) addRoot(closest);
    }
    document.querySelectorAll('[data-module="oaao-chat"]').forEach((el) => {
        if (el instanceof HTMLElement) addRoot(el);
    });

    for (const root of roots) {
        const msgsHost = root.querySelector('[data-oaao-chat="messages"]');
        if (!(msgsHost instanceof HTMLElement)) continue;
        const bubble =
            msgsHost.querySelector(`[data-oaao-msg-id="${mid}"][data-oaao-msg-role="assistant"]`) ??
            msgsHost.querySelector(`[data-oaao-msg-id="${mid}"]`);
        if (!(bubble instanceof HTMLElement)) continue;
        const outer = bubble.closest('.oaao-chat-assistant-row');
        if (outer instanceof HTMLElement) return { outer, msgsHost };
    }
    return { outer: null, msgsHost: null };
}

/** Insert chip into [strip] — post-turn area after [info]/[state], before toolbar. */
export function mountProductivityChip(outer, chip) {
    let strip = outer.querySelector('[data-oaao-chat-area="strip"]');
    if (!(strip instanceof HTMLElement)) {
        strip = document.createElement('div');
        strip.dataset.oaaoChatArea = 'strip';
        strip.dataset.oaaoChat = 'action-strip';
        strip.className =
            'oaao-chat-area oaao-chat-area--strip grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 w-full min-w-0 max-w-full';
        outer.append(strip);
    }
    strip.append(chip);
    reorderAssistantRowAreas(outer);
    try {
        chip.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {
        /* ignore */
    }
}
