/**
 * Bubble Chat — fullscreen ephemeral thread (768px column, dark blue, dashed bubbles).
 * Same send/stream/render pipeline as workspace chat via {@link getChatPanelBridge} + `bubble: true`.
 *
 * @module bubble-chat
 */

import { oaaoT } from '../../../core/default/js/oaao-i18n.js';
import { oaaoAppendShellEsmV, resolveShellRegistryUrl } from '../../../core/default/js/shell-registry-url.js';
import {
    clearChatComposerEditor,
    focusChatComposerEditor,
    getChatComposerEditorPayload,
    isChatComposerEditorEl,
} from './chat-composer-editor.js?v=20260528-nl91';

/** Keep in sync with {@code OAAO_CHAT_SHELL_ASSET_REV} in chat-panel.js + core.main.php */
const BUBBLE_CHAT_ASSET_REV = '20260530-bubble-strip-fix-v215';

const SESSION_KEY = 'oaao_bubble_chat_v1';
const CHAT_PROFILE_STORAGE_KEY = 'oaao.workspace.chat_endpoint_id';
const BUBBLE_SHELL_CSS_ID = 'oaao-bubble-chat-shell-css';
const BUBBLE_THEME_CSS_ID = 'oaao-bubble-chat-theme-css';

/** @type {HTMLElement | null} */
let activeOverlay = null;
/** @type {(() => void) | null} */
let closeBubbleChatFn = null;
/** @type {AbortController | null} */
let bubbleAbort = null;

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

function ensureBubbleChatAssets() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById(BUBBLE_SHELL_CSS_ID)) {
        const link = document.createElement('link');
        link.id = BUBBLE_SHELL_CSS_ID;
        link.rel = 'stylesheet';
        link.href = oaaoAppendShellEsmV(
            resolveShellRegistryUrl(
                `/webassets/chat/default/css/oaao-chat-shell.css?v=${encodeURIComponent(BUBBLE_CHAT_ASSET_REV)}`,
            ),
        );
        document.head.append(link);
    }
    const theme = document.getElementById(BUBBLE_THEME_CSS_ID);
    if (!theme || theme.dataset.oaaoRev !== BUBBLE_CHAT_ASSET_REV) {
        theme?.remove();
        const link = document.createElement('link');
        link.id = BUBBLE_THEME_CSS_ID;
        link.rel = 'stylesheet';
        link.dataset.oaaoRev = BUBBLE_CHAT_ASSET_REV;
        link.href = oaaoAppendShellEsmV(
            resolveShellRegistryUrl(
                `/webassets/chat/default/css/oaao-bubble-chat.css?v=${encodeURIComponent(BUBBLE_CHAT_ASSET_REV)}`,
            ),
        );
        document.head.append(link);
    }
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

