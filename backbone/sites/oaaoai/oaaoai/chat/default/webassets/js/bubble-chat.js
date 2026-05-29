/**
 * Bubble Chat — single ephemeral dialog thread (short TTL, not in sidebar).
 * Reuses the main chat composer (context ring, planner mode, web search, vault).
 *
 * @module bubble-chat
 */

import { oaaoT } from '../../../core/default/js/oaao-i18n.js';
import { readOaaoSseStream } from '../../../core/default/js/oaao-sse.js';
import { oaaoAppendShellEsmV, resolveOrchestratorPublicUrl, resolveShellRegistryUrl } from '../../../core/default/js/shell-registry-url.js';
import {
    clearChatComposerEditor,
    focusChatComposerEditor,
    getChatComposerEditorPayload,
    isChatComposerEditorEl,
} from './chat-composer-editor.js?v=20260528-nl91';

const SESSION_KEY = 'oaao_bubble_chat_v1';
const CHAT_PROFILE_STORAGE_KEY = 'oaao.workspace.chat_endpoint_id';
const BUBBLE_SHELL_CSS_ID = 'oaao-bubble-chat-shell-css';
/** Flex gap on messages host (JIT + inline fallback). */
const BUBBLE_MSG_GAP = 'shrink-0';
const BUBBLE_MSGS_GAP_STYLE = 'display:flex;flex-direction:column;gap:1rem';
const BUBBLE_BUBBLE_PAD = 'px-4 py-3';
const BUBBLE_USER_BUBBLE =
    `max-w-[92%] rounded-[14px] ${BUBBLE_BUBBLE_PAD} text-[0.875rem] bg-[var(--grid-accent)] fg-white whitespace-pre-wrap`;
const BUBBLE_ASSIST_BUBBLE =
    `max-w-full rounded-[14px] ${BUBBLE_BUBBLE_PAD} text-[0.875rem] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)] whitespace-pre-wrap oaao-md-bubble`;

/** @type {Array<{ kind: string, payload: Record<string, unknown> }>} */
let pendingProductivityEvents = [];
/** Set when SSE / run end hints calendar or todo chips for the current turn. */
let expectProductivityAfterTurn = false;

/** @type {Promise<{ calMod: typeof import('./conversation-calendar-suggest.js'), todoMod: typeof import('./conversation-todo-suggest.js') }> | null} */
let productivityModsPromise = null;

function loadProductivityMods() {
    if (!productivityModsPromise) {
        productivityModsPromise = Promise.all([
            import('./conversation-calendar-suggest.js'),
            import('./conversation-todo-suggest.js'),
        ]).then(([calMod, todoMod]) => ({ calMod, todoMod }));
    }
    return productivityModsPromise;
}

/** @type {import('../../../core/default/razyui/component/Dialog.js').default | null} */
let activeDialog = null;
/** @type {AbortController | null} */
let streamAbort = null;
/** @type {AbortController | null} */
let bubbleAbort = null;

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

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

function chatApiUrl(path, params = {}) {
    const base = chatApiBase().replace(/\/$/, '');
    const p = String(path || '').replace(/^\//, '');
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && String(v) !== '') q.set(k, String(v));
    }
    const qs = q.toString();
    const joined = p ? `${base}/${p}` : base;
    return qs ? `${joined}?${qs}` : joined;
}

function workspaceScopeFields() {
    const root = document.getElementById('workspace-view');
    const raw = root?.dataset?.oaaoActiveWorkspaceId?.trim() ?? '';
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
        return { workspace_id: Math.floor(n) };
    }
    return {};
}

function getChatEndpointId() {
    const trigger = document.getElementById('workspace-routing-purpose-trigger');
    const ds = trigger?.dataset?.routingChatEndpointId;
    const fromDom = Number(ds);
    if (Number.isFinite(fromDom) && fromDom > 0) return Math.floor(fromDom);
    try {
        const raw = (localStorage.getItem(CHAT_PROFILE_STORAGE_KEY) || '').trim();
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } catch {
        return null;
    }
}

