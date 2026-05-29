/**
 * Authenticated workspace shell (core): sidebar from registry + generic module mount.
 * Feature modules own markup/scripts via {@see SpaRegister} extras {@code shell_panel_url} / {@code shell_js_module}.
 * URLs resolve through {@link ./shell-registry-url.js} ({@code RELATIVE_ROOT} / {@code data-oaao-mount-prefix}).
 */

import razyui from 'razyui';
import { oaaoT } from './oaao-i18n.js';
import { oaaoRazyToastFire } from './oaao-razy-toast.js';
import { openWorkspacePreferencesDialog } from './preferences-dialog.js';
import { oaaoAppendShellEsmV, resolveShellRegistryUrl } from './shell-registry-url.js';
import { oaaoMountLoadingLogo } from './oaao-loading-logo.js';
import { openWorkspaceSettingsDialog } from './settings-dialog.js';
import { wireWorkspaceNotifications } from './notification-panel.js';
import { wireWorkspaceTodos } from './todos-panel.js';
import { openWhatsNewDialog } from './whats-new-dialog.js';

/**
 * @param {string} value
 */
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @param {ParentNode} [scope] */
async function hydrateWorkspaceShellRuiIconsAsync(scope = document) {
    try {
        const m = await import(
            /* webpackIgnore: true */ oaaoAppendShellEsmV(
                resolveShellRegistryUrl('/webassets/chat/default/js/oaao-rui-icons.js'),
            ),
        );
        if (typeof m.hydrateRuiIconSlots === 'function') {
            const rail =
                scope instanceof Document
                    ? scope.getElementById('workspace-icon-rail')
                    : scope.querySelector?.('#workspace-icon-rail');
            m.hydrateRuiIconSlots(rail ?? scope);
        }
    } catch (err) {
        console.warn('[oaao] workspace RUI icon hydrate failed', err);
    }
}

/** @param {ParentNode | null | undefined} el */
async function hydrateOaaoJitMount(el) {
    if (!(el instanceof HTMLElement)) return;
    try {
        const JIT = await razyui.load('JIT');
        if (JIT && typeof JIT.hydrate === 'function') {
            JIT.hydrate(el);
        }
    } catch {
        /* JIT optional — cloak reveal still runs */
    }
}

/** @param {HTMLElement | null | undefined} el @param {boolean} ready */
function setRazyuiCloakReady(el, ready) {
    if (!(el instanceof HTMLElement)) return;
    el.setAttribute('razyui-cloak', ready ? 'ready' : '');
}

/** End workspace cloak ({@see razyui.revealCloak}) — includes {@code #workspace-view} itself. */
function revealWorkspaceShellReady(root) {
    if (!(root instanceof HTMLElement)) return;
    if (root.hasAttribute('razyui-cloak') && root.getAttribute('razyui-cloak') !== 'ready') {
        root.setAttribute('razyui-cloak', 'ready');
    }
    root.querySelectorAll('[razyui-cloak]:not([razyui-cloak="ready"])').forEach((el) => {
        el.setAttribute('razyui-cloak', 'ready');
    });
}

/**
 * JIT-first show: compile utilities while hidden, then unhide + reveal in one turn
 * ({@see main.js} after {@code razyui.boot()}).
 */
export async function revealAuthenticatedWorkspaceShell() {
    const root = document.getElementById('workspace-view');
    if (!root) return;
    await hydrateOaaoJitMount(root);
    root.hidden = false;
    revealWorkspaceShellReady(root);
    document.body.classList.add('oaao-shell-ready');
    document.dispatchEvent(new CustomEvent('oaao:shell-ready'));
    void hydrateWorkspaceShellRuiIconsAsync(root);
}

/** @returns {ReadonlyArray<Record<string, unknown>>} */
function spaPages() {
    const raw = globalThis.OAAO_SPA_REGISTRY;
    return Array.isArray(raw) ? raw : [];
}

function pageIdToPath(pageId) {
    const parts = String(pageId || '')
        .split('/')
        .map((s) => encodeURIComponent(s.trim()))
        .filter(Boolean);
    return `/${parts.join('/')}`;
}

/** Query keys preserved when navigating to Chat — reload restores open thread ({@see chat-panel.js}). */
const WORKSPACE_CHAT_PRESERVED_QUERY_KEYS = ['conversation_id', 'share'];

function workspaceStripChatDeepLinkQuery() {
    const u = new URL(window.location.href);
    let changed = false;
    for (const key of WORKSPACE_CHAT_PRESERVED_QUERY_KEYS) {
        if (u.searchParams.has(key)) {
            u.searchParams.delete(key);
            changed = true;
        }
    }
    if (!changed) return;
    const qs = u.searchParams.toString();
    const next = `${u.pathname}${qs ? `?${qs}` : ''}${u.hash}`;
    const prev =
        window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    window.history.replaceState({ ...prev, chatConversationId: null }, '', next);
}

/**
 * SPA {@code navigate()} writes path-only URLs; keep vault explorer fragments on the vault page
 * ({@see oaaoai/vault/default/webassets/js/vault-panel.js vaultWriteLocationHashFromNav}).
 *
 * @param {string} path
 * @param {string | null} resolvedPageId
 */
function workspaceBrowserUrlWithPreservedFragment(path, resolvedPageId) {
    const h = typeof window.location.hash === 'string' ? window.location.hash : '';
    if (resolvedPageId === 'workspace/vault' && h.startsWith('#oaao-vault=')) {
        return `${path}${h}`;
    }
    if (resolvedPageId === 'workspace/chat') {
        const params = new URLSearchParams(window.location.search);
        const kept = new URLSearchParams();
        for (const key of WORKSPACE_CHAT_PRESERVED_QUERY_KEYS) {
            const v = params.get(key);
            if (v != null && String(v).trim() !== '') {
                kept.set(key, String(v).trim());
            }
        }
        const qs = kept.toString();
        if (qs) {
            return `${path}?${qs}`;
        }
    }

    return path;
}

function pathOpensPreferences(pathname) {
    const norm = (pathname || '/').replace(/\/+$/, '') || '/';
    const decoded = norm
        .split('/')
        .filter(Boolean)
        .map((s) => {
            try {
                return decodeURIComponent(s);
            } catch {
                return s;
            }
        })
        .join('/');
    const probe = decoded ? `/${decoded}` : '/';
    return probe === '/workspace/preferences' || probe === '/account';
}

function pathToPageId(pathname) {
    const norm = (pathname || '/').replace(/\/+$/, '') || '/';
    const decoded = norm
        .split('/')
        .filter(Boolean)
        .map((s) => {
            try {
                return decodeURIComponent(s);
            } catch {
                return s;
            }
        })
        .join('/');
    const probe = decoded ? `/${decoded}` : '/';

    /** Root URL → default Chat surface when registered (login lands on `/`). */
    if (probe === '/') {
        const chat = spaPages().find((p) => p.page_id === 'workspace/chat');
        if (chat) return 'workspace/chat';
    }

    /** Deep links → Chat shell; Preferences opens as dialog after first navigate ({@see initWorkspaceShell}). */
    if (probe === '/workspace/preferences' || probe === '/account') {
        const chat = spaPages().find((p) => p.page_id === 'workspace/chat');
        if (chat) return 'workspace/chat';
    }

    for (const p of spaPages()) {
        if (pageIdToPath(p.page_id) === probe) {
            return p.page_id;
        }
    }
    return null;
}

function defaultPageId() {
    const pages = spaPages();
    const preferred = pages.find((p) => p.page_id === 'workspace/chat');
    return preferred?.page_id ?? pages[0]?.page_id ?? null;
}

const CHAT_PROFILE_STORAGE_KEY = 'oaao.workspace.chat_endpoint_id';

/** Legacy single-id key — migrated to {@link WORKSPACE_SCOPE_V2_KEY}. */
const WORKSPACE_SCOPE_STORAGE_KEY = 'oaao.workspace.active_workspace_id';

/** JSON `{ id: number, name?: string }` — {@code id} omitted/zero ⇒ Personal scope. */
const WORKSPACE_SCOPE_V2_KEY = 'oaao.workspace.scope';

/** Split layout — icon rail + module sidebar + main ({@code workspace/chat}, {@code workspace/vault}, {@code workspace/rag-explore}). */
const SPLIT_LAYOUT_PAGE_IDS = new Set([
    'workspace/chat',
    'workspace/vault',
    'workspace/rag-explore',
    'workspace/library',
]);

/** Gallery layout — icon rail + main; centered card column ({@code workspace/agents}, {@code workspace/templates}). */
const GALLERY_LAYOUT_PAGE_IDS = new Set([
    'workspace/agents',
    'workspace/templates',
    'workspace/corpus',
]);

/** Rail-only layout — hide sidebar, full-width main ({@code workspace/research}, {@code workspace/mines}, …). */
const RAIL_ONLY_LAYOUT_PAGE_IDS = new Set([
    'workspace/live-meeting',
    'workspace/research',
    'workspace/mines',
    'workspace/calendar',
]);

/**
 * @param {string} pageId
 */
function isGalleryLayoutPage(pageId) {
    return GALLERY_LAYOUT_PAGE_IDS.has(pageId);
}

/**
 * @param {string} pageId
 */
function isRailOnlyLayoutPage(pageId) {
    return RAIL_ONLY_LAYOUT_PAGE_IDS.has(pageId);
}

/**
 * @param {string} activePageId
 */
function syncWorkspaceShellLayout(activePageId) {
    const view = document.getElementById('workspace-view');
    if (!view) return;

    const gallery = isGalleryLayoutPage(activePageId);
    const railOnly = isRailOnlyLayoutPage(activePageId);
    const split = SPLIT_LAYOUT_PAGE_IDS.has(activePageId);
    view.classList.toggle('oaao-workspace-layout--gallery', gallery);
    view.classList.toggle('oaao-workspace-layout--rail-only', railOnly);
    view.classList.toggle('oaao-workspace-layout--split', split && !gallery && !railOnly);

    const shellTenant = document.getElementById('workspace-shell-tenant-label');
    const headerTenant = document.getElementById('workspace-header-tenant-label');
    if (shellTenant && headerTenant) {
        const text = (shellTenant.textContent ?? '').trim();
        if (text && headerTenant.textContent !== text) {
            headerTenant.textContent = text;
        }
    }
}

