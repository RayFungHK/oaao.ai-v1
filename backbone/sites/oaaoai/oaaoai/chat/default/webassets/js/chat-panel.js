/**
 * Chat module workspace shell — mounted by core {@see workspace.js} via dynamic import.
 * Conversation list renders into core {@code #workspace-conversation-list}; shell fires {@code oaao-chat-new}.
 */

/** Align with auth SPA paths when the app lives under a subdirectory (same cookie path as `/auth/me`). */
function chatApiBase() {
    const authBase = (typeof document !== 'undefined' && document.body?.dataset?.authBase || '').trim();
    if (authBase) {
        try {
            const u = new URL(authBase, window.location.href);
            let rootPath = u.pathname.replace(/\/?$/, '');
            rootPath = rootPath.replace(/\/auth$/i, '') || '/';
            if (!rootPath.endsWith('/')) rootPath += '/';

            return `${rootPath}chat/api/`;
        } catch {
            /* fall through */
        }
    }

    return '/chat/api/';
}

/** Root-relative chat shell stylesheet ({@code mountShellPanel}). Mirrors {@code document.body.dataset.oaaoMountPrefix}. */
function ensureChatShellCss() {
    if (typeof document === 'undefined') return;
    if (document.querySelector('link[data-oaao-chat-shell-css="1"]')) return;
    const raw = (document.body?.dataset?.oaaoMountPrefix ?? '').trim();
    let prefix = '';
    if (raw && raw !== '/') {
        prefix = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/{2,}/g, '/').replace(/\/$/, '');
    }
    const pathOnly = '/webassets/chat/default/css/oaao-chat-shell.css';
    const href =
        prefix && !(pathOnly === prefix || pathOnly.startsWith(`${prefix}/`)) ? `${prefix}${pathOnly}` : pathOnly;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.crossOrigin = 'anonymous';
    link.dataset.oaaoChatShellCss = '1';
    document.head.append(link);
}


/** @returns {number | null} positive profile id, or null to let the server pick the default binding */
function getWorkspaceChatEndpointIdForSend() {
    const tr = document.getElementById('workspace-purpose-selector-trigger');
    const ds =
        typeof tr?.dataset?.routingChatEndpointId === 'string' ? tr.dataset.routingChatEndpointId.trim() : '';
    const fromUi = ds !== '' ? Number(ds) : NaN;
    if (Number.isFinite(fromUi) && fromUi > 0) {
        return Math.floor(fromUi);
    }
    try {
        const raw = (localStorage.getItem(CHAT_PROFILE_STORAGE_KEY) || '').trim();
        const v = Number(raw);

        return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
    } catch {
        return null;
    }
}

function chatApiUrl(action, query = {}) {
    const base = chatApiBase();
    let url = `${base}${action.replace(/^\/+/, '')}`;
    const qs = new URLSearchParams(query);
    const q = qs.toString();
    if (q) url += `?${q}`;
    return url;
}

async function chatFetchJson(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json', ...(options.headers || {}) },
        ...options,
    });
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = {};
    }
    return { res, data };
}

/**
 * Persist streamed assistant body — same-origin chat API (orchestrator SSE may be cross-origin).
 *
 * @param {number} conversationId
 * @param {number} assistantMessageId
 * @param {string} content
 * @param {Record<string, unknown> | null} [meta] Stream run metrics ({@code system/end} payload); stored as {@code meta_json}.
 */