function ensureBubbleChatShellCss() {
    if (typeof document === 'undefined' || document.getElementById(BUBBLE_SHELL_CSS_ID)) return;
    const link = document.createElement('link');
    link.id = BUBBLE_SHELL_CSS_ID;
    link.rel = 'stylesheet';
    link.href = oaaoAppendShellEsmV(resolveShellRegistryUrl('/webassets/chat/default/css/oaao-chat-shell.css'));
    document.head.append(link);
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 */
async function bubbleFetchJson(url, options = {}) {
    const fetchFn = typeof globalThis.chatFetchJson === 'function' ? globalThis.chatFetchJson : fetch;
    if (fetchFn === fetch) {
        const res = await fetch(url, { credentials: 'include', ...options });
        const raw = await res.text();
        let data = null;
        let parseError = null;
        try {
            data = raw ? JSON.parse(raw) : null;
        } catch (e) {
            parseError = e;
        }
        return { res, data, raw, parseError };
    }
    return fetchFn(url, options);
}

/** @param {number} conversationId @param {string} expiresAt */
function writeSession(conversationId, expiresAt) {
    const scope = workspaceScopeFields();
    try {
        sessionStorage.setItem(
            SESSION_KEY,
            JSON.stringify({
                conversationId,
                expiresAt,
                workspaceId: scope.workspace_id ?? null,
            }),
        );
    } catch {
        /* ignore */
    }
}

function clearSession() {
    try {
        sessionStorage.removeItem(SESSION_KEY);
    } catch {
        /* ignore */
    }
}

/** @returns {number} epoch ms, or 0 if none / expired */
function readSessionExpiresAtMs() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return 0;
        const o = JSON.parse(raw);
        const exp = Date.parse(String(o?.expiresAt || '').trim());
        return Number.isFinite(exp) && exp > 0 ? exp : 0;
    } catch {
        return 0;
    }
}

function isBubbleSessionExpired() {
    const exp = readSessionExpiresAtMs();
    return exp > 0 && exp < Date.now();
}

/**
 * @param {Record<string, unknown>} payload
 */
function markExpectProductivityAfterTurn() {
    expectProductivityAfterTurn = true;
}

function queueProductivityFromRunMeta(payload) {
    if (!payload || typeof payload !== 'object') return;
    let queued = false;
    const cal = payload.calendar_event_suggested;
    if (cal && typeof cal === 'object') {
        queueProductivityEvent('calendar', /** @type {Record<string, unknown>} */ (cal));
        queued = true;
    }
    const todo = payload.todo_item_suggested;
    if (todo && typeof todo === 'object') {
        queueProductivityEvent('todo', /** @type {Record<string, unknown>} */ (todo));
        queued = true;
    }
    const todos = payload.todo_items_suggested;
    if (Array.isArray(todos) && todos.length >= 2) {
        queueProductivityEvent('todos', { items: todos });
        queued = true;
    }
    const resolve = payload.todo_resolve_suggested;
    if (resolve && typeof resolve === 'object') {
        queueProductivityEvent('todo_resolve', /** @type {Record<string, unknown>} */ (resolve));
        queued = true;
    }
    if (queued) {
        markExpectProductivityAfterTurn();
    }
}

/**
 * @param {HTMLElement} composerMount
 * @param {HTMLElement} inputEl
 * @param {HTMLButtonElement} sendBtn
 * @param {boolean} interactive
 */
function setBubbleComposerInteractive(composerMount, inputEl, sendBtn, interactive) {
    const card = composerMount?.querySelector?.('[data-oaao-chat="composer-card-wrap"]');
    if (card instanceof HTMLElement) {
        if (interactive) {
            delete card.dataset.oaaoComposerBusy;
            card.removeAttribute('aria-busy');
        }
    }
    if (sendBtn instanceof HTMLButtonElement) {
        sendBtn.disabled = !interactive;
        if (interactive) {
            delete sendBtn.dataset.oaaoComposerSending;
        }
    }
    if (inputEl instanceof HTMLElement && inputEl.getAttribute('data-oaao-chat') === 'input') {
        inputEl.contentEditable = interactive ? 'true' : 'false';
        if (interactive) {
            inputEl.removeAttribute('aria-disabled');
            delete inputEl.dataset.oaaoComposerWasEditable;
        } else {
            inputEl.setAttribute('aria-disabled', 'true');
        }
    }
}

function streamEnvelopeText(data) {
    if (!data || typeof data !== 'object') return '';
    const t = /** @type {Record<string, unknown>} */ (data).text;
    if (typeof t === 'string') return t;
    if (Array.isArray(t)) {
        return t.filter((x) => typeof x === 'string').join('');
    }
    return '';
}