/**
 * @returns {{ id: number | null, name: string | null }}
 */
function readWorkspaceScopeFromStorage() {
    try {
        const raw = localStorage.getItem(WORKSPACE_SCOPE_V2_KEY);
        if (raw) {
            const o = JSON.parse(raw);
            const idRaw = o?.id;
            let id = null;
            if (idRaw !== null && idRaw !== undefined && `${idRaw}`.trim() !== '') {
                const n = Number(idRaw);
                id = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
            }
            const nameRaw = typeof o?.name === 'string' ? o.name.trim() : '';
            return { id, name: nameRaw || null };
        }
    } catch {
        /* ignore */
    }
    try {
        const legacy = (localStorage.getItem(WORKSPACE_SCOPE_STORAGE_KEY) || '').trim();
        if (legacy !== '') {
            const n = Number(legacy);
            const id = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
            if (id !== null) {
                persistWorkspaceScopeRaw(id, '');
                localStorage.removeItem(WORKSPACE_SCOPE_STORAGE_KEY);
                return { id, name: null };
            }
        }
    } catch {
        /* ignore */
    }
    return { id: null, name: null };
}

/**
 * @param {number | null} workspaceId
 * @param {string | null | undefined} workspaceName
 */
function persistWorkspaceScopeRaw(workspaceId, workspaceName) {
    try {
        if (workspaceId != null && workspaceId > 0) {
            const id = Math.floor(workspaceId);
            const nm =
                typeof workspaceName === 'string' && workspaceName.trim() !== ''
                    ? workspaceName.trim().slice(0, 120)
                    : '';
            localStorage.setItem(WORKSPACE_SCOPE_V2_KEY, JSON.stringify({ id, name: nm }));
        } else {
            localStorage.removeItem(WORKSPACE_SCOPE_V2_KEY);
        }
        localStorage.removeItem(WORKSPACE_SCOPE_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * @param {number | null} workspaceId
 * @param {string | null | undefined} [workspaceDisplayName]
 */
function persistWorkspaceScope(workspaceId, workspaceDisplayName = undefined) {
    if (workspaceId != null && workspaceId > 0) {
        persistWorkspaceScopeRaw(workspaceId, workspaceDisplayName ?? '');
    } else {
        persistWorkspaceScopeRaw(null, null);
    }
}

/**
 * @param {number | null} workspaceId
 * @param {string | null} workspaceName
 */
function dispatchWorkspaceScopeChanged(workspaceId, extraDetail = {}) {
    document.dispatchEvent(
        new CustomEvent('oaao-workspace-scope-changed', {
            bubbles: true,
            detail: { workspace_id: workspaceId, ...extraDetail },
        }),
    );
}

/**
 * @param {number | null} workspaceId
 * @param {string | null} workspaceName
 */
function formatWorkspaceScopeLabel(workspaceId, workspaceName) {
    if (workspaceId == null || workspaceId < 1) {
        const el = document.getElementById('oaao-i18n-workspace-scope-personal');
        const t = el?.textContent?.trim();
        return t || 'Personal';
    }
    const nm = workspaceName && workspaceName.trim() ? workspaceName.trim() : '';
    if (nm) return nm;
    return `Workspace · #${Math.floor(workspaceId)}`;
}

/**
 * @param {HTMLElement | null} root
 * @param {number | null} workspaceId
 * @param {string | null} [workspaceDisplayName]
 */
function applyWorkspaceScopeDataset(root, workspaceId, workspaceDisplayName = null) {
    const idStr = workspaceId != null && workspaceId > 0 ? String(Math.floor(workspaceId)) : '';
    const labelText = formatWorkspaceScopeLabel(
        workspaceId != null && workspaceId > 0 ? Math.floor(workspaceId) : null,
        workspaceDisplayName,
    );
    if (root) {
        root.dataset.oaaoActiveWorkspaceId = idStr;
    }
    const folderTrig = document.getElementById('workspace-folder-trigger');
    const folderTrigLabel = document.getElementById('workspace-folder-trigger-label');
    if (folderTrigLabel) {
        folderTrigLabel.textContent = labelText;
    }
    if (folderTrig) {
        folderTrig.title = idStr
            ? `Workspace: ${labelText}. Double-click to return to Personal.`
            : 'Personal scope — pick or create a team workspace.';
    }
}

/**
 * URL wins over storage; strips ``workspace_id`` from the query string after apply.
 *
 * @param {HTMLElement | null} root
 */
function syncWorkspaceScopeFromUrlOrStorage(root) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('workspace_id')) {
        const raw = params.get('workspace_id');
        const trimmed = raw != null ? String(raw).trim() : '';
        let wid = null;
        if (trimmed !== '' && trimmed !== '0') {
            const n = Number(trimmed);
            wid = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        }
        params.delete('workspace_id');
        const qs = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
        persistWorkspaceScope(wid, '');
        applyWorkspaceScopeDataset(root, wid, null);
        dispatchWorkspaceScopeChanged(wid);
        void hydrateWorkspaceLabelsFromServer(root);

        return;
    }
    const stored = readWorkspaceScopeFromStorage();
    applyWorkspaceScopeDataset(root, stored.id, stored.name);
    if (stored.id != null && stored.id > 0 && !stored.name) {
        void hydrateWorkspaceLabelsFromServer(root);
    }
}

/**
 * @param {HTMLElement | null} root
 */
function wireWorkspaceScopeQuickPersonal(root) {
    const trig = document.getElementById('workspace-folder-trigger');
    if (!trig || trig.dataset.oaaoScopeQuickPersonalBound === '1') return;
    trig.dataset.oaaoScopeQuickPersonalBound = '1';
    trig.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        persistWorkspaceScope(null);
        applyWorkspaceScopeDataset(root, null, null);
        dispatchWorkspaceScopeChanged(null);
    });
}
const WORKSPACE_CHAT_PROFILE_UI = {
    loading: { en: 'Loading endpoints…', 'zh-Hant': '正在載入聊天端點…' },
    fallback: { en: 'Default chat', 'zh-Hant': '預設聊天' },
};

function workspaceShellUiLang() {
    const raw = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
    if (raw.startsWith('zh')) return 'zh-Hant';

    return 'en';
}

/** @param {'loading' | 'fallback'} kind */
function workspaceChatProfileUiString(kind) {
    const row = WORKSPACE_CHAT_PROFILE_UI[kind];
    if (!row) return '';
    const lang = workspaceShellUiLang();

    return row[lang] ?? row.en ?? '';
}

/**
 * Prefer translated node text after {@code razyui.boot()} ({@code data-i18n}), else UTF-8 fallback map.
 *
 * @param {string} selector
 * @param {'loading' | 'fallback'} kind
 */
function workspaceChatProfileLabelFromDomOrFallback(selector, kind) {
    const el = document.querySelector(selector);
    const fromDom = el?.textContent?.trim();
    if (fromDom) return fromDom;

    return workspaceChatProfileUiString(kind);
}

/** Same root resolution as chat panel ({@see chat-panel.js chatApiBase}). */
function workspaceChatApiUrl(action) {
    const authBase = (typeof document !== 'undefined' && document.body?.dataset?.authBase || '').trim();
    const a = String(action || '').replace(/^\/+/, '');
    if (authBase) {
        try {
            const u = new URL(authBase, window.location.href);
            let rootPath = u.pathname.replace(/\/?$/, '');
            rootPath = rootPath.replace(/\/auth$/i, '') || '/';
            if (!rootPath.endsWith('/')) rootPath += '/';

            return `${rootPath}chat/api/${a}`;
        } catch {
            /* fall through */
        }
    }

    return `/chat/api/${a}`;
}

/** @type {Promise<{ rows: { workspace_id: number, name: string, role?: string }[], postgresRequired: boolean }> | null} */
let workspaceListInflight = null;
/** @type {{ rows: { workspace_id: number, name: string, role?: string }[], postgresRequired: boolean, at: number } | null} */
let workspaceListCache = null;
const WORKSPACE_LIST_TTL_MS = 30_000;

/**
 * Deduped GET /chat/api/workspaces — boot validation + picker share one in-flight request.
 *
 * @param {boolean} [force]
 */