async function patchAssistantContent(conversationId, assistantMessageId, content, meta = null) {
    const body = {
        conversation_id: conversationId,
        assistant_message_id: assistantMessageId,
        content,
    };
    if (meta && typeof meta === 'object') {
        body.meta = meta;
    }
    const { res } = await chatFetchJson(chatApiUrl('assistant_patch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.ok;
}

/**
 * One-line technical summary under an assistant bubble (duration, tok/s, routing endpoint + model).
 *
 * @param {Record<string, unknown>} meta
 */
function formatAssistantRunMetaLine(meta) {
    if (!meta || typeof meta !== 'object') return '';
    const parts = [];
    const dm = Number(meta.duration_ms);
    if (Number.isFinite(dm) && dm >= 0) {
        parts.push(dm >= 1000 ? `${(dm / 1000).toFixed(2)}s` : `${Math.round(dm)}ms`);
    }
    const tps = meta.tokens_per_sec;
    if (typeof tps === 'number' && Number.isFinite(tps)) {
        let t = `${tps} tok/s`;
        if (meta.tokens_estimated === true) t += '*';
        parts.push(t);
    }
    const ep = String(meta.endpoint_ref ?? '').trim();
    const model = String(meta.model ?? '').trim();
    const prof = String(meta.chat_profile ?? '').trim();
    const bits = [ep, model, prof].filter(Boolean);
    const route = bits.join(' · ');
    if (route) parts.push(route);
    return parts.join(' · ');
}

/**
 * @param {HTMLElement} outer
 * @param {Record<string, unknown>} meta
 */
function applyAssistantRunSummaryToRow(outer, meta) {
    if (!outer || !meta || typeof meta !== 'object') return;
    const line = formatAssistantRunMetaLine(meta);
    if (!line) return;
    let el = outer.querySelector('[data-oaao-chat="assistant-summary"]');
    if (!el) {
        el = document.createElement('div');
        el.dataset.oaaoChat = 'assistant-summary';
        el.className =
            'text-[0.7rem] leading-snug fg-[var(--grid-caption)] font-mono tabular-nums mt-0.5 mb-0 px-0 py-0 w-full break-words';
        el.setAttribute('aria-label', 'Response metrics');
        const toolbar = outer.querySelector('.oaao-chat-assistant-toolbar');
        const bubble = outer.querySelector('[data-oaao-msg-role="assistant"]');
        if (toolbar) outer.insertBefore(el, toolbar);
        else if (bubble) bubble.insertAdjacentElement('afterend', el);
        else outer.append(el);
    }
    el.textContent = line;
}

/** Abort only the browser SSE reader — server ``StreamRun`` keeps draining upstream LLM until done or explicit cancel API. */
let streamReaderAbort = null;

function abortStreamReaderOnly() {
    try {
        streamReaderAbort?.abort();
    } catch {
        /* ignore */
    }
    streamReaderAbort = null;
}

function streamCursorKey(conversationId) {
    return `oaao.stream.v1.${conversationId}`;
}

/** @returns {{ stream_url: string, run_id: string, last_seq: number, assistant_message_id?: number } | null} */
function loadStreamCursor(conversationId) {
    if (!conversationId || conversationId < 1) return null;
    try {
        const raw = sessionStorage.getItem(streamCursorKey(conversationId));
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (typeof o.stream_url !== 'string' || typeof o.run_id !== 'string') return null;
        const last_seq = Number(o.last_seq);
        const assistant_message_id = Number(o.assistant_message_id);
        return {
            stream_url: o.stream_url,
            run_id: o.run_id,
            last_seq: Number.isFinite(last_seq) ? last_seq : 0,
            ...(Number.isFinite(assistant_message_id) && assistant_message_id > 0
                ? { assistant_message_id }
                : {}),
        };
    } catch {
        return null;
    }
}

function saveStreamCursor(conversationId, partial) {
    if (!conversationId || conversationId < 1) return;
    const prev = loadStreamCursor(conversationId) || {
        stream_url: '',
        run_id: '',
        last_seq: 0,
    };
    const next = { ...prev, ...partial };
    sessionStorage.setItem(streamCursorKey(conversationId), JSON.stringify(next));
}

function clearStreamCursor(conversationId) {
    if (!conversationId || conversationId < 1) return;
    try {
        sessionStorage.removeItem(streamCursorKey(conversationId));
    } catch {
        /* ignore */
    }
}

/** Format {@code phase=system,kind=error} payloads for the assistant bubble (never echo endpoint URLs — server logs only). */
function formatStreamSystemError(code, payload) {
    if (!payload || typeof payload !== 'object') return code || 'error';
    const o = /** @type {Record<string, unknown>} */ (payload);
    const bits = [];
    const excType = o.exc_type;
    const detail = o.detail;
    const hint = o.hint;
    const body = o.body;
    if (typeof excType === 'string' && excType.trim()) bits.push(excType.trim());
    if (typeof detail === 'string' && detail.trim()) bits.push(detail.trim());
    if (typeof hint === 'string' && hint.trim()) bits.push(hint.trim());
    if (typeof body === 'string' && body.trim()) bits.push(body.trim().slice(0, 600));
    const extra = bits.length ? ` — ${bits.join(' · ')}` : '';
    return `${code || 'error'}${extra}`;
}

function workspacePathPrefix() {
    const p = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix || '').trim();
    if (!p || p === '/') return '';
    return p.replace(/\/?$/, '');
}

async function copyTextToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.append(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
}

function toastOaao(msg) {
    const t = document.createElement('div');
    t.className =
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-3 py-2 rounded-[10px] text-[0.8125rem] bg-[var(--grid-ink)] fg-[#fff] shadow-lg pointer-events-none max-w-[min(90vw,24rem)] text-center';
    t.textContent = msg;
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
}

function escapeHtmlText(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Split markdown into alternating prose vs fenced ``` segments. */
function splitMarkdownFenced(md) {
    /** @type {Array<{ type: 'md' | 'code', body: string }>} */
    const out = [];
    let idx = 0;
    const src = String(md).replace(/\r\n/g, '\n');
    while (idx < src.length) {
        const start = src.indexOf('```', idx);
        if (start === -1) {
            out.push({ type: 'md', body: src.slice(idx) });
            break;
        }
        if (start > idx) {
            out.push({ type: 'md', body: src.slice(idx, start) });
        }
        const nl = src.indexOf('\n', start + 3);
        if (nl === -1) {
            out.push({ type: 'md', body: src.slice(start) });
            break;
        }
        const codeStart = nl + 1;
        const endFence = src.indexOf('```', codeStart);
        if (endFence === -1) {
            out.push({ type: 'md', body: src.slice(start) });
            break;
        }
        out.push({ type: 'code', body: src.slice(codeStart, endFence) });
        idx = endFence + 3;
    }

    return out;
}

function inlineMdSegment(raw) {
    const parts = String(raw).split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(\s*https?:\/\/[^\s)]+\s*\))/g);

    return parts
        .map((part) => {
            if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
                return `<strong>${escapeHtmlText(part.slice(2, -2))}</strong>`;
            }
            if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
                return `<code class="font-mono text-[0.85em] px-1 py-0.5 rounded-[4px] bg-[var(--grid-line)]/30">${escapeHtmlText(part.slice(1, -1))}</code>`;
            }
            const lm = part.match(/^\[([^\]]+)\]\(\s*(https?:\/\/[^\s)]+)\s*\)$/);
            if (lm) {
                const href = escapeHtmlText(lm[2]);
                const label = escapeHtmlText(lm[1]);

                return `<a href="${href}" class="underline fg-[var(--grid-ink)] decoration-[var(--grid-line)]" target="_blank" rel="noopener noreferrer">${label}</a>`;
            }

            return escapeHtmlText(part);
        })
        .join('');
}