function clearPendingProductivity() {
    pendingProductivityEvents = [];
    expectProductivityAfterTurn = false;
}

function queueProductivityEvent(kind, payload) {
    if (!payload || typeof payload !== 'object') return;
    pendingProductivityEvents.push({ kind, payload: /** @type {Record<string, unknown>} */ (payload) });
    markExpectProductivityAfterTurn();
}

/**
 * @param {HTMLElement} chatMount
 * @param {number} conversationId
 * @param {number} messageId
 * @param {Array<{ kind: string, payload: Record<string, unknown> }>} events
 */
async function dispatchProductivityEvents(chatMount, conversationId, messageId, events) {
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    if (cid < 1 || mid < 1 || !(chatMount instanceof HTMLElement) || events.length < 1) return;

    const scopeFields = () => workspaceScopeFields();
    const { calMod, todoMod } = await loadProductivityMods();

    for (const ev of events) {
        if (ev.kind === 'calendar') {
            calMod.handleCalendarEventSuggestedStream(chatMount, cid, mid, ev.payload, scopeFields);
        } else if (ev.kind === 'todo') {
            todoMod.handleTodoItemSuggestedStream(chatMount, cid, mid, ev.payload, scopeFields);
        } else if (ev.kind === 'todos') {
            todoMod.handleTodoItemsSuggestedStream(chatMount, cid, mid, ev.payload, scopeFields);
        } else if (ev.kind === 'todo_resolve') {
            todoMod.handleTodoResolveSuggestedStream(chatMount, cid, mid, ev.payload);
        }
    }
}

/**
 * @param {HTMLElement} host
 * @param {string} content
 * @param {number} [messageId]
 * @param {{ streaming?: boolean }} [opts]
 * @returns {HTMLElement}
 */
function appendAssistantBubble(host, content, messageId = 0, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = `flex flex-col items-stretch gap-2 max-w-[92%] ${BUBBLE_MSG_GAP} oaao-chat-assistant-row`;
    const bubble = document.createElement('div');
    bubble.className = BUBBLE_ASSIST_BUBBLE;
    bubble.dataset.oaaoMsgRole = 'assistant';
    if (messageId > 0) bubble.dataset.oaaoMsgId = String(messageId);
    if (opts.streaming) bubble.dataset.oaaoBubbleAssistant = '1';
    bubble.textContent = content;
    wrap.append(bubble);
    host.append(wrap);
    return bubble;
}

/**
 * @param {HTMLElement} host
 * @param {string} content
 */
function appendUserBubble(host, content) {
    const wrap = document.createElement('div');
    wrap.className = `flex justify-end ${BUBBLE_MSG_GAP}`;
    const bubble = document.createElement('div');
    bubble.className = BUBBLE_USER_BUBBLE;
    bubble.textContent = content;
    wrap.append(bubble);
    host.append(wrap);
}

/**
 * @param {HTMLElement} chatMount
 * @param {number} conversationId
 * @param {number} messageId
 */
async function applyBubbleProductivityChips(chatMount, conversationId, messageId) {
    if (pendingProductivityEvents.length < 1) return;
    const events = pendingProductivityEvents.slice();
    await dispatchProductivityEvents(chatMount, conversationId, messageId, events);
    clearPendingProductivity();
}

/**
 * Live SSE productivity chips — same as main chat thread (before reload).
 *
 * @param {HTMLElement} chatMount
 * @param {number} conversationId
 * @param {number} messageId
 */
async function applyBubbleProductivityChipsLive(chatMount, conversationId, messageId) {
    if (pendingProductivityEvents.length < 1) return;
    await dispatchProductivityEvents(
        chatMount,
        conversationId,
        messageId,
        pendingProductivityEvents.slice(),
    );
}

/**
 * @param {HTMLElement} chatMount
 * @param {number} conversationId
 * @param {Array<Record<string, unknown>>} rows
 */