async function fetchWorkspaceList(force = false) {
    const now = Date.now();
    if (!force && workspaceListCache && now - workspaceListCache.at < WORKSPACE_LIST_TTL_MS) {
        return {
            rows: workspaceListCache.rows,
            postgresRequired: workspaceListCache.postgresRequired,
        };
    }
    if (!workspaceListInflight) {
        workspaceListInflight = (async () => {
            const res = await fetch(workspaceChatApiUrl('workspaces'), {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
            /** @type {{ success?: boolean, workspaces?: unknown, postgres_required?: boolean }} */
            const data = await res.json().catch(() => ({}));
            const postgresRequired = Boolean(data.postgres_required);
            const raw = Array.isArray(data.workspaces) ? data.workspaces : [];
            const rows = normalizeWorkspacePickerRows(raw);
            workspaceListCache = { rows, postgresRequired, at: Date.now() };
            if (typeof document !== 'undefined' && document.body) {
                document.body.dataset.oaaoWorkspaceListReady = '1';
                document.dispatchEvent(
                    new CustomEvent('oaao-workspace-list-ready', {
                        detail: { rows, postgresRequired },
                    }),
                );
            }

            return { rows, postgresRequired };
        })().finally(() => {
            workspaceListInflight = null;
        });
    }

    return workspaceListInflight;
}

/**
 * @param {HTMLElement | null} root
 * @param {{ workspace_id: number, name: string, role?: string }[]} rows
 */
function reconcileWorkspaceScopeWithList(root, rows) {
    const stored = readWorkspaceScopeFromStorage();
    if (stored.id != null && stored.id > 0) {
        const hit = rows.find((r) => r.workspace_id === stored.id);
        if (!hit) {
            persistWorkspaceScope(null);
            applyWorkspaceScopeDataset(root, null, null);
            dispatchWorkspaceScopeChanged(null, { reason: 'scope_invalid' });

            return;
        }
        if (!stored.name && hit.name) {
            persistWorkspaceScope(stored.id, hit.name);
            applyWorkspaceScopeDataset(root, stored.id, hit.name);
        }

        return;
    }

    const idRaw = root?.dataset?.oaaoActiveWorkspaceId?.trim() ?? '';
    if (!idRaw) return;
    const wid = Number(idRaw);
    if (!Number.isFinite(wid) || wid < 1) return;
    const hit = rows.find((r) => r.workspace_id === wid);
    if (!hit) {
        persistWorkspaceScope(null);
        applyWorkspaceScopeDataset(root, null, null);
        dispatchWorkspaceScopeChanged(null, { reason: 'scope_invalid' });

        return;
    }
    persistWorkspaceScope(wid, hit.name || '');
    applyWorkspaceScopeDataset(root, wid, hit.name || null);
}

/**
 * @param {HTMLElement | null} root
 */
async function primeWorkspaceScopeFromServer(root) {
    try {
        const { rows } = await fetchWorkspaceList(false);
        reconcileWorkspaceScopeWithList(root, rows);
    } catch {
        /* ignore */
    }
}

/**
 * Consumes {@code ?workspace_invite_token=} on load: POST {@code workspace_invite_accept}, switches scope on success.
 *
 * @param {HTMLElement | null} root
 */
/**
 * Reads {@code workspace_invite_token}, strips it from the address bar (so SPA routing never drops it), returns token or ''.
 */
function takeWorkspaceInviteTokenFromUrl() {
    const u = new URL(window.location.href);
    const token = u.searchParams.get('workspace_invite_token')?.trim();
    if (!token || token.length > 96 || !/^[0-9a-f]+$/i.test(token)) return '';

    u.searchParams.delete('workspace_invite_token');
    const qs = u.searchParams.toString();
    window.history.replaceState({}, '', `${u.pathname}${qs ? `?${qs}` : ''}${u.hash}`);

    return token;
}

/**
 * POST {@code workspace_invite_accept} — call after shell routing exists; pass token from {@link takeWorkspaceInviteTokenFromUrl}.
 *
 * @param {HTMLElement | null} root
 * @param {(pageId: string | null, opts?: { replace?: boolean }) => void | Promise<void>} [navigateFn]
 * @param {string} [inviteToken]
 */
async function tryConsumeWorkspaceInviteFromUrl(root, navigateFn, inviteToken = '') {
    const token = (inviteToken || '').trim();
    if (!token || token.length > 96 || !/^[0-9a-f]+$/i.test(token)) return;

    try {
        const res = await fetch(workspaceChatApiUrl('workspace_invite_accept'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ token }),
        });
        const data = /** @type {{ success?: boolean, workspace_id?: unknown, name?: string, message?: string }} */ (
            await res.json().catch(() => ({}))
        );
        const widRaw = data.workspace_id;
        const wid =
            typeof widRaw === 'number' && Number.isFinite(widRaw)
                ? Math.floor(widRaw)
                : typeof widRaw === 'string'
                  ? Math.floor(Number(widRaw))
                  : NaN;
        if (data.success && Number.isFinite(wid) && wid > 0) {
            const nm = typeof data.name === 'string' ? data.name.trim() : '';
            persistWorkspaceScope(wid, nm || '');
            applyWorkspaceScopeDataset(root, wid, nm || null);
            dispatchWorkspaceScopeChanged(wid, { reason: 'invite_accept', workspace_name: nm });
            const label = nm || `Workspace · #${wid}`;
            oaaoRazyToastFire(`Joined workspace · ${label}`, 'success');
            const hasChat = spaPages().some((p) => p.page_id === 'workspace/chat');
            if (hasChat && typeof navigateFn === 'function') {
                void navigateFn('workspace/chat', { replace: true });
            }
        } else {
            const msg = typeof data.message === 'string' && data.message ? data.message : 'Could not accept invitation';
            oaaoRazyToastFire(msg, 'error');
        }
    } catch {
        oaaoRazyToastFire('Could not accept invitation', 'error');
    }
}

/**
 * Resolve workspace display label after navigation / legacy storage using `/chat/api/workspaces`.
 *
 * @param {HTMLElement | null} root
 */
async function hydrateWorkspaceLabelsFromServer(root) {
    try {
        const { rows } = await fetchWorkspaceList(false);
        reconcileWorkspaceScopeWithList(root, rows);
    } catch {
        /* ignore */
    }
}

/**
 * Stable single row per {@code workspace_id}; sort by display name (PostgreSQL already prevents duplicate membership PK).
 *
 * @param {unknown[]} raw
 * @returns {{ workspace_id: number, name: string, role?: string }[]}
 */
function normalizeWorkspacePickerRows(raw) {
    const mapped = raw
        .filter((x) => x && typeof x === 'object')
        .map((x) => {
            const o = /** @type {Record<string, unknown>} */ (x);
            return {
                workspace_id: Number(o.workspace_id ?? 0),
                name: String(o.name ?? '').trim(),
                role: typeof o.role === 'string' ? o.role : '',
            };
        })
        .filter((x) => x.workspace_id > 0 && x.name !== '');
    /** @type {Map<number, { workspace_id: number, name: string, role?: string }>} */
    const dedup = new Map();
    for (const x of mapped) {
        if (!dedup.has(x.workspace_id)) dedup.set(x.workspace_id, x);
    }
    const list = [...dedup.values()];
    list.sort((a, b) => {
        const na = a.name.toLowerCase();
        const nb = b.name.toLowerCase();
        if (na !== nb) return na.localeCompare(nb, undefined, { sensitivity: 'base' });

        return a.workspace_id - b.workspace_id;
    });

    return list;
}

/**
 * Show {@code Name (#id)} when multiple workspaces share the same display name (distinct workspace rows).
 *
 * @param {{ workspace_id: number, name: string, role?: string }[]} items
 */
function annotateWorkspacePickerLabels(items) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const it of items) {
        const nm = String(it.name ?? '').trim();
        counts.set(nm, (counts.get(nm) ?? 0) + 1);
    }

    return items.map((it) => {
        const nm = String(it.name ?? '').trim();
        const dup = (counts.get(nm) ?? 0) > 1;

        return { ...it, pickerLabel: dup ? `${nm} (#${it.workspace_id})` : nm };
    });
}

/** Lucide stroke icons for workspace picker rows ({@see workspace.tpl} rail SVG parity). */
const OAAO_WS_PICKER_ICON_USER =
    '<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[1rem] h-[1rem] shrink-0 block pointer-events-none text-[inherit]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';

/** Lucide group — team / shared workspace rows ({@see wireWorkspaceFolderPicker}). */
const OAAO_WS_PICKER_ICON_WORKSPACE =
    '<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[1rem] h-[1rem] shrink-0 block pointer-events-none text-[inherit]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5c0-1.1.9-2 2-2h2"/><path d="M17 3h2c1.1 0 2 .9 2 2v2"/><path d="M21 17v2c0 1.1-.9 2-2 2h-2"/><path d="M7 21H5c-1.1 0-2-.9-2-2v-2"/><rect width="7" height="5" x="7" y="7" rx="1"/><rect width="7" height="5" x="10" y="12" rx="1"/></svg>';

/**
 * Open-WebUI-style workspace folder picker + create (PostgreSQL-backed).
 *
 * @param {HTMLElement | null} root
 */
