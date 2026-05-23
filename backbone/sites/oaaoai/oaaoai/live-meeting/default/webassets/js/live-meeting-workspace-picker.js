/**
 * Live meeting header — workspace scope picker (syncs with shell {@code oaao.workspace.scope}).
 */

import { hydrateLiveMeetingJit } from './live-meeting-jit.js';const WORKSPACE_SCOPE_V2_KEY = 'oaao.workspace.scope';

function chatApiUrl(action) {
    const authBase = (document.body?.dataset?.authBase || '').trim();
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

/** @returns {{ id: number | null, name: string | null }} */
export function readWorkspaceScopeFromStorage() {
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
    return { id: null, name: null };
}

/** @param {number | null} workspaceId @param {string | null | undefined} workspaceName */
function persistWorkspaceScope(workspaceId, workspaceName = undefined) {
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
    } catch {
        /* ignore */
    }
}

/** @param {number | null} workspaceId @param {string | null} workspaceName */
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

/** @param {number | null} workspaceId @param {string | null} workspaceName */
function applyWorkspaceScopeDataset(workspaceId, workspaceName) {
    const idStr = workspaceId != null && workspaceId > 0 ? String(Math.floor(workspaceId)) : '';
    const labelText = formatWorkspaceScopeLabel(
        workspaceId != null && workspaceId > 0 ? Math.floor(workspaceId) : null,
        workspaceName,
    );
    document.documentElement.dataset.oaaoActiveWorkspaceId = idStr;
    const folderTrigLabel = document.getElementById('workspace-folder-trigger-label');
    if (folderTrigLabel) folderTrigLabel.textContent = labelText;
}

/** @param {number | null} workspaceId */
function dispatchWorkspaceScopeChanged(workspaceId) {
    document.dispatchEvent(
        new CustomEvent('oaao-workspace-scope-changed', {
            bubbles: true,
            detail: { workspace_id: workspaceId },
        }),
    );
}

/** @param {unknown} raw @returns {{ workspace_id: number, name: string, role?: string }[]} */
function normalizeWorkspaceRows(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const o = /** @type {Record<string, unknown>} */ (row);
            return {
                workspace_id: Number(o.workspace_id ?? 0),
                name: String(o.name ?? '').trim(),
                role: typeof o.role === 'string' ? o.role : undefined,
            };
        })
        .filter((x) => x && x.workspace_id > 0 && x.name !== '');
}

/**
 * @param {HTMLElement} mount Live meeting root section
 * @param {{ signal?: AbortSignal }} [opts]
 */
export function wireLiveMeetingWorkspacePicker(mount, { signal } = {}) {
    const trigger = mount.querySelector('[data-oaao-live-meeting="workspace-trigger"]');
    const triggerLabel = mount.querySelector('[data-oaao-live-meeting="workspace-trigger-label"]');
    const anchor = mount.querySelector('[data-oaao-live-meeting="workspace-anchor"]');
    const panel = mount.querySelector('[data-oaao-live-meeting="workspace-panel"]');
    if (
        !(trigger instanceof HTMLButtonElement)
        || !(triggerLabel instanceof HTMLElement)
        || !(anchor instanceof HTMLElement)
        || !(panel instanceof HTMLElement)
        || trigger.dataset.oaaoLiveWsBound === '1'
    ) {
        return;
    }
    trigger.dataset.oaaoLiveWsBound = '1';

    /** @type {{ workspace_id: number, name: string }[]} */
    let rows = [];

    const closePanel = () => {
        anchor.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
    };

    const openPanel = () => {
        anchor.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    };

    /** @param {number | null} workspaceId @param {string | null} workspaceName */
    const applyScope = (workspaceId, workspaceName) => {
        const prev = readWorkspaceScopeFromStorage();
        persistWorkspaceScope(workspaceId, workspaceName ?? undefined);
        applyWorkspaceScopeDataset(workspaceId, workspaceName);
        triggerLabel.textContent = formatWorkspaceScopeLabel(workspaceId, workspaceName);
        trigger.dataset.workspaceId = workspaceId != null && workspaceId > 0 ? String(workspaceId) : '';
        const nextId = workspaceId != null && workspaceId > 0 ? Math.floor(workspaceId) : null;
        const prevId = prev.id != null && prev.id > 0 ? Math.floor(prev.id) : null;
        if (nextId !== prevId) {
            dispatchWorkspaceScopeChanged(nextId);
        }
    };

    const renderPanel = () => {
        panel.textContent = '';
        const rowBtnClass =
            'w-full px-2 py-1.5 rounded-[6px] border-none bg-transparent fg-[var(--grid-ink)] text-[0.8125rem] text-left cursor-pointer font-inherit truncate hover:bg-[var(--grid-line)]/35';

        const personalBtn = document.createElement('button');
        personalBtn.type = 'button';
        personalBtn.setAttribute('role', 'option');
        personalBtn.className = rowBtnClass;
        personalBtn.textContent = formatWorkspaceScopeLabel(null, null);
        personalBtn.addEventListener('click', () => {
            applyScope(null, null);
            closePanel();
        });
        panel.append(personalBtn);

        for (const r of rows) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            btn.className = rowBtnClass;
            btn.textContent = r.name;
            btn.addEventListener('click', () => {
                applyScope(r.workspace_id, r.name);
                closePanel();
            });
            panel.append(btn);
        }
        void hydrateLiveMeetingJit(panel);
    };

    const refreshFromServer = async () => {
        try {
            const res = await fetch(chatApiUrl('workspaces'), {
                credentials: 'include',
                headers: { Accept: 'application/json' },
                signal,
            });
            const data = await res.json().catch(() => ({}));
            rows = normalizeWorkspaceRows(data?.workspaces);
            renderPanel();
            const cur = readWorkspaceScopeFromStorage();
            if (cur.id != null && cur.id > 0) {
                const hit = rows.find((x) => x.workspace_id === cur.id);
                applyScope(cur.id, hit?.name ?? cur.name);
            } else {
                applyScope(null, null);
            }
        } catch {
            rows = [];
            renderPanel();
        }
    };

    trigger.addEventListener(
        'click',
        (e) => {
            e.stopPropagation();
            if (anchor.classList.contains('hidden')) openPanel();
            else closePanel();
        },
        { signal },
    );

    document.addEventListener(
        'click',
        (e) => {
            if (anchor.classList.contains('hidden')) return;
            const t = e.target;
            if (t instanceof Node && (trigger.contains(t) || anchor.contains(t))) return;
            closePanel();
        },
        { signal },
    );

    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Escape') closePanel();
        },
        { signal },
    );

    void refreshFromServer();
}

/** @returns {number | null} */
export function liveMeetingWorkspaceId() {
    const cur = readWorkspaceScopeFromStorage();
    if (cur.id != null && cur.id > 0) return cur.id;
    const raw = document.documentElement?.dataset?.oaaoActiveWorkspaceId?.trim() ?? '';
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