async function hydrateProductivityFromMessageMeta(chatMount, conversationId, rows) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return;
    const { calMod, todoMod } = await loadProductivityMods();
    const scopeFields = () => workspaceScopeFields();

    for (const row of rows) {
        if (String(row?.role || '').toLowerCase() !== 'assistant') continue;
        const mid = Math.floor(Number(row.id ?? row.message_id ?? 0));
        if (mid < 1) continue;
        const meta = row.meta;
        if (!meta || typeof meta !== 'object') continue;
        const m = /** @type {Record<string, unknown>} */ (meta);
        if (m.calendar_event_suggested && typeof m.calendar_event_suggested === 'object') {
            calMod.renderCalendarSuggestChip(
                chatMount,
                cid,
                mid,
                /** @type {Record<string, unknown>} */ (m.calendar_event_suggested),
                scopeFields,
            );
        }
        if (m.todo_item_suggested && typeof m.todo_item_suggested === 'object') {
            todoMod.renderTodoSuggestChip(
                chatMount,
                cid,
                mid,
                /** @type {Record<string, unknown>} */ (m.todo_item_suggested),
                scopeFields,
            );
        }
        const batch = m.todo_items_suggested;
        if (Array.isArray(batch) && batch.length >= 2) {
            todoMod.renderTodoItemsSuggestChip(
                chatMount,
                cid,
                mid,
                { items: batch },
                scopeFields,
            );
        }
        if (m.todo_resolve_suggested && typeof m.todo_resolve_suggested === 'object') {
            todoMod.renderTodoResolveChip(
                chatMount,
                cid,
                mid,
                /** @type {Record<string, unknown>} */ (m.todo_resolve_suggested),
            );
        }
    }
}

/** @param {Array<Record<string, unknown>>} rows */
function messageRowsHaveProductivityMeta(rows) {
    return rows.some((row) => {
        if (String(row?.role || '').toLowerCase() !== 'assistant') return false;
        const meta = row.meta;
        if (!meta || typeof meta !== 'object') return false;
        const m = /** @type {Record<string, unknown>} */ (meta);
        return Boolean(
            m.calendar_event_suggested ||
                m.todo_item_suggested ||
                m.todo_resolve_suggested ||
                (Array.isArray(m.todo_items_suggested) && m.todo_items_suggested.length >= 2),
        );
    });
}

async function dismissBubbleConversation(conversationId) {
    if (!conversationId || conversationId < 1) return;
    try {
        await bubbleFetchJson(chatApiUrl('conversation_delete'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: conversationId, ...workspaceScopeFields() }),
        });
    } catch {
        /* ignore */
    }
    clearSession();
}

/**
 * @param {HTMLElement} host
 * @param {Array<{ role?: string, content?: string }>} rows
 */
/**
 * @param {HTMLElement} host
 * @param {Array<Record<string, unknown>>} rows
 */
function renderMessages(host, rows) {
    host.replaceChildren();
    for (const row of rows) {
        const role = String(row?.role || '').toLowerCase();
        const content = String(row?.content || '').trim();
        const mid = Math.floor(Number(row.id ?? row.message_id ?? 0));
        if (role === 'user') {
            if (!content) continue;
            appendUserBubble(host, content);
        } else if (role === 'assistant') {
            // Keep assistant anchor for productivity chips even before orchestrator persist lands.
            if (!content && mid < 1) continue;
            appendAssistantBubble(host, content, mid);
        }
    }
    host.scrollTop = host.scrollHeight;
}

/**
 * @param {HTMLElement} msgsHost
 * @param {string} text
 * @param {number | null} [assistantMsgId]
 */
function appendAssistantDelta(msgsHost, text, assistantMsgId = null) {
    let row = msgsHost.querySelector('[data-oaao-bubble-assistant="1"]');
    if (!(row instanceof HTMLElement)) {
        const mid = assistantMsgId && Number(assistantMsgId) > 0 ? Math.floor(Number(assistantMsgId)) : 0;
        row = appendAssistantBubble(msgsHost, '', mid, { streaming: true });
    }
    row.textContent = `${row.textContent || ''}${text}`;
    if (assistantMsgId && !row.dataset.oaaoMsgId) {
        row.dataset.oaaoMsgId = String(assistantMsgId);
    }
    msgsHost.scrollTop = msgsHost.scrollHeight;
}

/**
 * @param {string} streamUrl
 * @param {string} runId
 * @param {{
 *   chatMount: HTMLElement,
 *   msgsHost: HTMLElement,
 *   getConversationId: () => number,
 *   getAssistantMessageId: () => number,
 * }} opts
 */
