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
async function fetchContextUsage(chatApiBase, conversationId, chatEndpointId) {
    const qs = new URLSearchParams({
        conversation_id: String(conversationId),
    });
    if (chatEndpointId > 0) {
        qs.set('chat_endpoint_id', String(chatEndpointId));
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
 */
function syncComposerContextToolbarStrip(mount) {
    const wrap = mount.querySelector('[data-oaao-chat="composer-extra-toolbar-wrap"]');
    const host = mount.querySelector('[data-oaao-chat="composer-registry-extra-toolbar"]');
    const card = mount.querySelector('[data-oaao-chat="composer-card-wrap"]');
    if (!(wrap instanceof HTMLElement) || !(host instanceof HTMLElement)) return;
    const open = host.childElementCount > 0;
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
 * @param {() => number} getConversationId
 * @param {() => number} getChatEndpointId
 * @param {string} chatApiBase
 * @param {() => Promise<void>} reloadThread
 */
export function mountChatContextUsage(mount, getConversationId, getChatEndpointId, chatApiBase, reloadThread) {
    const extraHost = mount.querySelector('[data-oaao-chat="composer-registry-extra-toolbar"]');
    if (!(extraHost instanceof HTMLElement)) return;

    let btn = extraHost.querySelector('[data-oaao-chat="context-usage-trigger"]');
    if (!(btn instanceof HTMLButtonElement)) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.oaaoChat = 'context-usage-trigger';
        btn.className =
            'oaao-chat-context-usage-btn hidden inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full border-0 bg-transparent fg-[var(--grid-ink-muted)] cursor-pointer font-inherit p-0 hover:bg-[var(--grid-line)]/30';
        btn.setAttribute('aria-label', oaaoChatT('chat.context_usage.ring_aria', 'Context usage'));
        extraHost.prepend(btn);
    }

    /** @type {ReturnType<typeof setInterval>|null} */
    let pollTimer = null;

    async function refreshRing() {
        const cid = getConversationId();
        if (!Number.isFinite(cid) || cid < 1) {
            btn.classList.add('hidden');
            btn.setAttribute('aria-hidden', 'true');
            syncComposerContextToolbarStrip(mount);
            return;
        }
        btn.classList.remove('hidden');
        btn.removeAttribute('aria-hidden');
        syncComposerContextToolbarStrip(mount);
        try {
            const data = await fetchContextUsage(chatApiBase, cid, getChatEndpointId());
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
        }
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
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function startPoll() {
        stopPoll();
        void refreshRing();
        pollTimer = setInterval(() => {
            void refreshRing();
        }, 120_000);
    }

    btn.addEventListener('click', () => {
        void openContextDialog();
    });

    async function openContextDialog() {
        const cid = getConversationId();
        if (!Number.isFinite(cid) || cid < 1) return;

        let data;
        try {
            data = await fetchContextUsage(chatApiBase, cid, getChatEndpointId());
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

    globalThis.__oaaoRefreshChatContextUsage = () => {
        void refreshRing();
    };
    globalThis.__oaaoStartChatContextUsagePoll = startPoll;
    globalThis.__oaaoStopChatContextUsagePoll = stopPoll;

    document.addEventListener('oaao-conversation-opened', () => {
        void refreshRing();
    });

    if (getConversationId() > 0) {
        startPoll();
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