function wireWorkspaceFolderPicker(root) {
    const pickerRoot = document.getElementById('workspace-folder-picker-root');
    const trigger = document.getElementById('workspace-folder-trigger');
    const anchor = document.getElementById('workspace-folder-anchor');
    const panel = document.getElementById('workspace-folder-panel');
    const createInput = document.getElementById('workspace-folder-create-input');
    const createBtn = document.getElementById('workspace-folder-create-btn');
    const noteEl = document.getElementById('workspace-folder-picker-note');
    if (!pickerRoot || !trigger || !anchor || !panel || !createInput || !createBtn || pickerRoot.dataset.oaaoWsPickBound === '1')
        return;
    pickerRoot.dataset.oaaoWsPickBound = '1';

    /** @type {{ workspace_id: number, name: string, role?: string }[]} */
    let rows = [];
    let postgresRequired = false;

    function closePanel() {
        anchor.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function openPanel() {
        anchor.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    }

    function pickPersonal() {
        persistWorkspaceScope(null);
        applyWorkspaceScopeDataset(root, null, null);
        dispatchWorkspaceScopeChanged(null);
        closePanel();
    }

    /**
     * @param {number} workspaceId
     * @param {string} workspaceName
     */
    function pickWorkspace(workspaceId, workspaceName) {
        persistWorkspaceScope(workspaceId, workspaceName);
        applyWorkspaceScopeDataset(root, workspaceId, workspaceName);
        dispatchWorkspaceScopeChanged(workspaceId);
        closePanel();
    }

    function renderPanel() {
        panel.textContent = '';
        const rowShell =
            'group flex items-stretch min-w-0 w-full rounded-[6px] overflow-hidden transition-colors hover:bg-[var(--grid-line)]/35 focus-within:bg-[var(--grid-line)]/35';
        const pickBtnShell =
            'flex flex-1 min-w-0 items-center gap-2 text-left px-2 py-1.5 text-[0.8125rem] fg-[var(--grid-ink)] bg-transparent border-none cursor-pointer font-inherit';
        const leadIconShell =
            'inline-flex shrink-0 w-4 h-4 items-center justify-center fg-[var(--grid-caption)] transition-colors duration-150 group-hover:fg-[var(--grid-ink)] pointer-events-none';

        const personalRow = document.createElement('div');
        personalRow.className = rowShell;
        const personalBtn = document.createElement('button');
        personalBtn.type = 'button';
        personalBtn.setAttribute('role', 'option');
        personalBtn.className = pickBtnShell;
        const personalIcon = document.createElement('span');
        personalIcon.className = leadIconShell;
        personalIcon.setAttribute('aria-hidden', 'true');
        personalIcon.innerHTML = OAAO_WS_PICKER_ICON_USER;
        const personalLabel = document.createElement('span');
        personalLabel.className = 'truncate min-w-0';
        personalLabel.textContent = formatWorkspaceScopeLabel(null, null);
        personalBtn.append(personalIcon, personalLabel);
        personalBtn.addEventListener('click', () => pickPersonal());
        const personalGearPad = document.createElement('span');
        personalGearPad.className = 'shrink-0 w-8 min-w-8 inline-flex items-center justify-center';
        personalGearPad.setAttribute('aria-hidden', 'true');
        personalRow.append(personalBtn, personalGearPad);
        panel.append(personalRow);

        for (const r of annotateWorkspacePickerLabels(rows)) {
            const wid = Number(r.workspace_id);
            const nm = String(r.name ?? '').trim();
            const rowLabel = typeof r.pickerLabel === 'string' ? r.pickerLabel : nm;
            if (!Number.isFinite(wid) || wid < 1 || !nm) continue;
            const row = document.createElement('div');
            row.className = rowShell;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            btn.dataset.workspaceId = String(wid);
            btn.className = pickBtnShell;
            const wsIcon = document.createElement('span');
            wsIcon.className = leadIconShell;
            wsIcon.setAttribute('aria-hidden', 'true');
            wsIcon.innerHTML = OAAO_WS_PICKER_ICON_WORKSPACE;
            const wsLabel = document.createElement('span');
            wsLabel.className = 'truncate min-w-0';
            wsLabel.textContent = rowLabel;
            btn.append(wsIcon, wsLabel);
            btn.addEventListener('click', () => pickWorkspace(wid, nm));
            const gear = document.createElement('button');
            gear.type = 'button';
            gear.className =
                'shrink-0 w-8 min-w-8 inline-flex items-center justify-center px-0 py-1.5 bg-transparent border-none cursor-pointer font-inherit fg-[var(--grid-caption)] transition-colors duration-150 group-hover:fg-[var(--grid-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--grid-accent)]';
            gear.setAttribute('aria-label', 'Manage workspace');
            gear.title = 'Manage workspace';
            /** Inline SVG — shell does not load Remix Icon webfont ({@see workspace.tpl} rail icons). */
            gear.insertAdjacentHTML(
                'beforeend',
                '<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[1rem] h-[1rem] shrink-0 block pointer-events-none text-[inherit]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
            );
            gear.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closePanel();
                void (async () => {
                    try {
                        const mod = await import('./workspace-team-dialog.js');
                        await mod.openWorkspaceTeamDialog(razyui, {
                            workspaceId: wid,
                            workspaceName: nm,
                            myRole: typeof r.role === 'string' ? r.role : 'member',
                            api: workspaceChatApiUrl,
                            onTeamChanged() {
                                void refreshFromServer();
                            },
                            syncActiveWorkspaceRename(workspaceId, newName) {
                                const curRaw = root?.dataset?.oaaoActiveWorkspaceId?.trim() ?? '';
                                const cur = curRaw !== '' ? Number(curRaw) : NaN;
                                if (Number.isFinite(cur) && cur === workspaceId) {
                                    persistWorkspaceScope(workspaceId, newName);
                                    applyWorkspaceScopeDataset(root, workspaceId, newName);
                                }
                            },
                            clearActiveWorkspaceIfDeleted(workspaceId) {
                                const activeRaw = root?.dataset?.oaaoActiveWorkspaceId?.trim() ?? '';
                                const activeId = activeRaw !== '' ? Number(activeRaw) : NaN;
                                if (Number.isFinite(activeId) && activeId === workspaceId) {
                                    persistWorkspaceScope(null);
                                    applyWorkspaceScopeDataset(root, null, null);
                                    dispatchWorkspaceScopeChanged(null);
                                }
                            },
                        });
                    } catch (err) {
                        console.error('[oaao] workspace team dialog failed', err);
                    }
                })();
            });
            row.append(btn, gear);
            panel.append(row);
        }

        if (noteEl) {
            if (postgresRequired) {
                noteEl.classList.remove('hidden');
                noteEl.textContent =
                    'Team workspaces need PostgreSQL as the canonical database. Personal chats still work.';
            } else {
                noteEl.classList.add('hidden');
                noteEl.textContent = '';
            }
        }
    }

    async function refreshFromServer(force = false) {
        try {
            const { rows: list, postgresRequired: pgReq } = await fetchWorkspaceList(force);
            postgresRequired = pgReq;
            rows = list;
            renderPanel();
            reconcileWorkspaceScopeWithList(root, rows);
        } catch {
            rows = [];
            postgresRequired = false;
            renderPanel();
        }
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (anchor.classList.contains('hidden')) {
            void refreshFromServer(true).finally(() => openPanel());
        } else closePanel();
    });

    document.addEventListener(
        'click',
        (ev) => {
            if (!(ev.target instanceof Node)) return;
            if (!pickerRoot.contains(ev.target)) closePanel();
        },
        true,
    );

    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        closePanel();
    });

    createBtn.addEventListener('click', () => {
        const nm = createInput.value.trim();
        if (nm === '') return;
        if (createBtn.disabled) return;
        createBtn.disabled = true;
        void (async () => {
            try {
                const res = await fetch(workspaceChatApiUrl('workspace_create'), {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ name: nm }),
                });
                /** @type {{ success?: boolean, workspace?: { workspace_id?: number, name?: string }, message?: string }} */
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success || !data.workspace) {
                    const msg = typeof data.message === 'string' ? data.message : 'Could not create workspace';
                    noteEl?.classList.remove('hidden');
                    if (noteEl) noteEl.textContent = msg;
                    return;
                }
                const wid = Number(data.workspace.workspace_id ?? 0);
                const label = String(data.workspace.name ?? nm).trim();
                createInput.value = '';
                await refreshFromServer(true);
                if (Number.isFinite(wid) && wid > 0) {
                    pickWorkspace(wid, label);
                }
            } finally {
                createBtn.disabled = false;
            }
        })();
    });

    void refreshFromServer();
}

/** Same root resolution as {@see vault-panel.js vaultApiBase}. */
function workspaceVaultApiBase() {
    const authBase = (typeof document !== 'undefined' && document.body?.dataset?.authBase || '').trim();
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

/**
 * @param {HTMLElement | null} root
 * @returns {number | null}
 */
function workspaceActiveVaultScopeId(root) {
    const ds =
        typeof root?.dataset?.oaaoActiveWorkspaceId === 'string' ? root.dataset.oaaoActiveWorkspaceId.trim() : '';
    if (!ds) return null;
    const n = Number(ds);

    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

const OAAO_VAULT_CREATE_UI = {
    name_required: { en: 'Enter a vault name.', 'zh-Hant': '請輸入保管庫名稱。' },
    error: { en: 'Could not create vault.', 'zh-Hant': '無法建立保管庫。' },
};

/** @param {keyof typeof OAAO_VAULT_CREATE_UI} kind */
function vaultCreateUiString(kind) {
    const row = OAAO_VAULT_CREATE_UI[kind];
    if (!row) return '';
    const lang = workspaceShellUiLang();

    return row[lang] ?? row.en ?? '';
}

/** Shell sidebar — persistent wiring ({@see workspace.tpl} {@code #workspace-vault-create-row}). */
function wireWorkspaceVaultSidebarCreate(root) {
    const row = document.getElementById('workspace-vault-create-row');
    const input = document.getElementById('workspace-vault-create-input');
    const btn = document.getElementById('workspace-vault-create-btn');
    const note = document.getElementById('workspace-vault-create-note');
    if (!row || !input || !btn || !(input instanceof HTMLInputElement) || !(btn instanceof HTMLButtonElement)) return;
    if (row.dataset.oaaoVaultCreateBound === '1') return;
    row.dataset.oaaoVaultCreateBound = '1';

    /** @param {string} text @param {boolean} visible */
    const setNote = (text, visible) => {
        if (!note) return;
        note.textContent = text;
        note.classList.toggle('hidden', !visible);
    };

    const submit = async () => {
        const nm = input.value.trim();
        if (!nm) {
            setNote(vaultCreateUiString('name_required'), true);

            return;
        }
        if (btn.disabled) return;
        setNote('', false);
        btn.disabled = true;
        try {
            const wid = workspaceActiveVaultScopeId(root);
            /** @type {Record<string, unknown>} */
            const payload = { name: nm };
            if (wid != null) payload.workspace_id = wid;

            const res = await fetch(`${workspaceVaultApiBase()}vault_create`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(payload),
            });
            /** @type {{ success?: boolean, message?: string }} */
            const j = await res.json().catch(() => ({}));

            if (!res.ok || !j.success) {
                const msg =
                    typeof j.message === 'string' && j.message.trim()
                        ? j.message.trim()
                        : vaultCreateUiString('error');
                setNote(msg, true);

                return;
            }

            input.value = '';
            const refresh = globalThis.__oaaoVaultExplorerRefreshTree;
            if (typeof refresh === 'function') {
                await refresh();
            } else {
                document.dispatchEvent(new CustomEvent('oaao-vault-explorer-refresh', { detail: { force: true } }));
            }
        } catch (err) {
            console.error('[oaao] vault create failed', err);
            setNote(vaultCreateUiString('error'), true);
        } finally {
            btn.disabled = false;
        }
    };

    btn.addEventListener('click', () => {
        void submit();
    });
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            void submit();
        }
    });
}

