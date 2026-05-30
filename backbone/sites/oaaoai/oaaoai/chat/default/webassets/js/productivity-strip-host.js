/**
 * Shared [strip] area helpers — no calendar/todo module imports (safe for chat-panel ui_stage).
 *
 * @module productivity-strip-host
 */

/**
 * @param {HTMLElement | Document} mount
 * @param {number} messageId
 * @returns {{ outer: HTMLElement | null, msgsHost: HTMLElement | null }}
 */
export function resolveProductivityOuter(mount, messageId) {
    const mid = Math.floor(Number(messageId));
    if (mid < 1) return { outer: null, msgsHost: null };
    /** @type {Array<HTMLElement | Document>} */
    const roots = [];
    if (mount instanceof HTMLElement || mount instanceof Document) roots.push(mount);
    if (mount instanceof HTMLElement) {
        const closest = mount.closest('[data-module="oaao-chat"]');
        if (closest instanceof HTMLElement) roots.push(closest);
    }
    const docRoot = document.querySelector('[data-module="oaao-chat"]');
    if (docRoot instanceof HTMLElement) roots.push(docRoot);

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

/** Insert chip into [strip] area — above [info]/[state], below message/agent blocks. */
export function mountProductivityChip(outer, chip) {
    let strip = outer.querySelector('[data-oaao-chat-area="strip"]');
    if (!(strip instanceof HTMLElement)) {
        strip = document.createElement('div');
        strip.dataset.oaaoChatArea = 'strip';
        strip.dataset.oaaoChat = 'action-strip';
        strip.className = 'oaao-chat-area oaao-chat-area--strip w-full min-w-0 max-w-full';
        const anchor =
            outer.querySelector('[data-oaao-chat-area="info"]') ||
            outer.querySelector('[data-oaao-chat="turn-score"]') ||
            outer.querySelector('[data-oaao-chat-area="state"]') ||
            outer.querySelector('[data-oaao-chat="assistant-summary-wrap"]') ||
            outer.querySelector('.oaao-chat-assistant-toolbar');
        if (anchor instanceof HTMLElement) {
            outer.insertBefore(strip, anchor);
        } else {
            outer.append(strip);
        }
    }
    strip.append(chip);
    try {
        chip.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {
        /* ignore */
    }
}