function renderMarkdownBlocks(mdBody) {
    const s = mdBody.trim();
    if (!s) return '';
    const paras = s.split(/\n\n+/);

    return paras
        .map((para) => {
            const lines = para.split('\n');
            const bulletLines = lines.filter((ln) => ln.trim() !== '');
            const allBullets =
                bulletLines.length > 0 &&
                bulletLines.every((ln) => /^[-*]\s+/.test(ln.trim()));
            if (allBullets) {
                const items = bulletLines
                    .map((ln) => ln.trim().replace(/^[-*]\s+/, ''))
                    .map((txt) => `<li>${inlineMdSegment(txt)}</li>`)
                    .join('');

                return `<ul class="list-disc pl-5 mb-2 space-y-1">${items}</ul>`;
            }
            const hn = lines[0]?.trim().match(/^(#{1,6})\s+(.*)$/);
            if (hn && lines.length === 1) {
                const level = hn[1].length;

                return `<h${level} class="fw-semibold mb-2 text-[0.95em]">${inlineMdSegment(hn[2])}</h${level}>`;
            }

            return `<p class="mb-2 leading-relaxed">${lines.map((ln) => inlineMdSegment(ln)).join('<br>\n')}</p>`;
        })
        .join('');
}

function fencedCodeBodyToHtml(codeBody) {
    return `<pre class="overflow-x-auto rounded-[8px] px-3 py-2 mb-2 text-[0.8125rem] bg-[var(--grid-line)]/12 border-[1px] border-solid border-[var(--grid-line)]"><code class="font-mono whitespace-pre">${escapeHtmlText(codeBody)}</code></pre>`;
}

/** Assistant markdown → safe HTML (no raw HTML passthrough from the model). */
function markdownToSafeHtml(md) {
    const chunks = splitMarkdownFenced(md);

    return chunks
        .map((ch) => {
            if (ch.type === 'code') {
                return fencedCodeBodyToHtml(ch.body);
            }

            return renderMarkdownBlocks(ch.body);
        })
        .join('');
}

/**
 * Append md paragraph tokens for one prose region (already fence-complete).
 *
 * @param {Array<{ kind: 'code' | 'md', raw: string }>} out
 * @param {string} md
 */
function pushMdParagraphTokens(out, md) {
    const s = String(md).replace(/\r\n/g, '\n');
    if (!s.trim()) return;
    const paras = s.split(/\n\n+/);
    for (const p of paras) {
        if (!p.trim()) continue;
        out.push({ kind: 'md', raw: p });
    }
}

/**
 * Immutable units for incremental HTML: closed fences + ``\n\n``-bounded prose blocks (lists stay single-token).
 *
 * @returns {Array<{ kind: 'code' | 'md', raw: string }>}
 */
function tokenizeStableStreamChunks(stable) {
    const text = String(stable).replace(/\r\n/g, '\n');
    /** @type {Array<{ kind: 'code' | 'md', raw: string }>} */
    const out = [];
    let i = 0;

    while (i < text.length) {
        const open = text.indexOf('```', i);
        if (open === -1) {
            pushMdParagraphTokens(out, text.slice(i));
            break;
        }
        if (open > i) {
            pushMdParagraphTokens(out, text.slice(i, open));
        }
        const nl = text.indexOf('\n', open + 3);
        if (nl === -1) {
            break;
        }
        const innerStart = nl + 1;
        const close = text.indexOf('```', innerStart);
        if (close === -1) {
            break;
        }
        out.push({ kind: 'code', raw: text.slice(innerStart, close) });
        i = close + 3;
    }

    return out;
}

/**
 * Peel trailing prose that might change meaning when more tokens arrive (half-open `` ` ``, ``**``, links).
 * Kept out of markdown parsing — rendered as escaped plain text with ``pre-wrap``.
 *
 * @returns {{ prefixStable: string, tail: string }}
 */
function peelMarkdownUnstableSuffix(prose) {
    const p = String(prose).replace(/\r\n/g, '\n');
    if (!p) {
        return { prefixStable: '', tail: '' };
    }

    const MAX_TAIL = 800;
    let peelStart = p.length;
    const lines = p.split('\n');
    const lastLine = lines[lines.length - 1] ?? '';

    const btCount = (lastLine.match(/`/g) ?? []).length;
    if (btCount % 2 === 1) {
        const ix = p.lastIndexOf('`');
        if (ix !== -1) peelStart = Math.min(peelStart, ix);
    }

    const boldStars = (lastLine.match(/\*\*/g) ?? []).length;
    if (boldStars % 2 === 1) {
        const ix = p.lastIndexOf('**');
        if (ix !== -1) peelStart = Math.min(peelStart, ix);
    }

    const lb = lastLine.lastIndexOf('[');
    if (lb !== -1) {
        const frag = lastLine.slice(lb);
        if (/^\[[^\]\n]*$/.test(frag) || /^\[[^\]]+\]\([^)\n]*$/.test(frag)) {
            peelStart = Math.min(peelStart, p.length - lastLine.length + lb);
        }
    }

    if (/^#{1,6}\s*$/.test(lastLine)) {
        peelStart = Math.min(peelStart, Math.max(0, p.length - lastLine.length));
    }

    const trimmedLast = lastLine.trim();
    if (trimmedLast === '-' || trimmedLast === '*' || trimmedLast === '- ' || trimmedLast === '* ') {
        peelStart = Math.min(peelStart, Math.max(0, p.length - lastLine.length));
    }

    if (/^\d+\.\s*$/.test(trimmedLast)) {
        peelStart = Math.min(peelStart, Math.max(0, p.length - lastLine.length));
    }

    peelStart = Math.max(0, Math.min(peelStart, p.length));
    if (p.length - peelStart > MAX_TAIL) {
        peelStart = p.length - MAX_TAIL;
    }

    return {
        prefixStable: p.slice(0, peelStart),
        tail: p.slice(peelStart),
    };
}

/**
 * Completed fenced blocks + markdown-stable prose prefix; remainder is raw tail (unfinished fence or unstable suffix).
 *
 * @returns {{ stable: string, tail: string }}
 */
function streamingMarkdownStableTail(full) {
    const text = String(full).replace(/\r\n/g, '\n');
    let stable = '';
    let i = 0;

    while (i < text.length) {
        const open = text.indexOf('```', i);
        if (open === -1) {
            const peeled = peelMarkdownUnstableSuffix(text.slice(i));

            return { stable: stable + peeled.prefixStable, tail: peeled.tail };
        }
        if (open > i) {
            const mdChunk = text.slice(i, open);
            const peeled = peelMarkdownUnstableSuffix(mdChunk);
            stable += peeled.prefixStable;
            if (peeled.tail !== '') {
                return { stable, tail: peeled.tail + text.slice(open) };
            }
            i = open;
            continue;
        }
        const nl = text.indexOf('\n', i + 3);
        if (nl === -1) {
            return { stable, tail: text.slice(i) };
        }
        const innerStart = nl + 1;
        const close = text.indexOf('```', innerStart);
        if (close === -1) {
            return { stable, tail: text.slice(i) };
        }
        stable += text.slice(i, close + 3);
        i = close + 3;
    }

    return { stable, tail: '' };
}

/**
 * Incremental stream renderer: token-diff across stable prefix — closed code fences + ``\n\n`` paragraphs
 * reuse cached HTML; only reparses from the first changed token onward.
 */
function createStreamingMarkdownView() {
    /** @type {Array<{ kind: 'code' | 'md', raw: string }>} */
    let prevTok = [];
    /** @type {string[]} */
    let prevHtml = [];

    return {
        reset() {
            prevTok = [];
            prevHtml = [];
        },
        html(acc) {
            const { stable, tail } = streamingMarkdownStableTail(acc);
            const tokens = tokenizeStableStreamChunks(stable);

            if (tokens.length < prevTok.length) {
                prevTok = [];
                prevHtml = [];
            }

            /** @type {string[]} */
            const htmlParts = [];
            let diverged = false;

            for (let i = 0; i < tokens.length; i++) {
                const t = tokens[i];
                const reuse =
                    !diverged && prevTok[i] && prevTok[i].kind === t.kind && prevTok[i].raw === t.raw;

                if (reuse) {
                    htmlParts.push(prevHtml[i]);
                } else {
                    diverged = true;
                    htmlParts.push(t.kind === 'code' ? fencedCodeBodyToHtml(t.raw) : renderMarkdownBlocks(t.raw));
                }
            }

            prevTok = tokens;
            prevHtml = htmlParts;

            const body = htmlParts.join('');
            const tailHtml =
                tail === ''
                    ? ''
                    : `<span class="oaao-stream-md-tail whitespace-pre-wrap break-words">${escapeHtmlText(tail)}</span>`;

            return `${body}${tailHtml}`;
        },
    };
}

/** Normalize streamed envelope ``text`` (string or accidental JSON shapes). */
function streamEnvelopeText(data) {
    if (!data || typeof data !== 'object') return '';
    const t = /** @type {Record<string, unknown>} */ (data).text;
    if (typeof t === 'string') return t;
    if (Array.isArray(t)) {
        return t.filter((x) => typeof x === 'string').join('');
    }

    return '';
}

/** @returns {number | null} */
function coercePositiveInt(v) {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : Number.parseInt(String(v ?? '').trim(), 10);

    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Incremental SSE parser — supports ``id:`` lines for resume seq.
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {(ev: { seq: number, eventName: string, data: Record<string, unknown> }) => void} onEvent
 */
async function readSseStream(reader, onEvent) {
    const dec = new TextDecoder();
    let buf = '';
    let carrySeq = 0;

    const dispatchFrame = (chunkText) => {
        const lines = chunkText.split('\n');
        let idLine = 0;
        let eventName = 'message';
        const dataLines = [];
        for (const line of lines) {
            if (line.startsWith('id:')) {
                idLine = Number.parseInt(line.slice(3).trim(), 10);
                if (!Number.isFinite(idLine)) idLine = carrySeq;
            } else if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const dataStr = dataLines.join('\n');
        /** @type {Record<string, unknown>} */
        let data = {};
        try {
            data = dataStr ? JSON.parse(dataStr) : {};
        } catch {
            data = { raw: dataStr };
        }
        const seq = idLine > 0 ? idLine : carrySeq + 1;
        carrySeq = seq;
        onEvent({ seq, eventName, data });
    };

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec
            .decode(value, { stream: true })
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
        let sep;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            dispatchFrame(chunk);
        }
    }
    const tail = buf.trim();
    if (tail) dispatchFrame(tail);
}

/** SVG namespace — DOM-built icons match rail ({@code workspace.tpl}) and avoid icon-font / {@code innerHTML} pitfalls in the chat shell. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} pixelCls  JIT size tokens e.g. {@code w-4 h-4}
 */
function oaaoChatStrokeSvgShell(pixelCls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `rz-icon block shrink-0 pointer-events-none ${pixelCls}`.trim());
    return svg;
}

/** @type {AbortController | null} */
let panelAbort = null;

/** @type {Array<{ id: number, title?: string, archived?: number }>} */
let cachedConversations = [];

let showArchivedConversations = false;

/** @type {number | null} */
let activeConversationId = null;

export function teardownShellPanel() {
    abortStreamReaderOnly();
    panelAbort?.abort();
    panelAbort = null;
    activeConversationId = null;
    cachedConversations = [];
    showArchivedConversations = false;
    const archivedCb = document.getElementById('workspace-chat-show-archived');
    if (archivedCb instanceof HTMLInputElement) {
        archivedCb.checked = false;
    }
    const host = document.getElementById('workspace-conversation-list');
    if (host) host.textContent = '';
}

/**
 * @param {HTMLElement} mount Host from core ({@code #workspace-module-mount}) containing injected panel HTML.
 */
export async function mountShellPanel(mount) {
    ensureChatShellCss();
    teardownShellPanel();
    panelAbort = new AbortController();
    const { signal } = panelAbort;

    const whenEmptyEl = mount.querySelector('[data-oaao-chat="when-empty"]');
    const promptGridEl = mount.querySelector('[data-oaao-chat="prompt-grid"]');
    const composerRegionEl = mount.querySelector('[data-oaao-chat="composer-region"]');
    const threadWrapEl = mount.querySelector('[data-oaao-chat="thread-wrap"]');
    const activityEl = mount.querySelector('[data-oaao-chat="activity"]');
    const messagesEl = mount.querySelector('[data-oaao-chat="messages"]');
    const formEl = mount.querySelector('[data-oaao-chat="composer"]');
    const inputEl = mount.querySelector('[data-oaao-chat="input"]');
    const sendBtn = mount.querySelector('[data-oaao-chat="send"]');
    const threadToolbarEl = mount.querySelector('[data-oaao-chat="thread-toolbar"]');
    const shareThreadBtn = mount.querySelector('[data-oaao-chat="share-thread"]');
    const archiveThreadBtn = mount.querySelector('[data-oaao-chat="archive-thread"]');
    const deleteThreadBtn = mount.querySelector('[data-oaao-chat="delete-thread"]');

    if (!messagesEl || !formEl || !inputEl || !sendBtn) {
        return;
    }

    /** Distance from bottom (px) still treated as “following” new tokens / append. */
    const MESSAGES_BOTTOM_SLACK_PX = 80;

    /**
     * @param {HTMLElement} el
     */
    function messagesPinnedToBottom(el) {
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight;

        return gap <= MESSAGES_BOTTOM_SLACK_PX;
    }

    /**
     * @param {HTMLElement} el
     */
    function messagesScrollToBottom(el) {
        el.scrollTop = el.scrollHeight;
    }

    function syncThreadToolbarStates() {
        const open = activeConversationId !== null && activeConversationId > 0;
        if (threadToolbarEl) threadToolbarEl.classList.toggle('hidden', !open);
        if (!open || !archiveThreadBtn) return;
        const row = cachedConversations.find((r) => Number(r.id) === activeConversationId);
        const archived = row ? Number(row.archived) === 1 : false;
        const label = archived ? 'Unarchive chat' : 'Archive chat';
        archiveThreadBtn.setAttribute('aria-label', label);
        archiveThreadBtn.title = label;
    }

    async function postMessageFeedback(conversationId, messageId, feedbackLike) {
        await chatFetchJson(chatApiUrl('message_feedback'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversation_id: conversationId,
                message_id: messageId,
                feedback: feedbackLike ? 'like' : '',
            }),
        });
    }

    /**
     * @param {Array<{ role?: string, content?: string }>} rows
     * @param {number} assistantIndex
     */
    function findPrevUserPrompt(rows, assistantIndex) {
        for (let j = assistantIndex - 1; j >= 0; j--) {
            const r = rows[j];
            if (r && String(r.role ?? '').toLowerCase() === 'user') {
                return String(r.content ?? '').trim();
            }
        }

        return '';
    }

    function formatPromptReplySnippet(prompt, reply) {
        const p = prompt.trim();
        const r = reply.trim();
        if (p && r) return `--- Prompt ---\n${p}\n--- Reply ---\n${r}`;
        if (r) return r;
        return p;
    }

    async function tryResolveShareFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const slug = (params.get('share') ?? '').trim();
        if (!slug) return;
        const { res, data } = await chatFetchJson(chatApiUrl('resolve_share', { slug }));
        if (!res.ok || !data.success || !data.conversation_id) {
            toastOaao(data.message || 'Invalid or expired share link');

            return;
        }
        activeConversationId = Number(data.conversation_id);
        params.delete('share');
        const qs = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    }

    function clearActivityLog() {
        if (activityEl) activityEl.textContent = '';
    }

    function showActivityLog() {
        activityEl?.classList.remove('hidden');
    }

    function hideActivityLog() {
        activityEl?.classList.add('hidden');
    }

    function appendActivityLine(text) {
        if (!activityEl) return;
        const line = document.createElement('div');
        line.textContent = text;
        activityEl.append(line);
        activityEl.scrollTop = activityEl.scrollHeight;
    }

    /**
     * @param {string} streamUrl
     * @param {string} runId
     * @param {number} conversationId
     * @param {number} sinceSeq
     * @param {number | null} assistantMessageId
     */
    async function consumeAssistantStream(streamUrl, runId, conversationId, sinceSeq, assistantMessageId) {
        abortStreamReaderOnly();
        streamReaderAbort = new AbortController();
        const { signal } = streamReaderAbort;

        clearActivityLog();
        hideActivityLog();

        const u = new URL(streamUrl, window.location.href);
        u.searchParams.set('run_id', runId);
        if (sinceSeq > 0) u.searchParams.set('since_seq', String(sinceSeq));

        const streamOrigin = u.origin;
        const sameOrigin = streamOrigin === window.location.origin;

        let streamingMsgId = coercePositiveInt(assistantMessageId);
        const msgsHost = mount.querySelector('[data-oaao-chat="messages"]') ?? messagesEl;
        if ((!streamingMsgId || streamingMsgId < 1) && msgsHost) {
            const nodes = msgsHost.querySelectorAll('[data-oaao-msg-role="assistant"][data-oaao-msg-id]');
            const lastEl = nodes[nodes.length - 1];
            streamingMsgId = lastEl ? coercePositiveInt(lastEl.getAttribute('data-oaao-msg-id')) : null;
        }

        let acc = '';
        /** @type {Record<string, unknown> | null} */
        let runMeta = null;
        /** @type {string[]} */
        const systemErrors = [];
        let sawSseFrame = false;
        /** @type {ReturnType<typeof setTimeout> | null} */
        let flushTimer = null;

        const mdStream = createStreamingMarkdownView();
        /** @type {number} */
        let mdBubbleRaf = 0;

        function flushMdBubbleNow() {
            if (mdBubbleRaf) {
                cancelAnimationFrame(mdBubbleRaf);
                mdBubbleRaf = 0;
            }
            const bubble = msgsHost?.querySelector(`[data-oaao-msg-id="${streamingMsgId}"]`);
            if (!bubble || acc === '') return;
            bubble.classList.add('oaao-md-bubble');
            bubble.style.whiteSpace = '';
            bubble.innerHTML = mdStream.html(acc);
        }

        function queueMdBubbleRender() {
            if (mdBubbleRaf) return;
            mdBubbleRaf = requestAnimationFrame(() => {
                mdBubbleRaf = 0;
                const pin = messagesPinnedToBottom(messagesEl);
                flushMdBubbleNow();
                if (pin) messagesScrollToBottom(messagesEl);
            });
        }

        const flushAssistant = async (metaForPatch = null) => {
            if (!streamingMsgId || streamingMsgId < 1) return;
            await patchAssistantContent(conversationId, streamingMsgId, acc, metaForPatch);
        };

        const scheduleFlush = () => {
            if (!streamingMsgId || streamingMsgId < 1) return;
            if (flushTimer) return;
            flushTimer = setTimeout(async () => {
                flushTimer = null;
                await flushAssistant();
            }, 220);
        };

        try {
            const res = await fetch(u.href, {
                method: 'GET',
                mode: 'cors',
                credentials: sameOrigin ? 'include' : 'omit',
                signal,
                headers: { Accept: 'text/event-stream' },
            });
            if (!res.ok || !res.body) {
                hideActivityLog();
                clearStreamCursor(conversationId);
                let detail = '';
                try {
                    detail = (await res.clone().text()).trim().slice(0, 320);
                } catch {
                    detail = '';
                }
                const line = document.createElement('p');
                line.className = 'text-sm fg-red-6 self-start max-w-[min(720px,100%)]';
                line.textContent =
                    res.status === 403
                        ? 'Stream rejected (403). Tokens live only in orchestrator memory — rebuild/restart clears them; send again.'
                        : `Could not open assistant stream (HTTP ${res.status}).${detail ? ` ${detail}` : ''}`;
                const pinErr = messagesPinnedToBottom(messagesEl);
                messagesEl.append(line);
                if (pinErr) messagesScrollToBottom(messagesEl);

                return;
            }
            const reader = res.body.getReader();
            await readSseStream(reader, ({ seq, eventName, data }) => {
                sawSseFrame = true;
                saveStreamCursor(conversationId, {
                    stream_url: streamUrl,
                    run_id: runId,
                    last_seq: seq,
                    ...(streamingMsgId && streamingMsgId > 0 ? { assistant_message_id: streamingMsgId } : {}),
                });
                if (eventName === 'oaao.stream' && data && typeof data === 'object') {
                    const phase =
                        typeof data.phase === 'string' ? data.phase.toLowerCase() : String(data.phase ?? '?').toLowerCase();
                    const kind =
                        typeof data.kind === 'string' ? data.kind.toLowerCase() : String(data.kind ?? '').toLowerCase();
                    const text = streamEnvelopeText(data);
                    if (phase === 'system' && kind === 'error') {
                        showActivityLog();
                        appendActivityLine(`[${phase}] ${kind}${text ? ` — ${text}` : ''}`);
                        systemErrors.push(formatStreamSystemError(text, data.payload));
                    }
                    if (
                        streamingMsgId &&
                        streamingMsgId > 0 &&
                        phase === 'llm' &&
                        kind === 'delta' &&
                        text !== ''
                    ) {
                        acc += text;
                        queueMdBubbleRender();
                        scheduleFlush();
                    }
                }
                if (data && typeof data === 'object') {
                    const phaseEnd =
                        typeof data.phase === 'string'
                            ? data.phase.toLowerCase()
                            : String(data.phase ?? '').toLowerCase();
                    const kindEnd =
                        typeof data.kind === 'string' ? data.kind.toLowerCase() : String(data.kind ?? '').toLowerCase();
                    if (phaseEnd === 'system' && kindEnd === 'end') {
                        const p = data.payload;
                        if (p && typeof p === 'object') {
                            runMeta = { .../** @type {Record<string, unknown>} */ (p) };
                        }
                        clearStreamCursor(conversationId);
                        hideActivityLog();
                        if (flushTimer) {
                            clearTimeout(flushTimer);
                            flushTimer = null;
                        }
                    }
                }
            });

            if (!sawSseFrame) {
                clearStreamCursor(conversationId);
                const note = document.createElement('p');
                note.className = 'text-sm fg-[var(--grid-ink-muted)] self-start max-w-[min(720px,100%)]';
                note.textContent =
                    'Stream closed without events (often a stale resume after the run already finished). Send again if the reply is missing.';
                const pinNote = messagesPinnedToBottom(messagesEl);
                messagesEl.append(note);
                if (pinNote) messagesScrollToBottom(messagesEl);
            }
        } catch (err) {
            if (/** @type {{ name?: string }} */ (err)?.name !== 'AbortError') {
                clearStreamCursor(conversationId);
                appendActivityLine(`(stream error) ${/** @type {Error} */ (err)?.message || String(err)}`);
                const line = document.createElement('p');
                line.className = 'text-sm fg-red-6 self-start max-w-[min(720px,100%)]';
                line.textContent = `(stream error) ${/** @type {Error} */ (err)?.message || String(err)}`;
                const pinSe = messagesPinnedToBottom(messagesEl);
                messagesEl.append(line);
                if (pinSe) messagesScrollToBottom(messagesEl);
            }
        } finally {
            abortStreamReaderOnly();
            const pinFlush = messagesPinnedToBottom(messagesEl);
            flushMdBubbleNow();
            if (pinFlush) messagesScrollToBottom(messagesEl);
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            if (
                streamingMsgId &&
                streamingMsgId > 0 &&
                acc === '' &&
                systemErrors.length > 0
            ) {
                acc = systemErrors.join('\n');
                const bubble = msgsHost?.querySelector(`[data-oaao-msg-id="${streamingMsgId}"]`);
                if (bubble) {
                    bubble.classList.remove('oaao-md-bubble');
                    bubble.style.whiteSpace = 'pre-wrap';
                    bubble.textContent = acc;
                }
            }
            await flushAssistant(runMeta);
            await loadMessages(conversationId, 'auto');
        }
    }

    async function resumeStreamIfAny(conversationId) {
        const cur = loadStreamCursor(conversationId);
        if (!cur?.stream_url || !cur.run_id) return;
        await consumeAssistantStream(
            cur.stream_url,
            cur.run_id,
            conversationId,
            cur.last_seq,
            cur.assistant_message_id ?? null,
        );
    }

    function updateChatLayout() {
        const landing = activeConversationId === null;
        /* Native `hidden` keeps landing-only blocks out of layout/a11y tree even when Tailwind `.hidden` is absent from compiled CSS. */
        if (whenEmptyEl) {
            whenEmptyEl.hidden = !landing;
            whenEmptyEl.classList.toggle('hidden', !landing);
        }
        if (promptGridEl) {
            promptGridEl.hidden = !landing;
            promptGridEl.classList.toggle('hidden', !landing);
        }
        if (threadWrapEl) {
            threadWrapEl.hidden = landing;
            threadWrapEl.classList.toggle('hidden', landing);
        }

        if (composerRegionEl) {
            /* Landing: hero + chips stretch; thread: composer docks under messages without hiding the textarea ({@code workspace_panel.tpl}). */
            composerRegionEl.classList.toggle('flex-1', landing);
            composerRegionEl.classList.toggle('shrink-0', !landing);
            composerRegionEl.classList.toggle('border-t-[1px]', !landing);
            composerRegionEl.classList.toggle('border-solid', !landing);
            composerRegionEl.classList.toggle('border-[var(--grid-line)]', !landing);
            composerRegionEl.classList.toggle('bg-[var(--grid-panel-bright)]', !landing);
            composerRegionEl.classList.toggle('relative', !landing);
            composerRegionEl.classList.toggle('z-[1]', !landing);
            composerRegionEl.classList.toggle('pt-md', !landing);
            composerRegionEl.classList.toggle('pb-md', !landing);
        }
        syncThreadToolbarStates();
    }

    function renderSidebar() {
        const host = document.getElementById('workspace-conversation-list');
        if (!host) return;
        host.textContent = '';
        if (!Array.isArray(cachedConversations) || cachedConversations.length === 0) {
            const p = document.createElement('p');
            p.className =
                'flex-none shrink-0 px-md py-sm text-[0.75rem] fg-[var(--grid-caption)] leading-snug self-stretch';
            p.textContent = 'No chats yet — send a message below.';
            host.append(p);

            return;
        }

        /**
         * @param {string} tip
         * @param {'archive' | 'delete'} kind
         * @param {(ev: MouseEvent) => void} fn
         */
        function sidebarIconBtn(tip, kind, fn) {
            const b = document.createElement('button');
            b.type = 'button';
            b.title = tip;
            b.setAttribute('aria-label', tip);
            b.className =
                kind === 'delete'
                    ? 'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-[8px] border-none bg-transparent cursor-pointer text-[var(--grid-caption)] hover:bg-[var(--grid-line)]/45 hover:text-red-600 transition-colors font-inherit'
                    : 'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-[8px] border-none bg-transparent cursor-pointer text-[var(--grid-caption)] hover:bg-[var(--grid-line)]/45 hover:text-[var(--grid-ink)] transition-colors font-inherit';

            const svg = oaaoChatStrokeSvgShell('w-4 h-4');
            if (kind === 'archive') {
                const rect = document.createElementNS(SVG_NS, 'rect');
                rect.setAttribute('width', '20');
                rect.setAttribute('height', '5');
                rect.setAttribute('x', '2');
                rect.setAttribute('y', '3');
                rect.setAttribute('rx', '1');
                const p1 = document.createElementNS(SVG_NS, 'path');
                p1.setAttribute('d', 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8');
                const p2 = document.createElementNS(SVG_NS, 'path');
                p2.setAttribute('d', 'M10 12h4');
                svg.append(rect, p1, p2);
            } else {
                const p1 = document.createElementNS(SVG_NS, 'path');
                p1.setAttribute('d', 'M3 6h18');
                const p2 = document.createElementNS(SVG_NS, 'path');
                p2.setAttribute('d', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6');
                const p3 = document.createElementNS(SVG_NS, 'path');
                p3.setAttribute('d', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2');
                const l1 = document.createElementNS(SVG_NS, 'line');
                l1.setAttribute('x1', '10');
                l1.setAttribute('x2', '10');
                l1.setAttribute('y1', '11');
                l1.setAttribute('y2', '17');
                const l2 = document.createElementNS(SVG_NS, 'line');
                l2.setAttribute('x1', '14');
                l2.setAttribute('x2', '14');
                l2.setAttribute('y1', '11');
                l2.setAttribute('y2', '17');
                svg.append(p1, p2, p3, l1, l2);
            }
            b.append(svg);

            b.addEventListener(
                'click',
                (ev) => {
                    ev.stopPropagation();
                    fn(ev);
                },
                { signal },
            );

            return b;
        }

        for (const row of cachedConversations) {
            const id = Number(row.id);
            if (!Number.isFinite(id) || id < 1) continue;

            const wrap = document.createElement('div');
            wrap.className =
                'oaao-chat-convo-row flex items-stretch gap-1 rounded-[10px] min-h-0 w-full max-w-full self-stretch hover:bg-[var(--grid-line)]/15';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.conversationId = String(id);
            const active = id === activeConversationId;
            const archivedRow = Number(row.archived) === 1;
            btn.className = [
                'inline-flex flex-1 min-h-0 min-w-0 max-h-none box-border text-left rounded-[8px] px-2 py-2 text-[0.8125rem] leading-snug fg-[var(--grid-ink)]',
                'border-none bg-transparent cursor-pointer font-inherit truncate transition-colors',
                active ? 'bg-[var(--grid-line)]/45 fw-semibold' : '',
            ].join(' ');
            btn.textContent = archivedRow ? `${row.title || `Chat ${id}`} · archived` : row.title || `Conversation ${id}`;
            btn.addEventListener(
                'click',
                async () => {
                    activeConversationId = id > 0 ? id : null;
                    renderSidebar();
                    await loadMessages(activeConversationId, 'bottom');
                    await resumeStreamIfAny(activeConversationId);
                    updateChatLayout();
                },
                { signal },
            );

            const acts = document.createElement('div');
            acts.className =
                'oaao-chat-convo-actions flex flex-row items-center gap-0.5 shrink-0 pr-0.5';

            acts.append(
                sidebarIconBtn(archivedRow ? 'Unarchive chat' : 'Archive chat', 'archive', async () => {
                    const next = !archivedRow;
                    await chatFetchJson(chatApiUrl('conversation_archive'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ conversation_id: id, archived: next }),
                    });
                    if (!showArchivedConversations && next && activeConversationId === id) {
                        activeConversationId = null;
                    }
                    await refreshConversations(activeConversationId);
                    await loadMessages(activeConversationId, 'auto');
                    updateChatLayout();
                }),
                sidebarIconBtn('Delete chat', 'delete', async () => {
                    if (!confirm('Delete this chat and all messages?')) return;
                    await chatFetchJson(chatApiUrl('conversation_delete'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ conversation_id: id }),
                    });
                    if (activeConversationId === id) {
                        activeConversationId = null;
                    }
                    await refreshConversations(activeConversationId);
                    await loadMessages(activeConversationId, 'auto');
                    updateChatLayout();
                }),
            );

            wrap.append(btn, acts);
            host.append(wrap);
        }
    }

    async function refreshConversations(preferredId = null) {
        const q = showArchivedConversations ? { include_archived: '1' } : {};
        const { res, data } = await chatFetchJson(chatApiUrl('conversations', q));
        cachedConversations = [];
        if (res.ok && data.success && Array.isArray(data.conversations)) {
            cachedConversations = data.conversations;
        }
        if (preferredId != null && preferredId > 0) {
            activeConversationId = preferredId;
        }
        renderSidebar();
        syncThreadToolbarStates();
    }

    /**
     * @param {Array<{ id?: number, role?: string, content?: string, feedback?: string }>} rows
     * @param {'auto' | 'bottom'} scrollMode
     */
    function renderMessages(rows, scrollMode = 'auto') {
        const cid = activeConversationId;
        const pinnedBefore =
            scrollMode === 'auto' && cid != null && cid > 0 ? messagesPinnedToBottom(messagesEl) : false;
        messagesEl.textContent = '';
        if (!cid || cid < 1) {
            const hint = document.createElement('p');
            hint.className = 'text-sm fg-[var(--grid-ink-muted)]';
            hint.textContent = 'Select or start a conversation.';
            messagesEl.append(hint);

            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) {
            const hint = document.createElement('p');
            hint.className = 'text-sm fg-[var(--grid-ink-muted)]';
            hint.textContent = 'No messages yet — send something below.';
            messagesEl.append(hint);
            messagesEl.scrollTop = 0;

            return;
        }

        /**
         * @param {string} label
         * @param {string} tip
         * @param {() => void | Promise<void>} fn
         */
        function msgToolbarBtn(label, tip, fn) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.title = tip;
            b.className =
                'text-[0.65rem] px-1.5 py-0.5 rounded-[6px] border-none bg-[var(--grid-line)]/25 hover:bg-[var(--grid-line)]/45 cursor-pointer font-inherit fg-[var(--grid-caption)] shrink-0';

            b.addEventListener(
                'click',
                () => {
                    void Promise.resolve(fn()).catch(() => {});
                },
                { signal },
            );

            return b;
        }

        /**
         * @param {string} ariaLabel
         * @param {() => void | Promise<void>} fn
         */
        function msgIconActionBtn(ariaLabel, fn) {
            const b = document.createElement('button');
            b.type = 'button';
            b.title = ariaLabel;
            b.setAttribute('aria-label', ariaLabel);
            b.className =
                'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-[8px] border-none bg-transparent cursor-pointer text-[var(--grid-caption)] hover:bg-[var(--grid-line)]/35 hover:text-[var(--grid-ink)] transition-colors font-inherit';

            const svg = oaaoChatStrokeSvgShell('w-4 h-4');
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('width', '14');
            rect.setAttribute('height', '14');
            rect.setAttribute('x', '8');
            rect.setAttribute('y', '8');
            rect.setAttribute('rx', '2');
            rect.setAttribute('ry', '2');
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2');
            svg.append(rect, path);
            b.append(svg);

            b.addEventListener(
                'click',
                () => {
                    void Promise.resolve(fn()).catch(() => {});
                },
                { signal },
            );

            return b;
        }

        rows.forEach((m, i) => {
            const role = String(m.role ?? '').toLowerCase();
            const contentText = String(m.content ?? '');
            const mid = coercePositiveInt(m.id);

            const bubble = document.createElement('div');
            bubble.className =
                role === 'user'
                    ? 'rounded-[12px] px-md py-sm text-[0.875rem] leading-relaxed bg-[var(--grid-panel-bright)] border-[1px] border-solid border-[var(--grid-line)] shadow-[var(--oaao-surface-shadow)] w-full min-w-0 max-w-[min(720px,100%)]'
                    : 'rounded-[12px] px-md py-sm text-[0.875rem] leading-relaxed bg-[#fff] border-[1px] border-solid border-[var(--grid-line)] shadow-[var(--oaao-surface-shadow)] w-full min-w-0';

            if (mid !== null) {
                bubble.dataset.oaaoMsgId = String(mid);
            }
            bubble.dataset.oaaoMsgRole = role;

            if (role === 'assistant') {
                const trimmed = contentText.trim();
                if (trimmed) {
                    bubble.innerHTML = markdownToSafeHtml(contentText);
                    bubble.classList.add('oaao-md-bubble');
                    bubble.style.whiteSpace = '';
                } else {
                    bubble.textContent = '';
                    bubble.classList.remove('oaao-md-bubble');
                    bubble.style.whiteSpace = '';
                }
            } else {
                bubble.classList.remove('oaao-md-bubble');
                bubble.style.whiteSpace = 'pre-wrap';
                bubble.textContent = contentText;
            }

            if (role === 'user') {
                const outer = document.createElement('div');
                outer.className =
                    'oaao-chat-user-msg-row group self-end flex flex-row flex-row-reverse items-center gap-1.5 max-w-full min-w-0';

                const hoverActions = document.createElement('div');
                hoverActions.className =
                    'oaao-chat-user-msg-actions flex flex-row items-center gap-0.5 shrink-0 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto';

                hoverActions.append(
                    msgIconActionBtn('Copy message', async () => {
                        await copyTextToClipboard(contentText.trim());
                        toastOaao('Copied');
                    }),
                );

                outer.append(bubble, hoverActions);
                messagesEl.append(outer);

                return;
            }

            const outer = document.createElement('div');
            outer.className =
                'oaao-chat-assistant-row self-start flex flex-col gap-1 items-start max-w-[min(720px,100%)]';

            const toolbar = document.createElement('div');
            toolbar.className =
                'oaao-chat-assistant-toolbar flex flex-wrap items-center gap-1 justify-start max-w-full';

            toolbar.append(
                msgToolbarBtn('Copy', 'Copy message', async () => {
                    await copyTextToClipboard(contentText.trim());
                    toastOaao('Copied');
                }),
            );

            if (mid !== null) {
                const liked = String(m.feedback ?? '').toLowerCase() === 'like';
                toolbar.append(
                    msgToolbarBtn(liked ? 'Unlike' : 'Like', liked ? 'Remove like' : 'Like reply', async () => {
                        await postMessageFeedback(cid, mid, !liked);
                        await loadMessages(cid, 'auto');
                    }),
                    msgToolbarBtn('Share', 'Copy prompt + reply', async () => {
                        const prompt = findPrevUserPrompt(rows, i);
                        await copyTextToClipboard(formatPromptReplySnippet(prompt, contentText));
                        toastOaao('Prompt + reply copied');
                    }),
                );
            }

            outer.append(bubble);
            const metaRaw = m.meta;
            if (metaRaw && typeof metaRaw === 'object') {
                applyAssistantRunSummaryToRow(outer, /** @type {Record<string, unknown>} */ (metaRaw));
            }
            outer.append(toolbar);
            messagesEl.append(outer);
        });
        if (scrollMode === 'bottom' || (scrollMode === 'auto' && pinnedBefore)) {
            messagesScrollToBottom(messagesEl);
        }
    }

    /**
     * @param {'auto' | 'bottom'} [scrollMode]
     */
    async function loadMessages(conversationId, scrollMode = 'auto') {
        if (!conversationId || conversationId < 1) {
            renderMessages([], scrollMode);

            return;
        }
        const { res, data } = await chatFetchJson(
            chatApiUrl('messages', { conversation_id: String(conversationId) }),
        );
        if (!res.ok || !data.success) {
            renderMessages([], scrollMode);

            return;
        }
        renderMessages(data.messages || [], scrollMode);
    }

    async function resetLanding() {
        activeConversationId = null;
        renderMessages([]);
        await refreshConversations(null);
        updateChatLayout();
    }

    document.addEventListener(
        'oaao-chat-new',
        () => {
            void resetLanding();
        },
        { signal },
    );

    for (const chip of mount.querySelectorAll('[data-oaao-chat="suggestion"]')) {
        chip.addEventListener(
            'click',
            () => {
                const t = (chip.textContent ?? '').trim();
                if (t && inputEl instanceof HTMLTextAreaElement) {
                    inputEl.value = t;
                    inputEl.focus();
                }
            },
            { signal },
        );
    }

    formEl.addEventListener(
        'submit',
        async (e) => {
            e.preventDefault();
            const body = (inputEl.value ?? '').trim();
            if (!body) return;
            sendBtn.disabled = true;
            try {
                const { res, data } = await chatFetchJson(chatApiUrl('send'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        conversation_id: activeConversationId,
                        content: body,
                        chat_endpoint_id: getWorkspaceChatEndpointIdForSend(),
                    }),
                });
                if (!res.ok || !data.success) {
                    const err = document.createElement('p');
                    err.className = 'text-sm fg-red-6';
                    err.textContent = data.message || `Send failed (${res.status}).`;
                    messagesEl.prepend(err);

                    return;
                }
                const cid = Number(data.conversation_id);
                activeConversationId = cid > 0 ? cid : activeConversationId;
                inputEl.value = '';
                await refreshConversations(activeConversationId);
                await loadMessages(activeConversationId, 'bottom');
                const rid = typeof data.run_id === 'string' ? data.run_id.trim() : '';
                const amid = coercePositiveInt(data.assistant_message_id);
                const assistantMid = amid;
                if (su && rid && activeConversationId) {
                    saveStreamCursor(activeConversationId, {
                        stream_url: su,
                        run_id: rid,
                        last_seq: 0,
                        ...(assistantMid ? { assistant_message_id: assistantMid } : {}),
                    });
                    void consumeAssistantStream(su, rid, activeConversationId, 0, assistantMid);
                }
            } finally {
                sendBtn.disabled = false;
            }
        },
        { signal },
    );

    const archivedSidebarCb = document.getElementById('workspace-chat-show-archived');
    if (archivedSidebarCb instanceof HTMLInputElement) {
        archivedSidebarCb.checked = showArchivedConversations;
        archivedSidebarCb.addEventListener(
            'change',
            async () => {
                showArchivedConversations = archivedSidebarCb.checked;
                await refreshConversations(activeConversationId);
                if (activeConversationId != null && activeConversationId > 0) {
                    const listed = cachedConversations.some((r) => Number(r.id) === activeConversationId);
                    if (!listed) {
                        activeConversationId = null;
                        renderSidebar();
                        syncThreadToolbarStates();
                    }
                }
                await loadMessages(activeConversationId, 'auto');
                updateChatLayout();
            },
            { signal },
        );
    }

    shareThreadBtn?.addEventListener(
        'click',
        async () => {
            const cid = activeConversationId;
            if (!cid || cid < 1) return;
            const { res, data } = await chatFetchJson(chatApiUrl('conversation_share'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation_id: cid }),
            });
            if (!res.ok || !data.success || typeof data.share_slug !== 'string' || !data.share_slug.trim()) {
                toastOaao(data.message || 'Could not create share link');

                return;
            }
            const u = new URL(window.location.href);
            u.searchParams.set('share', data.share_slug.trim());
            await copyTextToClipboard(u.toString());
            toastOaao('Share link copied');
        },
        { signal },
    );

    archiveThreadBtn?.addEventListener(
        'click',
        async () => {
            const cid = activeConversationId;
            if (!cid || cid < 1) return;
            const row = cachedConversations.find((r) => Number(r.id) === cid);
            const archivedNow = row ? Number(row.archived) === 1 : false;
            const next = !archivedNow;
            await chatFetchJson(chatApiUrl('conversation_archive'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation_id: cid, archived: next }),
            });
            if (!showArchivedConversations && next) {
                activeConversationId = null;
            }
            await refreshConversations(activeConversationId);
            await loadMessages(activeConversationId, 'auto');
            updateChatLayout();
            toastOaao(next ? 'Archived' : 'Restored');
        },
        { signal },
    );

    deleteThreadBtn?.addEventListener(
        'click',
        async () => {
            const cid = activeConversationId;
            if (!cid || cid < 1) return;
            if (!confirm('Delete this chat and all messages?')) return;
            await chatFetchJson(chatApiUrl('conversation_delete'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation_id: cid }),
            });
            activeConversationId = null;
            await refreshConversations(null);
            await loadMessages(null, 'bottom');
            updateChatLayout();
            toastOaao('Chat deleted');
        },
        { signal },
    );

    await tryResolveShareFromUrl();
    await refreshConversations(activeConversationId);
    await loadMessages(activeConversationId, 'bottom');
    if (activeConversationId) {
        await resumeStreamIfAny(activeConversationId);
    }
    updateChatLayout();
}