function wireRoutingPurposeSelector() {
    const root = document.getElementById('workspace-purpose-selector-root');
    const trigger = document.getElementById('workspace-purpose-selector-trigger');
    const anchor = document.getElementById('workspace-purpose-selector-anchor');
    const panel = document.getElementById('workspace-purpose-selector-panel');
    const label = document.getElementById('workspace-purpose-selector-label');
    if (!root || !trigger || !anchor || !panel || !label || trigger.dataset.oaaoRoutingPurposeBound === '1')
        return;
    trigger.dataset.oaaoRoutingPurposeBound = '1';

    label.textContent = workspaceChatProfileLabelFromDomOrFallback(
        '#oaao-i18n-workspace-chat-profile-loading',
        'loading',
    );

    /** @type {{ chat_endpoint_id: number, label: string }[]} */
    let profiles = [];
    /** @type {Set<number>} */
    let ids = new Set();
    let defaultChatEndpointId = 0;

    function closePanel() {
        anchor.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function openPanel() {
        if (profiles.length === 0) return;
        anchor.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    }

    function applySelection(chatEndpointId, profileLabel, persist) {
        label.textContent = profileLabel;
        trigger.dataset.routingChatEndpointId = String(chatEndpointId);
        if (persist) {
            try {
                if (chatEndpointId > 0) {
                    localStorage.setItem(CHAT_PROFILE_STORAGE_KEY, String(chatEndpointId));
                } else {
                    localStorage.removeItem(CHAT_PROFILE_STORAGE_KEY);
                }
            } catch {
                /* ignore */
            }
            document.dispatchEvent(
                new CustomEvent('oaao-chat-endpoint-changed', { detail: { chat_endpoint_id: chatEndpointId } }),
            );
        }
    }

    function syncStoredToAllowed() {
        let storedId = 0;
        try {
            const raw = (localStorage.getItem(CHAT_PROFILE_STORAGE_KEY) || '').trim();
            const n = Number(raw);
            storedId = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
        } catch {
            /* ignore */
        }
        const fallbackId =
            defaultChatEndpointId > 0
                ? defaultChatEndpointId
                : (profiles[0]?.chat_endpoint_id ?? 0);
        const pick =
            storedId > 0 && ids.has(storedId)
                ? storedId
                : fallbackId > 0 && ids.has(fallbackId)
                  ? fallbackId
                  : (profiles[0]?.chat_endpoint_id ?? 0);
        const row = profiles.find((p) => p.chat_endpoint_id === pick) || profiles[0];
        if (row) {
            applySelection(row.chat_endpoint_id, row.label, false);
        } else {
            applySelection(
                0,
                workspaceChatProfileLabelFromDomOrFallback('#oaao-i18n-workspace-chat-profile-fallback', 'fallback'),
                false,
            );
        }
    }

    function renderOptions() {
        panel.textContent = '';
        for (const p of profiles) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            btn.dataset.chatEndpointId = String(p.chat_endpoint_id);
            btn.className =
                'w-full text-left px-2.5 py-1.5 text-[0.8125rem] fg-[var(--grid-ink)] bg-transparent border-none cursor-pointer font-inherit hover:bg-[var(--grid-line)]/35';
            btn.textContent = p.label;
            btn.addEventListener('click', () => {
                applySelection(p.chat_endpoint_id, p.label, true);
                closePanel();
                trigger.focus();
            });
            panel.append(btn);
        }
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (anchor.classList.contains('hidden')) openPanel();
        else closePanel();
    });

    document.addEventListener(
        'click',
        (ev) => {
            if (!(ev.target instanceof Node)) return;
            if (!root.contains(ev.target)) closePanel();
        },
        true,
    );

    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        closePanel();
    });

    void (async () => {
        try {
            const res = await fetch(workspaceChatApiUrl('routing_profiles'), {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });
            const text = await res.text();
            /** @type {{ success?: boolean, profiles?: unknown, default_chat_endpoint_id?: number }} */
            let data = {};
            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                data = {};
            }
            const rawList = Array.isArray(data.profiles) ? data.profiles : [];
            profiles = rawList
                .filter((row) => row && typeof row === 'object')
                .map((row) => {
                    /** @type {Record<string, unknown>} */
                    const r = /** @type {Record<string, unknown>} */ (row);
                    const id = Number(r.chat_endpoint_id ?? r.id ?? 0);
                    const chat_endpoint_id = Number.isFinite(id) && id > 0 ? Math.floor(id) : 0;
                    const lab =
                        typeof r.label === 'string' ? r.label.trim() : String(r.label ?? '').trim();
                    return {
                        chat_endpoint_id,
                        label: lab || (chat_endpoint_id > 0 ? `#${chat_endpoint_id}` : ''),
                    };
                })
                .filter((p) => p.chat_endpoint_id > 0 && p.label !== '');
            ids = new Set(profiles.map((p) => p.chat_endpoint_id));
            const defRaw = Number(data.default_chat_endpoint_id ?? 0);
            defaultChatEndpointId =
                Number.isFinite(defRaw) && defRaw > 0 ? Math.floor(defRaw) : 0;
            renderOptions();
            syncStoredToAllowed();
        } catch {
            profiles = [];
            ids = new Set();
            defaultChatEndpointId = 0;
            renderOptions();
            applySelection(
                0,
                workspaceChatProfileLabelFromDomOrFallback('#oaao-i18n-workspace-chat-profile-fallback', 'fallback'),
                false,
            );
        }
    })();
}

/** @returns {{ closeIfMobile: () => void } | null} */
function initWorkspaceDrawer(root) {
    const mq = window.matchMedia('(max-width: 767px)');
    const aside = document.getElementById('workspace-shell-aside');
    const backdrop = document.getElementById('workspace-shell-drawer-backdrop');
    const btn = document.getElementById('workspace-drawer-open-btn');
    if (!aside || !backdrop || !btn) return null;

    function setOpen(open) {
        root.classList.toggle('oaao-shell-drawer-open', open);
        document.body.classList.toggle('oaao-shell-drawer-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    }

    function closeIfMobile() {
        if (mq.matches) setOpen(false);
    }

    btn.addEventListener('click', () => {
        setOpen(!root.classList.contains('oaao-shell-drawer-open'));
    });

    backdrop.addEventListener('click', () => closeIfMobile());

    mq.addEventListener('change', (ev) => {
        if (!ev.matches) setOpen(false);
    });

    document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        if (!root.classList.contains('oaao-shell-drawer-open')) return;
        closeIfMobile();
        ev.preventDefault();
    });

    return { closeIfMobile };
}

/**
 * Narrow rail Chat / Vault + any {@code workspace.vault_menu_heading} nodes — {@link ./oaao-i18n.js}
 * (rail pins are icon-only; {@code title} + {@code aria-label} carry {@code workspace.rail_*_title}.)
 */
function applyWorkspaceShellLabels() {
    const logoBtn = document.getElementById('workspace-rail-logo');
    const chatBtn = document.getElementById('workspace-rail-chat');
    const vaultBtn = document.getElementById('workspace-rail-vault');
    const ragExploreBtn = document.getElementById('workspace-rail-rag-explore');
    const agentsBtn = document.getElementById('workspace-rail-agents');
    const corpusBtn = document.getElementById('workspace-rail-corpus');
    const libraryBtn = document.getElementById('workspace-rail-library');
    const liveMeetingBtn = document.getElementById('workspace-rail-live-meeting');
    const researchBtn = document.getElementById('workspace-rail-research');
    const minesBtn = document.getElementById('workspace-rail-mines');
    const chatLabel = oaaoT('workspace.rail_chat_title', 'Chat');
    const vaultLabel = oaaoT('workspace.rail_vault_title', 'Vault');
    const ragExploreLabel = oaaoT('workspace.rail_rag_explore_title', 'RAG Explore');
    const agentsLabel = oaaoT('workspace.rail_agents_title', 'Agents');
    const corpusLabel = oaaoT('workspace.rail_corpus_title', 'Corpus');
    const libraryLabel = oaaoT('workspace.rail_library_title', 'Library');
    const liveMeetingLabel = oaaoT('workspace.rail_live_meeting_title', 'Live meeting');
    const researchLabel = oaaoT('workspace.rail_research_title', 'Article Research');
    const minesLabel = oaaoT('workspace.rail_mines_title', 'Data Mining');
    logoBtn?.setAttribute('title', chatLabel);
    logoBtn?.setAttribute('aria-label', chatLabel);
    chatBtn?.setAttribute('title', chatLabel);
    chatBtn?.setAttribute('aria-label', chatLabel);
    vaultBtn?.setAttribute('title', vaultLabel);
    vaultBtn?.setAttribute('aria-label', vaultLabel);
    ragExploreBtn?.setAttribute('title', ragExploreLabel);
    ragExploreBtn?.setAttribute('aria-label', ragExploreLabel);
    agentsBtn?.setAttribute('title', agentsLabel);
    agentsBtn?.setAttribute('aria-label', agentsLabel);
    corpusBtn?.setAttribute('title', corpusLabel);
    corpusBtn?.setAttribute('aria-label', corpusLabel);
    libraryBtn?.setAttribute('title', libraryLabel);
    libraryBtn?.setAttribute('aria-label', libraryLabel);
    liveMeetingBtn?.setAttribute('title', liveMeetingLabel);
    liveMeetingBtn?.setAttribute('aria-label', liveMeetingLabel);
    researchBtn?.setAttribute('title', researchLabel);
    researchBtn?.setAttribute('aria-label', researchLabel);
    minesBtn?.setAttribute('title', minesLabel);
    minesBtn?.setAttribute('aria-label', minesLabel);

    document.querySelectorAll('[data-i18n="workspace.vault_menu_heading"]').forEach((el) => {
        el.textContent = oaaoT('workspace.vault_menu_heading', 'Vault');
    });
}

