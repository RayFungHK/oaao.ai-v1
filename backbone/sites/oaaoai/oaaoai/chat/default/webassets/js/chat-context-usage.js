/**
 * Chat context usage ring (composer toolbar) + breakdown dialog.
 *
 * @module chat-context-usage
 */

/**
 * @param {string} _key
 * @param {string} fallback
 */
function oaaoChatT(_key, fallback) {
    const i18n = globalThis.oaaoI18n;
    if (i18n && typeof i18n.t === 'function') {
        const v = i18n.t(_key);
        if (typeof v === 'string' && v.trim() !== '' && v !== _key) return v;
    }
    return fallback;
}

/** @typedef {{ key: string, label: string, tokens: number }} ContextSegment */

const CONTEXT_USAGE_STYLE_ID = 'oaao-chat-context-usage-styles';
const CONTEXT_USAGE_STYLE_REV = '20260529-ctx-ring-v10-dedupe';

/** @type {ReturnType<typeof setInterval> | null} */
let contextUsagePollTimer = null;
/** @type {(() => void) | null} */
let contextUsageConversationOpenedHandler = null;
/** @type {Promise<void> | null} */
let contextUsageRefreshInFlight = null;
let contextUsageRefreshQueued = false;

function stopContextUsagePoll() {
    if (contextUsagePollTimer) {
        clearInterval(contextUsagePollTimer);
        contextUsagePollTimer = null;
    }
}

/**
 * @param {() => void} refreshRing
 */
function startContextUsagePoll(refreshRing) {
    stopContextUsagePoll();
    contextUsagePollTimer = setInterval(() => {
        refreshRing();
    }, 120_000);
}

const SEGMENT_COLORS = {
    system_prompt: 'var(--grid-caption,#9ca3af)',
    tool_definitions: '#a78bfa',
    rules: '#34d399',
    skills: '#fb923c',
    mcp: '#c4b5fd',
    subagent_definitions: '#67e8f9',
    summarized_conversation: '#f472b6',
    conversation: 'var(--grid-ink-muted,#6b7280)',
};

/**
 * @param {string} chatApiBase
 * @param {number} conversationId
 * @param {number} chatEndpointId
 */
/**
 * @param {() => Record<string, string>} [getScopeQuery]
 */