function isBubbleSessionExpired() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        const o = JSON.parse(raw);
        const exp = Date.parse(String(o?.expiresAt || '').trim());
        return Number.isFinite(exp) && exp > 0 && exp < Date.now();
    } catch {
        return false;
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

async function refreshContextUsageRing(conversationId) {
    if (!conversationId || conversationId < 1) return;
    globalThis.__oaaoStartChatContextUsagePoll?.();
    globalThis.__oaaoRefreshChatContextUsage?.();
}

function setBubbleTriggerPressed(on) {
    const btn = document.getElementById('workspace-bubble-chat-trigger');
    if (btn instanceof HTMLButtonElement) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
}

/** Close the fullscreen bubble thread if open. */
export function closeBubbleChat() {
    closeBubbleChatFn?.();
}

function isBubbleChatOpen() {
    return activeOverlay instanceof HTMLElement && !activeOverlay.classList.contains('oaao-bubble-chat-overlay--hidden');
}

/**
 * Open fullscreen Bubble Chat, or close if already open (toggle).
 */
export async function openBubbleChat() {
    if (isBubbleChatOpen()) {
        closeBubbleChat();
        return;
    }

    ensureBubbleChatAssets();

    clearSession();
    let conversationId = 0;

    bubbleAbort?.abort();
    bubbleAbort = new AbortController();
    const { signal } = bubbleAbort;

    const overlay = document.createElement('div');
    overlay.id = 'oaao-bubble-chat-overlay';
    overlay.className = 'oaao-bubble-chat-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', oaaoT('bubble_chat.title', 'Bubble Chat'));

    const topbar = document.createElement('header');
    topbar.className = 'oaao-bubble-chat-topbar';

    const title = document.createElement('p');
    title.className = 'oaao-bubble-chat-title';
    title.textContent = oaaoT('bubble_chat.title', 'Bubble Chat');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'oaao-bubble-chat-close';
    closeBtn.setAttribute('aria-label', oaaoT('bubble_chat.close', 'Close'));
    closeBtn.title = oaaoT('bubble_chat.close', 'Close');
    closeBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    topbar.append(title, closeBtn);

    const main = document.createElement('div');
    main.className = 'oaao-bubble-chat-main';

    const column = document.createElement('div');
    column.className = 'oaao-bubble-chat-column';

    const chatMount = document.createElement('div');
    chatMount.className = 'oaao-bubble-chat-thread oaao-chat-root';
    chatMount.dataset.module = 'oaao-chat';
    chatMount.dataset.oaaoChatMount = 'bubble';

    const msgsHost = document.createElement('div');
    msgsHost.dataset.oaaoChat = 'messages';
    msgsHost.className = 'oaao-chat-messages';
    msgsHost.setAttribute('role', 'log');
    msgsHost.setAttribute('aria-live', 'polite');

    const statusEl = document.createElement('p');
    statusEl.className = 'oaao-bubble-chat-status oaao-bubble-chat-status--hidden';
    statusEl.setAttribute('aria-live', 'polite');

    const composerHost = document.createElement('div');
    composerHost.className = 'oaao-bubble-chat-composer';
    composerHost.dataset.oaaoBubbleComposer = '1';

    chatMount.append(msgsHost);
    column.append(chatMount, statusEl, composerHost);
    main.append(column);
    overlay.append(topbar, main);

    /** @type {typeof import('./chat-panel.js')} */
    let chatPanelMod;
    try {
        chatPanelMod = await import('./chat-panel.js');
    } catch (err) {
        console.error('[bubble-chat] chat-panel import failed', err);
        window.alert(oaaoT('bubble_chat.error_unavailable', 'Bubble Chat unavailable'));
        return;
    }

    const getBubbleConversationId = () => (conversationId > 0 ? conversationId : null);

    try {
        await chatPanelMod.ensureChatPanelBridgeForBubble();
    } catch (err) {
        console.error('[bubble-chat] chat panel bridge bootstrap failed', err);
        window.alert(oaaoT('bubble_chat.error_unavailable', 'Bubble Chat unavailable'));
        return;
    }

    const composerWire = await chatPanelMod.mountBubbleChatComposer(composerHost, signal, {
        getConversationId: getBubbleConversationId,
    });
    if (!composerWire) {
        window.alert(oaaoT('bubble_chat.error_unavailable', 'Bubble Chat unavailable'));
        return;
    }

    let chatBridge;
    try {
        chatBridge = chatPanelMod.getChatPanelBridge();
    } catch (err) {
        console.error('[bubble-chat] chat panel bridge unavailable', err);
        window.alert(oaaoT('bubble_chat.error_unavailable', 'Bubble Chat unavailable'));
        return;
    }

    const { formEl, inputEl, sendBtn, mount: composerMount } = composerWire;

    const setStatus = (text) => {
        const t = String(text || '').trim();
        statusEl.textContent = t;
        statusEl.classList.toggle('oaao-bubble-chat-status--hidden', !t);
    };

    const setBusy = (on) => {
        setBubbleComposerInteractive(composerMount, inputEl, sendBtn, !on);
    };

    const resetBubbleThread = (statusText = '') => {
        if (conversationId > 0) {
            chatPanelMod.unregisterBubbleConversationMount(conversationId);
        }
        conversationId = 0;
        clearSession();
        msgsHost.replaceChildren();
        if (statusText) {
            setStatus(statusText);
        }
    };

    const teardown = () => {
        bubbleAbort?.abort();
        bubbleAbort = null;
        const cid = conversationId;
        conversationId = 0;
        if (cid > 0) {
            chatPanelMod.unregisterBubbleConversationMount(cid);
            void dismissBubbleConversation(cid);
        } else {
            clearSession();
        }
        overlay.remove();
        activeOverlay = null;
        closeBubbleChatFn = null;
        document.body.classList.remove('oaao-bubble-chat-open');
        setBubbleTriggerPressed(false);
    };

    closeBubbleChatFn = teardown;
    closeBtn.addEventListener('click', teardown, { signal });
    document.addEventListener(
        'keydown',
        (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                teardown();
            }
        },
        { signal },
    );

    activeOverlay = overlay;
    document.body.append(overlay);
    document.body.classList.add('oaao-bubble-chat-open');
    setBubbleTriggerPressed(true);

    const JIT = globalThis.JIT;
    if (JIT?.hydrate) {
        JIT.hydrate(overlay);
        JIT.hydrate(chatMount);
    }

    focusChatComposerEditor(inputEl);

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
                const userMsgId = Number(data.user_message_id);
                const amid = Number(data.assistant_message_id);
                const streamUrl = typeof data.stream_url === 'string' ? data.stream_url.trim() : '';
                const runId = typeof data.run_id === 'string' ? data.run_id.trim() : '';

                if (cid > 0) {
                    conversationId = cid;
                    const exp = new Date(Date.now() + 5400 * 1000).toISOString();
                    writeSession(cid, exp);
                    chatPanelMod.registerBubbleConversationMount(cid, chatMount, msgsHost);
                }

                if (
                    cid > 0 &&
                    Number.isFinite(userMsgId) &&
                    userMsgId > 0 &&
                    Number.isFinite(amid) &&
                    amid > 0
                ) {
                    chatBridge.appendSendTurnToCachedMessages(cid, userMsgId, content, amid);
                }

                if (streamUrl && runId && cid > 0 && amid > 0) {
                    setStatus(oaaoT('bubble_chat.status_streaming', 'Thinking…'));
                    await chatBridge.consumeAssistantStream(
                        streamUrl,
                        runId,
                        cid,
                        0,
                        amid,
                        true,
                        false,
                    );
                }

                if (cid > 0 && msgsHost instanceof HTMLElement) {
                    msgsHost.scrollTop = msgsHost.scrollHeight;
                }

                await refreshContextUsageRing(conversationId);
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
