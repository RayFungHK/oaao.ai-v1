/**
 * Chat module workspace shell — mounted by core {@see workspace.js} via dynamic import.
 * Conversation list renders into core {@code #workspace-conversation-list}; shell fires {@code oaao-chat-new}.
 */

import { OAAO_TASK_AGENT_CATALOG, getOaaoAgentCatalogEntry } from './oaao-agent-catalog.js';
import { mountComposerDropupAbove, renderComposerDropupOptions } from './composer-dropup.js';
import {
    appendChatComposerEditorText,
    clearChatComposerEditor,
    createTemplateSlugNode,
    extractInlineTemplateSlugDirective,
    focusChatComposerEditor,
    getChatComposerEditorPayload,
    isChatComposerEditorEl,
    mountChatComposerEditor,
    removeTemplateSlugsFromEditor,
    setChatComposerEditorPlainText,
} from './chat-composer-editor.js';
import {
    hydrateRuiIconSlots,
    mountRuiIcon,
    mountRuiIconSync,
    OAAO_RUI_ICON_CONVERSATION,
    OAAO_RUI_ICON_GALLERY_MODE,
    OAAO_RUI_ICON_MORE,
    OAAO_RUI_ICON_SLIDE,
    OAAO_RUI_ICON_SOFT_CLASS,
    OAAO_RUI_ICON_TEMPLATE,
} from './oaao-rui-icons.js';
import {
    countMaterialsFromMeta,
    createTaskMaterialsToolbarIcon,
    openConversationMaterialsDialog,
    openTaskMaterialsDialog,
} from './task-materials-dialog.js';
import { oaaoLoadingLogoElement, oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';

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

/** Active shell workspace — {@link #workspace-view} {@code data-oaao-active-workspace-id}; empty ⇒ personal scope. */
function getOaaoActiveWorkspaceIdForChat() {
    const root = document.getElementById('workspace-view');
    const ds =
        typeof root?.dataset?.oaaoActiveWorkspaceId === 'string' ? root.dataset.oaaoActiveWorkspaceId.trim() : '';
    if (!ds) return null;
    const n = Number(ds);

    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** GET query fragment for scoped chat APIs (omitted when personal). */
function workspaceChatQueryParams() {
    const w = getOaaoActiveWorkspaceIdForChat();

    return w != null ? { workspace_id: String(w) } : {};
}

/** @type {Map<number, number | null>} */
const conversationWorkspaceById = new Map();

/**
 * @param {number} conversationId
 * @param {unknown} workspaceId
 */
function rememberConversationWorkspace(conversationId, workspaceId) {
    const cid = Math.floor(Number(conversationId));
    if (!Number.isFinite(cid) || cid < 1) return;
    const w = workspaceId == null || workspaceId === '' ? null : Math.floor(Number(workspaceId));
    conversationWorkspaceById.set(cid, w != null && Number.isFinite(w) && w > 0 ? w : null);
}

/**
 * Scope for thread APIs — prefer the conversation row's workspace over the shell default.
 *
 * @param {number} conversationId
 */
function chatScopeParamsForConversation(conversationId) {
    const cid = Math.floor(Number(conversationId));
    if (!Number.isFinite(cid) || cid < 1) {
        return workspaceChatQueryParams();
    }
    const cached = cachedConversations.find((r) => Number(r.id) === cid);
    const cachedWid =
        cached?.workspace_id != null && Number(cached.workspace_id) > 0
            ? Math.floor(Number(cached.workspace_id))
            : null;
    const remembered = conversationWorkspaceById.has(cid) ? conversationWorkspaceById.get(cid) : undefined;
    const rowWid = cachedWid ?? (remembered !== undefined ? remembered : null);
    if (rowWid != null && rowWid > 0) {
        return { workspace_id: String(rowWid) };
    }

    // Personal thread (workspace_id IS NULL) — never send shell workspace_id on GET APIs.
    return {};
}

/** POST JSON scope fields for a specific conversation (mirrors {@link chatScopeParamsForConversation}). */
function chatScopeBodyFieldsForConversation(conversationId) {
    const params = chatScopeParamsForConversation(conversationId);
    const body = {};
    if (params.workspace_id != null && String(params.workspace_id).trim() !== '') {
        body.workspace_id = Number(params.workspace_id);
    }
    return body;
}

/** POST JSON fields for scoped chat APIs (empty object when personal). */
function workspaceChatBodyFields() {
    const w = getOaaoActiveWorkspaceIdForChat();

    return w != null ? { workspace_id: w } : {};
}

/** Wait for shell boot {@code /chat/api/workspaces} validation ({@see workspace.js fetchWorkspaceList}). */
function awaitWorkspaceListReady() {
    if (typeof document !== 'undefined' && document.body?.dataset?.oaaoWorkspaceListReady === '1') {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const done = () => resolve(undefined);
        const t = window.setTimeout(done, 8000);
        document.addEventListener(
            'oaao-workspace-list-ready',
            () => {
                window.clearTimeout(t);
                done();
            },
            { once: true },
        );
    });
}

/** Vault API root — mirrors {@link vault-panel.js} {@code vaultApiBase}. */
function vaultApiBaseForChat() {
    const authBase = (typeof document !== 'undefined' && document.body?.dataset?.authBase)?.trim() ?? '';
    if (authBase) {
        try {
            const u = new URL(authBase, window.location.href);
            let rootPath = u.pathname.replace(/\/?$/, '');
            rootPath = rootPath.replace(/\/auth$/i, '') || '/';
            if (!rootPath.endsWith('/')) rootPath += '/';

            return `${rootPath}vault/api/`;
        } catch {
            /* fall through */
        }
    }

    return '/vault/api/';
}

/** @returns {Promise<Record<string, unknown>>} */
async function fetchVaultTreeJsonForChatComposer(opts = {}) {
    const base = vaultApiBaseForChat();
    const wid = getOaaoActiveWorkspaceIdForChat();
    const url = oaaoPrefixedSitePath('/webassets/core/default/js/vault-tree-cache.js');
    const cache = await import(/* webpackIgnore: true */ url);
    const buildUrl = () => {
        const q = wid != null ? `?workspace_id=${encodeURIComponent(String(wid))}` : '';
        return `${base}vault_tree${q}`;
    };
    const j = await cache.fetchVaultTreeCached(wid, buildUrl, { force: opts.force === true });

    return j && typeof j === 'object' ? j : {};
}

/** Composer vault source picker — aligned with {@link vault-panel.js} sidebar locale helper. */
const CHAT_VAULT_SOURCE_UI = {
    dialog_title: { en: 'Select sources', 'zh-Hant': '選擇來源' },
    dialog_hint: {
        en: 'Pick embedded vault items (whole vault, a folder, or single files) to narrow retrieval for this message. Use search to filter.',
        'zh-Hant':
            '選擇已向量化（embedded）的文件庫項目（整個保管庫、資料夾或單一檔案），以限定此則訊息的檢索範圍。可用搜尋框篩選列表。',
    },
    search_placeholder: { en: 'Filter by name or path…', 'zh-Hant': '依檔名或範圍篩選…' },
    list_group_aria: { en: 'Knowledge sources', 'zh-Hant': '知識來源列表' },
    trigger_aria_auto: {
        en: 'Auto Source — searches all embedded vaults in this workspace when you send (open to pick specific files)',
        'zh-Hant': '自動來源 — 送出時會搜尋此工作區內所有已向量化保管庫（可點開改選特定檔案）',
    },
    trigger_aria_direct: {
        en: 'Direct reply — no vault search (turn on Auto vault RAG, or pick specific files)',
        'zh-Hant': '直接回覆 — 不搜尋保管庫（可勾選自動保管庫 RAG，或手動選檔）',
    },
    auto_source: { en: 'Auto Source', 'zh-Hant': '自動來源' },
    direct_source: { en: 'Direct', 'zh-Hant': '直接回覆' },
    items_selected: { en: '{{n}} items selected', 'zh-Hant': '已選 {{n}} 個檔案' },
    item_selected_one: { en: '1 item selected', 'zh-Hant': '已選 1 個檔案' },
    empty_scope: { en: 'No vaults in this scope', 'zh-Hant': '此範圍尚無保管庫' },
    load_failed: { en: 'Could not load vault tree', 'zh-Hant': '無法載入保管庫' },
    cancel: { en: 'Cancel', 'zh-Hant': '取消' },
    apply: { en: 'Apply', 'zh-Hant': '套用' },
    scope_label: { en: 'Scope', 'zh-Hant': '範圍' },
    scope_personal: { en: 'personal', 'zh-Hant': '個人' },
    scope_workspace: { en: 'workspace', 'zh-Hant': '工作區' },
    type_vault: { en: 'Vault', 'zh-Hant': '保管庫' },
    type_folder: { en: 'Folder', 'zh-Hant': '資料夾' },
    type_file: { en: 'File', 'zh-Hant': '檔案' },
};

function chatVaultSourceUiLang() {
    const raw = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
    if (raw.startsWith('zh')) return 'zh-Hant';

    return 'en';
}

/** @param {keyof typeof CHAT_VAULT_SOURCE_UI} key */
function chatVaultSourceUiString(key) {
    const row = CHAT_VAULT_SOURCE_UI[key];
    if (!row) return '';
    const lang = chatVaultSourceUiLang();

    return row[lang] ?? row.en ?? '';
}

/**
 * Visible trigger copy — {@code n} is the union count of embedded file ids covered by checked scopes.
 *
 * @param {number} n
 */
function chatVaultSourceItemsSelectedLabel(n) {
    const nf = Math.max(0, Math.floor(Number(n)));
    if (nf === 1) return chatVaultSourceUiString('item_selected_one');

    return chatVaultSourceUiString('items_selected').replace(/\{\{\s*n\s*\}\}/g, String(nf));
}

/**
 * @typedef {{ refKey: string, kind: 'vault'|'folder'|'document', id: number, vault_id: number, name: string, breadcrumb: string, scopePersonal: boolean, embeddedDocIds: Set<number> }} ChatVaultPickerRow
 */

/**
 * @typedef {{ kind: 'vault'|'folder'|'document', id: number, vault_id: number, name: string }} ChatVaultSourceRefPayload
 */

/**
 * Walk {@code vault_tree} payload into flat selectable rows. Documents list only {@code embedded}
 * rows so retrieval scope matches vectorised content.
 *
 * @param {unknown[]} tree
 * @param {boolean} scopePersonal
 * @returns {ChatVaultPickerRow[]}
 */
function flattenVaultTreeForChatSources(tree, scopePersonal) {
    /** @type {ChatVaultPickerRow[]} */
    const out = [];

    /**
     * Embedded document ids under a vault-child subtree ({@code container} + {@code document} nodes).
     *
     * @param {unknown[]} children
     * @returns {Set<number>}
     */
    function collectEmbeddedDocIdsUnder(children) {
        const ids = new Set();
        if (!Array.isArray(children)) return ids;
        for (const raw of children) {
            if (!raw || typeof raw !== 'object') continue;
            const node = /** @type {Record<string, unknown>} */ (raw);
            const k = String(node.kind ?? '');
            if (k === 'container') {
                const merged = collectEmbeddedDocIdsUnder(Array.isArray(node.children) ? node.children : []);
                for (const x of merged) ids.add(x);
            } else if (k === 'document' && String(node.embed_status ?? '') === 'embedded') {
                const did = Number(node.id);
                if (Number.isFinite(did) && did > 0) ids.add(did);
            }
        }

        return ids;
    }

    /**
     * @param {unknown[]} children
     * @param {number} vaultId
     * @param {string} pathPrefix
     */
    function walkChildren(children, vaultId, pathPrefix) {
        if (!Array.isArray(children)) return;
        for (const raw of children) {
            if (!raw || typeof raw !== 'object') continue;
            const node = /** @type {Record<string, unknown>} */ (raw);
            const k = String(node.kind ?? '');
            if (k === 'container') {
                const cid = Number(node.id);
                if (!Number.isFinite(cid) || cid < 1) continue;
                const nm = typeof node.name === 'string' ? node.name : `Folder ${cid}`;
                const crumb = `${pathPrefix} › ${nm}`;
                const kidArr = Array.isArray(node.children) ? node.children : [];
                const under = collectEmbeddedDocIdsUnder(kidArr);
                out.push({
                    refKey: `folder:${cid}`,
                    kind: 'folder',
                    id: cid,
                    vault_id: vaultId,
                    name: nm,
                    breadcrumb: crumb,
                    scopePersonal,
                    embeddedDocIds: under,
                });
                walkChildren(kidArr, vaultId, crumb);
            } else if (k === 'document') {
                if (String(node.embed_status ?? '') !== 'embedded') continue;
                const did = Number(node.id);
                if (!Number.isFinite(did) || did < 1) continue;
                const fn = typeof node.file_name === 'string' ? node.file_name : `Document ${did}`;
                const crumb = `${pathPrefix} › ${fn}`;
                out.push({
                    refKey: `document:${did}`,
                    kind: 'document',
                    id: did,
                    vault_id: vaultId,
                    name: fn,
                    breadcrumb: crumb,
                    scopePersonal,
                    embeddedDocIds: new Set([did]),
                });
            }
        }
    }

    for (const raw of tree) {
        if (!raw || typeof raw !== 'object') continue;
        const node = /** @type {Record<string, unknown>} */ (raw);
        if (String(node.kind ?? '') !== 'vault') continue;
        const vid = Number(node.id);
        if (!Number.isFinite(vid) || vid < 1) continue;
        const vname = typeof node.name === 'string' ? node.name : `Vault ${vid}`;
        const kidArr = Array.isArray(node.children) ? node.children : [];
        const under = collectEmbeddedDocIdsUnder(kidArr);
        out.push({
            refKey: `vault:${vid}`,
            kind: 'vault',
            id: vid,
            vault_id: vid,
            name: vname,
            breadcrumb: vname,
            scopePersonal,
            embeddedDocIds: under,
        });
        walkChildren(kidArr, vid, vname);
    }

    return out;
}

/**
 * Optional workspace-scoped auto RAG (all accessible vaults) — pairs with {@code vault_auto_rag} on send.
 *
 * @param {HTMLElement} host
 * @param {AbortSignal} signal
 */
const CHAT_COMPOSER_WEB_SEARCH_KEY = 'oaao.chat.composer.web_search';
const CHAT_COMPOSER_PLANNER_STEPS_KEY = 'oaao.chat.composer.planner_steps';

/** @type {boolean} */
let chatComposerWebSearchEnabled = false;
/** @type {boolean} */
let chatComposerShowPlannerSteps = true;

/**
 * @param {string} key
 * @param {boolean} defaultOn
 */
function readComposerTogglePreference(key, defaultOn) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === '1') return true;
        if (raw === '0') return false;
    } catch {
        /* ignore */
    }
    return defaultOn;
}

/**
 * @param {HTMLElement | Document} root
 */
function syncComposerPlannerStepsVisibility(root) {
    const hide = !chatComposerShowPlannerSteps;
    const mount =
        root.querySelector?.('[data-module="oaao-chat"]') ??
        (root instanceof HTMLElement && root.matches('[data-module="oaao-chat"]') ? root : document);
    mount.querySelectorAll('[data-oaao-chat="inline-task-steps"]').forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        el.hidden = hide;
        el.classList.toggle('hidden', hide);
    });
    const chatRoot = mount.querySelector?.('.oaao-chat-root') ?? document.querySelector('.oaao-chat-root');
    if (chatRoot instanceof HTMLElement) {
        chatRoot.classList.toggle('oaao-chat-root--planner-steps-off', hide);
    }
}

/**
 * @param {HTMLElement} host
 * @param {AbortSignal} signal
 */
function mountChatComposerFeatureToggles(host, signal) {
    chatComposerWebSearchEnabled = readComposerTogglePreference(CHAT_COMPOSER_WEB_SEARCH_KEY, false);
    chatComposerShowPlannerSteps = readComposerTogglePreference(CHAT_COMPOSER_PLANNER_STEPS_KEY, true);

    const btnClass =
        'oaao-chat-composer-toggle inline-flex items-center justify-center w-8 h-8 p-0 [border:1px_solid_var(--grid-line)] rounded-full bg-transparent fg-[var(--grid-ink-muted)] hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink)] cursor-pointer font-inherit shrink-0 transition-colors';

    /**
     * @param {{ id: string, iconEl: HTMLElement, title: string, pressed: boolean, onToggle: (on: boolean) => void }} spec
     */
    const makeToggle = (spec) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.oaaoComposerToggle = spec.id;
        btn.className = `${btnClass}${spec.pressed ? ' is-active' : ''}`;
        btn.setAttribute('aria-pressed', spec.pressed ? 'true' : 'false');
        btn.title = spec.title;
        btn.setAttribute('aria-label', spec.title);
        btn.append(spec.iconEl);
        btn.addEventListener(
            'click',
            () => {
                const next = !btn.classList.contains('is-active');
                btn.classList.toggle('is-active', next);
                btn.setAttribute('aria-pressed', next ? 'true' : 'false');
                spec.onToggle(next);
            },
            { signal },
        );
        return btn;
    };

    const webSearchBtn = makeToggle({
        id: 'web_search',
        iconEl: buildOaaoComposerToggleGlobeIcon(),
        title: oaaoChatT('workspace.composer.web_search', 'Web search'),
        pressed: chatComposerWebSearchEnabled,
        onToggle: (on) => {
            chatComposerWebSearchEnabled = on;
            try {
                localStorage.setItem(CHAT_COMPOSER_WEB_SEARCH_KEY, on ? '1' : '0');
            } catch {
                /* ignore */
            }
        },
    });

    const plannerStepsBtn = makeToggle({
        id: 'planner_steps',
        iconEl: buildOaaoComposerTogglePlannerIcon(),
        title: oaaoChatT('workspace.composer.planner_steps', 'Planner steps'),
        pressed: chatComposerShowPlannerSteps,
        onToggle: (on) => {
            chatComposerShowPlannerSteps = on;
            try {
                localStorage.setItem(CHAT_COMPOSER_PLANNER_STEPS_KEY, on ? '1' : '0');
            } catch {
                /* ignore */
            }
            syncComposerPlannerStepsVisibility(document);
            const cid = Number(activeConversationId ?? 0);
            if (on && cid > 0) {
                const state = getOaaoTaskListStateForConversation(cid);
                if (state.items.size > 0) {
                    renderOaaoTaskListForConversation(document, cid, state);
                }
            }
            scheduleChatComposerReserveSync();
        },
    });

    const plannerWrap = document.createElement('div');
    plannerWrap.dataset.oaaoChat = 'planner-mode-root';
    plannerWrap.className = 'shrink-0';
    plannerWrap.append(plannerStepsBtn);
    mountChatComposerPlannerModeDropup(plannerWrap, plannerStepsBtn, signal);

    host.replaceChildren(webSearchBtn, plannerWrap);
    syncComposerPlannerStepsVisibility(document);
}

/** @type {Array<{ id: 'default' | 'tot' | 'ddtree', label: string }>} */
const PLANNER_MODE_DROPUP_ROWS = [
    { id: 'default', label: 'Default' },
    { id: 'tot', label: 'ToT' },
    { id: 'ddtree', label: 'DDTree' },
];

/** @returns {string} */
function plannerModeDropupLabel(mode) {
    const hit = PLANNER_MODE_DROPUP_ROWS.find((row) => row.id === mode);
    return hit?.label ?? 'Default';
}

/**
 * Planner mode dropup — chevron above planner icon, menu opens upward.
 * @param {HTMLElement} root
 * @param {HTMLElement} iconBtn
 * @param {AbortSignal} signal
 */
function mountChatComposerPlannerModeDropup(root, iconBtn, signal) {
    const menuLabel = oaaoChatT('chat.planner_mode.label', 'Planner mode');
    const dropup = mountComposerDropupAbove(root, iconBtn, {
        signal,
        menuLabel,
        heading: oaaoChatT('chat.planner_mode.label', 'Planner'),
    });
    chatComposerPlannerModeDropup = dropup;

    const pickMode = (id) => {
        const normalized = normalizePlannerModeId(id);
        const cid = Number(activeConversationId) || 0;
        if (cid > 0) {
            persistPlannerMode(cid, normalized);
        } else {
            try {
                sessionStorage.setItem(OAAO_PLANNER_MODE_PENDING_KEY, normalized);
            } catch {
                /* ignore */
            }
        }
        syncChatComposerPlannerModeSelect();
        dropup.close();
    };

    const syncPanel = () => {
        const mode = readComposerPlannerModeForSend(activeConversationId);
        renderComposerDropupOptions(dropup.list, PLANNER_MODE_DROPUP_ROWS, mode, pickMode);
        const summary = `${menuLabel}: ${plannerModeDropupLabel(mode)}`;
        dropup.arrowBtn.title = summary;
        dropup.arrowBtn.setAttribute('aria-label', summary);
    };

    dropup.arrowBtn.addEventListener('click', syncPanel, { signal });
    syncPanel();
}

/** Sync composer planner dropup with active conversation. */
function syncChatComposerPlannerModeSelect() {
    const dropup = chatComposerPlannerModeDropup;
    if (!dropup) return;
    const mode = readComposerPlannerModeForSend(activeConversationId);
    const menuLabel = oaaoChatT('chat.planner_mode.label', 'Planner mode');
    const summary = `${menuLabel}: ${plannerModeDropupLabel(mode)}`;
    dropup.arrowBtn.title = summary;
    dropup.arrowBtn.setAttribute('aria-label', summary);
    if (dropup.isOpen()) {
        renderComposerDropupOptions(dropup.list, PLANNER_MODE_DROPUP_ROWS, mode, (id) => {
            const normalized = normalizePlannerModeId(id);
            const cid = Number(activeConversationId) || 0;
            if (cid > 0) {
                persistPlannerMode(cid, normalized);
            } else {
                try {
                    sessionStorage.setItem(OAAO_PLANNER_MODE_PENDING_KEY, normalized);
                } catch {
                    /* ignore */
                }
            }
            syncChatComposerPlannerModeSelect();
            dropup.close();
        });
    }
}

function mountVaultAutoRagToggle(host, signal) {
    chatComposerVaultAutoRag = readVaultAutoRagPreference();

    const row = document.createElement('label');
    row.dataset.oaaoChat = 'vault-auto-rag-toggle';
    row.className =
        'inline-flex flex-row items-center gap-1.5 shrink-0 cursor-pointer select-none font-inherit text-[0.625rem] leading-tight fg-[var(--grid-ink-muted)]';
    row.setAttribute('title', chatVaultAutoRagUiString('toggle_aria'));

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'shrink-0 m-0 cursor-pointer';
    cb.checked = chatComposerVaultAutoRag;
    cb.setAttribute('aria-label', chatVaultAutoRagUiString('toggle_aria'));

    const span = document.createElement('span');
    span.className = 'whitespace-nowrap';
    span.textContent = chatVaultAutoRagUiString('toggle_label');

    cb.addEventListener(
        'change',
        () => {
            chatComposerVaultAutoRag = Boolean(cb.checked);
            try {
                localStorage.setItem(CHAT_SCOPE_AUTO_RAG_KEY, chatComposerVaultAutoRag ? '1' : '0');
            } catch {
                /* ignore */
            }
            document.dispatchEvent(new CustomEvent('oaao:composer-vault-auto-rag-changed'));
        },
        { signal },
    );

    row.append(cb, span);
    host.append(row);
}

/**
 * Vault multi-select — always available from the composer extra toolbar ({@code mountChatComposerBuiltInVaultUi}).
 * Compact trigger opens RazyUI {@code Dialog} with checkbox list ({@see loadChatComposerDialogCtor}).
 *
 * @param {HTMLElement} host
 * @param {AbortSignal} signal
 * @param {(refs: ChatVaultSourceRefPayload[]) => void} onSourcesChange
 * @param {'composer_left' | 'composer_actions' | 'composer_extra_toolbar'} [zone]
 */
async function mountVaultSourceComposerSlot(host, signal, onSourcesChange, zone = 'composer_left') {
    host.textContent = '';
    /** @type {ChatVaultPickerRow[]} */
    let pickerRows = [];
    /** @type {boolean} */
    let lastVaultTreeLoadOk = false;
    let vaultTreeLoadAttempted = false;
    /** @type {Set<string>} */
    const selectedKeys = new Set();

    const wrap = document.createElement('div');
    wrap.setAttribute('data-oaao-chat', 'vault-source-slot');
    if (zone === 'composer_extra_toolbar') {
        wrap.className =
            'inline-flex flex-row flex-wrap items-center min-w-0 max-w-full fg-[var(--grid-ink-muted)] font-inherit text-[0.625rem] leading-tight';
    } else if (zone === 'composer_actions') {
        wrap.className =
            'inline-flex flex-row items-center gap-1 min-w-0 max-w-[min(100%,280px)] fg-[var(--grid-caption)] font-inherit text-[0.6875rem] leading-tight';
    } else {
        wrap.className =
            'inline-flex flex-col gap-1 min-w-0 max-w-[min(100%,280px)] fg-[var(--grid-caption)] font-inherit text-[0.75rem] leading-tight';
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className =
        zone === 'composer_extra_toolbar'
            ? 'inline-flex flex-row items-center gap-1 min-w-0 max-w-[min(100%,280px)] rounded-full border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)] px-2.5 py-1 text-[0.625rem] fw-medium font-inherit cursor-pointer hover:bg-[var(--grid-line)]/25 disabled:opacity-45 disabled:cursor-not-allowed'
            : zone === 'composer_actions'
              ? 'inline-flex items-center gap-1 min-w-0 max-w-[220px] truncate rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)] px-2 py-1 text-[0.6875rem] fw-medium font-inherit cursor-pointer hover:bg-[var(--grid-line)]/25 disabled:opacity-45 disabled:cursor-not-allowed'
              : 'inline-flex items-center gap-1 min-w-0 max-w-[260px] truncate rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)] px-2 py-1 text-[0.75rem] fw-medium font-inherit cursor-pointer hover:bg-[var(--grid-line)]/25 disabled:opacity-45 disabled:cursor-not-allowed';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');

    /**
     * @param {boolean} withChevron
     */
    function layoutVaultSourceTrigger(withChevron) {
        if (withChevron && zone === 'composer_extra_toolbar') {
            trigger.classList.remove('truncate');
        } else {
            trigger.classList.add('truncate');
        }
    }

    /**
     * Paint trigger label + optional dropdown chevron ({@code composer_extra_toolbar}).
     *
     * @param {string} visible
     * @param {boolean} btnDisabled
     */
    function paintVaultSourceTrigger(visible, btnDisabled) {
        const chevron = zone === 'composer_extra_toolbar' && !btnDisabled;
        layoutVaultSourceTrigger(Boolean(chevron));
        trigger.replaceChildren(document.createTextNode(visible));
        if (chevron) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '12');
            svg.setAttribute('height', '12');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute(
                'class',
                'block shrink-0 pointer-events-none fg-[var(--grid-ink-muted)] ml-0.5 mt-px opacity-85',
            );
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'm6 9 6 6 6-6');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            svg.append(path);
            trigger.append(svg);
        }
    }

    wrap.append(trigger);
    host.append(wrap);

    /**
     * Union of embedded file ids across checked vault / folder / document rows.
     *
     * @returns {number}
     */
    function unionEmbeddedFileCountForSelection() {
        /** @type {Set<number>} */
        const union = new Set();
        for (const key of selectedKeys) {
            const row = pickerRows.find((r) => r.refKey === key);
            if (!row?.embeddedDocIds) continue;
            for (const docId of row.embeddedDocIds) union.add(docId);
        }

        return union.size;
    }

    function pruneSelection() {
        for (const key of [...selectedKeys]) {
            if (!pickerRows.some((r) => r.refKey === key)) selectedKeys.delete(key);
        }
    }

    /** @returns {ChatVaultSourceRefPayload[]} */
    function buildPayloadRefs() {
        pruneSelection();
        /** @type {ChatVaultSourceRefPayload[]} */
        const refs = [];
        for (const row of pickerRows) {
            if (!selectedKeys.has(row.refKey)) continue;
            refs.push({
                kind: row.kind,
                id: row.id,
                vault_id: row.vault_id,
                name: row.name,
            });
        }
        refs.sort((a, b) => {
            const ak = `${a.kind}:${a.id}`;
            const bk = `${b.kind}:${b.id}`;

            return ak.localeCompare(bk);
        });
        onSourcesChange(refs);

        return refs;
    }

    function syncFromDom() {
        buildPayloadRefs();
    }

    /** @param {ChatVaultPickerRow['kind']} kind */
    function typeLabelForKind(kind) {
        if (kind === 'vault') return chatVaultSourceUiString('type_vault');
        if (kind === 'folder') return chatVaultSourceUiString('type_folder');

        return chatVaultSourceUiString('type_file');
    }

    /** @param {ChatVaultPickerRow} row */
    function pillClassForKind(row) {
        if (row.kind === 'vault') {
            return 'shrink-0 inline-flex items-center rounded-[4px] border-[1px] border-solid border-[var(--grid-accent)]/40 bg-[var(--grid-accent)]/10 px-1 py-0 text-[0.625rem] fw-semibold tracking-wide fg-[var(--grid-accent)]';
        }
        if (row.kind === 'folder') {
            return 'shrink-0 inline-flex items-center rounded-[4px] border-[1px] border-solid border-[#b45309]/35 bg-[#b45309]/8 px-1 py-0 text-[0.625rem] fw-semibold tracking-wide fg-[#b45309]';
        }

        return 'shrink-0 inline-flex items-center rounded-[4px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-1 py-0 text-[0.625rem] fw-semibold tracking-wide fg-[var(--grid-caption)]';
    }

    function updateTriggerLabel() {
        if (pickerRows.length === 0) {
            if (!vaultTreeLoadAttempted) {
                trigger.disabled = false;
                const autoMode = chatComposerVaultAutoRag;
                paintVaultSourceTrigger(
                    chatVaultSourceUiString(autoMode ? 'auto_source' : 'direct_source'),
                    false,
                );
                trigger.setAttribute(
                    'aria-label',
                    chatVaultSourceUiString(autoMode ? 'trigger_aria_auto' : 'trigger_aria_direct'),
                );

                return;
            }

            trigger.disabled = true;
            const fail = lastVaultTreeLoadOk ? chatVaultSourceUiString('empty_scope') : chatVaultSourceUiString('load_failed');
            paintVaultSourceTrigger(fail, true);
            trigger.setAttribute('aria-label', fail);

            return;
        }

        trigger.disabled = false;
        const selectionCount = selectedKeys.size;
        let visible;
        let aria;
        if (selectionCount === 0) {
            if (chatComposerVaultAutoRag) {
                visible = chatVaultSourceUiString('auto_source');
                aria = chatVaultSourceUiString('trigger_aria_auto');
            } else {
                visible = chatVaultSourceUiString('direct_source');
                aria = chatVaultSourceUiString('trigger_aria_direct');
            }
        } else {
            const fileUnion = unionEmbeddedFileCountForSelection();
            visible = chatVaultSourceItemsSelectedLabel(fileUnion);
            aria = visible;
        }

        paintVaultSourceTrigger(visible, false);
        trigger.setAttribute('aria-label', aria);
    }

    async function openPickerDialog() {
        if (signal.aborted || trigger.disabled) return;

        await refill();
        if (signal.aborted) return;

        if (pickerRows.length === 0) {
            const fail = lastVaultTreeLoadOk
                ? chatVaultSourceUiString('empty_scope')
                : chatVaultSourceUiString('load_failed');
            void loadChatComposerDialogCtor().then((Dialog) => {
                if (typeof Dialog !== 'function') return;
                void new Dialog({
                    title: chatVaultSourceUiString('dialog_title'),
                    content: fail,
                    size: 'sm',
                    closable: true,
                    buttons: [{ text: chatVaultSourceUiString('cancel'), color: 'muted', role: 'cancel' }],
                });
            });

            return;
        }

        const Dialog = await loadChatComposerDialogCtor();
        if (signal.aborted || typeof Dialog !== 'function') return;

        /** @type {Set<string>} */
        const draft = new Set(selectedKeys);

        const body = document.createElement('div');
        body.className = 'flex flex-col gap-2 min-h-0 max-h-[min(460px,calc(100vh-10rem))]';

        const hint = document.createElement('p');
        hint.className = 'text-[0.72rem] fg-[var(--grid-caption)] m-0 leading-snug shrink-0';
        hint.textContent = chatVaultSourceUiString('dialog_hint');
        body.append(hint);

        const search = document.createElement('input');
        search.type = 'search';
        search.className =
            'shrink-0 w-full rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-2 py-1.5 text-[0.8125rem] font-inherit fg-[var(--grid-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--grid-accent)]/35';
        search.placeholder = chatVaultSourceUiString('search_placeholder');
        search.setAttribute('aria-label', chatVaultSourceUiString('search_placeholder'));
        body.append(search);

        const list = document.createElement('div');
        list.className =
            'flex flex-col gap-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 max-h-[min(340px,calc(100vh-13rem))]';
        list.setAttribute('role', 'group');
        list.setAttribute('aria-label', chatVaultSourceUiString('list_group_aria'));

        /**
         * @param {string} q
         */
        function applySearchFilter(q) {
            const ql = q.trim().toLowerCase();
            for (const lab of list.children) {
                if (!(lab instanceof HTMLElement)) continue;
                const hay = (lab.dataset.oaaoHaystack ?? '').toLowerCase();
                const show = ql === '' || hay.includes(ql);
                lab.classList.toggle('hidden', !show);
            }
        }

        for (const row of pickerRows) {
            const lab = document.createElement('label');
            lab.className =
                'flex items-start gap-2 cursor-pointer rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-2 py-2 hover:bg-[var(--grid-line)]/10';
            const typeL = typeLabelForKind(row.kind);
            const scopeWord = row.scopePersonal
                ? chatVaultSourceUiString('scope_personal')
                : chatVaultSourceUiString('scope_workspace');
            const scopeLine = `${chatVaultSourceUiString('scope_label')}: ${scopeWord}`;
            lab.dataset.oaaoHaystack = `${typeL} ${row.name} ${row.breadcrumb} ${scopeWord}`.toLowerCase();

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'mt-1 shrink-0';
            cb.checked = draft.has(row.refKey);
            cb.addEventListener('change', () => {
                if (cb.checked) draft.add(row.refKey);
                else draft.delete(row.refKey);
            });

            const col = document.createElement('span');
            col.className = 'flex flex-col gap-1 min-w-0 flex-1';

            const head = document.createElement('span');
            head.className = 'flex items-start gap-2 min-w-0';

            const pill = document.createElement('span');
            pill.className = pillClassForKind(row);
            pill.textContent = typeL;

            const title = document.createElement('span');
            title.className =
                'min-w-0 flex-1 text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] leading-snug break-words';
            title.textContent = row.name;

            head.append(pill, title);

            const sub = document.createElement('span');
            sub.className = 'text-[0.6875rem] fg-[var(--grid-caption)] leading-snug break-words pl-0';
            sub.textContent = `${scopeLine} · ${row.breadcrumb}`;

            col.append(head, sub);
            lab.append(cb, col);
            list.append(lab);
        }

        search.addEventListener('input', () => applySearchFilter(search.value));

        body.append(list);

        void new Dialog({
            title: chatVaultSourceUiString('dialog_title'),
            content: body,
            size: 'sm',
            closable: true,
            buttons: [
                { text: chatVaultSourceUiString('cancel'), color: 'muted', role: 'cancel' },
                {
                    text: chatVaultSourceUiString('apply'),
                    color: 'accent',
                    close: false,
                    /** @param {{ close: () => void }} ctrl */
                    action: async (ctrl) => {
                        selectedKeys.clear();
                        draft.forEach((k) => selectedKeys.add(k));
                        syncFromDom();
                        updateTriggerLabel();
                        ctrl.close();
                    },
                },
            ],
            /** @param {{ close: () => void }} _c */
            onOpen(_c) {
                trigger.setAttribute('aria-expanded', 'true');
            },
            onClose() {
                trigger.setAttribute('aria-expanded', 'false');
            },
        });
    }

    trigger.addEventListener(
        'click',
        () => {
            void openPickerDialog();
        },
        { signal },
    );

    /**
     * @param {{ kind: string, id: number, vault_id: number, name?: string }} ref
     */
    function chatSourceRefKey(ref) {
        if (ref.kind === 'vault') return `vault:${ref.id}`;
        if (ref.kind === 'folder') return `folder:${ref.id}`;

        return `document:${ref.id}`;
    }

    document.addEventListener(
        'oaao:vault-chat-sources-changed',
        (ev) => {
            const ce = /** @type {CustomEvent} */ (ev);
            const raw = ce.detail?.refs;
            if (!Array.isArray(raw)) return;

            /** @type {ChatVaultSourceRefPayload[]} */
            const refs = [];
            selectedKeys.clear();
            for (const row of raw) {
                if (!row || typeof row !== 'object') continue;
                const kind = String(row.kind ?? '');
                if (kind !== 'vault' && kind !== 'folder' && kind !== 'document') continue;
                const id = Math.floor(Number(row.id ?? 0));
                const vaultId = Math.floor(Number(row.vault_id ?? 0));
                if (!Number.isFinite(id) || id < 1 || !Number.isFinite(vaultId) || vaultId < 1) continue;
                const name = typeof row.name === 'string' ? row.name : '';
                /** @type {ChatVaultSourceRefPayload} */
                const ref = {
                    kind: /** @type {'vault'|'folder'|'document'} */ (kind),
                    id,
                    vault_id: vaultId,
                    name,
                };
                refs.push(ref);
                selectedKeys.add(chatSourceRefKey(ref));
            }
            onSourcesChange(refs);
            updateTriggerLabel();
        },
        { signal },
    );

    async function refill() {
        if (signal.aborted) return;

        vaultTreeLoadAttempted = true;
        const j = await fetchVaultTreeJsonForChatComposer();
        if (signal.aborted) return;

        const tree =
            j &&
            typeof j === 'object' &&
            'data' in j &&
            j.data &&
            typeof j.data === 'object' &&
            'tree' in j.data &&
            Array.isArray(j.data.tree)
                ? j.data.tree
                : null;

        const scopePersonal =
            j &&
            typeof j === 'object' &&
            'data' in j &&
            j.data &&
            typeof j.data === 'object' &&
            'scope' in j.data &&
            j.data.scope &&
            typeof j.data.scope === 'object' &&
            j.data.scope.personal === true;

        pickerRows = [];
        if (!tree || j.success !== true) {
            lastVaultTreeLoadOk = false;
            syncFromDom();
            updateTriggerLabel();

            return;
        }

        lastVaultTreeLoadOk = true;
        pickerRows = flattenVaultTreeForChatSources(tree, scopePersonal);

        pruneSelection();
        syncFromDom();
        updateTriggerLabel();
    }

    document.addEventListener(
        'oaao-workspace-scope-changed',
        () => {
            pickerRows = [];
            vaultTreeLoadAttempted = false;
            lastVaultTreeLoadOk = false;
            selectedKeys.clear();
            void import(/* webpackIgnore: true */ oaaoPrefixedSitePath('/webassets/core/default/js/vault-tree-cache.js')).then(
                (m) => m.invalidateVaultTreeCache(),
            );
            syncFromDom();
            updateTriggerLabel();
        },
        { signal },
    );

    document.addEventListener('oaao:composer-vault-auto-rag-changed', () => updateTriggerLabel(), { signal });

    syncFromDom();
    updateTriggerLabel();
}

/**
 * Target region for {@code kind: composer_slot} rows ({@code composer_zone} on registry JSON).
 *
 * @param {Record<string, unknown>} row
 * @returns {'composer_left' | 'composer_actions' | 'composer_extra_toolbar'}
 */
function composerSlotZoneFromRow(row) {
    const z =
        row && typeof row === 'object' && typeof row.composer_zone === 'string'
            ? row.composer_zone.trim()
            : '';
    if (z === 'composer_actions' || z === 'composer_extra_toolbar') return z;

    return 'composer_left';
}

/** Syncs extra-toolbar strip + {@code data-oaao-composer-toolbar} on the card ({@see oaao-chat-shell.css}). */
function syncComposerExtraToolbarVisibility(mount) {
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

/** @type {Map<string, Promise<Record<string, unknown> | null>>} */
const composerSlotModuleByUrl = new Map();

function oaaoAppendShellEsmV(url) {
    const u = String(url ?? '').trim();
    const v = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
    if (!u || !v) return u;
    const join = u.includes('?') ? '&' : '?';

    return `${u}${join}v=${encodeURIComponent(v)}`;
}

/**
 * @param {string} esmUrl
 */
function loadComposerSlotModule(esmUrl) {
    const base = esmUrl.trim();
    if (!base) return Promise.resolve(null);
    const v = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
    const key = v ? `${base}?v=${v}` : base;
    let pending = composerSlotModuleByUrl.get(key);
    if (!pending) {
        const url = oaaoAppendShellEsmV(oaaoPrefixedSitePath(base.startsWith('/') ? base : `/${base}`));
        pending = import(/* webpackIgnore: true */ url).catch(() => null);
        composerSlotModuleByUrl.set(key, pending);
    }

    return pending;
}

/**
 * Composer slots from frozen {@code OAAO_CHAT_PIPELINE_REGISTRY} ({@code chat_pipeline.register}, {@code kind: composer_slot}).
 *
 * Zones: {@code composer_left}, {@code composer_actions}, {@code composer_extra_toolbar} ({@code extras.composer_zone}).
 *
 * @param {HTMLElement} mount
 * @param {AbortSignal} signal
 * @param {(refs: ChatVaultSourceRefPayload[]) => void} onVaultSourcesChange
 * @param {Record<string, unknown>} [slotCtx]
 */
function mountChatComposerRegistrySlots(mount, signal, onVaultSourcesChange, slotCtx = {}) {
    const leftHost = mount.querySelector('[data-oaao-chat="composer-registry-slots-left"]');
    const actionsHost = mount.querySelector('[data-oaao-chat="composer-registry-slots-actions"]');
    const extraHost = mount.querySelector('[data-oaao-chat="composer-registry-extra-toolbar"]');

    const reg = Array.isArray(globalThis.OAAO_CHAT_PIPELINE_REGISTRY)
        ? globalThis.OAAO_CHAT_PIPELINE_REGISTRY
        : [];
    const slots = reg.filter((r) => r && typeof r === 'object' && String(r.kind) === 'composer_slot');
    slots.sort((a, b) => (Number(a.sort) || 500) - (Number(b.sort) || 500));

    for (const row of slots) {
        const zone = composerSlotZoneFromRow(row);
        /** @type {HTMLElement | null} */
        let host = leftHost;

        if (zone === 'composer_actions') host = actionsHost;
        else if (zone === 'composer_extra_toolbar') host = extraHost;

        if (!(host instanceof HTMLElement)) continue;

        const id = String(row.entry_id || '');
        /** Vault source mounts via {@link mountChatComposerBuiltInVaultUi}. */
        if (id === 'cp.vault.source_selector') {
            continue;
        }
        /** PPTX import — {@code workspace/templates} gallery only; Chat uses {@code /template} slug in composer. */
        if (id === 'cp.slide_designer.template_import') {
            continue;
        }

        const esm = String(row.esm_url ?? '').trim();
        if (!esm) continue;

        const slotHost = document.createElement('span');
        slotHost.className = 'inline-flex shrink-0 items-center';
        slotHost.dataset.oaaoComposerSlot = id;
        host.append(slotHost);

        void (async () => {
            const mod = await loadComposerSlotModule(esm);
            if (signal.aborted || !(slotHost.isConnected)) return;
            if (!mod || typeof mod !== 'object') return;

            /** @type {Record<string, unknown>} */
            const ctx = {
                ...slotCtx,
                signal,
            };

            if (id === 'cp.rag.attachment' && typeof mod.mountRagComposerAttach === 'function') {
                mod.mountRagComposerAttach(slotHost, ctx);
            } else if (id === 'cp.rag.voice_input' && typeof mod.mountRagComposerVoice === 'function') {
                mod.mountRagComposerVoice(slotHost, ctx);
            }
        })();
    }

    syncComposerExtraToolbarVisibility(mount);
}

/**
 * Built-in vault source picker + auto RAG toggle — does not depend on frozen registry rows.
 *
 * @param {HTMLElement} mount
 * @param {AbortSignal} signal
 * @param {(refs: ChatVaultSourceRefPayload[]) => void} onVaultSourcesChange
 */
function mountChatComposerBuiltInVaultUi(mount, signal, onVaultSourcesChange) {
    const extraHost = mount.querySelector('[data-oaao-chat="composer-registry-extra-toolbar"]');
    if (extraHost instanceof HTMLElement) {
        mountVaultAutoRagToggle(extraHost, signal);
        void mountVaultSourceComposerSlot(extraHost, signal, onVaultSourcesChange, 'composer_extra_toolbar');
        syncComposerExtraToolbarVisibility(mount);
    }
}

/** @type {((spec: string) => string) | null} */
let chatOrchestratorUrlResolver = null;

async function resolveChatOrchestratorStreamUrl(spec) {
    if (!chatOrchestratorUrlResolver) {
        try {
            const m = await import(
                /* webpackIgnore: true */ oaaoPrefixedSitePath('/webassets/core/default/js/shell-registry-url.js')
            );
            chatOrchestratorUrlResolver =
                typeof m.resolveOrchestratorPublicUrl === 'function' ? m.resolveOrchestratorPublicUrl : (s) => s;
        } catch {
            chatOrchestratorUrlResolver = (s) => s;
        }
    }
    return chatOrchestratorUrlResolver(String(spec ?? '').trim());
}

/** Prefix root-relative paths when the SPA sits under {@code data-oaao-mount-prefix} ({@see shell-registry-url.js}). */
function oaaoPrefixedSitePath(pathOnly) {
    const raw = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    const path = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
    if (!raw || raw === '/') return path;
    const prefix = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/{2,}/g, '/').replace(/\/$/, '');
    if (!prefix) return path;
    if (path === prefix || path.startsWith(`${prefix}/`)) return path;

    return `${prefix}${path}`;
}

/** Lazy-loaded RazyUI {@code MarkdownHelpers} — {@link parseSafe}, KaTeX, streaming peel. */
/** @type {Promise<Record<string, unknown>> | null} */
let chatMarkdownHelpersPromise = null;

function loadChatMarkdownHelpers() {
    if (!chatMarkdownHelpersPromise) {
        const url = oaaoPrefixedSitePath('/webassets/core/default/razyui/component/MarkdownHelpers.js');
        chatMarkdownHelpersPromise = import(/* webpackIgnore: true */ url);
    }

    return chatMarkdownHelpersPromise;
}

/** @type {Record<string, Function> | null} */
let chatMd = null;

const CHAT_MD_PARSE_OPTS = { preset: 'oaao-chat' };

/** @param {string} md */
function chatParseSafeMarkdown(md) {
    return /** @type {Function} */ (chatMd.parseSafe)(md, CHAT_MD_PARSE_OPTS);
}

/**
 * Parse one stable stream token — lightweight only (no {@link parseSafe} per delta).
 *
 * @param {{ kind: 'code' | 'md', raw: string }} token
 */
function chatParseStreamToken(token) {
    if (token.kind === 'code') {
        return `<pre class="oaao-md-pre"><code>${escapeHtmlLite(token.raw)}</code></pre>`;
    }

    return oaaoLightweightMarkdownToHtml(token.raw);
}

/** @param {HTMLElement} bubble */
function hydrateChatMarkdownMath(bubble) {
    void /** @type {Function} */ (chatMd.renderMathInElement)(bubble);
}

/** @param {string} md */
function assistantTextNeedsMathRender(md) {
    return /\\\(|\\\[|\$\$|(?<!\$)\$(?!\$)/.test(String(md ?? ''));
}

/** @param {string} s */
function escapeHtmlLite(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @param {string} s */
function escapeAttrLite(s) {
    return escapeHtmlLite(s).replace(/'/g, '&#39;');
}

/** List line: optional indent + marker + body ({@see RazyUI parseInline} math slots). */
const OAAO_LITE_LIST_LINE_RE = /^(\s*)([-*+•·◦]|\d+\.)\s+(.*)$/;

/**
 * @param {string} line
 * @param {RegExpMatchArray} m
 * @param {{ marker: string, content: string, depth: number } | null} prev
 */
function oaaoLiteListItemDepth(line, m, prev) {
    const indent = m[1].length;
    if (indent >= 2) {
        return Math.min(6, Math.floor(indent / 2));
    }

    const marker = m[2];
    if (
        prev &&
        (marker === '*' || marker === '+') &&
        (prev.marker === '•' || prev.marker === '-' || prev.marker === '*' || prev.marker === '+') &&
        /[:：]\s*$/.test(String(prev.content).trimEnd()) &&
        indent === 0
    ) {
        return prev.depth + 1;
    }

    return 0;
}

/**
 * @param {Array<{ depth: number, ordered: boolean, content: string }>} items
 */
function oaaoRenderLiteListHtml(items) {
    if (!items.length) {
        return '';
    }

    /**
     * @param {number} depth
     * @param {number} from
     * @returns {{ html: string, next: number }}
     */
    function renderLevel(depth, from) {
        let html = '';
        let i = from;
        if (i >= items.length || items[i].depth !== depth) {
            return { html: '', next: i };
        }

        const tag = items[i].ordered ? 'ol' : 'ul';
        html += `<${tag}>`;

        while (i < items.length && items[i].depth === depth) {
            html += `<li>${parseInlineLite(items[i].content)}`;
            i += 1;
            if (i < items.length && items[i].depth > depth) {
                const nested = renderLevel(depth + 1, i);
                html += nested.html;
                i = nested.next;
            }
            html += '</li>';
        }

        html += `</${tag}>`;
        return { html, next: i };
    }

    const minDepth = Math.min(...items.map((it) => it.depth));
    return renderLevel(minDepth, 0).html;
}

/** @param {string} text */
function parseInlineLite(text) {
    let t = escapeHtmlLite(text);

    /** @type {string[]} */
    const codeSlots = [];
    t = t.replace(/`([^`]+)`/g, (_, code) => {
        codeSlots.push(`<code>${code}</code>`);
        return `\x00C${codeSlots.length - 1}\x00`;
    });

    /** @type {string[]} */
    const mathSlots = [];
    t = t.replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (_, expr) => {
        mathSlots.push(
            `<span class="math-inline" data-math="${escapeAttrLite(expr)}">${escapeHtmlLite(expr)}</span>`,
        );
        return `\x00M${mathSlots.length - 1}\x00`;
    });
    t = t.replace(/\\\(([^)]+?)\\\)/g, (_, expr) => {
        mathSlots.push(
            `<span class="math-inline" data-math="${escapeAttrLite(expr)}">${escapeHtmlLite(expr)}</span>`,
        );
        return `\x00M${mathSlots.length - 1}\x00`;
    });

    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\x00M(\d+)\x00/g, (_, i) => mathSlots[Number(i)] ?? '');
    t = t.replace(/\x00C(\d+)\x00/g, (_, i) => codeSlots[Number(i)] ?? '');
    return t;
}

/** @param {string} line */
function isLiteTableSeparatorLine(line) {
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line ?? '').trim());
}

/** @param {string[]} tableLines */
function renderLiteTable(tableLines) {
    const rows = tableLines
        .map((row) =>
            String(row ?? '')
                .trim()
                .replace(/^\|/, '')
                .replace(/\|$/, '')
                .split('|')
                .map((c) => c.trim()),
        )
        .filter((cells) => cells.some((c) => c !== ''));
    if (rows.length < 2) {
        return `<p>${escapeHtmlLite(tableLines.join(' '))}</p>`;
    }

    const bodyRows = isLiteTableSeparatorLine(tableLines[1]) ? rows.slice(2) : rows.slice(1);
    const head = rows[0];
    let out =
        '<div class="oaao-md-table-wrap"><table class="oaao-md-table"><thead><tr>';
    for (const cell of head) {
        out += `<th>${parseInlineLite(cell)}</th>`;
    }
    out += '</tr></thead><tbody>';
    for (const row of bodyRows) {
        out += '<tr>';
        for (let c = 0; c < head.length; c += 1) {
            out += `<td>${parseInlineLite(row[c] ?? '')}</td>`;
        }
        out += '</tr>';
    }
    out += '</tbody></table></div>';
    return out;
}

/**
 * Render assistant markdown → HTML (fenced code + prose).
 *
 * @param {string} md
 */
function renderAssistantMarkdownHtml(md) {
    const text = String(md ?? '');
    if (!text.trim()) return '';
    if (chatMd && typeof chatMd.tokenizeStableStreamChunks === 'function') {
        const tokens = /** @type {Function} */ (chatMd.tokenizeStableStreamChunks)(text);
        return tokens.map((t) => chatParseStreamToken(t)).join('');
    }
    return oaaoLightweightMarkdownToHtml(text);
}

/**
 * Fast O(n) markdown for assistant replies — avoids RazyUI {@link parseSafe} full re-parses that
 * freeze the main thread on ``\\n\\n`` + headings mid-stream / at stream end.
 *
 * @param {string} md
 */
function oaaoLightweightMarkdownToHtml(md) {
    const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
    /** @type {string[]} */
    const html = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            i += 1;
            continue;
        }

        if (/^```/.test(line.trim())) {
            i += 1;
            /** @type {string[]} */
            const codeLines = [];
            while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
                codeLines.push(lines[i]);
                i += 1;
            }
            if (i < lines.length && /^```/.test(lines[i].trim())) {
                i += 1;
            }
            html.push(`<pre class="oaao-md-pre"><code>${escapeHtmlLite(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        if (
            /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim()) &&
            (i === 0 || !lines[i - 1].trim()) &&
            (i + 1 >= lines.length || !lines[i + 1].trim())
        ) {
            html.push(
                '<hr class="oaao-md-hr border-0 border-t-[1px] border-solid border-[var(--grid-line)] my-3" />',
            );
            i += 1;
            continue;
        }

        const hm = line.match(/^(#{1,6})\s+(.+)$/);
        if (hm) {
            const lvl = Math.min(6, hm[1].length);
            html.push(
                `<h${lvl} class="oaao-md-heading">${parseInlineLite(String(hm[2]).trim())}</h${lvl}>`,
            );
            i += 1;
            continue;
        }

        if (/^#{1,6}\s*$/.test(line.trim())) {
            html.push(`<p>${escapeHtmlLite(line.trim())}</p>`);
            i += 1;
            continue;
        }

        const listM = line.match(OAAO_LITE_LIST_LINE_RE);
        if (listM) {
            /** @type {Array<{ depth: number, ordered: boolean, content: string, marker: string }>} */
            const listItems = [];
            /** @type {{ marker: string, content: string, depth: number } | null} */
            let prevMeta = null;
            while (i < lines.length) {
                const lm = lines[i].match(OAAO_LITE_LIST_LINE_RE);
                if (!lm) {
                    break;
                }
                const depth = oaaoLiteListItemDepth(lines[i], lm, prevMeta);
                const ordered = /^\d+\.$/.test(lm[2]);
                const content = lm[3];
                listItems.push({ depth, ordered, content });
                prevMeta = { marker: lm[2], content, depth };
                i += 1;
            }
            html.push(oaaoRenderLiteListHtml(listItems));
            continue;
        }

        if (line.includes('|') && i + 1 < lines.length && isLiteTableSeparatorLine(lines[i + 1])) {
            const tableLines = [];
            while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
                tableLines.push(lines[i]);
                i += 1;
            }
            html.push(renderLiteTable(tableLines));
            continue;
        }

        /** @type {string[]} */
        const pLines = [];
        while (
            i < lines.length &&
            lines[i].trim() &&
            !/^(#{1,6})\s/.test(lines[i]) &&
            !OAAO_LITE_LIST_LINE_RE.test(lines[i]) &&
            !(lines[i].includes('|') && i + 1 < lines.length && isLiteTableSeparatorLine(lines[i + 1]))
        ) {
            pLines.push(lines[i]);
            i += 1;
        }
        if (pLines.length) {
            html.push(`<p>${pLines.map((l) => parseInlineLite(l)).join('<br>')}</p>`);
        }
    }

    return html.join('\n');
}

/**
 * @param {HTMLElement} bubble
 * @param {string} md
 */
function readAssistantBubblePlainText(bubble) {
    if (!(bubble instanceof HTMLElement)) return '';
    return String(bubble.innerText || bubble.textContent || '').trim();
}

/** @param {HTMLElement | null | undefined} bubble */
function assistantBubbleHasVisibleContent(bubble) {
    return readAssistantBubblePlainText(/** @type {HTMLElement} */ (bubble)).length > 0;
}

/**
 * @param {HTMLElement | Document} mount
 * @param {HTMLElement | null | undefined} msgsHost
 * @param {number | null | undefined} streamingMsgId
 */
function resolveStreamingAssistantBubble(mount, msgsHost, streamingMsgId) {
    const mid = coercePositiveInt(streamingMsgId);
    if (!mid) return null;
    return (
        getAssistantBubbleForMessage(mount, mid) ??
        (msgsHost instanceof HTMLElement
            ? msgsHost.querySelector(`[data-oaao-msg-id="${mid}"][data-oaao-msg-role="assistant"]`)
            : null)
    );
}

/**
 * @param {number} conversationId
 * @param {number} assistantMessageId
 * @param {HTMLElement} bubble
 */
async function hydrateAssistantBubbleFromServer(conversationId, assistantMessageId, bubble) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const { res, data } = await chatFetchJson(chatMessagesApiUrl(conversationId));
        if (res.ok && data?.success && Array.isArray(data.messages)) {
            const row = data.messages.find((m) => coercePositiveInt(m?.id) === assistantMessageId);
            const content = String(row?.content ?? '').trim();
            if (content) {
                applyAssistantMarkdown(bubble, content);
                return content;
            }
        }
        if (attempt < 3) {
            await new Promise((resolve) => {
                setTimeout(resolve, 280 * (attempt + 1));
            });
        }
    }
    return '';
}

/** @type {Promise<{ citationMapsFromPipeline?: Function, hydrateInlineCitationPills?: Function }> | null} */
let inlineCitationsModPromise = null;

/** @type {WeakMap<HTMLElement, { vault: Map<number, Record<string, unknown>>, attachment: Map<string, Record<string, unknown>> }>} */
const inlineCitationMapsByOuter = new WeakMap();

/** @type {string | null} */
let inlineCitationsModRev = null;

function loadInlineCitationsMod() {
    const rev = OAAO_CHAT_SHELL_ASSET_REV;
    if (!inlineCitationsModPromise || inlineCitationsModRev !== rev) {
        inlineCitationsModRev = rev;
        const url = oaaoPrefixedSitePath(
            `/webassets/rag/default/js/inline-citations.js?v=${encodeURIComponent(rev)}`,
        );
        inlineCitationsModPromise = import(/* webpackIgnore: true */ url).catch(() => ({}));
    }
    return inlineCitationsModPromise;
}

/**
 * @param {HTMLElement} outer
 * @param {Record<string, unknown> | null} pipeline
 * @returns {Promise<{ vault: Map<number, Record<string, unknown>>, attachment: Map<string, Record<string, unknown>> } | null>}
 */
async function stashInlineCitationMaps(outer, pipeline) {
    if (!(outer instanceof HTMLElement) || !pipeline) return null;
    const mod = await loadInlineCitationsMod();
    if (typeof mod.citationMapsFromPipeline !== 'function') return null;
    const maps = mod.citationMapsFromPipeline(pipeline);
    if (maps.vault.size || maps.attachment.size) {
        inlineCitationMapsByOuter.set(outer, maps);
    } else {
        inlineCitationMapsByOuter.delete(outer);
    }
    return maps;
}

/**
 * @param {HTMLElement} bubble
 */
async function hydrateInlineCitesForBubble(bubble) {
    if (!(bubble instanceof HTMLElement)) return;
    const outer = bubble.closest('.oaao-chat-assistant-row');
    if (!(outer instanceof HTMLElement)) return;
    let maps = inlineCitationMapsByOuter.get(outer);
    if (!maps || (!maps.vault.size && !maps.attachment.size)) return;
    const mod = await loadInlineCitationsMod();
    if (typeof mod.hydrateInlineCitationPills === 'function' && bubble.isConnected) {
        mod.hydrateInlineCitationPills(bubble, maps);
    }
}

/**
 * @param {HTMLElement} bubble
 * @param {string} md
 */
function applyAssistantMarkdown(bubble, md) {
    const text = String(md ?? '');
    if (!text.trim()) {
        // Stream end must not wipe plain-text deltas when parse input is momentarily empty.
        bubble.classList.remove('oaao-md-bubble');
        return;
    }

    try {
        // Never call RazyUI parseSafe here — tables/headings mid-reply freeze the main thread.
        const html = renderAssistantMarkdownHtml(text);
        if (!html.trim()) {
            bubble.classList.remove('oaao-md-bubble');
            bubble.style.whiteSpace = 'pre-wrap';
            bubble.textContent = text;
            return;
        }
        bubble.classList.add('oaao-md-bubble');
        bubble.style.whiteSpace = '';
        bubble.innerHTML = html;
        void hydrateInlineCitesForBubble(bubble);
        if (assistantTextNeedsMathRender(text)) {
            hydrateChatMarkdownMath(bubble);
        }
    } catch (err) {
        console.warn('[oaao chat] assistant markdown render failed', err);
        bubble.classList.remove('oaao-md-bubble');
        bubble.style.whiteSpace = 'pre-wrap';
        bubble.textContent = text;
    }
}

/** Assistant markdown → safe HTML (legacy export; prefer {@link applyAssistantMarkdown}). */
/** @param {string} md */
function markdownToSafeHtml(md) {
    return renderAssistantMarkdownHtml(md);
}

/**
 * Incremental stream renderer (RazyUI streamPeel): peel unstable tail → tokenize stable prefix
 * (closed fences + ``\n\n`` blocks) → cache HTML per token; only re-parse from first changed token.
 * Tail stays escaped plain text until the block closes.
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
            const { stable, tail } = /** @type {Function} */ (chatMd.streamingMarkdownStableTail)(acc);
            const tokens = /** @type {Function} */ (chatMd.tokenizeStableStreamChunks)(stable);

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
                    htmlParts.push(chatParseStreamToken(t));
                }
            }

            prevTok = tokens;
            prevHtml = htmlParts;

            const body = htmlParts.join('');
            const tailHtml =
                tail === ''
                    ? ''
                    : `<span class="oaao-stream-md-tail whitespace-pre-wrap break-words">${escapeHtmlLite(tail)}</span>`;

            return `${body}${tailHtml}`;
        },
    };
}

/** Unwrapped RazyUI {@code Dialog} ctor ({@see settings-dialog.js}; avoids {@code razyui.load} wrapper). */
/** @type {Promise<new (opts?: Record<string, unknown>) => unknown> | null} */
let chatComposerDialogCtorPromise = null;

function loadChatComposerDialogCtor() {
    if (!chatComposerDialogCtorPromise) {
        const url = oaaoPrefixedSitePath('/webassets/core/default/razyui/component/Dialog.js');
        chatComposerDialogCtorPromise = import(/* webpackIgnore: true */ url).then((m) => m.default);
    }

    return chatComposerDialogCtorPromise;
}

/** Bump when pipeline chrome markup/CSS changes — busts browser cache on {@code mountShellPanel}. */
const OAAO_CHAT_SHELL_ASSET_REV = '20260525-composer-dropup-v21';

/** Initial / incremental message page size ({@code GET messages}) — loaded from {@code chat_preferences}. */
let chatHistoryPageSize = 5;

/** @type {Map<number, Map<number, Record<string, unknown>>>} */
const turnScoreCacheByConversation = new Map();

/** @type {Map<number, { hasOlder: boolean, oldestId: number | null, loadingOlder: boolean }>} */
const messagePageStateByConversation = new Map();

let messageHistoryScrollBound = false;

/** Open conversation overflow panel (fixed layer); cleared on sidebar re-render. */
let openConvoMenuPanel = null;
let openConvoMenuOutsideAbort = null;

function closeOpenConvoMenuPanel() {
    openConvoMenuOutsideAbort?.abort();
    openConvoMenuOutsideAbort = null;
    openConvoMenuPanel?.remove();
    openConvoMenuPanel = null;
    document.querySelectorAll('.oaao-chat-convo-menu.is-open').forEach((el) => {
        el.classList.remove('is-open');
        const trig = el.querySelector('.oaao-chat-convo-menu-trigger');
        if (trig) trig.setAttribute('aria-expanded', 'false');
    });
}

/** @param {string} st */
function normalizeOaaoTaskStatus(st) {
    const s = String(st ?? 'pending').toLowerCase();
    if (s === 'completed' || s === 'success' || s === 'complete') return 'done';
    if (s === 'running' || s === 'in_progress') return 'active';
    return s;
}

/**
 * Slide worker rows: SSE status may lag; infer from streamed preview payload.
 *
 * @param {{ status?: string, preview?: Record<string, unknown> }} at
 * @param {OaaoTaskItemState | null | undefined} [parentRow]
 */
function oaaoEffectiveAgentTaskStatus(at, parentRow = null) {
    let st = normalizeOaaoTaskStatus(at?.status);
    if (parentRow) {
        const ps = normalizeOaaoTaskStatus(parentRow.status);
        if (ps === 'done') {
            if (st === 'failed') return 'failed';
            if (st === 'skipped') return 'skipped';
            return 'done';
        }
        if (ps === 'failed' && st !== 'done') return 'failed';
    }
    if (st === 'done' || st === 'failed' || st === 'active') return st;

    const preview = at?.preview && typeof at.preview === 'object' ? at.preview : null;
    if (!preview) return st;

    const outlineMd = typeof preview.outline_md === 'string' ? preview.outline_md.trim() : '';
    if (outlineMd && preview.building !== true) return 'done';

    if (preview.building === true) return 'active';

    const phase = String(preview.phase ?? '').toLowerCase();
    if (phase === 'failed') return 'failed';

    const url = typeof preview.preview_url === 'string' ? preview.preview_url.trim() : '';
    if (url) return 'done';

    const snippet = typeof preview.snippet === 'string' ? preview.snippet.trim() : '';
    if (snippet) return 'active';

    return st;
}

/**
 * @param {HTMLElement} menuRoot
 * @param {HTMLButtonElement} trigger
 * @param {Array<{ label: string, danger?: boolean, onSelect: () => void | Promise<void> } | { divider: true }>} items
 * @param {AbortSignal} signal
 */
function wireConvoRowMenu(menuRoot, trigger, items, signal) {
    trigger.addEventListener(
        'click',
        (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (openConvoMenuPanel && menuRoot.classList.contains('is-open')) {
                closeOpenConvoMenuPanel();
                return;
            }
            closeOpenConvoMenuPanel();

            const panel = document.createElement('div');
            panel.className = 'oaao-chat-convo-menu-panel';
            panel.setAttribute('role', 'menu');
            panel.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Conversation options');

            for (const item of items) {
                if ('divider' in item && item.divider) {
                    const sep = document.createElement('div');
                    sep.className = 'oaao-chat-convo-menu-sep';
                    sep.setAttribute('role', 'separator');
                    panel.append(sep);
                    continue;
                }
                if (!('label' in item) || typeof item.onSelect !== 'function') continue;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = item.danger
                    ? 'oaao-chat-convo-menu-item oaao-chat-convo-menu-item--danger'
                    : 'oaao-chat-convo-menu-item';
                btn.setAttribute('role', 'menuitem');
                btn.textContent = item.label;
                const runItem = () => {
                    closeOpenConvoMenuPanel();
                    void item.onSelect();
                };
                btn.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                });
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    runItem();
                });
                panel.append(btn);
            }

            panel.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
            });

            document.body.append(panel);
            const rect = trigger.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            const top = rect.bottom + 6;
            const left = Math.max(8, rect.right - panelRect.width);
            panel.style.top = `${top}px`;
            panel.style.left = `${left}px`;

            openConvoMenuPanel = panel;
            menuRoot.classList.add('is-open');
            trigger.setAttribute('aria-expanded', 'true');

            const outside = new AbortController();
            openConvoMenuOutsideAbort = outside;
            const onDoc = (e) => {
                const t = e.target;
                if (!(t instanceof Node)) return;
                if (panel.contains(t) || menuRoot.contains(t)) return;
                closeOpenConvoMenuPanel();
            };
            window.setTimeout(() => {
                if (outside.signal.aborted) return;
                window.addEventListener('pointerdown', onDoc, { capture: true, signal: outside.signal });
            }, 0);
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeOpenConvoMenuPanel();
            }, { signal: outside.signal });
        },
        { signal },
    );
}
const OAAO_SLIDE_PREVIEW_NATIVE_W = 1280;
const OAAO_SLIDE_PREVIEW_NATIVE_H = 720;

/** Same-origin slide HTML previews — scripts required for layout (Reveal/markdown init). */
const OAAO_SLIDE_PREVIEW_IFRAME_SANDBOX = 'allow-scripts allow-same-origin';

/**
 * Fit a native-size slide iframe into a fixed-aspect thumb frame (no inner scrollbars).
 *
 * @param {HTMLElement} frame
 * @param {HTMLIFrameElement} iframe
 */
function mountOaaoSlidePreviewThumb(frame, iframe) {
    iframe.setAttribute('width', String(OAAO_SLIDE_PREVIEW_NATIVE_W));
    iframe.setAttribute('height', String(OAAO_SLIDE_PREVIEW_NATIVE_H));
    const scale = document.createElement('div');
    scale.className = 'oaao-chat-substep-preview__scale';
    scale.append(iframe);
    frame.append(scale);

    const apply = () => {
        const w = frame.clientWidth;
        const h = frame.clientHeight;
        if (w < 1 || h < 1) return;
        const s = Math.min(w / OAAO_SLIDE_PREVIEW_NATIVE_W, h / OAAO_SLIDE_PREVIEW_NATIVE_H);
        const dx = (w - OAAO_SLIDE_PREVIEW_NATIVE_W * s) / 2;
        const dy = (h - OAAO_SLIDE_PREVIEW_NATIVE_H * s) / 2;
        scale.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    };
    apply();
    iframe.addEventListener('load', apply, { once: true });
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(apply).observe(frame);
    } else {
        window.addEventListener('resize', apply, { passive: true });
    }
}

/** Root-relative chat shell stylesheet ({@code mountShellPanel}). */
function ensureChatShellCss() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('link[data-oaao-chat-shell-css]').forEach((el) => el.remove());
    const href = oaaoPrefixedSitePath(
        `/webassets/chat/default/css/oaao-chat-shell.css?v=${encodeURIComponent(OAAO_CHAT_SHELL_ASSET_REV)}`,
    );
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.crossOrigin = 'anonymous';
    link.dataset.oaaoChatShellCss = OAAO_CHAT_SHELL_ASSET_REV;
    document.head.append(link);
    injectPipelineInlineStyles();
}

/** Pipeline layout must work even if the external stylesheet is cached — inject once per rev. */
function injectPipelineInlineStyles() {
    if (typeof document === 'undefined') return;
    const id = 'oaao-chat-pipeline-inline';
    const prev = document.getElementById(id);
    if (prev?.dataset.oaaoRev === OAAO_CHAT_SHELL_ASSET_REV) return;
    prev?.remove();
    const style = document.createElement('style');
    style.id = id;
    style.dataset.oaaoRev = OAAO_CHAT_SHELL_ASSET_REV;
    style.textContent = `
.oaao-chat-pipeline-details>summary{list-style:none}
.oaao-chat-pipeline-details>summary::-webkit-details-marker{display:none}
.oaao-inline-cite{display:inline-flex;align-items:center;justify-content:center;vertical-align:super;margin:0 .1em;padding:0;border:none;background:transparent;font:inherit;cursor:pointer;white-space:nowrap;line-height:1;text-decoration:none}
.oaao-inline-cite__inner{display:inline-flex;align-items:baseline;gap:0;padding:.1em .38em;border-radius:4px;border:1px solid color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 88%,transparent);background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 14%,var(--grid-panel-bright,#fff));box-shadow:none;font-size:.65em;font-weight:500;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;color:var(--grid-ink-muted,#666);transition:background .12s ease,border-color .12s ease,color .12s ease}
.oaao-inline-cite-fallback .oaao-inline-cite{vertical-align:middle;margin:0}
.oaao-inline-cite-fallback .oaao-inline-cite__inner{align-items:center;justify-content:center;min-width:auto;min-height:1.35rem;padding:.15rem .45rem;font-size:.6875rem;line-height:1;letter-spacing:0;border-radius:5px}
.oaao-inline-cite__num{color:var(--grid-ink,#111);font-weight:600}
.oaao-inline-cite--vault .oaao-inline-cite__inner{color:var(--grid-ink-muted,#666)}
.oaao-inline-cite--attachment .oaao-inline-cite__inner{border-color:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 88%,transparent);background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 14%,var(--grid-panel-bright,#fff));color:var(--grid-ink-muted,#666)}
.oaao-inline-cite--attachment .oaao-inline-cite__prefix,.oaao-inline-cite--attachment .oaao-inline-cite__num{color:var(--grid-ink,#111);font-weight:600}
.oaao-inline-cite:hover .oaao-inline-cite__inner,.oaao-inline-cite:focus-visible .oaao-inline-cite__inner{border-color:color-mix(in srgb,var(--grid-ink-muted,#666) 28%,var(--grid-line));background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 24%,var(--grid-panel-bright,#fff));color:var(--grid-ink,#111);box-shadow:none}
.oaao-inline-cite-fallback{display:flex;flex-wrap:wrap;align-items:center;gap:.55rem;margin-top:.45rem;padding:.45rem .65rem;border-radius:10px;border:1px solid color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 88%,transparent);background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 12%,var(--grid-panel-bright,#fff));width:100%;min-width:0;box-sizing:border-box}
.oaao-inline-cite-fallback__label{display:inline-flex;align-items:center;gap:.3rem;font-size:.6875rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--grid-caption,#666);flex-shrink:0}
.oaao-inline-cite-fallback__label::before{content:'';width:.45rem;height:.45rem;border-radius:50%;background:var(--grid-caption,#888);opacity:.45}
.oaao-inline-cite-popover{position:fixed;min-width:14rem;max-width:min(24rem,92vw);border-radius:14px;border:1px solid color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 88%,transparent);background:var(--grid-panel-bright,#fff);color:var(--grid-ink,#111);box-shadow:0 14px 36px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06);pointer-events:auto;overflow:hidden;font-family:ui-sans-serif,system-ui,sans-serif;opacity:0;transform:translateY(4px);transition:opacity .16s ease,transform .16s ease}
.oaao-inline-cite-popover.oaao-inline-cite-popover--visible{opacity:1;transform:translateY(0)}
@keyframes oaao-cite-pop-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.oaao-inline-cite-popover__header{display:flex;align-items:flex-start;gap:.55rem;padding:.55rem .65rem;border-bottom:1px solid color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 70%,transparent);background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 16%,var(--grid-panel-bright,#fff))}
.oaao-inline-cite-popover__icon{display:inline-flex;align-items:center;justify-content:center;width:1.65rem;height:1.65rem;border-radius:8px;flex-shrink:0;font-size:.625rem;font-weight:700;letter-spacing:.02em;color:var(--grid-accent,#2563eb);background:color-mix(in srgb,var(--grid-accent,#2563eb) 14%,var(--grid-panel-bright,#fff));border:1px solid color-mix(in srgb,var(--grid-accent,#2563eb) 28%,var(--grid-line))}
.oaao-inline-cite-popover__headtext{min-width:0;flex:1}
.oaao-inline-cite-popover__title{font-size:.75rem;font-weight:600;line-height:1.35;color:var(--grid-ink,#111);word-break:break-word}
.oaao-inline-cite-popover__subtitle{margin-top:.12rem;font-size:.6875rem;line-height:1.35;color:var(--grid-ink-muted,#666);word-break:break-word}
.oaao-inline-cite-popover__body{padding:.55rem .65rem .65rem;font-size:.75rem;line-height:1.5;color:var(--grid-ink,#111);max-height:10rem;overflow:auto;white-space:pre-wrap;word-break:break-word}
.oaao-md-pre{overflow-x:auto;max-width:100%;margin:.35rem 0;padding:.65rem .75rem;border-radius:10px;background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 22%,var(--grid-panel-bright,#fff));border:1px solid color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 65%,transparent)}
.oaao-md-pre code{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.8125rem;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.oaao-chat-pipeline-details[open]>summary .oaao-chat-pipeline-details-chevron{transform:rotate(180deg)}
.oaao-chat-pipeline-details-summary{display:flex;align-items:center;gap:.4rem;width:100%}
.oaao-chat-pipeline-details-chevron{margin-left:auto;font-size:1rem}
.oaao-chat-composer-editor:empty::before{content:attr(data-placeholder);color:var(--grid-caption,#888);pointer-events:none}
.oaao-chat-composer-editor:focus{outline:none}
.oaao-chat-template-slug{display:inline-block;vertical-align:-1px;line-height:1}
.oaao-chat-template-slug-pill{height:24px;max-height:24px;line-height:1;box-shadow:none;padding-left:3.5px;padding-right:3.5px;border-radius:.5rem;border-width:.5px;border-color:rgba(0,0,0,.15);background:transparent}
.oaao-chat-template-slug-pill:hover{background:rgba(12,12,13,.04)}
.oaao-chat-template-slug-pill .oaao-chat-template-slug-thumb,.oaao-chat-template-slug-pill img{width:11px;height:11px;border-radius:2px}
[data-oaao-chat='composer-attachment-stack']{display:flex;flex-direction:column;gap:.5rem;width:100%;min-width:0;margin-bottom:.5rem}
[data-oaao-chat='composer-attachment-stack'].hidden{display:none!important}
.oaao-chat-attachment-card{position:relative;display:flex;flex-direction:row;align-items:center;gap:.65rem;width:100%;min-width:0;max-width:min(100%,20rem);padding:.55rem 2rem .55rem .65rem;border-radius:12px;border:1px solid color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 88%,transparent);background:var(--grid-panel-bright,#fff);box-shadow:0 1px 2px rgba(0,0,0,.04);box-sizing:border-box}
[data-oaao-chat='composer-attachment-stack'] .oaao-chat-attachment-card,[data-oaao-chat='composer-input-shell'] .oaao-chat-attachment-card{max-width:100%}
[data-oaao-composer-busy='send'] [data-oaao-chat='composer-input-shell'],[data-oaao-composer-busy='stream'] [data-oaao-chat='composer-input-shell']{opacity:.52;pointer-events:none;transition:opacity .15s ease}
[data-oaao-composer-busy='send'] [data-oaao-chat='composer-inner']{opacity:.78;transition:opacity .15s ease}
[data-oaao-composer-busy='send'] [data-oaao-chat='composer-feature-toggles'] button,[data-oaao-composer-busy='send'] [data-oaao-chat='composer-registry-slots-left'] button,[data-oaao-composer-busy='send'] [data-oaao-chat='composer-registry-slots-actions'] button,[data-oaao-composer-busy='send'] [data-oaao-chat='composer-registry-extra-toolbar'] button{opacity:.45;pointer-events:none}
button[data-oaao-chat='send'][data-oaao-composer-sending='1']{opacity:.85;cursor:wait}
button[data-oaao-chat='send'][data-oaao-composer-sending='1']>[data-oaao-chat-icon='send']{opacity:0}
button[data-oaao-chat='send'][data-oaao-composer-sending='1']::after{content:'';position:absolute;left:50%;top:50%;width:1rem;height:1rem;margin:-.5rem 0 0 -.5rem;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:oaao-composer-send-spin .65s linear infinite;pointer-events:none}
@keyframes oaao-composer-send-spin{to{transform:rotate(360deg)}}
.oaao-chat-user-msg-attachments .oaao-chat-attachment-card{align-self:flex-end}
.oaao-chat-attachment-card-icon{display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;flex-shrink:0;border-radius:8px;background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 28%,transparent);color:var(--grid-ink-muted,#666)}
.oaao-chat-attachment-card-icon svg{width:18px;height:18px;display:block}
.oaao-chat-attachment-card-body{flex:1;min-width:0}
.oaao-chat-attachment-card-name{font-size:.8125rem;line-height:1.25;font-weight:500;color:var(--grid-ink,#111);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oaao-chat-attachment-card-kind{margin-top:.1rem;font-size:.6875rem;line-height:1.2;color:var(--grid-caption,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oaao-chat-attachment-card-dismiss{position:absolute;top:.35rem;right:.35rem;display:inline-flex;align-items:center;justify-content:center;width:1.25rem;height:1.25rem;padding:0;border:none;border-radius:999px;background:transparent;color:var(--grid-caption,#888);cursor:pointer;line-height:0}
.oaao-chat-attachment-card-dismiss:hover{background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 35%,transparent);color:var(--grid-ink,#111)}
.oaao-chat-attachment-card-dismiss svg{width:14px;height:14px;display:block}
.oaao-chat-user-msg-attachments{display:flex;flex-direction:column;align-items:flex-end;gap:.5rem;width:100%;max-width:min(100%,20rem);min-width:0}
.oaao-chat-pipeline-steps{display:flex;flex-direction:column;font-size:.8125rem;line-height:1.45}
.oaao-chat-pipeline-step{display:grid;grid-template-columns:1.35rem minmax(0,1fr);column-gap:.65rem;padding-bottom:1.1rem;position:relative}
.oaao-chat-pipeline-step:not(:last-child)::after{content:'';position:absolute;left:.65rem;top:1.45rem;bottom:.15rem;border-left:2px dotted color-mix(in srgb,var(--grid-line) 85%,transparent)}
.oaao-chat-pipeline-step-marker{width:1.3rem;height:1.3rem;border-radius:50%;border:2px solid color-mix(in srgb,var(--grid-line) 90%,transparent);background:var(--grid-panel-bright);display:inline-flex;align-items:center;justify-content:center}
.oaao-chat-pipeline-step-marker.is-done{border-color:color-mix(in srgb,var(--grid-ink-muted) 55%,transparent);background:color-mix(in srgb,var(--grid-ink-muted) 18%,var(--grid-panel-bright))}
.oaao-chat-pipeline-step-body{display:flex;flex-direction:column;gap:.45rem;min-width:0}
.oaao-chat-pipeline-step-title{font-weight:600;color:var(--grid-ink)}
.oaao-chat-pipeline-rail-summary{display:flex;align-items:center;gap:.4rem;width:100%;list-style:none;cursor:pointer;border-radius:8px;padding:.35rem .55rem;border:1px solid color-mix(in srgb,var(--grid-line) 70%,transparent);background:color-mix(in srgb,var(--grid-line) 32%,var(--grid-panel-bright))}
.oaao-chat-pipeline-rail-summary::-webkit-details-marker{display:none}
.oaao-chat-pipeline-rail-label{flex:1;min-width:0}
.oaao-chat-pipeline-rail-chevron{margin-left:auto}
.oaao-chat-pipeline-step-desc{margin:0;color:var(--grid-ink);font-size:.8125rem;line-height:1.5}
.oaao-chat-pipeline-task{display:flex;gap:.45rem;padding:.45rem .55rem;border-radius:8px;border:1px solid color-mix(in srgb,var(--grid-line) 65%,transparent);background:color-mix(in srgb,var(--grid-line) 28%,var(--grid-panel-bright));font-size:.75rem;color:var(--grid-ink-muted)}
.oaao-task-list-strip{overflow:hidden;max-width:100%}
.oaao-task-list-inner{display:block;width:100%;box-sizing:border-box;padding:12px 14px;font-size:13px;line-height:1.45;background:var(--grid-panel-bright,#fff);border:1px solid var(--grid-line,rgba(0,0,0,.1));border-radius:12px;box-shadow:0 1px 3px rgb(0 0 0/.04)}
.oaao-task-list-header{display:flex;align-items:center;gap:6px;margin:0 0 8px;padding:0 0 8px;min-height:28px;border-bottom:1px solid var(--grid-line,rgba(0,0,0,.08))}
.oaao-task-list-chevron{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:8px;background:transparent;color:var(--grid-ink-muted,#666);cursor:pointer;flex-shrink:0}
.oaao-task-list-chevron svg{width:18px;height:18px;max-width:18px;max-height:18px;transition:transform .15s ease}
.oaao-task-list-strip--collapsed .oaao-task-list-chevron svg,.oaao-task-list-chevron.oaao-task-list-chevron--collapsed svg{transform:rotate(-90deg)}
.oaao-task-list-heading{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--grid-ink,#111)}
.oaao-task-list-dismiss{flex-shrink:0;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--grid-ink-muted,#666);cursor:pointer;font-size:16px;line-height:1}
.oaao-task-list-strip--collapsed .oaao-task-list-body{display:none}
.oaao-task-list-items{margin:0;padding:0;list-style:none}
.oaao-task-list-row{display:flex;align-items:flex-start;gap:10px;padding:4px 0;color:var(--grid-ink-muted,#555);font-size:13px}
.oaao-task-list-row--has-sub{display:block;padding:0}
.oaao-task-list-check-wrap{display:inline-flex;flex-shrink:0;align-items:flex-start}
.oaao-task-list-check,.oaao-task-list-check-wrap svg.oaao-task-list-check{width:18px!important;height:18px!important;max-width:18px;max-height:18px;flex-shrink:0;margin-top:2px}
.oaao-task-list-row-text{flex:1 1 0;min-width:0;overflow-wrap:break-word}
.oaao-task-list-row--active .oaao-task-list-row-text{font-weight:600;color:var(--grid-ink,#111)}
.oaao-task-list-agent-details>summary.oaao-task-list-row-main{display:flex;align-items:flex-start;gap:10px;padding:4px 0;list-style:none;cursor:pointer;color:inherit}
.oaao-task-list-agent-details>summary.oaao-task-list-row-main::-webkit-details-marker{display:none}
.oaao-task-list-agent-details>summary.oaao-task-list-row-main::marker{content:'';font-size:0}
.oaao-task-list-row-chevron-wrap{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;width:18px;height:18px;margin-top:2px;margin-left:auto;color:var(--grid-ink-muted,#666)}
.oaao-task-list-row-chevron-wrap--spacer{visibility:hidden;pointer-events:none}
.oaao-task-list-row-chevron{transition:transform .15s ease;transform:rotate(-90deg)}
.oaao-task-list-agent-details.is-open .oaao-task-list-row-chevron,.oaao-task-list-agent-details[open] .oaao-task-list-row-chevron{transform:rotate(0deg)}
.oaao-task-list-row--active .oaao-task-list-row-text,.oaao-task-list-row--active.oaao-task-list-agent-details>summary .oaao-task-list-row-text{font-weight:600;color:var(--grid-ink,#111)}
.oaao-task-list-row--active>summary.oaao-task-list-row-main,.oaao-task-list-row--active:not(.oaao-task-list-row--has-sub){background:color-mix(in srgb,var(--grid-accent,#2563eb) 8%,var(--grid-panel-bright,#fff));border-radius:8px}
.oaao-task-list-row--parallel-pending .oaao-task-list-row-text,.oaao-chat-inline-step--parallel-pending .oaao-chat-inline-step-title{opacity:.72}
.oaao-task-list-row--parallel-pending:not(.oaao-task-list-row--active) .oaao-task-list-check-wrap svg,.oaao-chat-inline-step--parallel-pending:not(.is-active) .oaao-chat-inline-step-marker{animation:oaao-slide-skeleton-pulse 1.2s ease-in-out infinite}
@keyframes oaao-slide-skeleton-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.oaao-task-list-inner{user-select:none;-webkit-user-select:none}
.oaao-task-list-agent-items{margin:0 0 4px 28px;padding:0 0 0 8px;list-style:none;border-left:1px solid var(--grid-line,rgba(0,0,0,.08))}
.oaao-task-list-agent-row{display:flex;align-items:flex-start;gap:8px;padding:3px 0;font-size:12px;color:var(--grid-ink-muted,#666)}
.oaao-task-list-agent-row--active .oaao-task-list-agent-row-text{font-weight:500;color:var(--grid-ink,#111)}
.oaao-task-list-check-wrap--sub .oaao-task-list-check,.oaao-task-list-check-wrap--sub svg.oaao-task-list-check{width:14px!important;height:14px!important;max-width:14px;max-height:14px}
.oaao-chat-task-panel{position:relative;display:flex;flex-direction:column;flex:0 0 min(320px,36vw);min-width:260px;max-width:360px;min-height:0;border-left:1px solid var(--grid-line,rgba(0,0,0,.1));background:var(--grid-panel-bright,#fff);overflow:hidden}
.oaao-chat-task-panel.hidden{display:none!important}
.oaao-chat-task-panel-header{flex:0 0 auto;z-index:2;padding:12px 14px 10px;border-bottom:1px solid var(--grid-line,rgba(0,0,0,.08));background:var(--grid-panel-bright,#fff)}
.oaao-chat-task-panel-header-row{display:flex;align-items:center;gap:6px;min-height:28px}
.oaao-chat-task-panel-body{position:relative;display:flex;flex:1 1 auto;min-height:0;overflow:hidden}
.oaao-task-panel-float-toggle{position:absolute;left:-14px;top:14px;z-index:3;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid var(--grid-line,rgba(0,0,0,.12));border-radius:999px;background:var(--grid-panel-bright,#fff);color:var(--grid-ink-muted,#666);box-shadow:0 2px 8px rgb(0 0 0/.08);cursor:pointer}
.oaao-chat-task-panel--steps-collapsed .oaao-chat-task-panel-body .oaao-task-list-strip{display:none!important}
.oaao-chat-task-panel--steps-collapsed .oaao-task-panel-float-toggle-icon{transform:rotate(180deg)}
.oaao-chat-task-panel-tabs{display:flex;gap:4px;margin-top:8px}
.oaao-chat-task-panel-tab{flex:1;min-width:0;padding:5px 8px;border:1px solid var(--grid-line,rgba(0,0,0,.1));border-radius:8px;background:color-mix(in srgb,var(--grid-ink,#111) 3%,var(--grid-panel-bright,#fff));color:var(--grid-ink-muted,#666);font-size:11px;font-weight:600;font-family:inherit;cursor:pointer}
.oaao-chat-task-panel-tab.is-active{color:var(--grid-ink,#111);border-color:color-mix(in srgb,var(--grid-accent,#2563eb) 35%,var(--grid-line,rgba(0,0,0,.1)));background:color-mix(in srgb,var(--grid-accent,#2563eb) 8%,var(--grid-panel-bright,#fff))}
.oaao-chat-task-panel-view{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;overflow:hidden}
.oaao-chat-task-panel-view.hidden{display:none!important}
.oaao-chat-task-panel-view--agents{overflow-y:auto}
.oaao-chat-task-panel--view-agents .oaao-task-panel-float-toggle{display:none!important}
.oaao-task-agent-rail{display:flex;flex-direction:column;gap:8px;margin:0;padding:10px 14px 14px;box-sizing:border-box}
.oaao-task-agent-rail.hidden{display:none!important}
.oaao-task-list-row-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.oaao-task-duration-badge{font-size:11px;color:var(--grid-ink-muted,#888);font-variant-numeric:tabular-nums;align-self:flex-start}
.oaao-chat-inline-step-copy .oaao-task-duration-badge{margin-top:2px}
.oaao-task-list-row-agent{display:inline-flex;align-items:center;gap:5px;max-width:100%;font-size:11px;color:var(--grid-ink-muted,#666)}
.oaao-task-list-row--active .oaao-task-list-row-agent{color:var(--grid-accent,#2563eb)}
.oaao-task-list-row-agent-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;border-radius:4px;background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 40%,var(--grid-panel-bright,#fff))}
.oaao-task-list-row-agent-icon svg{width:11px;height:11px}
.oaao-task-list-row-agent-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.oaao-chat-task-panel .oaao-task-list-strip{border:none;background:transparent;flex:1 1 auto;min-height:0;overflow:hidden}
.oaao-chat-task-panel .oaao-task-list-inner{border:none;border-radius:0;box-shadow:none;min-height:0;max-height:none;overflow-y:auto;padding:10px 14px 14px}
.oaao-chat-task-panel .oaao-task-list-header{display:none}
.oaao-app [data-oaao-chat='composer-region']:not(.oaao-chat-composer-region--thread-float){align-items:center}
.oaao-app [data-oaao-chat='composer-dock']{width:100%;max-width:48rem;margin-inline:auto;align-self:center;flex-shrink:0;box-sizing:border-box}
.oaao-app [data-oaao-chat='composer-card-wrap']{border-radius:22px;overflow:hidden;box-sizing:border-box;background:#fff;border:1px solid rgba(0,0,0,.12);box-shadow:0 12px 32px rgba(0,0,0,.06)}
.oaao-app .oaao-chat-composer-region--thread-float{position:relative;flex:0 0 auto;z-index:10;margin-top:-1.25rem;padding-top:1.25rem;pointer-events:none;width:100%;max-width:100%;padding-right:var(--oaao-thread-scrollbar-inset,0px);box-sizing:border-box;background:transparent}
.oaao-app .oaao-chat-composer-region--thread-float::before{content:'';position:absolute;left:0;right:var(--oaao-thread-scrollbar-inset,0px);top:0;bottom:0;pointer-events:none;z-index:0;background:linear-gradient(to bottom,transparent 0%,var(--grid-paper,#fafafa) 1.25rem,var(--grid-paper,#fafafa) 100%)}
.oaao-app .oaao-chat-composer-region--thread-float>*{position:relative;z-index:1}
.oaao-app .oaao-chat-composer-region--thread-float>[data-oaao-chat='composer-dock']{pointer-events:auto;background:transparent;width:100%;max-width:48rem;margin-left:auto;margin-right:auto;padding-left:max(1.125rem,env(safe-area-inset-left,0px));padding-right:max(1.125rem,env(safe-area-inset-right,0px));box-sizing:border-box}
@media (min-width:640px){.oaao-app .oaao-chat-composer-region--thread-float>[data-oaao-chat='composer-dock']{padding-left:max(2rem,env(safe-area-inset-left,0px));padding-right:max(2rem,env(safe-area-inset-right,0px))}}
.oaao-app .oaao-chat-composer-region--thread-float [data-oaao-chat='composer-refs'],.oaao-app .oaao-chat-composer-region--thread-float [data-oaao-chat='composer-card-wrap'],.oaao-app .oaao-chat-composer-region--thread-float [data-oaao-chat='composer-extra-toolbar-wrap'],.oaao-app .oaao-chat-composer-region--thread-float .oaao-chat-composer-disclaimer{pointer-events:auto}
.oaao-app [data-oaao-chat='composer-shell'].oaao-chat-composer-shell--thread{padding-left:0!important;padding-right:0!important;width:100%;max-width:100%;justify-content:stretch}
.oaao-app [data-oaao-chat='composer-shell']:not(.oaao-chat-composer-shell--thread){display:flex;justify-content:stretch;padding-left:0;padding-right:0;padding-bottom:.5rem}
.oaao-app [data-oaao-chat='composer-shell']:not(.oaao-chat-composer-shell--thread)>.oaao-chat-composer-inner-width{width:100%;max-width:100%;margin-left:0;margin-right:0}
.oaao-app .oaao-chat-composer-region:not(.oaao-chat-composer-region--thread-float)>[data-oaao-chat='composer-dock']{width:100%;max-width:48rem;margin-left:auto;margin-right:auto;padding-left:max(1.125rem,env(safe-area-inset-left,0px));padding-right:max(1.125rem,env(safe-area-inset-right,0px));box-sizing:border-box}
@media (min-width:640px){.oaao-app .oaao-chat-composer-region:not(.oaao-chat-composer-region--thread-float)>[data-oaao-chat='composer-dock']{padding-left:max(2rem,env(safe-area-inset-left,0px));padding-right:max(2rem,env(safe-area-inset-right,0px))}}
.oaao-app .oaao-chat-composer-shell--thread>.oaao-chat-composer-inner-width{padding-top:0;max-width:100%;width:100%}
.oaao-app .oaao-chat-composer-shell--thread [data-oaao-chat='composer-card-wrap'],.oaao-app [data-oaao-chat='composer-card-wrap'].oaao-chat-composer--floating{margin-top:0}
.oaao-app [data-oaao-chat='composer-extra-toolbar-wrap']{background:var(--grid-panel,#f5f5f5);border-top:1px solid var(--grid-line,rgba(0,0,0,.06))}
.oaao-chat-inline-task-steps{margin:0 0 .65rem;font-size:.8125rem;line-height:1.5;color:var(--grid-ink-muted,#666)}
.oaao-chat-inline-task-steps-inner{display:flex;flex-direction:column;gap:.65rem}
.oaao-chat-inline-step-main{display:flex;align-items:flex-start;gap:.5rem}
.oaao-chat-inline-step-marker{display:inline-flex;flex-shrink:0;width:16px;height:16px;margin-top:.1rem;color:var(--grid-ink-muted,#888)}
.oaao-chat-inline-step.is-active .oaao-chat-inline-step-marker{color:var(--grid-accent,#2563eb)}
.oaao-chat-inline-step-marker svg,.oaao-chat-inline-step-marker .oaao-task-list-check{width:16px!important;height:16px!important}
.oaao-task-list-check--spinning{animation:oaao-task-check-spin .85s linear infinite;transform-origin:center}
.oaao-task-list-check--cancelled,.oaao-chat-inline-step.is-cancelled .oaao-chat-inline-step-marker{color:var(--grid-ink-muted,#888)}
.oaao-chat-inline-step.is-cancelled .oaao-chat-inline-step-title{color:var(--grid-ink-muted,#888);font-weight:500}
.oaao-task-list-row--cancelled .oaao-task-list-row-text{color:var(--grid-ink-muted,#888);font-weight:500}
.oaao-chat-inline-substep.is-active .oaao-chat-inline-substep-marker .oaao-task-list-check--spinning{color:var(--grid-accent,#2563eb)}
@keyframes oaao-task-check-spin{to{transform:rotate(360deg)}}
.oaao-chat-inline-step-copy{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .5rem}
.oaao-chat-inline-step-agent{flex-shrink:0;display:inline-flex;align-items:center;gap:.3rem;max-width:100%;padding:.125rem .5rem .125rem .25rem;border-radius:9999px;border:1px solid color-mix(in srgb,var(--grid-accent,#2563eb) 35%,var(--grid-line,rgba(0,0,0,.1)));background:color-mix(in srgb,var(--grid-accent,#2563eb) 10%,var(--grid-panel-bright,#fff));color:var(--grid-accent,#2563eb);font-size:.6875rem;line-height:1.25;font-weight:600}
.oaao-chat-inline-step-agent .oaao-task-list-row-agent-icon{width:14px;height:14px;border-radius:50%;background:transparent;color:inherit}
.oaao-chat-inline-step-agent .oaao-task-list-row-agent-icon svg{width:10px;height:10px}
.oaao-chat-inline-step-agent .oaao-task-list-row-agent-label{white-space:nowrap;font-weight:600;color:inherit}
.oaao-chat-inline-step.is-active .oaao-chat-inline-step-agent{border-color:color-mix(in srgb,var(--grid-accent,#2563eb) 55%,transparent);background:color-mix(in srgb,var(--grid-accent,#2563eb) 14%,var(--grid-panel-bright,#fff))}
.oaao-chat-inline-step-title{font-weight:600;color:var(--grid-ink,#111)}
.oaao-chat-inline-step.is-active .oaao-chat-inline-step-title{color:var(--grid-accent,#2563eb)}
.oaao-chat-inline-step-sublist{list-style:none;margin:.35rem 0 0 1.45rem;padding:0 0 0 .75rem;border-left:2px solid color-mix(in srgb,var(--grid-line,rgba(0,0,0,.1)) 92%,transparent);display:flex;flex-direction:column;gap:.3rem}
.oaao-chat-inline-substep{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:.45rem;row-gap:.35rem;align-items:start;min-width:0;font-size:.8125rem;line-height:1.45;color:var(--grid-ink-muted,#666)}
.oaao-chat-inline-substep::before{content:'';grid-column:1;grid-row:1;width:5px;height:5px;margin-top:.42rem;border-radius:50%;background:color-mix(in srgb,var(--grid-ink-muted,#888) 55%,var(--grid-line,rgba(0,0,0,.12)))}
.oaao-chat-inline-substep--has-marker::before{display:none}
.oaao-chat-inline-substep-marker{grid-column:1;grid-row:1;align-self:start;margin-top:.05rem}
.oaao-chat-inline-substep-marker svg,.oaao-chat-inline-substep-marker .oaao-task-list-check{width:14px!important;height:14px!important}
.oaao-chat-inline-substep-head{grid-column:2;grid-row:1;min-width:0}
.oaao-chat-inline-substep .oaao-chat-substep-preview{grid-column:2;grid-row:2;margin-left:0;min-width:0;width:min(100%,14rem);max-width:14rem}
.oaao-chat-substep-preview__frame{display:block;box-sizing:border-box;width:100%;aspect-ratio:16/9;height:auto;overflow:hidden}
.oaao-chat-inline-substep.is-active{color:var(--grid-ink,#111);font-weight:500}
.oaao-chat-inline-substep.is-active:not(.oaao-chat-inline-substep--has-marker)::before{background:var(--grid-accent,#2563eb);box-shadow:0 0 0 3px color-mix(in srgb,var(--grid-accent,#2563eb) 20%,transparent)}
.oaao-chat-inline-substep.is-done .oaao-chat-inline-substep-marker{color:var(--grid-accent,#2563eb)}
.oaao-chat-pipeline-details{display:none!important}
.workspace-rail-agents .oaao-workspace-rail-agent-icon svg{width:16px;height:16px}
@media (min-width:768px) and (hover:hover){.oaao-chat-convo-actions{opacity:0;pointer-events:none;transition:opacity 150ms ease-out}.oaao-chat-convo-row:hover .oaao-chat-convo-actions,.oaao-chat-convo-row:focus-within .oaao-chat-convo-actions,.oaao-chat-convo-row:has(.oaao-chat-convo-menu.is-open) .oaao-chat-convo-actions{opacity:1;pointer-events:auto}}
.oaao-chat-convo-menu-trigger{display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;flex-shrink:0;border:none;border-radius:8px;background:transparent;cursor:pointer;color:var(--grid-caption);font:inherit;transition:background .15s,color .15s}
.oaao-chat-convo-menu-trigger:hover,.oaao-chat-convo-menu-trigger:focus-visible{background:color-mix(in srgb,var(--grid-line) 45%,transparent);color:var(--grid-ink)}
.oaao-chat-convo-menu-panel{position:fixed;z-index:9500;min-width:11.5rem;padding:.25rem 0;border-radius:10px;border:1px solid var(--grid-line);background:var(--grid-panel-bright);box-shadow:0 8px 24px rgba(0,0,0,.12)}
.oaao-chat-convo-menu-item{display:block;width:100%;box-sizing:border-box;text-align:left;padding:.5rem .75rem;border:none;background:transparent;font:inherit;font-size:.8125rem;line-height:1.35;color:var(--grid-ink);cursor:pointer}
.oaao-chat-convo-menu-item:hover{background:color-mix(in srgb,var(--grid-line) 35%,transparent)}
.oaao-chat-convo-menu-item--danger{color:#dc2626}
.oaao-chat-convo-menu-item--danger:hover{background:color-mix(in srgb,#dc2626 12%,transparent)}
.oaao-chat-convo-menu-sep{height:1px;margin:.25rem 0;background:var(--grid-line)}
.oaao-chat-run-status{display:inline-flex;align-items:center;gap:.5rem;padding:.15rem 0 .35rem;font-size:.875rem;color:var(--grid-ink-muted,#666)}
.oaao-chat-run-status-dot{width:8px;height:8px;border-radius:50%;background:var(--grid-accent,#2563eb);animation:oaao-run-pulse 1.15s ease-in-out infinite}
.oaao-chat-run-status-label{font-weight:500;color:var(--grid-ink,#111)}
@keyframes oaao-run-pulse{0%,100%{opacity:.35;transform:scale(.88)}50%{opacity:1;transform:scale(1)}}
.oaao-chat-turn-score-pills{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;margin:.15rem 0 .35rem;width:100%}
.oaao-chat-turn-score-pill{position:relative;display:inline-flex;align-items:center;padding:.12rem .55rem;border-radius:9999px;font-size:.6875rem;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.35;border:1px solid transparent;cursor:default;user-select:none}
.oaao-chat-turn-score-pill--iqs{color:color-mix(in srgb,var(--grid-accent,#2563eb) 88%,var(--grid-ink,#111));background:color-mix(in srgb,var(--grid-accent,#2563eb) 10%,transparent);border-color:color-mix(in srgb,var(--grid-accent,#2563eb) 28%,transparent)}
.oaao-chat-turn-score-pill--accs{color:color-mix(in srgb,#059669 88%,var(--grid-ink,#111));background:color-mix(in srgb,#059669 10%,transparent);border-color:color-mix(in srgb,#059669 28%,transparent)}
.oaao-chat-turn-score-pill--pending{opacity:.55}
.oaao-chat-turn-score-pill--has-tip{cursor:help}
.oaao-chat-turn-score-card{position:fixed;min-width:11.5rem;max-width:min(16rem,88vw);padding:0;border-radius:12px;border:1px solid color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 88%,transparent);background:var(--grid-panel-bright,#fff);color:var(--grid-ink,#111);box-shadow:0 12px 32px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.05);pointer-events:none;font-family:ui-sans-serif,system-ui,sans-serif;overflow:hidden;animation:oaao-cite-pop-in .14s ease-out;z-index:9100}
.oaao-chat-turn-score-card__head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.45rem .6rem;border-bottom:1px solid color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 72%,transparent)}
.oaao-chat-turn-score-card--iqs .oaao-chat-turn-score-card__head{background:color-mix(in srgb,var(--grid-accent,#2563eb) 8%,var(--grid-panel-bright,#fff))}
.oaao-chat-turn-score-card--accs .oaao-chat-turn-score-card__head{background:color-mix(in srgb,#059669 8%,var(--grid-panel-bright,#fff))}
.oaao-chat-turn-score-card__title{font-size:.6875rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.oaao-chat-turn-score-card--iqs .oaao-chat-turn-score-card__title{color:color-mix(in srgb,var(--grid-accent,#2563eb) 88%,var(--grid-ink,#111))}
.oaao-chat-turn-score-card--accs .oaao-chat-turn-score-card__title{color:color-mix(in srgb,#059669 88%,var(--grid-ink,#111))}
.oaao-chat-turn-score-card__score{font-size:.8125rem;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.oaao-chat-turn-score-card__dims{display:flex;flex-direction:column;gap:.42rem;padding:.5rem .6rem .58rem}
.oaao-chat-turn-score-card__dim{display:grid;grid-template-columns:minmax(0,1fr) minmax(3.2rem,auto);grid-template-rows:auto 5px;column-gap:.45rem;row-gap:.22rem;align-items:start}
.oaao-chat-turn-score-card__dim-label{grid-column:1;grid-row:1;font-size:.6875rem;color:var(--grid-ink-muted,#666);line-height:1.2}
.oaao-chat-turn-score-card__dim-val{grid-column:2;grid-row:1 / span 2;align-self:center;font-size:.6875rem;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:right;color:var(--grid-ink,#111)}
.oaao-chat-turn-score-card__dim-bar{grid-column:1;grid-row:2;height:5px;min-height:5px;max-height:5px;align-self:stretch;border-radius:999px;background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 55%,transparent);overflow:hidden;line-height:0}
.oaao-chat-turn-score-card__dim-fill{display:block;height:5px;min-height:5px;border-radius:inherit;background:var(--grid-accent,#2563eb);opacity:.85}
.oaao-chat-turn-score-card--accs .oaao-chat-turn-score-card__dim-fill{background:#059669}
.oaao-chat-turn-score-floater{position:absolute;min-width:9rem;max-width:min(16rem,70vw);padding:.4rem .55rem;border-radius:8px;border:1px solid var(--grid-line,rgba(0,0,0,.12));background:var(--grid-panel-bright,#fff);color:var(--grid-ink,#111);font-size:.6875rem;font-weight:500;line-height:1.45;white-space:pre-line;box-shadow:0 6px 18px rgba(0,0,0,.08);pointer-events:none;font-family:ui-sans-serif,system-ui,sans-serif}
.oaao-chat-composer-dropup-root{position:relative;display:inline-flex;flex-direction:column;align-items:center;vertical-align:bottom}
.oaao-chat-composer-dropup-icon-slot{position:relative;display:inline-flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-top:1.375rem;box-sizing:content-box}
.oaao-chat-composer-dropup-arrow{position:absolute;top:0;left:50%;transform:translateX(-50%);display:inline-flex;align-items:center;justify-content:center;width:1.125rem;height:1.125rem;padding:0;border:none;border-radius:999px;background:var(--grid-panel-bright,#fff);color:var(--grid-ink-muted,#666);box-shadow:0 1px 4px rgba(0,0,0,.14);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .14s ease;z-index:3}
.oaao-chat-composer-dropup-icon-slot:hover .oaao-chat-composer-dropup-arrow,.oaao-chat-composer-dropup-icon-slot:focus-within .oaao-chat-composer-dropup-arrow,.oaao-chat-composer-dropup-root:hover .oaao-chat-composer-dropup-arrow,.oaao-chat-composer-dropup-root:focus-within .oaao-chat-composer-dropup-arrow,.oaao-chat-composer-dropup-root.is-open .oaao-chat-composer-dropup-arrow{opacity:1;pointer-events:auto}
.oaao-chat-composer-dropup-anchor{position:absolute;left:50%;bottom:calc(100% - .125rem);transform:translateX(-50%);z-index:70;min-width:10.5rem;max-width:min(18rem,calc(100vw - 2rem));padding-bottom:.5rem;margin-bottom:-.5rem;box-sizing:content-box}
.oaao-chat-composer-dropup-anchor.hidden,.oaao-chat-composer-dropup-anchor[hidden]{display:none!important}
.oaao-chat-composer-dropup-panel{border-radius:10px;border:1px solid var(--grid-line,rgba(0,0,0,.12));background:var(--grid-panel-bright,#fff);box-shadow:0 8px 24px rgba(0,0,0,.14);overflow:hidden;color:var(--grid-ink,#111)}
.oaao-chat-composer-dropup-heading{margin:0;padding:.5rem .625rem .25rem;font-size:.6875rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--grid-caption,#888)}
.oaao-chat-composer-dropup-list{display:flex;flex-direction:column;gap:.125rem;max-height:min(40vh,240px);overflow:auto;padding:.25rem}
.oaao-chat-composer-dropup-option{width:100%;display:flex;align-items:center;gap:.375rem;min-width:0;padding:.375rem .5rem;border:none;border-radius:6px;background:transparent;color:var(--grid-ink,#111);font:inherit;font-size:.8125rem;text-align:left;cursor:pointer}
.oaao-chat-composer-dropup-option--selected{background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 45%,transparent);font-weight:600}
`;
    document.head.append(style);
}

/** Dynamic core helper {@code oaao-razy-toast.js} — avoids static imports across webasset trees. */
let oaaoToastHelperPromise = null;

function loadOaaoToastHelper() {
    if (!oaaoToastHelperPromise) {
        const url = oaaoPrefixedSitePath('/webassets/core/default/js/oaao-razy-toast.js');
        oaaoToastHelperPromise = import(/* webpackIgnore: true */ url).then((m) => m.oaaoRazyToastFire);
    }

    return oaaoToastHelperPromise;
}

/**
 * RazyUI {@code Toast}. Second argument {@code anchor} is unused (corner stack).
 *
 * @param {string} msg
 * @param {Element | null} [anchor]
 * @param {'success' | 'error' | 'info' | 'warning'} [kind]
 */
function toastOaao(msg, anchor = null, kind) {
    void anchor;
    const k =
        kind ??
        (/could not|invalid or expired|Could not create/i.test(msg)
            ? 'error'
            : /copied|archived|restored|deleted/i.test(msg)
              ? 'success'
              : 'info');
    void loadOaaoToastHelper()
        .then((fire) => fire(msg, k))
        .catch(() => {});
}

/** @type {WeakMap<HTMLElement, { destroy: () => void }>} */
const oaaoMilestoneCtlByHost = new WeakMap();

/** @type {Promise<new (el: HTMLElement, opts?: Record<string, unknown>) => { getControl: () => { destroy: () => void } } }> | null} */
let oaaoMilestoneCtorPromise = null;

function preloadOaaoMilestoneCtor() {
    if (!oaaoMilestoneCtorPromise) {
        const url = oaaoPrefixedSitePath('/webassets/core/default/razyui/component/Milestone.js');
        oaaoMilestoneCtorPromise = import(/* webpackIgnore: true */ url).then((m) => m.default);
    }

    return oaaoMilestoneCtorPromise;
}

/**
 * Milestone fragment {@code milestone.steps[]}: orchestrator / {@code meta.oaao_pipeline.milestone}.
 *
 * @param {Record<string, unknown>} om
 * @returns {{ steps: Array<{ title: string, description?: string, icon?: string, error?: boolean }>, active: number } | null}
 */
function buildMilestoneControlOptions(om) {
    const raw = om.steps;
    if (!Array.isArray(raw) || raw.length === 0) return null;

    /** @type {{ title: string, description?: string, completed: boolean, active: boolean, error: boolean }[]} */
    const states = [];
    for (let idx = 0; idx < raw.length; idx++) {
        const item = raw[idx];
        const o = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {};
        const title = String(o.title ?? `Step ${idx + 1}`).trim();
        const description = String(o.description ?? '').trim();
        const summary = String(o.summary ?? '').trim();
        const taskLabel = String(o.task_label ?? o.task ?? '').trim();
        const body = description || summary;
        const descJoined = [body, taskLabel ? `Task: ${taskLabel}` : ''].filter(Boolean).join('\n').trim();
        const state = String(o.state ?? '').toLowerCase();
        const completed = state === 'completed' || state === 'done' || o.completed === true;
        const active = state === 'active' || state === 'running';
        const error = state === 'error' || o.error === true;
        states.push({
            title,
            description: descJoined || undefined,
            completed,
            active,
            error,
        });
    }

    let activeIdx = states.findIndex((s) => s.active);
    if (activeIdx < 0) {
        const pend = states.findIndex((s) => !s.completed && !s.error);
        activeIdx = pend >= 0 ? pend : Math.max(0, states.length - 1);
    }

    const allDone = states.length > 0 && states.every((s) => s.completed && !s.error);

    const mileSteps = states.map((s) => ({
        title: s.title,
        description: s.description,
        icon: (s.completed || allDone) && !s.error ? 'ri-check rz-icon' : undefined,
        error: s.error,
    }));

    if (allDone) {
        activeIdx = states.length - 1;
    }

    return { steps: mileSteps, active: activeIdx };
}

/** @param {Record<string, unknown> | null | undefined} data */
function normalizePipelinePayloadFromEnvelope(data) {
    if (!data || typeof data !== 'object') return null;
    const p = /** @type {Record<string, unknown>} */ (data).payload;
    if (!p || typeof p !== 'object') return null;
    const pipe = /** @type {Record<string, unknown>} */ (p).oaao_pipeline;
    if (pipe && typeof pipe === 'object') return /** @type {Record<string, unknown>} */ (pipe);
    const leg = /** @type {Record<string, unknown>} */ (p).oaao_milestone;
    if (leg && typeof leg === 'object') return { milestone: leg };

    return null;
}

/** @param {Record<string, unknown> | null | undefined} meta */
function normalizePipelineFromMeta(meta) {
    if (!meta || typeof meta !== 'object') return null;
    const m = /** @type {Record<string, unknown>} */ (meta);
    if (m.oaao_pipeline && typeof m.oaao_pipeline === 'object') {
        return /** @type {Record<string, unknown>} */ (m.oaao_pipeline);
    }
    if (m.oaao_milestone && typeof m.oaao_milestone === 'object') {
        return { milestone: /** @type {Record<string, unknown>} */ (m.oaao_milestone) };
    }

    return null;
}

const OAAO_TASK_LIST_SS_PREFIX = 'oaao_task_list_v1:';

const OAAO_TASK_CHECK_DONE_SVG =
    '<svg class="oaao-task-list-check" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
    + '<circle cx="10" cy="10" r="9" fill="#22c55e"/>'
    + '<path d="M6.2 10.3 8.8 13 13.8 7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</svg>';

const OAAO_TASK_CHECK_ACTIVE_SVG =
    '<svg class="oaao-task-list-check" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
    + '<circle cx="10" cy="10" r="8.5" stroke="currentColor" stroke-width="2" fill="none"/>'
    + '</svg>';

/** In-progress task steps (active / running). */
const OAAO_TASK_CHECK_SPINNER_SVG =
    '<svg class="oaao-task-list-check oaao-task-list-check--spinning" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
    + '<circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="22 50"/>'
    + '</svg>';

const OAAO_TASK_CHECK_PENDING_SVG =
    '<svg class="oaao-task-list-check" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
    + '<circle cx="10" cy="10" r="8.5" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.4"/>'
    + '</svg>';

/** Stopped / skipped run steps (user cancel or orchestrator skip). */
const OAAO_TASK_CHECK_CANCELLED_SVG =
    '<svg class="oaao-task-list-check oaao-task-list-check--cancelled" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
    + '<circle cx="10" cy="10" r="8.5" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.5"/>'
    + '<path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    + '</svg>';

const OAAO_TASK_OPEN_STATUSES = new Set(['pending', 'active', 'running', 'awaiting_ask']);

const OAAO_TASK_CHEVRON_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="m6 9 6 6 6-6"/>'
    + '</svg>';

const OAAO_TASK_ROW_CHEVRON_SVG =
    '<svg class="oaao-task-list-row-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="m6 9 6 6 6-6"/>'
    + '</svg>';

/** Phases that carry {@code payload.agent_task} (orchestrator agent sub-steps). */
const OAAO_TASK_AGENT_PHASES = new Set(['rag', 'agent', 'sandbox', 'mcp', 'web_search']);

/**
 * @param {string} [agentKind]
 * @returns {HTMLSpanElement | null}
 */
function buildOaaoTaskRowAgentChip(agentKind) {
    const entry = getOaaoAgentCatalogEntry(agentKind);
    if (!entry) return null;
    const wrap = document.createElement('span');
    wrap.className = 'oaao-task-list-row-agent';
    const icon = document.createElement('span');
    icon.className = 'oaao-task-list-row-agent-icon';
    icon.innerHTML = entry.icon;
    const lbl = document.createElement('span');
    lbl.className = 'oaao-task-list-row-agent-label';
    lbl.setAttribute('data-i18n', entry.labelKey);
    lbl.textContent = oaaoChatT(entry.labelKey, entry.fallbackLabel);
    wrap.append(icon, lbl);
    return wrap;
}

/**
 * @param {OaaoTaskItemState} row
 * @returns {HTMLSpanElement | null}
 */
function buildOaaoTaskDurationBadge(row) {
    const st = oaaoEffectiveTaskRowStatus(row);
    if (st !== 'done' && st !== 'failed' && st !== 'skipped') return null;
    const dur = formatOaaoDurationMs(row.duration_ms);
    if (!dur) return null;
    const badge = document.createElement('span');
    badge.className = 'oaao-task-duration-badge';
    badge.textContent = dur;
    badge.title = oaaoChatT('chat.task.duration_hint', 'Step duration');
    return badge;
}

/**
 * @param {HTMLElement} copyCol
 * @param {OaaoTaskItemState} row
 */
function syncOaaoTaskDurationBadge(copyCol, row) {
    if (!(copyCol instanceof HTMLElement)) return;
    let badge = copyCol.querySelector('.oaao-task-duration-badge');
    const next = buildOaaoTaskDurationBadge(row);
    if (!next) {
        badge?.remove();
        return;
    }
    if (badge instanceof HTMLElement) {
        badge.textContent = next.textContent;
        return;
    }
    copyCol.append(next);
}

/**
 * @param {OaaoTaskItemState} row
 * @returns {HTMLSpanElement}
 */
function buildOaaoTaskRowCopyColumn(row) {
    const col = document.createElement('span');
    col.className = 'oaao-task-list-row-copy';
    const text = document.createElement('span');
    text.className = 'oaao-task-list-row-text';
    text.textContent = String(row.title ?? '—');
    col.append(text);
    const chip = buildOaaoTaskRowAgentChip(row.agent_kind);
    if (chip) col.append(chip);
    const durBadge = buildOaaoTaskDurationBadge(row);
    if (durBadge) col.append(durBadge);
    return col;
}

/**
 * @param {HTMLElement} outer
 * @returns {HTMLElement}
 */
function getOrCreateAssistantInlineStepsHost(outer) {
    let host = outer.querySelector('[data-oaao-chat="inline-task-steps"]');
    if (!(host instanceof HTMLElement)) {
        host = document.createElement('div');
        host.dataset.oaaoChat = 'inline-task-steps';
        host.className = 'oaao-chat-inline-task-steps w-full min-w-0 max-w-full';
        host.setAttribute('aria-live', 'polite');
        host.hidden = true;
        host.classList.add('hidden');
        const bubble = outer.querySelector('[data-oaao-msg-role="assistant"]');
        if (bubble instanceof HTMLElement) {
            outer.insertBefore(host, bubble);
        } else {
            const identity = outer.querySelector('.oaao-chat-assistant-identity');
            if (identity instanceof HTMLElement) {
                identity.insertAdjacentElement('afterend', host);
            } else {
                outer.prepend(host);
            }
        }
    }
    return host;
}

/**
 * @param {HTMLElement} host
 * @returns {boolean}
 */
function isOaaoInlineTaskStepsHost(host) {
    return host.dataset.oaaoChat === 'inline-task-steps';
}

/**
 * @param {HTMLElement | Document} root
 * @param {number} [conversationId]
 * @returns {HTMLElement | null}
 */
function resolveOaaoTaskStepsHost(root, conversationId = 0) {
    const mount =
        root.querySelector('[data-module="oaao-chat"]') instanceof HTMLElement
            ? root.querySelector('[data-module="oaao-chat"]')
            : root instanceof HTMLElement && root.matches('[data-module="oaao-chat"]')
              ? root
              : root.querySelector?.('[data-module="oaao-chat"]') ?? root;

    if (conversationId > 0 && activeConversationId !== conversationId) {
        return null;
    }

    const msgId = conversationId > 0 ? oaaoStreamAssistantMsgIdByConv.get(conversationId) : 0;
    if (msgId && mount) {
        const bubble = mount.querySelector(`[data-oaao-msg-id="${msgId}"]`);
        const outer = bubble?.closest('.oaao-chat-assistant-row');
        if (outer instanceof HTMLElement) {
            return getOrCreateAssistantInlineStepsHost(outer);
        }
        return null;
    }

    const msgs = mount?.querySelector('[data-oaao-chat="messages"]');
    if (msgs && conversationId > 0 && activeConversationId === conversationId) {
        const rows = msgs.querySelectorAll('.oaao-chat-assistant-row');
        for (let i = rows.length - 1; i >= 0; i -= 1) {
            const row = rows[i];
            if (!(row instanceof HTMLElement)) continue;
            if (row.querySelector('[data-oaao-chat="inline-task-steps"]') || i === rows.length - 1) {
                return getOrCreateAssistantInlineStepsHost(row);
            }
        }
    }

    const legacy = mount?.querySelector('[data-oaao-chat="task-list-strip"]');
    return legacy instanceof HTMLElement ? legacy : null;
}

/**
 * @param {number} conversationId
 * @returns {OaaoTaskListState}
 */
function getOaaoTaskListStateForConversation(conversationId) {
    if (!conversationId || conversationId < 1) {
        return createEmptyOaaoTaskListState();
    }
    let state = oaaoTaskListStateByConversation.get(conversationId);
    if (!state) {
        state = createEmptyOaaoTaskListState();
        oaaoTaskListStateByConversation.set(conversationId, state);
    }
    return state;
}

/**
 * @param {number} conversationId
 * @param {OaaoTaskListState} state
 */
function setOaaoTaskListStateForConversation(conversationId, state) {
    if (conversationId > 0) {
        oaaoTaskListStateByConversation.set(conversationId, state);
    }
}

/**
 * @param {OaaoTaskListState} state
 * @param {{ collapsed?: boolean, panelView?: 'steps' | 'agents' }} [opts]
 */
function buildOaaoTasksPersistPayload(state, opts = {}) {
    const items = [...state.items.values()].map((it) => ({
        id: it.id,
        title: it.title,
        status: it.status,
        ...(it.agent_kind ? { agent_kind: it.agent_kind } : {}),
        ...(it.ask ? { ask: it.ask } : {}),
        ...(it.agent_tasks?.length
            ? {
                  agent_tasks: it.agent_tasks.map((at) => ({
                      ...at,
                      ...(at.preview ? { preview: at.preview } : {}),
                  })),
              }
            : {}),
        ...(it.slide_workers ? { slide_workers: true } : {}),
    }));
    return {
        items,
        ...(state.abilities?.length ? { abilities: state.abilities } : {}),
        ...(state.allowed_agents?.length ? { allowed_agents: state.allowed_agents } : {}),
        ...(typeof opts.collapsed === 'boolean' ? { collapsed: opts.collapsed } : {}),
        ...(opts.panelView ? { panelView: opts.panelView } : {}),
    };
}

/**
 * @param {string} st
 * @returns {HTMLSpanElement}
 */
/** @param {OaaoTaskItemState} row */
function oaaoEffectiveTaskRowStatus(row) {
    let st = normalizeOaaoTaskStatus(row.status);
    if (row.slide_workers && row.agent_tasks?.length) {
        const agg = normalizeOaaoTaskStatus(oaaoAggregateWorkerStatuses(row.agent_tasks));
        st = mergeOaaoTaskItemStatus(st, agg);
    }
    return st;
}

function buildOaaoInlineStepMarker(st) {
    const normalized = normalizeOaaoTaskStatus(st);
    const wrap = document.createElement('span');
    wrap.className = 'oaao-chat-inline-step-marker';
    wrap.innerHTML = oaaoTaskCheckSvgForStatus(normalized);
    return wrap;
}

/**
 * @param {string} st
 * @returns {HTMLSpanElement}
 */
function buildOaaoInlineSubstepMarker(st) {
    const normalized = normalizeOaaoTaskStatus(st);
    const visual = normalized === 'running' ? 'active' : normalized;
    const wrap = document.createElement('span');
    wrap.className = 'oaao-chat-inline-substep-marker oaao-task-list-check-wrap oaao-task-list-check-wrap--sub';
    wrap.innerHTML = oaaoTaskCheckSvgForStatus(visual);
    return wrap;
}

/**
 * Slide fan-out registers ask on {@code …-outline}; persisted rows may still use the base group id.
 *
 * @param {string} taskId
 * @param {number} conversationId
 * @param {string} [agentKind]
 */
/**
 * @param {string} taskId
 * @returns {string[]}
 */
function oaaoAgentAskTaskIdAliases(taskId) {
    const tid = String(taskId ?? '').trim();
    if (!tid) return [];
    /** @type {Set<string>} */
    const out = new Set([tid]);
    if (tid.endsWith('-outline')) {
        const base = tid.slice(0, -'-outline'.length);
        if (base) out.add(base);
    } else {
        out.add(`${tid}-outline`);
    }
    return [...out];
}

/**
 * Optimistic UI after Run/Skip — clears ask and re-renders (SSE may lag).
 *
 * @param {number} conversationId
 * @param {string} taskId
 * @param {'proceed'|'skip'} decision
 */
function applyOaaoAgentAskDecisionLocally(conversationId, taskId, decision) {
    if (!conversationId || conversationId < 1) return;
    const aliases = new Set(oaaoAgentAskTaskIdAliases(taskId));
    const state = getOaaoTaskListStateForConversation(conversationId);
    let changed = false;
    for (const [id, item] of state.items) {
        const askTid = String(item.ask?.task_id ?? '').trim();
        if (!aliases.has(id) && (!askTid || !aliases.has(askTid))) continue;
        delete item.ask;
        item.status = decision === 'skip' || decision === 'proceed_fork' ? 'skipped' : 'active';
        state.items.set(id, item);
        changed = true;
        if (decision === 'proceed' && isSlideDesignerAgentKind(item.agent_kind)) {
            enterDeskModeForSlideDesigner(conversationId);
        }
    }
    if (!changed) return;
    setOaaoTaskListStateForConversation(conversationId, state);
    const root =
        document.querySelector('[data-module="oaao-chat"]') ??
        document.querySelector('.oaao-chat-root') ??
        document;
    persistOaaoTaskListStrip(root, conversationId);
    renderOaaoTaskListForConversation(root, conversationId, state);
    if (conversationId === activeConversationId) {
        const mount = root instanceof HTMLElement ? root : document.querySelector('[data-module="oaao-chat"]');
        if (mount instanceof HTMLElement) syncComposerBusyForActiveView(mount);
    }
}

function oaaoResolveAgentAskTaskId(taskId, conversationId, agentKind = '') {
    const tid = String(taskId ?? '').trim();
    if (!tid) return '';
    if (String(agentKind ?? '') !== 'slide_designer') return tid;
    const state = conversationId > 0 ? getOaaoTaskListStateForConversation(conversationId) : null;
    if (!state) return tid;
    if (state.items.has(tid)) return tid;
    const outlineId = tid.endsWith('-outline') ? tid : `${tid}-outline`;
    if (state.items.has(outlineId)) return outlineId;
    if (tid.endsWith('-outline')) {
        const base = tid.slice(0, -'-outline'.length);
        if (base && state.items.has(base)) return base;
    }
    return tid;
}

/**
 * @param {OaaoTaskItemState} row
 * @param {number} conversationId
 * @returns {HTMLElement | null}
 */
function buildOaaoAgentAskBar(row, conversationId) {
    const ask = row.ask;
    if (!ask || String(row.status ?? '') !== 'awaiting_ask') return null;

    const kind = String(ask.agent_kind ?? row.agent_kind ?? '');
    const titleKey =
        kind === 'slide_designer' ? 'chat.agent_ask.slide_designer.title' : 'chat.agent_ask.generic.title';
    const messageKey =
        kind === 'slide_designer' ? 'chat.agent_ask.slide_designer.message' : 'chat.agent_ask.generic.message';

    const wrap = document.createElement('div');
    wrap.className = 'oaao-chat-agent-ask';
    wrap.dataset.oaaoAgentAsk = '1';

    const titleEl = document.createElement('p');
    titleEl.className = 'oaao-chat-agent-ask__title';
    titleEl.textContent = String(ask.title ?? oaaoChatT(titleKey, 'Confirm next step'));

    const msgEl = document.createElement('p');
    msgEl.className = 'oaao-chat-agent-ask__message';
    msgEl.textContent = String(ask.message ?? oaaoChatT(messageKey, 'Proceed with this agent?'));

    const actions = document.createElement('div');
    actions.className = 'oaao-chat-agent-ask__actions';

    const forkRecommended =
        Boolean(ask.fork_recommended) ||
        Boolean(ask.suggest_fork) ||
        (Boolean(ask.mode_switch) && isDeskModeConversation(conversationId) && kind !== 'slide_designer');

    const proceedBtn = document.createElement('button');
    proceedBtn.type = 'button';
    proceedBtn.className = 'oaao-chat-agent-ask__btn oaao-chat-agent-ask__btn--proceed';
    proceedBtn.textContent = String(
        ask.proceed_same_label ?? ask.proceed_label ?? oaaoChatT('chat.agent_ask.proceed_same', 'Continue here'),
    );
    proceedBtn.dataset.i18n = 'chat.agent_ask.proceed_same';

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'oaao-chat-agent-ask__btn oaao-chat-agent-ask__btn--skip';
    skipBtn.textContent = String(ask.skip_label ?? oaaoChatT('chat.agent_ask.skip', 'Skip'));
    skipBtn.dataset.i18n = 'chat.agent_ask.skip';

    const runId = String(ask.run_id ?? streamHandlesByConversation.get(conversationId)?.runId ?? '');
    const taskId = oaaoResolveAgentAskTaskId(
        String(ask.task_id ?? row.id ?? ''),
        conversationId,
        String(ask.agent_kind ?? row.agent_kind ?? ''),
    );

    const lockButtons = () => {
        proceedBtn.disabled = true;
        skipBtn.disabled = true;
    };

    const unlockButtons = () => {
        proceedBtn.disabled = false;
        skipBtn.disabled = false;
    };

    const forkHint = String(ask.fork_hint ?? '').trim();
    if (forkRecommended && forkHint) {
        const hintEl = document.createElement('p');
        hintEl.className = 'oaao-chat-agent-ask__fork-hint';
        hintEl.textContent = forkHint;
        wrap.insertBefore(hintEl, actions);
    }

    const submitAsk = async (decision) => {
        if (!runId || !taskId) {
            toastOaao(oaaoChatT('chat.agent_ask.failed', 'Could not apply agent decision'));
            return;
        }
        lockButtons();
        const result = await requestOrchestratorAgentAsk(runId, taskId, decision);
        if (!result.ok) {
            unlockButtons();
            toastOaao(
                result.message ||
                    oaaoChatT(
                        'chat.agent_ask.failed',
                        'Could not apply agent decision — try again (server may have timed out).',
                    ),
            );
            return;
        }
        applyOaaoAgentAskDecisionLocally(conversationId, taskId, decision);
        wrap.remove();
        streamPausedForAgentAskByConversation.delete(conversationId);
        if (!streamHandlesByConversation.has(conversationId)) {
            resumeAssistantStreamAfterAgentAsk(conversationId);
        } else if (conversationId === activeConversationId) {
            const mount = document.querySelector('[data-module="oaao-chat"]');
            if (mount instanceof HTMLElement) syncComposerBusyForActiveView(mount);
        }
    };

    proceedBtn.addEventListener('click', () => {
        void submitAsk('proceed');
    });
    skipBtn.addEventListener('click', () => {
        void submitAsk('skip');
    });

    actions.append(proceedBtn, skipBtn);

    if (forkRecommended) {
        const forkBtn = document.createElement('button');
        forkBtn.type = 'button';
        forkBtn.className = 'oaao-chat-agent-ask__btn oaao-chat-agent-ask__btn--fork';
        forkBtn.textContent = String(
            ask.proceed_fork_label ?? oaaoChatT('chat.agent_ask.fork_new_chat', 'New chat for this mode'),
        );
        forkBtn.dataset.i18n = 'chat.agent_ask.fork_new_chat';
        forkBtn.addEventListener('click', () => {
            lockButtons();
            void (async () => {
                if (runId && taskId) {
                    await requestOrchestratorAgentAsk(runId, taskId, 'proceed_fork');
                    applyOaaoAgentAskDecisionLocally(conversationId, taskId, 'skip');
                }
                await requestOrchestratorCancelRun(runId);
                const newId = await forkConversationForModeSwitch(conversationId);
                if (!newId) {
                    unlockButtons();
                    toastOaao(oaaoChatT('chat.agent_ask.fork_failed', 'Could not start a new chat'));
                    return;
                }
                wrap.remove();
                const rows = cachedMessageRows;
                const lastUser = [...rows].reverse().find((m) => String(m.role ?? '') === 'user');
                const prompt = typeof lastUser?.content === 'string' ? lastUser.content.trim() : '';
                document.dispatchEvent(
                    new CustomEvent('oaao-switch-conversation', {
                        bubbles: true,
                        detail: {
                            conversation_id: newId,
                            mode: String(ask.target_mode ?? 'default'),
                            fork_autosend_prompt: prompt,
                            pending_agent_kind: kind,
                        },
                    }),
                );
                toastOaao(oaaoChatT('chat.agent_ask.fork_done', 'Opened a new chat for the other mode'));
            })();
        });
        actions.append(forkBtn);
    }
    wrap.append(titleEl, msgEl, actions);

    return wrap;
}

/**
 * Attach pending agent confirmation to a checklist row (survives full tasks snapshots).
 *
 * @param {OaaoTaskListState} state
 * @param {Record<string, unknown>} agentAsk
 * @param {number} conversationId
 * @returns {OaaoTaskListState}
 */
function applyOaaoAgentAskPayload(state, agentAsk, conversationId) {
    const rid = String(agentAsk.run_task_id ?? '').trim();
    if (!rid) return state;
    const item = state.items.get(rid) || {
        id: rid,
        title: String(agentAsk.title ?? '—'),
        status: 'awaiting_ask',
        agent_tasks: [],
    };
    item.status = 'awaiting_ask';
    if (agentAsk.title) item.title = String(agentAsk.title);
    if (agentAsk.agent_kind) item.agent_kind = String(agentAsk.agent_kind);
    const resolvedTaskId = oaaoResolveAgentAskTaskId(
        rid,
        conversationId,
        String(agentAsk.agent_kind ?? item.agent_kind ?? ''),
    );
    item.ask = {
        run_id: String(agentAsk.run_id ?? streamHandlesByConversation.get(conversationId)?.runId ?? ''),
        task_id: resolvedTaskId,
        message: String(agentAsk.message ?? ''),
        title: String(agentAsk.title ?? ''),
        proceed_label: String(agentAsk.proceed_label ?? agentAsk.proceed_same_label ?? ''),
        skip_label: String(agentAsk.skip_label ?? ''),
        agent_kind: String(agentAsk.agent_kind ?? item.agent_kind ?? ''),
        mode_switch: Boolean(agentAsk.mode_switch),
        suggest_fork: Boolean(agentAsk.suggest_fork),
        fork_recommended: Boolean(agentAsk.fork_recommended),
        target_mode: String(agentAsk.target_mode ?? 'default'),
        prior_agent_kind: String(agentAsk.prior_agent_kind ?? ''),
        fork_hint: String(agentAsk.fork_hint ?? ''),
        proceed_same_label: String(agentAsk.proceed_same_label ?? agentAsk.proceed_label ?? ''),
        proceed_fork_label: String(agentAsk.proceed_fork_label ?? ''),
    };
    state.items.set(rid, item);
    return state;
}

/**
 * @param {{ title?: string, preview?: Record<string, unknown> }} at
 */
function formatSlideWorkerDisplayTitle(at) {
    const raw = String(at.title ?? '').trim();
    if (raw.includes('—') || raw.includes(' - ')) return raw;
    const preview = at.preview && typeof at.preview === 'object' ? at.preview : null;
    const slideTitle = preview && typeof preview.title === 'string' ? preview.title.trim() : '';
    const idx = preview && typeof preview.slide_index === 'number' ? preview.slide_index : 0;
    const total = preview && typeof preview.slide_count === 'number' ? preview.slide_count : 0;
    const m = /^Slide\s+(\d+)\s*\/\s*(\d+)/i.exec(raw);
    const n = m ? Number(m[1]) : idx;
    const t = m ? Number(m[2]) : total;
    if (n > 0 && t > 0) {
        return slideTitle ? `Slide ${n}/${t} — ${slideTitle}` : `Slide ${n}/${t}`;
    }
    return raw || '—';
}

/**
 * @param {string} [label]
 * @returns {HTMLElement}
 */
function createOaaoSlidePreviewSpinnerEl(label = '') {
    const overlay = oaaoLoadingLogoElement({
        block: false,
        label: String(label || '').trim() || 'Loading preview…',
    });
    overlay.className = 'oaao-chat-substep-preview__loading oaao-loading-logo';
    return overlay;
}

/**
 * @param {HTMLElement} frame
 * @param {boolean} busy
 * @param {string} [label]
 */
function setOaaoSlidePreviewLoading(frame, busy, label = '') {
    if (!(frame instanceof HTMLElement)) return;
    let overlay = frame.querySelector('.oaao-chat-substep-preview__loading');
    if (busy) {
        frame.classList.add('oaao-chat-substep-preview__frame--loading');
        if (!overlay) {
            frame.append(createOaaoSlidePreviewSpinnerEl(label));
        } else {
            const sr = overlay.querySelector('.sr-only');
            if (sr instanceof HTMLElement && label) {
                sr.textContent = label;
            }
        }
        return;
    }
    frame.classList.remove('oaao-chat-substep-preview__frame--loading');
    overlay?.remove();
}

/**
 * @param {HTMLIFrameElement} iframe
 * @param {number} [timeoutMs]
 */
function waitForSlidePreviewIframeLoad(iframe, timeoutMs = 12000) {
    return new Promise((resolve) => {
        if (!(iframe instanceof HTMLIFrameElement)) {
            resolve();
            return;
        }
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        iframe.addEventListener('load', done, { once: true });
        window.setTimeout(done, Math.max(1500, timeoutMs));
    });
}

/**
 * @param {string} rawUrl
 * @returns {{ projectId: string, page: number } | null}
 */
function parseOaaoSlidePreviewUrl(rawUrl) {
    const raw = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!raw) return null;
    try {
        const path = raw.startsWith('/') ? raw : `/${raw}`;
        const u = new URL(oaaoPrefixedSitePath(path), window.location.href);
        const projectId = (u.searchParams.get('project_id') || '').trim();
        const page = Number(u.searchParams.get('page') || '0');
        if (!projectId || !Number.isFinite(page) || page < 1) return null;
        return { projectId, page: Math.floor(page) };
    } catch {
        return null;
    }
}

function slideDesignerApiUrl(action) {
    const a = String(action || '').replace(/^\/+/, '');
    return oaaoPrefixedSitePath(`/slide-designer/api/${a}`);
}

/**
 * @param {string} previewUrl
 * @param {number} conversationId
 * @returns {string}
 */
function oaaoSlidePreviewIframeSrc(previewUrl, conversationId) {
    let src = previewUrl.trim();
    if (!src.includes('conversation_id=') && conversationId > 0) {
        const sep = src.includes('?') ? '&' : '?';
        src = `${src}${sep}conversation_id=${encodeURIComponent(String(conversationId))}`;
    }
    return oaaoPrefixedSitePath(src.startsWith('/') ? src : `/${src}`);
}

/**
 * @param {HTMLIFrameElement} iframe
 * @param {string} previewUrl
 * @param {number} conversationId
 */
function bustOaaoSlidePreviewIframe(iframe, previewUrl, conversationId) {
    const base = oaaoSlidePreviewIframeSrc(previewUrl, conversationId);
    const u = new URL(base, window.location.href);
    u.searchParams.set('_t', String(Date.now()));
    iframe.src = u.href;
}

/**
 * @param {HTMLElement} frame
 * @param {HTMLIFrameElement} iframe
 * @param {number} conversationId
 * @param {string} previewUrl
 */
function mountOaaoSlidePreviewActions(frame, iframe, conversationId, previewUrl) {
    const parsed = parseOaaoSlidePreviewUrl(previewUrl);
    if (!parsed || conversationId < 1) return;

    const actions = document.createElement('div');
    actions.className = 'oaao-chat-substep-preview__actions';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'oaao-chat-substep-preview__menu-btn';
    menuBtn.setAttribute('aria-label', oaaoChatT('chat.slide_preview.menu', 'Slide actions'));
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    const menuSvg = oaaoChatStrokeSvgShell('w-4 h-4');
    const c1 = document.createElementNS(SVG_NS, 'circle');
    c1.setAttribute('cx', '12');
    c1.setAttribute('cy', '5');
    c1.setAttribute('r', '1.5');
    const c2 = document.createElementNS(SVG_NS, 'circle');
    c2.setAttribute('cx', '12');
    c2.setAttribute('cy', '12');
    c2.setAttribute('r', '1.5');
    const c3 = document.createElementNS(SVG_NS, 'circle');
    c3.setAttribute('cx', '12');
    c3.setAttribute('cy', '19');
    c3.setAttribute('r', '1.5');
    menuSvg.append(c1, c2, c3);
    menuBtn.append(menuSvg);

    const panel = document.createElement('div');
    panel.className = 'oaao-chat-substep-preview__menu-panel hidden';
    panel.setAttribute('role', 'menu');

    const closePanel = () => {
        panel.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
    };

    /**
     * @param {string} label
     * @param {() => void | Promise<void>} fn
     * @param {HTMLElement} [parent]
     */
    const addMenuItem = (label, fn, parent = panel) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'oaao-chat-substep-preview__menu-item';
        item.textContent = label;
        item.setAttribute('role', 'menuitem');
        item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            closePanel();
            void Promise.resolve(fn()).catch(() => {
                toastOaao(oaaoChatT('chat.slide_preview.action_failed', 'Slide action failed'));
            });
        });
        parent.append(item);
        return item;
    };

    const setBusy = (busy, label = '') => {
        menuBtn.disabled = busy;
        panel.querySelectorAll('.oaao-chat-substep-preview__menu-item').forEach((el) => {
            if (el instanceof HTMLButtonElement) el.disabled = busy;
        });
        setOaaoSlidePreviewLoading(
            frame,
            busy,
            label ||
                oaaoChatT('chat.slide_preview.regenerating', 'Regenerating…'),
        );
    };

    /**
     * @param {Record<string, unknown>} payload
     * @param {{ success?: boolean, message?: string }} data
     * @param {string} failKey
     * @param {string} failDefault
     * @param {string} okDefault
     */
    const applySlideRegenResponse = async (payload, data, failKey, failDefault, okDefault) => {
        const errs = Array.isArray(payload?.validation_errors) ? payload.validation_errors : [];
        const hasPreview =
            typeof payload?.preview_url === 'string' && payload.preview_url.trim() !== '';
        if (data.success === false && !hasPreview) {
            const failDetail = errs.length > 0 ? errs.slice(0, 2).join(' · ') : data.message || '';
            toastOaao(failDetail || oaaoChatT(failKey, failDefault));
            return;
        }
        const nextUrl =
            typeof payload?.preview_url === 'string' && payload.preview_url.trim()
                ? payload.preview_url.trim()
                : previewUrl;
        setOaaoSlidePreviewLoading(
            frame,
            true,
            oaaoChatT('chat.slide_preview.loading_preview', 'Loading preview…'),
        );
        bustOaaoSlidePreviewIframe(iframe, nextUrl, conversationId);
        await waitForSlidePreviewIframeLoad(iframe);
        const layoutWarns = Array.isArray(payload?.layout_warnings) ? payload.layout_warnings : [];
        const softWarn =
            layoutWarns.length > 0 || (errs.length > 0 && payload?.ok === true && data.success === true);
        if (softWarn) {
            toastOaao(
                oaaoChatT(
                    'chat.slide_preview.regenerate_warn',
                    'Slide updated — minor HTML checks flagged; use Verify if preview looks wrong.',
                ),
            );
        } else if (data.success === true || payload?.ok === true) {
            toastOaao(okDefault);
        } else {
            toastOaao(
                oaaoChatT(
                    'chat.slide_preview.regenerate_warn',
                    'Regenerated with layout warnings — try again if preview still looks off.',
                ),
            );
        }
    };

    /**
     * @param {string} action
     * @param {Record<string, unknown>} body
     */
    const postSlideDesigner = async (action, body) => {
        const ep = getWorkspaceChatEndpointIdForSend();
        return chatFetchJson(slideDesignerApiUrl(action), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: parsed.projectId,
                page: parsed.page,
                conversation_id: conversationId,
                ...(ep ? { chat_endpoint_id: ep } : {}),
                ...body,
            }),
        });
    };

    addMenuItem(oaaoChatT('chat.slide_preview.regenerate', 'Regenerate slide'), async () => {
        setBusy(true, oaaoChatT('chat.slide_preview.regenerating', 'Regenerating…'));
        try {
            const { res, data } = await postSlideDesigner('slide_regenerate', { regen_markdown: true });
            const payload = data?.data && typeof data.data === 'object' ? data.data : data;
            if (!res.ok) {
                toastOaao(
                    data?.message ||
                        oaaoChatT('chat.slide_preview.regenerate_failed', 'Regenerate failed'),
                );
                return;
            }
            await applySlideRegenResponse(
                /** @type {Record<string, unknown>} */ (payload),
                data,
                'chat.slide_preview.regenerate_failed',
                'Regenerate failed',
                oaaoChatT('chat.slide_preview.regenerate_ok', 'Slide regenerated'),
            );
        } finally {
            setBusy(false);
        }
    });

    const slotMenuHost = document.createElement('div');
    slotMenuHost.className = 'oaao-chat-substep-preview__menu-slots hidden';
    slotMenuHost.dataset.oaaoSlotMenuLoaded = '0';
    panel.append(slotMenuHost);

    let slotMenuGen = 0;
    const refreshSlotMenu = async () => {
        const gen = ++slotMenuGen;
        try {
            const { res, data } = await postSlideDesigner('slide_slots', {});
            if (gen !== slotMenuGen) return;
            slotMenuHost.replaceChildren();
            const payload = data?.data && typeof data.data === 'object' ? data.data : data;
            const slots = Array.isArray(payload?.slots) ? payload.slots : [];
            if (!res.ok || !slots.length) {
                slotMenuHost.classList.add('hidden');
                slotMenuHost.dataset.oaaoSlotMenuLoaded = '1';
                return;
            }
            const sep = document.createElement('div');
            sep.className = 'oaao-chat-substep-preview__menu-sep';
            sep.setAttribute('role', 'separator');
            slotMenuHost.append(sep);
            const hint = document.createElement('span');
            hint.className = 'oaao-chat-substep-preview__menu-hint';
            hint.textContent = oaaoChatT('chat.slide_preview.regenerate_slot_section', 'Regenerate section');
            slotMenuHost.append(hint);
            for (const row of slots) {
                if (!row || typeof row !== 'object') continue;
                const slotId = String(/** @type {Record<string, unknown>} */ (row).id ?? '').trim();
                const label = String(/** @type {Record<string, unknown>} */ (row).label ?? slotId).trim();
                if (!slotId) continue;
                addMenuItem(
                    oaaoChatT('chat.slide_preview.regenerate_slot', 'Regenerate: {label}').replace(
                        '{label}',
                        label,
                    ),
                    async () => {
                        setBusy(
                            true,
                            oaaoChatT('chat.slide_preview.regenerating_slot', 'Regenerating section…'),
                        );
                        try {
                            const { res: r2, data: d2 } = await postSlideDesigner('slide_regenerate_slot', {
                                slot_id: slotId,
                            });
                            const p2 = d2?.data && typeof d2.data === 'object' ? d2.data : d2;
                            if (!r2.ok) {
                                toastOaao(
                                    d2?.message ||
                                        oaaoChatT(
                                            'chat.slide_preview.regenerate_slot_failed',
                                            'Section regenerate failed',
                                        ),
                                );
                                return;
                            }
                            await applySlideRegenResponse(
                                /** @type {Record<string, unknown>} */ (p2),
                                d2,
                                'chat.slide_preview.regenerate_slot_failed',
                                'Section regenerate failed',
                                oaaoChatT(
                                    'chat.slide_preview.regenerate_slot_ok',
                                    'Section regenerated',
                                ),
                            );
                        } finally {
                            setBusy(false);
                        }
                    },
                    slotMenuHost,
                );
            }
            slotMenuHost.classList.remove('hidden');
            slotMenuHost.dataset.oaaoSlotMenuLoaded = '1';
        } catch {
            if (gen === slotMenuGen) {
                slotMenuHost.classList.add('hidden');
            }
        }
    };

    addMenuItem(oaaoChatT('chat.slide_preview.verify', 'Code verify (fix)'), async () => {
        setBusy(true, oaaoChatT('chat.slide_preview.verifying', 'Code verify…'));
        try {
            const ep = getWorkspaceChatEndpointIdForSend();
            const { res, data } = await chatFetchJson(slideDesignerApiUrl('slide_verify'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_id: parsed.projectId,
                    page: parsed.page,
                    conversation_id: conversationId,
                    auto_fix: true,
                    ...(ep ? { chat_endpoint_id: ep } : {}),
                }),
            });
            const payload = data?.data && typeof data.data === 'object' ? data.data : data;
            const errs = Array.isArray(payload?.validation_errors) ? payload.validation_errors : [];
            const verified = payload?.verified === true || payload?.ok === true || data.ok === true;
            const hasPreview =
                typeof payload?.preview_url === 'string' && payload.preview_url.trim() !== '';
            if (!res.ok || (data.success === false && !hasPreview)) {
                const detail =
                    errs.slice(0, 2).join(' · ') ||
                    data.message ||
                    oaaoChatT('chat.slide_preview.verify_failed', 'Code verify failed');
                toastOaao(detail);
                return;
            }
            if (payload?.fixed === true && hasPreview) {
                const nextUrl = payload.preview_url.trim();
                setOaaoSlidePreviewLoading(
                    frame,
                    true,
                    oaaoChatT('chat.slide_preview.loading_preview', 'Loading preview…'),
                );
                bustOaaoSlidePreviewIframe(iframe, nextUrl, conversationId);
                await waitForSlidePreviewIframeLoad(iframe);
            }
            const attempts = Number(payload?.correction_attempts ?? 0);
            if (verified) {
                const base = oaaoChatT('chat.slide_preview.verify_ok', 'HTML verified');
                toastOaao(
                    payload?.fixed === true && attempts > 0
                        ? `${base} (${attempts} correction${attempts === 1 ? '' : 's'})`
                        : base,
                );
                return;
            }
            const detail = errs.slice(0, 3).join(' · ') || oaaoChatT('chat.slide_preview.verify_bad', 'Validation failed');
            toastOaao(detail);
        } finally {
            setBusy(false);
        }
    });

    menuBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const open = panel.classList.contains('hidden');
        document.querySelectorAll('.oaao-chat-substep-preview__menu-panel').forEach((el) => {
            if (el !== panel) el.classList.add('hidden');
        });
        if (open) {
            panel.classList.remove('hidden');
            menuBtn.setAttribute('aria-expanded', 'true');
            if (slotMenuHost.dataset.oaaoSlotMenuLoaded !== '1') {
                void refreshSlotMenu();
            }
        } else {
            closePanel();
        }
    });

    if (!globalThis.__oaaoSlidePreviewMenuDocClose) {
        globalThis.__oaaoSlidePreviewMenuDocClose = true;
        document.addEventListener(
            'click',
            () => {
                document.querySelectorAll('.oaao-chat-substep-preview__menu-panel').forEach((el) => {
                    el.classList.add('hidden');
                });
                document
                    .querySelectorAll('.oaao-chat-substep-preview__menu-btn[aria-expanded="true"]')
                    .forEach((btn) => {
                        btn.setAttribute('aria-expanded', 'false');
                    });
            },
            { capture: true },
        );
    }

    panel.addEventListener('click', (ev) => {
        ev.stopPropagation();
    });

    actions.append(menuBtn, panel);
    frame.append(actions);
}

/**
 * Live {@code deck_outline.md} under the outline agent step (streamed from orchestrator).
 *
 * @param {Record<string, unknown> | null | undefined} preview
 * @returns {HTMLElement | null}
 */
function buildDeckOutlineStreamEl(preview) {
    if (!preview || typeof preview !== 'object') return null;
    const md = typeof preview.outline_md === 'string' ? preview.outline_md : '';
    if (!md.trim()) return null;

    const wrap = document.createElement('div');
    wrap.className = 'oaao-deck-outline-stream';
    const head = document.createElement('div');
    head.className = 'oaao-deck-outline-stream__head';
    const label = document.createElement('span');
    label.className = 'oaao-deck-outline-stream__label';
    label.textContent = 'deck_outline.md';
    head.append(label);
    if (preview.building === true) {
        const badge = document.createElement('span');
        badge.className = 'oaao-deck-outline-stream__badge';
        badge.textContent = oaaoChatT('chat.outline_stream.writing', 'Writing…');
        head.append(badge);
    }
    const body = document.createElement('textarea');
    body.className = 'oaao-deck-outline-stream__body';
    body.rows = Math.min(14, Math.max(4, md.split('\n').length + 1));
    body.spellcheck = false;
    body.value = md;
    body.readOnly = true;
    body.setAttribute('aria-label', 'Deck outline markdown');
    wrap.append(head, body);
    return wrap;
}

/**
 * @param {Record<string, unknown> | null | undefined} preview
 * @param {number} conversationId
 * @returns {HTMLElement | null}
 */
function buildOaaoSubtaskPreviewEl(preview, conversationId = 0) {
    if (!preview || typeof preview !== 'object') return null;
    const p = /** @type {Record<string, unknown>} */ (preview);
    const outlineBlock = buildDeckOutlineStreamEl(p);
    const wrap = document.createElement('div');
    wrap.className = 'oaao-chat-substep-preview';
    if (outlineBlock) {
        wrap.classList.add('oaao-chat-substep-preview--has-outline');
        wrap.append(outlineBlock);
    }

    const previewUrl = typeof p.preview_url === 'string' ? p.preview_url.trim() : '';
    const snippetEarly = typeof p.snippet === 'string' ? p.snippet.trim() : '';
    if (outlineBlock && !previewUrl && !snippetEarly && p.building !== true) {
        return wrap;
    }

    if (previewUrl) {
        const row = document.createElement('div');
        row.className = 'oaao-chat-substep-preview-row';
        const frame = document.createElement('div');
        frame.className = 'oaao-chat-substep-preview__frame';
        const iframe = document.createElement('iframe');
        iframe.className = 'oaao-chat-substep-preview__iframe';
        iframe.title = String(p.title ?? 'Slide preview');
        iframe.loading = 'lazy';
        iframe.setAttribute('sandbox', OAAO_SLIDE_PREVIEW_IFRAME_SANDBOX);
        iframe.src = oaaoSlidePreviewIframeSrc(previewUrl, conversationId);
        mountOaaoSlidePreviewThumb(frame, iframe);
        setOaaoSlidePreviewLoading(
            frame,
            true,
            oaaoChatT('chat.slide_preview.loading_preview', 'Loading preview…'),
        );
        iframe.addEventListener(
            'load',
            () => {
                setOaaoSlidePreviewLoading(frame, false);
            },
            { once: true },
        );
        row.append(frame);
        wrap.append(row);
        mountOaaoSlidePreviewActions(frame, iframe, conversationId, previewUrl);
        const parsedOpen = parseOaaoSlidePreviewUrl(previewUrl);
        if (parsedOpen && conversationId > 0) {
            frame.classList.add('oaao-chat-substep-preview__frame--openable');
            frame.setAttribute('role', 'button');
            frame.setAttribute('tabindex', '0');
            frame.setAttribute(
                'aria-label',
                oaaoChatT('chat.slide_preview.open_full', 'Open full slide preview'),
            );
            const openFull = () => {
                document.dispatchEvent(
                    new CustomEvent('oaao-open-slide-deck', {
                        bubbles: true,
                        detail: {
                            projectId: parsedOpen.projectId,
                            conversationId,
                            startIndex: parsedOpen.page,
                        },
                    }),
                );
            };
            frame.addEventListener('click', (ev) => {
                if (ev.target instanceof HTMLElement && ev.target.closest('.oaao-chat-substep-preview__menu-btn')) {
                    return;
                }
                openFull();
            });
            frame.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    openFull();
                }
            });
        }
        return wrap;
    }

    const snippet = typeof p.snippet === 'string' ? p.snippet.trim() : '';
    const phase = String(p.phase ?? '').trim().toLowerCase();
    if (snippet) {
        const row = document.createElement('div');
        row.className = 'oaao-chat-substep-preview-row';
        const frame = document.createElement('div');
        frame.className = 'oaao-chat-substep-preview__frame oaao-chat-substep-preview__frame--loading';
        const pre = document.createElement('pre');
        pre.className = 'oaao-chat-substep-preview__snippet oaao-chat-substep-preview__snippet--overlay';
        pre.textContent = snippet;
        frame.append(pre);
        const loadLabel =
            phase === 'html'
                ? oaaoChatT('chat.slide_preview.rendering_html', 'Rendering HTML…')
                : oaaoChatT('chat.slide_preview.writing_markdown', 'Writing content…');
        frame.append(createOaaoSlidePreviewSpinnerEl(loadLabel));
        row.append(frame);
        wrap.append(row);
        return wrap;
    }

    if (p.building === true) {
        const row = document.createElement('div');
        row.className = 'oaao-chat-substep-preview-row';
        const frame = document.createElement('div');
        frame.className = 'oaao-chat-substep-preview__frame oaao-chat-substep-preview__frame--loading';
        frame.append(
            createOaaoSlidePreviewSpinnerEl(
                oaaoChatT('chat.slide_preview.generating', 'Generating slide…'),
            ),
        );
        row.append(frame);
        wrap.append(row);
        return wrap;
    }

    return null;
}

/**
 * @param {{ title?: string, status?: string, preview?: Record<string, unknown> }} at
 * @param {number} [conversationId]
 * @returns {HTMLLIElement}
 */
function buildOaaoInlineSubstepRow(at, conversationId = 0, parentRow = null) {
    const li = document.createElement('li');
    li.className = 'oaao-chat-inline-substep oaao-chat-inline-substep--has-marker';
    li.dataset.agentTaskId = String(at.id ?? '');
    const atSt = oaaoEffectiveAgentTaskStatus(at, parentRow);
    if (atSt === 'done') li.classList.add('is-done');
    else if (atSt === 'active') li.classList.add('is-active');
    if (at.preview) li.classList.add('oaao-chat-inline-substep--has-preview');

    li.append(buildOaaoInlineSubstepMarker(atSt));
    const head = document.createElement('div');
    head.className = 'oaao-chat-inline-substep-head';
    const text = document.createElement('span');
    text.className = 'oaao-chat-inline-substep-text';
    text.textContent = formatSlideWorkerDisplayTitle(at);
    head.append(text);
    li.append(head);

    const prev = buildOaaoSubtaskPreviewEl(
        at.preview && typeof at.preview === 'object' ? at.preview : null,
        conversationId,
    );
    if (prev) li.append(prev);

    return li;
}

/**
 * Sub-steps only after the agent has actually started (not a static catalog preview).
 *
 * @param {OaaoTaskItemState} row
 * @returns {Array<{ id: string, title: string, status: string }>}
 */
/**
 * @param {string} runTaskId
 * @returns {string | null}
 */
function oaaoSlideWorkersParentIdForRunTask(runTaskId) {
    const id = String(runTaskId ?? '').trim();
    const m = /^(.+)-slide-\d{2}$/.exec(id);
    return m ? `${m[1]}-slides` : null;
}

/** Hide planned slide workers until slide_designer ask is answered — avoids "stuck mid-build" look. */
function oaaoSlideDesignerAskPending(state) {
    if (!state?.items?.size) return false;
    for (const item of state.items.values()) {
        if (String(item.status ?? '') !== 'awaiting_ask' || !item.ask) continue;
        if (isSlideDesignerAgentKind(item.agent_kind ?? item.ask.agent_kind)) return true;
    }
    return false;
}

/** @param {OaaoTaskListState} state */
function oaaoTaskRowsForDisplay(state) {
    const rows = [...state.items.values()];
    if (!oaaoSlideDesignerAskPending(state)) return rows;
    return rows.filter((row) => !row.slide_workers);
}

/**
 * @param {number | null | undefined} conversationId
 */
function conversationHasPendingAgentAsk(conversationId) {
    const cid = conversationId != null ? Math.floor(Number(conversationId)) : 0;
    if (!Number.isFinite(cid) || cid < 1) return false;
    const state = getOaaoTaskListStateForConversation(cid);
    if (!state?.items?.size) return false;
    for (const item of state.items.values()) {
        if (String(item.status ?? '') === 'awaiting_ask' && item.ask) return true;
    }
    return false;
}

/**
 * @param {Array<{ status?: string }>} agentTasks
 */
function oaaoAggregateWorkerStatuses(agentTasks) {
    const vals = agentTasks.map((t) => oaaoEffectiveAgentTaskStatus(t));
    if (vals.some((v) => v === 'active')) return 'active';
    if (vals.some((v) => v === 'failed')) return 'failed';
    if (vals.length > 0 && vals.every((v) => v === 'done')) return 'done';
    if (vals.some((v) => v === 'skipped')) return 'skipped';
    return 'pending';
}

/**
 * Prefer the snapshot with more slide-worker completion (meta beats stale sessionStorage).
 *
 * @param {{ items?: unknown[] } | null} sessionTasks
 * @param {{ items?: unknown[] } | null} metaTasks
 */
function scoreOaaoTaskListSnapshot(snap) {
    if (!snap || !Array.isArray(snap.items)) return 0;
    let score = 0;
    for (const raw of snap.items) {
        if (!raw || typeof raw !== 'object') continue;
        const item = /** @type {Record<string, unknown>} */ (raw);
        const st = String(item.status ?? '').toLowerCase();
        if (st === 'done' || st === 'completed') score += 2;
        const workers = item.agent_tasks;
        if (!item.slide_workers || !Array.isArray(workers)) continue;
        for (const w of workers) {
            if (!w || typeof w !== 'object') continue;
            const row = /** @type {Record<string, unknown>} */ (w);
            const ws = String(row.status ?? '').toLowerCase();
            if (ws === 'done' || ws === 'completed') score += 3;
            else if (ws === 'active' || ws === 'running') score += 1;
            const prev = row.preview;
            if (prev && typeof prev === 'object' && String(/** @type {Record<string, unknown>} */ (prev).preview_url ?? '').trim()) {
                score += 4;
            }
        }
    }
    return score;
}

/**
 * @param {{ items?: unknown[] } | null} sessionTasks
 * @param {{ items?: unknown[] } | null} metaTasks
 */
function pickBestTaskListSnapshot(sessionTasks, metaTasks) {
    if (!sessionTasks) return metaTasks;
    if (!metaTasks) return sessionTasks;
    return scoreOaaoTaskListSnapshot(metaTasks) >= scoreOaaoTaskListSnapshot(sessionTasks)
        ? metaTasks
        : sessionTasks;
}

/**
 * @param {OaaoTaskListState} state
 * @param {Array<{ index?: number, title?: string, preview_url?: string, total?: number }>} slides
 * @returns {OaaoTaskListState}
 */
function patchSlideWorkersFromDeckSlides(state, slides) {
    const pages = Array.isArray(slides) ? slides.filter((s) => s && typeof s === 'object') : [];
    if (!pages.length) return state;

    const nextItems = new Map(state.items);
    for (const [id, item] of nextItems) {
        if (!item.slide_workers || !item.agent_tasks?.length) continue;
        const workers = item.agent_tasks.map((w) => {
            const m = /Slide\s+(\d+)\s*\//i.exec(String(w.title ?? ''));
            const idx = m ? Number(m[1]) : 0;
            const page = pages.find((p) => Number(p.index) === idx);
            const previewUrl = page && typeof page.preview_url === 'string' ? page.preview_url.trim() : '';
            if (!previewUrl) return w;
            const priorPrev = w.preview && typeof w.preview === 'object' ? w.preview : {};
            const preview = {
                ...priorPrev,
                kind: 'slide_page',
                phase: 'ready',
                building: false,
                slide_index: idx,
                slide_count: Number(page.total) || pages.length,
                preview_url: previewUrl,
                title: String(page.title ?? priorPrev.title ?? w.title ?? '').trim() || w.title,
            };
            return {
                ...w,
                status: mergeOaaoTaskItemStatus(w.status, 'done'),
                preview,
            };
        });
        const rolled = oaaoAggregateWorkerStatuses(workers);
        nextItems.set(id, {
            ...item,
            agent_tasks: workers,
            status: mergeOaaoTaskItemStatus(item.status, rolled),
        });
    }
    return { ...state, items: nextItems };
}

/**
 * @param {HTMLElement | Document} root
 * @param {number} conversationId
 * @param {string} [projectId]
 */
async function reconcileSlideWorkerTasksForConversation(root, conversationId, projectId = '') {
    const cid = Number(conversationId) || 0;
    let pid = String(projectId ?? '').trim();
    if (!pid && cid > 0 && Array.isArray(cachedMessageRows)) {
        for (let i = cachedMessageRows.length - 1; i >= 0; i -= 1) {
            const m = cachedMessageRows[i];
            if (String(m.role ?? '').toLowerCase() !== 'assistant') continue;
            const meta = m.meta && typeof m.meta === 'object' ? /** @type {Record<string, unknown>} */ (m.meta) : null;
            pid = slideMaterialIdFromAssistantMeta(meta).replace(/^slide-/, '');
            if (pid) break;
        }
    }
    if (!pid || cid < 1) return;

    const mod = await import(
        /* webpackIgnore: true */ oaaoPrefixedSitePath('/webassets/chat/default/js/slide-deck-viewer.js')
    ).catch(() => null);
    if (!mod || typeof mod.fetchSlideDeckFromProject !== 'function') return;

    const fetched = await mod.fetchSlideDeckFromProject(pid, cid);
    if (!fetched?.slides?.length) return;

    let state = getOaaoTaskListStateForConversation(cid);
    if (!state || state.items.size < 1) return;
    state = patchSlideWorkersFromDeckSlides(state, fetched.slides);
    setOaaoTaskListStateForConversation(cid, state);
    persistOaaoTaskListStrip(root, cid);
    const host = resolveOaaoTaskStepsHost(root, cid);
    if (host instanceof HTMLElement && isOaaoInlineTaskStepsHost(host) && host.querySelector('.oaao-chat-inline-task-steps-inner')) {
        oaaoTaskListStateByHost.set(host, state);
        patchOaaoInlineTaskStepsFromState(host, state);
        applyOaaoTaskPanelI18n(document);
        return;
    }
    renderOaaoTaskListForConversation(root, cid, state);
}

function oaaoVisibleAgentSubtasks(row) {
    const list = Array.isArray(row.agent_tasks) ? row.agent_tasks : [];
    if (!list.length) return [];
    if (row.slide_workers) {
        const parentSt = String(row.status ?? 'pending').toLowerCase();
        if (parentSt === 'awaiting_ask' || parentSt === 'skipped') return [];
        return list;
    }
    const parentSt = String(row.status ?? 'pending').toLowerCase();
    if (parentSt === 'awaiting_ask' || parentSt === 'pending' || parentSt === 'skipped') {
        return [];
    }
    const hasLive = list.some((t) => {
        const st = normalizeOaaoTaskStatus(t.status);
        return st === 'active' || st === 'done' || st === 'failed';
    });
    if (!hasLive) return [];
    if (parentSt === 'done' && list.every((t) => String(t.status ?? 'pending').toLowerCase() === 'pending')) {
        return [];
    }
    return list;
}

/**
 * @param {OaaoTaskItemState} row
 * @param {number} [conversationId]
 * @returns {HTMLDivElement}
 */
function buildOaaoInlineStepBlock(row, conversationId = 0) {
    const st = oaaoEffectiveTaskRowStatus(row);
    const block = document.createElement('div');
    block.className = 'oaao-chat-inline-step';
    block.dataset.taskId = String(row.id ?? '');
    if (st === 'done') block.classList.add('is-done');
    else if (st === 'skipped') block.classList.add('is-cancelled');
    else if (st === 'active' || st === 'running' || st === 'awaiting_ask') block.classList.add('is-active');
    if (row.parallel_ok && (st === 'pending' || st === 'active' || st === 'running')) {
        block.classList.add('oaao-chat-inline-step--parallel-pending');
    }

    const main = document.createElement('div');
    main.className = 'oaao-chat-inline-step-main';
    main.append(buildOaaoInlineStepMarker(st));

    const copy = document.createElement('div');
    copy.className = 'oaao-chat-inline-step-copy';
    const chip = buildOaaoTaskRowAgentChip(row.agent_kind);
    if (chip) {
        chip.classList.add('oaao-chat-inline-step-agent');
        copy.append(chip);
    }
    const title = document.createElement('span');
    title.className = 'oaao-chat-inline-step-title';
    title.textContent = String(row.title ?? '—');
    copy.append(title);
    const durBadge = buildOaaoTaskDurationBadge(row);
    if (durBadge) copy.append(durBadge);
    main.append(copy);
    block.append(main);

    const askBar = buildOaaoAgentAskBar(row, conversationId);
    if (askBar) block.append(askBar);

    const agentTasks = oaaoVisibleAgentSubtasks(row);
    if (agentTasks.length) {
        const subUl = document.createElement('ul');
        subUl.className = 'oaao-chat-inline-step-sublist';
        for (const at of agentTasks) {
            subUl.append(buildOaaoInlineSubstepRow(at, conversationId, row));
        }
        block.append(subUl);
    }

    return block;
}

/**
 * Scroll container for inline task steps / side-panel checklist.
 *
 * @param {HTMLElement} host
 * @returns {HTMLElement}
 */
function oaaoTaskListScrollHost(host) {
    return (
        host.closest('.oaao-chat-task-panel-body') ||
        host.closest('.oaao-task-list-body') ||
        host
    );
}

/**
 * @param {HTMLElement} li
 * @param {{ id?: string, title?: string, status?: string, preview?: Record<string, unknown> }} at
 * @param {number} conversationId
 * @returns {boolean}
 */
function patchOaaoInlineSubstepRow(li, at, conversationId = 0, parentRow = null) {
    if (!(li instanceof HTMLElement)) return false;
    const atSt = oaaoEffectiveAgentTaskStatus(at, parentRow);
    li.classList.remove('is-done', 'is-active');
    if (atSt === 'done') li.classList.add('is-done');
    else if (atSt === 'active') li.classList.add('is-active');
    syncOaaoInlineSubstepMarker(li, atSt);

    const text = li.querySelector('.oaao-chat-inline-substep-text');
    if (text instanceof HTMLElement) {
        text.textContent = formatSlideWorkerDisplayTitle(at);
    }

    let preview =
        at.preview && typeof at.preview === 'object' ? /** @type {Record<string, unknown>} */ (at.preview) : null;
    if (atSt === 'done' && preview && preview.building === true) {
        preview = { ...preview, building: false };
    }
    const md = preview && typeof preview.outline_md === 'string' ? preview.outline_md : '';
    if (md.trim()) {
        const body = li.querySelector('.oaao-deck-outline-stream__body');
        if (body instanceof HTMLTextAreaElement) {
            if (body.value !== md) {
                body.value = md;
                body.rows = Math.min(14, Math.max(4, md.split('\n').length + 1));
            }
            const badge = li.querySelector('.oaao-deck-outline-stream__badge');
            if (preview.building === true && atSt !== 'done') {
                if (!badge) {
                    const head = li.querySelector('.oaao-deck-outline-stream__head');
                    if (head instanceof HTMLElement) {
                        const b = document.createElement('span');
                        b.className = 'oaao-deck-outline-stream__badge';
                        b.textContent = oaaoChatT('chat.outline_stream.writing', 'Writing…');
                        head.append(b);
                    }
                }
            } else if (badge) {
                badge.remove();
            }
            if (atSt === 'done') {
                const loadFrame = li.querySelector('.oaao-chat-substep-preview__frame--loading');
                loadFrame?.closest('.oaao-chat-substep-preview')?.remove();
            }
            return true;
        }
    }

    const prev = buildOaaoSubtaskPreviewEl(preview, conversationId);
    const oldPrev = li.querySelector('.oaao-chat-substep-preview');
    if (prev) {
        if (oldPrev instanceof HTMLElement) {
            oldPrev.replaceWith(prev);
        } else {
            li.append(prev);
        }
        li.classList.add('oaao-chat-inline-substep--has-preview');
        return true;
    }
    if (oldPrev) oldPrev.remove();
    return true;
}

/**
 * @param {HTMLElement} block
 * @param {OaaoTaskItemState} row
 * @param {number} conversationId
 */
function patchOaaoInlineStepBlock(block, row, conversationId = 0) {
    const st = oaaoEffectiveTaskRowStatus(row);
    block.classList.remove('is-done', 'is-active', 'is-cancelled', 'oaao-chat-inline-step--parallel-pending');
    if (st === 'done') block.classList.add('is-done');
    else if (st === 'skipped') block.classList.add('is-cancelled');
    else if (st === 'active' || st === 'running' || st === 'awaiting_ask') block.classList.add('is-active');
    if (row.parallel_ok && (st === 'pending' || st === 'active' || st === 'running')) {
        block.classList.add('oaao-chat-inline-step--parallel-pending');
    }

    const marker = block.querySelector('.oaao-chat-inline-step-marker');
    if (marker instanceof HTMLElement) {
        marker.innerHTML = oaaoTaskCheckSvgForStatus(st);
    }
    const title = block.querySelector('.oaao-chat-inline-step-title');
    if (title instanceof HTMLElement) {
        title.textContent = String(row.title ?? '—');
    }
    const copyCol = block.querySelector('.oaao-chat-inline-step-copy');
    if (copyCol instanceof HTMLElement) {
        syncOaaoTaskDurationBadge(copyCol, row);
    }

    let askEl = block.querySelector('[data-oaao-agent-ask="1"]');
    const askBar = buildOaaoAgentAskBar(row, conversationId);
    if (askBar) {
        if (askEl instanceof HTMLElement) askEl.replaceWith(askBar);
        else block.append(askBar);
    } else if (askEl) {
        askEl.remove();
    }

    const agentTasks = oaaoVisibleAgentSubtasks(row);
    let subUl = block.querySelector('.oaao-chat-inline-step-sublist');
    if (!agentTasks.length) {
        subUl?.remove();
        return;
    }
    if (!(subUl instanceof HTMLUListElement)) {
        subUl = document.createElement('ul');
        subUl.className = 'oaao-chat-inline-step-sublist';
        block.append(subUl);
    }
    const seen = new Set();
    for (const at of agentTasks) {
        const wid = String(at.id ?? '').trim();
        if (!wid) continue;
        seen.add(wid);
        let li = subUl.querySelector(`li[data-agent-task-id="${CSS.escape(wid)}"]`);
        if (li instanceof HTMLElement) {
            patchOaaoInlineSubstepRow(li, at, conversationId, row);
        } else {
            subUl.append(buildOaaoInlineSubstepRow(at, conversationId, row));
        }
    }
    subUl.querySelectorAll('li[data-agent-task-id]').forEach((node) => {
        if (node instanceof HTMLElement) {
            const id = String(node.dataset.agentTaskId ?? '').trim();
            if (id && !seen.has(id)) node.remove();
        }
    });
}

/**
 * Incremental task-step DOM — preserves scroll while outline / workers stream.
 *
 * @param {HTMLElement} host
 * @param {OaaoTaskListState} state
 */
function patchOaaoInlineTaskStepsFromState(host, state) {
    const rows = oaaoTaskRowsForDisplay(state);
    if (!rows.length) {
        host.replaceChildren();
        host.hidden = true;
        host.classList.add('hidden');
        return;
    }
    host.hidden = false;
    host.classList.remove('hidden');

    const scrollEl = oaaoTaskListScrollHost(host);
    const scrollTop = scrollEl.scrollTop;

    let inner = host.querySelector('.oaao-chat-inline-task-steps-inner');
    if (!(inner instanceof HTMLElement)) {
        renderOaaoInlineTaskStepsFromState(host, state);
        return;
    }

    const cid = Number(host.dataset.oaaoTaskListConv || 0);
    const seen = new Set();
    for (const row of rows) {
        const id = String(row.id ?? '').trim();
        if (!id) continue;
        seen.add(id);
        let block = inner.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
        if (block instanceof HTMLElement) {
            patchOaaoInlineStepBlock(block, row, cid);
        } else {
            inner.append(buildOaaoInlineStepBlock(row, cid));
        }
    }
    inner.querySelectorAll('[data-task-id]').forEach((node) => {
        if (node instanceof HTMLElement) {
            const id = String(node.dataset.taskId ?? '').trim();
            if (id && !seen.has(id)) node.remove();
        }
    });

    scrollEl.scrollTop = scrollTop;
    if (Array.isArray(state.allowed_agents) && state.allowed_agents.length) {
        publishOaaoWorkspaceAllowedAgents(state.allowed_agents);
    }
}

/**
 * @param {HTMLElement} host
 * @param {OaaoTaskListState} state
 */
function renderOaaoInlineTaskStepsFromState(host, state) {
    const rows = oaaoTaskRowsForDisplay(state);
    if (!rows.length) {
        host.replaceChildren();
        host.hidden = true;
        host.classList.add('hidden');
        return;
    }
    if (host.querySelector('.oaao-chat-inline-task-steps-inner')) {
        patchOaaoInlineTaskStepsFromState(host, state);
        return;
    }

    host.replaceChildren();
    host.hidden = false;
    host.classList.remove('hidden');

    const inner = document.createElement('div');
    inner.className = 'oaao-chat-inline-task-steps-inner';

    const cid = Number(host.dataset.oaaoTaskListConv || 0);
    for (const row of rows) {
        inner.append(buildOaaoInlineStepBlock(row, cid));
    }

    host.append(inner);
    if (Array.isArray(state.allowed_agents) && state.allowed_agents.length) {
        publishOaaoWorkspaceAllowedAgents(state.allowed_agents);
    }
}

/**
 * @param {string[]} [allowedAgents]
 */
function publishOaaoWorkspaceAllowedAgents(allowedAgents) {
    const list = (allowedAgents?.length ? allowedAgents : OAAO_TASK_AGENT_CATALOG.map((e) => e.id))
        .map((k) => String(k ?? '').trim())
        .filter((k) => OAAO_TASK_AGENT_CATALOG.some((e) => e.id === k));
    oaaoWorkspaceAllowedAgents = list;
    if (typeof document !== 'undefined') {
        document.dispatchEvent(
            new CustomEvent('oaao:allowed-agents-changed', {
                bubbles: true,
                detail: { allowed: list },
            }),
        );
    }
}

/** @param {string[]} [allowedAgents] */
function mountWorkspaceAgentRail(allowedAgents) {
    publishOaaoWorkspaceAllowedAgents(allowedAgents);
}

/** @type {Promise<((key: string, fallback?: string) => string) | null> | null} */
let oaaoChatTranslateFnPromise = null;

/** @returns {Promise<((key: string, fallback?: string) => string) | null>} */
function loadOaaoChatTranslateFn() {
    if (!oaaoChatTranslateFnPromise) {
        const url = oaaoPrefixedSitePath('/webassets/core/default/js/oaao-i18n.js');
        oaaoChatTranslateFnPromise = import(/* webpackIgnore: true */ url)
            .then((m) => (typeof m.oaaoT === 'function' ? m.oaaoT : null))
            .catch(() => null);
    }
    return oaaoChatTranslateFnPromise;
}

/**
 * @param {string} key
 * @param {string} fallback
 */
function oaaoChatT(key, fallback) {
    return fallback;
}

/**
 * @typedef {{ id: string, title: string, status: string, agent_kind?: string, parallel_ok?: boolean, slide_index?: number, slide_workers?: boolean, sub_open?: boolean, duration_ms?: number, ask?: { run_id: string, task_id: string, message: string, title: string, proceed_label: string, skip_label: string, agent_kind: string }, agent_tasks?: Array<{ id: string, title: string, status: string, preview?: Record<string, unknown>, duration_ms?: number }> }} OaaoTaskItemState
 * @typedef {{ items: Map<string, OaaoTaskItemState>, abilities: Array<{ name?: string, description?: string }>, allowed_agents: string[], collapsed: boolean, panelView: 'steps' | 'agents' }} OaaoTaskListState
 */

/** @type {WeakMap<HTMLElement, OaaoTaskListState>} */
const oaaoTaskListStateByHost = new WeakMap();

/** Per-conversation checklist state — survives tab switches and background streams. */
/** @type {Map<number, OaaoTaskListState>} */
const oaaoTaskListStateByConversation = new Map();

/** @type {Map<number, number>} */
const oaaoStreamAssistantMsgIdByConv = new Map();

/** Skip resurrecting prior assistant {@code meta.tasks} right after a new send/regenerate. */
/** @type {Set<number>} */
const oaaoFreshRunByConv = new Set();

/** @type {string[]} */
let oaaoWorkspaceAllowedAgents = [];

/** @type {WeakMap<HTMLElement, boolean>} */
const oaaoTaskPanelChromeBound = new WeakMap();

/** Set by {@link mountShellPanel} — recomputes thread scroll reserve when task strip height changes. */
/** @type {(() => void) | null} */
let chatComposerReserveSyncFn = null;

function scheduleChatComposerReserveSync() {
    chatComposerReserveSyncFn?.();
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => chatComposerReserveSyncFn?.());
    }
}

/**
 * @param {HTMLElement} host
 * @param {HTMLButtonElement | null} [chevBtn]
 */
function syncOaaoTaskListStripChrome(host, chevBtn = null) {
    const btn =
        chevBtn instanceof HTMLButtonElement
            ? chevBtn
            : host.querySelector('.oaao-task-list-chevron');
    const collapsed = host.classList.contains('oaao-task-list-strip--collapsed');
    if (btn instanceof HTMLButtonElement) {
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        btn.classList.toggle('oaao-task-list-chevron--collapsed', collapsed);
    }
    syncOaaoTaskPanelCollapseChrome(host);
}

/**
 * @param {HTMLElement} host
 * @returns {boolean}
 */
function isOaaoTaskSidePanel(host) {
    return Boolean(host.closest('[data-oaao-chat="task-panel"]'));
}

/**
 * @param {HTMLElement | Document} [root]
 */
function getOaaoTaskPanelChrome(root = document) {
    const panel = root.querySelector('[data-oaao-chat="task-panel"]');
    if (!(panel instanceof HTMLElement)) {
        return {
            panel: null,
            header: null,
            heading: null,
            dismiss: null,
            rail: null,
            floatToggle: null,
            body: null,
            tabSteps: null,
            tabAgents: null,
            viewSteps: null,
            viewAgents: null,
        };
    }
    return {
        panel,
        header: panel.querySelector('[data-oaao-chat="task-panel-header"]'),
        heading: panel.querySelector('[data-oaao-chat="task-panel-heading"]'),
        dismiss: panel.querySelector('[data-oaao-chat="task-panel-dismiss"]'),
        rail: panel.querySelector('[data-oaao-chat="task-panel-agent-rail"]'),
        floatToggle: panel.querySelector('[data-oaao-chat="task-panel-collapse"]'),
        body: panel.querySelector('[data-oaao-chat="task-panel-body"]'),
        tabSteps: panel.querySelector('[data-oaao-chat="task-panel-tab-steps"]'),
        tabAgents: panel.querySelector('[data-oaao-chat="task-panel-tab-agents"]'),
        viewSteps: panel.querySelector('[data-oaao-chat="task-panel-view-steps"]'),
        viewAgents: panel.querySelector('[data-oaao-chat="task-panel-view-agents"]'),
    };
}

/**
 * @param {HTMLElement} host
 */
function syncOaaoTaskPanelCollapseChrome(host) {
    const { panel, floatToggle } = getOaaoTaskPanelChrome(host);
    if (!(panel instanceof HTMLElement)) return;
    const collapsed = panel.classList.contains('oaao-chat-task-panel--steps-collapsed');
    if (floatToggle instanceof HTMLButtonElement) {
        floatToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        floatToggle.hidden = false;
        floatToggle.classList.remove('hidden');
    }
}

/**
 * @param {HTMLElement | Document} root
 * @param {OaaoTaskListState} state
 */
function syncOaaoTaskPanelHeading(root, state) {
    const rows = [...state.items.values()];
    const done = rows.filter((it) => it.status === 'done').length;
    const label = rows.length ? `Steps ${done}/${rows.length}` : 'Steps';
    const chrome = getOaaoTaskPanelChrome(root);
    if (chrome.heading instanceof HTMLElement) {
        chrome.heading.textContent =
            state.panelView === 'agents'
                ? oaaoChatT('workspace.task.agents_page_title', 'Agents')
                : label;
    }
    const host = getOaaoTaskListStripHost(root);
    const legacy = host?.querySelector('.oaao-task-list-heading');
    if (legacy instanceof HTMLElement && host && !isOaaoTaskSidePanel(host)) {
        legacy.textContent = label;
    }
}

/**
 * @param {HTMLElement | Document} root
 * @param {OaaoTaskListState} state
 */
function syncOaaoTaskPanelView(root, state) {
    const { panel, tabSteps, tabAgents, viewSteps, viewAgents, floatToggle } = getOaaoTaskPanelChrome(root);
    if (!(panel instanceof HTMLElement)) return;
    const view = state.panelView === 'agents' ? 'agents' : 'steps';
    panel.classList.toggle('oaao-chat-task-panel--view-steps', view === 'steps');
    panel.classList.toggle('oaao-chat-task-panel--view-agents', view === 'agents');
    if (viewSteps instanceof HTMLElement) {
        viewSteps.classList.toggle('hidden', view !== 'steps');
        viewSteps.hidden = view !== 'steps';
    }
    if (viewAgents instanceof HTMLElement) {
        viewAgents.classList.toggle('hidden', view !== 'agents');
        viewAgents.hidden = view !== 'agents';
    }
    if (tabSteps instanceof HTMLButtonElement) {
        tabSteps.classList.toggle('is-active', view === 'steps');
        tabSteps.setAttribute('aria-current', view === 'steps' ? 'page' : 'false');
    }
    if (tabAgents instanceof HTMLButtonElement) {
        tabAgents.classList.toggle('is-active', view === 'agents');
        tabAgents.setAttribute('aria-current', view === 'agents' ? 'page' : 'false');
    }
    if (floatToggle instanceof HTMLButtonElement) {
        floatToggle.hidden = view !== 'steps';
        floatToggle.classList.toggle('hidden', view !== 'steps');
    }
    syncOaaoTaskPanelHeading(root, state);
}

function renderOaaoTaskAgentRail(root, state) {
    const { rail } = getOaaoTaskPanelChrome(root);
    if (!(rail instanceof HTMLElement)) return;

    const allowed = new Set(
        (state.allowed_agents?.length ? state.allowed_agents : OAAO_TASK_AGENT_CATALOG.map((e) => e.id)).map((k) =>
            String(k).trim(),
        ),
    );
    const kinds = OAAO_TASK_AGENT_CATALOG.filter((e) => allowed.has(e.id));
    if (!kinds.length) {
        rail.hidden = true;
        rail.classList.add('hidden');
        rail.textContent = '';
        return;
    }

    rail.hidden = false;
    rail.classList.remove('hidden');
    rail.textContent = '';

    const heading = document.createElement('p');
    heading.className = 'oaao-task-agent-rail-heading';
    heading.setAttribute('data-i18n', 'workspace.task.agents_heading');
    heading.textContent = oaaoChatT('workspace.task.agents_heading', 'Agents');
    rail.append(heading);

    const ul = document.createElement('ul');
    ul.className = 'oaao-task-agent-rail-list';
    for (const entry of kinds) {
        const li = document.createElement('li');
        li.className = 'oaao-task-agent-rail-item';
        li.dataset.agentKind = entry.id;

        const icon = document.createElement('span');
        icon.className = 'oaao-task-agent-rail-icon';
        icon.innerHTML = entry.icon;

        const copy = document.createElement('div');
        copy.className = 'oaao-task-agent-rail-copy';
        const lbl = document.createElement('span');
        lbl.className = 'oaao-task-agent-rail-label';
        lbl.setAttribute('data-i18n', entry.labelKey);
        lbl.textContent = oaaoChatT(entry.labelKey, entry.fallbackLabel);
        const desc = document.createElement('p');
        desc.className = 'oaao-task-agent-rail-desc';
        desc.setAttribute('data-i18n', entry.descKey);
        desc.textContent = oaaoChatT(entry.descKey, entry.fallbackDesc);
        copy.append(lbl, desc);
        li.append(icon, copy);
        ul.append(li);
    }
    rail.append(ul);

    applyOaaoTaskPanelI18n(root);
}

/**
 * @param {HTMLElement | Document} root
 */
function applyOaaoTaskPanelI18n(root) {
    void loadOaaoChatTranslateFn().then((fn) => {
        if (typeof fn !== 'function') return;
        const panel = getOaaoTaskPanelChrome(root).panel;
        if (!(panel instanceof HTMLElement)) return;
        panel.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            if (!key) return;
            const fb = el.textContent || '';
            el.textContent = fn(key, fb);
        });
    });
}

/**
 * @param {HTMLElement | Document} root
 */
function bindOaaoTaskPanelChromeOnce(root) {
    const { panel, dismiss, floatToggle, tabSteps, tabAgents } = getOaaoTaskPanelChrome(root);
    if (!(panel instanceof HTMLElement) || oaaoTaskPanelChromeBound.get(panel)) return;
    oaaoTaskPanelChromeBound.set(panel, true);

    const setPanelView = (view) => {
        const host = getOaaoTaskListStripHost(root);
        if (!(host instanceof HTMLElement)) return;
        const state = getOaaoTaskListState(host);
        state.panelView = view;
        oaaoTaskListStateByHost.set(host, state);
        syncOaaoTaskPanelView(root, state);
    };

    if (tabSteps instanceof HTMLButtonElement) {
        tabSteps.addEventListener('click', () => setPanelView('steps'));
    }
    if (tabAgents instanceof HTMLButtonElement) {
        tabAgents.addEventListener('click', () => setPanelView('agents'));
    }

    if (dismiss instanceof HTMLButtonElement) {
        dismiss.addEventListener('click', () => clearOaaoTaskListStrip(document, true));
    }
    if (floatToggle instanceof HTMLButtonElement) {
        floatToggle.addEventListener('click', () => {
            panel.classList.toggle('oaao-chat-task-panel--steps-collapsed');
            const host = getOaaoTaskListStripHost(root);
            if (host instanceof HTMLElement) {
                const state = getOaaoTaskListState(host);
                state.collapsed = panel.classList.contains('oaao-chat-task-panel--steps-collapsed');
                oaaoTaskListStateByHost.set(host, state);
            }
            syncOaaoTaskPanelCollapseChrome(panel);
            scheduleChatComposerReserveSync();
        });
    }
}

/**
 * @param {HTMLElement} host
 * @param {OaaoTaskListState} state
 */
function syncOaaoTaskPanelChrome(host, state) {
    if (!isOaaoTaskSidePanel(host)) return;
    bindOaaoTaskPanelChromeOnce(document);
    const { panel, floatToggle } = getOaaoTaskPanelChrome(host);
    if (panel instanceof HTMLElement) {
        panel.classList.toggle('oaao-chat-task-panel--steps-collapsed', Boolean(state.collapsed));
        if (floatToggle instanceof HTMLButtonElement) {
            floatToggle.hidden = false;
            floatToggle.classList.remove('hidden');
        }
    }
    syncOaaoTaskPanelHeading(document, state);
    renderOaaoTaskAgentRail(document, state);
    syncOaaoTaskPanelView(document, state);
    applyOaaoTaskPanelI18n(document);
    syncOaaoTaskPanelCollapseChrome(host);
}

/**
 * @param {HTMLElement} details
 */
function syncOaaoAgentDetailsChevron(details) {
    if (!(details instanceof HTMLDetailsElement)) return;
    details.classList.toggle('is-open', details.open);
}

/**
 * @param {HTMLElement | Document} root
 */
function syncOaaoTaskPanelVisibility(root) {
    const panel = root.querySelector('[data-oaao-chat="task-panel"]');
    if (panel instanceof HTMLElement) {
        panel.hidden = true;
        panel.classList.add('hidden');
    }
    const chatRoot = root.querySelector('.oaao-chat-root');
    if (chatRoot instanceof HTMLElement) {
        chatRoot.classList.remove('oaao-chat-root--task-panel-open');
    }
    scheduleChatComposerReserveSync();
}

/**
 * @returns {OaaoTaskListState}
 */
function createEmptyOaaoTaskListState() {
    return { items: new Map(), abilities: [], allowed_agents: [], collapsed: false, panelView: 'steps' };
}

/**
 * @param {HTMLElement} host
 * @returns {OaaoTaskListState}
 */
function getOaaoTaskListState(host) {
    let state = oaaoTaskListStateByHost.get(host);
    if (!state) {
        state = createEmptyOaaoTaskListState();
        oaaoTaskListStateByHost.set(host, state);
    }
    return state;
}

/**
 * @param {HTMLElement | Document} [root]
 * @returns {HTMLElement | null}
 */
function getOaaoTaskListStripHost(root = document, conversationId = 0) {
    return resolveOaaoTaskStepsHost(root, conversationId);
}

/**
 * @param {HTMLElement | Document} root
 * @param {boolean} [removePersisted]
 */
function clearOaaoTaskListStrip(root, removePersisted = false) {
    const mount =
        root.querySelector('[data-module="oaao-chat"]') ?? (root instanceof HTMLElement ? root : document);
    mount.querySelectorAll('[data-oaao-chat="inline-task-steps"]').forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        oaaoTaskListStateByHost.delete(el);
        el.innerHTML = '';
        el.hidden = true;
        el.classList.add('hidden');
    });

    const host = mount.querySelector('[data-oaao-chat="task-list-strip"]');
    if (host instanceof HTMLElement) {
        oaaoTaskListStateByHost.delete(host);
        host.innerHTML = '';
        host.setAttribute('hidden', '');
        host.classList.add('hidden');
    }

    if (removePersisted) {
        try {
            const cid = Number(activeConversationId ?? 0);
            if (cid > 0) {
                sessionStorage.removeItem(`${OAAO_TASK_LIST_SS_PREFIX}${cid}`);
                oaaoStreamAssistantMsgIdByConv.delete(cid);
                oaaoTaskListStateByConversation.delete(cid);
            }
        } catch {
            /* ignore */
        }
    }
    syncOaaoTaskPanelVisibility(root);
    scheduleChatComposerReserveSync();
}

/**
 * @param {string} st
 * @returns {string}
 */
function oaaoTaskCheckSvgForStatus(st) {
    const normalized = normalizeOaaoTaskStatus(st);
    if (normalized === 'done') return OAAO_TASK_CHECK_DONE_SVG;
    if (normalized === 'skipped') return OAAO_TASK_CHECK_CANCELLED_SVG;
    if (normalized === 'active' || normalized === 'running') return OAAO_TASK_CHECK_SPINNER_SVG;
    if (normalized === 'awaiting_ask') return OAAO_TASK_CHECK_ACTIVE_SVG;
    return OAAO_TASK_CHECK_PENDING_SVG;
}

/**
 * User Stop or {@code run_cancelled}: close spinner rows as skipped (X marker).
 *
 * @param {HTMLElement | Document} root
 * @param {number} conversationId
 */
function markOaaoRunTasksCancelled(root, conversationId) {
    if (!conversationId || conversationId < 1) return;
    const state = getOaaoTaskListStateForConversation(conversationId);
    if (!state.items.size) return;
    let changed = false;
    for (const item of state.items.values()) {
        const st = normalizeOaaoTaskStatus(item.status);
        if (OAAO_TASK_OPEN_STATUSES.has(st)) {
            item.status = 'skipped';
            changed = true;
        }
        if (item.agent_tasks?.length) {
            for (const at of item.agent_tasks) {
                const ast = normalizeOaaoTaskStatus(at.status);
                if (OAAO_TASK_OPEN_STATUSES.has(ast)) {
                    at.status = 'skipped';
                    changed = true;
                }
            }
        }
    }
    if (!changed) return;
    setOaaoTaskListStateForConversation(conversationId, state);
    persistOaaoTaskListStrip(root, conversationId);
    renderOaaoTaskListForConversation(root, conversationId, state);
}

/**
 * @param {OaaoTaskItemState} row
 * @returns {HTMLLIElement}
 */
function buildOaaoTaskListRow(row, conversationId = 0) {
    const li = document.createElement('li');
    li.className = 'oaao-task-list-row';
    const id = String(row.id ?? '').trim();
    if (id) li.dataset.taskId = id;
    const st = oaaoEffectiveTaskRowStatus(row);
    if (st === 'done') li.classList.add('oaao-task-list-row--done');
    else if (st === 'skipped') li.classList.add('oaao-task-list-row--cancelled');
    else if (st === 'active' || st === 'running') li.classList.add('oaao-task-list-row--active');
    if (row.parallel_ok && (st === 'pending' || st === 'active' || st === 'running')) {
        li.classList.add('oaao-task-list-row--parallel-pending');
    }
    if (row.slide_index) li.dataset.slideIndex = String(row.slide_index);

    const agentTasks = oaaoVisibleAgentSubtasks(row);
    const hasSub = agentTasks.length > 0;

    const chevWrap = document.createElement('span');
    chevWrap.className = 'oaao-task-list-row-chevron-wrap';
    chevWrap.innerHTML = OAAO_TASK_ROW_CHEVRON_SVG;

        if (!hasSub) {
        const check = document.createElement('span');
        check.className = 'oaao-task-list-check-wrap';
        check.innerHTML = oaaoTaskCheckSvgForStatus(st);
        const copy = buildOaaoTaskRowCopyColumn(row);
        chevWrap.classList.add('oaao-task-list-row-chevron-wrap--spacer');
        chevWrap.setAttribute('aria-hidden', 'true');
        li.append(check, copy, chevWrap);
        const askBar = buildOaaoAgentAskBar(row, conversationId);
        if (askBar) li.append(askBar);
        return li;
    }

    li.classList.add('oaao-task-list-row--has-sub');
    const details = document.createElement('details');
    details.className = 'oaao-task-list-agent-details';
    const subOpen =
        row.sub_open !== false &&
        (st === 'active' || agentTasks.some((t) => t.status === 'running' || t.status === 'active'));
    details.open = subOpen;
    details.addEventListener('toggle', () => {
        row.sub_open = details.open;
        syncOaaoAgentDetailsChevron(details);
    });
    syncOaaoAgentDetailsChevron(details);

    const summary = document.createElement('summary');
    summary.className = 'oaao-task-list-row-main';

    const check = document.createElement('span');
    check.className = 'oaao-task-list-check-wrap';
    check.innerHTML = oaaoTaskCheckSvgForStatus(st);

    const copy = buildOaaoTaskRowCopyColumn(row);

    summary.append(check, copy, chevWrap);
    details.append(summary);

    const subUl = document.createElement('ul');
    subUl.className = 'oaao-task-list-agent-items';
    for (const at of agentTasks) {
        subUl.append(buildOaaoAgentTaskRow(at, conversationId, row));
    }
    details.append(subUl);
    li.append(details);

    const askBar = buildOaaoAgentAskBar(row, conversationId);
    if (askBar) li.append(askBar);

    return li;
}

/**
 * @param {{ id?: string, title?: string, status?: string, preview?: Record<string, unknown> }} at
 * @returns {HTMLLIElement}
 */
function buildOaaoAgentTaskRow(at, conversationId = 0, parentRow = null) {
    const li = document.createElement('li');
    li.className = 'oaao-task-list-agent-row';
    const id = String(at.id ?? '').trim();
    if (id) li.dataset.agentTaskId = id;
    const st = oaaoEffectiveAgentTaskStatus(at, parentRow);
    if (st === 'done') li.classList.add('oaao-task-list-agent-row--done');
    else if (st === 'active') li.classList.add('oaao-task-list-agent-row--active');
    if (at.preview) li.classList.add('oaao-task-list-agent-row--has-preview');

    const check = document.createElement('span');
    check.className = 'oaao-task-list-check-wrap oaao-task-list-check-wrap--sub';
    check.innerHTML = oaaoTaskCheckSvgForStatus(st);

    const body = document.createElement('div');
    body.className = 'oaao-task-list-agent-row-body';
    const text = document.createElement('span');
    text.className = 'oaao-task-list-agent-row-text';
    text.textContent = formatSlideWorkerDisplayTitle(at);
    body.append(text);
    const previewObj = at.preview && typeof at.preview === 'object' ? at.preview : null;
    const outlineOnly =
        previewObj &&
        typeof previewObj.outline_md === 'string' &&
        previewObj.outline_md.trim() &&
        !previewObj.preview_url;
    if (outlineOnly) {
        const outlineEl = buildDeckOutlineStreamEl(previewObj);
        if (outlineEl) body.append(outlineEl);
    } else {
        const prev = buildOaaoSubtaskPreviewEl(previewObj, conversationId);
        if (prev) body.append(prev);
    }

    li.append(check, body);
    return li;
}

/**
 * @param {Array<{ id: string, title: string, status: string, preview?: Record<string, unknown> }>} incoming
 * @param {Array<{ id: string, title: string, status: string, preview?: Record<string, unknown> }> | undefined} prior
 */
function mergeSlideWorkerAgentTasks(incoming, prior) {
    const priorById = new Map((prior ?? []).map((t) => [t.id, t]));
    return incoming.map((row) => {
        const old = priorById.get(row.id);
        if (!old) return row;
        const rowTitle = String(row.title ?? '—');
        const oldTitle = String(old.title ?? '—');
        const title =
            rowTitle.includes('—') || rowTitle.includes(' - ')
                ? rowTitle
                : oldTitle.includes('—') || oldTitle.includes(' - ')
                  ? oldTitle
                  : rowTitle;
        const status = mergeOaaoTaskItemStatus(old.status, row.status);
        let preview = row.preview ?? old.preview;
        if (
            normalizeOaaoTaskStatus(status) === 'done' &&
            preview &&
            typeof preview === 'object' &&
            preview.building === true
        ) {
            preview = { ...preview, building: false };
        }
        return {
            ...old,
            ...row,
            title,
            status,
            preview,
        };
    });
}

/**
 * Merge planner {@code tasks.items[].agent_tasks} with prior rows (snapshots may be partial).
 *
 * @param {Array<{ id: string, title: string, status: string, preview?: Record<string, unknown> }>} incoming
 * @param {Array<{ id: string, title: string, status: string, preview?: Record<string, unknown> }> | undefined} prior
 */
function mergeOaaoAgentTasksLists(incoming, prior) {
    if (!prior?.length) return incoming;
    if (!incoming?.length) return prior;
    const byId = new Map(prior.map((t) => [t.id, { ...t }]));
    for (const row of incoming) {
        const id = String(row.id ?? '').trim();
        if (!id) continue;
        const old = byId.get(id);
        if (!old) {
            byId.set(id, row);
            continue;
        }
        const rowTitle = String(row.title ?? '—');
        const oldTitle = String(old.title ?? '—');
        const title =
            rowTitle.includes('—') || rowTitle.includes(' - ')
                ? rowTitle
                : oldTitle.includes('—') || oldTitle.includes(' - ')
                  ? oldTitle
                  : rowTitle;
        byId.set(id, {
            ...old,
            ...row,
            title,
            status: mergeOaaoTaskItemStatus(old.status, row.status),
            preview: row.preview ?? old.preview,
        });
    }
    return [...byId.values()];
}

/**
 * @param {HTMLElement | Document} root
 */
function updateOaaoTaskListHeadingCount(root) {
    const host = getOaaoTaskListStripHost(root);
    if (!host) return;
    const state = oaaoTaskListStateByHost.get(host);
    if (state) {
        syncOaaoTaskPanelHeading(root, state);
        return;
    }
    const heading = host.querySelector('.oaao-task-list-heading');
    const items = host.querySelectorAll('.oaao-task-list-items li');
    if (!heading || !items.length) return;
    const done = [...items].filter((li) => li.classList.contains('oaao-task-list-row--done')).length;
    heading.textContent = `Steps ${done}/${items.length}`;
}

/**
 * Full {@code tasks} snapshots omit vault sub-steps; close dangling running rows when parent finished.
 *
 * @param {OaaoTaskItemState} item
 */
function finalizeAgentSubtasksWhenParentTerminal(item) {
    if (!item?.agent_tasks?.length) return;
    const parentSt = normalizeOaaoTaskStatus(item.status);
    if (parentSt !== 'done' && parentSt !== 'failed') return;
    const terminal = parentSt === 'failed' ? 'failed' : 'done';
    for (const at of item.agent_tasks) {
        const st = normalizeOaaoTaskStatus(at.status);
        if (st === 'active' || st === 'running' || st === 'pending' || st === 'awaiting_ask') {
            at.status = terminal;
        }
        if (
            terminal === 'done' &&
            at.preview &&
            typeof at.preview === 'object' &&
            at.preview.building === true
        ) {
            at.preview = { ...at.preview, building: false };
        }
    }
}

/**
 * @param {OaaoTaskListState} state
 */
/**
 * When export is done, planner snapshots may still show slide workers / phased sub-steps as pending.
 *
 * @param {OaaoTaskListState} state
 */
function finalizeSlideDesignerPipelineState(state) {
    let exportDone = false;
    for (const item of state.items.values()) {
        const st = normalizeOaaoTaskStatus(item.status);
        if (st !== 'done' && st !== 'failed') continue;
        const title = String(item.title ?? '').toLowerCase();
        if (title.includes('export')) {
            exportDone = true;
            break;
        }
    }
    if (!exportDone) return;

    for (const item of state.items.values()) {
        if (item.slide_workers && item.agent_tasks?.length) {
            item.status = mergeOaaoTaskItemStatus(item.status, 'done');
            for (const w of item.agent_tasks) {
                w.status = mergeOaaoTaskItemStatus(w.status, 'done');
                if (w.preview && typeof w.preview === 'object' && w.preview.building === true) {
                    w.preview = { ...w.preview, building: false };
                }
            }
        } else if (item.agent_kind === 'slide_designer' && item.agent_tasks?.length) {
            item.status = mergeOaaoTaskItemStatus(item.status, 'done');
        }
        finalizeAgentSubtasksWhenParentTerminal(item);
    }
}

function finalizeAllOaaoTaskListSubtasks(state) {
    finalizeSlideDesignerPipelineState(state);
    for (const item of state.items.values()) {
        finalizeAgentSubtasksWhenParentTerminal(item);
    }
}

/**
 * @param {HTMLElement} li
 * @param {string} atSt
 */
function syncOaaoInlineSubstepMarker(li, atSt) {
    const marker = li.querySelector('.oaao-chat-inline-substep-marker');
    if (!(marker instanceof HTMLElement)) return;
    const visual = atSt === 'running' ? 'active' : atSt;
    marker.innerHTML = oaaoTaskCheckSvgForStatus(visual);
}

/** @param {string} prev @param {string} next */
function mergeOaaoTaskItemStatus(prev, next) {
    const rank = {
        pending: 0,
        awaiting_ask: 1,
        active: 2,
        running: 2,
        done: 3,
        completed: 3,
        success: 3,
        failed: 3,
        skipped: 3,
    };
    const p = normalizeOaaoTaskStatus(prev);
    const n = normalizeOaaoTaskStatus(next);
    const a = rank[p] ?? 0;
    const b = rank[n] ?? 0;
    return b >= a ? n : p;
}

/**
 * @param {{ items?: Array<{ id?: string, title?: string, status?: string, agent_tasks?: unknown[] }>, abilities?: Array<{ name?: string }>, collapsed?: boolean }} payload
 * @param {OaaoTaskListState} [prev]
 * @returns {OaaoTaskListState}
 */
function mergeOaaoTaskListPayload(payload, prev) {
    const state = prev ? { ...prev, items: new Map(prev.items) } : createEmptyOaaoTaskListState();
    if (typeof payload.collapsed === 'boolean') {
        state.collapsed = payload.collapsed;
    }
    const panelViewRaw = /** @type {Record<string, unknown>} */ (payload).panelView;
    if (panelViewRaw === 'agents' || panelViewRaw === 'steps') {
        state.panelView = panelViewRaw;
    } else if (!state.panelView) {
        state.panelView = 'steps';
    }
    if (Array.isArray(payload.abilities)) {
        state.abilities = payload.abilities;
    }
    const allowedRaw = /** @type {Record<string, unknown>} */ (payload).allowed_agents;
    if (Array.isArray(allowedRaw)) {
        state.allowed_agents = allowedRaw
            .map((k) => String(k ?? '').trim())
            .filter((k) => OAAO_TASK_AGENT_CATALOG.some((e) => e.id === k));
    }
    if (!Array.isArray(payload.items)) {
        return state;
    }

    /** Full planner snapshot — replace membership + order (Map alone keeps stale insertion order). */
    const ordered = new Map();

    for (const raw of payload.items) {
        if (!raw || typeof raw !== 'object') continue;
        const id = String(raw.id ?? '').trim();
        if (!id) continue;
        const prior = state.items.get(id);
        const slideWorkersRow = Boolean(raw.slide_workers ?? prior?.slide_workers);
        /** @type {Array<{ id: string, title: string, status: string }>} */
        let agentTasks = prior?.agent_tasks ? [...prior.agent_tasks] : [];
        if (Array.isArray(raw.agent_tasks) && raw.agent_tasks.length > 0) {
            const incoming = raw.agent_tasks
                .filter((x) => x && typeof x === 'object')
                .map((x) => {
                    const o = /** @type {Record<string, unknown>} */ (x);
                    const row = {
                        id: String(o.id ?? ''),
                        title: String(o.title ?? '—'),
                        status: String(o.status ?? 'pending'),
                    };
                    if (o.preview && typeof o.preview === 'object') {
                        row.preview = /** @type {Record<string, unknown>} */ (o.preview);
                    }
                    return row;
                })
                .filter((x) => x.id);
            agentTasks = slideWorkersRow
                ? incoming
                : mergeOaaoAgentTasksLists(incoming, prior?.agent_tasks);
        }
        const nextStatus = String(raw.status ?? prior?.status ?? 'pending');
        if (slideWorkersRow && prior?.agent_tasks?.length) {
            agentTasks = mergeSlideWorkerAgentTasks(agentTasks, prior.agent_tasks);
        }
        if (
            !slideWorkersRow &&
            (nextStatus === 'pending' ||
                nextStatus === 'awaiting_ask' ||
                nextStatus === 'skipped')
        ) {
            agentTasks = [];
        }
        const progressedPastAsk = ['active', 'running', 'done', 'failed', 'skipped'].includes(nextStatus);
        const rawAsk = raw.ask && typeof raw.ask === 'object' ? /** @type {Record<string, unknown>} */ (raw.ask) : null;
        const pendingAsk = progressedPastAsk
            ? undefined
            : prior?.ask ??
              (rawAsk
                  ? {
                        run_id: String(rawAsk.run_id ?? ''),
                        task_id: String(rawAsk.task_id ?? id),
                        message: String(rawAsk.message ?? ''),
                        title: String(rawAsk.title ?? ''),
                        proceed_label: String(rawAsk.proceed_label ?? ''),
                        skip_label: String(rawAsk.skip_label ?? ''),
                        agent_kind: String(rawAsk.agent_kind ?? ''),
                    }
                  : undefined);
        let status = prior ? mergeOaaoTaskItemStatus(prior.status, nextStatus) : nextStatus;
        if (slideWorkersRow && agentTasks.length > 0) {
            status = mergeOaaoTaskItemStatus(status, oaaoAggregateWorkerStatuses(agentTasks));
        }
        if (pendingAsk && status !== 'done' && status !== 'failed' && status !== 'skipped') {
            status = 'awaiting_ask';
        }
        const row = {
            id,
            title: String(raw.title ?? prior?.title ?? '—'),
            status,
            agent_kind:
                typeof raw.agent_kind === 'string' && raw.agent_kind.trim()
                    ? raw.agent_kind.trim()
                    : prior?.agent_kind,
            parallel_ok: Boolean(raw.parallel_ok ?? prior?.parallel_ok),
            slide_index:
                typeof raw.slide_index === 'number'
                    ? raw.slide_index
                    : prior?.slide_index,
            slide_workers: Boolean(raw.slide_workers ?? prior?.slide_workers),
            agent_tasks: agentTasks,
            ...(pendingAsk ? { ask: pendingAsk } : {}),
            ...(prior?.sub_open !== undefined ? { sub_open: prior.sub_open } : {}),
        };
        const rawDur = raw.duration_ms != null ? Number(raw.duration_ms) : NaN;
        if (Number.isFinite(rawDur) && rawDur >= 0) {
            row.duration_ms = rawDur;
        } else if (prior?.duration_ms != null && Number.isFinite(Number(prior.duration_ms))) {
            row.duration_ms = Number(prior.duration_ms);
        }
        finalizeAgentSubtasksWhenParentTerminal(row);
        ordered.set(id, row);
    }

    state.items = ordered;
    return state;
}

/**
 * @param {OaaoTaskItemState} item
 * @param {Record<string, unknown>} agentTask
 */
function upsertOaaoAgentTaskOnItem(item, agentTask, opts = {}) {
    const workerKey = String(opts.workerRowId ?? agentTask.id ?? '').trim();
    if (!workerKey) return;
    const list = item.agent_tasks ? [...item.agent_tasks] : [];
    const row = {
        id: workerKey,
        title: String(agentTask.title ?? '—'),
        status: String(agentTask.status ?? 'running'),
    };
    if (agentTask.preview && typeof agentTask.preview === 'object') {
        row.preview = /** @type {Record<string, unknown>} */ (agentTask.preview);
    }
    const idx = list.findIndex((t) => t.id === workerKey);
    if (idx >= 0) {
        const prior = list[idx];
        const mergedTitle =
            row.title !== '—' &&
            (row.title.includes('—') || row.title.includes(' - ') || !prior.title.includes('—'))
                ? row.title
                : prior.title;
        list[idx] = {
            ...prior,
            ...row,
            status: mergeOaaoTaskItemStatus(prior.status, row.status),
            preview: row.preview ?? prior.preview,
            title: mergedTitle,
        };
    } else {
        list.push(row);
    }
    item.agent_tasks = list;
}

/**
 * @param {HTMLElement} host
 * @param {string} runTaskId
 * @param {OaaoTaskItemState} item
 */
function patchOaaoTaskListRowAgentTasks(host, runTaskId, item) {
    const li = host.querySelector(`.oaao-task-list-items > li[data-task-id="${runTaskId}"]`);
    if (!(li instanceof HTMLElement)) return false;

    const st = oaaoEffectiveTaskRowStatus(item);
    li.classList.remove('oaao-task-list-row--done', 'oaao-task-list-row--active', 'oaao-task-list-row--cancelled');
    if (st === 'done') li.classList.add('oaao-task-list-row--done');
    else if (st === 'skipped') li.classList.add('oaao-task-list-row--cancelled');
    else if (st === 'active' || st === 'running') li.classList.add('oaao-task-list-row--active');

    const mainCheck = li.querySelector(':scope > .oaao-task-list-check-wrap, :scope summary .oaao-task-list-check-wrap');
    if (mainCheck instanceof HTMLElement) {
        mainCheck.innerHTML = oaaoTaskCheckSvgForStatus(st);
    }
    const mainCopy = li.querySelector(':scope > .oaao-task-list-row-copy, :scope summary .oaao-task-list-row-copy');
    if (mainCopy instanceof HTMLElement) {
        const mainText = mainCopy.querySelector('.oaao-task-list-row-text');
        if (mainText instanceof HTMLElement) {
            mainText.textContent = String(item.title ?? '—');
        }
        mainCopy.querySelector('.oaao-task-list-row-agent')?.remove();
        const chip = buildOaaoTaskRowAgentChip(item.agent_kind);
        if (chip) mainCopy.append(chip);
    } else {
        const mainText = li.querySelector(':scope > .oaao-task-list-row-text, :scope summary .oaao-task-list-row-text');
        if (mainText instanceof HTMLElement) {
            mainText.textContent = String(item.title ?? '—');
        }
    }

    const agentTasks = oaaoVisibleAgentSubtasks(item);
    if (!agentTasks.length) return true;

    let details = li.querySelector(':scope > .oaao-task-list-agent-details');
    if (!(details instanceof HTMLDetailsElement)) {
        const fresh = buildOaaoTaskListRow(item);
        li.replaceWith(fresh);
        const detailsFresh = fresh.querySelector('.oaao-task-list-agent-details');
        if (detailsFresh instanceof HTMLDetailsElement) {
            syncOaaoAgentDetailsChevron(detailsFresh);
        }
        return true;
    }

    if (item.sub_open !== false) {
        details.open = true;
    }

    let subUl = details.querySelector(':scope > .oaao-task-list-agent-items');
    if (!(subUl instanceof HTMLUListElement)) {
        subUl = document.createElement('ul');
        subUl.className = 'oaao-task-list-agent-items';
        details.append(subUl);
    }
    subUl.textContent = '';
    const cid = Number(host.dataset.oaaoTaskListConv || 0);
    for (const at of agentTasks) {
        subUl.append(buildOaaoAgentTaskRow(at, cid, item));
    }
    updateOaaoTaskListHeadingCount(document);
    applyOaaoTaskPanelI18n(document);
    scheduleChatComposerReserveSync();
    return true;
}

/**
 * @param {HTMLElement} host
 * @param {OaaoTaskListState} state
 */
function renderOaaoTaskListStripFromState(host, state) {
    if (isOaaoInlineTaskStepsHost(host)) {
        if (host.querySelector('.oaao-chat-inline-task-steps-inner')) {
            patchOaaoInlineTaskStepsFromState(host, state);
        } else {
            renderOaaoInlineTaskStepsFromState(host, state);
        }
        applyOaaoTaskPanelI18n(document);
        scheduleChatComposerReserveSync();
        return;
    }

    const rows = oaaoTaskRowsForDisplay(state);
    if (!rows.length) {
        host.innerHTML = '';
        host.setAttribute('hidden', '');
        host.classList.add('hidden');
        syncOaaoTaskPanelVisibility(document);
        scheduleChatComposerReserveSync();
        return;
    }

    host.classList.remove('hidden');
    host.removeAttribute('hidden');

    const sidePanel = isOaaoTaskSidePanel(host);
    const existingUl = host.querySelector('.oaao-task-list-items');
    if (existingUl instanceof HTMLUListElement && rows.length) {
        const scrollEl = oaaoTaskListScrollHost(host);
        const scrollTop = scrollEl.scrollTop;
        const cid = Number(host.dataset.oaaoTaskListConv || 0);
        const seen = new Set();
        for (const it of rows) {
            const id = String(it.id ?? '').trim();
            if (!id) continue;
            seen.add(id);
            let li = existingUl.querySelector(`li[data-task-id="${CSS.escape(id)}"]`);
            if (li instanceof HTMLElement && patchOaaoTaskListRowAgentTasks(host, id, it)) {
                continue;
            }
            if (li instanceof HTMLElement) {
                const fresh = buildOaaoTaskListRow(it, cid);
                li.replaceWith(fresh);
            } else {
                existingUl.append(buildOaaoTaskListRow(it, cid));
            }
        }
        existingUl.querySelectorAll('li[data-task-id]').forEach((node) => {
            if (node instanceof HTMLElement) {
                const id = String(node.dataset.taskId ?? '').trim();
                if (id && !seen.has(id)) node.remove();
            }
        });
        const done = rows.filter((it) => it.status === 'done').length;
        const heading = host.querySelector('.oaao-task-list-heading');
        if (heading instanceof HTMLElement) {
            heading.textContent = `Steps ${done}/${rows.length}`;
        }
        scrollEl.scrollTop = scrollTop;
        if (sidePanel) {
            syncOaaoTaskPanelChrome(host, state);
        } else {
            syncOaaoTaskListStripChrome(host, host.querySelector('.oaao-task-list-chevron'));
        }
        syncOaaoTaskPanelVisibility(document);
        scheduleChatComposerReserveSync();
        return;
    }

    host.innerHTML = '';

    const inner = document.createElement('div');
    inner.className = 'oaao-task-list-inner';

    /** @type {HTMLButtonElement | null} */
    let chev = null;

    if (!sidePanel) {
    const done = rows.filter((it) => it.status === 'done').length;

    const header = document.createElement('div');
    header.className = 'oaao-task-list-header';

    chev = document.createElement('button');
    chev.type = 'button';
    chev.className = 'oaao-task-list-chevron';
    chev.setAttribute('aria-expanded', 'true');
    chev.setAttribute('aria-label', 'Toggle steps');
    chev.innerHTML = OAAO_TASK_CHEVRON_SVG;
    chev.addEventListener('click', () => {
        host.classList.toggle('oaao-task-list-strip--collapsed');
        state.collapsed = host.classList.contains('oaao-task-list-strip--collapsed');
        syncOaaoTaskListStripChrome(host, chev);
        scheduleChatComposerReserveSync();
    });

    const heading = document.createElement('div');
    heading.className = 'oaao-task-list-heading';
    heading.textContent = `Steps ${done}/${rows.length}`;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'oaao-task-list-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss steps');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => clearOaaoTaskListStrip(document, true));

    header.append(chev, heading, dismiss);
    inner.append(header);
    }

    const body = document.createElement('div');
    body.className = 'oaao-task-list-body';
    const ul = document.createElement('ul');
    ul.className = 'oaao-task-list-items';
    const cid = Number(host.dataset.oaaoTaskListConv || 0);
    for (const it of rows) {
        ul.append(buildOaaoTaskListRow(it, cid));
    }
    body.append(ul);
    inner.append(body);
    host.append(inner);

    if (state.collapsed) {
        if (sidePanel) {
            getOaaoTaskPanelChrome(host).panel?.classList.add('oaao-chat-task-panel--steps-collapsed');
        } else {
            host.classList.add('oaao-task-list-strip--collapsed');
        }
    } else if (sidePanel) {
        getOaaoTaskPanelChrome(host).panel?.classList.remove('oaao-chat-task-panel--steps-collapsed');
        host.classList.remove('oaao-task-list-strip--collapsed');
    } else {
        host.classList.remove('oaao-task-list-strip--collapsed');
    }

    if (sidePanel) {
        syncOaaoTaskPanelChrome(host, state);
    } else {
        syncOaaoTaskListStripChrome(host, chev);
    }
    syncOaaoTaskPanelVisibility(document);
    scheduleChatComposerReserveSync();
}

/**
 * @param {HTMLElement | Document} root
 * @param {{ items?: Array<{ id?: string, title?: string, status?: string }>, abilities?: Array<{ name?: string }>, collapsed?: boolean }} payload
 */
function renderOaaoTaskListStrip(root, payload) {
    const host = getOaaoTaskListStripHost(root);
    if (!host || !payload || !Array.isArray(payload.items) || !payload.items.length) return;
    const state = mergeOaaoTaskListPayload(payload, getOaaoTaskListState(host));
    oaaoTaskListStateByHost.set(host, state);
    renderOaaoTaskListStripFromState(host, state);
}

/**
 * @param {Record<string, unknown>} data SSE envelope object
 * @returns {{ items: Array<{ id?: string, title?: string, status?: string }>, abilities?: Array<{ name?: string }> } | null}
 */
function extractTasksPayloadFromEnvelope(data) {
    const p = data?.payload;
    if (!p || typeof p !== 'object') return null;
    const tasks = /** @type {Record<string, unknown>} */ (p).tasks;
    if (!tasks || typeof tasks !== 'object') return null;
    const items = /** @type {Record<string, unknown>} */ (tasks).items;
    if (!Array.isArray(items) || !items.length) return null;

    return /** @type {{ items: Array<{ id?: string, title?: string, status?: string }>, abilities?: Array<{ name?: string }> }} */ (
        tasks
    );
}

/**
 * Snapshot inline task steps for persistence (assistant {@code meta_json.tasks} / IQS).
 *
 * @param {HTMLElement | Document} root
 * @param {number} conversationId
 * @returns {{ items: Array<Record<string, unknown>>, abilities?: unknown[], allowed_agents?: string[] } | null}
 */
function buildOaaoTasksMetaSnapshot(root, conversationId) {
    const state = getOaaoTaskListStateForConversation(conversationId);
    if (!state || state.items.size < 1) return null;
    return buildOaaoTasksPersistPayload(state);
}

/**
 * Prefer live inline-step state over orchestrator {@code system/end} tasks (includes agent sub-steps).
 *
 * @param {Record<string, unknown> | null} runMeta
 * @param {HTMLElement | Document} root
 * @param {number} conversationId
 * @returns {Record<string, unknown> | null}
 */
function mergeTasksMetaIntoRunMetrics(runMeta, root, conversationId) {
    const tasksSnap = buildOaaoTasksMetaSnapshot(root, conversationId);
    if (!tasksSnap) {
        return runMeta && typeof runMeta === 'object' ? runMeta : null;
    }
    const base = runMeta && typeof runMeta === 'object' ? { ...runMeta } : {};
    base.tasks = tasksSnap;
    return base;
}

/**
 * @param {Record<string, unknown>} proj
 * @returns {Record<string, unknown> | null}
 */
function buildSlideProjectMaterialRow(proj) {
    const pid = String(proj.project_id ?? '').trim();
    if (!pid) return null;

    return {
        material_id: `slide-${pid}`,
        kind: 'slide_project',
        category: 'slide',
        title: String(proj.title ?? 'Slide project'),
        meta: {
            project_id: pid,
            slide_count: proj.slide_count,
            status: proj.status,
        },
    };
}

/**
 * Merge {@code meta.materials} for IQS — orchestrator payload + slide_project + pipeline artifacts.
 *
 * @param {Record<string, unknown> | null} runMeta
 * @param {HTMLElement | Document} root
 * @param {number} conversationId
 * @returns {Record<string, unknown> | null}
 */
function mergeMaterialsMetaIntoRunMetrics(runMeta, root, conversationId) {
    const base = mergeTasksMetaIntoRunMetrics(runMeta, root, conversationId);
    if (!base || typeof base !== 'object') {
        return base;
    }

    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();
    const existing = base.materials;
    if (Array.isArray(existing)) {
        for (const raw of existing) {
            if (!raw || typeof raw !== 'object') continue;
            const row = /** @type {Record<string, unknown>} */ (raw);
            const id = String(row.material_id ?? row.id ?? '').trim();
            if (id) byId.set(id, { ...row });
        }
    }

    const sp = base.slide_project;
    if (sp && typeof sp === 'object') {
        const slideRow = buildSlideProjectMaterialRow(/** @type {Record<string, unknown>} */ (sp));
        if (slideRow) {
            byId.set(String(slideRow.material_id), slideRow);
        }
    }

    const pipe = base.oaao_pipeline;
    if (pipe && typeof pipe === 'object') {
        const arts = /** @type {Record<string, unknown>} */ (pipe).artifacts;
        if (Array.isArray(arts)) {
            for (const raw of arts) {
                if (!raw || typeof raw !== 'object') continue;
                const a = /** @type {Record<string, unknown>} */ (raw);
                const id = String(a.id ?? '').trim();
                if (!id || byId.has(id)) continue;
                const body =
                    typeof a.body === 'string' && a.body.trim() ? a.body.trim() : '';
                byId.set(id, {
                    material_id: id,
                    kind: String(a.agent_kind ?? '') === 'vault_rag' ? 'vault_grounding' : 'file',
                    category: String(a.category ?? 'document'),
                    title: String(a.name ?? id),
                    mime: a.mime ?? (body ? 'text/markdown' : undefined),
                    size_bytes: a.size_bytes,
                    uri: a.uri,
                    task_id: a.run_task_id,
                    meta: body ? { body, agent_kind: a.agent_kind } : undefined,
                });
            }
        }
    }

    if (byId.size > 0) {
        base.materials = [...byId.values()];
    }

    return base;
}

/** Inline SVG close — Chat shell uses {@code rz-icon} strokes, not Remix {@code ri-close-line}. */
function createComposerCloseIconSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('class', 'rz-icon block shrink-0 w-[14px] h-[14px] pointer-events-none');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M18 6 6 18M6 6l12 12');
    svg.append(path);
    return svg;
}

/**
 * @param {HTMLElement} mount
 */
const OAAO_CONV_MODE_STORAGE_PREFIX = 'oaao_conversation_mode_';
const OAAO_PLANNER_MODE_STORAGE_PREFIX = 'oaao_planner_mode_';
const OAAO_PLANNER_MODE_PENDING_KEY = 'oaao_planner_mode_pending';

/** @type {Map<number, 'default' | 'tot' | 'ddtree'>} */
const plannerModeByConversationId = new Map();

/** @type {ReturnType<typeof mountComposerDropupAbove> | null} */
let chatComposerPlannerModeDropup = null;

/** @type {Set<number>} */
const deskModeConversationIds = new Set();

/**
 * @param {number} conversationId
 */
function readStoredConversationMode(conversationId) {
    const cid = Number(conversationId) || 0;
    if (cid < 1) return '';
    try {
        return String(sessionStorage.getItem(`${OAAO_CONV_MODE_STORAGE_PREFIX}${cid}`) ?? '').trim();
    } catch {
        return '';
    }
}

/**
 * @param {number} conversationId
 * @param {'desk' | 'default'} mode
 */
function rememberConversationModeLocal(conversationId, mode) {
    const cid = Number(conversationId) || 0;
    if (cid < 1) return;
    if (mode === 'desk') {
        deskModeConversationIds.add(cid);
    } else {
        deskModeConversationIds.delete(cid);
    }
    try {
        if (mode === 'desk') {
            sessionStorage.setItem(`${OAAO_CONV_MODE_STORAGE_PREFIX}${cid}`, 'desk');
        } else {
            sessionStorage.removeItem(`${OAAO_CONV_MODE_STORAGE_PREFIX}${cid}`);
        }
    } catch {
        /* ignore */
    }
    for (const row of cachedConversations) {
        if (Number(row.id) === cid) {
            row.mode = mode;
            break;
        }
    }
    conversationSidebarRenderFn?.();
}

/**
 * @param {number} conversationId
 */
function isDeskModeConversation(conversationId) {
    const cid = Number(conversationId) || 0;
    if (cid < 1) return false;
    if (deskModeConversationIds.has(cid)) return true;
    if (readStoredConversationMode(cid) === 'desk') {
        deskModeConversationIds.add(cid);
        return true;
    }
    return false;
}

/**
 * @param {Array<{ id?: number, mode?: string }>} rows
 */
function syncConversationModesFromRows(rows) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
        const id = Number(row?.id) || 0;
        if (id < 1) continue;
        const mode = String(row.mode ?? '').toLowerCase();
        if (mode === 'desk') {
            rememberConversationModeLocal(id, 'desk');
        } else if (mode === 'default') {
            rememberConversationModeLocal(id, 'default');
        }
    }
}

/**
 * @param {{ mode?: string } | null | undefined} row
 * @param {number} conversationId
 */
function isConversationDeskModeRow(row, conversationId) {
    if (String(row?.mode ?? '').toLowerCase() === 'desk') return true;

    return isDeskModeConversation(conversationId);
}

function isSlideDeckModeActive() {
    const cid = Number(activeConversationId) || 0;
    return (
        Boolean(chatComposerActiveMaterial) ||
        Boolean(chatComposerSlideDeckContext) ||
        (cid > 0 && isDeskModeConversation(cid))
    );
}

/**
 * @param {number} conversationId
 */
function persistConversationDeskMode(conversationId) {
    const cid = Number(conversationId) || 0;
    if (cid < 1) return;
    rememberConversationModeLocal(cid, 'desk');
    void chatFetchJson(chatApiUrl('conversation_mode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            conversation_id: cid,
            mode: 'desk',
            ...workspaceChatBodyFields(),
        }),
    }).catch(() => {});
}

/** @param {'default' | 'tot' | 'ddtree'} mode */
function normalizePlannerModeId(mode) {
    const m = String(mode ?? '').trim().toLowerCase();
    if (m === 'tot' || m === 'ddtree') return m;
    return 'default';
}

/**
 * @param {number} conversationId
 * @returns {'default' | 'tot' | 'ddtree'}
 */
function readStoredPlannerMode(conversationId) {
    const cid = Number(conversationId) || 0;
    if (cid < 1) return 'default';
    const cached = plannerModeByConversationId.get(cid);
    if (cached) return cached;
    try {
        return normalizePlannerModeId(sessionStorage.getItem(`${OAAO_PLANNER_MODE_STORAGE_PREFIX}${cid}`));
    } catch {
        return 'default';
    }
}

/**
 * Planner mode for the next send — active conversation storage or pre-thread pending pick.
 * @param {number | null | undefined} conversationId
 * @returns {'default' | 'tot' | 'ddtree'}
 */
function readComposerPlannerModeForSend(conversationId) {
    const cid = Number(conversationId) || 0;
    if (cid > 0) {
        return readStoredPlannerMode(cid);
    }
    try {
        return normalizePlannerModeId(sessionStorage.getItem(OAAO_PLANNER_MODE_PENDING_KEY));
    } catch {
        return 'default';
    }
}

/**
 * @param {number} conversationId
 * @param {'default' | 'tot' | 'ddtree'} mode
 */
function rememberPlannerModeLocal(conversationId, mode) {
    const cid = Number(conversationId) || 0;
    if (cid < 1) return;
    const normalized = normalizePlannerModeId(mode);
    plannerModeByConversationId.set(cid, normalized);
    try {
        sessionStorage.setItem(`${OAAO_PLANNER_MODE_STORAGE_PREFIX}${cid}`, normalized);
    } catch {
        /* ignore */
    }
    for (const row of cachedConversations) {
        if (Number(row.id) === cid) {
            row.planner_mode_id = normalized;
            break;
        }
    }
}

/**
 * @param {number} conversationId
 * @param {'default' | 'tot' | 'ddtree'} mode
 */
function persistPlannerMode(conversationId, mode) {
    const cid = Number(conversationId) || 0;
    if (cid < 1) return;
    const normalized = normalizePlannerModeId(mode);
    rememberPlannerModeLocal(cid, normalized);
    void chatFetchJson(chatApiUrl('conversation_mode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            conversation_id: cid,
            planner_mode_id: normalized,
            ...workspaceChatBodyFields(),
        }),
    }).catch(() => {});
}

/**
 * @param {Array<{ id?: number, planner_mode_id?: string }>} rows
 */
function syncPlannerModesFromRows(rows) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
        const id = Number(row?.id) || 0;
        if (id < 1) continue;
        rememberPlannerModeLocal(id, normalizePlannerModeId(row.planner_mode_id));
    }
}

/**
 * @param {string | undefined} agentKind
 */
function isSlideDesignerAgentKind(agentKind) {
    return String(agentKind ?? '').trim() === 'slide_designer';
}

/**
 * Desk mode as soon as slide_designer starts (agent ask / task list) — not only after slide_project meta exists.
 *
 * @param {number} conversationId
 * @param {{ syncComposer?: boolean }} [opts]
 */
function enterDeskModeForSlideDesigner(conversationId, opts = {}) {
    const cid = Number(conversationId) || 0;
    if (cid < 1) return;
    const syncComposer = opts.syncComposer !== false;
    if (!isDeskModeConversation(cid)) {
        persistConversationDeskMode(cid);
    }
    if (syncComposer) {
        const m = resolveChatComposerMountEl();
        if (m instanceof HTMLElement) syncComposerSlideDeckMode(m);
    }
}

/**
 * @param {number} conversationId
 * @param {OaaoTaskListState} state
 */
function maybeEnterDeskModeFromTaskState(conversationId, state) {
    for (const item of state.items.values()) {
        if (!isSlideDesignerAgentKind(item.agent_kind)) continue;
        const st = String(item.status ?? '').toLowerCase();
        if (st === 'active' || st === 'running' || st === 'done') {
            enterDeskModeForSlideDesigner(conversationId);
            return;
        }
    }
}

/**
 * @param {number} parentConversationId
 * @returns {Promise<number>}
 */
async function forkConversationForModeSwitch(parentConversationId) {
    const parentId = Number(parentConversationId) || 0;
    if (parentId < 1) return 0;
    const { res, data } = await chatFetchJson(chatApiUrl('conversation_fork'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            conversation_id: parentId,
            ...workspaceChatBodyFields(),
        }),
    });
    if (!res.ok || !data.success) {
        return 0;
    }
    const newId = Number(data.conversation_id);
    return Number.isFinite(newId) && newId > 0 ? newId : 0;
}

/**
 * @param {Record<string, unknown> | null | undefined} meta
 * @param {number} messageId
 * @param {number} conversationId
 */
function extractSlideDeckContextFromMeta(meta, messageId, conversationId) {
    if (!meta || typeof meta !== 'object') return null;
    const pipe = meta.oaao_pipeline;
    if (!pipe || typeof pipe !== 'object') return null;
    const blocks = /** @type {Record<string, unknown>} */ (pipe).blocks;
    if (!Array.isArray(blocks)) return null;
    for (const raw of blocks) {
        if (!raw || typeof raw !== 'object') continue;
        const block = /** @type {Record<string, unknown>} */ (raw);
        if (String(block.type ?? '').trim() !== 'slide_preview_strip') continue;
        const props =
            block.props && typeof block.props === 'object'
                ? /** @type {Record<string, unknown>} */ (block.props)
                : {};
        const projectId = String(props.project_id ?? '').trim();
        if (!projectId) continue;
        const slidesRaw = props.slides;
        const slides = Array.isArray(slidesRaw)
            ? slidesRaw.filter((s) => s && typeof s === 'object').map((s) => /** @type {Record<string, unknown>} */ (s))
            : [];
        return {
            conversationId,
            messageId,
            projectId,
            deckTitle: String(props.project_title ?? meta.title ?? 'Slide deck').trim() || 'Slide deck',
            slides,
        };
    }
    return null;
}

/**
 * @param {number} conversationId
 */
function refreshChatComposerSlideDeckContext(conversationId) {
    const cid = Number(conversationId) || 0;
    if (cid < 1 || !Array.isArray(cachedMessageRows)) {
        chatComposerSlideDeckContext = null;
        return;
    }
    for (let i = cachedMessageRows.length - 1; i >= 0; i--) {
        const m = cachedMessageRows[i];
        if (String(m.role ?? '').toLowerCase() !== 'assistant') continue;
        const mid = Number(m.id);
        if (!Number.isFinite(mid) || mid < 1) continue;
        const meta =
            m.meta && typeof m.meta === 'object' ? /** @type {Record<string, unknown>} */ (m.meta) : null;
        const ctx = extractSlideDeckContextFromMeta(meta, mid, cid);
        if (ctx) {
            chatComposerSlideDeckContext = ctx;
            persistConversationDeskMode(cid);
            return;
        }
    }
    chatComposerSlideDeckContext = null;
}

/**
 * @param {HTMLElement} mount
 */
function syncComposerSlideDeckMode(mount) {
    hydrateRuiIconSlots(mount);
    const deskActive = isSlideDeckModeActive();
    const modeBar = mount.querySelector('[data-oaao-chat="composer-desk-mode-bar"]');
    if (modeBar instanceof HTMLElement) {
        modeBar.classList.toggle('hidden', !deskActive);
    }
    const materialsHost = mount.querySelector('[data-oaao-chat="composer-desk-materials-host"]');
    if (materialsHost instanceof HTMLElement) {
        if (!chatComposerPinnedMaterialsBtn) {
            const tip = oaaoChatT('chat.materials.toolbar_tip', 'View all files in this task');
            chatComposerPinnedMaterialsBtn = createTaskMaterialsToolbarIcon(tip, () => {
                void openPinnedComposerMaterials(mount);
            }, panelAbort?.signal ?? new AbortController().signal);
            chatComposerPinnedMaterialsBtn.dataset.oaaoChat = 'composer-materials-pinned';
        }
        if (deskActive) {
            if (chatComposerPinnedMaterialsBtn.parentElement !== materialsHost) {
                materialsHost.replaceChildren(chatComposerPinnedMaterialsBtn);
            }
        } else if (chatComposerPinnedMaterialsBtn.parentElement === materialsHost) {
            chatComposerPinnedMaterialsBtn.remove();
        }
    }
    const root = mount.querySelector('.oaao-chat-root');
    if (root instanceof HTMLElement) {
        root.classList.toggle('oaao-chat-root--desk-mode', deskActive);
        root.classList.toggle('oaao-chat-root--slide-deck-mode', deskActive);
    }
}

/**
 * @param {HTMLElement} mount
 */
async function openPinnedComposerMaterials(mount) {
    const cid = activeConversationId;
    if (!cid || cid < 1) return;
    const ctx = chatComposerSlideDeckContext;
    const mid =
        ctx && ctx.conversationId === cid && ctx.messageId > 0
            ? ctx.messageId
            : latestAssistantMessageIdWithMaterials(cid);
    if (mid) {
        await openTaskMaterialsDialog({
            conversationId: cid,
            messageId: mid,
            fetchJson: chatFetchJson,
            apiUrl: chatApiUrl,
        });
        return;
    }
    await openConversationMaterialsDialog({
        conversationId: cid,
        fetchJson: chatFetchJson,
        apiUrl: chatApiUrl,
    });
}

/**
 * @param {number} conversationId
 * @returns {number}
 */
function latestAssistantMessageIdWithMaterials(conversationId) {
    if (!Array.isArray(cachedMessageRows)) return 0;
    for (let i = cachedMessageRows.length - 1; i >= 0; i--) {
        const m = cachedMessageRows[i];
        if (String(m.role ?? '').toLowerCase() !== 'assistant') continue;
        const mid = Number(m.id);
        if (!Number.isFinite(mid) || mid < 1) continue;
        const meta =
            m.meta && typeof m.meta === 'object' ? /** @type {Record<string, unknown>} */ (m.meta) : null;
        if (countMaterialsFromMeta(meta) > 0) return mid;
    }
    return 0;
}

function syncComposerChipsWrap(mount) {
    const wrap = mount.querySelector('[data-oaao-chat="composer-refs"]');
    if (!(wrap instanceof HTMLElement)) return;
    const visible =
        Boolean(chatComposerActiveMaterial) ||
        Boolean(chatComposerActiveSlideTemplate) ||
        Boolean(chatComposerSlideDeckContext);
    wrap.classList.toggle('hidden', !visible);
}

/**
 * @param {HTMLElement} mount
 */
function syncChatComposerChips(mount) {
    syncComposerSlideDeckMode(mount);
    renderChatComposerActiveTemplateChip(mount);
    renderChatComposerActiveMaterialChip(mount);
    renderChatComposerAttachmentChips(mount);
}

/**
 * @param {HTMLElement} mount
 */
function renderChatComposerActiveTemplateChip(mount) {
    const host = mount.querySelector('[data-oaao-chat="active-template-chip"]');
    if (!(host instanceof HTMLElement)) return;
    host.replaceChildren();
    if (!chatComposerActiveSlideTemplate) {
        host.classList.add('hidden');
        syncComposerChipsWrap(mount);
        return;
    }
    host.classList.remove('hidden');
    syncComposerChipsWrap(mount);
    const tpl = {
        template_id: chatComposerActiveSlideTemplate.template_id,
        label: chatComposerActiveSlideTemplate.label,
        thumb_url: chatComposerActiveSlideTemplate.thumb_url,
    };
    host.append(
        createTemplateSlugNode(tpl, () => {
            chatComposerActiveSlideTemplate = null;
            try {
                sessionStorage.removeItem(CHAT_PENDING_SLIDE_TEMPLATE_KEY);
            } catch {
                /* ignore */
            }
            const editor = mount.querySelector('[data-oaao-chat="input"]');
            if (isChatComposerEditorEl(editor)) {
                removeTemplateSlugsFromEditor(editor);
            }
            syncChatComposerChips(mount);
        }),
    );
}

/** @type {Promise<Record<string, unknown>> | null} */
let chatSlideTemplateApiPromise = null;

function loadChatSlideTemplateApi() {
    if (!chatSlideTemplateApiPromise) {
        const url = oaaoPrefixedSitePath('/webassets/slide-designer/default/js/slide-template-api.js');
        chatSlideTemplateApiPromise = import(/* webpackIgnore: true */ url);
    }
    return chatSlideTemplateApiPromise;
}

/**
 * @param {string} query
 * @returns {Promise<{ template_id: string, label: string, thumb_url?: string } | null>}
 */
async function resolvePublishedSlideTemplateSlug(query) {
    const q = String(query ?? '').trim();
    if (!q) return null;
    const api = await loadChatSlideTemplateApi();
    const { res, data } = await api.fetchTemplateList(true, '');
    if (!res.ok || !data.success) return null;
    const custom = data?.data?.custom_templates;
    if (!Array.isArray(custom)) return null;
    const qLower = q.toLowerCase();
    /** @type {Record<string, unknown> | null} */
    let exact = null;
    /** @type {Record<string, unknown> | null} */
    let labelHit = null;
    for (const raw of custom) {
        if (!raw || typeof raw !== 'object') continue;
        const row = /** @type {Record<string, unknown>} */ (raw);
        if (String(row.status ?? '') !== 'published') continue;
        const tid = String(row.template_id ?? '').trim();
        if (!tid) continue;
        if (tid === q || tid.toLowerCase() === qLower) {
            exact = row;
            break;
        }
        const label = String(row.label ?? '').trim();
        if (!labelHit && label && label.toLowerCase() === qLower) {
            labelHit = row;
        }
        if (!labelHit && label && label.toLowerCase().includes(qLower)) {
            labelHit = row;
        }
    }
    const hit = exact ?? labelHit;
    if (!hit) return null;
    const tid = String(hit.template_id ?? '').trim();
    const label = api.templateDisplayLabel(tid, String(hit.label ?? tid));
    const thumbUrl = api.templateThumbUrl(hit);
    return { template_id: tid, label, thumb_url: thumbUrl || undefined };
}

/**
 * Select template for the next send — chip above composer only (no inline editor pill).
 *
 * @param {HTMLElement} mount
 * @param {{ template_id: string, label: string, thumb_url?: string }} template
 */
function applyTemplateToComposer(mount, template) {
    const editor = mount.querySelector('[data-oaao-chat="input"]');
    chatComposerActiveSlideTemplate = {
        template_id: template.template_id,
        label: template.label,
        thumb_url: template.thumb_url,
    };
    try {
        sessionStorage.setItem(
            CHAT_PENDING_SLIDE_TEMPLATE_KEY,
            JSON.stringify({
                template_id: template.template_id,
                label: template.label,
                thumb_url: template.thumb_url ?? '',
            }),
        );
    } catch {
        /* ignore */
    }
    if (isChatComposerEditorEl(editor)) {
        removeTemplateSlugsFromEditor(editor);
    }
    renderChatComposerActiveTemplateChip(mount);
    if (isChatComposerEditorEl(editor)) {
        focusChatComposerEditor(editor);
    }
}

/**
 * @param {HTMLElement} mount
 */
function renderChatComposerActiveMaterialChip(mount) {
    const host = mount.querySelector('[data-oaao-chat="active-material-chip"]');
    if (!(host instanceof HTMLElement)) return;
    host.replaceChildren();
    if (!chatComposerActiveMaterial) {
        host.classList.add('hidden');
        syncComposerChipsWrap(mount);
        return;
    }
    host.classList.remove('hidden');
    const pill = document.createElement('div');
    pill.className =
        'inline-flex items-center gap-1.5 max-w-full rounded-full px-3 py-1 text-[0.75rem] fw-medium border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--grid-ink)_6%,transparent)] fg-[var(--grid-ink)]';
    const icon = document.createElement('span');
    icon.className = 'inline-flex shrink-0 items-center justify-center';
    icon.setAttribute('aria-hidden', 'true');
    void mountRuiIcon(icon, OAAO_RUI_ICON_SLIDE, { size: 15 });
    const label = document.createElement('span');
    label.className = 'truncate';
    label.textContent = oaaoChatT(
        'chat.materials.continuing_deck',
        'Continuing: {title}',
    ).replace('{title}', chatComposerActiveMaterial.title);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className =
        'inline-flex items-center justify-center w-5 h-5 p-0 border-0 rounded-full bg-transparent cursor-pointer fg-[var(--grid-ink-muted)] hover:fg-[var(--grid-ink)] font-inherit';
    dismiss.setAttribute('aria-label', oaaoChatT('chat.materials.clear_active', 'Stop continuing this deck'));
    dismiss.append(createComposerCloseIconSvg());
    dismiss.addEventListener('click', () => {
        chatComposerActiveMaterial = null;
        syncChatComposerChips(mount);
    });
    pill.append(icon, label, dismiss);
    host.append(pill);
    syncComposerChipsWrap(mount);
}

/**
 * @returns {HTMLElement | null}
 */
function resolveChatComposerMountEl() {
    const mount = document.getElementById('workspace-module-mount');
    if (mount instanceof HTMLElement) {
        const inner = mount.querySelector('.oaao-chat-root');
        if (inner instanceof HTMLElement) return mount;
    }
    const root = document.querySelector('.oaao-chat-root');
    if (root instanceof HTMLElement) {
        const m = root.closest('#workspace-module-mount');
        return m instanceof HTMLElement ? m : root;
    }
    return null;
}

/**
 * @param {HTMLElement} mount
 */
const TEMPLATE_VAGUE_BODY_RE = /^(use\s+(this\s+)?template|使用(此|這)?模板)\.?$/iu;

/**
 * @param {string} text
 * @param {string} [label]
 */
function isVagueTemplateComposerBody(text, label) {
    const t = String(text ?? '').trim();
    if (!t) return true;
    if (TEMPLATE_VAGUE_BODY_RE.test(t)) return true;
    const lab = String(label ?? '').trim();
    if (lab && t.toLowerCase() === lab.toLowerCase()) return true;
    if (/^create a slide presentation using (my selected|the published slide) template\.?$/i.test(t)) {
        return true;
    }
    if (/^create a slide presentation using the published slide template "/i.test(t)) {
        return true;
    }
    return false;
}

const TEMPLATE_META_SUFFIX_RE = /\n\n\[Use published slide template:[\s\S]*?\]\.?\s*$/u;

/**
 * @param {string} text
 */
function stripSlideTemplateMetaSuffix(text) {
    let t = String(text ?? '')
        .replace(TEMPLATE_META_SUFFIX_RE, '')
        .trim();
    t = t
        .replace(
            /Create a slide presentation using the published slide template "[^"]+"\s*\(template_id:\s*[^)]+\)\.?\s*/gi,
            '',
        )
        .trim();
    t = t
        .replace(
            /^Create a slide presentation using (my selected|the published slide) template\.?\s*/i,
            '',
        )
        .trim();
    return t;
}

/**
 * @param {string} text
 */
function parseSlideTemplateFromEnrichedProse(text) {
    const m = String(text ?? '').match(
        /published slide template "([^"]+)"\s*\(template_id:\s*([^)]+)\)/i,
    );
    if (!m) return null;
    const template_id = String(m[2] ?? '').trim();
    if (!template_id) return null;
    const label = String(m[1] ?? template_id).trim() || template_id;
    return { template_id, label };
}

/**
 * @param {unknown} meta
 * @returns {{ template_id: string, label: string } | null}
 */
function parseSlideTemplateFromMessageMeta(meta) {
    if (!meta || typeof meta !== 'object') return null;
    const row = /** @type {Record<string, unknown>} */ (meta);
    const template_id = String(row.slide_template_id ?? '').trim();
    if (!template_id) return null;
    const label = String(row.slide_template_label ?? template_id).trim() || template_id;
    return { template_id, label };
}

/**
 * Legacy rows stored enriched prose before meta_json — recover template from bracket suffix.
 *
 * @param {string} text
 */
function parseSlideTemplateFromBracketSuffix(text) {
    const m = String(text ?? '').match(
        /\[Use published slide template:\s*([^\]]+?)\s*\(template_id:\s*([^)]+)\)\.?\]/u,
    );
    if (!m) return null;
    const template_id = String(m[2] ?? '').trim();
    if (!template_id) return null;
    const label = String(m[1] ?? template_id).trim() || template_id;
    return { template_id, label };
}

/**
 * @param {string} contentText
 * @param {unknown} meta
 * @returns {{ template_id: string, label: string } | null}
 */
function resolveSlideTemplateFromMessage(contentText, meta) {
    return (
        parseSlideTemplateFromMessageMeta(meta) ??
        parseSlideTemplateFromBracketSuffix(contentText) ??
        parseSlideTemplateFromEnrichedProse(contentText)
    );
}

/**
 * @param {string} contentText
 * @param {unknown} meta
 * @param {{ template_id: string, label: string } | null} [tpl]
 */
function resolveUserMessageDisplayText(contentText, meta, tpl = null) {
    const hit = tpl ?? resolveSlideTemplateFromMessage(contentText, meta);
    let text = stripSlideTemplateMetaSuffix(contentText);
    if (hit && isVagueTemplateComposerBody(text, hit.label)) {
        text = '';
    }
    const attachments = parseMessageAttachmentManifest(meta);
    if (attachments.length) {
        const trimmed = text.trim();
        const genericAttachmentSend =
            trimmed === 'Please read the attached file(s) and respond helpfully.' ||
            trimmed === oaaoChatT(
                'chat.attachment.default_send_prompt',
                'Please read the attached file(s) and respond helpfully.',
            );
        if (genericAttachmentSend) {
            text = '';
        }
    }
    return text;
}

/**
 * @param {{ file_name?: string, mime_type?: string, kind?: string }} att
 * @returns {string}
 */
function resolveChatAttachmentKind(att) {
    const kind = String(att?.kind ?? '').trim().toLowerCase();
    if (kind && kind !== 'other') return kind;
    const name = String(att?.file_name ?? '').trim().toLowerCase();
    const mime = String(att?.mime_type ?? '').trim().toLowerCase();
    if (name.endsWith('.pdf') || mime.includes('pdf')) return 'pdf';
    if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/.test(name)) return 'image';
    if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac)$/.test(name)) return 'audio';
    if (
        mime.startsWith('text/') ||
        mime.includes('json') ||
        /\.(txt|md|markdown|json|csv|log|xml|html?|yaml|yml|toml|ini|env)$/.test(name)
    ) {
        return 'text';
    }
    return 'other';
}

/**
 * @param {string} kind
 * @returns {string}
 */
function chatAttachmentKindIconClass(kind) {
    const k = String(kind ?? '').toLowerCase();
    if (k === 'pdf') return 'ri-file-pdf-line';
    if (k === 'text') return 'ri-file-text-line';
    if (k === 'image') return 'ri-image-line';
    if (k === 'audio') return 'ri-mic-line';
    return 'ri-attachment-2';
}

/**
 * @param {string} kind
 * @returns {string}
 */
function chatAttachmentKindLabel(kind) {
    const k = String(kind ?? '').toLowerCase();
    if (k === 'text') return oaaoChatT('chat.attachment.kind.text', 'Plain Text');
    if (k === 'pdf') return oaaoChatT('chat.attachment.kind.pdf', 'PDF');
    if (k === 'image') return oaaoChatT('chat.attachment.kind.image', 'Image');
    if (k === 'audio') return oaaoChatT('chat.attachment.kind.audio', 'Audio');
    return oaaoChatT('chat.attachment.kind.file', 'File');
}

/**
 * @param {{ file_name: string, mime_type?: string, kind?: string, byte_size?: number, disposed?: boolean }} att
 * @param {(() => void) | null} [onRemove]
 * @param {{ readOnly?: boolean, variant?: 'composer' | 'history' }} [opts]
 */
function createAttachmentCardNode(att, onRemove, opts = {}) {
    const readOnly = opts.readOnly === true;
    const label = String(att.file_name ?? 'attachment').trim() || 'attachment';
    const kind = resolveChatAttachmentKind(att);
    const disposed = att.disposed !== false;
    const kindLabel = chatAttachmentKindLabel(kind);

    const card = document.createElement('div');
    card.className = 'oaao-chat-attachment-card';
    card.setAttribute('role', 'group');
    card.title = disposed
        ? `${label} (${oaaoChatT('chat.attachment.disposed_hint', 'processed for this turn only')})`
        : label;

    const iconBox = document.createElement('span');
    iconBox.className = 'oaao-chat-attachment-card-icon';
    iconBox.setAttribute('aria-hidden', 'true');
    iconBox.append(buildChatAttachmentKindIconSvg(kind, 'w-[18px] h-[18px]'));

    const body = document.createElement('div');
    body.className = 'oaao-chat-attachment-card-body min-w-0';

    const nameEl = document.createElement('div');
    nameEl.className = 'oaao-chat-attachment-card-name truncate';
    nameEl.textContent = label;

    const kindEl = document.createElement('div');
    kindEl.className = 'oaao-chat-attachment-card-kind truncate';
    kindEl.textContent = kindLabel;

    body.append(nameEl, kindEl);
    card.append(iconBox, body);

    if (!readOnly && typeof onRemove === 'function') {
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'oaao-chat-attachment-card-dismiss';
        dismiss.setAttribute('aria-label', oaaoChatT('chat.attachment.remove', 'Remove attachment'));
        dismiss.append(createComposerCloseIconSvg());
        dismiss.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onRemove();
        });
        card.append(dismiss);
    }

    return card;
}

/**
 * @param {HTMLElement} mount
 */
function renderChatComposerAttachmentChips(mount) {
    const host = mount.querySelector('[data-oaao-chat="composer-attachment-stack"]');
    if (!(host instanceof HTMLElement)) return;
    host.replaceChildren();
    if (!chatComposerAttachments.length) {
        host.classList.add('hidden');
        return;
    }
    host.classList.remove('hidden');
    for (const att of chatComposerAttachments) {
        host.append(
            createAttachmentCardNode(att, () => {
                chatComposerAttachments = chatComposerAttachments.filter((row) => row.id !== att.id);
                renderChatComposerAttachmentChips(mount);
                if (typeof mount.__oaaoUpdateChatLayout === 'function') {
                    mount.__oaaoUpdateChatLayout();
                }
            }),
        );
    }
}

/**
 * @param {unknown} meta
 * @returns {Array<{ file_name: string, mime_type: string, kind: string, byte_size: number, disposed: boolean }>}
 */
function parseMessageAttachmentManifest(meta) {
    if (!meta || typeof meta !== 'object') return [];
    const raw = /** @type {Record<string, unknown>} */ (meta).attachments;
    if (!Array.isArray(raw)) return [];
    /** @type {Array<{ file_name: string, mime_type: string, kind: string, byte_size: number, disposed: boolean }>} */
    const out = [];
    for (const row of raw) {
        if (typeof row === 'number' && row > 0) {
            out.push({
                file_name: `Attachment #${row}`,
                mime_type: '',
                kind: 'other',
                byte_size: 0,
                disposed: true,
            });
            continue;
        }
        if (!row || typeof row !== 'object') continue;
        const o = /** @type {Record<string, unknown>} */ (row);
        out.push({
            file_name: String(o.file_name ?? 'attachment'),
            mime_type: String(o.mime_type ?? ''),
            kind: String(o.kind ?? 'other'),
            byte_size: Number(o.byte_size ?? 0),
            disposed: o.disposed !== false,
        });
    }
    return out;
}

/**
 * @param {Array<{ file_name: string, mime_type?: string, kind?: string, byte_size?: number, disposed?: boolean }>} attachments
 */
function createUserMessageAttachmentCardsBlock(attachments) {
    const block = document.createElement('div');
    block.className =
        'oaao-chat-user-msg-attachments flex flex-col items-end gap-2 w-full max-w-[min(100%,20rem)] min-w-0';
    for (const att of attachments) {
        block.append(createAttachmentCardNode(att, null, { readOnly: true, variant: 'history' }));
    }
    return block;
}

/**
 * @param {{ template_id: string, label: string, thumb_url?: string }} tpl
 */
function createUserMessageTemplateRefsRow(tpl) {
    const refs = document.createElement('div');
    refs.className =
        'oaao-chat-user-msg-refs flex flex-row flex-wrap items-center justify-end gap-1.5 max-w-full min-w-0';

    const icon = document.createElement('span');
    icon.className =
        'oaao-chat-user-msg-ref-icon inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-full border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] fg-[var(--grid-ink-muted)]';
    icon.setAttribute('aria-hidden', 'true');
    icon.title = oaaoChatT('chat.template.ref_icon_title', 'Slide template');
    void mountRuiIcon(icon, OAAO_RUI_ICON_TEMPLATE, { size: 14 });

    refs.append(icon, createTemplateSlugNode(tpl, null, { readOnly: true }));
    return refs;
}

/**
 * @param {HTMLElement} bubble
 * @param {string} text
 */
function mountUserMessageBubbleText(bubble, text) {
    bubble.replaceChildren();
    bubble.classList.remove('oaao-md-bubble');
    bubble.style.whiteSpace = 'pre-wrap';
    bubble.textContent = text;
}

/**
 * @param {string} contentText
 * @param {unknown} meta
 */
function formatUserMessageCopyText(contentText, meta) {
    const tpl =
        parseSlideTemplateFromMessageMeta(meta) ??
        parseSlideTemplateFromBracketSuffix(contentText) ??
        parseSlideTemplateFromEnrichedProse(contentText);
    let text = stripSlideTemplateMetaSuffix(contentText);
    if (tpl && isVagueTemplateComposerBody(text, tpl.label)) {
        text = '';
    }
    const attachments = parseMessageAttachmentManifest(meta);
    const attLines = attachments.map((a) => a.file_name).filter(Boolean);
    const parts = [];
    if (tpl) parts.push(tpl.label);
    if (attLines.length) parts.push(attLines.join(', '));
    if (text) parts.push(text);
    if (parts.length) return parts.join('\n');
    return text || contentText;
}

function readChatPendingSlideTemplateFromStorage() {
    try {
        const raw = sessionStorage.getItem(CHAT_PENDING_SLIDE_TEMPLATE_KEY) ?? '';
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const tid = String(parsed.template_id ?? '').trim();
        if (!tid) return null;
        return {
            template_id: tid,
            label: String(parsed.label ?? tid).trim() || tid,
            thumb_url: String(parsed.thumb_url ?? '').trim() || undefined,
        };
    } catch {
        return null;
    }
}

/**
 * @param {HTMLElement} mount
 */
function restoreChatPendingSlideTemplateFromStorage(mount) {
    const pending = readChatPendingSlideTemplateFromStorage();
    if (!pending) return;
    if (chatComposerActiveSlideTemplate?.template_id === pending.template_id) {
        renderChatComposerActiveTemplateChip(mount);
        return;
    }
    applyTemplateToComposer(mount, pending);
    if (!chatComposerActiveSlideTemplate?.thumb_url) {
        void hydrateChatComposerTemplateThumb(mount, pending.template_id);
    }
}

/**
 * @param {string} templateId
 * @param {string} [label]
 * @param {string} [thumbUrl]
 */
function setChatComposerActiveSlideTemplate(templateId, label, thumbUrl) {
    const tid = String(templateId ?? '').trim();
    if (!tid) return;
    chatComposerActiveSlideTemplate = {
        template_id: tid,
        label: String(label ?? '').trim() || tid,
        thumb_url: String(thumbUrl ?? '').trim() || undefined,
    };
    try {
        sessionStorage.setItem(
            CHAT_PENDING_SLIDE_TEMPLATE_KEY,
            JSON.stringify({
                template_id: tid,
                label: chatComposerActiveSlideTemplate.label,
                thumb_url: chatComposerActiveSlideTemplate.thumb_url ?? '',
            }),
        );
    } catch {
        /* ignore */
    }
    const mount = resolveChatComposerMountEl();
    if (mount instanceof HTMLElement) {
        applyTemplateToComposer(mount, {
            template_id: tid,
            label: chatComposerActiveSlideTemplate.label,
            thumb_url: chatComposerActiveSlideTemplate.thumb_url,
        });
        if (!chatComposerActiveSlideTemplate.thumb_url) {
            void hydrateChatComposerTemplateThumb(mount, tid);
        }
    } else {
        syncChatComposerChips(document.getElementById('workspace-module-mount') ?? document.body);
    }
}

/**
 * @param {HTMLElement} mount
 * @param {string} templateId
 */
async function hydrateChatComposerTemplateThumb(mount, templateId) {
    if (!chatComposerActiveSlideTemplate || chatComposerActiveSlideTemplate.template_id !== templateId) {
        return;
    }
    try {
        const api = await loadChatSlideTemplateApi();
        const row = await api.fetchTemplateRow(templateId);
        if (!row || !chatComposerActiveSlideTemplate) return;
        const url = api.templateThumbUrl(row);
        if (!url) return;
        chatComposerActiveSlideTemplate.thumb_url = url;
        if (!chatComposerActiveSlideTemplate.label) {
            chatComposerActiveSlideTemplate.label = api.templateDisplayLabel(
                templateId,
                String(row.label ?? templateId),
            );
        }
        renderChatComposerActiveTemplateChip(mount);
    } catch {
        /* optional thumb */
    }
}

/**
 * @param {string} materialId
 * @param {string} [title]
 */
function setChatComposerActiveMaterial(materialId, title) {
    const mid = String(materialId ?? '').trim();
    if (!mid) return;
    chatComposerActiveMaterial = {
        material_id: mid,
        title: String(title ?? '').trim() || 'Slide deck',
    };
    const root = document.querySelector('.oaao-chat-root');
    const mount =
        root instanceof HTMLElement
            ? root.closest('#workspace-module-mount') ?? root
            : resolveChatComposerMountEl();
    if (mount instanceof HTMLElement) {
        syncChatComposerChips(mount);
        const input = mount.querySelector('[data-oaao-chat="input"]');
        if (isChatComposerEditorEl(input)) focusChatComposerEditor(input);
    }
    if (activeConversationId && activeConversationId > 0) {
        persistConversationDeskMode(activeConversationId);
        refreshChatComposerSlideDeckContext(activeConversationId);
        const m = resolveChatComposerMountEl();
        if (m instanceof HTMLElement) syncComposerSlideDeckMode(m);
    }
}

/**
 * @param {HTMLElement | Document} root
 * @param {number} conversationId
 */
function persistOaaoTaskListStrip(root, conversationId) {
    const state = getOaaoTaskListStateForConversation(conversationId);
    if (!state || state.items.size < 1) return;
    const host = resolveOaaoTaskStepsHost(root, conversationId);
    const panel = getOaaoTaskPanelChrome(root).panel;
    const collapsedSide = panel?.classList.contains('oaao-chat-task-panel--steps-collapsed');
    const payload = buildOaaoTasksPersistPayload(state, {
        collapsed:
            collapsedSide === true ||
            (host instanceof HTMLElement && host.classList.contains('oaao-task-list-strip--collapsed')),
        panelView: state.panelView === 'agents' ? 'agents' : 'steps',
    });
    if (host instanceof HTMLElement) {
        host.dataset.oaaoTaskListConv = String(conversationId);
    }
    try {
        sessionStorage.setItem(`${OAAO_TASK_LIST_SS_PREFIX}${conversationId}`, JSON.stringify(payload));
    } catch {
        /* quota */
    }
}

/**
 * Paint checklist state onto the visible thread for one conversation.
 *
 * @param {HTMLElement | Document} root
 * @param {number} conversationId
 * @param {OaaoTaskListState} state
 */
function renderOaaoTaskListForConversation(root, conversationId, state) {
    if (!chatComposerShowPlannerSteps) {
        syncComposerPlannerStepsVisibility(root);
        return;
    }
    if (!conversationId || conversationId !== activeConversationId || state.items.size < 1) {
        return;
    }
    const host = resolveOaaoTaskStepsHost(root, conversationId);
    if (!host) return;
    host.dataset.oaaoTaskListConv = String(conversationId);
    oaaoTaskListStateByHost.set(host, state);
    if (isOaaoInlineTaskStepsHost(host)) {
        if (host.querySelector('.oaao-chat-inline-task-steps-inner')) {
            patchOaaoInlineTaskStepsFromState(host, state);
        } else {
            renderOaaoInlineTaskStepsFromState(host, state);
        }
        applyOaaoTaskPanelI18n(document);
        return;
    }
    renderOaaoTaskListStripFromState(host, state);
}

/**
 * @param {HTMLElement | Document} root
 * @param {Record<string, unknown>} data
 * @param {number} conversationId
 */
function applyStreamTaskPipelineEnvelope(root, data, conversationId) {
    const p = data?.payload;
    if (!p || typeof p !== 'object') return;
    const payload = /** @type {Record<string, unknown>} */ (p);

    let state = getOaaoTaskListStateForConversation(conversationId);

    const runTiming = payload.run_timing;
    if (runTiming && typeof runTiming === 'object') {
        const rto = /** @type {Record<string, unknown>} */ (runTiming);
        const rid = String(rto.run_task_id ?? '').trim();
        const dm = Number(rto.duration_ms);
        if (rid && Number.isFinite(dm) && dm >= 0) {
            const workerParentId = oaaoSlideWorkersParentIdForRunTask(rid);
            if (workerParentId) {
                const parent = state.items.get(workerParentId);
                if (parent) {
                    upsertOaaoAgentTaskOnItem(
                        parent,
                        { id: rid, title: rid, status: String(rto.status ?? 'done'), duration_ms: dm },
                        { workerRowId: rid },
                    );
                    state.items.set(workerParentId, parent);
                }
            } else {
                const item = state.items.get(rid) || {
                    id: rid,
                    title: String(rid),
                    status: 'pending',
                    agent_tasks: [],
                };
                item.duration_ms = dm;
                state.items.set(rid, item);
            }
        }
    }

    const rt = payload.run_task;
    if (rt && typeof rt === 'object') {
        const rto = /** @type {Record<string, unknown>} */ (rt);
        const rid = String(rto.id ?? '').trim();
        if (rid) {
            const workerParentId = oaaoSlideWorkersParentIdForRunTask(rid);
            if (workerParentId) {
                const parent = state.items.get(workerParentId) || {
                    id: workerParentId,
                    title: 'Build slide pages',
                    status: 'pending',
                    agent_kind: 'slide_designer',
                    slide_workers: true,
                    parallel_ok: true,
                    agent_tasks: [],
                };
                parent.slide_workers = true;
                const existingWorker = parent.agent_tasks?.find((t) => t.id === rid);
                upsertOaaoAgentTaskOnItem(
                    parent,
                    {
                        id: rid,
                        title: existingWorker?.title ?? String(rto.title ?? rid),
                        status: String(rto.status ?? 'pending'),
                    },
                    { workerRowId: rid },
                );
                const workers = parent.agent_tasks ?? [];
                parent.status = oaaoAggregateWorkerStatuses(workers);
                if (parent.status === 'active' || parent.status === 'running') {
                    parent.status = 'active';
                }
                state.items.set(workerParentId, parent);
            } else {
                const item = state.items.get(rid) || {
                    id: rid,
                    title: String(rto.title ?? '—'),
                    status: 'pending',
                    agent_tasks: [],
                };
                if (rto.title) item.title = String(rto.title);
                if (rto.status) item.status = mergeOaaoTaskItemStatus(item.status, String(rto.status));
                if (rto.agent_kind) item.agent_kind = String(rto.agent_kind);
                if (rto.duration_ms != null) {
                    const dm = Number(rto.duration_ms);
                    if (Number.isFinite(dm) && dm >= 0) item.duration_ms = dm;
                }
                finalizeAgentSubtasksWhenParentTerminal(item);
                state.items.set(rid, item);
            }
        }
    }

    const agentAsk = payload.agent_ask;
    if (agentAsk && typeof agentAsk === 'object') {
        state = applyOaaoAgentAskPayload(
            state,
            /** @type {Record<string, unknown>} */ (agentAsk),
            conversationId,
        );
    }

    const agentTask = payload.agent_task;
    if (agentTask && typeof agentTask === 'object') {
        const ato = /** @type {Record<string, unknown>} */ (agentTask);
        const rid = String(ato.run_task_id ?? '').trim();
        if (rid) {
            const workerParentId = oaaoSlideWorkersParentIdForRunTask(rid);
            if (workerParentId) {
                const parent = state.items.get(workerParentId) || {
                    id: workerParentId,
                    title: 'Build slide pages',
                    status: 'active',
                    agent_kind: 'slide_designer',
                    slide_workers: true,
                    parallel_ok: true,
                    agent_tasks: [],
                };
                parent.slide_workers = true;
                const existing = parent.agent_tasks?.find((t) => t.id === rid);
                upsertOaaoAgentTaskOnItem(
                    parent,
                    {
                        ...ato,
                        title: existing?.title ?? String(ato.title ?? rid),
                        ...(ato.preview && typeof ato.preview === 'object'
                            ? { preview: /** @type {Record<string, unknown>} */ (ato.preview) }
                            : {}),
                    },
                    { workerRowId: rid },
                );
                const workers = parent.agent_tasks ?? [];
                parent.status = oaaoAggregateWorkerStatuses(workers);
                state.items.set(workerParentId, parent);
            } else {
                const item = state.items.get(rid) || {
                    id: rid,
                    title: String(payload.run_task && typeof payload.run_task === 'object'
                        ? /** @type {Record<string, unknown>} */ (payload.run_task).title
                        : '—'),
                    status: 'active',
                    agent_tasks: [],
                };
                if (item.status === 'pending') item.status = 'active';
                upsertOaaoAgentTaskOnItem(item, ato);
                finalizeAgentSubtasksWhenParentTerminal(item);
                state.items.set(rid, item);
            }
        }
    }

    const tasks = extractTasksPayloadFromEnvelope(data);
    if (tasks) {
        state = mergeOaaoTaskListPayload(tasks, state);
    }

    if (agentAsk && typeof agentAsk === 'object') {
        state = applyOaaoAgentAskPayload(
            state,
            /** @type {Record<string, unknown>} */ (agentAsk),
            conversationId,
        );
    }

    if (Array.isArray(payload.agent_tasks) && payload.agent_tasks.length) {
        const rid =
            rt && typeof rt === 'object'
                ? String(/** @type {Record<string, unknown>} */ (rt).id ?? '').trim()
                : '';
        if (rid && state.items.has(rid)) {
            const item = state.items.get(rid);
            if (item) {
                for (const raw of payload.agent_tasks) {
                    if (raw && typeof raw === 'object') {
                        upsertOaaoAgentTaskOnItem(item, /** @type {Record<string, unknown>} */ (raw));
                    }
                }
                state.items.set(rid, item);
            }
        }
    }

    for (const [id, item] of state.items) {
        if (!item.slide_workers || !item.agent_tasks?.length) continue;
        const rolled = oaaoAggregateWorkerStatuses(item.agent_tasks);
        const next = mergeOaaoTaskItemStatus(item.status, rolled);
        if (next !== item.status) {
            state.items.set(id, { ...item, status: next });
        }
    }

    finalizeAllOaaoTaskListSubtasks(state);

    setOaaoTaskListStateForConversation(conversationId, state);
    if (conversationId > 0) persistOaaoTaskListStrip(root, conversationId);

    const agentAskForMode =
        agentAsk && typeof agentAsk === 'object'
            ? /** @type {Record<string, unknown>} */ (agentAsk)
            : null;
    maybeEnterDeskModeFromTaskState(conversationId, state);

    if (state.items.size < 1) return;
    if (!chatComposerShowPlannerSteps) {
        syncComposerPlannerStepsVisibility(root);
        return;
    }

    const host = resolveOaaoTaskStepsHost(root, conversationId);
    if (!host) return;

    const agentOnly =
        agentTask &&
        typeof agentTask === 'object' &&
        !tasks &&
        !(rt && typeof rt === 'object');
    oaaoTaskListStateByHost.set(host, state);

    if (isOaaoInlineTaskStepsHost(host)) {
        if (host.querySelector('.oaao-chat-inline-task-steps-inner')) {
            patchOaaoInlineTaskStepsFromState(host, state);
        } else {
            renderOaaoInlineTaskStepsFromState(host, state);
        }
        applyOaaoTaskPanelI18n(document);
        if (conversationId > 0) persistOaaoTaskListStrip(root, conversationId);
        return;
    }

    if (agentOnly) {
        const ato = /** @type {Record<string, unknown>} */ (agentTask);
        const rid = String(ato.run_task_id ?? '').trim();
        const workerParentId = oaaoSlideWorkersParentIdForRunTask(rid);
        const patchId = workerParentId || rid;
        const item = patchId ? state.items.get(patchId) : undefined;
        if (item && patchOaaoTaskListRowAgentTasks(host, patchId, item)) {
            if (conversationId > 0) persistOaaoTaskListStrip(root, conversationId);
            return;
        }
    }

    renderOaaoTaskListStripFromState(host, state);

    const pipe = payload.oaao_pipeline;
    if (pipe && typeof pipe === 'object') {
        const sp = /** @type {Record<string, unknown>} */ (pipe).slide_project;
        const pid =
            sp && typeof sp === 'object'
                ? String(/** @type {Record<string, unknown>} */ (sp).project_id ?? '').trim()
                : '';
        if (pid) {
            void reconcileSlideWorkerTasksForConversation(root, conversationId, pid);
        }
    }

    if (conversationId > 0 && conversationId === activeConversationId) {
        const mount =
            root instanceof HTMLElement
                ? root.closest('[data-module="oaao-chat"]') ?? root
                : document.querySelector('[data-module="oaao-chat"]');
        if (mount instanceof HTMLElement) syncComposerBusyForActiveView(mount);
    }
}

/** @param {HTMLElement | Document} root @param {Record<string, unknown>} data @param {number} conversationId */
function applyStreamTaskListEnvelope(root, data, conversationId) {
    applyStreamTaskPipelineEnvelope(root, data, conversationId);
}

/**
 * @param {HTMLElement | Document} root
 * @param {number} conversationId
 */
function restoreOaaoTaskListStripForConversation(root, conversationId) {
    if (!conversationId || conversationId < 1) {
        clearOaaoTaskListStrip(root);

        return;
    }
    let raw;
    try {
        raw = sessionStorage.getItem(`${OAAO_TASK_LIST_SS_PREFIX}${conversationId}`);
    } catch {
        return;
    }
    if (!raw) {
        clearOaaoTaskListStrip(root);

        return;
    }
    try {
        const data = JSON.parse(raw);
        if (data?.items?.length) {
            const msgs = root.querySelector('[data-oaao-chat="messages"]');
            const assistNodes = msgs?.querySelectorAll('[data-oaao-msg-role="assistant"][data-oaao-msg-id]');
            const lastAssist = assistNodes?.[assistNodes.length - 1];
            const lastMsgId = lastAssist ? coercePositiveInt(lastAssist.getAttribute('data-oaao-msg-id')) : null;
            if (lastMsgId && lastMsgId > 0) {
                oaaoStreamAssistantMsgIdByConv.set(conversationId, lastMsgId);
            }
            const state = mergeOaaoTaskListPayload(data, createEmptyOaaoTaskListState());
            setOaaoTaskListStateForConversation(conversationId, state);
            renderOaaoTaskListForConversation(root, conversationId, state);
        } else {
            clearOaaoTaskListStrip(root);
        }
    } catch {
        clearOaaoTaskListStrip(root);
    }
}

/**
 * Bind checklist UI to one conversation — clears prior thread state, then restores meta or session.
 *
 * @param {HTMLElement | Document} root
 * @param {number | null} conversationId
 * @param {Array<Record<string, unknown>>} [messageRows]
 */
function bindOaaoTaskListStripToConversation(root, conversationId, messageRows = []) {
    clearOaaoTaskListStrip(root, false);
    if (!conversationId || conversationId < 1) {
        return;
    }
    const host = getOaaoTaskListStripHost(root);
    if (host) {
        host.dataset.oaaoTaskListConv = String(conversationId);
    }

    if (oaaoFreshRunByConv.has(conversationId)) {
        oaaoFreshRunByConv.delete(conversationId);
        return;
    }

    /** @type {{ items?: unknown[] } | null} */
    let metaTasks = null;
    if (Array.isArray(messageRows) && messageRows.length) {
        for (let i = messageRows.length - 1; i >= 0; i -= 1) {
            const m = messageRows[i];
            if (String(m.role ?? '').toLowerCase() !== 'assistant') continue;
            const meta = m.meta;
            if (!meta || typeof meta !== 'object') continue;
            const tasks = /** @type {Record<string, unknown>} */ (meta).tasks;
            if (tasks && typeof tasks === 'object' && Array.isArray(tasks.items) && tasks.items.length) {
                const mid = coercePositiveInt(m.id);
                if (mid && mid > 0) {
                    oaaoStreamAssistantMsgIdByConv.set(conversationId, mid);
                }
                metaTasks = /** @type {{ items?: unknown[] }} */ (tasks);
                break;
            }
        }
    }

    /** @type {{ items?: unknown[] } | null} */
    let sessionTasks = null;
    try {
        const raw = sessionStorage.getItem(`${OAAO_TASK_LIST_SS_PREFIX}${conversationId}`);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.items?.length) {
                sessionTasks = /** @type {{ items?: unknown[] }} */ (parsed);
            }
        }
    } catch {
        /* ignore */
    }

    const pick = pickBestTaskListSnapshot(sessionTasks, metaTasks);
    if (pick) {
        const state = mergeOaaoTaskListPayload(pick, createEmptyOaaoTaskListState());
        setOaaoTaskListStateForConversation(conversationId, state);
        renderOaaoTaskListForConversation(root, conversationId, state);
        void reconcileSlideWorkerTasksForConversation(root, conversationId);
        return;
    }

    restoreOaaoTaskListStripForConversation(root, conversationId);
}

/** @param {Record<string, unknown> | null | undefined} pipeline */
function pipelineChromeIsRenderable(pipeline) {
    if (!pipeline || typeof pipeline !== 'object') return false;
    const { before } = partitionPipelineBlocks(Array.isArray(pipeline.blocks) ? pipeline.blocks : []);

    return before.length > 0;
}

/** @type {WeakMap<HTMLElement, string>} */
const oaaoPipelineChromeKeyByOuter = new WeakMap();

/** @param {Record<string, unknown>} pipeline */
function pipelineSnapshotFingerprint(pipeline) {
    try {
        return JSON.stringify(pipeline);
    } catch {
        return String(Date.now());
    }
}

/** @param {HTMLElement} outer */
function removePipelineChrome(outer) {
    const chrome = outer.querySelector('[data-oaao-chat="pipeline-chrome"]');
    if (chrome) {
        const mh = chrome.querySelector('[data-oaao-chat="pipeline-milestone"]');
        if (mh) oaaoMilestoneCtlByHost.get(mh)?.destroy();
        chrome.remove();
    }
    outer.querySelector('[data-oaao-chat="pipeline-blocks"]')?.remove();
}

/**
 * Collapsible shell for milestone / rails / blocks — defaults {@code closed} so stub UI does not swamp the reply.
 *
 * @param {HTMLElement} chrome Root {@code data-oaao-chat="pipeline-chrome"}
 * @returns {HTMLElement} Inner host ({@code data-oaao-chat="pipeline-chrome-shell"})
 */
function getOrCreatePipelineChromeContentHost(chrome) {
    const legacyDetails = chrome.querySelector('details.oaao-chat-pipeline-details');
    if (legacyDetails && legacyDetails.dataset.oaaoPipelineUiRev !== OAAO_CHAT_SHELL_ASSET_REV) {
        legacyDetails.remove();
    }

    const existingShell = chrome.querySelector('[data-oaao-chat="pipeline-chrome-shell"]');
    if (existingShell instanceof HTMLDivElement) return existingShell;
    if (existingShell) existingShell.remove();

    const details = document.createElement('details');
    details.dataset.oaaoPipelineUiRev = OAAO_CHAT_SHELL_ASSET_REV;
    details.className =
        'oaao-chat-pipeline-details rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel)]/40 w-full min-w-0 max-w-full px-2 py-1 [box-sizing:border-box]';
    details.open = false;

    const summary = document.createElement('summary');
    summary.className =
        'oaao-chat-pipeline-details-summary cursor-pointer select-none flex flex-row items-center gap-2 list-none [&::-webkit-details-marker]:hidden text-[0.72rem] fw-semibold fg-[var(--grid-caption)] tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-[var(--grid-accent)]/30 rounded-[4px] w-full';

    const lab = document.createElement('span');
    lab.className = 'oaao-chat-pipeline-details-label flex-1 min-w-0';
    lab.textContent = 'Pipeline';

    summary.append(
        lab,
        createPipelineRzIcon('ri-arrow-down-s-line oaao-chat-pipeline-details-chevron'),
    );

    const shell = document.createElement('div');
    shell.dataset.oaaoChat = 'pipeline-chrome-shell';
    shell.className =
        'flex flex-col gap-1 w-full min-w-0 max-w-full pt-1.5 mt-1 border-t-[1px] border-solid border-[var(--grid-line)]/40';

    for (const node of [...chrome.childNodes]) {
        shell.append(node);
    }

    details.append(summary, shell);
    chrome.append(details);

    return shell;
}

/** @param {string} text @param {number} [maxLen] */
function flattenPipelineLine(text, maxLen = 88) {
    const flat = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    if (flat.length <= maxLen) return flat;

    return `${flat.slice(0, maxLen - 1)}…`;
}

/** @param {string} badge */
function formatPipelineRailBadge(badge) {
    const raw = String(badge ?? '').trim();
    if (!raw) return '';
    const locale = typeof document !== 'undefined' ? document.documentElement.lang || 'en' : 'en';
    const isZh = /^zh/i.test(locale);
    if (!isZh) return raw;

    const vaultPassages = raw.match(/vault\s*·\s*passages?\s*\((\d+)\)/i);
    if (vaultPassages) return `知識已調取(${vaultPassages[1]})`;
    const passages = raw.match(/(\d+)\s*passages?/i);
    if (passages) return `知識已調取(${passages[1]})`;
    if (/no matches/i.test(raw)) return '未找到相關段落';
    if (/knowledge retrieved/i.test(raw)) {
        const n = raw.match(/\((\d+)\)/);

        return n ? `知識已調取(${n[1]})` : '知識已調取';
    }
    if (/vault/i.test(raw) && /retriev/i.test(raw)) return '保管庫檢索';

    return raw;
}

/** @param {string} badge */
function pipelineRailLeadingIconClass(badge) {
    const b = String(badge ?? '').toLowerCase();
    if (/知識|knowledge|vault|passage|rag|retrieve|調取/.test(b)) return 'ri-lightbulb-line';
    if (/search|web/.test(b)) return 'ri-search-line';
    if (/planner|routing|plan|outline/.test(b)) return 'ri-guide-line';
    if (/sandbox|export|tool|file/.test(b)) return 'ri-tools-line';
    if (/attachment|extract|ocr/.test(b)) return 'ri-attachment-2';

    return 'ri-sparkling-line';
}

/** @param {string} className */
function createPipelineRzIcon(className) {
    const ic = document.createElement('i');
    ic.className = `${className} rz-icon shrink-0`;
    ic.setAttribute('aria-hidden', 'true');

    return ic;
}

/**
 * Vertical agent pipeline — vault RAG / planner / tools (management-briefing reference layout).
 *
 * @param {HTMLElement} host
 * @param {unknown} steps
 */
function renderCompactPipelineSteps(host, steps) {
    host.replaceChildren();
    if (!Array.isArray(steps) || steps.length === 0) return;

    const root = document.createElement('div');
    root.className = 'oaao-chat-pipeline-steps';

    steps.forEach((item, idx) => {
        const o = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {};
        const title = String(o.title ?? `Step ${idx + 1}`).trim();
        const description = String(o.description ?? '').trim();
        const taskLabel = String(o.task_label ?? o.task ?? '').trim();
        const state = String(o.state ?? '').toLowerCase();
        const completed = state === 'completed' || state === 'done' || o.completed === true;
        const active = state === 'active' || state === 'running';
        const error = state === 'error' || o.error === true;
        const rail = o.rail && typeof o.rail === 'object' ? /** @type {Record<string, unknown>} */ (o.rail) : null;
        const badgeRaw = rail ? String(rail.badge ?? '').trim() : '';
        const badge = formatPipelineRailBadge(badgeRaw);
        const lines =
            rail && Array.isArray(rail.detail_lines)
                ? rail.detail_lines.filter((x) => typeof x === 'string' && x.trim())
                : [];

        const row = document.createElement('div');
        row.className = 'oaao-chat-pipeline-step';

        const mark = document.createElement('span');
        mark.className = 'oaao-chat-pipeline-step-marker';
        if (error) mark.classList.add('is-error');
        else if (completed) mark.classList.add('is-done');
        else if (active) mark.classList.add('is-active');
        mark.setAttribute('aria-hidden', 'true');
        if (error) {
            mark.append(createPipelineRzIcon('ri-close-line'));
        } else if (completed) {
            mark.append(createPipelineRzIcon('ri-check-line'));
        } else if (active) {
            mark.append(createPipelineRzIcon('ri-loader-4-line oaao-chat-pipeline-step-spinner'));
        }

        const body = document.createElement('div');
        body.className = 'oaao-chat-pipeline-step-body';

        const titleEl = document.createElement('div');
        titleEl.className = 'oaao-chat-pipeline-step-title';
        titleEl.textContent = title;
        body.append(titleEl);

        if (badge) {
            const railDetails = document.createElement('details');
            railDetails.className = 'oaao-chat-pipeline-rail';

            const summary = document.createElement('summary');
            summary.className = 'oaao-chat-pipeline-rail-summary';
            summary.append(createPipelineRzIcon(`${pipelineRailLeadingIconClass(badgeRaw)} oaao-chat-pipeline-rail-lead`));
            const badgeLabel = document.createElement('span');
            badgeLabel.className = 'oaao-chat-pipeline-rail-label';
            badgeLabel.textContent = badge;
            summary.append(badgeLabel);
            summary.append(createPipelineRzIcon('ri-arrow-down-s-line oaao-chat-pipeline-rail-chevron'));
            railDetails.append(summary);

            if (lines.length > 0) {
                const ul = document.createElement('ul');
                ul.className = 'oaao-chat-pipeline-rail-lines';
                for (const ln of lines.slice(0, 8)) {
                    const li = document.createElement('li');
                    li.textContent = flattenPipelineLine(ln, 120);
                    ul.append(li);
                }
                if (lines.length > 8) {
                    const li = document.createElement('li');
                    li.className = 'oaao-chat-pipeline-rail-more';
                    li.textContent = `+${lines.length - 8} more`;
                    ul.append(li);
                }
                railDetails.append(ul);
            }

            body.append(railDetails);
        }

        if (description) {
            const desc = document.createElement('p');
            desc.className = 'oaao-chat-pipeline-step-desc';
            desc.textContent = description;
            body.append(desc);
        }

        if (taskLabel) {
            const task = document.createElement('div');
            task.className = 'oaao-chat-pipeline-task';
            task.append(createPipelineRzIcon('ri-file-edit-line oaao-chat-pipeline-task-icon'));
            const taskText = document.createElement('span');
            taskText.className = 'oaao-chat-pipeline-task-text';
            taskText.textContent = taskLabel;
            task.append(taskText);
            body.append(task);
        }

        row.append(mark, body);
        root.append(row);
    });

    host.append(root);
}

function formatPipelineBytes(n) {
    const num = typeof n === 'number' && Number.isFinite(n) ? n : Number(n);
    if (!Number.isFinite(num) || num < 0) return '';
    if (num < 1024) return `${Math.round(num)} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;

    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

async function fetchTaskArtifactsSummary(conversationId, taskId) {
    const { res, data } = await chatFetchJson(
        chatApiUrl('task_artifacts', {
            conversation_id: String(conversationId),
            task_id: taskId,
            ...workspaceChatQueryParams(),
        }),
    );
    if (!res.ok || !data.success) {
        toastOaao(typeof data.message === 'string' ? data.message : 'Could not load task files');

        return;
    }
    const arts = Array.isArray(data.artifacts) ? data.artifacts : [];
    const lines = arts.map((a) => {
        const o = a && typeof a === 'object' ? /** @type {Record<string, unknown>} */ (a) : {};
        const nm = String(o.name ?? 'file');
        const sz = formatPipelineBytes(o.size_bytes);

        return sz ? `${nm} (${sz})` : nm;
    });
    toastOaao(lines.length ? lines.join('\n') : 'No files for this task.');
}

/** @type {Map<string, Promise<{ renderRagCitationsBlock?: (wrap: HTMLElement, block: Record<string, unknown>) => void }>>} */
const pipelineBlockModuleByUrl = new Map();

/**
 * Registry default zone for {@code kind: message_block} rows ({@code extras.message_zone}).
 *
 * @param {string} blockType
 * @returns {'before' | 'after'}
 */
function messageBlockZoneFromRegistry(blockType) {
    const reg = Array.isArray(globalThis.OAAO_CHAT_PIPELINE_REGISTRY)
        ? globalThis.OAAO_CHAT_PIPELINE_REGISTRY
        : [];
    for (const row of reg) {
        if (!row || typeof row !== 'object') continue;
        if (String(row.kind) !== 'message_block') continue;
        if (String(row.block_type ?? '') !== blockType) continue;
        const zone = String(row.message_zone ?? 'before').trim().toLowerCase();

        return zone === 'after' ? 'after' : 'before';
    }

    return 'before';
}

/**
 * @param {Record<string, unknown>} block
 * @returns {'before' | 'after'}
 */
function resolvePipelineBlockZone(block) {
    const explicit = String(block.zone ?? '').trim().toLowerCase();
    if (explicit === 'after' || explicit === 'before') return explicit;

    return messageBlockZoneFromRegistry(String(block.type ?? '').trim());
}

/**
 * @param {unknown} blocks
 * @returns {{ before: Record<string, unknown>[], after: Record<string, unknown>[] }}
 */
/**
 * Ephemeral composer uploads — shown on the user bubble, not as assistant tail citations.
 *
 * @param {Record<string, unknown>} block
 */
function isEphemeralChatAttachmentCitationBlock(block) {
    const type = String(block.type ?? '').trim();
    if (type !== 'rag_citations') return false;
    const props =
        block.props && typeof block.props === 'object' ? /** @type {Record<string, unknown>} */ (block.props) : {};
    const refs = Array.isArray(props.references) ? props.references : [];
    if (!refs.length) return false;

    return refs.every((raw) => {
        const row = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
        const vaultId = Number(row.vault_id ?? 0);
        const documentId = Number(row.document_id ?? 0);

        return vaultId === 0 && documentId === 0;
    });
}

/** Metadata-only blocks for inline citation pills — not rendered as pipeline chrome. */
function isInlineCitationMetadataBlock(block) {
    const type = String(block.type ?? '').trim();
    if (type === 'attachment_citations') return true;
    const zone = String(block.zone ?? '').trim().toLowerCase();
    return zone === 'inline';
}

/** Numbered inline cites use popover pills — skip the redundant REFERENCES list. */
function isRedundantRagCitationsAfterBlock(block) {
    const type = String(block.type ?? '').trim();
    if (type !== 'rag_citations') return false;
    const props =
        block.props && typeof block.props === 'object' ? /** @type {Record<string, unknown>} */ (block.props) : {};
    if (props.inline === true) return true;
    const refs = Array.isArray(props.references) ? props.references : [];
    return refs.some((raw) => {
        const row = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
        const idx = Number(row.cite_index ?? 0);
        return Number.isFinite(idx) && idx > 0;
    });
}

function partitionPipelineBlocks(blocks) {
    /** @type {Record<string, unknown>[]} */
    const before = [];
    /** @type {Record<string, unknown>[]} */
    const after = [];
    if (!Array.isArray(blocks)) return { before, after };
    for (const raw of blocks) {
        const b = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
        if (isEphemeralChatAttachmentCitationBlock(b)) continue;
        if (isInlineCitationMetadataBlock(b)) continue;
        if (isRedundantRagCitationsAfterBlock(b)) continue;
        if (resolvePipelineBlockZone(b) === 'after') after.push(b);
        else if (resolvePipelineBlockZone(b) === 'before') before.push(b);
    }

    return { before, after };
}

/**
 * @param {string} esmUrl
 */
function loadPipelineBlockModule(esmUrl) {
    const key = esmUrl.trim();
    if (!key) return Promise.resolve(null);
    let pending = pipelineBlockModuleByUrl.get(key);
    if (!pending) {
        const url = oaaoPrefixedSitePath(key.startsWith('/') ? key : `/${key}`);
        pending = import(/* webpackIgnore: true */ url).catch(() => null);
        pipelineBlockModuleByUrl.set(key, pending);
    }

    return pending;
}

/**
 * @param {string} blockType
 * @returns {string}
 */
function pipelineBlockEsmFromRegistry(blockType) {
    const reg = Array.isArray(globalThis.OAAO_CHAT_PIPELINE_REGISTRY)
        ? globalThis.OAAO_CHAT_PIPELINE_REGISTRY
        : [];
    for (const row of reg) {
        if (!row || typeof row !== 'object') continue;
        if (String(row.block_type ?? '') !== blockType) continue;
        const esm = String(row.esm_url ?? '').trim();

        return esm;
    }

    return '';
}

/**
 * @param {HTMLElement} outer
 * @param {number} conversationId
 * @returns {{ conversationId: number, messageId: number }}
 */
function resolvePipelineRenderContext(outer, conversationId) {
    const bubble = outer?.querySelector?.('[data-oaao-msg-role="assistant"]');
    const rawId = bubble instanceof HTMLElement ? bubble.dataset.oaaoMsgId : '';
    const messageId = rawId ? Number(rawId) : 0;

    return {
        conversationId: conversationId > 0 ? conversationId : 0,
        messageId: Number.isFinite(messageId) && messageId > 0 ? Math.floor(messageId) : 0,
    };
}

/**
 * @param {HTMLElement} wrap
 * @param {Record<string, unknown>} block
 * @param {number} conversationId
 * @param {{ conversationId?: number, messageId?: number }} [pipelineCtx]
 */
async function renderSinglePipelineBlock(wrap, block, conversationId, pipelineCtx = {}) {
    const type = String(block.type ?? '').trim();
    if (type === 'artifact_card') {
        const props = block.props && typeof block.props === 'object' ? /** @type {Record<string, unknown>} */ (block.props) : {};
        const card = document.createElement('div');
        card.className =
            'rounded-[12px] border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-md py-sm shadow-[var(--oaao-surface-shadow)] flex flex-row gap-3 items-start max-w-full min-w-0';
        const badge = document.createElement('div');
        badge.className =
            'shrink-0 rounded-md px-2 py-1 text-[0.65rem] fw-semibold bg-[var(--grid-line)]/35 fg-[var(--grid-ink-muted)]';
        badge.textContent = String(props.badge ?? 'FILE');
        const body = document.createElement('div');
        body.className = 'min-w-0 flex-1 flex flex-col gap-0.5';
        const t = document.createElement('div');
        t.className = 'text-[0.875rem] fw-semibold fg-[var(--grid-ink)] truncate';
        t.textContent = String(block.title ?? props.filename ?? 'Attachment');
        const sub = document.createElement('div');
        sub.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)]';
        const fn = String(props.filename ?? '');
        const sz = formatPipelineBytes(props.size_bytes);
        sub.textContent = [fn, sz].filter(Boolean).join(' · ');
        body.append(t, sub);
        card.append(badge, body);
        wrap.append(card);

        return;
    }
    if (type === 'task_files_cta') {
        const props = block.props && typeof block.props === 'object' ? /** @type {Record<string, unknown>} */ (block.props) : {};
        const tid = String(props.task_id ?? '').trim();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'text-left rounded-[12px] border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-md py-sm text-[0.8125rem] fg-[var(--grid-accent)] fw-medium hover:bg-[var(--grid-panel)] cursor-pointer font-inherit w-full max-w-full';
        btn.textContent = String(props.label ?? 'View all files in this task');
        if (!conversationId || conversationId < 1 || !tid) {
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            btn.addEventListener('click', () => void fetchTaskArtifactsSummary(conversationId, tid));
        }
        wrap.append(btn);

        return;
    }
    if (type === 'rag_citations') {
        const esm = pipelineBlockEsmFromRegistry('rag_citations');
        const mod = esm ? await loadPipelineBlockModule(esm) : null;
        if (mod && typeof mod.renderRagCitationsBlock === 'function') {
            mod.renderRagCitationsBlock(wrap, block);

            return;
        }
    }
    if (type === 'slide_preview_strip') {
        const esm = pipelineBlockEsmFromRegistry('slide_preview_strip');
        const mod = esm ? await loadPipelineBlockModule(esm) : null;
        if (mod && typeof mod.renderSlidePreviewStripBlock === 'function') {
            mod.renderSlidePreviewStripBlock(wrap, block, {
                conversationId: pipelineCtx.conversationId ?? conversationId,
                messageId: pipelineCtx.messageId ?? 0,
            });

            return;
        }
    }
}

/**
 * @param {HTMLElement} host
 * @param {unknown} blocks
 * @param {number} conversationId
 * @param {{ conversationId?: number, messageId?: number }} [pipelineCtx]
 */
async function renderPipelineBlocks(host, blocks, conversationId, pipelineCtx = {}) {
    host.replaceChildren();
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-1 w-full min-w-0 max-w-full';
    host.append(wrap);

    for (const raw of blocks) {
        const b = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
        await renderSinglePipelineBlock(wrap, b, conversationId, pipelineCtx);
    }
}

/**
 * @param {HTMLElement} host
 * @param {{ steps: Array<{ title: string, description?: string, icon?: string, error?: boolean }>, active: number }} opts
 */
async function mountMilestoneIntoHost(host, opts) {
    const prev = oaaoMilestoneCtlByHost.get(host);
    prev?.destroy();
    host.replaceChildren();

    const Milestone = await preloadOaaoMilestoneCtor();
    const ctl = new Milestone(host, {
        steps: opts.steps,
        active: opts.active,
        direction: 'vertical',
        small: false,
        clickable: false,
    }).getControl();

    oaaoMilestoneCtlByHost.set(host, ctl);
}

/**
 * @param {HTMLElement} outer
 * @param {HTMLElement} bubbleRef
 * @param {Record<string, unknown>} pipeline
 * @param {number} conversationId
 */
async function syncAssistantPipelineChrome(outer, bubbleRef, pipeline, conversationId) {
    const { before } = partitionPipelineBlocks(Array.isArray(pipeline.blocks) ? pipeline.blocks : []);
    removePipelineChrome(outer);
    if (!before.length) return;

    let blocksHost = outer.querySelector('[data-oaao-chat="pipeline-blocks"]');
    if (!(blocksHost instanceof HTMLElement)) {
        blocksHost = document.createElement('div');
        blocksHost.dataset.oaaoChat = 'pipeline-blocks';
        blocksHost.className = 'oaao-chat-pipeline-blocks w-full min-w-0 max-w-full';
        outer.insertBefore(blocksHost, bubbleRef);
    }

    const pipelineCtx = resolvePipelineRenderContext(outer, conversationId);
    await renderPipelineBlocks(blocksHost, before, conversationId, pipelineCtx);
}

/** @param {HTMLElement} outer */
function removeAssistantAfterBlocks(outer) {
    outer.querySelector('[data-oaao-chat="pipeline-after-blocks"]')?.remove();
}

/**
 * {@code message_zone: after} blocks — rendered below the assistant bubble ({@see cp.rag.citation_block}).
 *
 * @param {HTMLElement} outer
 * @param {HTMLElement} bubbleRef
 * @param {Record<string, unknown>[]} afterBlocks
 * @param {number} conversationId
 */
async function syncAssistantAfterBlocks(outer, bubbleRef, afterBlocks, conversationId) {
    if (!afterBlocks.length) {
        removeAssistantAfterBlocks(outer);

        return;
    }

    let host = outer.querySelector('[data-oaao-chat="pipeline-after-blocks"]');
    if (!host) {
        host = document.createElement('div');
        host.dataset.oaaoChat = 'pipeline-after-blocks';
        host.className = 'oaao-chat-pipeline-after w-full min-w-0 max-w-full';
        const toolbar = outer.querySelector('.oaao-chat-assistant-toolbar');
        if (toolbar) {
            outer.insertBefore(host, toolbar);
        } else {
            bubbleRef.insertAdjacentElement('afterend', host);
        }
    }

    const pipelineCtx = resolvePipelineRenderContext(outer, conversationId);
    await renderPipelineBlocks(/** @type {HTMLElement} */ (host), afterBlocks, conversationId, pipelineCtx);
}

/**
 * @param {HTMLElement} outer
 * @param {HTMLElement} bubbleRef
 * @param {Record<string, unknown>} pipeline
 * @param {number} conversationId
 */
function pipelineChromeNeedsDomUpgrade(outer) {
    const chrome = outer.querySelector('[data-oaao-chat="pipeline-chrome"]');
    if (!chrome) return false;

    if (!chrome.querySelector('.oaao-chat-pipeline-steps')) return true;

    const details = chrome.querySelector('details.oaao-chat-pipeline-details');
    if (details && details.dataset.oaaoPipelineUiRev !== OAAO_CHAT_SHELL_ASSET_REV) return true;

    const shell = chrome.querySelector('[data-oaao-chat="pipeline-chrome-shell"]');

    return Boolean(shell && shell.tagName !== 'DIV');
}

/**
 * @param {HTMLElement} outer
 * @param {HTMLElement} bubbleRef
 * @param {Record<string, unknown>} pipeline
 * @param {number} conversationId
 * @param {{ force?: boolean }} [opts] Bypass fingerprint cache (stream end / meta patch).
 */
async function syncAssistantMessageBlocks(outer, bubbleRef, pipeline, conversationId, opts = {}) {
    const { force = false } = opts;
    if (!pipeline || typeof pipeline !== 'object') {
        oaaoPipelineChromeKeyByOuter.delete(outer);
        removePipelineChrome(outer);
        removeAssistantAfterBlocks(outer);

        return;
    }

    if (pipelineChromeNeedsDomUpgrade(outer)) {
        oaaoPipelineChromeKeyByOuter.delete(outer);
        const chrome = outer.querySelector('[data-oaao-chat="pipeline-chrome"]');
        chrome?.replaceChildren();
    }

    const fp = pipelineSnapshotFingerprint(pipeline);
    const skipChrome = !force && oaaoPipelineChromeKeyByOuter.get(outer) === fp;

    if (!skipChrome) {
        oaaoPipelineChromeKeyByOuter.set(outer, fp);

        const allBlocks = Array.isArray(pipeline.blocks) ? pipeline.blocks : [];
        const { before, after } = partitionPipelineBlocks(allBlocks);
        const chromePipeline = { ...pipeline, blocks: before };

        if (pipelineChromeIsRenderable(chromePipeline)) {
            await syncAssistantPipelineChrome(outer, bubbleRef, chromePipeline, conversationId);
        } else {
            removePipelineChrome(outer);
        }

        await syncAssistantAfterBlocks(outer, bubbleRef, after, conversationId);
    }

    // Always refresh citation maps — chrome fingerprint may match while maps were never stashed.
    await stashInlineCitationMaps(outer, pipeline);
    if (bubbleRef instanceof HTMLElement) {
        await hydrateInlineCitesForBubble(bubbleRef);
    }
}

/**
 * @param {HTMLElement} mount
 * @param {HTMLElement} messagesEl
 */
async function maybeReplayPipelineFixture(mount, messagesEl) {
    const root = mount.querySelector('.oaao-chat-root');
    const ds = root instanceof HTMLElement && root.dataset.oaaoChatFixturePipeline === '1';
    const qs = new URLSearchParams(window.location.search).get('oaao_fixture_pipeline') === '1';
    if (!ds && !qs) return;

    try {
        const url = oaaoPrefixedSitePath('/webassets/chat/default/fixtures/pipeline-replay.json');
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return;
        /** @type {Record<string, unknown>} */
        const pipeline = await res.json();

        const outer = document.createElement('div');
        outer.className =
            'oaao-chat-assistant-row self-start flex flex-col gap-2 items-start w-full min-w-0 max-w-full';
        applyAssistantIdentityHeader(outer, { chat_profile: 'Pipeline fixture (offline)' });

        const bubble = document.createElement('div');
        bubble.dataset.oaaoMsgRole = 'assistant';
        bubble.className =
            'text-[0.875rem] leading-relaxed w-full min-w-0 max-w-full bg-transparent border-none shadow-none rounded-none px-0 py-0 box-border';
        bubble.innerHTML =
            '<p class="text-sm fg-[var(--grid-ink-muted)] leading-relaxed">Offline replay fixture — send a message for a live orchestrator run.</p>';

        outer.append(bubble);
        messagesEl.append(outer);
        await syncAssistantMessageBlocks(outer, bubble, pipeline, 0);
    } catch {
        /* ignore fixture failures */
    }
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
        headers: {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(options.headers || {}),
        },
        ...options,
    });
    const text = await res.text();
    let data = {};
    let parseError = null;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = {};
        parseError = 'invalid_json';
    }
    if (!parseError && data && typeof data === 'object' && data.success === undefined) {
        const inner = data.data;
        if (inner && typeof inner === 'object' && inner.success !== undefined) {
            data = inner;
        }
    }
    return { res, data, raw: text, parseError };
}

/**
 * @param {Response} res
 * @param {Record<string, unknown>} data
 * @param {string} [raw]
 * @param {string | null} [parseError]
 */
function formatChatApiError(res, data, raw = '', parseError = null) {
    const msg = typeof data?.message === 'string' ? data.message.trim() : '';
    if (msg) return msg;
    const detail = typeof data?.detail === 'string' ? data.detail.trim() : '';
    if (detail) return detail;
    const err = typeof data?.error === 'string' ? data.error.trim() : '';
    if (err) return err;
    const snippet = String(raw ?? '').trim().slice(0, 160);
    if (parseError === 'invalid_json' || (snippet && data.success === undefined)) {
        if (snippet.startsWith('<')) {
            return `Request failed (${res.status}) — server returned HTML (check sign-in or API path).`;
        }
        if (!snippet) {
            return `Request failed (${res.status}) — empty response from server.`;
        }
        return `Request failed (${res.status}) — invalid JSON from server.`;
    }
    return `Request failed (${res.status}).`;
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
    if (meta && typeof meta === 'object' && meta.persisted_by_orchestrator === true) {
        return true;
    }
    const body = {
        conversation_id: conversationId,
        assistant_message_id: assistantMessageId,
        content,
        ...workspaceChatBodyFields(),
    };
    if (meta && typeof meta === 'object') {
        body.meta = meta;
    }
    try {
        const { res } = await chatFetchJson(chatApiUrl('assistant_patch'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            console.warn('[oaao chat] assistant_patch failed', res.status, conversationId, assistantMessageId);
        }
        return res.ok;
    } catch (err) {
        console.warn('[oaao chat] assistant_patch error', err);
        return false;
    }
}

/**
 * One-line technical summary under an assistant bubble (duration, tok/s only — never endpoint/model IDs).
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
    const pt = meta.pipeline_timing;
    if (pt && typeof pt === 'object') {
        const think = formatOaaoDurationMs(/** @type {Record<string, unknown>} */ (pt).thinking_ms);
        if (think) parts.push(`think ${think}`);
    }
    return parts.join(' · ');
}

/**
 * Visible assistant body when DB/stream content is empty but the run finished.
 *
 * @param {string} contentText
 * @param {Record<string, unknown> | null | undefined} meta
 */
function resolveAssistantDisplayText(contentText, meta) {
    const trimmed = String(contentText ?? '').trim();
    if (trimmed) return contentText;
    if (!meta || typeof meta !== 'object') return '';
    const rs = String(meta.run_status ?? '').toLowerCase();
    const dm = Number(meta.duration_ms);
    const finished = rs === 'complete' || (Number.isFinite(dm) && dm > 0);
    if (!finished) return '';
    if (typeof meta.run_error === 'string' && meta.run_error.trim()) {
        return meta.run_error.trim();
    }
    if (meta.run_failed === true) {
        return oaaoChatT(
            'chat.assistant.empty_failed',
            'The assistant run ended without a reply. Check Settings → Endpoints or the Activity log, then retry.',
        );
    }
    return oaaoChatT(
        'chat.assistant.empty_complete',
        'This reply finished without visible text. Retry or check the LLM endpoint if it keeps happening.',
    );
}

/** Human labels for IQS / ACCS dimension keys in score pill tooltips. */
const OAAO_TURN_SCORE_DIM_LABELS = {
    clarity: 'Clarity',
    specificity: 'Specificity',
    actionability: 'Actionability',
    context_completeness: 'Context',
    alignment: 'Alignment',
    accuracy: 'Accuracy',
    hallucination_penalty: 'Hallucination',
};

/** @type {HTMLElement | null} */
let oaaoTurnScoreFloaterEl = null;
/** @type {HTMLElement | null} */
let oaaoTurnScoreFloaterAnchor = null;
/** @type {boolean} */
let oaaoTurnScoreFloaterScrollBound = false;
/** @type {WeakMap<HTMLElement, AbortController>} */
const oaaoTurnScoreFloaterAcs = new WeakMap();

/**
 * @param {HTMLElement} el
 */
function oaaoZIndexAcquire(el) {
    const z = globalThis.razyui?.zIndex;
    if (z && typeof z.acquire === 'function') {
        return z.acquire(el);
    }
    el.style.zIndex = '9000';
    return 9000;
}

/**
 * @param {HTMLElement} el
 */
function oaaoZIndexRelease(el) {
    const z = globalThis.razyui?.zIndex;
    if (z && typeof z.release === 'function') {
        z.release(el);
    }
}

function hideTurnScoreFloater() {
    if (!oaaoTurnScoreFloaterEl) return;
    oaaoZIndexRelease(oaaoTurnScoreFloaterEl);
    oaaoTurnScoreFloaterEl.remove();
    oaaoTurnScoreFloaterEl = null;
    oaaoTurnScoreFloaterAnchor = null;
}

/**
 * Dimension breakdown card for IQS / ACCS pills (portal — escapes overflow-hidden).
 *
 * @param {HTMLElement} anchor
 * @param {'iqs' | 'accs'} kind
 * @param {number} score
 * @param {Record<string, unknown> | null | undefined} dims
 */
function showTurnScoreDimCard(anchor, kind, score, dims) {
    if (!(anchor instanceof HTMLElement)) return;
    if (!dims || typeof dims !== 'object' || Array.isArray(dims)) {
        showTurnScoreFloater(anchor, formatTurnScoreDimTooltip(dims), 'oaao-chat-turn-score-floater');
        return;
    }

    hideTurnScoreFloater();

    const card = document.createElement('div');
    card.className = `oaao-chat-turn-score-card oaao-chat-turn-score-card--${kind}`;
    card.setAttribute('role', 'tooltip');

    const head = document.createElement('div');
    head.className = 'oaao-chat-turn-score-card__head';

    const title = document.createElement('div');
    title.className = 'oaao-chat-turn-score-card__title';
    title.textContent = kind === 'iqs' ? 'IQS' : 'ACCS';

    const scoreEl = document.createElement('div');
    scoreEl.className = 'oaao-chat-turn-score-card__score';
    scoreEl.textContent = Number.isFinite(score) ? score.toFixed(2) : '—';

    head.append(title, scoreEl);

    const body = document.createElement('div');
    body.className = 'oaao-chat-turn-score-card__dims';

    for (const [key, raw] of Object.entries(dims)) {
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        const row = document.createElement('div');
        row.className = 'oaao-chat-turn-score-card__dim';

        const label = document.createElement('div');
        label.className = 'oaao-chat-turn-score-card__dim-label';
        label.textContent = OAAO_TURN_SCORE_DIM_LABELS[key] || key.replace(/_/g, ' ');

        const val = document.createElement('div');
        val.className = 'oaao-chat-turn-score-card__dim-val';
        val.textContent = n.toFixed(2);

        const bar = document.createElement('div');
        bar.className = 'oaao-chat-turn-score-card__dim-bar';
        const fill = document.createElement('span');
        fill.className = 'oaao-chat-turn-score-card__dim-fill';
        const pct = key === 'hallucination_penalty' ? (1 - n) * 100 : n * 100;
        fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        bar.append(fill);

        row.append(label, bar, val);
        body.append(row);
    }

    if (!body.childElementCount) {
        showTurnScoreFloater(anchor, formatTurnScoreDimTooltip(dims), 'oaao-chat-turn-score-floater');
        return;
    }

    card.append(head, body);
    card.style.position = 'fixed';
    document.body.appendChild(card);
    oaaoZIndexAcquire(card);

    const rect = anchor.getBoundingClientRect();
    const fr = card.getBoundingClientRect();
    const margin = 10;
    let top = rect.top - fr.height - 8;
    let left = rect.left + rect.width / 2 - fr.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - fr.width - margin));
    if (top < margin) top = rect.bottom + 8;
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;

    oaaoTurnScoreFloaterEl = card;
    oaaoTurnScoreFloaterAnchor = anchor;
}

/**
 * Portal tooltip to {@code document.body} — escapes {@code overflow-x-hidden} on {@code .oaao-chat-messages}.
 *
 * @param {HTMLElement} anchor
 * @param {string} text
 * @param {string} [className]
 */
function showTurnScoreFloater(anchor, text, className = 'oaao-chat-turn-score-floater') {
    const tip = String(text || '').trim();
    if (!tip) {
        hideTurnScoreFloater();
        return;
    }
    hideTurnScoreFloater();
    const floater = document.createElement('div');
    floater.className = className;
    floater.setAttribute('role', 'tooltip');
    floater.textContent = tip;
    document.body.appendChild(floater);
    oaaoZIndexAcquire(floater);
    const rect = anchor.getBoundingClientRect();
    const fr = floater.getBoundingClientRect();
    const margin = 8;
    let top = rect.top + window.scrollY - fr.height - 6;
    let left = rect.left + window.scrollX + rect.width / 2 - fr.width / 2;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - fr.width - margin;
    left = Math.max(window.scrollX + margin, Math.min(left, maxLeft));
    if (top < window.scrollY + margin) {
        top = rect.bottom + window.scrollY + 6;
    }
    floater.style.top = `${top}px`;
    floater.style.left = `${left}px`;
    oaaoTurnScoreFloaterEl = floater;
    oaaoTurnScoreFloaterAnchor = anchor;
}

/**
 * @param {HTMLElement} pill
 * @returns {Record<string, number> | null}
 */
function readTurnScoreDimsFromPill(pill) {
    if (!(pill instanceof HTMLElement)) return null;
    try {
        const raw = pill.dataset.oaaoTurnScoreDims;
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                /** @type {Record<string, number>} */
                const out = {};
                for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (parsed))) {
                    const n = Number(val);
                    if (Number.isFinite(n)) out[key] = n;
                }
                if (Object.keys(out).length) return out;
            }
        }
    } catch {
        /* fall through */
    }
    const tip = String(pill.dataset.oaaoTurnScoreTip || '').trim();
    if (!tip) return null;
    /** @type {Record<string, number>} */
    const fromTip = {};
    for (const line of tip.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let matchedKey = '';
        for (const [key, label] of Object.entries(OAAO_TURN_SCORE_DIM_LABELS)) {
            if (trimmed.startsWith(`${label} `)) {
                matchedKey = key;
                break;
            }
        }
        const m = /^(.+?)\s+(-?\d+(?:\.\d+)?)$/.exec(trimmed);
        if (!m) continue;
        const n = Number(m[2]);
        if (!Number.isFinite(n)) continue;
        const key = matchedKey || m[1].trim().toLowerCase().replace(/\s+/g, '_');
        fromTip[key] = n;
    }
    return Object.keys(fromTip).length ? fromTip : null;
}

/**
 * @param {HTMLElement} pill
 */
function showTurnScorePillTooltip(pill) {
    if (!(pill instanceof HTMLElement)) return;
    const kind = pill.dataset.oaaoTurnScoreKind === 'accs' ? 'accs' : 'iqs';
    const score = Number(pill.dataset.oaaoTurnScoreValue);
    const dims = readTurnScoreDimsFromPill(pill);
    if (dims && Object.keys(dims).length) {
        showTurnScoreDimCard(pill, kind, Number.isFinite(score) ? score : NaN, dims);
        return;
    }
    const text = pill.dataset.oaaoTurnScoreTip || '';
    if (text) showTurnScoreFloater(pill, text);
}

/**
 * @param {HTMLElement} pill
 */
function ensureTurnScorePillFloater(pill) {
    if (!(pill instanceof HTMLElement)) return;
    oaaoTurnScoreFloaterAcs.get(pill)?.abort();
    const ac = new AbortController();
    oaaoTurnScoreFloaterAcs.set(pill, ac);
    const show = () => showTurnScorePillTooltip(pill);
    const hide = () => {
        if (oaaoTurnScoreFloaterAnchor === pill) hideTurnScoreFloater();
    };
    pill.addEventListener('mouseenter', show, { signal: ac.signal });
    pill.addEventListener('mouseleave', hide, { signal: ac.signal });
    pill.addEventListener('focusin', show, { signal: ac.signal });
    pill.addEventListener('focusout', hide, { signal: ac.signal });
}

/** @type {WeakSet<HTMLElement>} */
const oaaoRunMetaInfoFloaterBound = new WeakSet();

function createRunMetaLoggingLink() {
    const unit = document.createElement('span');
    unit.dataset.oaaoChat = 'assistant-summary-logging';
    unit.className = 'oaao-chat-assistant-summary-logging';

    const sep = document.createElement('span');
    sep.className = 'oaao-chat-assistant-summary-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = ' · ';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.oaaoChat = 'run-meta-info';
    btn.className = 'oaao-chat-run-meta-info';
    btn.textContent = oaaoChatT('chat.run_meta.logging', 'Logging');
    btn.setAttribute('aria-label', oaaoChatT('chat.run_meta.logging_tip', 'Pipeline timing log'));
    btn.setAttribute('aria-expanded', 'false');

    unit.append(sep, btn);
    return unit;
}

/**
 * @param {HTMLElement} unit
 */
function ensureRunMetaInfoFloater(unit) {
    const btn = unit.querySelector('[data-oaao-chat="run-meta-info"]');
    if (!(btn instanceof HTMLElement) || oaaoRunMetaInfoFloaterBound.has(btn)) return;
    oaaoRunMetaInfoFloaterBound.add(btn);
    const show = () => {
        const text = btn.dataset.oaaoRunMetaTip || '';
        if (!text) return;
        showTurnScoreFloater(btn, text, 'oaao-chat-run-meta-floater');
        btn.setAttribute('aria-expanded', 'true');
    };
    const hide = () => {
        if (oaaoTurnScoreFloaterAnchor === btn) hideTurnScoreFloater();
        btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('mouseenter', show);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('focusin', show);
    btn.addEventListener('focusout', hide);
    btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (oaaoTurnScoreFloaterAnchor === btn) hide();
        else show();
    });
}

function bindTurnScoreFloaterDismissOnScroll() {
    if (oaaoTurnScoreFloaterScrollBound) return;
    oaaoTurnScoreFloaterScrollBound = true;
    document.addEventListener(
        'scroll',
        () => {
            if (oaaoTurnScoreFloaterEl) hideTurnScoreFloater();
        },
        true,
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 */
function turnScorePendingFromRow(row) {
    if (!row || typeof row !== 'object') {
        return { pendingIqs: true, pendingAccs: turnScoreAccsExpected(null, null) };
    }
    const iqs = Number(row.iqs);
    const accs = Number(row.accs);
    const pendingIqs = Boolean(row.needs_iqs_rescore) || !(Number.isFinite(iqs) && iqs > 0);
    const accsExpected = turnScoreAccsExpected(row, null);
    const pendingAccs =
        accsExpected && (Boolean(row.needs_accs_rescore) || !(Number.isFinite(accs) && accs > 0));
    return { pendingIqs, pendingAccs };
}

/**
 * @param {Record<string, unknown> | null | undefined} dims
 */
function formatTurnScoreDimTooltip(dims) {
    if (!dims || typeof dims !== 'object' || Array.isArray(dims)) {
        return '';
    }
    return Object.entries(/** @type {Record<string, unknown>} */ (dims))
        .map(([key, raw]) => {
            const n = Number(raw);
            const val = Number.isFinite(n) ? n.toFixed(2) : String(raw ?? '').trim();
            const label = OAAO_TURN_SCORE_DIM_LABELS[key] || key.replace(/_/g, ' ');
            return `${label} ${val}`;
        })
        .join('\n');
}

/** ACCS is skipped for clarify / hard_clarify turns — do not show a pending ACCS pill. */
function turnScoreAccsExpected(turnScore, runMeta) {
    const fromMeta =
        runMeta && typeof runMeta === 'object'
            ? String(runMeta.iqs_action || '').toLowerCase()
            : '';
    if (fromMeta === 'clarify' || fromMeta === 'hard_clarify') return false;
    const reasons =
        turnScore && typeof turnScore === 'object' ? /** @type {Record<string, unknown>} */ (turnScore).iqs_reasons : null;
    if (reasons && typeof reasons === 'object' && !Array.isArray(reasons)) {
        const action = String(/** @type {Record<string, unknown>} */ (reasons).action || '').toLowerCase();
        if (action === 'clarify' || action === 'hard_clarify') return false;
    }
    return true;
}

/**
 * @param {HTMLElement} wrap
 * @param {'iqs' | 'accs'} kind
 * @param {number | null} score
 * @param {Record<string, unknown> | null | undefined} dims
 * @param {{ pending?: boolean }} [opts]
 */
function renderTurnScorePill(wrap, kind, score, dims, opts = {}) {
    const label = kind === 'iqs' ? 'IQS' : 'ACCS';
    const pending = Boolean(opts.pending);
    const hasScore = score !== null && Number.isFinite(score) && score > 0;
    let pill = wrap.querySelector(`[data-oaao-turn-score-pill="${kind}"]`);
    if (!hasScore && !pending) {
        pill?.remove();
        return;
    }
    if (!(pill instanceof HTMLElement)) {
        pill = document.createElement('span');
        pill.dataset.oaaoTurnScorePill = kind;
        pill.className = `oaao-chat-turn-score-pill oaao-chat-turn-score-pill--${kind}`;
        pill.setAttribute('role', 'note');
        pill.append(document.createElement('span'));
        wrap.append(pill);
    }
    const labelEl = pill.querySelector(':scope > span:first-child');
    if (labelEl instanceof HTMLElement) {
        labelEl.textContent = pending && !hasScore ? `${label} …` : `${label} ${score.toFixed(2)}`;
    }
    pill.classList.toggle('oaao-chat-turn-score-pill--pending', pending && !hasScore);
    pill.classList.remove('oaao-chat-turn-score-pill--stale');
    if (pending && !hasScore) {
        pill.dataset.oaaoTurnScoreTip = '';
        pill.classList.remove('oaao-chat-turn-score-pill--has-tip');
        pill.tabIndex = -1;
        pill.setAttribute('aria-label', `${label} scoring in progress`);
        return;
    }
    const tip = formatTurnScoreDimTooltip(dims);
    pill.dataset.oaaoTurnScoreTip = tip;
    pill.dataset.oaaoTurnScoreKind = kind;
    pill.dataset.oaaoTurnScoreValue = String(score);
    try {
        const dimObj =
            dims && typeof dims === 'object' && !Array.isArray(dims)
                ? /** @type {Record<string, unknown>} */ (dims)
                : {};
        pill.dataset.oaaoTurnScoreDims = JSON.stringify(dimObj);
    } catch {
        delete pill.dataset.oaaoTurnScoreDims;
    }
    pill.classList.toggle('oaao-chat-turn-score-pill--has-tip', Boolean(tip));
    pill.tabIndex = tip ? 0 : -1;
    ensureTurnScorePillFloater(pill);
    bindTurnScoreFloaterDismissOnScroll();
    const aria = tip ? `${label} ${score.toFixed(2)}: ${tip.replace(/\n/g, ', ')}` : `${label} ${score.toFixed(2)}`;
    pill.setAttribute('aria-label', aria);
}

/**
 * IQS / ACCS pills — show pending state while background scoring runs.
 *
 * @param {Record<string, unknown> | null | undefined} turnScore
 */
function applyAssistantTurnScoreToRow(outer, turnScore) {
    if (!outer || !turnScore || typeof turnScore !== 'object') return;
    const { pendingIqs, pendingAccs } = turnScorePendingFromRow(turnScore);
    const iqs = Number(turnScore.iqs);
    const accs = Number(turnScore.accs);
    const iqsReady = Number.isFinite(iqs) && iqs > 0 && !pendingIqs;
    const accsExpected = turnScoreAccsExpected(turnScore, null);
    const accsReady = accsExpected && Number.isFinite(accs) && accs > 0 && !pendingAccs;
    const showIqs = iqsReady || pendingIqs;
    const showAccs = accsExpected && (accsReady || pendingAccs);
    if (!showIqs && !showAccs) {
        outer.querySelector('[data-oaao-chat="turn-score"]')?.remove();
        return;
    }
    let wrap = outer.querySelector('[data-oaao-chat="turn-score"]');
    if (!(wrap instanceof HTMLElement)) {
        wrap = document.createElement('div');
        wrap.dataset.oaaoChat = 'turn-score';
        wrap.className = 'oaao-chat-turn-score-pills';
        wrap.setAttribute('aria-label', 'Turn quality scores');
        const bubble = outer.querySelector('[data-oaao-msg-role="assistant"]');
        if (bubble instanceof HTMLElement) {
            bubble.insertAdjacentElement('afterend', wrap);
        } else {
            const summary =
                outer.querySelector('[data-oaao-chat="assistant-summary-wrap"]') ||
                outer.querySelector('[data-oaao-chat="assistant-summary"]');
            if (summary instanceof HTMLElement) {
                summary.insertAdjacentElement('afterend', wrap);
            } else {
                const toolbar = outer.querySelector('.oaao-chat-assistant-toolbar');
                if (toolbar instanceof HTMLElement) {
                    outer.insertBefore(wrap, toolbar);
                } else {
                    outer.append(wrap);
                }
            }
        }
    }
    renderTurnScorePill(
        wrap,
        'iqs',
        iqsReady ? iqs : null,
        iqsReady ? /** @type {Record<string, unknown>} */ (turnScore).iqs_dims : null,
        { pending: pendingIqs && !iqsReady },
    );
    renderTurnScorePill(
        wrap,
        'accs',
        accsReady ? accs : null,
        accsReady ? /** @type {Record<string, unknown>} */ (turnScore).accs_dims : null,
        { pending: accsExpected && pendingAccs && !accsReady },
    );
    if (!wrap.querySelector('[data-oaao-turn-score-pill]')) {
        wrap.remove();
    }
}

/**
 * Fire-and-forget background rescore when turns lack or stale IQS/ACCS — pills appear on next open after queue completes.
 *
 * @param {number} conversationId
 */
async function triggerTurnScoresRescoreIfNeeded(conversationId) {
    const cid = Number(conversationId);
    if (!Number.isFinite(cid) || cid < 1) return;
    const { res, data } = await chatFetchJson(chatApiUrl('turn_scores_rescore'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: cid, ...chatScopeBodyFieldsForConversation(cid) }),
    });
    if (!data?.success) {
        console.warn(
            '[oaao-chat] turn_scores_rescore failed',
            cid,
            data?.message || res.status,
            data?.orchestrator_detail || '',
            data?.orchestrator_status || '',
        );
        return;
    }
    console.info('[oaao-chat] turn_scores_rescore queued', cid, data?.queued ?? 0, data?.already_running ? '(already running)' : '');
}

/** @type {Map<number, ReturnType<typeof setTimeout>>} */
const turnScorePollTimerByConversation = new Map();

const TURN_SCORE_POLL_INTERVAL_MS = 2500;
const TURN_SCORE_POLL_MAX_ATTEMPTS = 120;

/**
 * @param {number} conversationId
 */
function cancelTurnScorePoll(conversationId) {
    const cid = Number(conversationId);
    const timer = turnScorePollTimerByConversation.get(cid);
    if (timer) {
        clearTimeout(timer);
        turnScorePollTimerByConversation.delete(cid);
    }
}

/**
 * @param {number} conversationId
 */
function cancelTurnScorePollsExcept(conversationId) {
    const keep = Number(conversationId);
    for (const cid of [...turnScorePollTimerByConversation.keys()]) {
        if (cid !== keep) cancelTurnScorePoll(cid);
    }
}

/**
 * @param {Record<string, unknown>} row
 */
function turnScoreRowIsReady(row) {
    const { pendingIqs, pendingAccs } = turnScorePendingFromRow(row);
    const accsExpected = turnScoreAccsExpected(row, null);
    return !pendingIqs && (!accsExpected || !pendingAccs);
}

/**
 * @param {number} conversationId
 * @param {HTMLElement | Document} mount
 */
function applyTurnScoresFromCacheToDom(conversationId, mount) {
    const map = turnScoreCacheByConversation.get(conversationId);
    if (!(map instanceof Map) || map.size < 1) return;
    const root = mount instanceof HTMLElement ? mount : document;
    for (const [mid, turnScore] of map.entries()) {
        if (!turnScore || typeof turnScore !== 'object') continue;
        const bubble = root.querySelector(`[data-oaao-msg-id="${mid}"]`);
        const outer = bubble?.closest('.oaao-chat-assistant-row');
        if (outer instanceof HTMLElement) {
            applyAssistantTurnScoreToRow(outer, turnScore);
        }
    }
    cachedMessageRows = attachTurnScoresToMessageRows(cachedMessageRows, conversationId);
}

/**
 * Poll turn_scores after stream end / rescore — apply IQS / ACCS pills in place when ready.
 *
 * @param {number} conversationId
 * @param {HTMLElement | Document} mount
 * @param {{ assistantMessageId?: number | null, triggerRescore?: boolean }} [opts]
 */
function scheduleTurnScorePoll(conversationId, mount, opts = {}) {
    const cid = Number(conversationId);
    if (!Number.isFinite(cid) || cid < 1) return;
    cancelTurnScorePollsExcept(cid);
    cancelTurnScorePoll(cid);

    const assistantMessageId =
        opts.assistantMessageId != null && Number(opts.assistantMessageId) > 0
            ? Math.floor(Number(opts.assistantMessageId))
            : null;
    const triggerRescore = opts.triggerRescore !== false;
    let attempts = 0;
    let rescoreTriggered = false;

    const tick = async () => {
        turnScorePollTimerByConversation.delete(cid);
        if (activeConversationId !== cid) return;

        if (conversationHasOpenRunTasks(cid)) {
            if (attempts >= TURN_SCORE_POLL_MAX_ATTEMPTS) return;
            const deferTimer = setTimeout(() => void tick(), TURN_SCORE_POLL_INTERVAL_MS);
            turnScorePollTimerByConversation.set(cid, deferTimer);
            return;
        }

        attempts += 1;
        const scorePack = await loadTurnScoresForConversation(cid);
        applyTurnScoresFromCacheToDom(cid, mount);

        if (triggerRescore && !rescoreTriggered && scorePack.rescorePending > 0) {
            rescoreTriggered = true;
            void triggerTurnScoresRescoreIfNeeded(cid);
        } else if (
            triggerRescore &&
            rescoreTriggered &&
            scorePack.rescorePending > 0 &&
            attempts % 10 === 0
        ) {
            void triggerTurnScoresRescoreIfNeeded(cid);
        }

        let done = false;
        if (assistantMessageId) {
            const row = scorePack.map.get(assistantMessageId);
            done = Boolean(row && turnScoreRowIsReady(row));
        } else if (scorePack.map.size > 0) {
            done = [...scorePack.map.values()].every((row) => turnScoreRowIsReady(row));
        }

        if (done || attempts >= TURN_SCORE_POLL_MAX_ATTEMPTS) {
            return;
        }

        const timer = setTimeout(() => void tick(), TURN_SCORE_POLL_INTERVAL_MS);
        turnScorePollTimerByConversation.set(cid, timer);
    };

    void tick();
}

/**
 * @param {number} conversationId
 * @param {number | null} [beforeId]
 */
function chatMessagesApiUrl(conversationId, beforeId = null) {
    const params = {
        conversation_id: String(conversationId),
        limit: String(chatHistoryPageSize),
        ...chatScopeParamsForConversation(conversationId),
    };
    if (beforeId !== null && beforeId > 0) {
        params.before_id = String(beforeId);
    }
    return chatApiUrl('messages', params);
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {number} conversationId
 */
function attachTurnScoresToMessageRows(rows, conversationId) {
    const map = turnScoreCacheByConversation.get(conversationId);
    if (!(map instanceof Map) || map.size < 1) {
        return rows;
    }
    return rows.map((m) => {
        if (!m || typeof m !== 'object') return m;
        const mid = coercePositiveInt(m.id);
        const role = String(m.role ?? '').toLowerCase();
        if (mid !== null && role === 'assistant' && map.has(mid)) {
            return { ...m, turn_score: map.get(mid) };
        }
        return m;
    });
}

/**
 * @param {number} conversationId
 * @returns {Promise<{ map: Map<number, Record<string, unknown>>, scorerVersions: Record<string, string> | null, rescorePending: number }>}
 */
async function loadTurnScoresForConversation(conversationId) {
    const map = new Map();
    const cid = Number(conversationId);
    if (!Number.isFinite(cid) || cid < 1) {
        return { map, scorerVersions: null, rescorePending: 0 };
    }
    const { res, data } = await chatFetchJson(
        chatApiUrl('turn_scores', { conversation_id: String(cid), ...chatScopeParamsForConversation(cid) }),
    );
    if (!data?.success || !Array.isArray(data.scores)) {
        if (data?.success === false && data?.message) {
            console.warn('[oaao-chat] turn_scores failed', cid, data.message);
        }
        return { map, scorerVersions: null, rescorePending: 0 };
    }
    const scorerVersions =
        data.scorer_versions && typeof data.scorer_versions === 'object'
            ? /** @type {Record<string, string>} */ (data.scorer_versions)
            : null;
    for (const raw of data.scores) {
        if (!raw || typeof raw !== 'object') continue;
        const mid = coercePositiveInt(raw.assistant_message_id);
        if (mid !== null) {
            map.set(mid, /** @type {Record<string, unknown>} */ (raw));
        }
    }
    turnScoreCacheByConversation.set(cid, map);
    return {
        map,
        scorerVersions,
        rescorePending: Number(data.rescore_pending) || 0,
    };
}

/**
 * @param {number} conversationId
 */
function resetMessagePageState(conversationId) {
    messagePageStateByConversation.delete(conversationId);
}

/**
 * @param {number} conversationId
 * @param {Record<string, unknown>} data
 */
function applyMessagePageMeta(conversationId, data) {
    const cid = Number(conversationId);
    if (!Number.isFinite(cid) || cid < 1) return;
    messagePageStateByConversation.set(cid, {
        hasOlder: Boolean(data.has_older),
        oldestId: coercePositiveInt(data.oldest_message_id),
        loadingOlder: false,
    });
}

/**
 * @param {Record<string, unknown> | null | undefined} meta
 */
function metaChatProfileLabel(meta) {
    if (!meta || typeof meta !== 'object') return '';
    const cp = meta.chat_profile;
    if (typeof cp === 'string') return cp.trim();
    if (cp && typeof cp === 'object') return String(/** @type {Record<string, unknown>} */ (cp).name ?? '').trim();

    return '';
}

/**
 * Assistant sender line — **chat completion profile label only** ({@code chat_profile} name).
 * Never {@code endpoint_ref} or raw {@code model} IDs (those stay server-side / orchestrator only).
 *
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {{ title: string, badge: string, avatar: 'logo' | 'letter' }}
 */
function resolveAssistantIdentity(meta) {
    const prof = meta && typeof meta === 'object' ? metaChatProfileLabel(meta) : '';
    if (!prof) {
        return { title: 'OAAO AI', badge: '', avatar: 'logo' };
    }
    const trimmed = prof.trim();
    /** OAAO-branded profiles (e.g. {@code OAAO AI - Fast}) keep the wordmark; others use initials. */
    const avatar = /^OAAO\b/i.test(trimmed) ? 'logo' : 'letter';

    return { title: prof, badge: '', avatar };
}

/** Wordmark paths — mirror {@code core/default/webassets/oaao-icon.svg}. */
const OAAO_MARK_PATH_DS = [
    'M13.71,0h.12l4.33,8.72h-1.49l-.77-1.63h-4.27l-.81,1.63h-1.45L13.71,0ZM15.32,5.89l-1.56-3.29-1.54,3.29h3.1Z',
    'M4.33,9.59h.12l4.33,8.72h-1.49l-.77-1.63H2.26l-.81,1.63H0l4.33-8.72ZM5.95,15.48l-1.56-3.29-1.54,3.29h3.1Z',
    'M4.39.02C1.99.02.05,1.97.05,4.37s1.94,4.34,4.34,4.34,4.35-1.94,4.35-4.34S6.79.02,4.39.02ZM4.39,7.44c-1.69,0-3.07-1.38-3.07-3.07s1.38-3.07,3.07-3.07,3.07,1.37,3.07,3.07-1.37,3.07-3.07,3.07Z',
    'M13.69,9.85c-2.4,0-4.34,1.95-4.34,4.35s1.94,4.34,4.34,4.34,4.35-1.94,4.35-4.34-1.95-4.35-4.35-4.35ZM13.69,17.27c-1.69,0-3.07-1.38-3.07-3.07s1.38-3.07,3.07-3.07,3.07,1.37,3.07,3.07-1.37,3.07-3.07,3.07Z',
];

/**
 * @returns {SVGSVGElement}
 */
function createOaaoMarkSvgEl() {
    const xmlns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(xmlns, 'svg');
    svg.setAttribute('xmlns', xmlns);
    svg.setAttribute('viewBox', '0 0 18.16 18.54');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('class', 'oaao-chat-assistant-mark shrink-0 block text-[var(--grid-ink)]');
    svg.setAttribute('aria-hidden', 'true');
    const g = document.createElementNS(xmlns, 'g');
    g.setAttribute('fill', 'currentColor');
    for (const d of OAAO_MARK_PATH_DS) {
        const p = document.createElementNS(xmlns, 'path');
        p.setAttribute('d', d);
        g.append(p);
    }
    svg.append(g);

    return /** @type {SVGSVGElement} */ (svg);
}

/**
 * Avatar + endpoint / model chip above assistant markdown (flat reply body on paper).
 *
 * @param {HTMLElement} outer
 * @param {Record<string, unknown> | null | undefined} meta
 */
function applyAssistantIdentityHeader(outer, meta) {
    if (!outer) return;
    const parts = resolveAssistantIdentity(meta ?? null);
    let el = outer.querySelector('[data-oaao-chat="assistant-identity"]');
    if (!el) {
        el = document.createElement('div');
        el.dataset.oaaoChat = 'assistant-identity';
        el.className =
            'oaao-chat-assistant-identity flex flex-row items-center gap-2 min-w-0 max-w-full';
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', 'Assistant');
        outer.prepend(el);
    }
    el.replaceChildren();

    const avatarWrap = document.createElement('div');
    avatarWrap.className =
        'oaao-chat-assistant-avatar-wrap shrink-0 flex items-center justify-start w-8 h-8 min-w-[2rem]';
    avatarWrap.setAttribute('aria-hidden', 'true');

    if (parts.avatar === 'logo') {
        avatarWrap.append(createOaaoMarkSvgEl());
    } else {
        const avatar = document.createElement('div');
        avatar.className =
            'oaao-chat-assistant-avatar-letter flex items-center justify-center w-8 h-8 rounded-full bg-[var(--grid-line)]/40 text-[var(--grid-ink)] text-[0.75rem] font-semibold tabular-nums';
        const letter = (parts.title || parts.badge || '?').trim().slice(0, 1).toUpperCase();
        avatar.textContent = letter || '?';
        avatarWrap.append(avatar);
    }

    const body = document.createElement('div');
    body.className = 'flex flex-row flex-wrap items-center gap-2 min-w-0';

    const nameEl = document.createElement('span');
    nameEl.className = 'oaao-chat-assistant-identity-name truncate';
    nameEl.textContent = parts.title;

    body.append(nameEl);
    if (parts.badge) {
        const chip = document.createElement('span');
        chip.className = 'oaao-chat-assistant-model-chip';
        chip.textContent = parts.badge;
        body.append(chip);
    }

    el.append(avatarWrap, body);
}

/**
 * @param {HTMLElement} outer
 * @param {Record<string, unknown>} meta
 */
/**
 * Shown when upstream stopped at max_tokens ({@code finish_reason: length}).
 *
 * @param {HTMLElement} outer
 */
function applyAssistantTruncationNoticeToRow(outer) {
    if (!outer) return;
    let el = outer.querySelector('[data-oaao-chat="assistant-truncation"]');
    if (!el) {
        el = document.createElement('p');
        el.dataset.oaaoChat = 'assistant-truncation';
        el.className =
            'text-[0.75rem] leading-snug fg-[var(--grid-ink-muted)] mt-1 mb-0 px-0 py-0 w-full break-words';
        el.setAttribute('role', 'note');
        const summary =
            outer.querySelector('[data-oaao-chat="assistant-summary-wrap"]') ||
            outer.querySelector('[data-oaao-chat="assistant-summary"]');
        const toolbar = outer.querySelector('.oaao-chat-assistant-toolbar');
        if (summary) summary.insertAdjacentElement('beforebegin', el);
        else if (toolbar) outer.insertBefore(el, toolbar);
        else outer.append(el);
    }
    el.textContent =
        'Reply may be cut off (model token limit). Ask to continue, or raise max_tokens in chat profile / endpoint config.';
}

function applyAssistantRunSummaryToRow(outer, meta) {
    if (!outer || !meta || typeof meta !== 'object') return;
    const line = formatAssistantRunMetaLine(meta);
    if (!line) return;

    let wrap = outer.querySelector('[data-oaao-chat="assistant-summary-wrap"]');
    if (!(wrap instanceof HTMLElement)) {
        wrap = document.createElement('div');
        wrap.dataset.oaaoChat = 'assistant-summary-wrap';
        wrap.className = 'oaao-chat-assistant-summary-wrap';
        const textEl = document.createElement('span');
        textEl.dataset.oaaoChat = 'assistant-summary';
        textEl.className =
            'oaao-chat-assistant-summary-text text-[0.7rem] leading-snug fg-[var(--grid-caption)] font-mono tabular-nums';
        wrap.append(textEl);
        wrap.setAttribute('aria-label', 'Response metrics');
        const legacy = outer.querySelector('[data-oaao-chat="assistant-summary"]');
        const toolbar = outer.querySelector('.oaao-chat-assistant-toolbar');
        const bubble = outer.querySelector('[data-oaao-msg-role="assistant"]');
        if (legacy instanceof HTMLElement && legacy.parentElement !== wrap) {
            legacy.replaceWith(wrap);
            wrap.querySelector('[data-oaao-chat="assistant-summary"]')?.remove();
            wrap.prepend(textEl);
        } else if (toolbar) {
            outer.insertBefore(wrap, toolbar);
        } else if (bubble) {
            bubble.insertAdjacentElement('afterend', wrap);
        } else {
            outer.append(wrap);
        }
    }

    const textEl = wrap.querySelector('[data-oaao-chat="assistant-summary"]');
    if (textEl instanceof HTMLElement) textEl.textContent = line;

    const pt = meta.pipeline_timing;
    const tip =
        pt && typeof pt === 'object'
            ? formatPipelineTimingTooltip(/** @type {Record<string, unknown>} */ (pt), meta.duration_ms)
            : '';
    let loggingUnit = wrap.querySelector('[data-oaao-chat="assistant-summary-logging"]');
    if (tip) {
        if (!(loggingUnit instanceof HTMLElement)) {
            loggingUnit = createRunMetaLoggingLink();
            ensureRunMetaInfoFloater(loggingUnit);
        }
        const infoBtn = loggingUnit.querySelector('[data-oaao-chat="run-meta-info"]');
        if (infoBtn instanceof HTMLElement) {
            infoBtn.dataset.oaaoRunMetaTip = tip;
            infoBtn.hidden = false;
        }
        loggingUnit.hidden = false;
        if (textEl instanceof HTMLElement && textEl.nextElementSibling !== loggingUnit) {
            textEl.insertAdjacentElement('afterend', loggingUnit);
        }
    } else {
        loggingUnit?.remove();
    }
}

/**
 * Per-conversation SSE readers — starting Chat B must not abort Chat A (global abort caused truncation).
 * Server ``StreamRun`` may still drain until done unless a cancel API is called.
 *
 * @typedef {{ controller: AbortController, runId: string }} ChatStreamHandle
 */

/** @type {Map<number, ChatStreamHandle>} */
const streamHandlesByConversation = new Map();

/** Pause SSE during agent_ask so PHP workers + session are free for agent_ask POST. */
/** @type {Map<number, { streamUrl: string, runId: string, lastSeq: number, assistantMessageId: number | null, orchestratorOwnsPersist: boolean }>} */
const streamPausedForAgentAskByConversation = new Map();

/** Latest run-status label per conversation (re-applied after {@link renderMessages}). */
/** @type {Map<number, string>} */
const runStatusLabelByConversation = new Map();

/** Abort every in-flight reader (panel teardown only). */
function abortAllStreamReaders() {
    for (const entry of streamHandlesByConversation.values()) {
        try {
            entry.controller.abort();
        } catch {
            /* ignore */
        }
    }
    streamHandlesByConversation.clear();
    runStatusLabelByConversation.clear();
}

/**
 * Ask orchestrator to cooperatively cancel a background run (best-effort).
 *
 * @param {string} runId
 */
/**
 * @param {number} conversationId
 */
function resumeAssistantStreamAfterAgentAsk(conversationId) {
    const cid = Math.floor(Number(conversationId));
    if (!Number.isFinite(cid) || cid < 1) return;
    if (streamHandlesByConversation.has(cid)) {
        streamPausedForAgentAskByConversation.delete(cid);
        return;
    }
    let ctx = streamPausedForAgentAskByConversation.get(cid);
    streamPausedForAgentAskByConversation.delete(cid);
    if (!ctx) {
        const cur = loadStreamCursor(cid);
        if (cur?.stream_url && cur.run_id) {
            ctx = {
                streamUrl: cur.stream_url,
                runId: cur.run_id,
                lastSeq: cur.last_seq || 0,
                assistantMessageId: coercePositiveInt(cur.assistant_message_id),
                orchestratorOwnsPersist: true,
            };
        }
    }
    if (!ctx?.streamUrl || !ctx.runId) return;
    void consumeAssistantStream(
        ctx.streamUrl,
        ctx.runId,
        cid,
        ctx.lastSeq || 0,
        ctx.assistantMessageId,
        ctx.orchestratorOwnsPersist,
    );
}

/**
 * @param {number} conversationId
 * @param {{ streamUrl: string, runId: string, lastSeq: number, assistantMessageId: number | null, orchestratorOwnsPersist: boolean }} ctx
 * @param {AbortController} controller
 */
function pauseAssistantStreamForAgentAsk(conversationId, ctx, controller) {
    const cid = Math.floor(Number(conversationId));
    if (!Number.isFinite(cid) || cid < 1) return;
    streamPausedForAgentAskByConversation.set(cid, ctx);
    try {
        controller.abort();
    } catch {
        /* ignore */
    }
    streamHandlesByConversation.delete(cid);
    const mount = document.querySelector('[data-module="oaao-chat"]');
    if (mount instanceof HTMLElement && activeConversationId === cid) {
        syncComposerBusyForActiveView(mount);
    }
}

/**
 * @param {string} runId
 * @param {string} taskId
 * @param {'proceed'|'skip'|'proceed_fork'} decision
 */
/**
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function requestOrchestratorAgentAsk(runId, taskId, decision) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    const tid = typeof taskId === 'string' ? taskId.trim() : '';
    if (!rid || !tid) {
        return { ok: false, message: 'run_id and task_id required' };
    }
    try {
        const { res, data } = await chatFetchJson(chatApiUrl('agent_ask'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                run_id: rid,
                task_id: tid,
                decision,
                ...workspaceChatBodyFields(),
            }),
        });
        const ok = Boolean(res.ok && data?.success);
        const message = typeof data?.message === 'string' ? data.message.trim() : '';

        return { ok, ...(message ? { message } : {}) };
    } catch {
        return { ok: false };
    }
}

async function requestOrchestratorCancelRun(runId) {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return;
    try {
        await chatFetchJson(chatApiUrl('cancel_run'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ run_id: rid, ...workspaceChatBodyFields() }),
        });
    } catch {
        /* ignore — reader abort still detaches UI */
    }
}

/** Prevents duplicate send while POST / send.php is in flight. */
let chatComposerSubmitInFlight = false;
/** Conversation id for in-flight send; {@code null} = landing / new chat. */
let chatComposerSubmitConvId = null;

/**
 * @param {number | null | undefined} conversationId
 * @returns {boolean}
 */
function conversationHasActiveStream(conversationId) {
    const cid = conversationId != null ? Math.floor(Number(conversationId)) : 0;
    if (cid > 0 && streamHandlesByConversation.has(cid)) return true;
    return cid > 0 && streamPausedForAgentAskByConversation.has(cid);
}

/**
 * Composer busy/stream UI follows the active thread only — background streams on other conversations must not block this view.
 *
 * @param {HTMLElement} mount
 */
function syncComposerBusyForActiveView(mount) {
    const cid = activeConversationId;
    const streamingHere = conversationHasActiveStream(cid);
    const awaitingAsk = streamingHere && conversationHasPendingAgentAsk(cid);
    const submittingHere =
        chatComposerSubmitInFlight &&
        (chatComposerSubmitConvId === cid ||
            (chatComposerSubmitConvId === null && (cid === null || cid < 1)));
    if (streamingHere) {
        setChatComposerStreamingUi(mount, true, { pausedForAsk: awaitingAsk });
    } else {
        setChatComposerStreamingUi(mount, false);
        if (submittingHere) {
            setChatComposerBusy(mount, true, 'send');
        }
    }
}

/**
 * @param {HTMLElement | Document | null | undefined} mount
 * @returns {boolean}
 */
function isChatComposerBusy(mount) {
    const cid = activeConversationId;
    const submittingHere =
        chatComposerSubmitInFlight &&
        (chatComposerSubmitConvId === cid ||
            (chatComposerSubmitConvId === null && (cid === null || cid < 1)));
    if (submittingHere) return true;
    if (conversationHasActiveStream(cid)) return true;
    if (!(mount instanceof HTMLElement)) {
        mount = document.querySelector('[data-module="oaao-chat"]');
    }
    if (!(mount instanceof HTMLElement)) return false;
    const card = mount.querySelector('[data-oaao-chat="composer-card-wrap"]');
    return card instanceof HTMLElement && card.dataset.oaaoComposerBusy === 'send';
}

/**
 * Dim composer + block input while sending or streaming.
 *
 * @param {HTMLElement} mount
 * @param {boolean} busy
 * @param {'send' | 'stream' | null} [mode]
 */
function setChatComposerBusy(mount, busy, mode = null) {
    const card = mount.querySelector('[data-oaao-chat="composer-card-wrap"]');
    const input = mount.querySelector('[data-oaao-chat="input"]');
    const sendBtn = mount.querySelector('[data-oaao-chat="send"]');
    if (!(card instanceof HTMLElement)) return;

    if (busy && (mode === 'send' || mode === 'stream')) {
        card.dataset.oaaoComposerBusy = mode;
        card.setAttribute('aria-busy', 'true');
    } else {
        delete card.dataset.oaaoComposerBusy;
        card.removeAttribute('aria-busy');
    }

    if (input instanceof HTMLElement) {
        if (busy) {
            if (!input.dataset.oaaoComposerWasEditable) {
                input.dataset.oaaoComposerWasEditable = input.isContentEditable ? '1' : '0';
            }
            input.contentEditable = 'false';
            input.setAttribute('aria-disabled', 'true');
        } else {
            const was = input.dataset.oaaoComposerWasEditable;
            delete input.dataset.oaaoComposerWasEditable;
            input.contentEditable = was === '0' ? 'false' : 'true';
            input.removeAttribute('aria-disabled');
        }
    }

    const lockToolbar = busy && mode === 'send';
    for (const btn of mount.querySelectorAll(
        '[data-oaao-chat="composer-feature-toggles"] button, [data-oaao-chat="composer-registry-slots-left"] button, [data-oaao-chat="composer-registry-slots-actions"] button, [data-oaao-chat="composer-registry-extra-toolbar"] button',
    )) {
        if (btn instanceof HTMLButtonElement) {
            btn.disabled = lockToolbar;
        }
    }

    if (sendBtn instanceof HTMLButtonElement) {
        if (busy && mode === 'send') {
            sendBtn.disabled = true;
            sendBtn.dataset.oaaoComposerSending = '1';
            sendBtn.setAttribute('aria-busy', 'true');
        } else {
            delete sendBtn.dataset.oaaoComposerSending;
            sendBtn.removeAttribute('aria-busy');
            if (!(busy && mode === 'stream')) {
                sendBtn.disabled = false;
            }
        }
    }
}

/**
 * Send ↔ Stop while an assistant stream is active for this mount.
 *
 * @param {HTMLElement} mount
 * @param {boolean} streaming
 * @param {{ pausedForAsk?: boolean }} [opts]
 */
function setChatComposerStreamingUi(mount, streaming, opts = {}) {
    const sendBtn = mount.querySelector('[data-oaao-chat="send"]');
    if (!(sendBtn instanceof HTMLButtonElement)) return;
    const pausedForAsk = Boolean(opts.pausedForAsk);
    if (streaming) {
        sendBtn.dataset.oaaoChatStreaming = '1';
        sendBtn.disabled = false;
        sendBtn.setAttribute(
            'aria-label',
            pausedForAsk
                ? oaaoChatT('chat.agent_ask.waiting', 'Waiting for your confirmation…')
                : oaaoChatT('chat.stop_generation', 'Stop generating'),
        );
        sendBtn.classList.remove('bg-[#2d2d2d]');
        sendBtn.classList.add('bg-red-6');
        setChatComposerBusy(mount, !pausedForAsk, pausedForAsk ? 'ask' : 'stream');
    } else {
        delete sendBtn.dataset.oaaoChatStreaming;
        sendBtn.setAttribute('aria-label', oaaoChatT('chat.send_message', 'Send message'));
        sendBtn.classList.add('bg-[#2d2d2d]');
        sendBtn.classList.remove('bg-red-6');
        setChatComposerBusy(mount, false);
    }
}

/**
 * LLM tokens are done ({@code system/end}) — unlock composer immediately.
 * ACCS / persist / usage reporting continue in background; score pills poll in place.
 *
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {number | null} streamingMsgId
 */
function releaseChatStreamUiAfterRunEnd(mount, conversationId, streamingMsgId) {
    if (activeConversationId === conversationId) {
        chatComposerSubmitInFlight = false;
        chatComposerSubmitConvId = null;
        syncComposerBusyForActiveView(mount);
    }
    streamHandlesByConversation.delete(conversationId);
    runStatusLabelByConversation.delete(conversationId);
    if (streamingMsgId && streamingMsgId > 0) {
        hideRunStatusForMessage(mount, streamingMsgId);
    }
    if (
        conversationId > 0 &&
        activeConversationId === conversationId &&
        !conversationHasOpenRunTasks(conversationId)
    ) {
        scheduleTurnScorePoll(conversationId, mount, {
            assistantMessageId: streamingMsgId && streamingMsgId > 0 ? streamingMsgId : null,
            triggerRescore: true,
        });
    }
}

/**
 * Abort the browser reader for one conversation (new send / resume replaces same conv only).
 *
 * @param {number} conversationId
 * @param {string} [exceptRunId] When set, keep the handle if it matches this run id.
 */
function abortStreamReaderForConversation(conversationId, exceptRunId = '') {
    if (!conversationId || conversationId < 1) return;
    const entry = streamHandlesByConversation.get(conversationId);
    if (!entry) return;
    if (exceptRunId && entry.runId === exceptRunId) return;
    if (entry.runId) {
        void requestOrchestratorCancelRun(entry.runId);
    }
    const mount = document.querySelector('[data-module="oaao-chat"]');
    if (mount instanceof HTMLElement) {
        markOaaoRunTasksCancelled(mount, conversationId);
    }
    try {
        entry.controller.abort();
    } catch {
        /* ignore */
    }
    streamHandlesByConversation.delete(conversationId);
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

/** @type {ReadonlySet<string>} */
const OAAO_RUN_OPEN_TASK_STATUSES = new Set(['pending', 'active', 'running', 'awaiting_ask']);

/**
 * Pipeline still running — defer IQS/ACCS poll/rescore until tasks settle.
 *
 * @param {number | null | undefined} conversationId
 * @returns {boolean}
 */
function conversationHasOpenRunTasks(conversationId) {
    const cid = conversationId != null ? Math.floor(Number(conversationId)) : 0;
    if (!Number.isFinite(cid) || cid < 1) return false;
    if (conversationHasActiveStream(cid)) return true;
    const state = getOaaoTaskListStateForConversation(cid);
    if (!state?.items?.size) return false;
    for (const item of state.items.values()) {
        const st = String(item.status ?? '').toLowerCase();
        if (OAAO_RUN_OPEN_TASK_STATUSES.has(st)) return true;
    }
    return false;
}

/**
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {boolean}
 */
function assistantMetaRunIncomplete(meta) {
    if (!meta || typeof meta !== 'object') return false;
    const rs = String(meta.run_status ?? '').toLowerCase();
    if (rs === 'complete') return false;
    if (rs === 'cancelled') return false;
    if (rs === 'interrupted') return true;
    const dm = Number(meta.duration_ms);
    if (Number.isFinite(dm) && dm > 0) return false;
    const tasks = meta.tasks;
    if (!tasks || typeof tasks !== 'object') return false;
    const items = /** @type {Record<string, unknown>} */ (tasks).items;
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.some((raw) => {
        if (!raw || typeof raw !== 'object') return false;
        const st = String(/** @type {Record<string, unknown>} */ (raw).status ?? '').toLowerCase();
        return OAAO_RUN_OPEN_TASK_STATUSES.has(st);
    });
}

/**
 * @param {Record<string, unknown> | null | undefined} meta
 * @param {{ complete?: boolean, cancelled?: boolean, interrupted?: boolean }} flags
 * @returns {Record<string, unknown>}
 */
function finalizeRunMetaForPatch(meta, flags) {
    const out = meta && typeof meta === 'object' ? { ...meta } : {};
    if (flags.cancelled) {
        out.run_status = 'cancelled';
    } else if (flags.interrupted) {
        out.run_status = 'interrupted';
    } else if (flags.complete) {
        out.run_status = 'complete';
    }
    return out;
}

/**
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {string}
 */
/**
 * Retry / resume — material id for {@code active_material_id} (assistant meta → composer → task previews).
 *
 * @param {number} conversationId
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {string}
 */
function resolveSlideMaterialIdForRetry(conversationId, meta) {
    const fromMeta = slideMaterialIdFromAssistantMeta(meta);
    if (fromMeta) return fromMeta;
    const active = chatComposerActiveMaterial?.material_id;
    if (typeof active === 'string' && active.trim().startsWith('slide-')) {
        return active.trim();
    }
    if (conversationId > 0) {
        const state = getOaaoTaskListStateForConversation(conversationId);
        if (state) {
            for (const item of state.items.values()) {
                const tasks = item.agent_tasks;
                if (!Array.isArray(tasks)) continue;
                for (const at of tasks) {
                    if (!at?.preview || typeof at.preview !== 'object') continue;
                    const url = String(/** @type {Record<string, unknown>} */ (at.preview).preview_url ?? '').trim();
                    const parsed = parseOaaoSlidePreviewUrl(url);
                    if (parsed?.projectId) return `slide-${parsed.projectId}`;
                }
            }
        }
    }
    return '';
}

function slideMaterialIdFromAssistantMeta(meta) {
    if (!meta || typeof meta !== 'object') return '';
    const sp = meta.slide_project;
    if (sp && typeof sp === 'object') {
        const pid = String(/** @type {Record<string, unknown>} */ (sp).project_id ?? '').trim();
        if (pid) return `slide-${pid}`;
    }
    const materials = meta.materials;
    if (!Array.isArray(materials)) return '';
    for (const raw of materials) {
        if (!raw || typeof raw !== 'object') continue;
        const row = /** @type {Record<string, unknown>} */ (raw);
        const mid = String(row.material_id ?? '').trim();
        if (mid.startsWith('slide-')) return mid;
        if (String(row.kind ?? '') === 'slide_project') {
            const nested = row.meta;
            const pid2 =
                nested && typeof nested === 'object'
                    ? String(/** @type {Record<string, unknown>} */ (nested).project_id ?? '').trim()
                    : String(row.project_id ?? '').trim();
            if (pid2) return `slide-${pid2}`;
        }
    }
    return '';
}

/**
 * Best-effort: orchestrator keeps runs in memory only — 404/403 after restart means dead run.
 *
 * @param {string} streamUrl
 * @param {string} runId
 * @returns {Promise<boolean>}
 */
async function probeOrchestratorRunAlive(streamUrl, runId) {
    const su = typeof streamUrl === 'string' ? streamUrl.trim() : '';
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!su || !rid) return false;
    const u = new URL(await resolveChatOrchestratorStreamUrl(streamUrl), window.location.href);
    u.searchParams.set('run_id', rid);
    u.searchParams.set('since_seq', '999999');
    const sameOrigin = u.origin === window.location.origin;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    try {
        const res = await fetch(u.href, {
            method: 'GET',
            mode: 'cors',
            credentials: sameOrigin ? 'include' : 'omit',
            signal: ctrl.signal,
            headers: { Accept: 'text/event-stream' },
        });
        if (res.status === 404 || res.status === 403) return false;
        if (!res.ok) return false;
        try {
            res.body?.cancel?.();
        } catch {
            /* ignore */
        }
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @param {HTMLElement} outer
 */
function removeAssistantRunRetryBanner(outer) {
    outer.querySelector('[data-oaao-chat="run-retry-banner"]')?.remove();
}

/**
 * @param {HTMLElement} outer
 * @param {{ conversationId: number, assistantMessageId: number, onRetry: () => void | Promise<void>, signal?: AbortSignal }} opts
 */
function applyAssistantRunRetryBanner(outer, opts) {
    if (!(outer instanceof HTMLElement)) return;
    removeAssistantRunRetryBanner(outer);
    const wrap = document.createElement('div');
    wrap.dataset.oaaoChat = 'run-retry-banner';
    wrap.className = 'oaao-chat-run-retry-banner';
    wrap.setAttribute('role', 'status');
    const text = document.createElement('p');
    text.className = 'oaao-chat-run-retry-banner__text';
    text.textContent = oaaoChatT(
        'chat.run_retry.notice',
        'This run stopped before it finished (connection lost or service restarted).',
    );
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'oaao-chat-run-retry-banner__btn';
    btn.textContent = oaaoChatT('chat.run_retry.action', 'Retry');
    btn.addEventListener(
        'click',
        () => {
            btn.disabled = true;
            void Promise.resolve(opts.onRetry())
                .catch(() => {
                    toastOaao(oaaoChatT('chat.run_retry.failed', 'Retry failed — try sending again.'));
                })
                .finally(() => {
                    btn.disabled = false;
                });
        },
        opts.signal ? { signal: opts.signal } : undefined,
    );
    wrap.append(text, btn);
    const toolbar = outer.querySelector('.oaao-chat-assistant-toolbar');
    if (toolbar) outer.insertBefore(wrap, toolbar);
    else outer.append(wrap);
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
 * @param {string} s
 * @param {number} max
 */
function truncateRunStatusLabel(s, max = 56) {
    const t = String(s ?? '').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** @param {number | string | null | undefined} ms */
function formatOaaoDurationMs(ms) {
    const n = typeof ms === 'number' && Number.isFinite(ms) ? ms : Number.parseInt(String(ms ?? '').trim(), 10);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n >= 10_000) return `${(n / 1000).toFixed(1)}s`;
    if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
    return `${Math.round(n)}ms`;
}

/** @param {Record<string, unknown> | null | undefined} timing */
function collectOaaoPipelineTimingLines(timing) {
    /** @type {string[]} */
    const lines = [];
    if (!timing || typeof timing !== 'object') return lines;
    appendOaaoPipelineTimingActivity(timing, (text) => lines.push(text));
    return lines;
}

/**
 * Multi-line tooltip for run meta info icon.
 *
 * @param {Record<string, unknown> | null | undefined} timing
 * @param {number | string | null | undefined} [durationMs]
 */
function formatPipelineTimingTooltip(timing, durationMs) {
    const lines = collectOaaoPipelineTimingLines(timing);
    const total = formatOaaoDurationMs(durationMs);
    if (total) lines.push(`[run] Total wall time — ${total}`);
    return lines.join('\n');
}

/** @param {Record<string, unknown> | null | undefined} timing */
function appendOaaoPipelineTimingActivity(timing, appendLine) {
    if (!timing || typeof timing !== 'object' || typeof appendLine !== 'function') return;
    const thinking = formatOaaoDurationMs(timing.thinking_ms);
    if (thinking) appendLine(`[preflight] Thinking (IQS + plan) — ${thinking}`);
    const phases = Array.isArray(timing.phases) ? timing.phases : [];
    for (const raw of phases) {
        if (!raw || typeof raw !== 'object') continue;
        const row = /** @type {Record<string, unknown>} */ (raw);
        const label = String(row.name ?? 'phase');
        const dur = formatOaaoDurationMs(row.duration_ms);
        if (!dur) continue;
        appendLine(`[preflight] ${label} — ${dur}`);
    }
    const tasks = Array.isArray(timing.tasks) ? timing.tasks : [];
    for (const raw of tasks) {
        if (!raw || typeof raw !== 'object') continue;
        const row = /** @type {Record<string, unknown>} */ (raw);
        const title = String(row.title ?? row.id ?? 'task');
        const dur = formatOaaoDurationMs(row.duration_ms);
        if (!dur) continue;
        appendLine(`[task] ${title} — ${dur}`);
    }
}

/**
 * Map orchestrator SSE envelope → user-visible run status (Thinking / Planning / Working / …).
 *
 * @param {Record<string, unknown>} data
 * @returns {string | null} `null` = keep previous label
 */
function runStatusLabelFromEnvelope(data) {
    const phase =
        typeof data.phase === 'string' ? data.phase.toLowerCase() : String(data.phase ?? '').toLowerCase();
    const kind =
        typeof data.kind === 'string' ? data.kind.toLowerCase() : String(data.kind ?? '').toLowerCase();
    const text = streamEnvelopeText(data).trim();
    const raw = text.toLowerCase();
    const payload =
        data.payload && typeof data.payload === 'object'
            ? /** @type {Record<string, unknown>} */ (data.payload)
            : null;

    if (phase === 'system') {
        if (kind === 'error') return null;
        if (raw === 'llm_request_start') return 'Thinking…';
        if (raw === 'plan_build_start') return 'Planning…';
        if (raw === 'pipeline_stub') return 'Preparing…';
        if (raw === 'llm_call_skipped') return 'Working…';
        if (raw === 'run_cancelled') return 'Cancelled';
        if (text) return truncateRunStatusLabel(text);
        return 'Working…';
    }

    if (phase === 'task') {
        if (kind === 'status') {
            if (raw === 'task_plan') return 'Planning…';
            if (raw === 'vault_rag_ready') return 'Retrieved context';
            if (raw === 'tasks_appended' || raw === 'report_result') return 'Planning next steps…';
            if (raw === 'slide_fanout_skeleton') return 'Building slides in parallel…';
            if (raw === 'run_cancelled') return 'Cancelled';
            return 'Planning…';
        }
        if (kind === 'ask' || raw === 'agent_ask') {
            return oaaoChatT('chat.agent_ask.waiting', 'Waiting for your confirmation…');
        }
        if (kind === 'start') {
            const rt = payload?.run_task;
            const title =
                rt && typeof rt === 'object'
                    ? String(/** @type {Record<string, unknown>} */ (rt).title ?? '').trim()
                    : '';
            return title ? `Working — ${truncateRunStatusLabel(title)}` : 'Working…';
        }
        return null;
    }

    if (phase === 'rag') {
        const at = payload?.agent_task;
        const sub =
            at && typeof at === 'object'
                ? String(/** @type {Record<string, unknown>} */ (at).title ?? '').trim()
                : '';
        return sub ? truncateRunStatusLabel(sub) : 'Searching knowledge base…';
    }

    if (OAAO_TASK_AGENT_PHASES.has(phase)) {
        const at = payload?.agent_task;
        const sub =
            at && typeof at === 'object'
                ? String(/** @type {Record<string, unknown>} */ (at).title ?? '').trim()
                : '';
        if (sub) return truncateRunStatusLabel(sub);
        if (phase === 'sandbox') return 'Running code…';
        if (phase === 'web_search') return 'Searching the web…';
        if (phase === 'mcp') return 'Using integrations…';
        return 'Working…';
    }

    if (phase === 'llm' && kind === 'delta') return 'Writing…';

    return null;
}

/**
 * Once assistant text is visible, suppress stale run-status chips (e.g. task/end re-showing
 * {@code Writing…} while ACCS / {@code system/end} is still in flight).
 *
 * @param {string | null | undefined} label
 * @param {string} accText
 */
function shouldShowRunStatusWhileStreaming(label, accText) {
    if (!label || !String(label).trim()) return false;
    if (!String(accText ?? '').trim()) return true;
    const l = String(label).trim();
    if (l === 'Cancelled') return true;
    if (l.includes('Waiting for your confirmation')) return true;
    return false;
}

/**
 * @param {HTMLElement | Document} root
 * @param {number} msgId
 * @returns {HTMLElement | null}
 */
function getAssistantBubbleForMessage(root, msgId) {
    if (!msgId || msgId < 1) return null;
    const host = root.querySelector('[data-oaao-chat="messages"]');
    if (!(host instanceof HTMLElement)) return null;
    const bubble = host.querySelector(`[data-oaao-msg-id="${msgId}"][data-oaao-msg-role="assistant"]`);
    return bubble instanceof HTMLElement ? bubble : null;
}

/**
 * @param {HTMLElement | Document} root
 * @param {number} msgId
 * @param {string} label
 */
function showRunStatusForMessage(root, msgId, label) {
    const bubble = getAssistantBubbleForMessage(root, msgId);
    if (!bubble || !label) return;

    let wrap = bubble.querySelector(':scope > .oaao-chat-run-status');
    if (!(wrap instanceof HTMLElement)) {
        wrap = document.createElement('div');
        wrap.className = 'oaao-chat-run-status';
        wrap.setAttribute('role', 'status');
        wrap.setAttribute('aria-live', 'polite');
        const dot = document.createElement('span');
        dot.className = 'oaao-chat-run-status-dot';
        dot.setAttribute('aria-hidden', 'true');
        const lbl = document.createElement('span');
        lbl.className = 'oaao-chat-run-status-label';
        wrap.append(dot, lbl);
        bubble.prepend(wrap);
    }
    const lblEl = wrap.querySelector('.oaao-chat-run-status-label');
    if (lblEl instanceof HTMLElement) {
        lblEl.textContent = label;
    }
    wrap.classList.remove('hidden');
    bubble.classList.add('oaao-chat-run-status-active');
}

/**
 * @param {HTMLElement | Document} root
 * @param {number} msgId
 */
function hideRunStatusForMessage(root, msgId) {
    const bubble = getAssistantBubbleForMessage(root, msgId);
    if (!bubble) return;
    bubble.querySelector(':scope > .oaao-chat-run-status')?.remove();
    bubble.classList.remove('oaao-chat-run-status-active');
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

/** Globe — web search toggle (Lucide-style stroke, no icon font). */
function buildOaaoComposerToggleGlobeIcon() {
    const svg = oaaoChatStrokeSvgShell('w-[18px] h-[18px]');
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    const meridian = document.createElementNS(SVG_NS, 'path');
    meridian.setAttribute(
        'd',
        'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
    );
    const equator = document.createElementNS(SVG_NS, 'path');
    equator.setAttribute('d', 'M2 12h20');
    svg.append(circle, meridian, equator);
    return svg;
}

/** Route / branch — planner steps toggle. */
function buildOaaoComposerTogglePlannerIcon() {
    const svg = oaaoChatStrokeSvgShell('w-[18px] h-[18px]');
    const a = document.createElementNS(SVG_NS, 'circle');
    a.setAttribute('cx', '6');
    a.setAttribute('cy', '19');
    a.setAttribute('r', '3');
    const b = document.createElementNS(SVG_NS, 'circle');
    b.setAttribute('cx', '18');
    b.setAttribute('cy', '5');
    b.setAttribute('r', '3');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15');
    svg.append(a, path, b);
    return svg;
}

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

/** @param {string} [sizeCls] */
function buildChatAttachmentClipIconSvg(sizeCls = 'w-[11px] h-[11px]') {
    const svg = oaaoChatStrokeSvgShell(sizeCls);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute(
        'd',
        'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
    );
    svg.append(path);
    return svg;
}

/**
 * Inline stroke SVG for attachment pills — chat shell does not load Remix Icon fonts.
 *
 * @param {string} kind
 * @param {string} [sizeCls]
 */
function buildChatAttachmentKindIconSvg(kind, sizeCls = 'w-[11px] h-[11px]') {
    const svg = oaaoChatStrokeSvgShell(sizeCls);
    const k = String(kind ?? '').toLowerCase();
    if (k === 'image') {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('width', '18');
        rect.setAttribute('height', '18');
        rect.setAttribute('x', '3');
        rect.setAttribute('y', '3');
        rect.setAttribute('rx', '2');
        rect.setAttribute('ry', '2');
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '9');
        circle.setAttribute('cy', '9');
        circle.setAttribute('r', '2');
        const mount = document.createElementNS(SVG_NS, 'path');
        mount.setAttribute('d', 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21');
        svg.append(rect, circle, mount);
        return svg;
    }
    if (k === 'audio') {
        const mic = document.createElementNS(SVG_NS, 'path');
        mic.setAttribute('d', 'M12 19v3');
        const wave = document.createElementNS(SVG_NS, 'path');
        wave.setAttribute('d', 'M19 10v2a7 7 0 0 1-14 0v-2');
        const body = document.createElementNS(SVG_NS, 'rect');
        body.setAttribute('x', '9');
        body.setAttribute('y', '2');
        body.setAttribute('width', '6');
        body.setAttribute('height', '13');
        body.setAttribute('rx', '3');
        svg.append(mic, wave, body);
        return svg;
    }
    if (k === 'other') {
        return buildChatAttachmentClipIconSvg(sizeCls);
    }
    const file = document.createElementNS(SVG_NS, 'path');
    file.setAttribute('d', 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z');
    const fold = document.createElementNS(SVG_NS, 'path');
    fold.setAttribute('d', 'M14 2v4h4');
    svg.append(file, fold);
    if (k === 'text') {
        for (const d of ['M10 9H8', 'M16 13H8', 'M16 17H8']) {
            const line = document.createElementNS(SVG_NS, 'path');
            line.setAttribute('d', d);
            svg.append(line);
        }
    }
    return svg;
}

/** @type {AbortController | null} */
let panelAbort = null;

/** @type {Array<{ id: number, title?: string, archived?: number, mode?: string }>} */
let cachedConversations = [];

/** Re-paint {@code #workspace-conversation-list} after mode changes (set in {@link mountShellPanel}). */
/** @type {(() => void) | null} */
let conversationSidebarRenderFn = null;

let showArchivedConversations = false;

/** @type {number | null} */
let activeConversationId = null;

/** Persist open thread in the location bar — restored on full page reload. */
const CHAT_CONVERSATION_QUERY_KEY = 'conversation_id';

/**
 * @returns {number | null}
 */
function readChatConversationIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get(CHAT_CONVERSATION_QUERY_KEY);
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * @param {number | null} conversationId
 * @param {{ replace?: boolean }} [opts]
 */
function syncChatConversationUrl(conversationId, opts = {}) {
    const u = new URL(window.location.href);
    const cid =
        conversationId != null && Number(conversationId) > 0
            ? Math.floor(Number(conversationId))
            : null;
    if (cid) {
        u.searchParams.set(CHAT_CONVERSATION_QUERY_KEY, String(cid));
    } else {
        u.searchParams.delete(CHAT_CONVERSATION_QUERY_KEY);
    }
    const qs = u.searchParams.toString();
    const next = `${u.pathname}${qs ? `?${qs}` : ''}${u.hash}`;
    const prev =
        window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    const state = { ...prev, chatConversationId: cid };
    if (opts.replace === true) {
        window.history.replaceState(state, '', next);
    } else {
        window.history.pushState(state, '', next);
    }
}

/** Latest rows from {@link loadMessages} — used for run retry. */
/** @type {Array<{ id?: number, role?: string, content?: string, meta?: unknown, feedback?: string }>} */
let cachedMessageRows = [];

/** @type {ResizeObserver | null} */
let chatComposerStackObserver = null;

/** Structured vault / folder / embedded-file picks — forwarded on {@code POST /chat/api/send} as {@code vault_source_refs}; deduped vault ids also as {@code vault_source_ids}. */
/** @type {ChatVaultSourceRefPayload[]} */
let chatComposerVaultSourceRefs = [];

const CHAT_SCOPE_AUTO_RAG_KEY = 'oaao_chat_scope_auto_rag';
const CHAT_VAULT_SOURCE_REFS_KEY = 'oaao_vault_chat_source_refs';
/** Must match {@code slide-template-api.js CHAT_PENDING_SLIDE_TEMPLATE_KEY}. */
const CHAT_PENDING_SLIDE_TEMPLATE_KEY = 'oaao_chat_pending_slide_template';

/** When true and there are no explicit file/folder/vault picks, {@code POST /chat/api/send} expands to all vaults in the active workspace/personal scope. */
let chatComposerVaultAutoRag = true;

/**
 * Vault scope flags for {@code POST /chat/api/send} (composer picks + auto RAG).
 *
 * @returns {Record<string, unknown>}
 */
function buildChatVaultSendExtra() {
    /** @type {Record<string, unknown>} */
    const vaultSendExtra = {};
    if (chatComposerVaultSourceRefs.length > 0) {
        vaultSendExtra.vault_source_refs = chatComposerVaultSourceRefs;
        /** @type {number[]} */
        const vaultIdsDedup = [];
        const seenVid = new Set();
        for (const r of chatComposerVaultSourceRefs) {
            const v = Number(r.vault_id);
            if (!Number.isFinite(v) || v < 1 || seenVid.has(v)) continue;
            seenVid.add(v);
            vaultIdsDedup.push(v);
        }
        vaultIdsDedup.sort((a, b) => a - b);
        vaultSendExtra.vault_source_ids = vaultIdsDedup;
    }
    if (chatComposerVaultSourceRefs.length === 0 && chatComposerVaultAutoRag) {
        vaultSendExtra.vault_auto_rag = true;
    }

    return vaultSendExtra;
}

/** Ephemeral attachments for the current composer turn ({@code cp.rag.attachment}). */
/** @type {Array<{ id: number, file_name: string, mime_type: string, kind: string, byte_size: number }>} */
let chatComposerAttachments = [];

/** Landing hero vs in-thread — keep landing while drafting attachments before first send. */
function shouldUseChatLandingLayout() {
    if (activeConversationId === null) return true;
    return (
        Array.isArray(cachedMessageRows) &&
        cachedMessageRows.length === 0 &&
        chatComposerAttachments.length > 0
    );
}

/** Active slide deck for continuation ({@code active_material_id} on send). */
/** @type {{ material_id: string, title: string } | null} */
let chatComposerActiveMaterial = null;

/** Published slide template for the next deck ({@code slide_template_id} on send). */
/** @type {{ template_id: string, label: string, thumb_url?: string } | null} */
let chatComposerActiveSlideTemplate = null;

/**
 * Latest completed slide deck in thread — powers Slide deck Mode + pinned materials.
 * @type {{ conversationId: number, messageId: number, projectId: string, deckTitle: string, slides: Array<Record<string, unknown>> } | null}
 */
let chatComposerSlideDeckContext = null;

/** @type {HTMLButtonElement | null} */
let chatComposerPinnedMaterialsBtn = null;

/**
 * @returns {ChatVaultSourceRefPayload[]}
 */
function readStoredVaultChatSourceRefs() {
    try {
        const raw = sessionStorage.getItem(CHAT_VAULT_SOURCE_REFS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        /** @type {ChatVaultSourceRefPayload[]} */
        const out = [];
        for (const row of parsed) {
            if (!row || typeof row !== 'object') continue;
            const kind = String(row.kind ?? '');
            if (kind !== 'vault' && kind !== 'folder' && kind !== 'document') continue;
            const id = Math.floor(Number(row.id ?? 0));
            const vaultId = Math.floor(Number(row.vault_id ?? 0));
            if (!Number.isFinite(id) || id < 1 || !Number.isFinite(vaultId) || vaultId < 1) continue;
            out.push({
                kind: /** @type {'vault'|'folder'|'document'} */ (kind),
                id,
                vault_id: vaultId,
                name: typeof row.name === 'string' ? row.name : '',
            });
            if (out.length >= 24) break;
        }

        return out;
    } catch {
        return [];
    }
}

function persistVaultChatSourceRefs(refs) {
    try {
        sessionStorage.setItem(CHAT_VAULT_SOURCE_REFS_KEY, JSON.stringify(refs.slice(0, 24)));
    } catch {
        /* ignore */
    }
}

/**
 * @param {'toggle_label' | 'toggle_aria'} key
 */
function chatVaultAutoRagUiString(key) {
    const locale = typeof document !== 'undefined' ? document.documentElement.lang || 'en' : 'en';
    const isZh = /^zh/i.test(locale);
    const t = {
        toggle_label: {
            en: 'Auto vault RAG',
            'zh-Hant': '自動保管庫 RAG',
        },
        toggle_aria: {
            en: 'When Auto Source is active (no manual picks), search all vaults in this workspace scope on send',
            'zh-Hant': '「自動來源」且未手動選檔時，送出訊息會搜尋此工作區內所有保管庫',
        },
    };
    const pack = t[key];
    if (!pack) return '';

    return (isZh ? pack['zh-Hant'] : pack.en) ?? pack.en;
}

/**
 * @param {Record<string, unknown>} [payload]
 */
function applyChatHistorySettingsFromPayload(payload) {
    const raw = payload?.history_page_size;
    const min = Number(payload?.history_page_size_min ?? 3);
    const max = Number(payload?.history_page_size_max ?? 10);
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    chatHistoryPageSize = Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Load user chat history page size (Preferences → Chat → General). */
async function loadChatHistorySettings() {
    try {
        const { res, data } = await chatFetchJson(chatApiUrl('chat_preferences', workspaceChatQueryParams()));
        if (res.ok && data?.success && data.data && typeof data.data === 'object') {
            applyChatHistorySettingsFromPayload(/** @type {Record<string, unknown>} */ (data.data));
        }
    } catch {
        /* keep default */
    }
}

function readVaultAutoRagPreference() {
    try {
        const v = localStorage.getItem(CHAT_SCOPE_AUTO_RAG_KEY);
        if (v === null) return true;

        return v === '1';
    } catch {
        return true;
    }
}

/**
 * Tear down chat shell wiring in {@code workspace-module-mount}.
 *
 * When {@code preserveConversationSidebar} is true (SPA navigating away from Chat → e.g. Vault), abort streams/observers but keep
 * {@code #workspace-conversation-list} + cache so the shell sidebar stays populated — core sidebar is workspace-scoped chrome.
 *
 * @param {{ preserveConversationSidebar?: boolean }} [options]
 */
export function teardownShellPanel(options = {}) {
    const preserveConversationSidebar = options.preserveConversationSidebar === true;

    abortAllStreamReaders();
    chatComposerSubmitInFlight = false;
    chatComposerSubmitConvId = null;
    chatComposerStackObserver?.disconnect();
    chatComposerStackObserver = null;
    chatComposerReserveSyncFn = null;
    panelAbort?.abort();
    panelAbort = null;
    conversationSidebarRenderFn = null;
    closeOpenConvoMenuPanel();

    if (!preserveConversationSidebar) {
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
}

/**
 * @param {HTMLElement} mount Host from core ({@code #workspace-module-mount}) containing injected panel HTML.
 */
export async function mountShellPanel(mount) {
    globalThis.chatFetchJson = chatFetchJson;
    globalThis.chatApiUrl = chatApiUrl;
    globalThis.chatApiBase = chatApiBase;

    chatMd = await loadChatMarkdownHelpers();
    ensureChatShellCss();
    for (const pill of document.querySelectorAll('[data-oaao-turn-score-pill]')) {
        if (pill instanceof HTMLElement) ensureTurnScorePillFloater(pill);
    }
    void preloadOaaoMilestoneCtor();
    teardownShellPanel();
    panelAbort = new AbortController();
    const { signal } = panelAbort;
    chatComposerVaultAutoRag = readVaultAutoRagPreference();
    chatComposerVaultSourceRefs = readStoredVaultChatSourceRefs();
    chatComposerAttachments = [];
    chatComposerActiveMaterial = null;
    chatComposerActiveSlideTemplate = null;
    chatComposerSlideDeckContext = null;
    await loadChatHistorySettings();
    window.addEventListener(
        'oaao:chat-history-settings-changed',
        (ev) => {
            const detail = ev instanceof CustomEvent ? ev.detail : null;
            if (detail && typeof detail === 'object') {
                applyChatHistorySettingsFromPayload(/** @type {Record<string, unknown>} */ (detail));
            }
        },
        { signal },
    );

    /** Shell section — {@code oaao-chat-shell.css} pairs {@code .oaao-chat-root--in-thread} with {@code .oaao-chat-root}. */
    const chatRootEl = mount.querySelector('.oaao-chat-root') ?? mount;
    if (chatRootEl instanceof HTMLElement) {
        chatRootEl.dataset.oaaoChatPanelRev = OAAO_CHAT_SHELL_ASSET_REV;
    }

    const whenEmptyEl = mount.querySelector('[data-oaao-chat="when-empty"]');
    const promptGridEl = mount.querySelector('[data-oaao-chat="prompt-grid"]');
    const composerRegionEl = mount.querySelector('[data-oaao-chat="composer-region"]');
    const composerDockEl = mount.querySelector('[data-oaao-chat="composer-dock"]');
    const composerShellEl = mount.querySelector('[data-oaao-chat="composer-shell"]');
    const threadWrapEl = mount.querySelector('[data-oaao-chat="thread-wrap"]');
    const activityEl = mount.querySelector('[data-oaao-chat="activity"]');
    const messagesEl = mount.querySelector('[data-oaao-chat="messages"]');
    const formEl = mount.querySelector('[data-oaao-chat="composer"]');
    const composerCardWrapEl = mount.querySelector('[data-oaao-chat="composer-card-wrap"]');
    const inputEl = mount.querySelector('[data-oaao-chat="input"]');
    const sendBtn = mount.querySelector('[data-oaao-chat="send"]');
    const threadToolbarEl = mount.querySelector('[data-oaao-chat="thread-toolbar"]');
    const shareThreadBtn = mount.querySelector('[data-oaao-chat="share-thread"]');
    const archiveThreadBtn = mount.querySelector('[data-oaao-chat="archive-thread"]');
    const deleteThreadBtn = mount.querySelector('[data-oaao-chat="delete-thread"]');

    if (!messagesEl || !formEl || !inputEl || !sendBtn) {
        return;
    }

    void loadInlineCitationsMod().then((mod) => {
        if (typeof mod.bindInlineCitationHoverRoot !== 'function') return;
        const citeRoot = threadWrapEl instanceof HTMLElement ? threadWrapEl : messagesEl;
        mod.bindInlineCitationHoverRoot(citeRoot, (outer) => inlineCitationMapsByOuter.get(outer) ?? null);
    });

    document.addEventListener(
        'visibilitychange',
        () => {
            if (document.visibilityState !== 'visible') return;
            const cid = Number(activeConversationId);
            if (!Number.isFinite(cid) || cid < 1) return;
            if (conversationHasOpenRunTasks(cid)) return;
            scheduleTurnScorePoll(cid, mount, { triggerRescore: true });
        },
        { signal },
    );

    syncChatComposerChips(mount);
    restoreChatPendingSlideTemplateFromStorage(mount);
    if (isChatComposerEditorEl(inputEl)) {
        mountChatComposerEditor(inputEl, signal, {
            onTemplateRemoved: () => {
                chatComposerActiveSlideTemplate = null;
                try {
                    sessionStorage.removeItem(CHAT_PENDING_SLIDE_TEMPLATE_KEY);
                } catch {
                    /* ignore */
                }
                syncChatComposerChips(mount);
            },
            onTemplateInserted: (hit) => {
                chatComposerActiveSlideTemplate = {
                    template_id: hit.template_id,
                    label: hit.label,
                    thumb_url: hit.thumb_url,
                };
                try {
                    sessionStorage.setItem(
                        CHAT_PENDING_SLIDE_TEMPLATE_KEY,
                        JSON.stringify({
                            template_id: hit.template_id,
                            label: hit.label,
                            thumb_url: hit.thumb_url ?? '',
                        }),
                    );
                } catch {
                    /* ignore */
                }
                renderChatComposerActiveTemplateChip(mount);
            },
            resolveTemplateSlug: resolvePublishedSlideTemplateSlug,
        });
    }

    document.addEventListener(
        'oaao-select-slide-template',
        (ev) => {
            const detail = /** @type {CustomEvent<{ template_id?: string, label?: string, thumb_url?: string, row?: Record<string, unknown> }>} */ (
                ev
            ).detail;
            if (!detail || typeof detail !== 'object') return;
            const tid = String(detail.template_id ?? '');
            const row = detail.row && typeof detail.row === 'object' ? detail.row : null;
            let thumb = typeof detail.thumb_url === 'string' ? detail.thumb_url : '';
            if (!thumb && row) {
                void loadChatSlideTemplateApi().then((api) => {
                    thumb = api.templateThumbUrl(row);
                    setChatComposerActiveSlideTemplate(
                        tid,
                        typeof detail.label === 'string' ? detail.label : undefined,
                        thumb,
                    );
                });
                return;
            }
            setChatComposerActiveSlideTemplate(
                tid,
                typeof detail.label === 'string' ? detail.label : undefined,
                thumb || undefined,
            );
        },
        { signal },
    );

    document.addEventListener(
        'oaao-continue-slide-material',
        (ev) => {
            const detail = /** @type {CustomEvent<{ material_id?: string, title?: string }>} */ (ev).detail;
            if (!detail || typeof detail !== 'object') return;
            setChatComposerActiveMaterial(
                String(detail.material_id ?? ''),
                typeof detail.title === 'string' ? detail.title : undefined,
            );
        },
        { signal },
    );

    document.addEventListener(
        'oaao-open-slide-deck',
        (ev) => {
            const detail = /** @type {CustomEvent<Record<string, unknown>>} */ (ev).detail;
            void import(/* webpackIgnore: true */ oaaoPrefixedSitePath('/webassets/chat/default/js/slide-deck-viewer.js'))
                .then((mod) => {
                    if (mod && typeof mod.openSlideDeckViewerFromEvent === 'function') {
                        return mod.openSlideDeckViewerFromEvent(detail || {});
                    }
                    return undefined;
                })
                .catch(() => {});
        },
        { signal },
    );

    const onVaultSourcesChange = (refs) => {
        chatComposerVaultSourceRefs = refs;
        persistVaultChatSourceRefs(refs);
    };
    mountChatComposerBuiltInVaultUi(mount, signal, onVaultSourcesChange);

    const composerFeatureToggles = mount.querySelector('[data-oaao-chat="composer-feature-toggles"]');
    if (composerFeatureToggles instanceof HTMLElement) {
        mountChatComposerFeatureToggles(composerFeatureToggles, signal);
    }

    /** @param {string} msg */
    const composerToast = (msg) => {
        void loadOaaoToastHelper().then((fire) => {
            if (typeof fire === 'function') fire(msg, { duration: 3600, position: 'bottom-right' });
        });
    };

    mountChatComposerRegistrySlots(mount, signal, onVaultSourcesChange, {
        getConversationId: () => activeConversationId,
        chatFetchJson,
        chatApiUrl,
        workspaceChatBodyFields,
        onAttachmentsChange: (items) => {
            chatComposerAttachments = Array.isArray(items)
                ? items.map((row) => ({
                      id: Number(row.id ?? 0),
                      file_name: String(row.file_name ?? 'attachment'),
                      mime_type: String(row.mime_type ?? ''),
                      kind: String(row.kind ?? 'other'),
                      byte_size: Number(row.byte_size ?? 0),
                  }))
                : [];
            renderChatComposerAttachmentChips(mount);
            if (typeof mount.__oaaoUpdateChatLayout === 'function') {
                mount.__oaaoUpdateChatLayout();
            }
        },
        getAttachmentItems: () => chatComposerAttachments.slice(),
        onTranscribed: (text) => {
            if (!isChatComposerEditorEl(inputEl)) return;
            appendChatComposerEditorText(inputEl, text);
        },
        toast: composerToast,
    });
    if (chatComposerVaultSourceRefs.length > 0) {
        document.dispatchEvent(
            new CustomEvent('oaao:vault-chat-sources-changed', {
                bubbles: true,
                detail: { refs: chatComposerVaultSourceRefs },
            }),
        );
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

    /** In-thread: scroll {@code thread-wrap}; landing: {@code messages} (no overflow). */
    function getChatScrollEl() {
        if (activeConversationId !== null && threadWrapEl && !threadWrapEl.hidden) {
            return threadWrapEl;
        }
        return messagesEl;
    }

    const taskListStripEl = mount.querySelector('[data-oaao-chat="task-list-strip"]');
    bindOaaoTaskPanelChromeOnce(mount);
    mountWorkspaceAgentRail();

    function syncThreadComposerReserve() {
        if (!(chatRootEl instanceof HTMLElement)) return;
        const inThread = activeConversationId !== null;
        chatRootEl.style.removeProperty('--oaao-thread-composer-stack');
        const scrollbarInset =
            inThread && threadWrapEl instanceof HTMLElement
                ? Math.max(0, threadWrapEl.offsetWidth - threadWrapEl.clientWidth)
                : 0;
        const insetPx = `${scrollbarInset}px`;
        chatRootEl.style.setProperty('--oaao-thread-scrollbar-inset', insetPx);
        if (composerRegionEl instanceof HTMLElement) {
            composerRegionEl.style.setProperty('--oaao-thread-scrollbar-inset', insetPx);
            if (inThread) {
                composerRegionEl.style.paddingRight = insetPx;
            } else {
                composerRegionEl.style.removeProperty('padding-right');
            }
        }
        if (!inThread) {
            chatRootEl.classList.remove('oaao-chat-root--task-strip-visible');
            return;
        }
        const taskInSidePanel =
            taskListStripEl instanceof HTMLElement &&
            !taskListStripEl.hidden &&
            !taskListStripEl.classList.contains('hidden') &&
            Boolean(taskListStripEl.closest('[data-oaao-chat="task-panel"]'));
        chatRootEl.classList.toggle('oaao-chat-root--task-panel-open', taskInSidePanel);
        const scrollEl = getChatScrollEl();
        if (scrollEl instanceof HTMLElement && messagesPinnedToBottom(scrollEl)) {
            requestAnimationFrame(() => messagesScrollToBottom(scrollEl));
        }
    }

    chatComposerReserveSyncFn = syncThreadComposerReserve;

    function setupComposerStackObserver() {
        if (typeof ResizeObserver === 'undefined') return;
        chatComposerStackObserver?.disconnect();
        chatComposerStackObserver = new ResizeObserver(() => {
            syncThreadComposerReserve();
        });
        const observeTargets = [composerDockEl, taskListStripEl, composerCardWrapEl, threadWrapEl, messagesEl].filter(
            (el) => el instanceof HTMLElement,
        );
        if (!observeTargets.length) return;
        for (const el of observeTargets) {
            chatComposerStackObserver.observe(el);
        }
    }

    function syncThreadToolbarStates() {
        const open = activeConversationId !== null && activeConversationId > 0;
        if (threadToolbarEl instanceof HTMLElement) {
            threadToolbarEl.classList.toggle('hidden', !open);
            /* Single source: {@code oaao-chat-shell.css}; drop stale inline bg from older builds. */
            threadToolbarEl.style.removeProperty('background');
            threadToolbarEl.style.removeProperty('background-color');
            threadToolbarEl.style.removeProperty('background-image');
        }
        syncChatComposerPlannerModeSelect();
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
                ...workspaceChatBodyFields(),
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

    /**
     * @param {number} conversationId
     * @param {number} assistantMsgId
     */
    async function retryInterruptedAssistantRun(conversationId, assistantMsgId) {
        if (!conversationId || conversationId < 1 || !assistantMsgId || assistantMsgId < 1) return;
        if (chatComposerSubmitInFlight || isChatComposerBusy(mount)) return;
        const retryOuter = messagesEl
            .querySelector(`[data-oaao-msg-id="${assistantMsgId}"]`)
            ?.closest('.oaao-chat-assistant-row');
        if (retryOuter instanceof HTMLElement) {
            removeAssistantRunRetryBanner(retryOuter);
        }
        await loadMessages(conversationId, 'auto');
        const rows = cachedMessageRows;
        const idx = rows.findIndex((m) => coercePositiveInt(m.id) === assistantMsgId);
        const prompt = idx >= 0 ? findPrevUserPrompt(rows, idx) : '';
        if (!prompt) {
            toastOaao(oaaoChatT('chat.run_retry.no_prompt', 'No user message to retry.'));
            return;
        }
        const metaRow = idx >= 0 && rows[idx]?.meta && typeof rows[idx].meta === 'object'
            ? /** @type {Record<string, unknown>} */ (rows[idx].meta)
            : null;
        const materialId = resolveSlideMaterialIdForRetry(conversationId, metaRow);
        clearStreamCursor(conversationId);
        abortStreamReaderForConversation(conversationId);
        clearOaaoTaskListStrip(mount, true);
        oaaoFreshRunByConv.add(conversationId);
        chatComposerSubmitConvId = conversationId;
        chatComposerSubmitInFlight = true;
        setChatComposerBusy(mount, true, 'send');
        try {
            /** @type {Record<string, unknown>} */
            const vaultSendExtra = buildChatVaultSendExtra();
            if (chatComposerWebSearchEnabled) {
                vaultSendExtra.enable_web_search = true;
            }
            if (materialId) {
                vaultSendExtra.active_material_id = materialId;
            }
            vaultSendExtra.reuse_grounding_message_id = assistantMsgId;
            const { res, data, raw, parseError } = await chatFetchJson(chatApiUrl('send'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation_id: conversationId,
                    content: prompt,
                    chat_endpoint_id: getWorkspaceChatEndpointIdForSend(),
                    ...vaultSendExtra,
                    ...(conversationId && conversationId > 0
                        ? chatScopeBodyFieldsForConversation(conversationId)
                        : workspaceChatBodyFields()),
                }),
            });
            if (!res.ok || data.success !== true) {
                toastOaao(
                    formatChatApiError(res, data, raw, parseError) ||
                        oaaoChatT('chat.run_retry.failed', 'Retry failed — try sending again.'),
                );
                return;
            }
            const cid = Number(data.conversation_id);
            const nextCid = cid > 0 ? cid : activeConversationId;
            const stripOnSend = getOaaoTaskListStripHost(mount);
            if (stripOnSend && nextCid) {
                stripOnSend.dataset.oaaoTaskListConv = String(nextCid);
            }
            await refreshConversations(nextCid);
            await openConversation(nextCid, {
                replaceUrl: nextCid === activeConversationId,
            });
            const rid = typeof data.run_id === 'string' ? data.run_id.trim() : '';
            const su = typeof data.stream_url === 'string' ? data.stream_url.trim() : '';
            const amid = coercePositiveInt(data.assistant_message_id);
            if (su && rid && activeConversationId) {
                saveStreamCursor(activeConversationId, {
                    stream_url: su,
                    run_id: rid,
                    last_seq: 0,
                    ...(amid ? { assistant_message_id: amid } : {}),
                });
                setChatComposerStreamingUi(mount, true);
                void consumeAssistantStream(
                    su,
                    rid,
                    activeConversationId,
                    0,
                    amid,
                    Boolean(data.orchestrator_persist),
                );
            }
            toastOaao(oaaoChatT('chat.run_retry.started', 'Retry started'));
        } finally {
            chatComposerSubmitInFlight = false;
            chatComposerSubmitConvId = null;
            syncComposerBusyForActiveView(mount);
        }
    }

    /**
     * Stale {@code sessionStorage} cursor after orchestrator restart → probe, persist {@code run_status}, show Retry.
     *
     * @param {number} conversationId
     * @param {Array<{ id?: number, role?: string, content?: string, meta?: unknown }>} rows
     */
    async function reconcileInterruptedRunsAfterLoad(conversationId, rows) {
        const cur = loadStreamCursor(conversationId);
        if (!cur?.stream_url || !cur.run_id) return;
        if (streamHandlesByConversation.has(conversationId)) return;
        const amid = coercePositiveInt(cur.assistant_message_id);
        const alive = await probeOrchestratorRunAlive(cur.stream_url, cur.run_id);
        if (alive) {
            if (amid) {
                const row = rows.find((m) => coercePositiveInt(m.id) === amid);
                const meta =
                    row?.meta && typeof row.meta === 'object'
                        ? /** @type {Record<string, unknown>} */ (row.meta)
                        : null;
                if (assistantMetaRunIncomplete(meta) || conversationHasOpenRunTasks(conversationId)) {
                    void consumeAssistantStream(
                        cur.stream_url,
                        cur.run_id,
                        conversationId,
                        cur.last_seq || 0,
                        amid,
                        true,
                    );
                }
            }
            return;
        }
        clearStreamCursor(conversationId);
        if (!amid) return;
        const idx = rows.findIndex((m) => coercePositiveInt(m.id) === amid);
        if (idx < 0) return;
        const row = rows[idx];
        const content = String(row.content ?? '');
        const meta =
            row.meta && typeof row.meta === 'object'
                ? finalizeRunMetaForPatch(/** @type {Record<string, unknown>} */ (row.meta), {
                      interrupted: true,
                  })
                : { run_status: 'interrupted' };
        if (!assistantMetaRunIncomplete(meta)) {
            meta.run_status = 'interrupted';
        }
        await patchAssistantContent(conversationId, amid, content, meta);
        row.meta = meta;
        const bubble = messagesEl.querySelector(`[data-oaao-msg-id="${amid}"]`);
        const outer = bubble?.closest('.oaao-chat-assistant-row');
        if (outer instanceof HTMLElement) {
            applyAssistantRunRetryBanner(outer, {
                conversationId,
                assistantMessageId: amid,
                onRetry: () => retryInterruptedAssistantRun(conversationId, amid),
                signal,
            });
        }
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
        const { res, data } = await chatFetchJson(chatApiUrl('resolve_share', { slug, ...workspaceChatQueryParams() }));
        if (!res.ok || !data.success || !data.conversation_id) {
            toastOaao(data.message || 'Invalid or expired share link');

            return;
        }
        activeConversationId = Number(data.conversation_id);
        params.delete('share');
        if (activeConversationId > 0) {
            params.set(CHAT_CONVERSATION_QUERY_KEY, String(activeConversationId));
        }
        const qs = params.toString();
        const prev =
            window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
        window.history.replaceState(
            { ...prev, chatConversationId: activeConversationId > 0 ? activeConversationId : null },
            '',
            `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
        );
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
    async function consumeAssistantStream(
        streamUrl,
        runId,
        conversationId,
        sinceSeq,
        assistantMessageId,
        orchestratorOwnsPersist = false,
    ) {
        abortStreamReaderForConversation(conversationId);
        const streamController = new AbortController();
        const streamHandle = { controller: streamController, runId };
        streamHandlesByConversation.set(conversationId, streamHandle);
        const { signal } = streamController;

        if (activeConversationId === conversationId) {
            setChatComposerStreamingUi(mount, true);
        }

        const isStreamConversationVisible = () => activeConversationId === conversationId;

        if (isStreamConversationVisible()) {
            clearActivityLog();
            hideActivityLog();
        }

        /** @type {string} */
        let runStatusLabel = 'Starting…';

        const u = new URL(await resolveChatOrchestratorStreamUrl(streamUrl), window.location.href);
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
        if (streamingMsgId && streamingMsgId > 0) {
            oaaoStreamAssistantMsgIdByConv.set(conversationId, streamingMsgId);
        }

        if (isStreamConversationVisible() && streamingMsgId && streamingMsgId > 0) {
            runStatusLabelByConversation.set(conversationId, runStatusLabel);
            showRunStatusForMessage(mount, streamingMsgId, runStatusLabel);
            const pinStart = messagesPinnedToBottom(getChatScrollEl());
            if (pinStart) messagesScrollToBottom(getChatScrollEl());
        }

        let acc = '';
        /** @type {Record<string, unknown> | null} */
        let runMeta = null;
        /** @type {string[]} */
        const systemErrors = [];
        let sawSseFrame = false;
        let sawRunEnd = false;
        let streamTruncated = false;
        let lastStreamSeq = sinceSeq;
        /** @type {ReturnType<typeof setTimeout> | null} */
        let flushTimer = null;

        /** @type {number} */
        let mdBubbleRaf = 0;
        let mdBubbleLastAt = 0;
        const MD_RENDER_MIN_MS = 48;
        /** @type {string | null} */
        let pipelineFpApplied = null;

        /**
         * @param {{ finalize?: boolean }} [opts] When stream ends, run KaTeX once on the bubble.
         */
        function flushMdBubbleNow(opts = {}) {
            const { finalize = false } = opts;
            if (!isStreamConversationVisible()) return;
            if (mdBubbleRaf) {
                cancelAnimationFrame(mdBubbleRaf);
                mdBubbleRaf = 0;
            }
            const bubble = resolveStreamingAssistantBubble(mount, msgsHost, streamingMsgId);
            let body = String(acc ?? '');
            if (!body.trim() && bubble instanceof HTMLElement) {
                body = readAssistantBubblePlainText(bubble);
            }
            if (!(bubble instanceof HTMLElement) || !body.trim()) return;

            if (finalize) {
                applyAssistantMarkdown(bubble, body);
                if (!String(acc ?? '').trim()) {
                    acc = body;
                }
                return;
            }
            bubble.classList.remove('oaao-md-bubble');
            bubble.style.whiteSpace = 'pre-wrap';
            bubble.textContent = body;
        }

        function queueMdBubbleRender() {
            if (!isStreamConversationVisible()) return;
            if (mdBubbleRaf) return;
            mdBubbleRaf = requestAnimationFrame(() => {
                mdBubbleRaf = 0;
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                if (now - mdBubbleLastAt < MD_RENDER_MIN_MS) {
                    queueMdBubbleRender();

                    return;
                }
                mdBubbleLastAt = now;
                const pin = messagesPinnedToBottom(getChatScrollEl());
                flushMdBubbleNow();
                if (pin) messagesScrollToBottom(getChatScrollEl());
            });
        }

        const flushAssistant = async (metaForPatch = null) => {
            if (!streamingMsgId || streamingMsgId < 1) return false;
            return patchAssistantContent(conversationId, streamingMsgId, acc, metaForPatch);
        };

        const scheduleFlush = () => {
            if (orchestratorOwnsPersist) return;
            if (!streamingMsgId || streamingMsgId < 1) return;
            if (flushTimer) return;
            flushTimer = setTimeout(async () => {
                flushTimer = null;
                const ok = await flushAssistant();
                if (!ok && isStreamConversationVisible()) {
                    appendActivityLine('(warning) Could not save streamed reply to server — will retry at end.');
                }
            }, 480);
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
                if (isStreamConversationVisible()) hideActivityLog();
                clearStreamCursor(conversationId);
                let detail = '';
                try {
                    detail = (await res.clone().text()).trim().slice(0, 320);
                } catch {
                    detail = '';
                }
                const streamGone = res.status === 403 || res.status === 404;
                if (streamGone && streamingMsgId && streamingMsgId > 0) {
                    const bubbleDead = msgsHost.querySelector(`[data-oaao-msg-id="${streamingMsgId}"]`);
                    const outerDead = bubbleDead?.closest('.oaao-chat-assistant-row');
                    if (outerDead instanceof HTMLElement) {
                        void patchAssistantContent(
                            conversationId,
                            streamingMsgId,
                            acc,
                            finalizeRunMetaForPatch(runMeta, { interrupted: true }),
                        );
                        applyAssistantRunRetryBanner(outerDead, {
                            conversationId,
                            assistantMessageId: streamingMsgId,
                            onRetry: () => retryInterruptedAssistantRun(conversationId, streamingMsgId),
                            signal,
                        });
                    }
                }
                if (isStreamConversationVisible()) {
                    const line = document.createElement('p');
                    line.className = 'text-sm fg-red-6 self-start max-w-full min-w-0';
                    line.textContent = streamGone
                        ? oaaoChatT(
                              'chat.run_retry.stream_gone',
                              'Stream unavailable (service restarted). Use Retry on the message above.',
                          )
                        : `Could not open assistant stream (HTTP ${res.status}).${detail ? ` ${detail}` : ''}`;
                    const pinErr = messagesPinnedToBottom(getChatScrollEl());
                    messagesEl.append(line);
                    if (pinErr) messagesScrollToBottom(getChatScrollEl());
                }

                return;
            }
            const reader = res.body.getReader();

            /** @param {{ seq: number, eventName: string, data: Record<string, unknown> }} ev */
            const onStreamEvent = ({ seq, eventName, data }) => {
                sawSseFrame = true;
                lastStreamSeq = seq;
                saveStreamCursor(conversationId, {
                    stream_url: streamUrl,
                    run_id: runId,
                    last_seq: seq,
                    ...(streamingMsgId && streamingMsgId > 0 ? { assistant_message_id: streamingMsgId } : {}),
                });
                if (eventName === 'oaao.stream' && data && typeof data === 'object') {
                    const envelope = /** @type {Record<string, unknown>} */ (data);
                    const phase =
                        typeof envelope.phase === 'string'
                            ? envelope.phase.toLowerCase()
                            : String(envelope.phase ?? '?').toLowerCase();
                    const kind =
                        typeof envelope.kind === 'string'
                            ? envelope.kind.toLowerCase()
                            : String(envelope.kind ?? '').toLowerCase();
                    const text = streamEnvelopeText(envelope);
                    const statusLabel = runStatusLabelFromEnvelope(envelope);
                    if (statusLabel && shouldShowRunStatusWhileStreaming(statusLabel, acc)) {
                        runStatusLabel = statusLabel;
                        runStatusLabelByConversation.set(conversationId, runStatusLabel);
                        if (isStreamConversationVisible() && streamingMsgId && streamingMsgId > 0) {
                            showRunStatusForMessage(mount, streamingMsgId, runStatusLabel);
                        }
                    }
                    if (phase === 'system' && kind === 'error') {
                        systemErrors.push(formatStreamSystemError(text, data.payload));
                        if (isStreamConversationVisible()) {
                            showActivityLog();
                            appendActivityLine(`[${phase}] ${kind}${text ? ` — ${text}` : ''}`);
                        }
                    }
                    if (phase === 'system' && (kind === 'status' || kind === 'end')) {
                        const pCancel = envelope.payload;
                        const cancelledRun =
                            text === 'run_cancelled' ||
                            (pCancel &&
                                typeof pCancel === 'object' &&
                                Boolean(/** @type {Record<string, unknown>} */ (pCancel).cancelled));
                        if (cancelledRun) {
                            markOaaoRunTasksCancelled(mount, conversationId);
                        }
                    }
                    if (phase === 'system' && kind === 'status' && text === 'llm_truncated') {
                        streamTruncated = true;
                        if (isStreamConversationVisible()) {
                            showActivityLog();
                            appendActivityLine('[system] Reply truncated at token limit');
                        }
                    }
                    if (
                        phase === 'system' &&
                        kind === 'status' &&
                        isStreamConversationVisible() &&
                        (text.startsWith('planner_mode_') ||
                            text === 'plan_build_start' ||
                            text === 'task_plan' ||
                            text === 'reusing_crystallized_skill')
                    ) {
                        showActivityLog();
                        const payload =
                            envelope.payload && typeof envelope.payload === 'object'
                                ? /** @type {Record<string, unknown>} */ (envelope.payload)
                                : null;
                        const extra =
                            payload && Object.keys(payload).length > 0
                                ? ` — ${JSON.stringify(payload)}`
                                : '';
                        appendActivityLine(`[${phase}] ${text}${extra}`);
                    }
                    if (
                        streamingMsgId &&
                        streamingMsgId > 0 &&
                        phase === 'llm' &&
                        kind === 'delta' &&
                        text !== ''
                    ) {
                        const pDelta = envelope.payload;
                        const replacePrior =
                            pDelta &&
                            typeof pDelta === 'object' &&
                            Boolean(/** @type {Record<string, unknown>} */ (pDelta).replace_prior);
                        if (acc === '' && isStreamConversationVisible()) {
                            showRunStatusForMessage(mount, streamingMsgId, 'Writing…');
                        }
                        acc = replacePrior ? text : acc + text;
                        if (acc.trim().length > 0 && isStreamConversationVisible()) {
                            hideRunStatusForMessage(mount, streamingMsgId);
                        }
                        queueMdBubbleRender();
                        scheduleFlush();
                    }
                    if (
                        phase === 'task' ||
                        OAAO_TASK_AGENT_PHASES.has(phase) ||
                        extractTasksPayloadFromEnvelope(envelope)
                    ) {
                        try {
                            applyStreamTaskPipelineEnvelope(mount, envelope, conversationId);
                        } catch (taskErr) {
                            console.error('oaao task list merge failed', taskErr);
                        }
                        // SSE stays on /sidecar — do not abort during agent_ask (PHP agent_ask is a short POST).
                        if (phase === 'task' && kind === 'ask') {
                            streamPausedForAgentAskByConversation.set(conversationId, {
                                streamUrl,
                                runId,
                                lastSeq: lastStreamSeq,
                                assistantMessageId: streamingMsgId,
                                orchestratorOwnsPersist,
                            });
                            if (activeConversationId === conversationId) {
                                syncComposerBusyForActiveView(mount);
                            }
                        }
                        if (
                            extractTasksPayloadFromEnvelope(envelope) &&
                            kind !== 'ask' &&
                            isStreamConversationVisible() &&
                            streamingMsgId &&
                            streamingMsgId > 0
                        ) {
                            const planLbl = runStatusLabelByConversation.get(conversationId) || 'Planning…';
                            if (shouldShowRunStatusWhileStreaming(planLbl, acc)) {
                                runStatusLabelByConversation.set(conversationId, planLbl);
                                showRunStatusForMessage(mount, streamingMsgId, planLbl);
                            }
                        }
                    }
                    const pipeLive = normalizePipelinePayloadFromEnvelope(
                        /** @type {Record<string, unknown>} */ (data),
                    );
                    if (
                        isStreamConversationVisible() &&
                        pipeLive &&
                        streamingMsgId &&
                        streamingMsgId > 0 &&
                        msgsHost
                    ) {
                        const fp = pipelineSnapshotFingerprint(pipeLive);
                        if (fp !== pipelineFpApplied) {
                            pipelineFpApplied = fp;
                            const bubbleLive = resolveStreamingAssistantBubble(
                                mount,
                                msgsHost,
                                streamingMsgId,
                            );
                            const outerLive = bubbleLive?.closest('.oaao-chat-assistant-row');
                            if (outerLive && bubbleLive instanceof HTMLElement && outerLive instanceof HTMLElement) {
                                void syncAssistantMessageBlocks(
                                    outerLive,
                                    bubbleLive,
                                    pipeLive,
                                    conversationId,
                                );
                                const pinMs = messagesPinnedToBottom(getChatScrollEl());
                                if (pinMs) messagesScrollToBottom(getChatScrollEl());
                            }
                        }
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
                        sawRunEnd = true;
                        streamPausedForAgentAskByConversation.delete(conversationId);
                        const p = data.payload;
                        if (p && typeof p === 'object') {
                            runMeta = { .../** @type {Record<string, unknown>} */ (p) };
                        }
                        runMeta = finalizeRunMetaForPatch(runMeta, {
                            complete: true,
                            cancelled: Boolean(runMeta?.cancelled),
                        });
                        if (runMeta && runMeta.finish_reason === 'length') {
                            streamTruncated = true;
                        }
                        clearStreamCursor(conversationId);
                        if (isStreamConversationVisible()) {
                            clearActivityLog();
                            hideActivityLog();
                        }
                        releaseChatStreamUiAfterRunEnd(mount, conversationId, streamingMsgId);
                        if (isStreamConversationVisible()) {
                            flushMdBubbleNow({ finalize: true });
                            if (!orchestratorOwnsPersist && streamingMsgId && streamingMsgId > 0) {
                                void flushAssistant(
                                    mergeMaterialsMetaIntoRunMetrics(runMeta, mount, conversationId),
                                );
                            }
                        }
                        if (flushTimer) {
                            clearTimeout(flushTimer);
                            flushTimer = null;
                        }
                    }
                }
            };

            await readSseStream(reader, onStreamEvent);

            if (streamPausedForAgentAskByConversation.has(conversationId)) {
                return;
            }

            if (!sawRunEnd && !signal.aborted && lastStreamSeq > sinceSeq) {
                const tailUrl = new URL(await resolveChatOrchestratorStreamUrl(streamUrl), window.location.href);
                tailUrl.searchParams.set('run_id', runId);
                tailUrl.searchParams.set('since_seq', String(lastStreamSeq));
                if (isStreamConversationVisible()) {
                    showActivityLog();
                    appendActivityLine('Stream interrupted — resuming…');
                }
                try {
                    const tailRes = await fetch(tailUrl.href, {
                        method: 'GET',
                        mode: 'cors',
                        credentials: sameOrigin ? 'include' : 'omit',
                        signal,
                        headers: { Accept: 'text/event-stream' },
                    });
                    if (tailRes.ok && tailRes.body) {
                        await readSseStream(tailRes.body.getReader(), onStreamEvent);
                    }
                } catch (tailErr) {
                    if (/** @type {{ name?: string }} */ (tailErr)?.name !== 'AbortError' && isStreamConversationVisible()) {
                        appendActivityLine(
                            `(stream resume) ${/** @type {Error} */ (tailErr)?.message || String(tailErr)}`,
                        );
                    }
                }
            }

            if (!sawRunEnd && !signal.aborted) {
                runMeta = finalizeRunMetaForPatch(runMeta, { interrupted: true });
                if (streamingMsgId && streamingMsgId > 0) {
                    const bubbleInt = msgsHost.querySelector(`[data-oaao-msg-id="${streamingMsgId}"]`);
                    const outerInt = bubbleInt?.closest('.oaao-chat-assistant-row');
                    if (outerInt instanceof HTMLElement) {
                        applyAssistantRunRetryBanner(outerInt, {
                            conversationId,
                            assistantMessageId: streamingMsgId,
                            onRetry: () => retryInterruptedAssistantRun(conversationId, streamingMsgId),
                            signal,
                        });
                    }
                }
                if (sawSseFrame && acc !== '' && isStreamConversationVisible()) {
                    showActivityLog();
                    appendActivityLine('Stream ended before run_closed — partial reply saved.');
                }
            }

            if (!sawSseFrame) {
                clearStreamCursor(conversationId);
                if (isStreamConversationVisible()) {
                    const note = document.createElement('p');
                    note.className = 'text-sm fg-[var(--grid-ink-muted)] self-start max-w-full min-w-0';
                    note.textContent =
                        'Stream closed without events (often a stale resume after the run already finished). Send again if the reply is missing.';
                    const pinNote = messagesPinnedToBottom(getChatScrollEl());
                    messagesEl.append(note);
                    if (pinNote) messagesScrollToBottom(getChatScrollEl());
                }
            }
        } catch (err) {
            if (/** @type {{ name?: string }} */ (err)?.name !== 'AbortError') {
                clearStreamCursor(conversationId);
                if (isStreamConversationVisible()) {
                    showActivityLog();
                    appendActivityLine(`(stream error) ${/** @type {Error} */ (err)?.message || String(err)}`);
                    const line = document.createElement('p');
                    line.className = 'text-sm fg-red-6 self-start max-w-full min-w-0';
                    line.textContent = `(stream error) ${/** @type {Error} */ (err)?.message || String(err)}`;
                    const pinSe = messagesPinnedToBottom(getChatScrollEl());
                    messagesEl.append(line);
                    if (pinSe) messagesScrollToBottom(getChatScrollEl());
                }
            }
        } finally {
            const pausedForAsk = streamPausedForAgentAskByConversation.has(conversationId);
            if (streamHandlesByConversation.get(conversationId) === streamHandle) {
                streamHandlesByConversation.delete(conversationId);
            }
            if (signal.aborted && !sawRunEnd && !pausedForAsk) {
                markOaaoRunTasksCancelled(mount, conversationId);
                runMeta = finalizeRunMetaForPatch(runMeta, { cancelled: true });
            }
            if (activeConversationId === conversationId) {
                syncComposerBusyForActiveView(mount);
            }
            if (streamingMsgId && streamingMsgId > 0) {
                hideRunStatusForMessage(mount, streamingMsgId);
            }
            runStatusLabelByConversation.delete(conversationId);
            if (isStreamConversationVisible()) {
                if (sawRunEnd) {
                    clearActivityLog();
                    hideActivityLog();
                }
                const pinFlush = messagesPinnedToBottom(getChatScrollEl());
                flushMdBubbleNow({ finalize: true });
                if (pinFlush) messagesScrollToBottom(getChatScrollEl());
            }
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            if (
                isStreamConversationVisible() &&
                streamingMsgId &&
                streamingMsgId > 0 &&
                acc === '' &&
                (systemErrors.length > 0 || sawRunEnd)
            ) {
                acc =
                    systemErrors.length > 0
                        ? systemErrors.join('\n')
                        : resolveAssistantDisplayText('', runMeta);
                const bubble = resolveStreamingAssistantBubble(mount, msgsHost, streamingMsgId);
                if (bubble instanceof HTMLElement && acc) {
                    applyAssistantMarkdown(bubble, acc);
                }
            } else if (!acc.trim() && sawRunEnd) {
                const fallback = resolveAssistantDisplayText('', runMeta);
                if (fallback) acc = fallback;
                const bubbleFb = resolveStreamingAssistantBubble(mount, msgsHost, streamingMsgId);
                if (bubbleFb instanceof HTMLElement && acc.trim()) {
                    applyAssistantMarkdown(bubbleFb, acc);
                }
            }
            await flushAssistant(mergeMaterialsMetaIntoRunMetrics(runMeta, mount, conversationId));
            persistOaaoTaskListStrip(mount, conversationId);
            let taskStateEnd = getOaaoTaskListStateForConversation(conversationId);
            if (taskStateEnd && taskStateEnd.items.size > 0) {
                finalizeAllOaaoTaskListSubtasks(taskStateEnd);
                setOaaoTaskListStateForConversation(conversationId, taskStateEnd);
                persistOaaoTaskListStrip(mount, conversationId);
                const stepsHostEnd = resolveOaaoTaskStepsHost(mount, conversationId);
                if (
                    stepsHostEnd instanceof HTMLElement &&
                    isOaaoInlineTaskStepsHost(stepsHostEnd) &&
                    stepsHostEnd.querySelector('.oaao-chat-inline-task-steps-inner')
                ) {
                    oaaoTaskListStateByHost.set(stepsHostEnd, taskStateEnd);
                    patchOaaoInlineTaskStepsFromState(stepsHostEnd, taskStateEnd);
                }
                const spEnd =
                    runMeta && typeof runMeta === 'object'
                        ? /** @type {Record<string, unknown>} */ (runMeta).slide_project
                        : null;
                const pidEnd =
                    spEnd && typeof spEnd === 'object'
                        ? String(/** @type {Record<string, unknown>} */ (spEnd).project_id ?? '').trim()
                        : '';
                if (pidEnd) {
                    void reconcileSlideWorkerTasksForConversation(mount, conversationId, pidEnd);
                }
            }
            if (!isStreamConversationVisible()) {
                return;
            }
            if (streamingMsgId && streamingMsgId > 0 && msgsHost) {
                const bubble = resolveStreamingAssistantBubble(mount, msgsHost, streamingMsgId);
                const outer = bubble?.closest('.oaao-chat-assistant-row');
                if (!acc.trim() && bubble instanceof HTMLElement) {
                    const fromDom = readAssistantBubblePlainText(bubble);
                    if (fromDom) acc = fromDom;
                }
                if (bubble instanceof HTMLElement && outer instanceof HTMLElement) {
                    if (runMeta && typeof runMeta === 'object') {
                        applyAssistantIdentityHeader(outer, runMeta);
                        applyAssistantRunSummaryToRow(outer, runMeta);
                        if (streamTruncated || runMeta.finish_reason === 'length') {
                            applyAssistantTruncationNoticeToRow(outer);
                        }
                        const pipe = normalizePipelineFromMeta(runMeta);
                        if (pipe) {
                            await syncAssistantMessageBlocks(outer, bubble, pipe, conversationId, {
                                force: true,
                            });
                        }
                        if (runMeta.conversation_title && isStreamConversationVisible()) {
                            applyConversationTitleToCache(
                                conversationId,
                                runMeta.conversation_title,
                            );
                            void refreshConversations(conversationId, { silent: true });
                        }
                    }
                    if (acc.trim()) {
                        applyAssistantMarkdown(bubble, acc);
                        await hydrateInlineCitesForBubble(bubble);
                    } else if (sawRunEnd && !assistantBubbleHasVisibleContent(bubble)) {
                        const fromServer = await hydrateAssistantBubbleFromServer(
                            conversationId,
                            streamingMsgId,
                            bubble,
                        );
                        if (fromServer) acc = fromServer;
                    }
                } else if (sawRunEnd) {
                    await loadMessages(conversationId, 'auto');
                }
            } else if (sawRunEnd && streamingMsgId && streamingMsgId > 0) {
                await loadMessages(conversationId, 'auto');
            }
        }
    }

    async function resumeStreamIfAny(conversationId) {
        const cur = loadStreamCursor(conversationId);
        if (!cur?.stream_url || !cur.run_id) return;
        const active = streamHandlesByConversation.get(conversationId);
        if (active?.runId === cur.run_id) return;
        await consumeAssistantStream(
            cur.stream_url,
            cur.run_id,
            conversationId,
            cur.last_seq,
            cur.assistant_message_id ?? null,
        );
    }

    function syncComposerChromeStyles() {
        if (composerDockEl instanceof HTMLElement) {
            composerDockEl.style.width = '100%';
            composerDockEl.style.maxWidth = '48rem';
            composerDockEl.style.marginInline = 'auto';
            composerDockEl.style.alignSelf = 'center';
            composerDockEl.style.boxSizing = 'border-box';
        }
        if (composerRegionEl instanceof HTMLElement) {
            const landingNow = activeConversationId === null;
            composerRegionEl.style.alignItems = landingNow ? 'center' : '';
        }
        if (composerCardWrapEl instanceof HTMLElement) {
            composerCardWrapEl.style.borderRadius = '22px';
            composerCardWrapEl.style.overflow = 'hidden';
            composerCardWrapEl.style.background = '#fff';
            composerCardWrapEl.style.border = '1px solid rgba(0,0,0,0.12)';
            composerCardWrapEl.style.boxShadow = '0 12px 32px rgba(0,0,0,0.06)';
            composerCardWrapEl.style.boxSizing = 'border-box';
        }
        if (promptGridEl instanceof HTMLElement) {
            promptGridEl.style.width = '100%';
            promptGridEl.style.maxWidth = '48rem';
            promptGridEl.style.marginInline = 'auto';
            promptGridEl.style.alignSelf = 'center';
            promptGridEl.style.boxSizing = 'border-box';
        }
    }

    function updateChatLayout() {
        const landing = shouldUseChatLandingLayout();
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
            /* Landing: scrollable column; thread: flex dock under {@code thread-wrap} ({@see oaao-chat-shell.css}). */
            composerRegionEl.classList.toggle('flex-1', landing);
            composerRegionEl.classList.toggle('min-h-0', landing);
            composerRegionEl.classList.toggle('overflow-y-auto', landing);
            composerRegionEl.classList.toggle('items-center', landing);
            composerRegionEl.classList.toggle('shrink-0', !landing);
            composerRegionEl.classList.remove(
                'border-t-[1px]',
                'border-solid',
                'border-[var(--grid-line)]',
                'bg-[var(--grid-panel-bright)]',
                'pt-md',
                'pb-md',
                'z-[1]',
                'z-[10]',
                'pt-1',
                'pb-0',
            );
            composerRegionEl.classList.toggle('relative', true);
            composerRegionEl.classList.toggle('oaao-chat-composer-region--thread-float', !landing);
        }
        if (composerCardWrapEl) {
            composerCardWrapEl.classList.toggle('oaao-chat-composer--floating', !landing);
        }
        if (composerShellEl) {
            composerShellEl.classList.toggle('oaao-chat-composer-shell--thread', !landing);
        }
        chatRootEl.classList.toggle('oaao-chat-root--in-thread', !landing);
        syncComposerChromeStyles();
        syncThreadToolbarStates();
        syncThreadComposerReserve();
        requestAnimationFrame(() => syncThreadComposerReserve());
    }
    mount.__oaaoUpdateChatLayout = updateChatLayout;

    /**
     * Open or close the active thread and mirror {@code conversation_id} in the URL.
     *
     * @param {number | null} id
     * @param {{ replaceUrl?: boolean, scroll?: 'auto' | 'bottom' }} [opts]
     */
    async function openConversation(id, opts = {}) {
        const next = id != null && Number(id) > 0 ? Math.floor(Number(id)) : null;
        const unchanged = next === activeConversationId;
        activeConversationId = next;
        syncChatConversationUrl(activeConversationId, {
            replace: opts.replaceUrl === true || unchanged,
        });
        renderSidebar();
        const scroll = opts.scroll ?? (next ? 'bottom' : 'auto');
        await loadMessages(activeConversationId, scroll);
        if (next) {
            await resumeStreamIfAny(next);
        }
        syncComposerBusyForActiveView(mount);
        updateChatLayout();
        syncThreadToolbarStates();
    }

    function renderSidebar() {
        const host = document.getElementById('workspace-conversation-list');
        if (!host) return;
        conversationSidebarRenderFn = renderSidebar;
        try {
            renderSidebarInner(host);
        } catch (err) {
            console.error('[chat] renderSidebar failed', err);
        }
    }

    function renderSidebarInner(host) {
        closeOpenConvoMenuPanel();
        host.textContent = '';
        if (!Array.isArray(cachedConversations) || cachedConversations.length === 0) {
            const p = document.createElement('p');
            p.className =
                'flex-none shrink-0 px-md py-sm text-[0.75rem] fg-[var(--grid-caption)] leading-snug self-stretch';
            p.textContent = 'No chats yet — send a message below.';
            host.append(p);

            return;
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
            const deskModeRow = isConversationDeskModeRow(row, id);
            btn.className = [
                'inline-flex flex-1 min-h-0 min-w-0 max-h-none box-border items-center gap-1.5 text-left rounded-[8px] px-2 py-2 text-[0.8125rem] leading-snug fg-[var(--grid-ink)]',
                'border-none bg-transparent cursor-pointer font-inherit transition-colors overflow-hidden',
                active ? 'bg-[var(--grid-line)]/45 fw-semibold' : '',
            ].join(' ');
            const typeIcon = document.createElement('span');
            typeIcon.className = 'oaao-chat-convo-type-icon inline-flex shrink-0 items-center justify-center';
            typeIcon.setAttribute(
                'aria-label',
                deskModeRow
                    ? oaaoChatT('chat.desk_mode.badge', 'Desk Mode')
                    : oaaoChatT('workspace.rail_chat_title', 'Chat'),
            );
            typeIcon.setAttribute('title', typeIcon.getAttribute('aria-label') ?? '');
            mountRuiIconSync(typeIcon, deskModeRow ? OAAO_RUI_ICON_GALLERY_MODE : OAAO_RUI_ICON_CONVERSATION, {
                size: 14,
                class: deskModeRow ? 'fg-[var(--grid-accent,#2563eb)]' : 'fg-[var(--grid-caption)]',
            });
            const titleEl = document.createElement('span');
            titleEl.className = 'oaao-chat-convo-title min-w-0 flex-1';
            titleEl.textContent = archivedRow ? `${row.title || `Chat ${id}`} · archived` : row.title || `Conversation ${id}`;
            btn.append(typeIcon, titleEl);
            btn.addEventListener(
                'click',
                () => {
                    void openConversation(id > 0 ? id : null);
                },
                { signal },
            );

            const acts = document.createElement('div');
            acts.className =
                'oaao-chat-convo-actions flex flex-row items-center shrink-0 pr-0.5 min-w-[2rem]';
            acts.addEventListener(
                'click',
                (ev) => {
                    ev.stopPropagation();
                },
                { signal },
            );

            const menuRoot = document.createElement('div');
            menuRoot.className = 'oaao-chat-convo-menu relative inline-flex shrink-0 items-center';
            const menuTrigger = document.createElement('button');
            menuTrigger.type = 'button';
            menuTrigger.className = 'oaao-chat-convo-menu-trigger';
            menuTrigger.setAttribute('aria-label', oaaoChatT('chat.conversation_menu', 'Conversation options'));
            menuTrigger.setAttribute('aria-haspopup', 'menu');
            menuTrigger.setAttribute('aria-expanded', 'false');
            mountRuiIconSync(menuTrigger, OAAO_RUI_ICON_MORE, { size: 16, class: OAAO_RUI_ICON_SOFT_CLASS });
            menuRoot.append(menuTrigger);
            acts.append(menuRoot);

            const archivedLabel = archivedRow
                ? oaaoChatT('chat.conversation_unarchive', 'Unarchive')
                : oaaoChatT('chat.conversation_archive', 'Archive');
            const deleteLabel = oaaoChatT('chat.conversation_delete', 'Delete');

            wireConvoRowMenu(
                menuRoot,
                menuTrigger,
                [
                    {
                        label: archivedLabel,
                        onSelect: async () => {
                            const next = !archivedRow;
                            await chatFetchJson(chatApiUrl('conversation_archive'), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    conversation_id: id,
                                    archived: next,
                                    ...workspaceChatBodyFields(),
                                }),
                            });
                            if (!showArchivedConversations && next && activeConversationId === id) {
                                await openConversation(null, { replaceUrl: true });
                            } else {
                                await refreshConversations(activeConversationId);
                                await loadMessages(activeConversationId, 'auto');
                                updateChatLayout();
                            }
                        },
                    },
                    { divider: true },
                    {
                        label: deleteLabel,
                        danger: true,
                        onSelect: async () => {
                            if (
                                !confirm(
                                    oaaoChatT(
                                        'chat.conversation_delete_confirm',
                                        'Delete this chat and all messages?',
                                    ),
                                )
                            ) {
                                return;
                            }
                            const wasActive = activeConversationId === id;
                            await chatFetchJson(chatApiUrl('conversation_delete'), {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ conversation_id: id, ...workspaceChatBodyFields() }),
                            });
                            await refreshConversations(wasActive ? null : activeConversationId);
                            if (wasActive || activeConversationId == null) {
                                await openConversation(null, { replaceUrl: true });
                            } else {
                                updateChatLayout();
                            }
                        },
                    },
                ],
                signal,
            );

            wrap.append(btn, acts);
            host.append(wrap);
        }
    }

    /**
     * @param {number} conversationId
     * @param {unknown} title
     */
    function applyConversationTitleToCache(conversationId, title) {
        const t = String(title ?? '').trim();
        const cid = Math.floor(Number(conversationId));
        if (!t || !Number.isFinite(cid) || cid < 1) return;
        for (const row of cachedConversations) {
            if (Number(row.id) === cid) {
                row.title = t;
                return;
            }
        }
    }

    /**
     * @param {number | null | undefined} [preferredId] — `null` clears selection; omit to keep current if still listed.
     * @param {{ silent?: boolean }} [opts] — skip sidebar loading overlay (background title refresh during stream).
     */
    async function refreshConversations(preferredId = undefined, opts = {}) {
        const silent = opts.silent === true;
        const listHost = document.getElementById('workspace-conversation-list');
        if (listHost && !silent) {
            oaaoMountLoadingLogo(listHost, { block: true, label: 'Loading chats…' });
        }
        try {
            const q = { ...(showArchivedConversations ? { include_archived: '1' } : {}), ...workspaceChatQueryParams() };
            let { res, data } = await chatFetchJson(chatApiUrl('conversations', q));
            if (res.status === 403) {
                document.dispatchEvent(new CustomEvent('oaao-workspace-scope-invalid'));
                ({ res, data } = await chatFetchJson(
                    chatApiUrl('conversations', {
                        ...(showArchivedConversations ? { include_archived: '1' } : {}),
                        ...workspaceChatQueryParams(),
                    }),
                ));
            }
            cachedConversations = [];
            if (res.status === 403) {
                document.dispatchEvent(new CustomEvent('oaao-workspace-scope-invalid'));
            }
            if (res.ok && data.success && Array.isArray(data.conversations)) {
                cachedConversations = data.conversations;
                for (const row of cachedConversations) {
                    const id = Number(row.id);
                    if (Number.isFinite(id) && id > 0) {
                        rememberConversationWorkspace(id, row.workspace_id);
                    }
                }
                syncConversationModesFromRows(cachedConversations);
                syncPlannerModesFromRows(cachedConversations);
            }
            if (preferredId === null) {
                activeConversationId = null;
            } else if (typeof preferredId === 'number' && Number.isFinite(preferredId) && preferredId > 0) {
                activeConversationId = Math.floor(preferredId);
            } else if (
                activeConversationId != null &&
                activeConversationId > 0 &&
                !cachedConversations.some((r) => Number(r.id) === activeConversationId)
            ) {
                activeConversationId = null;
            }
        } catch (err) {
            console.warn('[chat] refreshConversations failed', err);
            cachedConversations = [];
        } finally {
            renderSidebar();
            syncThreadToolbarStates();
        }
    }

    /**
     * @param {Array<{ id?: number, role?: string, content?: string, feedback?: string }>} rows
     * @param {'auto' | 'bottom' | 'preserve'} scrollMode
     */
    function renderMessages(rows, scrollMode = 'auto') {
        const cid = activeConversationId;
        const preserveScroll = scrollMode === 'preserve';
        const scrollEl = getChatScrollEl();
        const prevHeight = preserveScroll && scrollEl instanceof HTMLElement ? scrollEl.scrollHeight : 0;
        const prevTop = preserveScroll && scrollEl instanceof HTMLElement ? scrollEl.scrollTop : 0;
        const pinnedBefore =
            scrollMode === 'auto' && cid != null && cid > 0 ? messagesPinnedToBottom(scrollEl) : false;
        messagesEl.textContent = '';
        if (!cid || cid < 1) {
            const hint = document.createElement('p');
            hint.className = 'text-sm fg-[var(--grid-ink-muted)]';
            hint.textContent = 'Select or start a conversation.';
            messagesEl.append(hint);

            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) {
            if (shouldUseChatLandingLayout()) {
                getChatScrollEl().scrollTop = 0;
                return;
            }
            const hint = document.createElement('p');
            hint.className = 'text-sm fg-[var(--grid-ink-muted)]';
            hint.textContent = 'No messages yet — send something below.';
            messagesEl.append(hint);
            getChatScrollEl().scrollTop = 0;

            return;
        }

        /**
         * @param {string} label
         * @param {string} tip
         * @param {(btn: HTMLButtonElement) => void | Promise<void>} fn
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
                    void Promise.resolve(fn(b)).catch(() => {});
                },
                { signal },
            );

            return b;
        }

        /**
         * @param {string} ariaLabel
         * @param {(btn: HTMLButtonElement) => void | Promise<void>} fn
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
                    void Promise.resolve(fn(b)).catch(() => {});
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
                    ? 'rounded-[12px] px-md py-sm text-[0.875rem] leading-relaxed bg-[var(--grid-panel-bright)] border-[1px] border-solid border-[var(--grid-line)] shadow-[var(--oaao-surface-shadow)] w-full min-w-0 max-w-full'
                    : 'text-[0.875rem] leading-relaxed w-full min-w-0 max-w-full bg-transparent border-none shadow-none rounded-none px-0 py-0 box-border';

            if (mid !== null) {
                bubble.dataset.oaaoMsgId = String(mid);
            }
            bubble.dataset.oaaoMsgRole = role;

            if (role === 'assistant') {
                const metaForDisplay =
                    m.meta && typeof m.meta === 'object' ? /** @type {Record<string, unknown>} */ (m.meta) : null;
                const displayAssistant = resolveAssistantDisplayText(contentText, metaForDisplay);
                if (displayAssistant.trim()) {
                    applyAssistantMarkdown(bubble, displayAssistant);
                } else {
                    bubble.textContent = '';
                    bubble.classList.remove('oaao-md-bubble');
                    bubble.style.whiteSpace = '';
                }
            } else if (role === 'user') {
                const tpl = resolveSlideTemplateFromMessage(contentText, m.meta);
                const displayText = resolveUserMessageDisplayText(contentText, m.meta, tpl);
                if (!tpl) {
                    mountUserMessageBubbleText(bubble, displayText || contentText);
                }
            } else {
                bubble.classList.remove('oaao-md-bubble');
                bubble.style.whiteSpace = 'pre-wrap';
                bubble.textContent = contentText;
            }

            if (role === 'user') {
                const tpl = resolveSlideTemplateFromMessage(contentText, m.meta);
                const displayText = resolveUserMessageDisplayText(contentText, m.meta, tpl);
                const attachments = parseMessageAttachmentManifest(m.meta);

                const stack = document.createElement('div');
                stack.className =
                    'oaao-chat-user-msg-stack group self-end flex flex-col items-end gap-1.5 max-w-full min-w-0';

                if (tpl) {
                    stack.append(createUserMessageTemplateRefsRow(tpl));
                }
                if (attachments.length) {
                    stack.append(createUserMessageAttachmentCardsBlock(attachments));
                }

                const row = document.createElement('div');
                row.className =
                    'oaao-chat-user-msg-row flex flex-row items-center gap-1.5 max-w-full min-w-0';

                const hoverActions = document.createElement('div');
                hoverActions.className =
                    'oaao-chat-user-msg-actions flex flex-row items-center gap-0.5 shrink-0 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto';

                hoverActions.append(
                    msgIconActionBtn('Copy message', async (btn) => {
                        await copyTextToClipboard(formatUserMessageCopyText(contentText, m.meta));
                        toastOaao('Copied', btn);
                    }),
                );

                if (displayText) {
                    mountUserMessageBubbleText(bubble, displayText);
                    row.append(hoverActions, bubble);
                    stack.append(row);
                } else {
                    row.append(hoverActions);
                    if (tpl) {
                        stack.append(row);
                    } else {
                        mountUserMessageBubbleText(bubble, contentText);
                        row.append(bubble);
                        stack.append(row);
                    }
                }

                messagesEl.append(stack);

                return;
            }

            const outer = document.createElement('div');
            outer.className =
                'oaao-chat-assistant-row self-start flex flex-col gap-2 items-start w-full min-w-0 max-w-full';

            const toolbar = document.createElement('div');
            toolbar.className =
                'oaao-chat-assistant-toolbar flex flex-wrap items-center gap-1 justify-start max-w-full';

            toolbar.append(
                msgToolbarBtn('Copy', 'Copy message', async (btn) => {
                    await copyTextToClipboard(contentText.trim());
                    toastOaao('Copied', btn);
                }),
            );

            const metaRaw = m.meta;
            const metaObj =
                metaRaw && typeof metaRaw === 'object' ? /** @type {Record<string, unknown>} */ (metaRaw) : null;

            if (mid !== null) {
                const liked = String(m.feedback ?? '').toLowerCase() === 'like';
                toolbar.append(
                    msgToolbarBtn(liked ? 'Unlike' : 'Like', liked ? 'Remove like' : 'Like reply', async () => {
                        await postMessageFeedback(cid, mid, !liked);
                        await loadMessages(cid, 'auto');
                    }),
                    msgToolbarBtn('Share', 'Copy prompt + reply', async (btn) => {
                        const prompt = findPrevUserPrompt(rows, i);
                        await copyTextToClipboard(formatPromptReplySnippet(prompt, contentText));
                        toastOaao('Prompt + reply copied', btn);
                    }),
                );
            }

            applyAssistantIdentityHeader(outer, metaObj);
            const tasksMeta = metaObj?.tasks;
            if (
                tasksMeta &&
                typeof tasksMeta === 'object' &&
                Array.isArray(/** @type {Record<string, unknown>} */ (tasksMeta).items) &&
                /** @type {Record<string, unknown>} */ (tasksMeta).items.length
            ) {
                const stepsHost = getOrCreateAssistantInlineStepsHost(outer);
                const taskState = mergeOaaoTaskListPayload(
                    /** @type {{ items?: unknown[] }} */ (tasksMeta),
                    createEmptyOaaoTaskListState(),
                );
                if (cid) {
                    setOaaoTaskListStateForConversation(cid, taskState);
                }
                oaaoTaskListStateByHost.set(stepsHost, taskState);
                if (chatComposerShowPlannerSteps) {
                    renderOaaoInlineTaskStepsFromState(stepsHost, taskState);
                } else {
                    stepsHost.hidden = true;
                    stepsHost.classList.add('hidden');
                }
                if (cid) {
                    const mountEl =
                        document.querySelector('[data-module="oaao-chat"]') ??
                        document.querySelector('.oaao-chat-root');
                    if (mountEl instanceof HTMLElement) {
                        void reconcileSlideWorkerTasksForConversation(mountEl, cid);
                    }
                }
            }
            outer.append(bubble);
            const pipeStored = normalizePipelineFromMeta(
                metaRaw && typeof metaRaw === 'object' ? /** @type {Record<string, unknown>} */ (metaRaw) : null,
            );
            if (pipeStored) {
                void syncAssistantMessageBlocks(outer, bubble, pipeStored, cid ?? 0).then(() =>
                    hydrateInlineCitesForBubble(bubble),
                );
            }
            if (metaRaw && typeof metaRaw === 'object') {
                applyAssistantRunSummaryToRow(outer, /** @type {Record<string, unknown>} */ (metaRaw));
            }
            const turnScore =
                m.turn_score && typeof m.turn_score === 'object'
                    ? /** @type {Record<string, unknown>} */ (m.turn_score)
                    : null;
            if (turnScore) {
                applyAssistantTurnScoreToRow(outer, turnScore);
            }
            if (mid !== null && cid && assistantMetaRunIncomplete(metaObj)) {
                applyAssistantRunRetryBanner(outer, {
                    conversationId: cid,
                    assistantMessageId: mid,
                    onRetry: () => retryInterruptedAssistantRun(cid, mid),
                    signal,
                });
            }
            outer.append(toolbar);
            messagesEl.append(outer);
        });
        if (scrollMode === 'bottom' || (scrollMode === 'auto' && pinnedBefore)) {
            messagesScrollToBottom(getChatScrollEl());
        } else if (preserveScroll && scrollEl instanceof HTMLElement) {
            scrollEl.scrollTop = prevTop + (scrollEl.scrollHeight - prevHeight);
        }
    }

    /**
     * @param {number} conversationId
     */
    async function prependOlderMessages(conversationId) {
        const cid = Number(conversationId);
        if (!Number.isFinite(cid) || cid < 1 || activeConversationId !== cid) return;
        const state = messagePageStateByConversation.get(cid);
        if (!state?.hasOlder || state.loadingOlder || state.oldestId === null) return;
        state.loadingOlder = true;
        messagePageStateByConversation.set(cid, state);
        try {
            const { res, data } = await chatFetchJson(chatMessagesApiUrl(cid, state.oldestId));
            if (!res.ok || !data?.success || !Array.isArray(data.messages) || data.messages.length < 1) {
                state.hasOlder = false;
                return;
            }
            const olderRows = attachTurnScoresToMessageRows(
                /** @type {Array<Record<string, unknown>>} */ (data.messages),
                cid,
            );
            cachedMessageRows = [...olderRows, ...cachedMessageRows];
            applyMessagePageMeta(cid, data);
            renderMessages(cachedMessageRows, 'preserve');
            bindOaaoTaskListStripToConversation(mount, cid, cachedMessageRows);
        } finally {
            const latest = messagePageStateByConversation.get(cid);
            if (latest) {
                latest.loadingOlder = false;
                messagePageStateByConversation.set(cid, latest);
            }
        }
    }

    function bindMessageHistoryScrollLoad() {
        if (messageHistoryScrollBound) return;
        messageHistoryScrollBound = true;
        const onScroll = () => {
            const cid = activeConversationId;
            if (!cid || cid < 1) return;
            const scrollEl = getChatScrollEl();
            if (!(scrollEl instanceof HTMLElement) || scrollEl.scrollTop > 96) return;
            void prependOlderMessages(cid);
        };
        if (threadWrapEl instanceof HTMLElement) {
            threadWrapEl.addEventListener('scroll', onScroll, { passive: true, signal });
        }
        if (messagesEl instanceof HTMLElement) {
            messagesEl.addEventListener('scroll', onScroll, { passive: true, signal });
        }
    }

    /**
     * @param {'auto' | 'bottom' | 'preserve'} [scrollMode]
     */
    async function loadMessages(conversationId, scrollMode = 'auto') {
        if (!conversationId || conversationId < 1) {
            cachedMessageRows = [];
            chatComposerSlideDeckContext = null;
            renderMessages([], scrollMode);
            bindOaaoTaskListStripToConversation(mount, null);
            syncChatComposerChips(mount);

            return;
        }
        resetMessagePageState(conversationId);
        turnScoreCacheByConversation.delete(conversationId);
        cancelTurnScorePoll(conversationId);
        if (messagesEl instanceof HTMLElement) {
            oaaoMountLoadingLogo(messagesEl, { fill: true, label: 'Loading messages…' });
        }
        const [msgPack, scorePack] = await Promise.all([
            chatFetchJson(chatMessagesApiUrl(conversationId)),
            loadTurnScoresForConversation(conversationId),
        ]);
        const { res, data } = msgPack;
        if (!res.ok || !data.success) {
            cachedMessageRows = [];
            renderMessages([], scrollMode);

            return;
        }
        applyMessagePageMeta(conversationId, data);
        const rows = attachTurnScoresToMessageRows(
            /** @type {Array<Record<string, unknown>>} */ (data.messages || []),
            conversationId,
        );
        cachedMessageRows = rows;
        renderMessages(rows, scrollMode);
        bindOaaoTaskListStripToConversation(mount, conversationId, rows);
        refreshChatComposerSlideDeckContext(conversationId);
        void reconcileSlideWorkerTasksForConversation(mount, conversationId);
        syncChatComposerChips(mount);
        syncComposerPlannerStepsVisibility(mount);
        await reconcileInterruptedRunsAfterLoad(conversationId, rows);
        const needsScorePoll =
            !conversationHasOpenRunTasks(conversationId) &&
            (scorePack.rescorePending > 0 ||
                [...scorePack.map.values()].some((row) => !turnScoreRowIsReady(row)));
        if (needsScorePoll) {
            scheduleTurnScorePoll(conversationId, mount, {
                triggerRescore: scorePack.rescorePending > 0,
            });
        }
        if (streamHandlesByConversation.has(conversationId)) {
            const lbl = runStatusLabelByConversation.get(conversationId) || 'Working…';
            const cur = loadStreamCursor(conversationId);
            const mid = coercePositiveInt(cur?.assistant_message_id);
            if (mid) {
                const bubble = getAssistantBubbleForMessage(mount, mid);
                const accText = bubble instanceof HTMLElement ? bubble.textContent ?? '' : '';
                if (shouldShowRunStatusWhileStreaming(lbl, accText)) {
                    showRunStatusForMessage(mount, mid, lbl);
                }
            }
        }
    }

    function focusWorkspaceSidebarAfterInvite() {
        const shellRoot = document.getElementById('workspace-view');
        const backdrop = document.getElementById('workspace-shell-drawer-backdrop');
        const btn = document.getElementById('workspace-drawer-open-btn');
        const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)') : null;
        if (mq?.matches && shellRoot) {
            shellRoot.classList.add('oaao-shell-drawer-open');
            document.body.classList.add('oaao-shell-drawer-open');
            btn?.setAttribute('aria-expanded', 'true');
            backdrop?.setAttribute('aria-hidden', 'false');
        }
        const list = document.getElementById('workspace-conversation-list');
        window.requestAnimationFrame(() => {
            list?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    }

    async function resetLanding(options = {}) {
        const focusInviteSidebar = Boolean(options.focusInviteSidebar);
        renderMessages([]);
        bindOaaoTaskListStripToConversation(mount, null);
        await refreshConversations(null);
        await openConversation(null, { replaceUrl: true, scroll: 'auto' });
        if (focusInviteSidebar) {
            focusWorkspaceSidebarAfterInvite();
        }
    }

    document.addEventListener(
        'oaao-switch-conversation',
        async (ev) => {
            const detail = ev instanceof CustomEvent ? ev.detail : null;
            const id = Number(
                detail && typeof detail === 'object' ? detail.conversation_id ?? detail.conversationId : 0,
            );
            if (!Number.isFinite(id) || id < 1) return;
            const modeRaw =
                detail && typeof detail === 'object' ? String(detail.mode ?? '').trim().toLowerCase() : '';
            if (modeRaw === 'default' || modeRaw === 'desk') {
                rememberConversationModeLocal(id, modeRaw);
            }
            await refreshConversations(id);
            await openConversation(id, { replaceUrl: true });
            syncChatComposerChips(mount);
        },
        { signal },
    );

    document.addEventListener(
        'oaao-workspace-scope-changed',
        (ev) => {
            const detail = ev instanceof CustomEvent ? ev.detail : null;
            const focusInviteSidebar =
                Boolean(detail && typeof detail === 'object' && detail.reason === 'invite_accept');
            void resetLanding({ focusInviteSidebar });
        },
        { signal },
    );

    document.addEventListener(
        'oaao-chat-new',
        () => {
            chatComposerActiveMaterial = null;
            chatComposerActiveSlideTemplate = null;
            try {
                sessionStorage.removeItem(CHAT_PENDING_SLIDE_TEMPLATE_KEY);
            } catch {
                /* ignore */
            }
            if (isChatComposerEditorEl(inputEl)) {
                removeTemplateSlugsFromEditor(inputEl);
                clearChatComposerEditor(inputEl);
            }
            syncChatComposerChips(mount);
            void resetLanding();
        },
        { signal },
    );

    for (const chip of mount.querySelectorAll('[data-oaao-chat="suggestion"]')) {
        chip.addEventListener(
            'click',
            () => {
                if (isChatComposerBusy(mount)) return;
                const t = (chip.textContent ?? '').trim();
                if (t && isChatComposerEditorEl(inputEl)) {
                    setChatComposerEditorPlainText(inputEl, t, { keepTemplate: true });
                    focusChatComposerEditor(inputEl);
                }
            },
            { signal },
        );
    }

    formEl.addEventListener(
        'submit',
        async (e) => {
            e.preventDefault();
            if (sendBtn instanceof HTMLButtonElement && sendBtn.dataset.oaaoChatStreaming === '1') {
                const cid = activeConversationId;
                if (cid && cid > 0) {
                    const paused = streamPausedForAgentAskByConversation.get(cid);
                    if (paused?.runId) {
                        void requestOrchestratorCancelRun(paused.runId);
                        streamPausedForAgentAskByConversation.delete(cid);
                        markOaaoRunTasksCancelled(mount, cid);
                    } else {
                        abortStreamReaderForConversation(cid);
                    }
                }
                chatComposerSubmitInFlight = false;
                chatComposerSubmitConvId = null;
                syncComposerBusyForActiveView(mount);
                return;
            }
            if (chatComposerSubmitInFlight || isChatComposerBusy(mount)) return;
            if (!isChatComposerEditorEl(inputEl)) return;
            const composerPayload = getChatComposerEditorPayload(inputEl);
            let body = composerPayload.text;
            let templateId = composerPayload.template_id || chatComposerActiveSlideTemplate?.template_id || '';
            if (!templateId) {
                const pendingTpl = readChatPendingSlideTemplateFromStorage();
                if (pendingTpl) {
                    templateId = pendingTpl.template_id;
                    chatComposerActiveSlideTemplate = pendingTpl;
                }
            }
            if (!templateId) {
                const directive = extractInlineTemplateSlugDirective(body);
                if (directive.slug) {
                    body = directive.body;
                    const hit = await resolvePublishedSlideTemplateSlug(directive.slug);
                    if (hit) {
                        templateId = hit.template_id;
                        chatComposerActiveSlideTemplate = {
                            template_id: hit.template_id,
                            label: hit.label,
                            thumb_url: hit.thumb_url,
                        };
                    }
                }
            } else {
                chatComposerActiveSlideTemplate = {
                    template_id: templateId,
                    label: composerPayload.label || templateId,
                    thumb_url: composerPayload.thumb_url || chatComposerActiveSlideTemplate?.thumb_url,
                };
            }
            if (!body && !templateId && chatComposerAttachments.length === 0) return;
            if (!body && !templateId && chatComposerAttachments.length > 0) {
                body = oaaoChatT(
                    'chat.attachment.default_send_prompt',
                    'Please read the attached file(s) and respond helpfully.',
                );
            }
            const tplLabel = chatComposerActiveSlideTemplate?.label ?? composerPayload.label ?? '';
            if (templateId && isVagueTemplateComposerBody(body, tplLabel)) {
                body = oaaoChatT(
                    'chat.template.default_send_prompt',
                    'Create a slide presentation using my selected template.',
                );
            } else if (!body && templateId) {
                body = oaaoChatT(
                    'chat.template.default_send_prompt',
                    'Create a slide presentation using my selected template.',
                );
            }
            clearOaaoTaskListStrip(mount, true);
            if (activeConversationId && activeConversationId > 0) {
                oaaoFreshRunByConv.add(activeConversationId);
            }
            chatComposerSubmitConvId = activeConversationId;
            chatComposerSubmitInFlight = true;
            setChatComposerBusy(mount, true, 'send');
            try {
                /** @type {Record<string, unknown>} */
                const vaultSendExtra = buildChatVaultSendExtra();
                if (chatComposerWebSearchEnabled) {
                    vaultSendExtra.enable_web_search = true;
                }
                if (chatComposerAttachments.length > 0) {
                    vaultSendExtra.attachment_ids = chatComposerAttachments.map((row) => row.id);
                }
                if (chatComposerActiveMaterial?.material_id) {
                    vaultSendExtra.active_material_id = chatComposerActiveMaterial.material_id;
                }
                if (templateId) {
                    vaultSendExtra.slide_template_id = templateId;
                }

                const plannerModeForSend = readComposerPlannerModeForSend(activeConversationId);
                const { res, data, raw, parseError } = await chatFetchJson(chatApiUrl('send'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        conversation_id: activeConversationId,
                        content: body,
                        chat_endpoint_id: getWorkspaceChatEndpointIdForSend(),
                        planner_mode_id: plannerModeForSend,
                        ...vaultSendExtra,
                        ...(activeConversationId && activeConversationId > 0
                            ? chatScopeBodyFieldsForConversation(activeConversationId)
                            : workspaceChatBodyFields()),
                    }),
                });
                if (!res.ok || data.success !== true) {
                    const err = document.createElement('p');
                    err.className = 'text-sm fg-red-6';
                    err.textContent = formatChatApiError(res, data, raw, parseError);
                    messagesEl.prepend(err);
                    console.warn('[oaao chat] send failed', res.status, { data, parseError, raw: String(raw ?? '').slice(0, 400) });

                    return;
                }
                const cid = Number(data.conversation_id);
                const prevCid = activeConversationId;
                const nextCid = cid > 0 ? cid : prevCid;
                if (typeof data.conversation_title === 'string' && data.conversation_title.trim()) {
                    applyConversationTitleToCache(nextCid, data.conversation_title);
                }
                rememberConversationWorkspace(
                    nextCid,
                    data.workspace_id != null ? data.workspace_id : getOaaoActiveWorkspaceIdForChat(),
                );
                if (nextCid > 0) {
                    oaaoFreshRunByConv.add(nextCid);
                    rememberPlannerModeLocal(nextCid, plannerModeForSend);
                    if (plannerModeForSend !== 'default') {
                        try {
                            sessionStorage.removeItem(OAAO_PLANNER_MODE_PENDING_KEY);
                        } catch {
                            /* ignore */
                        }
                    }
                    syncChatComposerPlannerModeSelect();
                }
                if (templateId && nextCid > 0) {
                    enterDeskModeForSlideDesigner(nextCid);
                }
                const stripOnSend = getOaaoTaskListStripHost(mount);
                if (stripOnSend && nextCid) {
                    stripOnSend.dataset.oaaoTaskListConv = String(nextCid);
                }
                clearChatComposerEditor(inputEl);
                chatComposerAttachments = [];
                chatComposerActiveMaterial = null;
                chatComposerActiveSlideTemplate = null;
                try {
                    sessionStorage.removeItem(CHAT_PENDING_SLIDE_TEMPLATE_KEY);
                } catch {
                    /* ignore */
                }
                syncChatComposerChips(mount);
                await refreshConversations(nextCid);
                await openConversation(nextCid, { replaceUrl: nextCid === prevCid });
                const rid = typeof data.run_id === 'string' ? data.run_id.trim() : '';
                const su = typeof data.stream_url === 'string' ? data.stream_url.trim() : '';
                const amid = coercePositiveInt(data.assistant_message_id);
                const assistantMid = amid;
                if (su && rid && activeConversationId) {
                    saveStreamCursor(activeConversationId, {
                        stream_url: su,
                        run_id: rid,
                        last_seq: 0,
                        ...(assistantMid ? { assistant_message_id: assistantMid } : {}),
                    });
                    setChatComposerStreamingUi(mount, true);
                    void consumeAssistantStream(
                        su,
                        rid,
                        activeConversationId,
                        0,
                        assistantMid,
                        Boolean(data.orchestrator_persist),
                    );
                }
            } finally {
                chatComposerSubmitInFlight = false;
                chatComposerSubmitConvId = null;
                syncComposerBusyForActiveView(mount);
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
                        await openConversation(null, { replaceUrl: true, scroll: 'auto' });
                        return;
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
                body: JSON.stringify({ conversation_id: cid, ...workspaceChatBodyFields() }),
            });
            if (!res.ok || !data.success || typeof data.share_slug !== 'string' || !data.share_slug.trim()) {
                toastOaao(data.message || 'Could not create share link', shareThreadBtn);

                return;
            }
            const u = new URL(window.location.href);
            u.searchParams.set('share', data.share_slug.trim());
            await copyTextToClipboard(u.toString());
            toastOaao('Share link copied', shareThreadBtn);
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
                body: JSON.stringify({ conversation_id: cid, archived: next, ...workspaceChatBodyFields() }),
            });
            if (!showArchivedConversations && next) {
                await openConversation(null, { replaceUrl: true, scroll: 'auto' });
            } else {
                await refreshConversations(activeConversationId);
                await loadMessages(activeConversationId, 'auto');
                updateChatLayout();
            }
            toastOaao(next ? 'Archived' : 'Restored', archiveThreadBtn);
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
                body: JSON.stringify({ conversation_id: cid, ...workspaceChatBodyFields() }),
            });
            await refreshConversations(null);
            await openConversation(null, { replaceUrl: true, scroll: 'auto' });
            renderSidebar();
            toastOaao('Chat deleted', deleteThreadBtn);
        },
        { signal },
    );

    setupComposerStackObserver();
    bindMessageHistoryScrollLoad();
    await tryResolveShareFromUrl();
    if (!activeConversationId) {
        activeConversationId = readChatConversationIdFromUrl();
    }
    await awaitWorkspaceListReady();
    await refreshConversations(activeConversationId);
    if (
        activeConversationId != null &&
        activeConversationId > 0 &&
        !cachedConversations.some((r) => Number(r.id) === activeConversationId)
    ) {
        activeConversationId = null;
    }
    await openConversation(activeConversationId, { replaceUrl: true });
    hydrateRuiIconSlots(document.getElementById('workspace-icon-rail') ?? document);
    if (!activeConversationId) {
        void maybeReplayPipelineFixture(mount, messagesEl);
    }
}