async function consumeBubbleStream(streamUrl, runId, opts) {
    const { chatMount, msgsHost, getConversationId, getAssistantMessageId } = opts;
    streamAbort?.abort();
    streamAbort = new AbortController();
    const { signal } = streamAbort;

    const resolved = await resolveOrchestratorPublicUrl(streamUrl);
    const baseUrl = new URL(resolved, window.location.href);
    baseUrl.searchParams.set('run_id', runId);
    const sameOrigin = baseUrl.origin === window.location.origin;

    let lastStreamSeq = 0;
    let sawRunEnd = false;

    const maybeApplyLiveProductivity = () => {
        const cid = getConversationId();
        const mid = getAssistantMessageId();
        if (cid < 1 || mid < 1) return;
        void applyBubbleProductivityChipsLive(chatMount, cid, mid);
    };

    /** @param {ReadableStreamDefaultReader<Uint8Array>} reader */
    const readStream = async (reader) => {
        await readOaaoSseStream(
            reader,
            ({ seq, data }) => {
                if (Number.isFinite(seq) && seq > 0) {
                    lastStreamSeq = Math.max(lastStreamSeq, seq);
                }
                if (!data || typeof data !== 'object') return;
                const envelope = /** @type {Record<string, unknown>} */ (data);
                const phase = String(envelope.phase || '').toLowerCase();
                const kind = String(envelope.kind || '').toLowerCase();
                const text = streamEnvelopeText(envelope);
                const payload = envelope.payload;
                const assistantMsgId = getAssistantMessageId();

                if (phase === 'llm' && kind === 'delta' && text) {
                    appendAssistantDelta(
                        msgsHost,
                        text,
                        assistantMsgId > 0 ? assistantMsgId : null,
                    );
                    return;
                }

                if (phase === 'system' && kind === 'end') {
                    sawRunEnd = true;
                    if (payload && typeof payload === 'object') {
                        queueProductivityFromRunMeta(/** @type {Record<string, unknown>} */ (payload));
                        maybeApplyLiveProductivity();
                    }
                    return;
                }

                if (phase !== 'system' || kind !== 'status' || !text) return;
                if (!payload || typeof payload !== 'object') return;

                if (text === 'calendar_event_suggested') {
                    queueProductivityEvent('calendar', /** @type {Record<string, unknown>} */ (payload));
                    maybeApplyLiveProductivity();
                } else if (text === 'todo_item_suggested') {
                    queueProductivityEvent('todo', /** @type {Record<string, unknown>} */ (payload));
                    maybeApplyLiveProductivity();
                } else if (text === 'todo_items_suggested') {
                    queueProductivityEvent('todos', /** @type {Record<string, unknown>} */ (payload));
                    maybeApplyLiveProductivity();
                } else if (text === 'todo_resolve_suggested') {
                    queueProductivityEvent('todo_resolve', /** @type {Record<string, unknown>} */ (payload));
                    maybeApplyLiveProductivity();
                }
            },
            signal,
        );
    };

    const res = await fetch(baseUrl.href, {
        method: 'GET',
        credentials: sameOrigin ? 'include' : 'omit',
        headers: { Accept: 'text/event-stream' },
        signal,
    });
    if (!res.ok || !res.body) {
        throw new Error(`Stream HTTP ${res.status}`);
    }

    await readStream(res.body.getReader());

    if (!sawRunEnd && !signal.aborted && lastStreamSeq > 0) {
        const tailUrl = new URL(baseUrl.href);
        tailUrl.searchParams.set('since_seq', String(lastStreamSeq));
        try {
            const tailRes = await fetch(tailUrl.href, {
                method: 'GET',
                credentials: sameOrigin ? 'include' : 'omit',
                headers: { Accept: 'text/event-stream' },
                signal,
            });
            if (tailRes.ok && tailRes.body) {
                await readStream(tailRes.body.getReader());
            }
        } catch (tailErr) {
            if (/** @type {{ name?: string }} */ (tailErr)?.name !== 'AbortError') {
                console.warn('[bubble-chat] stream tail resume failed', tailErr);
            }
        }
    }
}

async function loadDialogCtor() {
    const url = oaaoAppendShellEsmV(
        resolveShellRegistryUrl('/webassets/core/default/razyui/component/Dialog.js'),
    );
    const m = await import(/* webpackIgnore: true */ url);
    return m.default;
}

/**
 * @param {number} conversationId
 * @param {HTMLElement} mount
 */