export function initWorkspaceShell() {
    const root = document.getElementById('workspace-view');
    if (!root || root.dataset.shellInit === '1') return;
    root.dataset.shellInit = '1';

    applyWorkspaceShellLabels();

    syncWorkspaceScopeFromUrlOrStorage(root);
    wireWorkspaceScopeQuickPersonal(root);
    void primeWorkspaceScopeFromServer(root);

    /** Scope switch without {@code oaao-workspace-scope-changed} — URL conversation restore ({@see chat-panel.js}). */
    globalThis.__oaaoSyncWorkspaceScopeSilently = (workspaceId, workspaceDisplayName = null) => {
        const wid =
            workspaceId != null && Number(workspaceId) > 0 ? Math.floor(Number(workspaceId)) : null;
        persistWorkspaceScope(wid, workspaceDisplayName ?? '');
        applyWorkspaceScopeDataset(root, wid, workspaceDisplayName ?? null);
    };

    if (!document.body.dataset.oaaoWsScopeInvalidBound) {
        document.body.dataset.oaaoWsScopeInvalidBound = '1';
        document.addEventListener('oaao-workspace-scope-invalid', () => {
            persistWorkspaceScope(null);
            applyWorkspaceScopeDataset(root, null, null);
            dispatchWorkspaceScopeChanged(null, { reason: 'scope_invalid' });
        });
    }

    const railSettings = document.getElementById('workspace-rail-settings');
    if (railSettings && document.body.dataset.oaaoAdminSettings !== '1') {
        railSettings.classList.add('hidden');
    }

    const nav = document.getElementById('workspace-nav');
    const pageUnknown = document.getElementById('page-unknown');
    const mount = document.getElementById('workspace-module-mount');

    if (!nav || !pageUnknown || !mount) return;

    /** @type {((opts?: { preserveConversationSidebar?: boolean }) => void) | null} */
    let dynamicUnmount = null;
    /** SPA shell panel {@code page_id} last wired with {@code dynamicUnmount} (partial chat teardown when leaving Chat). */
    let lastMountedShellPageId = null;

    const drawerCtl = initWorkspaceDrawer(root);

    function wireWorkspaceChrome(navigateFn) {
        const el = document.getElementById('workspace-sidebar-new-chat');
        if (!el || el.dataset.oaaoChromeBound === '1') return;
        el.dataset.oaaoChromeBound = '1';
        el.addEventListener('click', async () => {
            workspaceStripChatDeepLinkQuery();
            const hasChat = spaPages().some((p) => p.page_id === 'workspace/chat');
            if (hasChat) {
                await navigateFn('workspace/chat', { replace: false });
            }
            document.dispatchEvent(new CustomEvent('oaao-chat-new'));
        });
    }

    function wireIconRail(navigateFn) {
        const rail = document.getElementById('workspace-icon-rail');
        if (!rail || rail.dataset.oaaoRailBound === '1') return;
        rail.dataset.oaaoRailBound = '1';

        document.getElementById('workspace-rail-logo')?.addEventListener('click', () => {
            const hasChat = spaPages().some((p) => p.page_id === 'workspace/chat');
            if (hasChat) {
                void navigateFn('workspace/chat');
            }
        });
        document.getElementById('workspace-rail-chat')?.addEventListener('click', () => {
            void navigateFn('workspace/chat');
        });
        const templatesBtn = document.getElementById('workspace-rail-templates');
        if (templatesBtn && spaPages().some((p) => p.page_id === 'workspace/templates')) {
            templatesBtn.addEventListener('click', () => {
                void navigateFn('workspace/templates');
            });
        }
        const corpusBtn = document.getElementById('workspace-rail-corpus');
        if (corpusBtn && spaPages().some((p) => p.page_id === 'workspace/corpus')) {
            corpusBtn.addEventListener('click', () => {
                void navigateFn('workspace/corpus');
            });
        }
        const libraryBtn = document.getElementById('workspace-rail-library');
        if (libraryBtn && spaPages().some((p) => p.page_id === 'workspace/library')) {
            libraryBtn.addEventListener('click', () => {
                void navigateFn('workspace/library');
            });
        }
        const calendarBtn = document.getElementById('workspace-rail-calendar');
        if (calendarBtn && spaPages().some((p) => p.page_id === 'workspace/calendar')) {
            calendarBtn.addEventListener('click', () => {
                void navigateFn('workspace/calendar');
            });
        }
        const liveMeetingBtn = document.getElementById('workspace-rail-live-meeting');
        if (liveMeetingBtn && spaPages().some((p) => p.page_id === 'workspace/live-meeting')) {
            liveMeetingBtn.addEventListener('click', () => {
                void navigateFn('workspace/live-meeting');
            });
        }
        const researchBtn = document.getElementById('workspace-rail-research');
        if (researchBtn && spaPages().some((p) => p.page_id === 'workspace/research')) {
            researchBtn.addEventListener('click', () => {
                void navigateFn('workspace/research');
            });
        }
        const minesBtn = document.getElementById('workspace-rail-mines');
        if (minesBtn && spaPages().some((p) => p.page_id === 'workspace/mines')) {
            minesBtn.addEventListener('click', () => {
                void navigateFn('workspace/mines');
            });
        }
        syncWorkspaceRailPinVisibility();
        const vaultBtn = document.getElementById('workspace-rail-vault');
        if (vaultBtn && spaPages().some((p) => p.page_id === 'workspace/vault')) {
            vaultBtn.addEventListener('click', () => {
                void navigateFn('workspace/vault');
            });
        }
        const ragExploreBtn = document.getElementById('workspace-rail-rag-explore');
        if (ragExploreBtn && spaPages().some((p) => p.page_id === 'workspace/rag-explore')) {
            ragExploreBtn.addEventListener('click', () => {
                void navigateFn('workspace/rag-explore');
            });
        }
        const agentsBtn = document.getElementById('workspace-rail-agents');
        if (agentsBtn && spaPages().some((p) => p.page_id === 'workspace/agents')) {
            agentsBtn.addEventListener('click', () => {
                void navigateFn('workspace/agents');
            });
        }
        const settingsBtn = document.getElementById('workspace-rail-settings');
        if (settingsBtn && document.body.dataset.oaaoAdminSettings === '1') {
            settingsBtn.addEventListener('click', () => {
                void openWorkspaceSettingsDialog(razyui).catch((err) => {
                    console.error('[oaao] settings dialog failed', err);
                });
            });
        }
    }

    function wireUserHeaderMenu() {
        const pref = document.getElementById('workspace-menu-preferences');
        if (pref && pref.dataset.oaaoUserMenuBound !== '1') {
            pref.dataset.oaaoUserMenuBound = '1';
            pref.addEventListener('click', () => {
                void openWorkspacePreferencesDialog(razyui).catch((err) => {
                    console.error('[oaao] preferences dialog failed', err);
                });
                pref.blur();
                document.getElementById('workspace-user-menu-trigger')?.blur();
                drawerCtl?.closeIfMobile();
            });
        }

        const whatsNew = document.getElementById('workspace-menu-whats-new');
        if (whatsNew && whatsNew.dataset.oaaoUserMenuBound !== '1') {
            whatsNew.dataset.oaaoUserMenuBound = '1';
            whatsNew.addEventListener('click', () => {
                void openWhatsNewDialog().catch((err) => {
                    console.error('[oaao] whats new dialog failed', err);
                });
                whatsNew.blur();
                document.getElementById('workspace-user-menu-trigger')?.blur();
                drawerCtl?.closeIfMobile();
            });
        }

        const buildLine = document.getElementById('workspace-menu-build-line');
        if (buildLine && buildLine.dataset.oaaoUserMenuBound !== '1') {
            buildLine.dataset.oaaoUserMenuBound = '1';
            buildLine.addEventListener('click', () => {
                const since = (document.body?.dataset?.oaaoBuildId ?? '').trim();
                void openWhatsNewDialog({ sinceBuild: since }).catch((err) => {
                    console.error('[oaao] whats new dialog failed', err);
                });
                buildLine.blur();
                document.getElementById('workspace-user-menu-trigger')?.blur();
                drawerCtl?.closeIfMobile();
            });
        }
    }

    /** Chat vs Vault middle sidebar — keyed off active SPA route; workspace picker stays in {@code #workspace-scope-section}. */
    function syncWorkspaceModuleSidebar(activePageId) {
        const chatSection = document.getElementById('workspace-chat-sidebar-section');
        const vaultSection = document.getElementById('workspace-vault-sidebar-section');
        const librarySection = document.getElementById('workspace-library-sidebar-section');
        const ragExploreSection = document.getElementById('workspace-rag-explore-sidebar-section');
        const hasChat = spaPages().some((p) => p.page_id === 'workspace/chat');
        const hasVault = spaPages().some((p) => p.page_id === 'workspace/vault');
        const hasLibrary = spaPages().some((p) => p.page_id === 'workspace/library');
        const hasRagExplore = spaPages().some((p) => p.page_id === 'workspace/rag-explore');
        if (chatSection) {
            chatSection.classList.toggle('hidden', !hasChat || activePageId !== 'workspace/chat');
        }
        if (vaultSection) {
            vaultSection.classList.toggle('hidden', !hasVault || activePageId !== 'workspace/vault');
        }
        if (librarySection) {
            librarySection.classList.toggle('hidden', !hasLibrary || activePageId !== 'workspace/library');
        }
        if (ragExploreSection) {
            ragExploreSection.classList.toggle('hidden', !hasRagExplore || activePageId !== 'workspace/rag-explore');
        }
        if (isGalleryLayoutPage(activePageId) || isRailOnlyLayoutPage(activePageId)) {
            drawerCtl?.closeIfMobile?.();
        }
    }

    globalThis.__oaaoSyncWorkspaceModuleSidebar = syncWorkspaceModuleSidebar;
    globalThis.__oaaoSyncWorkspaceShellLayout = syncWorkspaceShellLayout;

    function syncWorkspaceRailPinVisibility() {
        const vaultBtn = document.getElementById('workspace-rail-vault');
        const ragExploreBtn = document.getElementById('workspace-rail-rag-explore');
        const agentsBtn = document.getElementById('workspace-rail-agents');
        const templatesBtn = document.getElementById('workspace-rail-templates');
        const corpusBtn = document.getElementById('workspace-rail-corpus');
        const libraryBtn = document.getElementById('workspace-rail-library');
        const calendarBtn = document.getElementById('workspace-rail-calendar');
        const liveMeetingBtn = document.getElementById('workspace-rail-live-meeting');
        const researchBtn = document.getElementById('workspace-rail-research');
        const minesBtn = document.getElementById('workspace-rail-mines');
        const hasVault = spaPages().some((p) => p.page_id === 'workspace/vault');
        const hasRagExplore = spaPages().some((p) => p.page_id === 'workspace/rag-explore');
        const hasAgents = spaPages().some((p) => p.page_id === 'workspace/agents');
        const hasTemplates = spaPages().some((p) => p.page_id === 'workspace/templates');
        const hasCorpus = spaPages().some((p) => p.page_id === 'workspace/corpus');
        const hasLibrary = spaPages().some((p) => p.page_id === 'workspace/library');
        const hasCalendar = spaPages().some((p) => p.page_id === 'workspace/calendar');
        const hasLiveMeeting = spaPages().some((p) => p.page_id === 'workspace/live-meeting');
        const hasResearch = spaPages().some((p) => p.page_id === 'workspace/research');
        const hasMines = spaPages().some((p) => p.page_id === 'workspace/mines');
        vaultBtn?.classList.toggle('hidden', !hasVault);
        ragExploreBtn?.classList.toggle('hidden', !hasRagExplore);
        agentsBtn?.classList.toggle('hidden', !hasAgents);
        templatesBtn?.classList.toggle('hidden', !hasTemplates);
        corpusBtn?.classList.toggle('hidden', !hasCorpus);
        libraryBtn?.classList.toggle('hidden', !hasLibrary);
        calendarBtn?.classList.toggle('hidden', !hasCalendar);
        liveMeetingBtn?.classList.toggle('hidden', !hasLiveMeeting);
        researchBtn?.classList.toggle('hidden', !hasResearch);
        minesBtn?.classList.toggle('hidden', !hasMines);
    }

    function syncRailActive(activePageId) {
        syncWorkspaceRailPinVisibility();
        const chatBtn = document.getElementById('workspace-rail-chat');
        const vaultBtn = document.getElementById('workspace-rail-vault');
        const ragExploreBtn = document.getElementById('workspace-rail-rag-explore');
        const agentsBtn = document.getElementById('workspace-rail-agents');
        const templatesBtn = document.getElementById('workspace-rail-templates');
        const corpusBtn = document.getElementById('workspace-rail-corpus');
        const libraryBtn = document.getElementById('workspace-rail-library');
        const calendarBtn = document.getElementById('workspace-rail-calendar');
        const liveMeetingBtn = document.getElementById('workspace-rail-live-meeting');
        const researchBtn = document.getElementById('workspace-rail-research');
        const minesBtn = document.getElementById('workspace-rail-mines');
        const chatActive = activePageId === 'workspace/chat';
        const vaultActive = activePageId === 'workspace/vault';
        const ragExploreActive = activePageId === 'workspace/rag-explore';
        const agentsActive = activePageId === 'workspace/agents';
        const templatesActive = activePageId === 'workspace/templates';
        const corpusActive = activePageId === 'workspace/corpus';
        const libraryActive = activePageId === 'workspace/library';
        const calendarActive = activePageId === 'workspace/calendar';
        const liveMeetingActive = activePageId === 'workspace/live-meeting';
        const researchActive = activePageId === 'workspace/research';
        const minesActive = activePageId === 'workspace/mines';
        if (chatBtn) {
            chatBtn.classList.toggle('oaao-rail-btn-active', chatActive);
            if (chatActive) chatBtn.setAttribute('aria-current', 'page');
            else chatBtn.removeAttribute('aria-current');
        }
        if (templatesBtn && !templatesBtn.classList.contains('hidden')) {
            templatesBtn.classList.toggle('oaao-rail-btn-active', templatesActive);
            if (templatesActive) templatesBtn.setAttribute('aria-current', 'page');
            else templatesBtn.removeAttribute('aria-current');
        }
        if (corpusBtn && !corpusBtn.classList.contains('hidden')) {
            corpusBtn.classList.toggle('oaao-rail-btn-active', corpusActive);
            if (corpusActive) corpusBtn.setAttribute('aria-current', 'page');
            else corpusBtn.removeAttribute('aria-current');
        }
        if (libraryBtn && !libraryBtn.classList.contains('hidden')) {
            libraryBtn.classList.toggle('oaao-rail-btn-active', libraryActive);
            if (libraryActive) libraryBtn.setAttribute('aria-current', 'page');
            else libraryBtn.removeAttribute('aria-current');
        }
        if (calendarBtn && !calendarBtn.classList.contains('hidden')) {
            calendarBtn.classList.toggle('oaao-rail-btn-active', calendarActive);
            if (calendarActive) calendarBtn.setAttribute('aria-current', 'page');
            else calendarBtn.removeAttribute('aria-current');
        }
        if (vaultBtn && !vaultBtn.classList.contains('hidden')) {
            vaultBtn.classList.toggle('oaao-rail-btn-active', vaultActive);
            if (vaultActive) vaultBtn.setAttribute('aria-current', 'page');
            else vaultBtn.removeAttribute('aria-current');
        }
        if (ragExploreBtn && !ragExploreBtn.classList.contains('hidden')) {
            ragExploreBtn.classList.toggle('oaao-rail-btn-active', ragExploreActive);
            if (ragExploreActive) ragExploreBtn.setAttribute('aria-current', 'page');
            else ragExploreBtn.removeAttribute('aria-current');
        }
        if (agentsBtn && !agentsBtn.classList.contains('hidden')) {
            agentsBtn.classList.toggle('oaao-rail-btn-active', agentsActive);
            if (agentsActive) agentsBtn.setAttribute('aria-current', 'page');
            else agentsBtn.removeAttribute('aria-current');
        }
        if (liveMeetingBtn && !liveMeetingBtn.classList.contains('hidden')) {
            liveMeetingBtn.classList.toggle('oaao-rail-btn-active', liveMeetingActive);
            if (liveMeetingActive) liveMeetingBtn.setAttribute('aria-current', 'page');
            else liveMeetingBtn.removeAttribute('aria-current');
        }
        if (researchBtn && !researchBtn.classList.contains('hidden')) {
            researchBtn.classList.toggle('oaao-rail-btn-active', researchActive);
            if (researchActive) researchBtn.setAttribute('aria-current', 'page');
            else researchBtn.removeAttribute('aria-current');
        }
        if (minesBtn && !minesBtn.classList.contains('hidden')) {
            minesBtn.classList.toggle('oaao-rail-btn-active', minesActive);
            if (minesActive) minesBtn.setAttribute('aria-current', 'page');
            else minesBtn.removeAttribute('aria-current');
        }
    }

    /** Chat-only header chrome — hide completion profile picker off Chat routes. */
    function syncWorkspaceMainChrome(activePageId) {
        document.getElementById('workspace-purpose-selector-root')?.classList.toggle('hidden', activePageId !== 'workspace/chat');
    }

    /** Auth / loader errors: DOM only — server returns JSON ({@code message}, {@code data.sign_in_path}), not HTML snippets. */
    function panelMountSetAuthHint(mountEl, message, signInPath) {
        mountEl.textContent = '';
        const wrap = document.createElement('div');
        wrap.className = 'p-lg text-sm fg-[var(--grid-ink-muted)]';
        const p = document.createElement('p');
        p.append(document.createTextNode(`${message} `));
        if (signInPath) {
            const a = document.createElement('a');
            a.className = 'underline fg-[var(--grid-ink)]';
            a.href = signInPath;
            a.textContent = 'Open sign-in';
            p.append(a);
        }
        wrap.append(p);
        mountEl.append(wrap);
    }

    function renderNav(activePageId) {
        nav.textContent = '';
        /** SPA entries pinned on {@code #workspace-icon-rail} — omit duplicate Apps nav rows. */
        const railPinned = new Set([
            'workspace/chat',
            'workspace/vault',
            'workspace/rag-explore',
            'workspace/agents',
            'workspace/templates',
            'workspace/corpus',
            'workspace/library',
            'workspace/calendar',
            'workspace/live-meeting',
            'workspace/research',
            'workspace/mines',
        ]);
        const pages = spaPages().filter((p) => !railPinned.has(p.page_id));
        const empty = pages.length === 0;
        nav.classList.toggle('hidden', empty);
        nav.setAttribute('aria-hidden', empty ? 'true' : 'false');
        for (const p of pages) {
            const path = pageIdToPath(p.page_id);
            const a = document.createElement('a');
            a.href = path;
            a.dataset.pageId = p.page_id;
            const active = p.page_id === activePageId;
            a.className = [
                'block px-sm py-2 rounded-[8px] text-[0.875rem] no-underline transition-opacity',
                active ? 'bg-[var(--grid-line)]/35 fg-[var(--grid-ink)] fw-semibold' : 'fg-[var(--grid-ink)] hover:opacity-85',
            ].join(' ');
            const t = document.createElement('span');
            t.className = 'block leading-snug';
            t.textContent = p.title;
            const s = document.createElement('span');
            s.className = 'block text-[0.72rem] fg-[var(--grid-caption)] mt-0.5 leading-snug';
            s.textContent = p.sub || '';
            a.append(t, s);
            a.addEventListener('click', (e) => {
                e.preventDefault();
                void navigate(p.page_id);
            });
            nav.append(a);
        }
    }

    async function mountDynamicPanel(meta) {
        const nextPid = typeof meta.page_id === 'string' ? meta.page_id : '';

        if (typeof dynamicUnmount === 'function') {
            const un = dynamicUnmount;
            dynamicUnmount = null;
            const prevPid = lastMountedShellPageId;
            lastMountedShellPageId = null;
            const opts =
                prevPid === 'workspace/chat' && nextPid !== 'workspace/chat'
                    ? { preserveConversationSidebar: true }
                    : {};
            un(opts);
        }

        const panelUrl = typeof meta.shell_panel_url === 'string' ? meta.shell_panel_url : '';
        const jsModule = typeof meta.shell_js_module === 'string' ? meta.shell_js_module : '';

        if (!panelUrl) return false;

        mount.classList.remove('hidden');
        mount.classList.add('flex', 'flex-col');
        setRazyuiCloakReady(mount, false);
        oaaoMountLoadingLogo(mount, { fill: true, label: 'Loading…' });

        try {
            const res = await fetch(resolveShellRegistryUrl(panelUrl), {
                credentials: 'include',
                redirect: 'manual',
                headers: {
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });

            if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
                const loc = res.headers.get('Location') || '';
                panelMountSetAuthHint(
                    mount,
                    'This panel requires a signed-in session (server issued a redirect instead of JSON).',
                    loc,
                );
                await hydrateOaaoJitMount(mount);
                return true;
            }

            const raw = await res.text();
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            /** @type {unknown} */
            let payload = null;
            const rawTrimHead = raw.replace(/^\ufeff\s*/, '').trimStart();
            if (ct.includes('application/json') || rawTrimHead.startsWith('{') || rawTrimHead.startsWith('[')) {
                try {
                    payload = JSON.parse(raw);
                } catch {
                    payload = null;
                }
            }

            if (!(payload && typeof payload === 'object' && payload !== null && 'success' in payload)) {
                /** Non‑JSON OK responses (typically full SPA HTML / mis-routed installs) — never {@code innerHTML} that into {@code mount}. */
                const msg =
                    !res.ok
                        ? `Could not load this page (${res.status}).`
                        : !ct.includes('application/json')
                          ? `This page loader responded with ${ct.startsWith('text/html') ? 'HTML' : `“${ct}”`} instead of JSON — check routing for the panel endpoint (vault/chat workspace-panel REST).`
                          : 'Could not parse this page loader JSON.';
                panelMountSetAuthHint(mount, msg, '');
                await hydrateOaaoJitMount(mount);
                return true;
            }

            const p = /** @type {{ success?: boolean, message?: string, data?: { html?: string, sign_in_path?: string } }} */ (
                payload
            );
            if (!p.success || typeof p.data?.html !== 'string') {
                const hintMsg =
                    typeof p.message === 'string' && p.message
                        ? p.message
                        : !res.ok
                          ? `Could not load this page (${res.status}).`
                          : 'Could not load this page.';
                const path = typeof p.data?.sign_in_path === 'string' ? p.data.sign_in_path : '';
                panelMountSetAuthHint(mount, hintMsg, path);
                await hydrateOaaoJitMount(mount);
                return true;
            }

            mount.innerHTML = p.data.html;
            await hydrateOaaoJitMount(mount);

            if (jsModule) {
                const moduleUrl = oaaoAppendShellEsmV(resolveShellRegistryUrl(jsModule));
                /** @type {Record<string, unknown> | null} */
                let mod = null;
                try {
                    mod = await import(/* webpackIgnore: true */ moduleUrl);
                } catch (err) {
                    console.error('[workspace] shell module import failed', moduleUrl, err);
                    const detail = err instanceof Error ? err.message : String(err);
                    mount.insertAdjacentHTML(
                        'beforeend',
                        `<p class="p-md text-sm fg-red-6">Failed to load module script: ${escapeHtml(detail)}</p>`,
                    );
                    return true;
                }
                if (typeof mod.mountShellPanel === 'function') {
                    try {
                        await mod.mountShellPanel(mount);
                        syncWorkspaceModuleSidebar(nextPid);
                        syncWorkspaceShellLayout(nextPid);
                        dynamicUnmount = (opts = {}) => {
                            if (typeof mod.teardownShellPanel === 'function') {
                                mod.teardownShellPanel(opts);
                            }
                        };
                        lastMountedShellPageId = nextPid;
                    } catch (err) {
                        if (err instanceof DOMException && err.name === 'AbortError') {
                            return true;
                        }
                        console.error('[workspace] mountShellPanel failed', moduleUrl, err);
                        const detail = err instanceof Error ? err.message : String(err);
                        mount.insertAdjacentHTML(
                            'beforeend',
                            `<p class="p-md text-sm fg-red-6">Panel failed to start: ${escapeHtml(detail)}</p>`,
                        );
                    }
                }
            }

            return true;
        } finally {
            setRazyuiCloakReady(mount, true);
        }
    }

    async function showPage(pageId) {
        const pages = spaPages();
        const known = Boolean(pageId && pages.some((p) => p.page_id === pageId));
        const meta = pages.find((p) => p.page_id === pageId);

        pageUnknown.classList.toggle('hidden', known);

        const needsDynamic = Boolean(known && meta && typeof meta.shell_panel_url === 'string' && meta.shell_panel_url !== '');

        if (needsDynamic) {
            await mountDynamicPanel(meta);
        } else {
            if (typeof dynamicUnmount === 'function') {
                const un = dynamicUnmount;
                dynamicUnmount = null;
                const prevPid = lastMountedShellPageId;
                lastMountedShellPageId = null;
                const opts =
                    prevPid === 'workspace/chat' && pageId !== 'workspace/chat'
                        ? { preserveConversationSidebar: true }
                        : {};
                un(opts);
            }
            mount.innerHTML = '';
            mount.classList.add('hidden');
            mount.classList.remove('flex', 'flex-col');
        }
    }

    async function navigate(pageId, { replace = false } = {}) {
        const pages = spaPages();
        let resolved = pageId && pages.some((p) => p.page_id === pageId) ? pageId : null;
        if (resolved === null) {
            resolved = pathToPageId(window.location.pathname);
        }
        if (resolved === null || !pages.some((p) => p.page_id === resolved)) {
            resolved = defaultPageId();
        }
        if (!resolved) {
            if (typeof dynamicUnmount === 'function') {
                const un = dynamicUnmount;
                dynamicUnmount = null;
                const prevPid = lastMountedShellPageId;
                lastMountedShellPageId = null;
                const opts = prevPid === 'workspace/chat' ? { preserveConversationSidebar: true } : {};
                un(opts);
            }
            renderNav('');
            syncWorkspaceModuleSidebar('');
            syncWorkspaceShellLayout('');
            syncRailActive('');
            syncWorkspaceMainChrome('');
            pageUnknown.classList.remove('hidden');
            mount.innerHTML = '';
            mount.classList.add('hidden');
            mount.classList.remove('flex', 'flex-col');
            drawerCtl?.closeIfMobile();
            return;
        }

        const path = pageIdToPath(resolved);
        const historyUrl = workspaceBrowserUrlWithPreservedFragment(path, resolved);
        if (replace) {
            window.history.replaceState({ pageId: resolved }, '', historyUrl);
        } else {
            window.history.pushState({ pageId: resolved }, '', historyUrl);
        }
        renderNav(resolved);
        syncWorkspaceModuleSidebar(resolved);
        syncWorkspaceShellLayout(resolved);
        syncRailActive(resolved);
        syncWorkspaceMainChrome(resolved);
        await showPage(resolved);
        drawerCtl?.closeIfMobile();
    }

    globalThis.__oaaoWorkspaceNavigate = navigate;

    wireWorkspaceChrome(navigate);

    wireIconRail(navigate);

    wireUserHeaderMenu();

    wireWorkspaceNotifications();
    wireWorkspaceTodos();

    if (!document.body.dataset.oaaoNavigateCalendarBound) {
        document.body.dataset.oaaoNavigateCalendarBound = '1';
        document.addEventListener('oaao:navigate-calendar', () => {
            void navigate('workspace/calendar');
        });
    }

    if (!document.body.dataset.oaaoNavigateChatBound) {
        document.body.dataset.oaaoNavigateChatBound = '1';
        document.addEventListener('oaao:navigate-chat', (ev) => {
            const cid = Math.floor(Number(/** @type {CustomEvent} */ (ev).detail?.conversation_id ?? 0));
            if (cid < 1) return;
            const u = new URL(window.location.href);
            u.searchParams.set('conversation_id', String(cid));
            const qs = u.searchParams.toString();
            const next = `${u.pathname}${qs ? `?${qs}` : ''}${u.hash}`;
            window.history.pushState(window.history.state ?? {}, '', next);
            void navigate('workspace/chat');
        });
    }

    wireRoutingPurposeSelector();

    wireWorkspaceFolderPicker(root);

    wireWorkspaceVaultSidebarCreate(root);

    if (!globalThis.__oaaoWorkspacePopstateBound) {
        globalThis.__oaaoWorkspacePopstateBound = true;
        window.addEventListener('popstate', () => {
            void globalThis.__oaaoWorkspaceNavigate?.(null, { replace: true });
        });
    }

    const openPrefsFromUrl = pathOpensPreferences(window.location.pathname);

    const workspaceInviteToken = takeWorkspaceInviteTokenFromUrl();

    void navigate(null, { replace: true });

    void tryConsumeWorkspaceInviteFromUrl(root, navigate, workspaceInviteToken);

    if (openPrefsFromUrl) {
        void openWorkspacePreferencesDialog(razyui).catch((err) => {
            console.error('[oaao] preferences dialog failed', err);
        });
    }
}