async function fetchContextUsage(chatApiBase, conversationId, chatEndpointId, getScopeQuery) {
    const qs = new URLSearchParams({
        conversation_id: String(conversationId),
    });
    if (chatEndpointId > 0) {
        qs.set('chat_endpoint_id', String(chatEndpointId));
    }
    if (typeof getScopeQuery === 'function') {
        const scope = getScopeQuery();
        if (scope && typeof scope.workspace_id === 'string' && scope.workspace_id.trim() !== '') {
            qs.set('workspace_id', scope.workspace_id.trim());
        }
    }
    const res = await fetch(`${chatApiBase}context_usage?${qs}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) {
        throw new Error(typeof j.message === 'string' ? j.message : 'context_usage_failed');
    }
    return j.data;
}

/** Inline CSS — {@code hidden} must not rely on Tailwind JIT for dynamically mounted nodes. */
function ensureContextUsageStyles() {
    if (typeof document === 'undefined') return;
    const prev = document.getElementById(CONTEXT_USAGE_STYLE_ID);
    if (prev?.dataset.oaaoRev === CONTEXT_USAGE_STYLE_REV) return;
    prev?.remove();
    const style = document.createElement('style');
    style.id = CONTEXT_USAGE_STYLE_ID;
    style.dataset.oaaoRev = CONTEXT_USAGE_STYLE_REV;
    style.textContent = `
[data-oaao-chat="composer-feature-toggles"] [data-oaao-chat="context-usage-slot"],
[data-oaao-chat="composer-feature-toggles"] [data-oaao-chat="context-usage-trigger"],
[data-oaao-chat="composer-feature-toggles"] .oaao-chat-context-usage-btn{display:none!important;width:0!important;min-width:0!important;max-width:0!important;margin:0!important;padding:0!important;overflow:hidden!important;visibility:hidden!important;pointer-events:none!important}
.oaao-chat-context-usage-slot{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;min-width:0;margin:0;padding:0}
.oaao-chat-context-usage-slot:not(.is-visible){display:none!important;width:0!important;min-width:0!important;max-width:0!important;margin:0!important;padding:0!important;overflow:hidden!important;visibility:hidden!important}
.oaao-chat-context-usage-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;min-width:14px;min-height:14px;flex-shrink:0;margin:0;padding:0;border:0;border-radius:9999px;background:transparent;color:var(--grid-ink-muted,#6b7280);cursor:pointer;font:inherit;box-sizing:content-box}
.oaao-chat-context-usage-btn::before{content:"";position:absolute;inset:-7px;border-radius:9999px}
.oaao-chat-context-usage-btn .oaao-context-ring-svg{display:block;width:14px;height:14px}
`;
    document.head.append(style);
}

/**
 * @param {HTMLElement | null} toolbarHost
 * @param {HTMLElement | null} slot
 * @param {HTMLButtonElement} btn
 * @param {boolean} visible
 */
/**
 * Remove legacy feature-toggles mounts (context usage belongs in extra toolbar).
 *
 * @param {HTMLElement} mount
 */
export function purgeComposerContextUsageOrphans(mount) {
    const extra = mount.querySelector('[data-oaao-chat="composer-registry-extra-toolbar"]');
    mount.querySelectorAll('[data-oaao-chat="context-usage-slot"], [data-oaao-chat="context-usage-trigger"]').forEach(
        (el) => {
            if (extra instanceof HTMLElement && extra.contains(el)) return;
            const slot = el.closest('[data-oaao-chat="context-usage-slot"]');
            (slot ?? el).remove();
        },
    );
    syncComposerExtraToolbarStrip(mount);
}

function setContextUsageBtnVisible(toolbarHost, slot, btn, visible) {
    const root =
        toolbarHost?.closest('[data-oaao-chat-mount]') ??
        toolbarHost?.closest('.oaao-chat-root') ??
        null;
    if (root instanceof HTMLElement) {
        purgeComposerContextUsageOrphans(root);
    }
    if (!visible) {
        btn.hidden = true;
        btn.setAttribute('aria-hidden', 'true');
        btn.innerHTML = '';
        btn.removeAttribute('title');
        if (btn.isConnected) {
            btn.remove();
        }
        if (slot?.isConnected) {
            slot.remove();
        }
        if (root instanceof HTMLElement) {
            syncComposerExtraToolbarStrip(root);
        }
        return;
    }
    btn.hidden = false;
    btn.removeAttribute('aria-hidden');
    slot.classList.add('is-visible');
    if (!slot.contains(btn)) {
        slot.append(btn);
    }
    if (toolbarHost && !toolbarHost.contains(slot)) {
        toolbarHost.prepend(slot);
    }
    if (root instanceof HTMLElement) {
        syncComposerExtraToolbarStrip(root);
    }
}

/**
 * Keep extra-toolbar strip hidden when only orphaned context-usage nodes were present.
 *
 * @param {HTMLElement} mount
 */
function syncComposerExtraToolbarStrip(mount) {
    const wrap = mount.querySelector('[data-oaao-chat="composer-extra-toolbar-wrap"]');
    const host = mount.querySelector('[data-oaao-chat="composer-registry-extra-toolbar"]');
    const card = mount.querySelector('[data-oaao-chat="composer-card-wrap"]');
    if (!(wrap instanceof HTMLElement) || !(host instanceof HTMLElement)) return;
    const open = [...host.children].some((ch) => {
        if (!(ch instanceof HTMLElement)) return false;
        if (ch.matches('[data-oaao-chat="context-usage-slot"]')) {
            return (
                ch.classList.contains('is-visible') &&
                ch.querySelector('[data-oaao-chat="context-usage-trigger"]') instanceof HTMLButtonElement
            );
        }
        return !ch.hidden && !ch.classList.contains('hidden') && ch.getAttribute('aria-hidden') !== 'true';
    });
    wrap.classList.toggle('hidden', !open);
    if (card instanceof HTMLElement) {
        if (open) {
            card.setAttribute('data-oaao-composer-toolbar', 'open');
        } else {
            card.removeAttribute('data-oaao-composer-toolbar');
        }
    }
}

/**
 * @param {HTMLElement} mount
 * @returns {HTMLElement | null}
 */
function composerExtraToolbarHost(mount) {
    const host = mount.querySelector('[data-oaao-chat="composer-registry-extra-toolbar"]');
    return host instanceof HTMLElement ? host : null;
}

/**
 * Small ring for composer toolbar (14×14).
 *
 * @param {number} pct 0–100
 */
function ringSvg(pct) {
    const p = Math.max(0, Math.min(100, pct));
    const r = 5.5;
    const c = 2 * Math.PI * r;
    const dash = (p / 100) * c;
    return `<svg class="oaao-context-ring-svg block shrink-0" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
<circle cx="7" cy="7" r="${r}" fill="none" stroke="var(--grid-line,rgba(0,0,0,.14))" stroke-width="1.5"/>
<circle cx="7" cy="7" r="${r}" fill="none" stroke="var(--grid-ink,#374151)" stroke-width="1.5"
  stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 7 7)"/>
</svg>`;
}

/**
 * @param {HTMLElement} mount
 * @param {() => number} getConversationId
 * @param {() => number} getChatEndpointId
 * @param {string} chatApiBase
 * @param {() => Promise<void>} reloadThread
 */
export function mountChatContextUsage(
    mount,
    getConversationId,
    getChatEndpointId,
    chatApiBase,
    reloadThread,
    getScopeQuery,
) {
    const toolbarHost = composerExtraToolbarHost(mount);
    if (!toolbarHost) return;

    ensureContextUsageStyles();
    purgeComposerContextUsageOrphans(mount);

    toolbarHost.querySelectorAll('[data-oaao-chat="context-usage-slot"]').forEach((el) => el.remove());

    const slot = document.createElement('span');
    slot.dataset.oaaoChat = 'context-usage-slot';
    slot.className = 'oaao-chat-context-usage-slot shrink-0';

    let btn = slot.querySelector('[data-oaao-chat="context-usage-trigger"]');
    if (!(btn instanceof HTMLButtonElement)) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.oaaoChat = 'context-usage-trigger';
        btn.className = 'oaao-chat-context-usage-btn hover:bg-[var(--grid-line)]/30';
        btn.setAttribute('aria-label', oaaoChatT('chat.context_usage.ring_aria', 'Context usage'));
        slot.append(btn);
    }

    toolbarHost.querySelectorAll(':scope > [data-oaao-chat="context-usage-trigger"]').forEach((el) => {
        if (el !== btn) el.remove();
    });
    if (slot.isConnected) {
        slot.remove();
    }

    setContextUsageBtnVisible(toolbarHost, slot, btn, false);
    syncComposerExtraToolbarStrip(mount);

    /** @type {ReturnType<typeof setInterval>|null} */
    let pollTimer = null;

    async function refreshRing() {
        const cid = getConversationId();
        if (!Number.isFinite(cid) || cid < 1) {
            setContextUsageBtnVisible(toolbarHost, slot, btn, false);
            syncComposerExtraToolbarStrip(mount);
            return;
        }
        if (contextUsageRefreshInFlight) {
            contextUsageRefreshQueued = true;
            return contextUsageRefreshInFlight;
        }
        setContextUsageBtnVisible(toolbarHost, slot, btn, true);
        syncComposerExtraToolbarStrip(mount);
        contextUsageRefreshInFlight = (async () => {
            try {
                const data = await fetchContextUsage(chatApiBase, cid, getChatEndpointId(), getScopeQuery);
                const pct = Number(data?.percent_full ?? 0);
                const used = Number(data?.used_tokens ?? 0);
                const limit = Number(data?.context_limit_tokens ?? 0);
                btn.innerHTML = ringSvg(pct);
                btn.title = oaaoChatT(
                    'chat.context_usage.ring_title',
                    '{pct}% · ~{used} / {limit} tokens',
                )
                    .replace('{pct}', String(pct))
                    .replace('{used}', formatTokenK(used))
                    .replace('{limit}', formatTokenK(limit));
                btn.dataset.oaaoContextPct = String(pct);
                const canCompact = Boolean(data?.can_compact);
                if (pct >= 85 && canCompact && canCompactSuggest(cid)) {
                    document.dispatchEvent(
                        new CustomEvent('oaao-toast', {
                            detail: {
                                message: oaaoChatT(
                                    'chat.context_usage.suggest_compact',
                                    'Context is nearly full — open Context to compact this thread (CIT/CMT).',
                                ),
                            },
                        }),
                    );
                }
            } catch {
                btn.innerHTML = ringSvg(0);
            } finally {
                contextUsageRefreshInFlight = null;
                if (contextUsageRefreshQueued) {
                    contextUsageRefreshQueued = false;
                    void refreshRing();
                }
            }
        })();
        return contextUsageRefreshInFlight;
    }

    /** @param {number} cid */
    function canCompactSuggest(cid) {
        try {
            const key = `oaao_ctx_compact_hint_${cid}`;
            if (sessionStorage.getItem(key) === '1') return false;
            sessionStorage.setItem(key, '1');
        } catch {
            /* ignore */
        }
        return true;
    }

    function stopPoll() {
        pollTimer = null;
        stopContextUsagePoll();
    }

    function startPoll() {
        stopPoll();
        startContextUsagePoll(() => {
            void refreshRing();
        });
    }

    const scheduleRefreshRing = () => {
        void refreshRing();
    };

    btn.addEventListener('click', () => {
        void openContextDialog();
    });

    async function openContextDialog() {
        const cid = getConversationId();
        if (!Number.isFinite(cid) || cid < 1) return;

        let data;
        try {
            data = await fetchContextUsage(chatApiBase, cid, getChatEndpointId(), getScopeQuery);
        } catch (err) {
            console.error('[oaao] context_usage', err);
            return;
        }

        const pct = Number(data?.percent_full ?? 0);
        const used = Number(data?.used_tokens ?? 0);
        const limit = Number(data?.context_limit_tokens ?? 0);
        /** @type {ContextSegment[]} */
        const segments = Array.isArray(data?.segments) ? data.segments : [];
        const canCompact = Boolean(data?.can_compact);

        const backdrop = document.createElement('div');
        backdrop.className =
            'oaao-context-dialog-backdrop fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[rgba(0,0,0,0.45)]';
        backdrop.setAttribute('role', 'presentation');

        const panel = document.createElement('div');
        panel.className =
            'oaao-context-dialog-panel w-full max-w-[22rem] rounded-[12px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[0_12px_40px_rgba(0,0,0,0.18)] p-4 flex flex-col gap-3';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-labelledby', 'oaao-context-dialog-title');

        const head = document.createElement('div');
        head.className = 'flex items-start justify-between gap-2';
        const title = document.createElement('h2');
        title.id = 'oaao-context-dialog-title';
        title.className = 'text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] m-0';
        title.textContent = oaaoChatT('chat.context_usage.title', 'Context');
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className =
            'inline-flex items-center justify-center w-8 h-8 rounded-full border-none bg-transparent cursor-pointer fg-[var(--grid-caption)] hover:bg-[var(--grid-line)]/35 font-inherit';
        closeBtn.setAttribute('aria-label', oaaoChatT('chat.context_usage.close', 'Close'));
        closeBtn.textContent = '×';
        head.append(title, closeBtn);

        const status = document.createElement('div');
        status.className = 'flex items-baseline justify-between gap-2 text-[0.8125rem]';
        const left = document.createElement('span');
        left.className = 'fw-semibold fg-[var(--grid-ink)]';
        left.textContent = oaaoChatT('chat.context_usage.percent_full', '{pct}% Full').replace(
            '{pct}',
            String(pct),
        );
        const right = document.createElement('span');
        right.className = 'fg-[var(--grid-caption)] font-mono text-[0.75rem]';
        right.textContent = oaaoChatT('chat.context_usage.token_line', '~{used} / {limit} Tokens')
            .replace('{used}', formatTokenK(used))
            .replace('{limit}', formatTokenK(limit));
        status.append(left, right);

        const bar = document.createElement('div');
        bar.className = 'flex w-full h-2 rounded-full overflow-hidden bg-[var(--grid-line)]/40';
        const totalSeg = segments.reduce((s, x) => s + (Number(x.tokens) || 0), 0) || 1;
        for (const seg of segments) {
            const tok = Number(seg.tokens) || 0;
            if (tok < 1) continue;
            const w = (tok / totalSeg) * 100;
            const chunk = document.createElement('span');
            chunk.className = 'h-full shrink-0';
            chunk.style.width = `${w}%`;
            chunk.style.background = SEGMENT_COLORS[seg.key] || 'var(--grid-caption)';
            chunk.title = `${seg.label}: ${tok}`;
            bar.append(chunk);
        }

        const list = document.createElement('ul');
        list.className = 'flex flex-col gap-1.5 m-0 p-0 list-none max-h-[40vh] overflow-y-auto';
        for (const seg of segments) {
            const tok = Number(seg.tokens) || 0;
            if (tok < 1 && seg.key !== 'conversation') continue;
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between gap-2 text-[0.8125rem]';
            const lab = document.createElement('span');
            lab.className = 'inline-flex items-center gap-1.5 min-w-0 truncate fg-[var(--grid-ink)]';
            const swatch = document.createElement('span');
            swatch.className = 'inline-block w-2 h-2 rounded-[2px] shrink-0';
            swatch.style.background = SEGMENT_COLORS[seg.key] || 'var(--grid-caption)';
            const name = document.createElement('span');
            name.className = 'truncate';
            name.textContent = seg.label || seg.key;
            lab.append(swatch, name);
            const num = document.createElement('span');
            num.className = 'font-mono text-[0.75rem] fg-[var(--grid-caption)] shrink-0';
            num.textContent = formatTokenK(tok);
            li.append(lab, num);
            list.append(li);
        }

        const hint = document.createElement('p');
        hint.className = 'text-[0.6875rem] leading-snug fg-[var(--grid-caption)] m-0';
        hint.textContent = oaaoChatT(
            'chat.context_usage.hint',
            'Older turns can be summarized with CIT/CMT so the model keeps goals without replaying every message.',
        );

        const actions = document.createElement('div');
        actions.className = 'flex flex-wrap gap-2 justify-end pt-1';
        if (canCompact) {
            const compactBtn = document.createElement('button');
            compactBtn.type = 'button';
            compactBtn.className =
                'rounded-[8px] h-9 px-3 text-[0.8125rem] fw-semibold border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] fg-[var(--grid-ink)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25';
            compactBtn.textContent = oaaoChatT('chat.context_usage.compact_btn', 'Compact thread (CIT/CMT)');
            compactBtn.addEventListener('click', () => {
                void runCompact(compactBtn, backdrop);
            });
            actions.append(compactBtn);
        }

        panel.append(head, status, bar, list, hint, actions);
        backdrop.append(panel);
        document.body.append(backdrop);

        const close = () => backdrop.remove();
        closeBtn.addEventListener('click', close);
        backdrop.addEventListener('click', (ev) => {
            if (ev.target === backdrop) close();
        });
        document.addEventListener(
            'keydown',
            function onKey(ev) {
                if (ev.key !== 'Escape') return;
                close();
                document.removeEventListener('keydown', onKey);
            },
            { once: true },
        );

        async function runCompact(compactBtn, dlgBackdrop) {
            compactBtn.disabled = true;
            try {
                const res = await fetch(`${chatApiBase}conversation_compact`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ conversation_id: cid }),
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok || !j.success) {
                    throw new Error(typeof j.message === 'string' ? j.message : 'compact_failed');
                }
                dlgBackdrop.remove();
                await reloadThread();
                void refreshRing();
                document.dispatchEvent(
                    new CustomEvent('oaao-toast', {
                        detail: {
                            message: oaaoChatT(
                                'chat.context_usage.compact_done',
                                'Thread compacted — older messages summarized.',
                            ),
                        },
                    }),
                );
            } catch (err) {
                console.error('[oaao] conversation_compact', err);
            } finally {
                compactBtn.disabled = false;
            }
        }
    }

    globalThis.__oaaoRefreshChatContextUsage = scheduleRefreshRing;
    globalThis.__oaaoStartChatContextUsagePoll = startPoll;
    globalThis.__oaaoStopChatContextUsagePoll = stopPoll;

    if (contextUsageConversationOpenedHandler) {
        document.removeEventListener('oaao-conversation-opened', contextUsageConversationOpenedHandler);
    }
    contextUsageConversationOpenedHandler = scheduleRefreshRing;
    document.addEventListener('oaao-conversation-opened', contextUsageConversationOpenedHandler);

    if (getConversationId() > 0) {
        startPoll();
        void refreshRing();
    }
}

/**
 * @param {number} n
 */
function formatTokenK(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 1) return '0';
    if (v >= 1000) {
        return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    }
    return String(Math.round(v));
}