async function refreshContextUsageRing(conversationId, mount) {
    if (!conversationId || conversationId < 1) return;
    try {
        const mod = await import('./chat-context-usage.js');
        if (typeof mod.mountChatContextUsage !== 'function') return;
        mod.purgeComposerContextUsageOrphans?.(mount);
        mod.mountChatContextUsage(
            mount,
            () => conversationId,
            () => getChatEndpointId() ?? 0,
            chatApiBase(),
            async () => {},
            () => workspaceScopeFields(),
        );
    } catch {
        /* ignore */
    }
}

function setBubbleTriggerPressed(on) {
    const btn = document.getElementById('workspace-bubble-chat-trigger');
    if (btn instanceof HTMLButtonElement) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
}

/**
 * Open or focus the single Bubble Chat dialog.
 */
export async function openBubbleChat() {
    if (activeDialog) {
        try {
            activeDialog.show?.();
        } catch {
            /* ignore */
        }
        setBubbleTriggerPressed(true);
        return;
    }

    ensureBubbleChatShellCss();

    const Dialog = await loadDialogCtor();
    if (typeof Dialog !== 'function') {
        window.alert(oaaoT('bubble_chat.error_dialog', 'Dialog unavailable'));
        return;
    }

    // Ephemeral: closing the dialog discards the thread; reopen always starts empty.
    clearSession();
    let conversationId = 0;

    bubbleAbort?.abort();
    bubbleAbort = new AbortController();
    const { signal } = bubbleAbort;

    const body = document.createElement('div');
    body.className =
        'oaao-bubble-chat-body flex flex-col gap-3 min-h-[min(420px,70vh)] max-h-[min(640px,82vh)] w-[min(560px,calc(100vw-2rem))] box-border p-1';
    body.dataset.module = 'oaao-bubble-chat';

    const hint = document.createElement('p');
    hint.className = 'm-0 px-1 text-[0.75rem] fg-[var(--grid-caption)] shrink-0';
    hint.textContent = oaaoT(
        'bubble_chat.hint',
        'Short-lived chat — not saved to your sidebar. Session expires after inactivity.',
    );

    const chatMount = document.createElement('div');
    chatMount.className = 'flex flex-col flex-1 min-h-0 min-w-0 w-full';
    chatMount.dataset.module = 'oaao-chat';
    chatMount.dataset.oaaoChatMount = 'bubble';

    const msgsHost = document.createElement('div');
    msgsHost.dataset.oaaoChat = 'messages';
    msgsHost.className =
        'flex-1 min-h-[200px] overflow-y-auto overscroll-contain px-3 py-3 flex flex-col gap-4 border border-solid border-[var(--grid-line)] rounded-[12px] bg-[var(--grid-paper)]';
    msgsHost.style.cssText = BUBBLE_MSGS_GAP_STYLE;
    chatMount.append(msgsHost);

    const statusEl = document.createElement('p');
    statusEl.className = 'm-0 text-[0.75rem] fg-[var(--grid-caption)] hidden shrink-0';
    statusEl.setAttribute('aria-live', 'polite');

    const composerHost = document.createElement('div');
    composerHost.className = 'shrink-0 w-full min-w-0';
    composerHost.dataset.oaaoBubbleComposer = '1';

    body.append(hint, chatMount, statusEl, composerHost);

    const setBusy = (on) => {
        setBubbleComposerInteractive(composerMount, inputEl, sendBtn, !on);
    };

    const setStatus = (text) => {
        const t = String(text || '').trim();
        statusEl.textContent = t;
        statusEl.classList.toggle('hidden', !t);
    };

    const getBubbleConversationId = () => (conversationId > 0 ? conversationId : null);

    const resetBubbleThread = (statusText = '') => {
        conversationId = 0;
        clearSession();
        clearPendingProductivity();
        msgsHost.replaceChildren();
        if (statusText) {
            setStatus(statusText);
        }
    };

    const reloadMessages = async () => {
        if (!conversationId || conversationId < 1) {
            msgsHost.replaceChildren();
            return [];
        }
        const { res, data } = await bubbleFetchJson(
            chatApiUrl('messages', {
                conversation_id: String(conversationId),
                limit: '40',
                ...workspaceScopeFields(),
            }),
        );
        if (!res.ok || data?.success !== true) return [];
        const rows = Array.isArray(data.messages) ? data.messages : [];
        renderMessages(msgsHost, rows);
        await hydrateProductivityFromMessageMeta(chatMount, conversationId, rows);
        return rows;
    };

    /** @param {number} [attempts] */
    const reloadMessagesAfterTurn = async (attempts = 8) => {
        let rows = await reloadMessages();
        const shouldWaitForProductivity =
            expectProductivityAfterTurn || pendingProductivityEvents.length > 0;
        if (!shouldWaitForProductivity) {
            return rows;
        }
        for (let i = 1; i < attempts; i += 1) {
            const hasProdMeta = messageRowsHaveProductivityMeta(rows);
            const hasAssistantAnchor = rows.some((row) => {
                if (String(row?.role || '').toLowerCase() !== 'assistant') return false;
                const mid = Math.floor(Number(row.id ?? row.message_id ?? 0));
                return mid > 0;
            });
            if (hasAssistantAnchor && (hasProdMeta || pendingProductivityEvents.length > 0)) {
                break;
            }
            await new Promise((r) => setTimeout(r, 400 * i));
            rows = await reloadMessages();
        }
        return rows;
    };

    /** @type {typeof import('./chat-panel.js')} */
    let chatPanelMod;
    try {
        chatPanelMod = await import('./chat-panel.js');
    } catch (err) {
        console.error('[bubble-chat] chat-panel import failed', err);
        window.alert(oaaoT('bubble_chat.error_dialog', 'Dialog unavailable'));
        return;
    }

    const composerWire = await chatPanelMod.mountBubbleChatComposer(composerHost, signal, {
        getConversationId: getBubbleConversationId,
    });
    if (!composerWire) {
        window.alert(oaaoT('bubble_chat.error_dialog', 'Dialog unavailable'));
        return;
    }

    const { formEl, inputEl, sendBtn, mount: composerMount } = composerWire;

    const dialog = new Dialog({
        title: oaaoT('bubble_chat.title', 'Bubble Chat'),
        content: body,
        width: 'auto',
        closeOnBackdrop: true,
        onClose: () => {
            streamAbort?.abort();
            bubbleAbort?.abort();
            const cid = conversationId;
            conversationId = 0;
            activeDialog = null;
            setBubbleTriggerPressed(false);
            clearSession();
            if (cid > 0) {
                void dismissBubbleConversation(cid);
            }
        },
    });

    activeDialog = dialog;
    setBubbleTriggerPressed(true);
    dialog.show?.();

    if (conversationId > 0) {
        await reloadMessages();
        await refreshContextUsageRing(conversationId, composerMount);
    }

    formEl.addEventListener(
        'submit',
        async (ev) => {
            ev.preventDefault();
            if (!isChatComposerEditorEl(inputEl)) return;
            const composerPayload = getChatComposerEditorPayload(inputEl);
            let content = composerPayload.text.trim();
            if (!content && chatPanelMod.getChatComposerVaultSendExtra) {
                const extra = chatPanelMod.getChatComposerVaultSendExtra();
                const att = extra.attachment_ids;
                if (Array.isArray(att) && att.length > 0) {
                    content = oaaoT(
                        'chat.attachment.default_send_prompt',
                        'Please read the attached file(s) and respond helpfully.',
                    );
                }
            }
            if (!content) return;

            if (isBubbleSessionExpired()) {
                resetBubbleThread(
                    oaaoT(
                        'bubble_chat.burst',
                        'This bubble expired — close and reopen Bubble Chat, or send again to start fresh.',
                    ),
                );
            }

            setBusy(true);
            setStatus(oaaoT('bubble_chat.status_sending', 'Sending…'));

            appendUserBubble(msgsHost, content);
            msgsHost.scrollTop = msgsHost.scrollHeight;

            msgsHost.querySelectorAll('[data-oaao-bubble-assistant="1"]').forEach((el) => {
                el.closest('.oaao-chat-assistant-row')?.remove();
            });
            clearPendingProductivity();
            clearChatComposerEditor(inputEl);

            try {
                const endpointId = getChatEndpointId();
                const sendCid = conversationId > 0 ? conversationId : 0;
                const plannerMode = chatPanelMod.getChatComposerPlannerModeForSend(sendCid || null);
                const inference = chatPanelMod.getChatComposerInferenceForSend(sendCid || null);
                const vaultExtra = chatPanelMod.getChatComposerVaultSendExtra();
                if (chatPanelMod.getChatComposerWebSearchEnabled()) {
                    vaultExtra.enable_web_search = true;
                }

                /** @type {Record<string, unknown>} */
                const payload = {
                    content,
                    planner_mode_id: plannerMode,
                    ...vaultExtra,
                    ...(sendCid > 0
                        ? chatPanelMod.getChatScopeBodyFieldsForComposer(sendCid)
                        : { bubble: true, ...chatPanelMod.getWorkspaceChatBodyFieldsForComposer() }),
                    ...(sendCid > 0 ? { conversation_id: sendCid } : {}),
                };
                if (endpointId) payload.chat_endpoint_id = endpointId;
                if (sendCid < 1) {
                    payload.inference_mode = inference.mode;
                    if (inference.mode === 'manual' && inference.model_params) {
                        payload.model_params = inference.model_params;
                    }
                }

                const { res, data } = await bubbleFetchJson(chatApiUrl('send'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                if (res.status === 410 || data?.code === 'bubble_expired') {
                    resetBubbleThread(
                        oaaoT(
                            'bubble_chat.burst',
                            'This bubble expired — close and reopen Bubble Chat, or send again to start fresh.',
                        ),
                    );
                    return;
                }

                if (!res.ok || data?.success !== true) {
                    setStatus(
                        String(data?.message || '') ||
                            oaaoT('bubble_chat.error_send', 'Could not send — try again.'),
                    );
                    return;
                }

                const cid = Number(data.conversation_id);
                if (cid > 0) {
                    conversationId = cid;
                    const exp = new Date(Date.now() + 5400 * 1000).toISOString();
                    writeSession(cid, exp);
                }

                const streamUrl = typeof data.stream_url === 'string' ? data.stream_url.trim() : '';
                const runId = typeof data.run_id === 'string' ? data.run_id.trim() : '';
                const amid = Number(data.assistant_message_id);

                let assistantMid =
                    Number.isFinite(amid) && amid > 0 ? Math.floor(amid) : 0;

                if (streamUrl && runId) {
                    setStatus(oaaoT('bubble_chat.status_streaming', 'Thinking…'));
                    await consumeBubbleStream(streamUrl, runId, {
                        chatMount,
                        msgsHost,
                        getConversationId: () => conversationId,
                        getAssistantMessageId: () => assistantMid,
                    });
                }

                const rows = await reloadMessagesAfterTurn();
                if (assistantMid < 1 && rows.length > 0) {
                    for (let i = rows.length - 1; i >= 0; i -= 1) {
                        if (String(rows[i]?.role || '').toLowerCase() === 'assistant') {
                            assistantMid = Math.floor(Number(rows[i].id ?? rows[i].message_id ?? 0));
                            break;
                        }
                    }
                }
                if (assistantMid > 0) {
                    await applyBubbleProductivityChips(chatMount, conversationId, assistantMid);
                }
                msgsHost.querySelectorAll('[data-oaao-bubble-assistant="1"]').forEach((el) => {
                    el.closest('.oaao-chat-assistant-row')?.remove();
                });
                await refreshContextUsageRing(conversationId, composerMount);
                setStatus('');
            } catch (err) {
                console.error('[bubble-chat] send failed', err);
                setStatus(oaaoT('bubble_chat.error_send', 'Could not send — try again.'));
            } finally {
                setBubbleComposerInteractive(composerMount, inputEl, sendBtn, true);
                focusChatComposerEditor(inputEl);
            }
        },
        { signal },
    );

    const JIT = globalThis.JIT;
    if (JIT?.hydrate) {
        JIT.hydrate(body);
        JIT.hydrate(chatMount);
    }
}

/**
 * Wire header trigger (single instance).
 */
export function wireWorkspaceBubbleChat() {
    const btn = document.getElementById('workspace-bubble-chat-trigger');
    if (!(btn instanceof HTMLButtonElement) || btn.dataset.oaaoBubbleBound === '1') {
        return;
    }
    btn.dataset.oaaoBubbleBound = '1';
    btn.addEventListener('click', () => {
        void openBubbleChat();
    });
    const label = oaaoT('bubble_chat.open', 'Bubble Chat');
    btn.setAttribute('aria-label', label);
    btn.title = label;
}
