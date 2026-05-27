/**
 * Vault workspace shell — mounted by core {@see workspace.js}; sidebar vault list + explorer.
 *
 * Purpose-backed Run actions use {@code pa-embedding} from {@code oaaoai/vault} ({@code VAULT_PURPOSE_HOOK_BY_PREFIX}).
 */

import razyui from 'razyui';
import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';

/** @type {Promise<typeof import('../../../../core/default/webassets/js/vault-tree-cache.js')> | null} */
let vaultTreeCacheModPromise = null;

function loadVaultTreeCacheMod() {
    if (!vaultTreeCacheModPromise) {
        const shellV = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
        let url = oaaoPrefixedSitePath('/webassets/core/default/js/vault-tree-cache.js');
        if (shellV) url += `${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(shellV)}`;
        vaultTreeCacheModPromise = import(/* webpackIgnore: true */ url);
    }

    return vaultTreeCacheModPromise;
}

/** Bust transcript ESM when this module changes — appended to {@code data-oaao-shell-esm-v}. */
const OAAO_VAULT_TRANSCRIPT_MOD_REV = '20260522-text-preview';

/** @type {Promise<typeof import('./vault-transcript-speaker.js')> | null} */
let vaultTranscriptModPromise = null;

function loadVaultTranscriptMod() {
    if (!vaultTranscriptModPromise) {
        const shellV = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
        const bust = shellV ? `${shellV}.${OAAO_VAULT_TRANSCRIPT_MOD_REV}` : OAAO_VAULT_TRANSCRIPT_MOD_REV;
        let url = oaaoPrefixedSitePath('/webassets/vault/default/js/vault-transcript-speaker.js');
        url += `${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(bust)}`;
        vaultTranscriptModPromise = import(/* webpackIgnore: true */ url);
    }

    return vaultTranscriptModPromise;
}

/**
 * @param {Record<string, unknown>} docNode
 * @returns {boolean}
 */
function vaultIsAudioDocument(docNode) {
    const mime = typeof docNode.mime_type === 'string' ? docNode.mime_type.trim().toLowerCase() : '';
    if (mime.startsWith('audio/')) return true;
    const name = typeof docNode.file_name === 'string' ? docNode.file_name.trim().toLowerCase() : '';
    if (!name) return false;
    return /\.(mp3|m4a|wav|ogg|webm|flac|aac|opus)$/.test(name);
}

/**
 * @param {Record<string, unknown>} docNode
 * @returns {boolean}
 */
function vaultIsTextPreviewDocument(docNode) {
    const mime = typeof docNode.mime_type === 'string' ? docNode.mime_type.trim().toLowerCase() : '';
    if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/x-markdown') return true;
    const name = typeof docNode.file_name === 'string' ? docNode.file_name.trim().toLowerCase() : '';
    if (!name) return false;
    return /\.(txt|md|markdown)$/.test(name);
}

/**
 * @param {Record<string, unknown>} docNode
 * @returns {boolean}
 */
function vaultDocumentHasTranscript(docNode) {
    if (docNode.has_transcript === true || docNode.has_transcript === 1) return true;
    const sourceText = typeof docNode.source_text === 'string' ? docNode.source_text.trim() : '';
    if (sourceText) return true;
    if (!vaultIsAudioDocument(docNode)) return false;
    const emb = typeof docNode.embed_status === 'string' ? docNode.embed_status.trim().toLowerCase() : '';
    return emb === 'embedded' || emb === 'embedding' || emb === 'failed';
}

/**
 * @param {number} docId
 * @param {AbortSignal} signal
 * @param {{ jobNote?: HTMLElement | null, loadingBtn?: HTMLButtonElement | null, onSuccess?: () => void }} [opts]
 * @returns {Promise<boolean>}
 */
async function vaultEnqueueDocumentRetranscribe(docId, signal, opts = {}) {
    const { jobNote = null, loadingBtn = null, onSuccess } = opts;
    if (!Number.isFinite(docId) || docId < 1 || signal.aborted) return false;

    const DialogMod = await vaultLoadDialogCtor();
    if (!DialogMod || typeof DialogMod.confirm !== 'function') return false;
    const ok = await DialogMod.confirm(
        vaultSidebarUiString('action_retranscribe'),
        vaultSidebarUiString('confirm_retranscribe'),
    );
    if (!ok || signal.aborted) return false;

    if (jobNote) {
        jobNote.textContent = '';
        jobNote.classList.add('hidden');
    }

    const idleText = vaultSidebarUiString('action_retranscribe');
    let enqueuedOk = false;
    try {
        if (loadingBtn) {
            vaultSetDetailActionButtonLoading(loadingBtn, true, vaultSidebarUiString('action_retranscribe_loading'));
        }

        const wid = getOaaoActiveWorkspaceIdForVault();
        /** @type {Record<string, unknown>} */
        const payload = {
            document_id: docId,
            hook_ids: ['vh.rag.audio_asr'],
            force_re_asr: true,
        };
        if (wid != null) payload.workspace_id = wid;

        const res = await fetch(`${vaultApiBase()}document_enqueue`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
            signal,
        });
        /** @type {{ success?: boolean, message?: string }} */
        const j = await res.json().catch(() => ({}));
        if (signal.aborted) return false;

        if (jobNote) {
            jobNote.classList.remove('hidden');
            jobNote.textContent = j.success
                ? vaultSidebarUiString('enqueue_ok')
                : typeof j.message === 'string' && j.message.trim()
                  ? j.message.trim()
                  : vaultSidebarUiString('enqueue_fail');
        }

        if (j.success) {
            enqueuedOk = true;
            vaultInvalidateTreeCache();
            vaultTransientDocBadges.set(docId, `${vaultSidebarUiString('badge_queued')} · ASR`);
            vaultPatchDocumentNodeInTreeCache(docId, {
                has_transcript: false,
                source_text: null,
                embed_status: 'pending',
                embed_error: null,
            });
            vaultExplorerRedraw();
            vaultEnsureEmbedWatchDoc(docId);
            vaultStartEmbedProgressPolling(signal);
            onSuccess?.();
        }

        return enqueuedOk;
    } catch (e) {
        if (!signal.aborted && jobNote) {
            jobNote.classList.remove('hidden');
            jobNote.textContent = vaultSidebarUiString('enqueue_fail');
        }
        console.warn('[oaao vault] re-transcribe failed', e);
        return false;
    } finally {
        if (!signal.aborted && loadingBtn?.isConnected) {
            vaultSetDetailActionButtonLoading(loadingBtn, false, idleText);
        }
    }
}

function vaultInvalidateTreeCache() {
    void vaultInvalidateTreeCacheAsync();
    document.dispatchEvent(new CustomEvent('oaao:vault-tree-invalidate'));
}

async function vaultInvalidateTreeCacheAsync() {
    const cache = await loadVaultTreeCacheMod();
    const wid = getOaaoActiveWorkspaceIdForVault();
    cache.invalidateVaultTreeCache(cache.vaultTreeScopeKey(wid));
}

/** @param {string} pathOnly */
function oaaoPrefixedSitePath(pathOnly) {
    const raw = (typeof document !== 'undefined' && document.body.dataset?.oaaoMountPrefix)?.trim() ?? '';
    const path = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
    if (!raw || raw === '/') return path;
    const prefix = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/{2,}/g, '/').replace(/\/$/, '');
    if (!prefix) return path;
    if (path === prefix || path.startsWith(`${prefix}/`)) return path;

    return `${prefix}${path}`;
}

/** Dynamic Toast ctor — via {@code razyui.load} (same as {@link vaultLoadDialogCtor} / Uploader). */
/** @type {Promise<{ show: function, info: function, success: function, error: function } | null> | null} */
let vaultToastCtorPromise = null;

function loadVaultToastCtor() {
    if (!vaultToastCtorPromise) {
        vaultToastCtorPromise = razyui
            .load('Toast')
            .then((Toast) => (typeof Toast === 'function' ? Toast : null))
            .catch((err) => {
                vaultToastCtorPromise = null;
                console.warn('[oaao vault] Toast load failed', err);

                return null;
            });
    }

    return vaultToastCtorPromise;
}

/** @param {keyof typeof VAULT_SIDEBAR_UI} key */
async function vaultToastSuccess(key) {
    try {
        const Toast = await loadVaultToastCtor();
        Toast?.success(vaultSidebarUiString(key), { duration: 2400, position: 'bottom-right' });
    } catch {
        /* noop */
    }
}

/** Persistent upload-progress toast ({@code duration: 0}); body text updated from xhr progress. */
/** @type {{ dismiss: () => void } | null} */
let vaultUploadToastInst = null;
/** @type {HTMLElement | null} */
let vaultUploadToastMsgEl = null;

function vaultDismissUploadToast() {
    try {
        vaultUploadToastInst?.dismiss?.();
    } catch {
        /* noop */
    }
    vaultUploadToastInst = null;
    vaultUploadToastMsgEl = null;
}

/**
 * @param {string} fileName
 * @param {number} progressPct 0–100
 */
async function vaultToastUploadProgress(fileName, progressPct) {
    try {
        const Toast = await loadVaultToastCtor();
        if (!Toast || typeof Toast.show !== 'function') return;

        const pct = Math.max(0, Math.min(100, Math.round(Number(progressPct) || 0)));
        const msg = `${fileName} · ${pct}%`;

        if (vaultUploadToastInst && vaultUploadToastMsgEl) {
            vaultUploadToastMsgEl.textContent = msg;

            return;
        }

        vaultDismissUploadToast();
        const inst = Toast.show({
            type: 'info',
            title: vaultSidebarUiString('upload_toast_uploading_title'),
            message: msg,
            duration: 0,
            position: 'bottom-right',
            closable: true,
            showProgress: false,
            pauseOnHover: true,
        });
        vaultUploadToastInst = inst;
        requestAnimationFrame(() => {
            const root = inst.getControl?.()?.element;
            vaultUploadToastMsgEl =
                root && typeof root.querySelector === 'function' ? root.querySelector('.toast-message') : null;
            if (vaultUploadToastMsgEl) vaultUploadToastMsgEl.textContent = msg;
        });
    } catch {
        /* noop */
    }
}

function vaultApiBase() {
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

function getOaaoActiveWorkspaceIdForVault() {
    const root = document.getElementById('workspace-view');
    const ds =
        typeof root?.dataset?.oaaoActiveWorkspaceId === 'string' ? root.dataset.oaaoActiveWorkspaceId.trim() : '';
    if (!ds) return null;
    const n = Number(ds);

    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

const VAULT_NAV_SESSION_VER = 'v1';

/** @returns {string} */
function vaultNavSessionStorageKey() {
    const wid = getOaaoActiveWorkspaceIdForVault();

    return `oaao.vaultExplorerNav.${VAULT_NAV_SESSION_VER}.${wid != null ? String(wid) : 'personal'}`;
}

/**
 * @returns {{ vaultId: number | null, containerId: number | null } | null}
 */
function vaultReadStoredExplorerNav() {
    try {
        if (typeof sessionStorage === 'undefined') return null;
        const raw = sessionStorage.getItem(vaultNavSessionStorageKey());
        if (!raw || raw.trim() === '') return null;
        const dec = JSON.parse(raw);
        if (!dec || typeof dec !== 'object') return null;
        const vidRaw = /** @type {{ vaultId?: unknown }} */ (dec).vaultId;
        const cidRaw = /** @type {{ containerId?: unknown }} */ (dec).containerId;

        return {
            vaultId:
                vidRaw == null
                    ? null
                    : typeof vidRaw === 'number'
                      ? vidRaw
                      : Math.floor(Number(vidRaw ?? NaN)),
            containerId:
                cidRaw == null
                    ? null
                    : typeof cidRaw === 'number'
                      ? cidRaw
                      : Math.floor(Number(cidRaw ?? NaN)),
        };
    } catch {
        return null;
    }
}

let vaultApplyingHashWrites = false;

/** @returns {{ vaultId: number, containerId: number | null } | null} */
function vaultReadNavFromLocationHash() {
    try {
        const raw = typeof window.location.hash === 'string' ? window.location.hash.replace(/^#/, '').trim() : '';
        const m = raw.match(/^oaao-vault=v(\d+)\.c(\d+)$/);
        if (!m) return null;
        const vid = Number(m[1]);
        const cid = Number(m[2]);
        if (!Number.isFinite(vid) || Math.floor(vid) < 1) return null;

        /** @type {number | null} */
        let containerId = null;
        if (Number.isFinite(cid) && Math.floor(cid) > 0) {
            containerId = Math.floor(cid);
        }

        return { vaultId: Math.floor(vid), containerId };
    } catch {
        return null;
    }
}

/** @param {{ vaultId: number | null, containerId: number | null }} nav */
function vaultExplorerHashSuffix(nav) {
    if (nav.vaultId == null) return '';
    const v = typeof nav.vaultId === 'number' ? nav.vaultId : Math.floor(Number(nav.vaultId));
    if (!Number.isFinite(v) || Math.floor(v) < 1) return '';
    const c =
        nav.containerId != null && Number.isFinite(Number(nav.containerId)) && Number(nav.containerId) > 0
            ? Math.floor(Number(nav.containerId))
            : 0;

    return `#oaao-vault=v${Math.floor(v)}.c${c}`;
}

function vaultClearVaultPathHash() {
    if (typeof window === 'undefined' || typeof history.replaceState !== 'function') return;
    const raw = typeof window.location.hash === 'string' ? window.location.hash.replace(/^#/, '').trim() : '';
    if (!/^oaao-vault=v\d+\.c\d+$/.test(raw)) return;
    const base = `${window.location.pathname}${window.location.search}`;
    vaultApplyingHashWrites = true;
    try {
        window.history.replaceState(history.state ?? null, '', base);
    } finally {
        vaultApplyingHashWrites = false;
    }
}

/** Keep {@code #oaao-vault=v{n}.c{m}} aligned with breadcrumbs (vault root uses {@code c0}). */
function vaultWriteLocationHashFromNav(nav) {
    if (typeof window === 'undefined' || typeof history.replaceState !== 'function') return;

    const nextSuffix = vaultExplorerHashSuffix(nav);
    const base = `${window.location.pathname}${window.location.search}`;
    if (nextSuffix === '') {
        vaultClearVaultPathHash();

        return;
    }

    const desired = `${base}${nextSuffix}`;
    const current = `${base}${typeof window.location.hash === 'string' ? window.location.hash : ''}`;
    if (current === desired) return;

    vaultApplyingHashWrites = true;
    try {
        window.history.replaceState(history.state ?? null, '', desired);
    } finally {
        vaultApplyingHashWrites = false;
    }
}

/** Sync current folder path for full reload / shell remount (workspace-scoped {@code sessionStorage} + URL hash {@code #oaao-vault=v{n}.c{m}}). */
function vaultPersistStoredExplorerNav() {
    try {
        if (typeof sessionStorage === 'undefined') return;
        const key = vaultNavSessionStorageKey();
        const { vaultId, containerId } = vaultExplorerNav;
        if (vaultId == null || !Number.isFinite(vaultId) || vaultId < 1) {
            sessionStorage.removeItem(key);
            vaultClearVaultPathHash();

            return;
        }

        const payload = {
            vaultId: Math.floor(vaultId),
            containerId:
                containerId != null && Number.isFinite(containerId) && containerId > 0
                    ? Math.floor(containerId)
                    : null,
        };
        sessionStorage.setItem(key, JSON.stringify(payload));
        vaultWriteLocationHashFromNav({
            vaultId: payload.vaultId,
            containerId: payload.containerId,
        });
    } catch {
        /* noop */
    }
}

/**
 * @param {unknown[]} rows
 * @param {number} docId
 * @returns {Record<string, unknown> | null}
 */
function vaultFindDocumentNodeById(rows, docId) {
    const want = Math.floor(Number(docId));
    if (!Number.isFinite(want) || want < 1) return null;

    /** @param {unknown[]} nodes */
    const walk = (nodes) => {
        const list = Array.isArray(nodes) ? nodes : [];
        for (const raw of list) {
            if (!raw || typeof raw !== 'object') continue;
            const n = /** @type {Record<string, unknown>} */ (raw);
            const kind = typeof n.kind === 'string' ? n.kind : '';
            const idRaw = n.id;
            const idNum = typeof idRaw === 'number' ? idRaw : Math.floor(Number(idRaw ?? NaN));
            if (kind === 'document' && idNum === want) {
                return n;
            }
            const kids = Array.isArray(n.children) ? n.children : [];
            if (kids.length) {
                const hit = walk(kids);
                if (hit) return hit;
            }
        }

        return null;
    };

    return walk(rows);
}

/**
 * Merge fields into a document node inside {@link vaultExplorerTreeCache} (optimistic enqueue UI).
 *
 * @param {number} docId
 * @param {Record<string, unknown>} fields
 * @returns {Record<string, unknown> | null} patched node
 */
function vaultPatchDocumentNodeInTreeCache(docId, fields) {
    const want = Math.floor(Number(docId));
    if (!Number.isFinite(want) || want < 1) return null;

    /** @param {unknown[]} nodes */
    const walk = (nodes) => {
        const list = Array.isArray(nodes) ? nodes : [];
        for (const raw of list) {
            if (!raw || typeof raw !== 'object') continue;
            const n = /** @type {Record<string, unknown>} */ (raw);
            const kind = typeof n.kind === 'string' ? n.kind : '';
            const idNum = typeof n.id === 'number' ? n.id : Math.floor(Number(n.id ?? NaN));
            if (kind === 'document' && idNum === want) {
                Object.assign(n, fields);

                return n;
            }
            const kids = Array.isArray(n.children) ? n.children : [];
            const hit = walk(kids);
            if (hit) return hit;
        }

        return null;
    };

    return walk(vaultExplorerTreeCache);
}

/** @param {HTMLElement} btn @param {boolean} loading @param {string} [idleText] */
function vaultSetDetailActionButtonLoading(btn, loading, idleText) {
    btn.disabled = loading;
    btn.classList.toggle('opacity-50', loading);
    btn.classList.toggle('cursor-not-allowed', loading);
    btn.classList.toggle('pointer-events-none', loading);
    btn.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (loading) {
        btn.textContent = vaultSidebarUiString('enqueue_submitting');
    } else if (typeof idleText === 'string' && idleText.trim()) {
        btn.textContent = idleText.trim();
    }
}

/** Drop optimistic “Queued · …” chips once the server row reflects real pipeline state. */
function vaultReconcileTransientDocBadges(treeRows) {
    const dead = [];
    for (const docId of vaultTransientDocBadges.keys()) {
        const node = vaultFindDocumentNodeById(treeRows, docId);
        if (!node) continue;
        const emb = typeof node.embed_status === 'string' ? node.embed_status.trim().toLowerCase() : '';
        if (emb === 'embedded' || emb === 'failed' || emb === 'embedding') {
            dead.push(docId);
        } else if (emb === 'pending' || emb === 'held' || emb === '') {
            dead.push(docId);
        }
    }
    for (const id of dead) {
        vaultTransientDocBadges.delete(id);
    }
}

/** Document ids to poll after Run Embedding until embedding finishes or the row shows an error. */
const vaultEmbedWatchDocIds = new Set();

function vaultEmbedWatchReconcile(treeRows) {
    for (const docId of [...vaultEmbedWatchDocIds]) {
        const node = vaultFindDocumentNodeById(treeRows, docId);
        if (!node) continue;

        const emb = typeof node.embed_status === 'string' ? node.embed_status.trim().toLowerCase() : '';

        if (emb === 'embedded' || emb === 'failed') {
            vaultEmbedWatchDocIds.delete(docId);
        }
    }
}

/** @type {ReturnType<typeof setTimeout> | null} */
let vaultEmbedProgressTimer = null;

/** @type {EventSource | null} */
let vaultIngestEventSource = null;

/** @type {number} */
let vaultIngestStreamVaultId = 0;

function vaultCloseIngestEventSource() {
    if (vaultIngestEventSource != null) {
        vaultIngestEventSource.close();
        vaultIngestEventSource = null;
    }
    vaultIngestStreamVaultId = 0;
}

/**
 * @param {unknown[]} statuses
 * @param {AbortSignal} signal
 */
async function vaultApplyIngestStatusRows(statuses, signal) {
    if (signal.aborted || !Array.isArray(statuses) || statuses.length === 0) return;
    if (!vaultExplorerTreeCache.length) return;

    const cache = await loadVaultTreeCacheMod();
    /** @type {Record<string, Record<string, unknown>>} */
    const byId = {};
    for (const raw of statuses) {
        if (!raw || typeof raw !== 'object') continue;
        const row = /** @type {Record<string, unknown>} */ (raw);
        byId[String(row.id ?? '')] = row;
    }
    cache.patchVaultTreeDocumentStatuses(vaultExplorerTreeCache, byId);
    vaultReconcileTransientDocBadges(vaultExplorerTreeCache);
    vaultEmbedWatchReconcile(vaultExplorerTreeCache);
    vaultPersistStoredExplorerNav();
    if (typeof vaultExplorerRedraw === 'function') {
        vaultExplorerRedraw();
    } else if (typeof vaultExplorerEmbedPollRefreshRef === 'function') {
        await vaultExplorerEmbedPollRefreshRef();
    }
}

/**
 * Prefer orchestrator SSE for ingest progress; falls back to 3s poll on mint/open failure.
 *
 * @param {number} vaultId
 * @param {AbortSignal} signal
 */
function vaultEnsureIngestStream(vaultId, signal) {
    if (signal.aborted) return;
    const vid = Math.floor(Number(vaultId));
    if (!Number.isFinite(vid) || vid < 1) return;
    if (vaultIngestEventSource != null && vaultIngestStreamVaultId === vid) return;

    vaultCloseIngestEventSource();
    vaultIngestStreamVaultId = vid;

    const watchIds = [
        ...vaultEmbedWatchDocIds,
        ...vaultTransientDocBadges.keys(),
    ]
        .map((x) => Math.floor(Number(x)))
        .filter((x) => Number.isFinite(x) && x > 0);

    void (async () => {
        try {
            const wid = getOaaoActiveWorkspaceIdForVault();
            /** @type {Record<string, unknown>} */
            const payload = { vault_id: vid };
            if (wid != null) payload.workspace_id = wid;
            if (watchIds.length > 0) payload.document_ids = watchIds.slice(0, 64);

            const res = await fetch(`${vaultApiBase()}ingest_stream_token`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(payload),
            });
            if (signal.aborted || !res.ok) {
                vaultCloseIngestEventSource();
                vaultStartEmbedProgressPolling(signal);
                return;
            }
            const json = await res.json();
            const streamUrl =
                json && json.data && typeof json.data.stream_url === 'string' ? json.data.stream_url.trim() : '';
            if (!streamUrl || signal.aborted) {
                vaultCloseIngestEventSource();
                vaultStartEmbedProgressPolling(signal);
                return;
            }

            const es = new EventSource(streamUrl);
            vaultIngestEventSource = es;

            es.addEventListener('status', (ev) => {
                if (signal.aborted) return;
                try {
                    const data = JSON.parse(String(/** @type {MessageEvent} */ (ev).data || '{}'));
                    const docs = data && Array.isArray(data.documents) ? data.documents : [];
                    void vaultApplyIngestStatusRows(docs, signal);
                } catch (_e) {
                    //
                }
            });

            es.onerror = () => {
                if (signal.aborted) return;
                vaultCloseIngestEventSource();
                vaultStartEmbedProgressPolling(signal);
            };
        } catch (_e) {
            vaultCloseIngestEventSource();
            vaultStartEmbedProgressPolling(signal);
        }
    })();
}

function vaultClearEmbedProgressTimer() {
    if (vaultEmbedProgressTimer != null) {
        clearTimeout(vaultEmbedProgressTimer);
        vaultEmbedProgressTimer = null;
    }
}

/** Subscribe doc id to ingest polling without restarting an active timer ({@see vaultKickEmbedPollingIfNeeded}). */
function vaultEnsureEmbedWatchDoc(docId) {
    const id = Math.floor(Number(docId));
    if (!Number.isFinite(id) || id < 1) return;
    vaultEmbedWatchDocIds.add(id);
}

/**
 * Start embed polling only when nothing is scheduled — avoids resetting timers when {@link renderVaultDetailPanel}
 * runs inside {@link vaultExplorerEmbedPollRefreshRef}.
 */
function vaultKickEmbedPollingIfNeeded(signal) {
    if (signal.aborted) return;
    if (vaultTransientDocBadges.size === 0 && vaultEmbedWatchDocIds.size === 0) {
        vaultClearEmbedProgressTimer();
        vaultCloseIngestEventSource();
        return;
    }
    const navVaultId =
        vaultExplorerNav && Number.isFinite(vaultExplorerNav.vaultId)
            ? Math.floor(Number(vaultExplorerNav.vaultId))
            : 0;
    if (navVaultId > 0) {
        vaultEnsureIngestStream(navVaultId, signal);
        return;
    }
    if (vaultEmbedProgressTimer != null) return;
    vaultStartEmbedProgressPolling(signal);
}

/** Light tree refresh after enqueue so status chips track claim/finish without a manual browser reload. */
function vaultStartEmbedProgressPolling(signal) {
    vaultClearEmbedProgressTimer();
    if (signal.aborted) return;

    let ticks = 0;
    const maxTicks = 240;
    const gapMs = 3000;

    const step = () => {
        vaultEmbedProgressTimer = null;
        if (signal.aborted) return;
        if (vaultTransientDocBadges.size === 0 && vaultEmbedWatchDocIds.size === 0) return;
        if (++ticks > maxTicks) return;
        void Promise.resolve(
            typeof vaultExplorerEmbedPollRefreshRef === 'function'
                ? vaultExplorerEmbedPollRefreshRef()
                : typeof vaultExplorerRefreshTreeRef === 'function'
                  ? vaultExplorerRefreshTreeRef()
                  : undefined,
        )
            /** @type {Promise<void>} */
            .then(() => {})
            .finally(() => {
                if (signal.aborted) return;
                if (vaultTransientDocBadges.size === 0 && vaultEmbedWatchDocIds.size === 0) return;
                vaultEmbedProgressTimer = window.setTimeout(step, gapMs);
            });
    };

    vaultEmbedProgressTimer = window.setTimeout(step, 2000);
}

/** @returns {Promise<unknown>} */
async function fetchVaultTreeJson(opts = {}) {
    const base = vaultApiBase();
    const wid = getOaaoActiveWorkspaceIdForVault();
    const cache = await loadVaultTreeCacheMod();
    const buildUrl = () => {
        const q = wid != null ? `?workspace_id=${encodeURIComponent(String(wid))}` : '';
        return `${base}vault_tree${q}`;
    };
    const j = await cache.fetchVaultTreeCached(wid, buildUrl, { force: opts.force === true });

    return j ?? {};
}

/**
 * @param {number[]} documentIds
 * @returns {Promise<unknown[]>}
 */
async function fetchVaultDocumentStatusesJson(documentIds) {
    const base = vaultApiBase();
    const wid = getOaaoActiveWorkspaceIdForVault();
    const cache = await loadVaultTreeCacheMod();
    const buildUrl = (ids) => {
        const scopeQ = wid != null ? `workspace_id=${encodeURIComponent(String(wid))}&` : '';
        return `${base}document_status?${scopeQ}document_ids=${ids.join(',')}`;
    };

    return cache.fetchVaultDocumentStatuses(wid, buildUrl, documentIds);
}

/**
 * Bulk vault-scoped poll — replaces N×document_status calls with one
 * vault_status call. Returns only non-terminal documents
 * (transient_only=1) so steady-state polling stays cheap.
 *
 * @param {number} vaultId
 * @returns {Promise<unknown[]>}
 */
async function fetchVaultStatusByVaultJson(vaultId) {
    if (!Number.isFinite(vaultId) || vaultId < 1) return [];
    const base = vaultApiBase();
    const wid = getOaaoActiveWorkspaceIdForVault();
    const scopeQ = wid != null ? `workspace_id=${encodeURIComponent(String(wid))}&` : '';
    const url = `${base}vault_status?${scopeQ}vault_id=${encodeURIComponent(String(vaultId))}&transient_only=1`;
    try {
        const resp = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        if (!resp.ok) return [];
        const json = await resp.json();
        const docs = json && json.data && Array.isArray(json.data.documents) ? json.data.documents : [];
        return docs;
    } catch (_e) {
        return [];
    }
}

/** Fallback UI strings ({@see workspace.js workspaceShellUiLang}). */
const VAULT_SIDEBAR_UI = {
    loading: { en: 'Loading vault…', 'zh-Hant': '正在載入保管庫…' },
    empty: { en: 'No vaults yet.', 'zh-Hant': '尚無保管庫。' },
    error: { en: 'Could not load vault tree.', 'zh-Hant': '無法載入保管庫樹狀結構。' },
    explorer_region: { en: 'Vault contents', 'zh-Hant': '保管庫內容' },
    col_name: { en: 'Name', 'zh-Hant': '名稱' },
    col_type: { en: 'Type', 'zh-Hant': '類型' },
    col_size: { en: 'Size', 'zh-Hant': '大小' },
    col_status: { en: 'Status', 'zh-Hant': '狀態' },
    col_location: { en: 'Location', 'zh-Hant': '位置' },
    breadcrumb_root: { en: 'Vaults', 'zh-Hant': '保管庫' },
    badge_pending: { en: 'Pending', 'zh-Hant': '等待處理' },
    badge_embedded: { en: 'Embedded', 'zh-Hant': '已向量化' },
    badge_failed: { en: 'Failed', 'zh-Hant': '失敗' },
    badge_queued: { en: 'Queued', 'zh-Hant': '已排程' },
    badge_embedding: { en: 'Embedding…', 'zh-Hant': '正在向量化…' },
    badge_refetch_queued: { en: 'Refetch queued', 'zh-Hant': '等待重新擷取' },
    badge_refetch_running: { en: 'Refetching…', 'zh-Hant': '重新擷取中…' },
    detail_embed_heading: {
        en: 'Ingest / embedding',
        'zh-Hant': '索引／嵌入',
    },
    detail_embed_progress_queued: {
        en: 'Embedding is queued — the worker updates this row when indexing starts and finishes.',
        'zh-Hant': '已向量化排程 — 索引開始／完成後此處會更新。',
    },
    detail_embed_progress_running: {
        en: 'Writing vector index — retrieval may omit this file until embedded.',
        'zh-Hant': '正在寫入向量索引 — 完成前任檢索可能不包含此檔。',
    },
    detail_embed_hint_re_embed: {
        en: 'Already embedded — Run Embedding again clears old vectors then re-ingests.',
        'zh-Hant': '已向量化 — 再次執行「Run · Embedding」會先清除既有向量並重新嵌入。',
    },
    embed_chunks_btn: { en: 'Embed detail', 'zh-Hant': '嵌入詳情' },
    embed_chunks_btn_loading: { en: 'Embed detail · …', 'zh-Hant': '嵌入詳情 · …' },
    embed_chunks_btn_count: { en: 'Embed detail · {n} chunks', 'zh-Hant': '嵌入詳情 · {n} 塊' },
    embed_chunks_dialog_title: { en: 'Embedding chunks', 'zh-Hant': '向量分割詳情' },
    embed_chunks_dialog_summary: {
        en: '{name} — {n} chunk(s) in {collection}',
        'zh-Hant': '{name} — {collection} 共 {n} 塊',
    },
    embed_chunks_dialog_empty: { en: 'No chunks found in the vector index.', 'zh-Hant': '向量索引中沒有分割資料。' },
    embed_chunks_dialog_load_fail: {
        en: 'Could not load chunk details from Qdrant.',
        'zh-Hant': '無法從 Qdrant 載入分割詳情。',
    },
    embed_chunks_chars: { en: '{n} chars', 'zh-Hant': '{n} 字元' },
    embed_chunks_index: { en: 'Chunk #{n}', 'zh-Hant': '第 {n} 塊' },
    embed_chunks_ocr: { en: 'OCR', 'zh-Hant': 'OCR' },
    transcript_btn: { en: 'View Transcript', 'zh-Hant': '查看轉寫稿' },
    transcript_btn_loading: { en: 'View Transcript · …', 'zh-Hant': '查看轉寫稿 · …' },
    transcript_unavailable: {
        en: 'Transcript is not ready yet — wait for ASR to finish.',
        'zh-Hant': '轉寫稿尚未就緒 — 請待 ASR 完成。',
    },
    transcript_load_fail: {
        en: 'Could not load transcript.',
        'zh-Hant': '無法載入轉寫稿。',
    },
    transcript_dialog_title: { en: 'View Transcript', 'zh-Hant': '查看轉寫稿' },
    preview_btn: { en: 'Preview', 'zh-Hant': '預覽' },
    preview_btn_loading: { en: 'Preview · …', 'zh-Hant': '預覽 · …' },
    preview_load_fail: {
        en: 'Could not load file preview.',
        'zh-Hant': '無法載入檔案預覽。',
    },
    preview_dialog_title: { en: 'Preview', 'zh-Hant': '預覽' },
    preview_truncated_hint: {
        en: 'Preview truncated — file exceeds 512 KB limit.',
        'zh-Hant': '預覽已截斷 — 檔案超過 512 KB 上限。',
    },
    preview_empty: { en: 'File is empty.', 'zh-Hant': '檔案為空。' },
    action_retranscribe: { en: 'Re-transcribe', 'zh-Hant': '重新轉寫' },
    action_retranscribe_loading: { en: 'Re-transcribe · …', 'zh-Hant': '重新轉寫 · …' },
    confirm_retranscribe: {
        en: 'Replace the existing transcript and run ASR again with current Settings → ASR (Speaker mode)? Embedding will re-run afterward.',
        'zh-Hant': '以目前 Settings → ASR（Speaker 模式）重新轉寫並取代現有轉寫稿？完成後會重新向量化。',
    },
    retranscribe_hint_normal: {
        en: 'This file was transcribed in Normal mode — use Re-transcribe to apply Speaker labels.',
        'zh-Hant': '此檔以一般模式轉寫 — 請用「重新轉寫」以套用說話者標記。',
    },
    embed_scope_pdf_page: { en: 'PDF page', 'zh-Hant': 'PDF 頁' },
    embed_scope_md_section: { en: 'Markdown section', 'zh-Hant': 'Markdown 章節' },
    embed_scope_docx_flow: { en: 'Word paragraph', 'zh-Hant': 'Word 段落' },
    embed_scope_docx_table: { en: 'Word table', 'zh-Hant': 'Word 表格' },
    embed_scope_xlsx_sheet: { en: 'Spreadsheet sheet', 'zh-Hant': '試算表工作表' },
    embed_scope_pptx_slide: { en: 'Slide', 'zh-Hant': '投影片' },
    embed_scope_plain: { en: 'Plain text', 'zh-Hant': '純文字' },
    embed_scope_transcript_summary: { en: 'Transcript summary', 'zh-Hant': '轉寫摘要' },
    run_embed_blocked_embedding: {
        en: 'Wait until embedding finishes.',
        'zh-Hant': '請待向量化完成後再試。',
    },
    action_requeue_embed: { en: 'Re-queue · Embedding', 'zh-Hant': '重新排程 · 向量化' },
    action_requeue_graph: { en: 'Re-queue · Graph', 'zh-Hant': '重新排程 · 圖譜' },
    action_reembed: { en: 'Re-embed', 'zh-Hant': '重新向量化' },
    confirm_requeue_embed: {
        en: 'Cancel the in-progress embedding job and queue a new run? Existing vectors for this file will be cleared first.',
        'zh-Hant': '取消進行中的向量化工作並重新排程？將先清除此檔在檢索索引中的既有向量。',
    },
    detail_embed_stuck_hint: {
        en: 'If this stays on Embedding for a long time, use Re-queue below (orchestrator may be offline).',
        'zh-Hant': '若長時間停在 Embedding，請用下方「重新排程」（可能 orchestrator 未運行）。',
    },
    badge_held: {
        en: 'Not auto-indexed',
        'zh-Hant': '未自動索引（可手動 Run 或對話選用 Vault）',
    },
    badge_graph_indexed: { en: 'Graph OK', 'zh-Hant': '圖譜已建' },
    badge_graph_building: { en: 'Graph…', 'zh-Hant': '圖譜建立中' },
    badge_graph_pending: { en: 'Graph queued', 'zh-Hant': '圖譜排程' },
    badge_graph_failed: { en: 'Graph failed', 'zh-Hant': '圖譜失敗' },
    detail_graph_hint_no_text: {
        en: 'No extractable text — for audio, run Transcript / ASR first, then Re-queue · Graph in FILE ACTIONS.',
        'zh-Hant': '無可擷取文字 — 音訊請先執行轉寫／ASR，再在 FILE ACTIONS 按「重新排程 · 圖譜」。',
    },
    detail_graph_hint_missing_arango: {
        en: 'ArangoDB is not configured — start the vectors profile (`docker compose --profile vectors up`).',
        'zh-Hant': 'ArangoDB 未設定 — 請啟動 vectors profile（`docker compose --profile vectors up`）。',
    },
    detail_graph_hint_missing_purpose: {
        en: 'Graph purpose / endpoint is missing — configure Graph primary under Purpose allocation.',
        'zh-Hant': '缺少 Graph purpose／endpoint — 請在 Purpose allocation 設定 Graph primary。',
    },
    detail_graph_hint_requeue: {
        en: 'Use Re-queue · Graph below after fixing the cause shown above.',
        'zh-Hant': '修正上方原因後，請在下方按「重新排程 · 圖譜」。',
    },
    /** Native tooltip on status-row info icon ({@see vaultStatusDetailTooltipIcon}). */
    status_detail_tooltip_aria: {
        en: 'Error detail — hover or focus to read',
        'zh-Hant': '錯誤詳情 — 游標停留或鍵盤聚焦可閱讀',
    },
    detail_graph_heading: { en: 'Graph', 'zh-Hant': '知識圖譜' },
    kind_vault: { en: 'Vault', 'zh-Hant': '保管庫' },
    kind_container: { en: 'Folder', 'zh-Hant': '資料夾' },
    kind_document: { en: 'File', 'zh-Hant': '檔案' },
    vault_name_required: { en: 'Enter a vault name.', 'zh-Hant': '請輸入保管庫名稱。' },
    folder_name_required: { en: 'Enter a folder name.', 'zh-Hant': '請輸入資料夾名稱。' },
    folder_created: { en: 'Folder created', 'zh-Hant': '已建立資料夾' },
    folder_deleted: { en: 'Folder deleted', 'zh-Hant': '已刪除資料夾' },
    document_deleted: { en: 'File deleted', 'zh-Hant': '已刪除檔案' },
    vault_card_open: { en: 'Open vault', 'zh-Hant': '開啟保管庫' },
    vault_card_config: { en: 'Config', 'zh-Hant': '設定' },
    vault_config_title: { en: 'Vault config', 'zh-Hant': '保管庫設定' },
    vault_config_index_heading: { en: 'Indexing & RAG', 'zh-Hant': '索引與 RAG' },
    vault_config_index_hint: {
        en: 'Auto-index queues embedding on upload. GraphRAG runs after each document finishes embedding.',
        'zh-Hant': '「自動索引」會在上傳時排入向量化；「GraphRAG」會在每份文件嵌入完成後建立知識圖譜。',
    },
    vault_config_danger_heading: { en: 'Danger zone', 'zh-Hant': '危險區域' },
    vault_config_danger_hint: {
        en: 'Permanently delete this vault, all folders, files, queued jobs, and matching retrieval vectors.',
        'zh-Hant': '永久刪除此保管庫、所有資料夾與檔案、佇列工作，以及檢索索引中的對應向量。',
    },
    vault_config_delete_btn: { en: 'Delete vault', 'zh-Hant': '刪除保管庫' },
    confirm_delete_vault: {
        en: 'Delete this vault and everything inside? This cannot be undone.',
        'zh-Hant': '確定要刪除此保管庫及其全部內容？此動作無法復原。',
    },
    vault_config_open_aria: { en: 'Open vault config', 'zh-Hant': '開啟保管庫設定' },
    vault_rag_on: { en: 'Auto-index uploads', 'zh-Hant': '上傳後自動索引' },
    vault_rag_off: { en: 'Storage-only until chat/source pick', 'zh-Hant': '僅儲存（對話選 Vault 來源後再用）' },
    vault_graph_on: { en: 'Graph', 'zh-Hant': '知識圖譜' },
    vault_auto_index_label: { en: 'Auto-index new uploads', 'zh-Hant': '新檔自動索引' },
    vault_auto_index_aria: {
        en: 'Automatically queue embedding when uploading new files',
        'zh-Hant': '上傳新檔時自動加入向量／索引工作',
    },
    vault_graph_chain_label: {
        en: 'GraphRAG after embed',
        'zh-Hant': '嵌入完成後建立知識圖譜',
    },
    vault_graph_chain_aria: {
        en: 'Queue knowledge-graph indexing after each document finishes embedding',
        'zh-Hant': '每份文件完成向量化後，自動排程知識圖譜索引',
    },
    vault_config_glossary_heading: { en: 'ASR glossary', 'zh-Hant': 'ASR 詞彙庫' },
    vault_config_glossary_hint: {
        en: 'JSON terms improve transcription for domain names. Workspace glossary overrides matching vault terms.',
        'zh-Hant': 'JSON 詞彙可改善專有名詞辨識；工作區詞彙會覆寫同名保管庫詞條。',
    },
    vault_config_glossary_save: { en: 'Save glossary', 'zh-Hant': '儲存詞彙庫' },
    vault_config_glossary_import: { en: 'Import from embedded docs', 'zh-Hant': '從已嵌入文件整理' },
    vault_config_glossary_saved: { en: 'Glossary saved.', 'zh-Hant': '詞彙庫已儲存。' },
    vault_config_glossary_import_ok: { en: 'Glossary updated from documents.', 'zh-Hant': '已從文件更新詞彙庫。' },
    vault_gallery_hint: {
        en: 'Vaults with auto-index off keep uploads on disk without embedding until you Run an action here or use this vault as an explicit Chat source.',
        'zh-Hant':
            '關閉「上傳自動索引」的保管庫只存檔、不向量化；可在此手動 Run，或在對話中明確選用該 Vault 來源後再檢索。',
    },
    upload_ok: { en: 'Upload complete.', 'zh-Hant': '上傳完成。' },
    upload_fail: { en: 'Upload failed.', 'zh-Hant': '上傳失敗。' },
    chat_sources_sync_hint: {
        en: 'Checked rows sync to Chat → Sources (embedded files, folders, vaults).',
        'zh-Hant': '勾選列會同步至對話 → 來源（已嵌入檔案、資料夾、保管庫）。',
    },
    chat_sources_selected: {
        en: '{n} selected for Chat',
        'zh-Hant': '已選 {n} 項作為對話來源',
    },
    toolbar_upload_btn: { en: 'Upload', 'zh-Hant': '上傳檔案' },
    toolbar_upload_aria: {
        en: 'Choose files to upload to the open vault',
        'zh-Hant': '選擇要上傳到目前保管庫的檔案',
    },
    upload_placeholder_compact: {
        en: 'Drop files on the list above or tap to browse',
        'zh-Hant': '拖到上方列表或點此選檔',
    },
    upload_toast_uploading_title: { en: 'Uploading', 'zh-Hant': '正在上傳' },
    enqueue_ok: { en: 'Jobs queued.', 'zh-Hant': '已加入工作佇列。' },
    enqueue_submitting: { en: 'Queueing…', 'zh-Hant': '正在加入佇列…' },
    enqueue_fail: { en: 'Could not queue jobs.', 'zh-Hant': '無法加入工作佇列。' },
    action_rename: { en: 'Rename', 'zh-Hant': '重新命名' },
    action_delete: { en: 'Delete', 'zh-Hant': '刪除' },
    action_move: { en: 'Move to…', 'zh-Hant': '移至…' },
    btn_cancel: { en: 'Cancel', 'zh-Hant': '取消' },
    btn_close: { en: 'Close', 'zh-Hant': '關閉' },
    btn_ok: { en: 'OK', 'zh-Hant': '確定' },
    confirm_delete_document: {
        en: 'Delete this file? This removes stored bytes, queued jobs, and matching vectors from the retrieval index.',
        'zh-Hant':
            '確定要刪除此檔案？將移除實體檔、相關佇列工作，並清除檢索索引中對應的向量資料。',
    },
    confirm_delete_folder: {
        en: 'Delete this folder and everything inside? This cannot be undone.',
        'zh-Hant': '確定要刪除此資料夾及其中的內容？此動作無法復原。',
    },
    rename_document_title: { en: 'Rename file', 'zh-Hant': '重新命名檔案' },
    rename_folder_title: { en: 'Rename folder', 'zh-Hant': '重新命名資料夾' },
    rename_hint: { en: 'Name', 'zh-Hant': '名稱' },
    move_dialog_title_doc: { en: 'Move file', 'zh-Hant': '移動檔案' },
    move_dialog_title_folder: { en: 'Move folder', 'zh-Hant': '移動資料夾' },
    move_dialog_hint: {
        en: 'Choose destination folder',
        'zh-Hant': '選擇目的資料夾',
    },
    move_target_vault_root: {
        en: '— Vault root (top level) —',
        'zh-Hant': '— 保管庫根目錄 —',
    },
    move_bad_target: {
        en: 'Invalid move target.',
        'zh-Hant': '無法移動到此位置。',
    },
    explorer_drag_handle_aria: {
        en: 'Drag to move into another folder',
        'zh-Hant': '拖曳以移至其他資料夾',
    },
    op_failed: { en: 'Something went wrong.', 'zh-Hant': '操作失敗。' },
};

function vaultSidebarUiLang() {
    const raw = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
    if (raw.startsWith('zh')) return 'zh-Hant';

    return 'en';
}

/** @param {keyof typeof VAULT_SIDEBAR_UI} kind */
function vaultSidebarUiString(kind) {
    const row = VAULT_SIDEBAR_UI[kind];
    if (!row) return '';
    const lang = vaultSidebarUiLang();

    return row[lang] ?? row.en ?? '';
}

/** Wired by {@link mountVaultExplorer} — opens config for the vault in breadcrumb context. */
/** @type {(() => void) | null} */
let vaultOpenActiveVaultConfigRef = null;

/**
 * @param {Record<string, unknown>} vaultNode
 * @param {{ signal?: AbortSignal, onDeleted?: () => void }} [opts]
 */
async function openVaultConfigDialog(vaultNode, opts = {}) {
    const signal = opts.signal;
    const DialogMod = await vaultLoadDialogCtor();
    if (!DialogMod || typeof DialogMod.open !== 'function') return;

    const vid = typeof vaultNode.id === 'number' ? vaultNode.id : Math.floor(Number(vaultNode.id ?? NaN));
    if (!Number.isFinite(vid) || vid < 1) return;

    const vName =
        typeof vaultNode.name === 'string' && vaultNode.name.trim()
            ? vaultNode.name.trim()
            : `Vault #${vid}`;

    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-5 min-w-0';

    const indexSec = document.createElement('section');
    indexSec.className = 'flex flex-col gap-2 min-w-0';

    const indexHeading = document.createElement('h3');
    indexHeading.className =
        'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] m-0 uppercase tracking-wide';
    indexHeading.textContent = vaultSidebarUiString('vault_config_index_heading');

    const indexHint = document.createElement('p');
    indexHint.className = 'text-[0.75rem] fg-[var(--grid-caption)] m-0 leading-snug';
    indexHint.textContent = vaultSidebarUiString('vault_config_index_hint');

    const cbClass =
        'w-4 h-4 shrink-0 mt-0.5 rounded-[4px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel)] accent-[var(--grid-accent)] cursor-pointer';

    const autoRow = document.createElement('label');
    autoRow.className = 'flex items-start gap-2 cursor-pointer select-none';
    const autoCb = document.createElement('input');
    autoCb.type = 'checkbox';
    autoCb.checked = Number(vaultNode.is_enabled ?? 1) === 1;
    autoCb.className = cbClass;
    autoCb.setAttribute('aria-label', vaultSidebarUiString('vault_auto_index_aria'));
    const autoLab = document.createElement('span');
    autoLab.className = 'text-[0.8125rem] fg-[var(--grid-ink)] leading-snug';
    autoLab.textContent = vaultSidebarUiString('vault_auto_index_label');
    autoRow.append(autoCb, autoLab);

    const graphRow = document.createElement('label');
    graphRow.className = 'flex items-start gap-2 cursor-pointer select-none';
    const graphCb = document.createElement('input');
    graphCb.type = 'checkbox';
    graphCb.checked = Number(vaultNode.graph_mode ?? 0) !== 0;
    graphCb.className = cbClass;
    graphCb.setAttribute('aria-label', vaultSidebarUiString('vault_graph_chain_aria'));
    const graphLab = document.createElement('span');
    graphLab.className = 'text-[0.8125rem] fg-[var(--grid-ink)] leading-snug';
    graphLab.textContent = vaultSidebarUiString('vault_graph_chain_label');
    graphRow.append(graphCb, graphLab);

    indexSec.append(indexHeading, indexHint, autoRow, graphRow);

    const glossarySec = document.createElement('section');
    glossarySec.className = 'flex flex-col gap-2 min-w-0';

    const glossaryHeading = document.createElement('h3');
    glossaryHeading.className =
        'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] m-0 uppercase tracking-wide';
    glossaryHeading.textContent = vaultSidebarUiString('vault_config_glossary_heading');

    const glossaryHint = document.createElement('p');
    glossaryHint.className = 'text-[0.75rem] fg-[var(--grid-caption)] m-0 leading-snug';
    glossaryHint.textContent = vaultSidebarUiString('vault_config_glossary_hint');

    const glossaryTa = document.createElement('textarea');
    glossaryTa.className =
        'w-full min-h-[120px] rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel)] px-2 py-2 text-[0.75rem] font-mono fg-[var(--grid-ink)] resize-y';
    glossaryTa.spellcheck = false;
    glossaryTa.setAttribute('aria-label', vaultSidebarUiString('vault_config_glossary_heading'));
    glossaryTa.value = '{\n  "terms": []\n}';

    const glossaryBtnRow = document.createElement('div');
    glossaryBtnRow.className = 'flex flex-row flex-wrap gap-2';

    const glossarySaveBtn = document.createElement('button');
    glossarySaveBtn.type = 'button';
    glossarySaveBtn.className =
        'rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-panel-bright)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 disabled:opacity-50';
    glossarySaveBtn.textContent = vaultSidebarUiString('vault_config_glossary_save');

    const glossaryImportBtn = document.createElement('button');
    glossaryImportBtn.type = 'button';
    glossaryImportBtn.className =
        'rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-accent)]/35 cursor-pointer font-inherit hover:bg-[var(--grid-accent)]/8 disabled:opacity-50';
    glossaryImportBtn.textContent = vaultSidebarUiString('vault_config_glossary_import');

    glossaryBtnRow.append(glossarySaveBtn, glossaryImportBtn);
    glossarySec.append(glossaryHeading, glossaryHint, glossaryTa, glossaryBtnRow);

    void (async () => {
        try {
            const wid = getOaaoActiveWorkspaceIdForVault();
            const qs = new URLSearchParams({ vault_id: String(vid) });
            if (wid != null) qs.set('workspace_id', String(wid));
            const res = await fetch(`${vaultApiBase()}glossary?${qs}`, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
                signal,
            });
            const j = await res.json().catch(() => ({}));
            if (signal?.aborted) return;
            if (j.success && j.data?.glossary) {
                glossaryTa.value = JSON.stringify(j.data.glossary, null, 2);
            }
        } catch {
            /* keep default */
        }
    })();

    glossarySaveBtn.addEventListener('click', () => {
        void (async () => {
            glossarySaveBtn.disabled = true;
            try {
                let parsed;
                try {
                    parsed = JSON.parse(glossaryTa.value);
                } catch {
                    const Toast = await loadVaultToastCtor();
                    Toast?.error('Invalid JSON', { duration: 4000, position: 'bottom-right' });

                    return;
                }
                /** @type {{ success?: boolean }} */
                const j = await vaultPostJson(
                    'glossary',
                    { vault_id: vid, glossary: parsed },
                    signal ?? new AbortController().signal,
                );
                if (!j.success || signal?.aborted) return;
                const Toast = await loadVaultToastCtor();
                Toast?.success(vaultSidebarUiString('vault_config_glossary_saved'), {
                    duration: 3200,
                    position: 'bottom-right',
                });
            } finally {
                if (!signal?.aborted) glossarySaveBtn.disabled = false;
            }
        })();
    });

    glossaryImportBtn.addEventListener('click', () => {
        void (async () => {
            glossaryImportBtn.disabled = true;
            try {
                /** @type {{ success?: boolean, data?: { glossary?: unknown } }} */
                const j = await vaultPostJson(
                    'glossary_import',
                    { vault_id: vid },
                    signal ?? new AbortController().signal,
                );
                if (!j.success || signal?.aborted) return;
                if (j.data?.glossary) {
                    glossaryTa.value = JSON.stringify(j.data.glossary, null, 2);
                }
                const Toast = await loadVaultToastCtor();
                Toast?.success(vaultSidebarUiString('vault_config_glossary_import_ok'), {
                    duration: 3600,
                    position: 'bottom-right',
                });
            } finally {
                if (!signal?.aborted) glossaryImportBtn.disabled = false;
            }
        })();
    });

    const dangerSec = document.createElement('section');
    dangerSec.className =
        'flex flex-col gap-2 min-w-0 rounded-[8px] border-[1px] border-solid border-[var(--grid-danger,#e5484d)]/35 bg-[var(--grid-danger,#e5484d)]/6 p-3';

    const dangerHeading = document.createElement('h3');
    dangerHeading.className =
        'text-[0.8125rem] fw-semibold fg-[var(--grid-danger,#c62828)] m-0 uppercase tracking-wide';
    dangerHeading.textContent = vaultSidebarUiString('vault_config_danger_heading');

    const dangerHint = document.createElement('p');
    dangerHint.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)] m-0 leading-snug';
    dangerHint.textContent = vaultSidebarUiString('vault_config_danger_hint');

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className =
        'self-start rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-white bg-[var(--grid-danger,#e5484d)] border-none cursor-pointer font-inherit hover:opacity-90 disabled:opacity-50';
    deleteBtn.textContent = vaultSidebarUiString('vault_config_delete_btn');

    dangerSec.append(dangerHeading, dangerHint, deleteBtn);
    wrap.append(indexSec, glossarySec, dangerSec);

    /** @type {{ close?: () => void } | null} */
    let dlg = null;

    const wireToggle = (
        /** @type {HTMLInputElement} */ cb,
        /** @type {'auto_rag' | 'graph_mode'} */ kind,
    ) => {
        cb.addEventListener('change', () => {
            void (async () => {
                const wantBool = cb.checked;
                cb.disabled = true;
                try {
                    const wid = getOaaoActiveWorkspaceIdForVault();
                    /** @type {Record<string, unknown>} */
                    const payload = { vault_id: vid };
                    if (wid != null) payload.workspace_id = wid;

                    let endpoint = '';
                    if (kind === 'auto_rag') {
                        payload.auto_rag = wantBool;
                        endpoint = 'vault_auto_rag_set';
                    } else {
                        payload.graph_mode = wantBool ? 1 : 0;
                        endpoint = 'vault_graph_mode_set';
                    }

                    /** @type {{ success?: boolean }} */
                    const j = await vaultPostJson(endpoint, payload, signal ?? new AbortController().signal);
                    if (signal?.aborted) return;

                    if (!j.success) {
                        cb.checked = !wantBool;

                        return;
                    }

                    vaultNode.is_enabled = kind === 'auto_rag' ? (wantBool ? 1 : 0) : vaultNode.is_enabled;
                    vaultNode.graph_mode = kind === 'graph_mode' ? (wantBool ? 1 : 0) : vaultNode.graph_mode;
                    await vaultExplorerRefreshTreeRef?.();
                } catch {
                    if (!signal?.aborted) cb.checked = !cb.checked;
                } finally {
                    if (!signal?.aborted) cb.disabled = false;
                }
            })();
        });
    };

    wireToggle(autoCb, 'auto_rag');
    wireToggle(graphCb, 'graph_mode');

    deleteBtn.addEventListener('click', () => {
        void (async () => {
            if (!DialogMod || typeof DialogMod.confirm !== 'function') return;
            deleteBtn.disabled = true;
            try {
                const ok = await DialogMod.confirm(
                    vaultSidebarUiString('vault_config_delete_btn'),
                    vaultSidebarUiString('confirm_delete_vault'),
                );
                if (!ok || signal?.aborted) return;

                /** @type {{ success?: boolean, message?: string }} */
                const j = await vaultPostJson('vault_delete', { vault_id: vid }, signal ?? new AbortController().signal);
                if (!j.success || signal?.aborted) {
                    const Toast = await loadVaultToastCtor();
                    Toast?.error(
                        typeof j.message === 'string' && j.message.trim()
                            ? j.message.trim()
                            : vaultSidebarUiString('op_failed'),
                        { duration: 4600, position: 'bottom-right' },
                    );

                    return;
                }

                dlg?.close?.();
                if (typeof opts.onDeleted === 'function') opts.onDeleted();
                await vaultExplorerRefreshAfterMutation();
            } finally {
                if (!signal?.aborted) deleteBtn.disabled = false;
            }
        })();
    });

    dlg = DialogMod.open({
        title: `${vName} — ${vaultSidebarUiString('vault_config_title')}`,
        content: wrap,
        size: 'sm',
        buttons: [
            {
                text: vaultSidebarUiString('btn_close'),
                color: 'muted',
                action: async () => true,
            },
        ],
    });
}

/** Purpose-key prefix → default enqueue hook ({@see vault.php} + {@code oaaoai/rag} {@code pa-graph}). */
const VAULT_PURPOSE_HOOK_BY_PREFIX = {
    embedding: 'vh.rag.document_embed',
    graph: 'vh.rag.graph_index',
};

/** Module codes that may contribute vault FILE ACTIONS enqueue buttons. */
const VAULT_PURPOSE_ACTION_MODULES = new Set(['oaaoai/vault', 'oaaoai/rag']);

/**
 * Slots contributed by {@code oaaoai/vault} for Settings → Purpose allocation — drive file action buttons.
 *
 * @returns {ReadonlyArray<Record<string, unknown>>}
 */
function readVaultPurposeActionSlots() {
    const raw = globalThis.OAAO_PURPOSE_ALLOCATION_REGISTRY;
    if (!Array.isArray(raw)) return [];

    return raw.filter((row) => {
        if (!row || typeof row !== 'object') return false;
        const mod = /** @type {{ module_code?: string }} */ (row).module_code;
        const pre = /** @type {{ purpose_key_prefix?: string }} */ (row).purpose_key_prefix;

        return (
            typeof mod === 'string' &&
            VAULT_PURPOSE_ACTION_MODULES.has(mod) &&
            typeof pre === 'string' &&
            Boolean(VAULT_PURPOSE_HOOK_BY_PREFIX[pre])
        );
    });
}

const ICON_VAULT =
    '<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[0.875rem] h-[0.875rem] shrink-0 block pointer-events-none fg-[var(--grid-caption)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const ICON_FOLDER =
    '<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[0.875rem] h-[0.875rem] shrink-0 block pointer-events-none fg-[var(--grid-caption)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const ICON_FILE =
    '<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[0.875rem] h-[0.875rem] shrink-0 block pointer-events-none fg-[var(--grid-caption)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4h4"/></svg>';

/**
 * @param {string} kind
 * @returns {string}
 */
function vaultKindIcon(kind) {
    if (kind === 'vault') return ICON_VAULT;
    if (kind === 'container') return ICON_FOLDER;

    return ICON_FILE;
}

/**
 * @param {unknown} v
 */
function escapeVaultHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Circle-i beside row badges — full ingest/graph error via native {@code title} tooltip (no inline snippet).
 *
 * @param {string} detail Trimmed plain-text error code / message from API.
 */
function vaultStatusDetailTooltipIcon(detail) {
    const t = String(detail ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const title = escapeVaultHtml(t);
    const aria = escapeVaultHtml(vaultSidebarUiString('status_detail_tooltip_aria'));
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" class="pointer-events-none block" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

    return `<span class="inline-flex shrink-0 items-center justify-center rounded-full border-[1px] border-solid border-current/35 fg-current opacity-[0.88] hover:opacity-100 cursor-help align-middle leading-none p-[2px]" tabindex="0" role="img" aria-label="${aria}" title="${title}">${svg}</span>`;
}

/**
 * @param {string} embedErrTrimmed
 */
function vaultEmbedErrTitleAttr(embedErrTrimmed) {
    const t = String(embedErrTrimmed ?? '').replace(/\s+/g, ' ').trim();

    return t !== '' ? ` title="${escapeVaultHtml(t)}"` : '';
}

/** Static grip icon (SVG only — safe to embed unescaped). */
function vaultExplorerDragGripSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="block" width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" focusable="false" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.25"/><circle cx="7.5" cy="2.5" r="1.25"/><circle cx="2.5" cy="7" r="1.25"/><circle cx="7.5" cy="7" r="1.25"/><circle cx="2.5" cy="11.5" r="1.25"/><circle cx="7.5" cy="11.5" r="1.25"/></svg>';
}

/**
 * Row drag originates from this grip only — keeps {@code dblclick} on the name cell working ({@see wireVaultExplorerNodeDragDrop}).
 *
 * @param {string} kind
 */
function vaultExplorerDragHandleHtml(kind) {
    if (kind !== 'document' && kind !== 'container') return '';

    const aria = escapeVaultHtml(vaultSidebarUiString('explorer_drag_handle_aria'));

    return `<span data-oaao-vault-drag-handle="1" draggable="false" class="oaao-vault-row-drag-handle inline-flex shrink-0 h-[1.25lh] min-h-[28px] w-6 items-center justify-center rounded-[4px] text-[var(--grid-caption)] cursor-grab select-none hover:bg-[var(--grid-line)]/28 active:cursor-grabbing" aria-label="${aria}" title="${aria}">${vaultExplorerDragGripSvg()}</span>`;
}

/**
 * @param {string} kind
 * @param {string} label
 * @param {string} [pathHint] Legacy depth-first hint — omitted in folder navigation mode (breadcrumb carries path).
 */
function buildVaultExplorerNameHtml(kind, label, pathHint) {
    const escLabel = escapeVaultHtml(label);
    const hint = (pathHint ?? '').trim();
    const grip = vaultExplorerDragHandleHtml(kind);

    if (!hint || hint === '—') {
        return `<div class="flex items-center gap-2 min-w-0">${grip}<span class="inline-flex shrink-0 items-center justify-center">${vaultKindIcon(kind)}</span><span class="min-w-0 flex-1 text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] truncate" title="${escLabel}">${escLabel}</span></div>`;
    }

    const escPath = escapeVaultHtml(hint);

    return `<div class="flex items-start gap-2 min-w-0">${grip}<span class="inline-flex shrink-0 mt-0.5 items-center justify-center">${vaultKindIcon(kind)}</span><span class="min-w-0 flex-1"><span class="block text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] truncate">${escLabel}</span><span class="block text-[0.6875rem] fg-[var(--grid-caption)] truncate">${escPath}</span></span></div>`;
}

/**
 * @param {unknown} byteSize
 */
function formatVaultByteSize(byteSize) {
    const n = byteSize != null ? Number(byteSize) : NaN;
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return `${Math.round(n)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
        v /= 1024;
        u += 1;
    }

    return `${v < 10 && u > 0 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** Short-lived row badges after Run · … enqueue succeeds ({@see renderVaultDetailPanel}). */
/** @type {Map<number, string>} */
const vaultTransientDocBadges = new Map();

/** Full tree from last successful {@link fetchVaultTreeJson}. */
/** @type {unknown[]} */
let vaultExplorerTreeCache = [];

/** Folder navigation — {@code vaultId:null} = vault list root. */
/** @type {{ vaultId: number | null, containerId: number | null }} */
let vaultExplorerNav = { vaultId: null, containerId: null };

/** Applied on next {@link mountVaultExplorer} after create-folder / external navigation hints. */
/** @type {{ vaultId: number | null, containerId: number | null } | null} */
let vaultExplorerPendingNav = null;

/** Root gallery: last card selected for upload scope + highlight ({@see paintVaultGallery}). */
/** @type {number | null} */
let vaultGallerySelectedVaultId = null;

/** Light refresh for ingest polling / post-upload list update — fetch + {@link ResourceList#setData} without remounting. */
/** @type {((opts?: { focusUpload?: { vaultId: number, containerId: number | null } | null }) => Promise<void>) | null} */
let vaultExplorerListRefreshRef = null;

/** @deprecated alias — same handler as {@link vaultExplorerListRefreshRef} */
let vaultExplorerEmbedPollRefreshRef = null;

/** Document id currently rendered in right-hand detail ({@see renderVaultDetailPanel}); refreshed after embed poll. */
/** @type {number | null} */
let vaultDetailOpenDocId = null;

/** Wired while Vault shell panel is mounted — refreshes tree after vault-level toggles ({@see paintVaultGallery}). */
/** @type {(() => Promise<void>) | null} */
let vaultExplorerRefreshTreeRef = null;

/** Recreates explorer table + breadcrumb ({@see paintVaultExplorer}). */
let vaultExplorerRedraw = () => {};

/** MIME for internal explorer row drag (move folder / file). */
const VAULT_NODE_DRAG_MIME = 'application/x-oaao-vault-node';

/**
 * @param {Record<string, unknown>} node
 * @returns {{ kind: 'vault'|'folder'|'document', id: number, vault_id: number, name: string } | null}
 */
function vaultNodeToChatSourceRef(node) {
    if (!node || typeof node !== 'object') return null;
    const kind = typeof node.kind === 'string' ? node.kind : '';
    if (kind === 'vault') {
        const vid = typeof node.id === 'number' ? node.id : Math.floor(Number(node.id ?? 0));
        if (!Number.isFinite(vid) || vid < 1) return null;
        const name = String(node.name ?? '').trim() || `Vault #${vid}`;

        return { kind: 'vault', id: vid, vault_id: vid, name };
    }
    if (kind === 'container') {
        const cid = typeof node.id === 'number' ? node.id : Math.floor(Number(node.id ?? 0));
        const vid = typeof node.vault_id === 'number' ? node.vault_id : Math.floor(Number(node.vault_id ?? 0));
        if (!Number.isFinite(vid) || vid < 1 || !Number.isFinite(cid) || cid < 1) return null;
        const name = String(node.name ?? '').trim() || `Folder #${cid}`;

        return { kind: 'folder', id: cid, vault_id: vid, name };
    }
    if (kind === 'document') {
        if (String(node.embed_status ?? '') !== 'embedded') return null;
        const did = typeof node.id === 'number' ? node.id : Math.floor(Number(node.id ?? 0));
        const vid = typeof node.vault_id === 'number' ? node.vault_id : Math.floor(Number(node.vault_id ?? 0));
        if (!Number.isFinite(did) || did < 1 || !Number.isFinite(vid) || vid < 1) return null;
        const name = String(node.file_name ?? '').trim() || `Document #${did}`;

        return { kind: 'document', id: did, vault_id: vid, name };
    }

    return null;
}

/**
 * @param {Array<{ kind: 'vault'|'folder'|'document', id: number, vault_id: number, name: string }>} refs
 */
function vaultPublishChatSourceRefs(refs) {
    try {
        sessionStorage.setItem(
            'oaao_vault_chat_source_refs',
            JSON.stringify(refs.slice(0, 24)),
        );
    } catch {
        /* ignore */
    }
    document.dispatchEvent(
        new CustomEvent('oaao:vault-chat-sources-changed', {
            bubbles: true,
            detail: { refs: refs.slice(0, 24) },
        }),
    );
}

/**
 * @param {string[]} selectedKeys
 * @param {Map<string, Record<string, unknown>>} rowNodeByKey
 */
function vaultSyncChatSourcesFromRowKeys(selectedKeys, rowNodeByKey) {
    /** @type {Array<{ kind: 'vault'|'folder'|'document', id: number, vault_id: number, name: string }>} */
    const refs = [];
    const seen = new Set();
    for (const key of selectedKeys) {
        const node = rowNodeByKey.get(String(key));
        if (!node) continue;
        const ref = vaultNodeToChatSourceRef(node);
        if (!ref) continue;
        const fp = `${ref.kind}:${ref.id}@${ref.vault_id}`;
        if (seen.has(fp)) continue;
        seen.add(fp);
        refs.push(ref);
    }
    vaultPublishChatSourceRefs(refs);
}

/** Payload for active internal row-drag (fallback when {@code dataTransfer.getData} is empty during drag-over). */
/** @type {{ kind: string, id: number, vault_id: number } | null} */
let vaultNodeDragPayload = null;

/** @type {Map<string, Record<string, unknown>>} */
let vaultExplorerLatestRowKeys = new Map();

/** Wired by {@link mountVaultExplorer} — breadcrumb / detail panel navigation. */
/** @type {(next: { vaultId: number | null, containerId: number | null }) => void} */
let vaultExplorerNavigateRef = () => {};

/** Breadcrumb targets accept drops ({@see mountVaultExplorer}). */
/** @type {((navHost: HTMLElement) => void) | null} */
let vaultBreadcrumbDnDWire = null;

/**
 * POST JSON helper for Vault workspace APIs ({@code workspace_id} injected from shell scope).
 *
 * @param {string} endpoint lazy name without slash, e.g. {@code document_move}
 * @param {Record<string, unknown>} payload
 * @param {AbortSignal} signal
 */
async function vaultPostJson(endpoint, payload, signal) {
    const wid = getOaaoActiveWorkspaceIdForVault();
    /** @type {Record<string, unknown>} */
    const body = { ...payload };
    if (wid != null) body.workspace_id = wid;

    const res = await fetch(`${vaultApiBase()}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal,
    });

    return /** @type {{ success?: boolean, message?: string }} */ (await res.json().catch(() => ({})));
}

/** @returns {Promise<unknown>} */
async function vaultLoadDialogCtor() {
    try {
        const Dialog = await razyui.load('Dialog');

        return typeof Dialog === 'function' ? Dialog : null;
    } catch {
        return null;
    }
}

const VAULT_DETAIL_BTN_CLASS =
    'w-full rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 text-left disabled:opacity-50 disabled:cursor-not-allowed';

const VAULT_DETAIL_ACCENT_BTN_CLASS =
    'w-full rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-panel-bright)] border-[1px] border-solid border-[var(--grid-accent)]/35 cursor-pointer font-inherit hover:bg-[var(--grid-accent)]/8 text-left disabled:opacity-50 disabled:cursor-not-allowed';

const VAULT_DETAIL_ICON_BTN_CLASS =
    'inline-flex shrink-0 items-center justify-center w-9 h-9 rounded-[8px] fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer hover:bg-[var(--grid-line)]/25 disabled:opacity-50 disabled:cursor-not-allowed';

/** @param {string} label @param {string} paths */
function vaultDetailIconSvg(label, paths) {
    return `<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-4 h-4 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg><span class="sr-only">${escapeVaultHtml(label)}</span>`;
}

/** @param {string} label @param {string} paths @returns {HTMLButtonElement} */
function vaultMkDetailIconBtn(label, paths) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = VAULT_DETAIL_ICON_BTN_CLASS;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = vaultDetailIconSvg(label, paths);

    return b;
}

/** @param {HTMLElement[]} buttons @returns {HTMLDivElement} */
function vaultMkDetailIconRow(buttons) {
    const row = document.createElement('div');
    row.className = 'oaao-vault-btn-row w-full';
    row.append(...buttons);

    return row;
}

const VAULT_ICON_RENAME = '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>';
const VAULT_ICON_DELETE =
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>';
const VAULT_ICON_MOVE =
    '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>';

/** @type {Map<number, { count?: number, full?: Record<string, unknown> }>} */
const vaultEmbedChunksCache = new Map();

/**
 * @param {string} key
 * @param {Record<string, string>} vars
 */
function vaultSidebarUiFormat(key, vars = {}) {
    let s = vaultSidebarUiString(key);
    for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }

    return s;
}

/** @param {string} scope */
function vaultEmbedSegmentScopeLabel(scope) {
    const map = {
        pdf_page: 'embed_scope_pdf_page',
        md_section: 'embed_scope_md_section',
        docx_flow: 'embed_scope_docx_flow',
        docx_table: 'embed_scope_docx_table',
        xlsx_sheet: 'embed_scope_xlsx_sheet',
        pptx_slide: 'embed_scope_pptx_slide',
        plain: 'embed_scope_plain',
        transcript_summary: 'embed_scope_transcript_summary',
    };
    const k = map[scope.trim().toLowerCase()];

    return k ? vaultSidebarUiString(k) : scope.trim() || '—';
}

/**
 * @param {number} docId
 * @param {{ countOnly?: boolean, signal?: AbortSignal }} [opts]
 */
async function vaultFetchEmbedChunks(docId, opts = {}) {
    const wid = getOaaoActiveWorkspaceIdForVault();
    const q = new URLSearchParams({ document_id: String(docId) });
    if (wid != null) q.set('workspace_id', String(wid));
    if (opts.countOnly) q.set('count_only', '1');

    const res = await fetch(`${vaultApiBase()}document_embed_chunks?${q.toString()}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: opts.signal,
    });

    return res.json().catch(() => ({}));
}

/** @param {number | null | undefined} count */
function vaultEmbedChunksButtonLabel(count) {
    if (count == null || !Number.isFinite(count)) {
        return vaultSidebarUiString('embed_chunks_btn_loading');
    }

    return vaultSidebarUiFormat('embed_chunks_btn_count', { n: String(Math.max(0, Math.floor(count))) });
}

/**
 * @param {Record<string, unknown>} data
 * @returns {HTMLElement}
 */
function vaultBuildEmbedChunksDialogContent(data) {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-3 min-h-0 max-h-[min(68vh,640px)]';

    const summary = document.createElement('p');
    summary.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0 leading-snug';
    summary.textContent = vaultSidebarUiFormat('embed_chunks_dialog_summary', {
        name: String(data.file_name ?? ''),
        n: String(data.chunk_count ?? 0),
        collection: String(data.collection ?? '—'),
    });
    wrap.append(summary);

    const chunks = Array.isArray(data.chunks) ? data.chunks : [];
    if (chunks.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0';
        empty.textContent = vaultSidebarUiString('embed_chunks_dialog_empty');
        wrap.append(empty);

        return wrap;
    }

    const list = document.createElement('div');
    list.className =
        'flex flex-col gap-2 min-h-0 overflow-y-auto overscroll-contain pr-1 [-webkit-overflow-scrolling:touch]';

    for (const raw of chunks) {
        const ch = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : {});
        const idx = typeof ch.chunk_index === 'number' ? ch.chunk_index : Math.floor(Number(ch.chunk_index ?? 0));
        const scope = typeof ch.segment_scope === 'string' ? ch.segment_scope : '';
        const label = typeof ch.segment_label === 'string' ? ch.segment_label.trim() : '';
        const charCount =
            typeof ch.char_count === 'number' ? ch.char_count : Math.floor(Number(ch.char_count ?? 0));
        const text = typeof ch.text === 'string' ? ch.text : '';

        /** @type {string[]} */
        const metaBits = [vaultSidebarUiFormat('embed_chunks_index', { n: String(idx + 1) })];
        if (scope) metaBits.push(vaultEmbedSegmentScopeLabel(scope));
        if (label) metaBits.push(label);
        if (ch.page != null && ch.page !== '') metaBits.push(`p.${ch.page}`);
        if (ch.sheet != null && ch.sheet !== '') metaBits.push(String(ch.sheet));
        if (ch.slide != null && ch.slide !== '') metaBits.push(`#${ch.slide}`);
        if (Number.isFinite(charCount) && charCount > 0) {
            metaBits.push(vaultSidebarUiFormat('embed_chunks_chars', { n: String(charCount) }));
        }
        if (ch.ocr === true || ch.ocr === 1 || ch.ocr === '1') {
            metaBits.push(vaultSidebarUiString('embed_chunks_ocr'));
        }

        const det = document.createElement('details');
        det.className =
            'rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-2.5 py-2';

        const sum = document.createElement('summary');
        sum.className =
            'cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[0.75rem] fw-semibold fg-[var(--grid-ink)] leading-snug';
        sum.textContent = metaBits.join(' · ');

        const body = document.createElement('pre');
        body.className =
            'mt-2 mb-0 text-[0.6875rem] fg-[var(--grid-ink-muted)] whitespace-pre-wrap break-words font-inherit leading-relaxed max-h-[240px] overflow-y-auto overscroll-contain';
        body.textContent = text;

        det.append(sum, body);
        list.append(det);
    }

    wrap.append(list);

    return wrap;
}

/**
 * @param {string} fileName
 * @param {Record<string, unknown>} data
 */
async function vaultOpenEmbedChunksDialog(fileName, data) {
    const DialogMod = await vaultLoadDialogCtor();
    if (!DialogMod || typeof DialogMod.open !== 'function') return;

    DialogMod.open({
        title: vaultSidebarUiString('embed_chunks_dialog_title'),
        content: vaultBuildEmbedChunksDialogContent(data),
        size: 'md',
        buttons: [
            {
                text: vaultSidebarUiString('btn_close'),
                color: 'accent',
                action: async () => true,
            },
        ],
    });
}

/**
 * @param {number} docId
 * @param {AbortSignal} signal
 */
async function vaultFetchDocumentTranscript(docId, signal) {
    const wid = getOaaoActiveWorkspaceIdForVault();
    let url = `${vaultApiBase()}document_transcript?document_id=${encodeURIComponent(String(docId))}`;
    if (wid != null) url += `&workspace_id=${encodeURIComponent(String(wid))}`;
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' }, signal });
    /** @type {{ success?: boolean, message?: string, data?: Record<string, unknown> }} */
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
}

/**
 * Wide three-column transcript shell (~80% viewport).
 *
 * @param {{ dialog?: HTMLElement, body?: HTMLElement } | null | undefined} ctrl
 */
function vaultApplyTranscriptDialogLayout(ctrl) {
    const box = ctrl?.dialog;
    const body = ctrl?.body;
    if (box instanceof HTMLElement) {
        box.style.width = 'min(80vw, 120rem)';
        box.style.maxWidth = 'min(80vw, 120rem)';
    }
    if (body instanceof HTMLElement) {
        body.style.padding = '0.75rem';
        body.classList.add('flex', 'flex-col', 'flex-1', 'min-h-0', 'overflow-hidden');
    }
}

/**
 * Open transcript viewer from chat RAG citations or vault detail.
 *
 * @param {Record<string, unknown>} docNode
 * @param {AbortSignal} signal
 * @param {{ initialBeginMs?: number }} [opts]
 */
async function vaultOpenTranscriptDialog(docNode, signal, opts = {}) {
    const DialogMod = await vaultLoadDialogCtor();
    if (!DialogMod || typeof DialogMod.open !== 'function') return;

    const docId = typeof docNode.id === 'number' ? docNode.id : Math.floor(Number(docNode.id ?? 0));
    if (!Number.isFinite(docId) || docId < 1) return;

    const fileName = String(docNode.file_name ?? '').trim() || `Document #${docId}`;
    const wid = getOaaoActiveWorkspaceIdForVault();

    /** @type {HTMLElement} */
    const loadingHost = document.createElement('div');
    oaaoMountLoadingLogo(loadingHost, {
        block: true,
        label: vaultSidebarUiString('transcript_btn_loading'),
    });

    const dlg = DialogMod.open({
        title: `${vaultSidebarUiString('transcript_dialog_title')} · ${fileName}`,
        content: loadingHost,
        size: 'xl',
        height: 'min(82vh, calc(100vh - 3rem))',
        onOpen(ctrl) {
            vaultApplyTranscriptDialogLayout(ctrl);
        },
        buttons: [
            {
                text: vaultSidebarUiString('btn_close'),
                color: 'accent',
                action: async () => true,
            },
        ],
    });

    try {
        const { ok, status, json } = await vaultFetchDocumentTranscript(docId, signal);
        if (signal.aborted) return;

        if (!ok || json.success !== true || !json.data || typeof json.data !== 'object') {
            loadingHost.replaceChildren();
            const err = document.createElement('p');
            err.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0';
            err.textContent =
                status === 409
                    ? vaultSidebarUiString('transcript_unavailable')
                    : typeof json.message === 'string' && json.message.trim()
                      ? json.message.trim()
                      : vaultSidebarUiString('transcript_load_fail');
            loadingHost.append(err);
            return;
        }

        const mod = await loadVaultTranscriptMod();
        const mountFn = mod.mountTranscriptView ?? mod.default?.mountTranscriptView;
        if (typeof mountFn !== 'function') {
            loadingHost.replaceChildren();
            const err = document.createElement('p');
            err.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0';
            err.textContent = vaultSidebarUiString('transcript_load_fail');
            loadingHost.append(err);
            return;
        }

        const view = mountFn(json.data, {
            apiBase: vaultApiBase(),
            signal,
            documentId: docId,
            workspaceId: wid,
            initialBeginMs: Math.max(0, Math.floor(Number(opts.initialBeginMs) || 0)),
            loadDialog: vaultLoadDialogCtor,
            onRetranscribe:
                String(json.data.mode ?? 'normal').trim().toLowerCase() !== 'speaker'
                    ? () =>
                          vaultEnqueueDocumentRetranscribe(docId, signal, {
                              onSuccess: () => {
                                  if (dlg && typeof dlg.close === 'function') dlg.close();
                                  else if (typeof dlg?.destroy === 'function') dlg.destroy();
                              },
                          })
                    : undefined,
        });
        const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
        if (JIT && typeof JIT.hydrate === 'function') JIT.hydrate(view);
        if (dlg && typeof dlg.setContent === 'function') {
            dlg.setContent(view);
            vaultApplyTranscriptDialogLayout({
                dialog: view.closest('.dialog-box') ?? undefined,
                body: view.closest('.dialog-body') ?? undefined,
            });
        } else if (loadingHost.parentElement) {
            loadingHost.replaceWith(view);
        }
    } catch (e) {
        if (!signal.aborted) {
            loadingHost.replaceChildren();
            const err = document.createElement('p');
            err.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0';
            err.textContent = vaultSidebarUiString('transcript_load_fail');
            loadingHost.append(err);
            console.warn('[oaao vault] document_transcript failed', e);
        }
    }
}

/**
 * @param {number} docId
 * @param {AbortSignal} signal
 */
async function vaultFetchDocumentText(docId, signal) {
    const wid = getOaaoActiveWorkspaceIdForVault();
    let url = `${vaultApiBase()}document_text?document_id=${encodeURIComponent(String(docId))}`;
    if (wid != null) url += `&workspace_id=${encodeURIComponent(String(wid))}`;
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' }, signal });
    /** @type {{ success?: boolean, message?: string, data?: Record<string, unknown> }} */
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
}

/**
 * @param {HTMLElement} out
 * @param {string} text
 */
function vaultRenderPlainTextPreview(out, text) {
    out.classList.remove('oaao-md-bubble');
    out.innerHTML = '';
    out.textContent = text;
    out.style.whiteSpace = 'pre-wrap';
}

/**
 * @param {Record<string, unknown>} docNode
 * @param {AbortSignal} signal
 */
async function vaultOpenTextPreviewDialog(docNode, signal) {
    const DialogMod = await vaultLoadDialogCtor();
    if (!DialogMod || typeof DialogMod.open !== 'function') return;

    const docId = typeof docNode.id === 'number' ? docNode.id : Math.floor(Number(docNode.id ?? 0));
    if (!Number.isFinite(docId) || docId < 1) return;

    const fileName = String(docNode.file_name ?? '').trim() || `Document #${docId}`;

    /** @type {HTMLElement} */
    const loadingHost = document.createElement('div');
    oaaoMountLoadingLogo(loadingHost, {
        block: true,
        label: vaultSidebarUiString('preview_btn_loading'),
    });

    DialogMod.open({
        title: `${vaultSidebarUiString('preview_dialog_title')} · ${fileName}`,
        content: loadingHost,
        size: 'xl',
        height: 'min(82vh, calc(100vh - 3rem))',
        onOpen(ctrl) {
            vaultApplyTranscriptDialogLayout(ctrl);
        },
        buttons: [
            {
                text: vaultSidebarUiString('btn_close'),
                color: 'accent',
                action: async () => true,
            },
        ],
    });

    try {
        const { ok, json } = await vaultFetchDocumentText(docId, signal);
        if (signal.aborted) return;

        loadingHost.replaceChildren();

        if (!ok || json.success !== true || !json.data || typeof json.data !== 'object') {
            const err = document.createElement('p');
            err.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0';
            err.textContent =
                typeof json.message === 'string' && json.message.trim()
                    ? json.message.trim()
                    : vaultSidebarUiString('preview_load_fail');
            loadingHost.append(err);
            return;
        }

        const data = /** @type {Record<string, unknown>} */ (json.data);
        const content = typeof data.content === 'string' ? data.content : '';
        const isMarkdown = data.is_markdown === true;
        const truncated = data.truncated === true;

        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col flex-1 min-h-0 gap-2 overflow-hidden';

        if (truncated) {
            const hint = document.createElement('p');
            hint.className = 'text-[0.72rem] fg-[var(--grid-caption)] m-0 shrink-0';
            hint.textContent = vaultSidebarUiString('preview_truncated_hint');
            wrap.append(hint);
        }

        const scroll = document.createElement('div');
        scroll.className =
            'flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-3 py-2.5 text-[0.8125rem] leading-relaxed fg-[var(--grid-ink)]';

        if (!content.trim()) {
            scroll.textContent = vaultSidebarUiString('preview_empty');
            scroll.classList.add('fg-[var(--grid-caption)]', 'italic');
        } else if (isMarkdown) {
            const mod = await loadVaultTranscriptMod();
            if (signal.aborted) return;
            mod.renderSummaryOutput(scroll, { markdown: content });
        } else {
            vaultRenderPlainTextPreview(scroll, content);
        }

        wrap.append(scroll);
        loadingHost.append(wrap);
    } catch (e) {
        if (!signal.aborted) {
            loadingHost.replaceChildren();
            const err = document.createElement('p');
            err.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0';
            err.textContent = vaultSidebarUiString('preview_load_fail');
            loadingHost.append(err);
            console.warn('[oaao vault] document_text failed', e);
        }
    }
}

/**
 * @param {Record<string, unknown>} docNode
 * @param {AbortSignal} signal
 * @returns {HTMLButtonElement | null}
 */
function vaultCreateTextPreviewButton(docNode, signal) {
    if (!vaultIsTextPreviewDocument(docNode)) return null;

    const docId = typeof docNode.id === 'number' ? docNode.id : Math.floor(Number(docNode.id ?? 0));
    if (!Number.isFinite(docId) || docId < 1) return null;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = VAULT_DETAIL_ACCENT_BTN_CLASS;
    btn.textContent = vaultSidebarUiString('preview_btn');
    btn.addEventListener(
        'click',
        () => {
            btn.disabled = true;
            void vaultOpenTextPreviewDialog(docNode, signal).finally(() => {
                if (!signal.aborted && btn.isConnected) btn.disabled = false;
            });
        },
        { signal },
    );

    return btn;
}

/**
 * @param {Record<string, unknown>} docNode
 * @param {AbortSignal} signal
 * @returns {HTMLButtonElement | null}
 */
function vaultCreateTranscriptButton(docNode, signal) {
    if (!vaultIsAudioDocument(docNode)) return null;

    const docId = typeof docNode.id === 'number' ? docNode.id : Math.floor(Number(docNode.id ?? 0));
    if (!Number.isFinite(docId) || docId < 1) return null;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = VAULT_DETAIL_ACCENT_BTN_CLASS;
    btn.textContent = vaultSidebarUiString('transcript_btn');
    btn.addEventListener(
        'click',
        () => {
            btn.disabled = true;
            void vaultOpenTranscriptDialog(docNode, signal).finally(() => {
                if (!signal.aborted && btn.isConnected) btn.disabled = false;
            });
        },
        { signal },
    );

    return btn;
}

/**
 * @param {Record<string, unknown>} docNode
 * @param {AbortSignal} signal
 * @param {HTMLElement | null} jobNote
 * @param {HTMLElement} mount
 * @returns {HTMLButtonElement | null}
 */
function vaultCreateRetranscribeButton(docNode, signal, jobNote, mount) {
    if (!vaultIsAudioDocument(docNode)) return null;
    if (!vaultDocumentHasTranscript(docNode)) return null;

    const docId = typeof docNode.id === 'number' ? docNode.id : Math.floor(Number(docNode.id ?? 0));
    if (!Number.isFinite(docId) || docId < 1) return null;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = VAULT_DETAIL_BTN_CLASS;
    btn.textContent = vaultSidebarUiString('action_retranscribe');
    btn.addEventListener(
        'click',
        () => {
            void vaultEnqueueDocumentRetranscribe(docId, signal, {
                jobNote,
                loadingBtn: btn,
                onSuccess: () => {
                    const fresh = vaultFindDocumentNodeById(vaultExplorerTreeCache, docId);
                    if (fresh) renderVaultDetailPanel(fresh, mount, signal);
                },
            });
        },
        { signal },
    );

    return btn;
}

/**
 * @param {Record<string, unknown>} docNode
 * @param {AbortSignal} signal
 * @returns {HTMLButtonElement | null}
 */
function vaultCreateEmbedDetailButton(docNode, signal) {
    const emb = typeof docNode.embed_status === 'string' ? docNode.embed_status.trim().toLowerCase() : '';
    if (emb !== 'embedded') {
        const docId =
            typeof docNode.id === 'number' ? docNode.id : Math.floor(Number(docNode.id ?? 0));
        if (Number.isFinite(docId) && docId > 0) vaultEmbedChunksCache.delete(docId);

        return null;
    }

    const docId = typeof docNode.id === 'number' ? docNode.id : Math.floor(Number(docNode.id ?? 0));
    if (!Number.isFinite(docId) || docId < 1) return null;

    const fileName = String(docNode.file_name ?? '').trim() || `Document #${docId}`;
    const cached = vaultEmbedChunksCache.get(docId);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = VAULT_DETAIL_ACCENT_BTN_CLASS;
    btn.textContent = vaultEmbedChunksButtonLabel(cached?.count);

    const applyCount = (count) => {
        if (signal.aborted) return;
        btn.textContent = vaultEmbedChunksButtonLabel(count);
        btn.disabled = false;
    };

    if (cached?.count != null) {
        applyCount(cached.count);
    } else {
        btn.disabled = true;
        void (async () => {
            try {
                const json = await vaultFetchEmbedChunks(docId, { countOnly: true, signal });
                if (signal.aborted) return;
                if (json?.success === true && json.data && typeof json.data === 'object') {
                    const n = Math.floor(Number(/** @type {{ chunk_count?: number }} */ (json.data).chunk_count ?? 0));
                    const prev = vaultEmbedChunksCache.get(docId) ?? {};
                    vaultEmbedChunksCache.set(docId, { ...prev, count: n });
                    applyCount(n);
                } else {
                    btn.textContent = vaultSidebarUiString('embed_chunks_btn');
                    btn.disabled = false;
                }
            } catch {
                if (!signal.aborted) {
                    btn.textContent = vaultSidebarUiString('embed_chunks_btn');
                    btn.disabled = false;
                }
            }
        })();
    }

    btn.addEventListener(
        'click',
        () => {
            void (async () => {
                btn.disabled = true;
                try {
                    const live = vaultEmbedChunksCache.get(docId);
                    let data = live?.full;
                    if (!data || !Array.isArray(data.chunks)) {
                        const json = await vaultFetchEmbedChunks(docId, { signal });
                        if (json?.success !== true || !json.data || typeof json.data !== 'object') {
                            const DialogMod = await vaultLoadDialogCtor();
                            const apiMsg =
                                typeof json?.message === 'string' && json.message.trim()
                                    ? json.message.trim()
                                    : vaultSidebarUiString('embed_chunks_dialog_load_fail');
                            if (DialogMod && typeof DialogMod.alert === 'function') {
                                await DialogMod.alert(vaultSidebarUiString('embed_chunks_dialog_title'), apiMsg);
                            }

                            return;
                        }
                        data = /** @type {Record<string, unknown>} */ (json.data);
                        const prev = vaultEmbedChunksCache.get(docId) ?? {};
                        vaultEmbedChunksCache.set(docId, {
                            ...prev,
                            count: Math.floor(Number(data.chunk_count ?? 0)),
                            full: data,
                        });
                    }
                    await vaultOpenEmbedChunksDialog(fileName, data);
                } finally {
                    if (!signal.aborted) btn.disabled = false;
                }
            })();
        },
        { signal },
    );

    return btn;
}

/**
 * @param {unknown[]} tree
 * @param {number} vaultId
 * @returns {Record<string, unknown> | undefined}
 */
function vaultFindVaultNode(tree, vaultId) {
    const arr = Array.isArray(tree) ? tree : [];
    for (const raw of arr) {
        const n = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : null);
        if (!n || n.kind !== 'vault') continue;
        const id = typeof n.id === 'number' ? n.id : Math.floor(Number(n.id ?? NaN));
        if (id === vaultId) return n;
    }

    return undefined;
}

/**
 * @param {unknown} node
 * @param {number} containerId
 * @returns {Record<string, unknown> | undefined}
 */
function vaultFindContainerDeep(node, containerId) {
    if (!node || typeof node !== 'object') return undefined;
    const n = /** @type {Record<string, unknown>} */ (node);

    if (n.kind === 'container') {
        const id = typeof n.id === 'number' ? n.id : Math.floor(Number(n.id ?? NaN));
        if (Number.isFinite(id) && id === containerId) return n;
    }

    /** Vault roots and intermediates expose `children`; walk the tree so folders nested under `vault` are found. */
    const kids = Array.isArray(n.children) ? n.children : [];
    for (const k of kids) {
        const hit = vaultFindContainerDeep(k, containerId);
        if (hit) return hit;
    }

    return undefined;
}

/**
 * @param {Record<string, unknown>} containerNode
 * @returns {Set<number>}
 */
function vaultCollectDescendantContainerIds(containerNode) {
    const out = new Set();
    /** @param {Record<string, unknown>} n */
    const walk = (n) => {
        const idRaw = n.id;
        const idNum = typeof idRaw === 'number' ? idRaw : Math.floor(Number(idRaw ?? NaN));
        if (Number.isFinite(idNum) && idNum > 0) out.add(idNum);
        const kids = Array.isArray(n.children) ? n.children : [];
        for (const raw of kids) {
            const c = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : null);
            if (c && c.kind === 'container') walk(c);
        }
    };
    walk(containerNode);

    return out;
}

/**
 * @param {Record<string, unknown>} vaultNode
 * @param {Set<number>} excludeIds Skip these folder ids as targets (e.g. dragged subtree).
 * @returns {Array<{ id: number | null, label: string }>}
 */
function vaultMoveFolderOptionsFlat(vaultNode, excludeIds) {
    /** @type {Array<{ id: number | null, label: string }>} */
    const out = [{ id: null, label: vaultSidebarUiString('move_target_vault_root') }];

    /** @param {unknown[]} nodes @param {string} prefix */
    const walk = (nodes, prefix) => {
        const list = Array.isArray(nodes) ? nodes : [];
        for (const raw of list) {
            if (!raw || typeof raw !== 'object') continue;
            const n = /** @type {Record<string, unknown>} */ (raw);
            if (n.kind !== 'container') continue;
            const id = typeof n.id === 'number' ? n.id : Math.floor(Number(n.id ?? NaN));
            if (!Number.isFinite(id) || id < 1 || excludeIds.has(id)) continue;
            const nm = String(n.name ?? '').trim() || `Folder #${id}`;
            out.push({ id, label: `${prefix}${nm}` });
            const kids = Array.isArray(n.children) ? n.children : [];
            walk(kids, `${prefix}  `);
        }
    };

    walk(Array.isArray(vaultNode.children) ? vaultNode.children : [], '');

    return out;
}

/**
 * Highlight ResourceList tbody rows as drag targets ({@see oaao.css}).
 *
 * @param {HTMLElement} rlShell
 * @param {HTMLElement | null} tr
 */
function vaultRlRowDragMark(rlShell, tr) {
    for (const el of rlShell.querySelectorAll('tr.resource-list-row.oaao-vault-node-drag-target')) {
        el.classList.remove('oaao-vault-node-drag-target');
    }
    if (tr instanceof HTMLTableRowElement) tr.classList.add('oaao-vault-node-drag-target');
}

/**
 * Highlight breadcrumb buttons as vault-node drop targets ({@see oaao.css}).
 *
 * @param {HTMLElement} navHost
 * @param {HTMLButtonElement | null} btn
 */
function vaultBreadcrumbDragMark(navHost, btn) {
    for (const el of navHost.querySelectorAll('button.oaao-vault-bc-drag-target')) {
        el.classList.remove('oaao-vault-bc-drag-target');
    }
    if (btn instanceof HTMLButtonElement && navHost.contains(btn)) btn.classList.add('oaao-vault-bc-drag-target');
}

/**
 * Move a file or folder after same-vault + no-op checks.
 *
 * @param {{ kind: string, id: number, vault_id: number }} payload
 * @param {number} targetVaultId
 * @param {number | null} targetContainerId folder id or null = vault root
 * @param {Map<string, Record<string, unknown>>} rowNodeByKey
 * @param {AbortSignal} signal
 * @param {() => Promise<void>} refreshTree
 */
async function vaultRunExplorerMove(
    payload,
    targetVaultId,
    targetContainerId,
    rowNodeByKey,
    signal,
    refreshTree,
) {
    /** @type {number | null} */
    const tc =
        targetContainerId != null && Number.isFinite(targetContainerId) && targetContainerId > 0
            ? Math.floor(Number(targetContainerId))
            : null;

    const tv =
        typeof targetVaultId === 'number' && Number.isFinite(targetVaultId) && targetVaultId > 0
            ? targetVaultId
            : null;

    if (tv == null || vaultExplorerNav.vaultId !== tv) {
        const Toast = await loadVaultToastCtor();
        Toast?.error(vaultSidebarUiString('move_bad_target'), { duration: 3200, position: 'bottom-right' });

        return;
    }

    if (payload.vault_id !== tv) {
        const Toast = await loadVaultToastCtor();
        Toast?.error(vaultSidebarUiString('move_bad_target'), { duration: 3200, position: 'bottom-right' });

        return;
    }

    if (payload.kind === 'document') {
        const srcDoc = [...rowNodeByKey.values()].find(
            (n) =>
                typeof n.kind === 'string' &&
                n.kind === 'document' &&
                (typeof n.id === 'number' ? n.id : Math.floor(Number(n.id ?? NaN))) === payload.id,
        );
        const rawC =
            /** @type {Record<string, unknown> | undefined} */ (srcDoc)?.container_id;
        /** @type {number | null} */
        const curParent =
            rawC != null && rawC !== '' && Number.isFinite(Number(rawC)) && Math.floor(Number(rawC)) > 0
                ? Math.floor(Number(rawC))
                : null;

        if (curParent === tc) return;
    }

    if (payload.kind === 'container') {
        const srcFolder = [...rowNodeByKey.values()].find(
            (n) =>
                typeof n.kind === 'string' &&
                n.kind === 'container' &&
                (typeof n.id === 'number' ? n.id : Math.floor(Number(n.id ?? NaN))) === payload.id,
        );
        const rawP =
            /** @type {Record<string, unknown> | undefined} */ (srcFolder)?.parent_container_id;
        /** @type {number | null} */
        const curParent =
            rawP != null && rawP !== '' && Number.isFinite(Number(rawP)) && Math.floor(Number(rawP)) > 0
                ? Math.floor(Number(rawP))
                : null;

        if (curParent === tc) return;

        if (tc != null) {
            const vNode = vaultFindVaultNode(vaultExplorerTreeCache, payload.vault_id);
            const cNode =
                vNode && payload.id > 0
                    ? vaultFindContainerDeep(vNode, payload.id)
                    : undefined;
            if (cNode && typeof cNode === 'object') {
                const forbid = vaultCollectDescendantContainerIds(
                    /** @type {Record<string, unknown>} */ (cNode),
                );
                if (forbid.has(tc)) {
                    const Toast = await loadVaultToastCtor();
                    Toast?.error(vaultSidebarUiString('move_bad_target'), {
                        duration: 3200,
                        position: 'bottom-right',
                    });

                    return;
                }
            }
        }
    }

    /** @type {Record<string, unknown>} */
    const body =
        payload.kind === 'document'
            ? {
                  document_id: payload.id,
                  vault_id: payload.vault_id,
                  ...(tc != null ? { container_id: tc } : {}),
              }
            : {
                  vault_id: tv,
                  container_id: payload.id,
                  ...(tc != null ? { parent_container_id: tc } : {}),
              };

    const endpoint = payload.kind === 'document' ? 'document_move' : 'vault_container_move';
    const j = await vaultPostJson(endpoint, body, signal);
    if (signal.aborted) return;

    if (!j.success) {
        const Toast = await loadVaultToastCtor();
        const msg =
            typeof j.message === 'string' && j.message.trim()
                ? j.message.trim()
                : vaultSidebarUiString('op_failed');
        Toast?.error(msg, { duration: 3800, position: 'bottom-right' });

        return;
    }

    const ToastOk = await loadVaultToastCtor();
    ToastOk?.success(
        `${
            payload.kind === 'document'
                ? vaultSidebarUiString('kind_document')
                : vaultSidebarUiString('kind_container')
        } · ${vaultSidebarUiString('action_move')}`,
        { duration: 2200, position: 'bottom-right' },
    );
    vaultNodeDragPayload = null;
    await refreshTree();
}

/**
 * Bind internal row-drag move + breadcrumb drop targets.
 *
 * @param {HTMLElement} rlShell
 * @param {HTMLElement} navHost
 * @param {Map<string, Record<string, unknown>>} rowNodeByKey
 * @param {AbortSignal} signal
 * @param {() => Promise<void>} refreshTree
 */
function wireVaultExplorerNodeDragDrop(rlShell, navHost, rowNodeByKey, signal, refreshTree) {
    const parsePayloadFromTransfer = (/** @type {DataTransfer | null} */ dt) => {
        try {
            const raw = dt?.getData(VAULT_NODE_DRAG_MIME);
            if (!raw || typeof raw !== 'string') return vaultNodeDragPayload;
            /** @type {unknown} */
            const decoded = JSON.parse(raw);
            if (!decoded || typeof decoded !== 'object') return vaultNodeDragPayload;
            /** @type {Record<string, unknown>} */
            const o = /** @type {Record<string, unknown>} */ (decoded);
            const k = typeof o.kind === 'string' ? o.kind : '';
            if (k !== 'document' && k !== 'container') return vaultNodeDragPayload;
            const id = typeof o.id === 'number' ? o.id : Math.floor(Number(o.id ?? NaN));
            const vk =
                typeof o.vault_id === 'number'
                    ? o.vault_id
                    : Math.floor(Number(o.vault_id ?? NaN));
            if (!Number.isFinite(id) || id < 1 || !Number.isFinite(vk) || vk < 1) return vaultNodeDragPayload;

            return /** @type {{ kind: string, id: number, vault_id: number }} */ ({
                kind: k,
                id,
                vault_id: vk,
            });
        } catch {
            return vaultNodeDragPayload;
        }
    };

    const attachDraggable = () => {
        for (const tr of rlShell.querySelectorAll('tr.resource-list-row[data-row-key]')) {
            if (!(tr instanceof HTMLTableRowElement)) continue;
            const node = rowNodeByKey.get(tr.dataset.rowKey ?? '');
            const k = typeof node?.kind === 'string' ? node.kind : '';
            const grip = tr.querySelector('[data-oaao-vault-drag-handle]');
            tr.draggable = false;
            if (k === 'document' || k === 'container') {
                tr.dataset.draggableNode = '1';
                if (grip instanceof HTMLElement) grip.draggable = true;
            } else {
                delete tr.dataset.draggableNode;
                if (grip instanceof HTMLElement) grip.draggable = false;
            }
        }
    };
    attachDraggable();
    queueMicrotask(attachDraggable);

    navHost.addEventListener(
        'dragover',
        (e) => {
            if (vaultDataTransferHasFiles(e.dataTransfer)) {
                vaultBreadcrumbDragMark(navHost, null);

                return;
            }
            const tt = [...(e.dataTransfer?.types ?? [])];
            if (!tt.includes(VAULT_NODE_DRAG_MIME) && !vaultNodeDragPayload) {
                vaultBreadcrumbDragMark(navHost, null);

                return;
            }

            const elHit =
                typeof document.elementFromPoint === 'function'
                    ? document.elementFromPoint(e.clientX, e.clientY)
                    : null;
            const crumb =
                elHit instanceof Element
                    ? /** @type {Element | null} */ (elHit.closest('button[data-oaao-vault-drop-target]'))
                    : null;
            if (!(crumb instanceof HTMLButtonElement) || !navHost.contains(crumb)) {
                vaultBreadcrumbDragMark(navHost, null);

                return;
            }
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            vaultBreadcrumbDragMark(navHost, crumb);
        },
        { signal, capture: true },
    );

    navHost.addEventListener(
        'dragleave',
        (e) => {
            if (!(e.relatedTarget instanceof Node) || !navHost.contains(e.relatedTarget)) {
                vaultBreadcrumbDragMark(navHost, null);
            }
        },
        { signal },
    );

    rlShell.addEventListener(
        'dragstart',
        (e) => {
            const grip = e.target instanceof Element ? e.target.closest('[data-oaao-vault-drag-handle]') : null;
            if (!grip) return;
            const tr =
                grip instanceof Element ? grip.closest('tr.resource-list-row[data-row-key]') : null;
            if (!(tr instanceof HTMLTableRowElement) || tr.dataset.draggableNode !== '1') return;
            const key = tr.dataset.rowKey ?? '';
            const node = key ? rowNodeByKey.get(key) : undefined;
            if (!node) return;

            const kind = typeof node.kind === 'string' ? node.kind : '';
            if (kind !== 'container' && kind !== 'document') return;

            const idNum =
                typeof node.id === 'number' ? node.id : Math.floor(Number(node.id ?? NaN));
            const vidRaw = node.vault_id;
            const vid =
                typeof vidRaw === 'number'
                    ? vidRaw
                    : Math.floor(Number(vidRaw ?? NaN));

            if (!Number.isFinite(idNum) || idNum < 1 || !Number.isFinite(vid) || vid < 1) return;

            const payload = /** @type {const} */ ({ kind, id: idNum, vault_id: vid });
            vaultNodeDragPayload = payload;
            vaultBreadcrumbDragMark(navHost, null);
            try {
                if (e.dataTransfer) {
                    e.dataTransfer.setData(VAULT_NODE_DRAG_MIME, JSON.stringify(payload));
                    e.dataTransfer.effectAllowed = 'move';
                }
            } catch {
                /* noop */
            }
        },
        { signal },
    );

    rlShell.addEventListener(
        'dragend',
        () => {
            vaultNodeDragPayload = null;
            vaultRlRowDragMark(rlShell, null);
            vaultBreadcrumbDragMark(navHost, null);
        },
        { signal },
    );

    rlShell.addEventListener(
        'dragover',
        (e) => {
            if (vaultDataTransferHasFiles(e.dataTransfer)) return;
            const tt = [...(e.dataTransfer?.types ?? [])];
            if (!tt.includes(VAULT_NODE_DRAG_MIME) && !vaultNodeDragPayload) return;

            vaultBreadcrumbDragMark(navHost, null);

            const elHit =
                typeof document.elementFromPoint === 'function'
                    ? document.elementFromPoint(e.clientX, e.clientY)
                    : null;
            /** @type {HTMLTableRowElement | null} */
            const maybeTr =
                elHit instanceof Element ? elHit.closest('tr.resource-list-row') : null;

            /** @type {HTMLTableRowElement | null} */
            let hl = null;
            if (maybeTr instanceof HTMLTableRowElement && rlShell.contains(maybeTr)) {
                const key = maybeTr.dataset.rowKey ?? '';
                const nn = rowNodeByKey.get(key);
                if (typeof nn?.kind === 'string' && nn.kind === 'container') hl = maybeTr;
            }
            vaultRlRowDragMark(rlShell, hl);

            if (hl) {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            }
        },
        { signal },
    );

    rlShell.addEventListener(
        'dragleave',
        (e) => {
            if (!(e.relatedTarget instanceof Node) || !rlShell.contains(e.relatedTarget)) {
                vaultRlRowDragMark(rlShell, null);
            }
        },
        { signal },
    );

    rlShell.addEventListener(
        'drop',
        (e) => {
            if (vaultDataTransferHasFiles(e.dataTransfer)) return;
            vaultRlRowDragMark(rlShell, null);
            vaultBreadcrumbDragMark(navHost, null);

            /** @type {{ kind: string, id: number, vault_id: number } | null} */
            const payload = parsePayloadFromTransfer(e.dataTransfer);
            if (!payload || (payload.kind !== 'document' && payload.kind !== 'container')) return;

            const elHit =
                typeof document.elementFromPoint === 'function'
                    ? document.elementFromPoint(e.clientX, e.clientY)
                    : null;

            /** @type {HTMLTableRowElement | null} */
            const trUnder =
                e.target instanceof Element
                    ? /** @type {HTMLTableRowElement | null} */ (
                          e.target.closest('tr.resource-list-row')
                      )
                    : null;
            const trFallback =
                elHit instanceof Element ? elHit.closest('tr.resource-list-row') : null;
            /** @type {HTMLTableRowElement | null} */
            const hitTr =
                trUnder instanceof HTMLTableRowElement &&
                rlShell.contains(trUnder) &&
                trUnder.dataset.rowKey
                    ? trUnder
                    : trFallback instanceof HTMLTableRowElement && rlShell.contains(trFallback)
                      ? trFallback
                      : null;

            if (!hitTr) return;

            const key = hitTr.dataset.rowKey ?? '';
            const dropNode = key ? rowNodeByKey.get(key) : undefined;
            if (!dropNode || /** @type {Record<string, unknown>} */ (dropNode).kind !== 'container')
                return;

            e.preventDefault();

            const dv =
                typeof /** @type {Record<string, unknown>} */ (dropNode).vault_id === 'number'
                    ? /** @type {number} */ (dropNode.vault_id)
                    : Math.floor(Number(/** @type {Record<string, unknown>} */ (dropNode).vault_id ?? NaN));
            const tgtC =
                typeof dropNode.id === 'number'
                    ? dropNode.id
                    : Math.floor(Number(/** @type {Record<string, unknown>} */ (dropNode).id ?? NaN));

            if (!Number.isFinite(dv) || dv < 1 || !Number.isFinite(tgtC) || tgtC < 1) return;
            if (payload.vault_id !== dv) return;

            if (payload.kind === 'container') {
                if (payload.id === tgtC) return;
                const vNode = vaultFindVaultNode(vaultExplorerTreeCache, payload.vault_id);
                const cNode =
                    vNode && payload.id > 0
                        ? vaultFindContainerDeep(vNode, payload.id)
                        : undefined;
                if (
                    cNode &&
                    vaultCollectDescendantContainerIds(
                        /** @type {Record<string, unknown>} */ (cNode),
                    ).has(tgtC)
                )
                    return;
            }

            void vaultRunExplorerMove(payload, dv, tgtC, rowNodeByKey, signal, refreshTree);
        },
        { signal },
    );

    vaultBreadcrumbDnDWire = (navWireHost) => {
        for (const btn of navWireHost.querySelectorAll('[data-oaao-vault-drop-target]')) {
            if (!(btn instanceof HTMLButtonElement)) continue;
            btn.addEventListener(
                'drop',
                (ev) => {
                    ev.preventDefault();
                    if (vaultDataTransferHasFiles(ev.dataTransfer)) return;
                    vaultRlRowDragMark(rlShell, null);
                    vaultBreadcrumbDragMark(navHost, null);

                    /** @type {{ kind: string, id: number, vault_id: number } | null} */
                    const payload = parsePayloadFromTransfer(ev.dataTransfer);
                    if (!payload || (payload.kind !== 'document' && payload.kind !== 'container')) return;

                    /** @type {{ kind?: string; vaultId?: unknown; containerId?: unknown }} */
                    let dropTarget = {};
                    try {
                        const raw = btn.getAttribute('data-oaao-vault-drop-target');
                        if (typeof raw === 'string' && raw !== '') dropTarget = JSON.parse(raw);
                    } catch {
                        dropTarget = {};
                    }

                    if (dropTarget.kind !== 'breadcrumb') return;
                    const tv = Math.floor(Number(dropTarget.vaultId ?? NaN));
                    if (!Number.isFinite(tv) || tv < 1) return;

                    /** @type {number | null} */
                    const tc =
                        dropTarget.containerId != null &&
                        Number.isFinite(Number(dropTarget.containerId)) &&
                        Math.floor(Number(dropTarget.containerId)) > 0
                            ? Math.floor(Number(dropTarget.containerId))
                            : null;

                    void vaultRunExplorerMove(payload, tv, tc, rowNodeByKey, signal, refreshTree);
                },
                { signal },
            );
        }
    };
}

/**
 * @param {unknown[]} tree
 * @param {{ vaultId: number | null, containerId: number | null }} nav
 */
function vaultValidateExplorerNav(tree, nav) {
    if (nav.vaultId == null) return { vaultId: null, containerId: null };
    const vid = Math.floor(Number(nav.vaultId));
    if (!Number.isFinite(vid) || vid < 1) return { vaultId: null, containerId: null };
    const vNode = vaultFindVaultNode(tree, vid);
    if (!vNode) return { vaultId: null, containerId: null };
    if (nav.containerId == null) return { vaultId: vid, containerId: null };
    const cid = Math.floor(Number(nav.containerId));
    if (!Number.isFinite(cid) || cid < 1) return { vaultId: vid, containerId: null };
    const cNode = vaultFindContainerDeep(vNode, cid);

    return cNode ? { vaultId: vid, containerId: cid } : { vaultId: vid, containerId: null };
}

/**
 * @param {unknown[]} tree
 * @param {{ vaultId: number | null, containerId: number | null }} nav
 * @returns {unknown[]}
 */
function vaultGetExplorerChildren(tree, nav) {
    const arr = Array.isArray(tree) ? tree : [];
    if (nav.vaultId == null) {
        return arr.filter((raw) => raw && typeof raw === 'object' && /** @type {{ kind?: string }} */ (raw).kind === 'vault');
    }

    const vNode = vaultFindVaultNode(tree, nav.vaultId);
    if (!vNode) return [];

    if (nav.containerId == null) {
        const kids = Array.isArray(vNode.children) ? vNode.children : [];

        return kids;
    }

    const cNode = vaultFindContainerDeep(vNode, nav.containerId);
    if (!cNode || cNode.kind !== 'container') return [];
    const kids = Array.isArray(cNode.children) ? cNode.children : [];

    return kids;
}

/**
 * @param {HTMLElement} navHost
 * @param {unknown[]} tree
 * @param {{ vaultId: number | null, containerId: number | null }} nav
 * @param {(next: { vaultId: number | null, containerId: number | null }) => void} onNavigate
 */
function vaultRenderBreadcrumb(navHost, tree, nav, onNavigate) {
    navHost.textContent = '';
    navHost.className =
        'oaao-vault-bc w-full shrink-0 min-h-[1.75rem] px-sm py-xs border-b-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] flex items-center gap-2';

    const row = document.createElement('div');
    row.className =
        'oaao-vault-bc-row inline-flex flex-wrap items-center justify-start gap-x-1 gap-y-0.5 max-w-full flex-1 min-w-0 text-[0.8125rem] fg-[var(--grid-ink)]';
    navHost.append(row);

    /** @param {string} label @param {{ vaultId: number | null, containerId: number | null }} target */
    const appendCrumb = (label, target) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'shrink-0 max-w-[14rem] truncate rounded-[6px] px-1 py-0.5 bg-transparent border-none cursor-pointer font-inherit fg-[var(--grid-accent)] hover:bg-[var(--grid-line)]/30 text-left';
        btn.textContent = label;
        btn.addEventListener('click', () => onNavigate(target));

        const vid =
            typeof target.vaultId === 'number' ? target.vaultId : Math.floor(Number(target.vaultId ?? NaN));
        if (Number.isFinite(vid) && vid > 0) {
            /** @type {number | null} */
            const cid =
                target.containerId != null && Number.isFinite(Number(target.containerId))
                    ? Math.floor(Number(target.containerId))
                    : null;
            const cNorm =
                cid != null && Number.isFinite(cid) && cid > 0 ? cid : null;

            try {
                btn.setAttribute(
                    'data-oaao-vault-drop-target',
                    JSON.stringify({
                        kind: 'breadcrumb',
                        vaultId: Math.floor(vid),
                        containerId: cNorm,
                    }),
                );
            } catch {
                /* noop */
            }
        }

        return btn;
    };

    const sep = () => {
        const s = document.createElement('span');
        s.className = 'fg-[var(--grid-caption)] select-none shrink-0 px-0.5';
        s.textContent = '/';
        s.setAttribute('aria-hidden', 'true');

        return s;
    };

    row.append(appendCrumb(vaultSidebarUiString('breadcrumb_root'), { vaultId: null, containerId: null }));

    if (nav.vaultId == null) return;

    const vNode = vaultFindVaultNode(tree, nav.vaultId);
    const vLabel =
        vNode && typeof vNode.name === 'string' && vNode.name.trim()
            ? vNode.name.trim()
            : `Vault #${nav.vaultId}`;

    row.append(sep(), appendCrumb(vLabel, { vaultId: nav.vaultId, containerId: null }));

    if (nav.containerId != null && vNode) {
        /** @type {{ id?: unknown, kind?: string, name?: unknown, children?: unknown }[]} */
        const trail = [];
        const buildTrail = (nodes, prefix) => {
            const list = Array.isArray(nodes) ? nodes : [];
            for (const raw of list) {
                if (!raw || typeof raw !== 'object') continue;
                const cn = /** @type {Record<string, unknown>} */ (raw);
                if (cn.kind !== 'container') continue;
                const chain = [...prefix, cn];
                const id = typeof cn.id === 'number' ? cn.id : Math.floor(Number(cn.id ?? NaN));
                if (id === nav.containerId) {
                    trail.push(...chain);

                    return true;
                }
                const kids = Array.isArray(cn.children) ? cn.children : [];
                if (buildTrail(kids, chain)) return true;
            }

            return false;
        };

        buildTrail(Array.isArray(vNode.children) ? vNode.children : [], []);

        const vid = nav.vaultId;
        for (const folder of trail) {
            const cid = typeof folder.id === 'number' ? folder.id : Math.floor(Number(folder.id ?? NaN));
            const nm =
                typeof folder.name === 'string' && folder.name.trim()
                    ? folder.name.trim()
                    : `Folder #${cid}`;
            row.append(sep(), appendCrumb(nm, { vaultId: vid, containerId: cid }));
        }
    }

    if (typeof vaultOpenActiveVaultConfigRef === 'function') {
        const cfgBtn = document.createElement('button');
        cfgBtn.type = 'button';
        cfgBtn.className =
            'shrink-0 rounded-[6px] h-7 px-2 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-transparent border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 inline-flex items-center justify-center';
        cfgBtn.textContent = vaultSidebarUiString('vault_card_config');
        cfgBtn.setAttribute('aria-label', vaultSidebarUiString('vault_config_open_aria'));
        cfgBtn.addEventListener('click', () => vaultOpenActiveVaultConfigRef?.());
        navHost.append(cfgBtn);
    }

    if (typeof vaultBreadcrumbDnDWire === 'function') {
        vaultBreadcrumbDnDWire(navHost);
    }
}

/** Map server graph_error codes to actionable sidebar hints. */
function vaultGraphErrorHint(code, docNode) {
    const c = typeof code === 'string' ? code.trim().toLowerCase() : '';
    if (c.includes('no_extractable_text')) {
        return vaultSidebarUiString('detail_graph_hint_no_text');
    }
    if (c.includes('missing_arango') || c.includes('arango')) {
        return vaultSidebarUiString('detail_graph_hint_missing_arango');
    }
    if (c.includes('missing_graph_purpose') || c.includes('graph_primary')) {
        return vaultSidebarUiString('detail_graph_hint_missing_purpose');
    }
    if (c === 'failed' || c === '') return '';
    return vaultSidebarUiString('detail_graph_hint_requeue');
}

/**
 * @param {Record<string, unknown>} node
 */
function vaultBuildStatusHtml(node) {
    const kind = typeof node.kind === 'string' ? node.kind : '';
    if (kind !== 'document') {
        return `<span class="text-[0.72rem] fg-[var(--grid-caption)]">—</span>`;
    }

    const docId = typeof node.id === 'number' ? node.id : Math.floor(Number(node.id ?? 0));
    const queuedHintRaw =
        Number.isFinite(docId) && docId > 0 ? vaultTransientDocBadges.get(docId) ?? '' : '';
    const embRaw = typeof node.embed_status === 'string' ? node.embed_status.trim().toLowerCase() : '';
    const embedErrTrimmed = typeof node.embed_error === 'string' ? node.embed_error.trim() : '';
    /** Do not hide real server badges while the row is embedding / terminal / carries embed_error (detail icon). */
    const showQueuedHint =
        queuedHintRaw &&
        embRaw !== 'embedding' &&
        embRaw !== 'failed' &&
        embRaw !== 'embedded' &&
        !((embRaw === 'pending' || embRaw === '' || embRaw === 'held') && embedErrTrimmed !== '');

    /** @type {string[]} */
    const chips = [];

    const refetchRaw =
        typeof node.research_refetch_status === 'string' ? node.research_refetch_status.trim().toLowerCase() : '';
    if (refetchRaw === 'queued') {
        chips.push(
            `<span class="oaao-vault-badge oaao-vault-badge--queued">${escapeVaultHtml(vaultSidebarUiString('badge_refetch_queued'))}</span>`,
        );
    } else if (refetchRaw === 'running') {
        chips.push(
            `<span class="oaao-vault-badge oaao-vault-badge--embedding">${escapeVaultHtml(vaultSidebarUiString('badge_refetch_running'))}</span>`,
        );
    }

    if (showQueuedHint) {
        chips.push(
            `<span class="oaao-vault-badge oaao-vault-badge--queued"${vaultEmbedErrTitleAttr(embedErrTrimmed)}>${escapeVaultHtml(queuedHintRaw)}</span>`,
        );
    }

    if (embRaw === 'embedded') {
        chips.push(`<span class="oaao-vault-badge oaao-vault-badge--ok">${escapeVaultHtml(vaultSidebarUiString('badge_embedded'))}</span>`);
    } else if (embRaw === 'failed') {
        const tip = vaultStatusDetailTooltipIcon(embedErrTrimmed);
        chips.push(
            `<span class="oaao-vault-badge oaao-vault-badge--err inline-flex items-center gap-0.5 max-w-full">${escapeVaultHtml(vaultSidebarUiString('badge_failed'))}${tip}</span>`,
        );
    } else if (!showQueuedHint && embRaw === 'embedding') {
        const tip = vaultStatusDetailTooltipIcon(embedErrTrimmed);
        chips.push(
            `<span class="oaao-vault-badge oaao-vault-badge--embedding inline-flex items-center gap-0.5 max-w-full">${escapeVaultHtml(vaultSidebarUiString('badge_embedding'))}${tip}</span>`,
        );
    } else if (!showQueuedHint && embRaw === 'held') {
        const tip = vaultStatusDetailTooltipIcon(embedErrTrimmed);
        chips.push(
            `<span class="oaao-vault-badge oaao-vault-badge--muted inline-flex items-center gap-0.5 max-w-full">${escapeVaultHtml(vaultSidebarUiString('badge_held'))}${tip}</span>`,
        );
    } else if (!showQueuedHint && (embRaw === 'pending' || embRaw === '')) {
        const tip = vaultStatusDetailTooltipIcon(embedErrTrimmed);
        chips.push(
            `<span class="oaao-vault-badge oaao-vault-badge--muted inline-flex items-center gap-0.5 max-w-full">${escapeVaultHtml(vaultSidebarUiString('badge_pending'))}${tip}</span>`,
        );
    } else if (!showQueuedHint && embRaw) {
        const tip = vaultStatusDetailTooltipIcon(embedErrTrimmed);
        chips.push(
            `<span class="oaao-vault-badge oaao-vault-badge--muted inline-flex items-center gap-0.5 max-w-full">${escapeVaultHtml(embRaw)}${tip}</span>`,
        );
    }

    const vgm = Number(node.vault_graph_mode ?? 0);
    if (vgm !== 0) {
        const gRaw = typeof node.graph_status === 'string' ? node.graph_status.trim().toLowerCase() : '';
        const graphErrTrimmed = typeof node.graph_error === 'string' ? node.graph_error.trim() : '';
        if (gRaw === 'indexed') {
            chips.push(
                `<span class="oaao-vault-badge oaao-vault-badge--ok oaao-vault-badge--graph">${escapeVaultHtml(vaultSidebarUiString('badge_graph_indexed'))}</span>`,
            );
        } else if (gRaw === 'failed') {
            const tip = vaultStatusDetailTooltipIcon(graphErrTrimmed);
            chips.push(
                `<span class="oaao-vault-badge oaao-vault-badge--err oaao-vault-badge--graph inline-flex items-center gap-0.5 max-w-full">${escapeVaultHtml(vaultSidebarUiString('badge_graph_failed'))}${tip}</span>`,
            );
        } else if (gRaw === 'building') {
            const tip = vaultStatusDetailTooltipIcon(graphErrTrimmed);
            chips.push(
                `<span class="oaao-vault-badge oaao-vault-badge--embedding oaao-vault-badge--graph inline-flex items-center gap-0.5 max-w-full">${escapeVaultHtml(vaultSidebarUiString('badge_graph_building'))}${tip}</span>`,
            );
        } else {
            const tip = vaultStatusDetailTooltipIcon(graphErrTrimmed);
            chips.push(
                `<span class="oaao-vault-badge oaao-vault-badge--muted oaao-vault-badge--graph inline-flex items-center gap-0.5 max-w-full">${escapeVaultHtml(vaultSidebarUiString('badge_graph_pending'))}${tip}</span>`,
            );
        }
    }

    if (!chips.length) {
        return `<span class="text-[0.72rem] fg-[var(--grid-caption)]">—</span>`;
    }

    return `<div class="oaao-vault-status-chips">${chips.join('')}</div>`;
}

/** @param {string} kind */
function vaultExplorerKindLabel(kind) {
    if (kind === 'vault') return vaultSidebarUiString('kind_vault');
    if (kind === 'container') return vaultSidebarUiString('kind_container');
    if (kind === 'document') return vaultSidebarUiString('kind_document');

    return kind.trim() !== '' ? kind : '—';
}

/**
 * New-folder strip lives in {@code workspace_vault_panel.tpl} (outside tree host) so it survives tree reloads.
 *
 * @param {HTMLElement} mount
 */
function syncVaultExplorerFolderUi(mount) {
    const wrap = mount.querySelector('[data-oaao-vault-new-folder-wrap]');
    const input = mount.querySelector('#oaao-vault-new-folder-input');
    const btn = mount.querySelector('#oaao-vault-new-folder-btn');
    const uploadBtn = mount.querySelector('#oaao-vault-toolbar-upload-btn');
    const uploadInp = mount.querySelector('#oaao-vault-toolbar-file-input');
    const note = mount.querySelector('#oaao-vault-new-folder-note');
    if (!(wrap instanceof HTMLElement)) return;

    const inside = vaultExplorerNav.vaultId != null;
    wrap.classList.toggle('hidden', !inside);

    if (input instanceof HTMLInputElement) input.disabled = !inside;
    if (btn instanceof HTMLButtonElement) btn.disabled = !inside;
    if (uploadBtn instanceof HTMLButtonElement) {
        uploadBtn.disabled = !inside;
        uploadBtn.setAttribute('aria-label', vaultSidebarUiString('toolbar_upload_aria'));
    }
    if (uploadInp instanceof HTMLInputElement) {
        uploadInp.disabled = !inside;
        if (!inside) uploadInp.value = '';
    }

    if (!inside) {
        if (input instanceof HTMLInputElement) input.value = '';
        if (note) {
            note.textContent = '';
            note.classList.add('hidden');
        }
    }
}

/** @type {{ destroy?: () => void } | null} */
let vaultExplorerControl = null;

/** AbortController for drag/drop listeners on ResourceList / gallery ({@see wireVaultExplorerDropTarget}). */
/** @type {AbortController | null} */
let vaultRlDropAbort = null;

function destroyVaultExplorer() {
    vaultExplorerControl?.destroy?.();
    vaultExplorerControl = null;
}

/** @type {number | null} */
let vaultUploadTargetVaultId = null;
/** @type {number | null} */
let vaultUploadTargetContainerId = null;

/** Plain object passed to RazyUI Uploader `data`; rebuilt before each upload (`onUpload` runs before FormData is built). */
const vaultUploadMultipartFields = {};

function rebuildVaultMultipartFields() {
    for (const k of Object.keys(vaultUploadMultipartFields)) delete vaultUploadMultipartFields[k];
    const wid = getOaaoActiveWorkspaceIdForVault();
    if (wid != null) vaultUploadMultipartFields.workspace_id = String(wid);
    if (vaultUploadTargetVaultId != null && vaultUploadTargetVaultId > 0) {
        vaultUploadMultipartFields.vault_id = String(vaultUploadTargetVaultId);
    }
    if (vaultUploadTargetContainerId != null && vaultUploadTargetContainerId > 0) {
        vaultUploadMultipartFields.container_id = String(vaultUploadTargetContainerId);
    }
}

/** @param {DataTransfer | null} dt */
function vaultDataTransferHasFiles(dt) {
    if (!dt || !dt.types) return false;

    return [...dt.types].includes('Files');
}

/**
 * Drag-and-drop onto ResourceList shell / vault gallery forwards files into RazyUI {@code Uploader.addFiles} (same multipart payload as browse {@see wireVaultRazyUploader}).
 *
 * @param {HTMLElement} dropEl
 * @param {AbortSignal} signal
 */
function wireVaultExplorerDropTarget(dropEl, signal) {
    const ctrl = vaultUploaderInstance?.getControl?.();
    if (!ctrl || typeof ctrl.addFiles !== 'function') return;

    dropEl.addEventListener(
        'dragenter',
        (e) => {
            if (!vaultDataTransferHasFiles(e.dataTransfer)) return;
            e.preventDefault();
            dropEl.classList.add('oaao-vault-rl-dragover');
        },
        { signal },
    );

    dropEl.addEventListener(
        'dragleave',
        (e) => {
            if (!vaultDataTransferHasFiles(e.dataTransfer)) return;
            e.preventDefault();
            const rel = e.relatedTarget;
            if (rel instanceof Node && dropEl.contains(rel)) return;
            dropEl.classList.remove('oaao-vault-rl-dragover');
        },
        { signal },
    );

    dropEl.addEventListener(
        'dragover',
        (e) => {
            if (!vaultDataTransferHasFiles(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        },
        { signal },
    );

    dropEl.addEventListener(
        'drop',
        (e) => {
            dropEl.classList.remove('oaao-vault-rl-dragover');
            if (!vaultDataTransferHasFiles(e.dataTransfer)) return;
            e.preventDefault();
            e.stopPropagation();
            const fl = e.dataTransfer.files;
            if (!fl || fl.length === 0) return;
            rebuildVaultMultipartFields();
            ctrl.addFiles(fl);
        },
        { signal },
    );
}

/**
 * True target element — click/dblclick on text leaves {@code Event#target} as a {@code Text} node, which has no {@link Element#closest}.
 *
 * @param {Event} ev
 * @returns {Element | null}
 */
function vaultEventTargetElement(ev) {
    const t = ev.target;
    if (t instanceof Element) return t;
    if (t instanceof Node && t.nodeType === Node.TEXT_NODE) return t.parentElement;

    return null;
}

/**
 * Resolve ResourceList row from {@code dblclick} ({@code composedPath} covers nested name cells).
 *
 * @param {Event} ev
 * @returns {HTMLElement | null}
 */
function vaultClosestResourceListRow(ev) {
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    for (const n of path) {
        if (
            n instanceof HTMLElement &&
            n.tagName === 'TR' &&
            n.classList.contains('resource-list-row') &&
            (n.dataset.rowKey ?? '') !== ''
        ) {
            return n;
        }
    }
    const el = vaultEventTargetElement(ev);

    return el instanceof Element ? /** @type {HTMLElement | null} */ (el.closest('tr.resource-list-row[data-row-key]')) : null;
}

/** Shift+click range anchor in vault ResourceList ({@see vaultWireResourceListSelectionGestures}). */
let vaultRlSelectionAnchorKey = '';

/** Row key whose detail is shown in the right panel ({@see vaultSyncResourceListFocusRow}) — distinct from checkbox selection. */
let vaultRlFocusRowKey = '';

/** @type {HTMLElement | null} */
let vaultExplorerRlShellRef = null;

/** @type {ResizeObserver | null} */
let vaultRlShellScrollObserver = null;

/**
 * Visible scroll height from element top to workspace bottom.
 *
 * @param {HTMLElement} scrollEl
 * @param {HTMLElement} root
 * @returns {number | null}
 */
function measureVaultListScrollHeight(scrollEl, root) {
    const top = scrollEl.getBoundingClientRect().top;
    if (!Number.isFinite(top)) return null;

    let clipBottom = window.innerHeight;
    if (typeof window.visualViewport?.height === 'number' && window.visualViewport.height > 0) {
        clipBottom = Math.min(
            clipBottom,
            (window.visualViewport.offsetTop ?? 0) + window.visualViewport.height,
        );
    }

    const workspaceContent = document.getElementById('workspace-content');
    if (workspaceContent instanceof HTMLElement) {
        const wr = workspaceContent.getBoundingClientRect();
        if (wr.height > 0 && Number.isFinite(wr.bottom)) {
            clipBottom = Math.min(clipBottom, wr.bottom);
        }
    }

    const browseBody = root.querySelector('.oaao-vault-browse-body');
    if (browseBody instanceof HTMLElement) {
        const br = browseBody.getBoundingClientRect();
        if (br.height > 0 && Number.isFinite(br.bottom)) {
            clipBottom = Math.min(clipBottom, br.bottom);
        }
    }

    return Math.max(120, Math.floor(clipBottom - top - 2));
}

/**
 * Apply vault ResourceList scroll on {@code .resource-list-wrapper} (not rlShell — container overflow:hidden clips without scrollHeight).
 *
 * @param {HTMLElement} mount
 */
function syncVaultExplorerScrollHeights(mount) {
    const root =
        mount.matches?.('[data-module="oaao-vault"]')
            ? mount
            : (mount.querySelector('[data-module="oaao-vault"]') ?? mount);
    const treeHost = root.querySelector('[data-oaao-vault="tree-main-host"]');
    const rlShell = vaultExplorerRlShellRef;
    if (!(treeHost instanceof HTMLElement)) return;

    treeHost.style.display = 'flex';
    treeHost.style.flexDirection = 'column';
    treeHost.style.flex = '1 1 0%';
    treeHost.style.minHeight = '0';
    treeHost.style.minWidth = '0';
    treeHost.style.overflow = 'hidden';

    if (!(rlShell instanceof HTMLElement) || !rlShell.isConnected) return;

    rlShell.style.display = 'flex';
    rlShell.style.flexDirection = 'column';
    rlShell.style.flex = '1 1 0%';
    rlShell.style.minHeight = '0';
    rlShell.style.minWidth = '0';
    rlShell.style.overflow = 'hidden';
    rlShell.style.height = '';
    rlShell.style.maxHeight = '';

    const container = rlShell.querySelector('.resource-list-container');
    const wrapper = rlShell.querySelector('.resource-list-wrapper');
    if (!(wrapper instanceof HTMLElement)) return;

    if (container instanceof HTMLElement) {
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.flex = '1 1 0%';
        container.style.minHeight = '0';
        container.style.overflow = 'hidden';
    }

    wrapper.style.flex = '1 1 0%';
    wrapper.style.minHeight = '0';
    wrapper.style.minWidth = '0';
    wrapper.style.overflowX = 'auto';
    wrapper.style.setProperty('overflow-y', 'auto', 'important');
    wrapper.style.setProperty('-webkit-overflow-scrolling', 'touch');

    const applyPin = () => {
        const pinH = measureVaultListScrollHeight(wrapper, root);
        if (pinH == null) return;

        wrapper.style.maxHeight = `${pinH}px`;
        wrapper.style.height = `${pinH}px`;

        const needsScroll = wrapper.scrollHeight > wrapper.clientHeight + 2;
        if (!needsScroll && rlShell.querySelectorAll('tr.resource-list-row').length > 0) {
            const tighter = Math.max(120, pinH - 48);
            wrapper.style.maxHeight = `${tighter}px`;
            wrapper.style.height = `${tighter}px`;
        }
    };

    applyPin();
    requestAnimationFrame(applyPin);
}

/**
 * Re-measure when ResourceList rows mount or workspace chrome resizes.
 *
 * @param {HTMLElement} mount
 * @param {HTMLElement} rlShell
 */
function vaultBindRlShellScrollSync(mount, rlShell) {
    if (!(rlShell instanceof HTMLElement)) return;

    const sync = () => syncVaultExplorerScrollHeights(mount);
    sync();
    requestAnimationFrame(sync);

    vaultRlShellScrollObserver?.disconnect();
    vaultRlShellScrollObserver = null;
    if (typeof ResizeObserver !== 'function') return;

    vaultRlShellScrollObserver = new ResizeObserver(() => {
        sync();
    });
    vaultRlShellScrollObserver.observe(rlShell);
    const wrapper = rlShell.querySelector('.resource-list-wrapper');
    if (wrapper instanceof HTMLElement) vaultRlShellScrollObserver.observe(wrapper);
    const treeHost = rlShell.closest('[data-oaao-vault="tree-main-host"]');
    if (treeHost instanceof HTMLElement) vaultRlShellScrollObserver.observe(treeHost);
    const workspaceContent = document.getElementById('workspace-content');
    if (workspaceContent instanceof HTMLElement) vaultRlShellScrollObserver.observe(workspaceContent);
}

/**
 * @param {Record<string, unknown>} node
 */
function vaultExplorerRowKeyFromNode(node) {
    const kind = typeof node.kind === 'string' ? node.kind : '';
    const idRaw = node.id;
    const idNum = typeof idRaw === 'number' ? idRaw : Math.floor(Number(idRaw ?? NaN));

    return `${kind}:${Number.isFinite(idNum) && idNum > 0 ? idNum : String(idRaw ?? '')}`;
}

function vaultSyncResourceListFocusRow() {
    const shell = vaultExplorerRlShellRef;
    if (!(shell instanceof HTMLElement)) return;

    for (const tr of shell.querySelectorAll('tr.resource-list-row.oaao-vault-row-focus')) {
        tr.classList.remove('oaao-vault-row-focus');
        tr.removeAttribute('aria-current');
    }

    if (!vaultRlFocusRowKey) return;

    const tr = shell.querySelector(
        `tr.resource-list-row[data-row-key="${CSS.escape(vaultRlFocusRowKey)}"]`,
    );
    if (tr instanceof HTMLElement) {
        tr.classList.add('oaao-vault-row-focus');
        tr.setAttribute('aria-current', 'true');
    }
}

/**
 * @param {string} rowKey
 * @param {Record<string, unknown> | null} [node]
 */
function vaultSetResourceListFocusRowKey(rowKey, node = null) {
    vaultRlFocusRowKey =
        rowKey ||
        (node && typeof node === 'object' ? vaultExplorerRowKeyFromNode(node) : '') ||
        '';
    vaultSyncResourceListFocusRow();
}

function vaultClearResourceListFocusRow() {
    vaultRlFocusRowKey = '';
    vaultSyncResourceListFocusRow();
}

/**
 * @param {Element | null | undefined} hit
 */
function vaultResourceListIsSelectionInput(hit) {
    if (!(hit instanceof Element)) return false;

    return !!hit.closest('input.resource-list-row-select, input.resource-list-select-all');
}

/**
 * @param {HTMLElement} tr
 * @param {HTMLElement} rlShell
 * @param {{ setSelectedIds?: (ids: string[]) => void, getSelectedIds?: () => string[] } | null} ctl
 */
function vaultResourceListShiftRangeSelect(tr, rlShell, ctl) {
    if (!ctl || typeof ctl.setSelectedIds !== 'function' || typeof ctl.getSelectedIds !== 'function') return;

    const endKey = tr.dataset.rowKey ?? '';
    if (!endKey) return;

    const rows = rlShell.querySelectorAll('tr.resource-list-row[data-row-key]');
    /** @type {string[]} */
    const keys = [];
    for (const row of rows) {
        if (!(row instanceof HTMLElement)) continue;
        const k = row.dataset.rowKey ?? '';
        if (k) keys.push(k);
    }

    const endIdx = keys.indexOf(endKey);
    if (endIdx < 0) return;

    let startIdx = vaultRlSelectionAnchorKey ? keys.indexOf(vaultRlSelectionAnchorKey) : endIdx;
    if (startIdx < 0) startIdx = endIdx;

    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const rangeKeys = keys.slice(lo, hi + 1);
    ctl.setSelectedIds(rangeKeys);
    vaultRlSelectionAnchorKey = endKey;
}

/**
 * Plain row click opens detail only; Ctrl/Shift or checkbox toggles selection ({@see mountVaultExplorer}).
 *
 * @param {HTMLElement} rlShell
 * @param {AbortSignal} signal
 * @param {Map<string, Record<string, unknown>>} rowNodeByKey
 * @param {{ onInteract?: (ev: { kind: string, node: Record<string, unknown> }) => void }} handlers
 * @param {{ setSelectedIds?: (ids: string[]) => void, getSelectedIds?: () => string[] } | null} ctl
 */
function vaultWireResourceListSelectionGestures(rlShell, signal, rowNodeByKey, handlers, ctl) {
    rlShell.addEventListener(
        'click',
        (ev) => {
            const me = /** @type {MouseEvent} */ (ev);
            if (me.detail !== 1) return;

            const hit = vaultEventTargetElement(ev);
            if (!hit || hit.closest('[data-oaao-vault-drag-handle]')) return;
            if (hit.closest('a,button,textarea,select,label')) return;
            if (hit.closest('th[data-key]')) return;
            if (vaultResourceListIsSelectionInput(hit)) {
                const tr = hit.closest('tr.resource-list-row[data-row-key]');
                if (tr instanceof HTMLElement) {
                    vaultRlSelectionAnchorKey = tr.dataset.rowKey ?? vaultRlSelectionAnchorKey;
                }

                return;
            }

            const tr = vaultClosestResourceListRow(ev);
            if (!(tr instanceof HTMLElement)) return;

            const rowKey = tr.dataset.rowKey ?? '';
            const node = rowNodeByKey.get(rowKey);
            if (!node) return;

            if (me.shiftKey) {
                ev.preventDefault();
                ev.stopPropagation();
                vaultResourceListShiftRangeSelect(tr, rlShell, ctl);

                return;
            }

            if (me.ctrlKey || me.metaKey) {
                vaultRlSelectionAnchorKey = rowKey;

                return;
            }

            ev.preventDefault();
            ev.stopPropagation();

            vaultRlSelectionAnchorKey = rowKey;

            const kind = typeof node.kind === 'string' ? node.kind : '';
            if ((kind === 'document' || kind === 'container') && typeof handlers.onInteract === 'function') {
                vaultSetResourceListFocusRowKey(rowKey);
                handlers.onInteract({ kind, node });
            }
        },
        { capture: true, signal },
    );
}

/** Toolbar file pick — forwards into RazyUI {@code Uploader} ({@see wireVaultRazyUploader}). */
function wireVaultUploadPickPairs(mount, signal) {
    const btn = mount.querySelector('#oaao-vault-toolbar-upload-btn');
    const inp = mount.querySelector('#oaao-vault-toolbar-file-input');
    if (!(btn instanceof HTMLButtonElement) || !(inp instanceof HTMLInputElement)) return;

    btn.setAttribute('aria-label', vaultSidebarUiString('toolbar_upload_aria'));

    btn.addEventListener(
        'click',
        () => {
            if (btn.disabled) return;
            inp.click();
        },
        { signal },
    );

    inp.addEventListener(
        'change',
        () => {
            const files = inp.files;
            if (!files || files.length === 0) return;
            rebuildVaultMultipartFields();
            vaultUploaderInstance?.getControl?.()?.addFiles?.(files);
            inp.value = '';
        },
        { signal },
    );
}

/** @type {{ getControl?: () => { destroy: () => void, clear: () => void, label?: string, addFiles?: (files: FileList) => void } } | null} */
let vaultUploaderInstance = null;

function destroyVaultUploader() {
    vaultDismissUploadToast();
    if (!vaultUploaderInstance || typeof vaultUploaderInstance.getControl !== 'function') return;
    try {
        vaultUploaderInstance.getControl().destroy();
    } catch {
        /* noop */
    }
    vaultUploaderInstance = null;
}

/**
 * @param {HTMLElement} mount
 * @param {number | null} vaultId
 * @param {number | null} containerId
 */
function syncVaultUploadTargets(mount, vaultId, containerId) {
    const vNum = vaultId != null ? Number(vaultId) : NaN;
    const cNum = containerId != null ? Number(containerId) : NaN;
    vaultUploadTargetVaultId = Number.isFinite(vNum) && vNum > 0 ? Math.floor(vNum) : null;
    vaultUploadTargetContainerId = Number.isFinite(cNum) && cNum > 0 ? Math.floor(cNum) : null;
    rebuildVaultMultipartFields();

    const hint = mount.querySelector('[data-oaao-vault-upload-target-hint]');
    if (hint) {
        const vid = vaultUploadTargetVaultId;
        const cid = vaultUploadTargetContainerId;
        if (vid != null && vid > 0) {
            hint.textContent =
                cid != null && cid > 0
                    ? `Upload → vault #${vid}, folder #${cid}`
                    : `Upload → vault #${vid} (root)`;
        } else {
            hint.textContent = 'Upload → default vault (pick a vault/folder in the tree)';
        }
    }
}

async function vaultExplorerRefreshAfterMutation() {
    await vaultInvalidateTreeCacheAsync();
    const refreshOpts = { forceFullTree: true };
    if (typeof vaultExplorerListRefreshRef === 'function') {
        await vaultExplorerListRefreshRef(refreshOpts);
    } else if (typeof vaultExplorerRefreshTreeRef === 'function') {
        await vaultExplorerRefreshTreeRef();
    }
}

/** Pending upload focus when explorer refresh runs before mount or between navigations. */
let vaultPendingUploadFocus = null;

/**
 * Refresh vault tree + ResourceList after upload (lightweight — no full explorer remount).
 *
 * @param {Record<string, unknown>} data upload API {@code data}
 * @param {AbortSignal} signal
 */
async function vaultRefreshListAfterUpload(data, signal) {
    const vidRaw = data.vault_id;
    const cidRaw = data.container_id;
    const docRaw = data.document_id;
    const uploadVaultId = typeof vidRaw === 'number' ? vidRaw : Math.floor(Number(vidRaw ?? NaN));
    const uploadDocId = typeof docRaw === 'number' ? docRaw : Math.floor(Number(docRaw ?? NaN));
    let uploadContainerId = null;
    if (cidRaw != null && cidRaw !== '') {
        const c = typeof cidRaw === 'number' ? cidRaw : Math.floor(Number(cidRaw));
        if (Number.isFinite(c) && c > 0) uploadContainerId = c;
    }

    /** @type {{ vaultId: number, containerId: number | null, documentId?: number | null } | null} */
    const focusUpload =
        Number.isFinite(uploadVaultId) && uploadVaultId > 0
            ? {
                  vaultId: uploadVaultId,
                  containerId: uploadContainerId,
                  ...(Number.isFinite(uploadDocId) && uploadDocId > 0 ? { documentId: uploadDocId } : {}),
              }
            : null;

    vaultInvalidateTreeCache();

    if (typeof vaultExplorerListRefreshRef === 'function') {
        await vaultExplorerListRefreshRef({ focusUpload, forceFullTree: true });
    } else if (typeof vaultExplorerRefreshTreeRef === 'function') {
        vaultPendingUploadFocus = focusUpload;
        await vaultExplorerRefreshTreeRef();
    } else if (focusUpload) {
        vaultPendingUploadFocus = focusUpload;
        document.dispatchEvent(new CustomEvent('oaao-vault-explorer-refresh'));
    }
}

/**
 * After upload refresh — open folder, highlight row, show detail panel.
 *
 * @param {{ vaultId?: number, containerId?: number | null, documentId?: number | null } | null | undefined} focus
 * @param {unknown[]} rows
 * @param {HTMLElement} mount
 * @param {AbortSignal} signal
 */
function vaultFocusUploadedDocumentInExplorer(focus, rows, mount, signal) {
    const docId = Math.floor(Number(focus?.documentId ?? 0));
    if (!Number.isFinite(docId) || docId < 1) return;
    const fresh = vaultFindDocumentNodeById(rows, docId);
    if (!fresh || typeof fresh !== 'object') return;

    const vidRaw = fresh.vault_id ?? focus?.vaultId ?? null;
    const vidNum = typeof vidRaw === 'number' ? vidRaw : Math.floor(Number(vidRaw ?? NaN));
    const cidRaw = fresh.container_id ?? focus?.containerId ?? null;
    const cidNum =
        cidRaw != null && Number.isFinite(Number(cidRaw)) && Number(cidRaw) > 0
            ? Math.floor(Number(cidRaw))
            : null;

    if (Number.isFinite(vidNum) && vidNum > 0) {
        const wantNav = { vaultId: vidNum, containerId: cidNum };
        const validNav = vaultValidateExplorerNav(rows, wantNav);
        const navChanged =
            vaultExplorerNav.vaultId !== validNav.vaultId ||
            vaultExplorerNav.containerId !== validNav.containerId;
        if (navChanged) {
            vaultExplorerNav = validNav;
            vaultPersistStoredExplorerNav();
            if (typeof vaultExplorerRedraw === 'function') {
                vaultExplorerRedraw();
            }
        }
    }

    vaultSetResourceListFocusRowKey('', /** @type {Record<string, unknown>} */ (fresh));
    vaultDetailOpenDocId = docId;
    const dm = mount instanceof HTMLElement ? mount : vaultMountRef;
    const sig = vaultPanelAbort?.signal ?? signal;
    if (dm instanceof HTMLElement && sig && !sig.aborted) {
        renderVaultDetailPanel(/** @type {Record<string, unknown>} */ (fresh), dm, sig);
    }
    /** @param {number} attempt */
    const tryScrollToRow = (attempt) => {
        const tr = vaultExplorerRlShellRef?.querySelector(
            `tr.resource-list-row[data-row-key="document:${docId}"]`,
        );
        if (tr instanceof HTMLElement) {
            tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
        }
        if (attempt < 10) window.setTimeout(() => tryScrollToRow(attempt + 1), 100);
    };
    requestAnimationFrame(() => tryScrollToRow(0));
}

/**
 * @param {Record<string, unknown>} node
 * @returns {Map<string, Record<string, unknown>>}
 */
function vaultExplorerAugmentRowMap(node) {
    const map = new Map(vaultExplorerLatestRowKeys);
    const kind = typeof node.kind === 'string' ? node.kind : '';
    const idNum = typeof node.id === 'number' ? node.id : Math.floor(Number(node.id ?? NaN));
    if ((kind === 'document' || kind === 'container') && Number.isFinite(idNum) && idNum > 0) {
        map.set(`${kind}:${idNum}`, node);
    }

    return map;
}

/**
 * @param {Set<number>} excludeIds
 * @param {Record<string, unknown>} vaultNode
 * @param {'doc' | 'folder'} which
 * @returns {Promise<{ cancelled: true } | { cancelled: false, containerId: number | null }>}
 */
async function vaultPromptMoveFolderTarget(excludeIds, vaultNode, which) {
    const DialogMod = await vaultLoadDialogCtor();
    if (!DialogMod || typeof DialogMod.open !== 'function') return { cancelled: true };

    const options = vaultMoveFolderOptionsFlat(vaultNode, excludeIds);
    const wrap = document.createElement('div');
    const p = document.createElement('p');
    p.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0 mb-2';
    p.textContent = vaultSidebarUiString('move_dialog_hint');
    const sel = document.createElement('select');
    sel.className =
        'w-full min-h-9 rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-2 py-1.5 text-[0.8125rem] font-inherit';
    for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.id == null ? '' : String(o.id);
        opt.textContent = o.label;
        sel.appendChild(opt);
    }
    wrap.append(p, sel);

    return new Promise((resolve) => {
        let settled = false;
        /** @param {{ cancelled: true } | { cancelled: false, containerId: number | null }} result */
        const finish = (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        DialogMod.open({
            title:
                which === 'doc'
                    ? vaultSidebarUiString('move_dialog_title_doc')
                    : vaultSidebarUiString('move_dialog_title_folder'),
            content: wrap,
            size: 'sm',
            onClose: () => finish({ cancelled: true }),
            buttons: [
                {
                    text: vaultSidebarUiString('btn_cancel'),
                    color: 'muted',
                    action: async () => {
                        finish({ cancelled: true });

                        return true;
                    },
                },
                {
                    text: vaultSidebarUiString('action_move'),
                    color: 'accent',
                    action: async () => {
                        const raw = sel.value.trim();
                        if (raw === '') {
                            finish({ cancelled: false, containerId: null });
                        } else {
                            const n = Math.floor(Number(raw));
                            finish({
                                cancelled: false,
                                containerId: Number.isFinite(n) && n > 0 ? n : null,
                            });
                        }

                        return true;
                    },
                },
            ],
        });
    });
}

/**
 * @param {Record<string, unknown>} folderNode
 * @param {HTMLElement} mount
 * @param {AbortSignal} signal
 * @param {(next: { vaultId: number | null, containerId: number | null }) => void} navigate
 */
function renderVaultContainerDetailPanel(folderNode, mount, signal, navigate) {
    vaultDetailOpenDocId = null;
    vaultSetResourceListFocusRowKey('', folderNode);
    const empty = mount.querySelector('[data-oaao-vault-detail-empty]');
    const body = mount.querySelector('[data-oaao-vault-detail-body]');
    const nameEl = mount.querySelector('[data-oaao-vault-detail-name]');
    const metaEl = mount.querySelector('[data-oaao-vault-detail-meta]');
    const actions = mount.querySelector('[data-oaao-vault-detail-actions]');
    const jobNote = mount.querySelector('[data-oaao-vault-detail-job-note]');
    if (!empty || !body || !nameEl || !metaEl || !actions) return;

    empty.classList.add('hidden');
    body.classList.remove('hidden');
    if (jobNote) {
        jobNote.textContent = '';
        jobNote.classList.add('hidden');
    }

    const cid =
        typeof folderNode.id === 'number' ? folderNode.id : Math.floor(Number(folderNode.id ?? NaN));
    const vid =
        typeof folderNode.vault_id === 'number'
            ? folderNode.vault_id
            : Math.floor(Number(folderNode.vault_id ?? NaN));
    const nm = String(folderNode.name ?? '').trim() || `Folder #${cid}`;

    if (!Number.isFinite(cid) || cid < 1 || !Number.isFinite(vid) || vid < 1) return;

    nameEl.textContent = nm;
    metaEl.textContent = vaultSidebarUiString('kind_container');
    actions.textContent = '';

    const vRoot = vaultFindVaultNode(vaultExplorerTreeCache, vid);
    if (!vRoot) return;

    const subtree = vaultCollectDescendantContainerIds(folderNode);

    /** @param {string} labelText @param {string} iconPaths @returns {HTMLButtonElement} */
    const mkBtn = (labelText, iconPaths) => vaultMkDetailIconBtn(labelText, iconPaths);

    const rn = mkBtn(vaultSidebarUiString('action_rename'), VAULT_ICON_RENAME);
    rn.addEventListener(
        'click',
        () => {
            void (async () => {
                const DialogMod = await vaultLoadDialogCtor();
                if (!DialogMod || typeof DialogMod.prompt !== 'function') return;
                rn.disabled = true;
                try {
                    const nn = await DialogMod.prompt(
                        vaultSidebarUiString('rename_folder_title'),
                        vaultSidebarUiString('rename_hint'),
                        { defaultValue: nm },
                    );
                    if (signal.aborted) return;

                    const n2 = typeof nn === 'string' ? nn.trim() : '';
                    if (!n2) return;

                    /** @type {Record<string, unknown>} */
                    const payload = {
                        vault_id: vid,
                        container_id: cid,
                        name: n2,
                    };
                    /** @type {{ success?: boolean, message?: string }} */
                    const j = await vaultPostJson('vault_container_rename', payload, signal);
                    if (!j.success || signal.aborted) {
                        const Toast = await loadVaultToastCtor();
                        Toast?.error(
                            typeof j.message === 'string' && j.message.trim()
                                ? j.message.trim()
                                : vaultSidebarUiString('op_failed'),
                            { duration: 3800, position: 'bottom-right' },
                        );

                        return;
                    }
                    await vaultExplorerRefreshAfterMutation();
                } finally {
                    if (!signal.aborted) rn.disabled = false;
                }
            })();
        },
        { signal },
    );

    const delBtn = mkBtn(vaultSidebarUiString('action_delete'), VAULT_ICON_DELETE);
    delBtn.addEventListener(
        'click',
        () => {
            void (async () => {
                const DialogMod = await vaultLoadDialogCtor();
                if (!DialogMod || typeof DialogMod.confirm !== 'function') return;
                delBtn.disabled = true;
                try {
                    const ok = await DialogMod.confirm(
                        vaultSidebarUiString('action_delete'),
                        vaultSidebarUiString('confirm_delete_folder'),
                    );
                    if (!ok || signal.aborted) return;

                    /** @type {Record<string, unknown>} */
                    const payload = { vault_id: vid, container_id: cid };

                    /** @type {{ success?: boolean, message?: string, data?: { deleted_container_ids?: number[] }}} */
                    const j = await vaultPostJson('vault_container_delete', payload, signal);
                    if (!j.success || signal.aborted) {
                        const Toast = await loadVaultToastCtor();
                        Toast?.error(
                            typeof j.message === 'string' && j.message.trim()
                                ? j.message.trim()
                                : vaultSidebarUiString('op_failed'),
                            { duration: 4600, position: 'bottom-right' },
                        );

                        return;
                    }

                    const dead = Array.isArray(j.data?.deleted_container_ids)
                        ? j.data?.deleted_container_ids
                        : [];
                    const nc = vaultExplorerNav.containerId;
                    if (nc != null && dead.some((id) => typeof id === 'number' && id === nc)) {
                        navigate({ vaultId: vid, containerId: null });
                    }
                    resetVaultDetailPanel(mount);
                    await vaultExplorerRefreshAfterMutation();
                    await vaultToastSuccess('folder_deleted');
                } finally {
                    if (!signal.aborted) delBtn.disabled = false;
                }
            })();
        },
        { signal },
    );

    const mv = mkBtn(vaultSidebarUiString('action_move'), VAULT_ICON_MOVE);
    mv.addEventListener(
        'click',
        () => {
            void (async () => {
                try {
                    const exclude = new Set(subtree);
                    const picked = await vaultPromptMoveFolderTarget(exclude, vRoot, 'folder');
                    if (signal.aborted || picked.cancelled) return;

                    mv.disabled = true;
                    const movePayload =
                        /** @type {{ kind: 'container'; id: number; vault_id: number }} */
                        ({
                            kind: 'container',
                            id: cid,
                            vault_id: vid,
                        });

                    await vaultRunExplorerMove(
                        movePayload,
                        vid,
                        picked.containerId,
                        vaultExplorerAugmentRowMap(folderNode),
                        signal,
                        vaultExplorerRefreshAfterMutation,
                    );
                } finally {
                    if (!signal.aborted) mv.disabled = false;
                }
            })();
        },
        { signal },
    );

    actions.append(vaultMkDetailIconRow(folderNode.research_managed ? [rn, mv] : [rn, delBtn, mv]));
}

/**
 * @param {HTMLElement} mount
 */
function resetVaultDetailPanel(mount) {
    vaultDetailOpenDocId = null;
    vaultClearResourceListFocusRow();
    const empty = mount.querySelector('[data-oaao-vault-detail-empty]');
    const body = mount.querySelector('[data-oaao-vault-detail-body]');
    const note = mount.querySelector('[data-oaao-vault-detail-job-note]');
    const embedNote = mount.querySelector('[data-oaao-vault-detail-embed]');
    const graphNote = mount.querySelector('[data-oaao-vault-detail-graph]');
    const actions = mount.querySelector('[data-oaao-vault-detail-actions]');
    if (empty) empty.classList.remove('hidden');
    if (body) body.classList.add('hidden');
    if (note) {
        note.textContent = '';
        note.classList.add('hidden');
    }
    if (embedNote) {
        embedNote.textContent = '';
        embedNote.classList.add('hidden');
    }
    if (graphNote) {
        graphNote.textContent = '';
        graphNote.classList.add('hidden');
    }
    const embedChunksHost = mount.querySelector('[data-oaao-vault-detail-embed-chunks]');
    if (embedChunksHost instanceof HTMLElement) {
        embedChunksHost.textContent = '';
        embedChunksHost.classList.add('hidden');
    }
    if (actions) actions.textContent = '';
}

/**
 * @param {Record<string, unknown>} docNode
 * @param {HTMLElement} mount
 * @param {AbortSignal} signal
 */
function renderVaultDetailPanel(docNode, mount, signal) {
    const empty = mount.querySelector('[data-oaao-vault-detail-empty]');
    const body = mount.querySelector('[data-oaao-vault-detail-body]');
    const nameEl = mount.querySelector('[data-oaao-vault-detail-name]');
    const metaEl = mount.querySelector('[data-oaao-vault-detail-meta]');
    const actions = mount.querySelector('[data-oaao-vault-detail-actions]');
    const jobNote = mount.querySelector('[data-oaao-vault-detail-job-note]');
    const embedDetail = mount.querySelector('[data-oaao-vault-detail-embed]');
    const embedChunksHost = mount.querySelector('[data-oaao-vault-detail-embed-chunks]');
    const graphDetail = mount.querySelector('[data-oaao-vault-detail-graph]');
    if (!empty || !body || !nameEl || !metaEl || !actions) return;

    empty.classList.add('hidden');
    body.classList.remove('hidden');

    const fileName = String(docNode.file_name ?? '').trim() || `Document #${docNode.id ?? ''}`;
    const mime = typeof docNode.mime_type === 'string' ? docNode.mime_type : '';
    const sz = docNode.byte_size != null ? Number(docNode.byte_size) : null;
    const emb = typeof docNode.embed_status === 'string' ? docNode.embed_status : '';
    const embErrRaw = typeof docNode.embed_error === 'string' ? docNode.embed_error.trim() : '';
    const embAttempts = docNode.embed_attempts != null ? Number(docNode.embed_attempts) : 0;
    const vgm = Number(docNode.vault_graph_mode ?? 0);
    const gStat = typeof docNode.graph_status === 'string' ? docNode.graph_status.trim() : '';
    const gErrRaw = typeof docNode.graph_error === 'string' ? docNode.graph_error.trim() : '';

    const embedStatusLc = typeof emb === 'string' ? emb.trim().toLowerCase() : '';

    /** @type {(string|null)[]} */
    const metaParts = [mime || null, sz != null && Number.isFinite(sz) ? formatVaultByteSize(sz) : null, emb ? `embed: ${emb}` : null];

    if (Number.isFinite(embAttempts) && embAttempts > 0) metaParts.push(`attempts: ${Math.floor(embAttempts)}`);

    if (vgm !== 0) {
        metaParts.push(gStat ? `graph: ${gStat}` : 'graph: —');
    }

    nameEl.textContent = fileName;
    metaEl.textContent = metaParts.filter(Boolean).join(' · ');

    if (embedDetail instanceof HTMLElement) {
        if (embErrRaw !== '') {
            embedDetail.textContent = `${vaultSidebarUiString('detail_embed_heading')}: ${embErrRaw}`;
            embedDetail.classList.remove('hidden');
        } else {
            embedDetail.textContent = '';
            embedDetail.classList.add('hidden');
        }
    }

    if (embedChunksHost instanceof HTMLElement) {
        embedChunksHost.textContent = '';
        embedChunksHost.classList.add('hidden');
    }

    if (graphDetail instanceof HTMLElement) {
        if (vgm !== 0 && gErrRaw !== '') {
            const hint = vaultGraphErrorHint(gErrRaw, docNode);
            graphDetail.textContent = hint
                ? `${vaultSidebarUiString('detail_graph_heading')}: ${gErrRaw}\n${hint}`
                : `${vaultSidebarUiString('detail_graph_heading')}: ${gErrRaw}`;
            graphDetail.classList.remove('hidden');
        } else {
            graphDetail.textContent = '';
            graphDetail.classList.add('hidden');
        }
    }

    actions.textContent = '';
    const docId = typeof docNode.id === 'number' ? docNode.id : Math.floor(Number(docNode.id ?? 0));
    if (!Number.isFinite(docId) || docId < 1) return;

    vaultDetailOpenDocId = docId;
    vaultSetResourceListFocusRowKey('', docNode);

    if (embedStatusLc === 'pending' || embedStatusLc === 'held' || embedStatusLc === 'embedding') {
        vaultEnsureEmbedWatchDoc(docId);
        vaultKickEmbedPollingIfNeeded(signal);
    }

    const vid =
        typeof docNode.vault_id === 'number'
            ? docNode.vault_id
            : Math.floor(Number(docNode.vault_id ?? NaN));

    const rn = vaultMkDetailIconBtn(vaultSidebarUiString('action_rename'), VAULT_ICON_RENAME);
    rn.addEventListener(
        'click',
        () => {
            void (async () => {
                const DialogMod = await vaultLoadDialogCtor();
                if (!DialogMod || typeof DialogMod.prompt !== 'function') return;
                rn.disabled = true;
                try {
                    const nn = await DialogMod.prompt(
                        vaultSidebarUiString('rename_document_title'),
                        vaultSidebarUiString('rename_hint'),
                        { defaultValue: fileName },
                    );
                    if (signal.aborted) return;
                    const n2 = typeof nn === 'string' ? nn.trim() : '';
                    if (!n2) return;

                    /** @type {{ success?: boolean, message?: string }} */
                    const j = await vaultPostJson(
                        'document_rename',
                        { document_id: docId, file_name: n2 },
                        signal,
                    );
                    if (!j.success || signal.aborted) {
                        const Toast = await loadVaultToastCtor();
                        Toast?.error(
                            typeof j.message === 'string' && j.message.trim()
                                ? j.message.trim()
                                : vaultSidebarUiString('op_failed'),
                            { duration: 3800, position: 'bottom-right' },
                        );

                        return;
                    }
                    await vaultExplorerRefreshAfterMutation();
                    const nextNode = /** @type {Record<string, unknown>} */ ({
                        ...docNode,
                        file_name: n2,
                    });
                    renderVaultDetailPanel(nextNode, mount, signal);
                } finally {
                    if (!signal.aborted) rn.disabled = false;
                }
            })();
        },
        { signal },
    );

    const delBtn = vaultMkDetailIconBtn(vaultSidebarUiString('action_delete'), VAULT_ICON_DELETE);
    delBtn.addEventListener(
        'click',
        () => {
            void (async () => {
                const DialogMod = await vaultLoadDialogCtor();
                if (!DialogMod || typeof DialogMod.confirm !== 'function') return;
                delBtn.disabled = true;
                try {
                    const ok = await DialogMod.confirm(
                        vaultSidebarUiString('action_delete'),
                        vaultSidebarUiString('confirm_delete_document'),
                    );
                    if (!ok || signal.aborted) return;

                    /** @type {{ success?: boolean, message?: string }} */
                    const j = await vaultPostJson('document_delete', { document_id: docId }, signal);

                    if (!j.success || signal.aborted) {
                        const Toast = await loadVaultToastCtor();
                        Toast?.error(
                            typeof j.message === 'string' && j.message.trim()
                                ? j.message.trim()
                                : vaultSidebarUiString('op_failed'),
                            { duration: 4600, position: 'bottom-right' },
                        );

                        return;
                    }

                    resetVaultDetailPanel(mount);
                    await vaultExplorerRefreshAfterMutation();
                    await vaultToastSuccess('document_deleted');
                } finally {
                    if (!signal.aborted) delBtn.disabled = false;
                }
            })();
        },
        { signal },
    );

    const mv = vaultMkDetailIconBtn(vaultSidebarUiString('action_move'), VAULT_ICON_MOVE);
    mv.addEventListener(
        'click',
        () => {
            void (async () => {
                if (!Number.isFinite(vid) || vid < 1) return;
                const vRoot = vaultFindVaultNode(vaultExplorerTreeCache, vid);
                if (!vRoot) return;

                try {
                    const picked = await vaultPromptMoveFolderTarget(new Set(), vRoot, 'doc');
                    if (signal.aborted || picked.cancelled) return;

                    mv.disabled = true;

                    const movePayload =
                        /** @type {{ kind: 'document'; id: number; vault_id: number }} */
                        ({
                            kind: 'document',
                            id: docId,
                            vault_id: vid,
                        });

                    await vaultRunExplorerMove(
                        movePayload,
                        vid,
                        picked.containerId,
                        vaultExplorerAugmentRowMap(
                            /** @type {Record<string, unknown>} */ (docNode),
                        ),
                        signal,
                        vaultExplorerRefreshAfterMutation,
                    );
                    renderVaultDetailPanel(
                        /** @type {Record<string, unknown>} */ ({
                            ...docNode,
                            container_id: picked.containerId,
                        }),
                        mount,
                        signal,
                    );
                } finally {
                    if (!signal.aborted) mv.disabled = false;
                }
            })();
        },
        { signal },
    );

    const embedDetailBtn = vaultCreateEmbedDetailButton(docNode, signal);
    const previewBtn = vaultCreateTextPreviewButton(docNode, signal);
    const transcriptBtn = vaultCreateTranscriptButton(docNode, signal);
    const retranscribeBtn = vaultCreateRetranscribeButton(docNode, signal, jobNote, mount);
    const mgmtRow = vaultMkDetailIconRow(docNode.research_managed ? [rn, mv] : [rn, delBtn, mv]);
    if (previewBtn) {
        actions.append(previewBtn);
    }
    if (transcriptBtn) {
        actions.append(transcriptBtn);
    }
    if (retranscribeBtn) {
        actions.append(retranscribeBtn);
    }
    if (embedDetailBtn) {
        actions.append(embedDetailBtn, mgmtRow);
    } else {
        actions.append(mgmtRow);
    }

    const divider = document.createElement('hr');
    divider.className = 'border-0 border-t-[1px] border-solid border-[var(--grid-line)] my-2';
    actions.append(divider);

    const slots = readVaultPurposeActionSlots();
    if (slots.length === 0) {
        const p = document.createElement('p');
        p.className = 'text-[0.72rem] fg-[var(--grid-caption)] m-0';
        p.textContent = 'Purpose allocation slots unavailable — reload after bootstrap.';
        actions.append(p);

        return;
    }

    for (const slot of slots) {
        const pre =
            typeof /** @type {{ purpose_key_prefix?: string }} */ (slot).purpose_key_prefix === 'string'
                ? /** @type {{ purpose_key_prefix: string }} */ (slot).purpose_key_prefix
                : '';
        const hookId = pre ? VAULT_PURPOSE_HOOK_BY_PREFIX[pre] : undefined;
        if (!hookId) continue;

        const label =
            typeof /** @type {{ label?: string }} */ (slot).label === 'string' && /** @type {{ label?: string }} */ (slot).label
                ? String(/** @type {{ label?: string }} */ (slot).label)
                : pre;

        const isEmbedHook = hookId === 'vh.rag.document_embed';
        const isGraphHook = hookId === 'vh.rag.graph_index';
        const graphStatusLc = typeof gStat === 'string' ? gStat.trim().toLowerCase() : '';
        const needsForceReembed =
            isEmbedHook && (embedStatusLc === 'embedding' || embedStatusLc === 'embedded');

        /** @type {string} */
        let embedBtnIdleText = `Run · ${label}`;
        if (isEmbedHook && embedStatusLc === 'embedding') {
            embedBtnIdleText = vaultSidebarUiString('action_requeue_embed');
        } else if (isEmbedHook && embedStatusLc === 'embedded') {
            embedBtnIdleText = `${vaultSidebarUiString('action_reembed')} · ${label}`;
        } else if (isGraphHook && (graphStatusLc === 'failed' || graphStatusLc === 'queued' || graphStatusLc === 'pending')) {
            embedBtnIdleText = vaultSidebarUiString('action_requeue_graph');
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = VAULT_DETAIL_BTN_CLASS;
        btn.textContent = embedBtnIdleText;

        if (isEmbedHook && embedStatusLc === 'pending') {
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            btn.textContent = vaultSidebarUiString('badge_queued');
        }

        btn.addEventListener(
            'click',
            () => {
                void (async () => {
                    if (jobNote) {
                        jobNote.textContent = '';
                        jobNote.classList.add('hidden');
                    }

                    let enqueuedOk = false;
                    try {
                        if (isEmbedHook && embedStatusLc === 'embedding') {
                            const DialogMod = await vaultLoadDialogCtor();
                            if (!DialogMod || typeof DialogMod.confirm !== 'function') return;
                            const ok = await DialogMod.confirm(
                                vaultSidebarUiString('action_requeue_embed'),
                                vaultSidebarUiString('confirm_requeue_embed'),
                            );
                            if (!ok || signal.aborted) return;
                        }

                        vaultSetDetailActionButtonLoading(btn, true);

                        const wid = getOaaoActiveWorkspaceIdForVault();
                        /** @type {Record<string, unknown>} */
                        const payload = { document_id: docId, hook_ids: [hookId] };
                        if (wid != null) payload.workspace_id = wid;
                        if (needsForceReembed) payload.force_reembed = true;

                        const res = await fetch(`${vaultApiBase()}document_enqueue`, {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                            body: JSON.stringify(payload),
                            signal,
                        });
                        /** @type {{ success?: boolean, message?: string }} */
                        const j = await res.json().catch(() => ({}));
                        if (signal.aborted) return;

                        if (jobNote) {
                            jobNote.classList.remove('hidden');
                            jobNote.textContent = j.success
                                ? vaultSidebarUiString('enqueue_ok')
                                : typeof j.message === 'string' && j.message.trim()
                                  ? j.message.trim()
                                  : vaultSidebarUiString('enqueue_fail');
                        }
                        if (j.success && Number.isFinite(docId) && docId > 0) {
                            enqueuedOk = true;
                            vaultTransientDocBadges.set(
                                docId,
                                `${vaultSidebarUiString('badge_queued')} · ${label}`,
                            );
                            vaultEnsureEmbedWatchDoc(docId);
                            /** @type {Record<string, unknown>} */
                            const patch = isGraphHook
                                ? { graph_status: 'pending', graph_error: null }
                                : { embed_status: 'pending', embed_error: null };
                            vaultPatchDocumentNodeInTreeCache(docId, patch);
                            vaultExplorerRedraw();
                            vaultStartEmbedProgressPolling(signal);
                            const fresh = vaultFindDocumentNodeById(vaultExplorerTreeCache, docId);
                            if (fresh) {
                                renderVaultDetailPanel(fresh, mount, signal);
                            }
                        }
                    } catch (e) {
                        if (!signal.aborted && jobNote) {
                            jobNote.classList.remove('hidden');
                            jobNote.textContent = vaultSidebarUiString('enqueue_fail');
                        }
                        console.warn('[oaao vault] document_enqueue failed', e);
                    } finally {
                        if (!enqueuedOk && !signal.aborted && btn.isConnected) {
                            vaultSetDetailActionButtonLoading(btn, false, embedBtnIdleText);
                        }
                    }
                })();
            },
            { signal },
        );
        actions.append(btn);
    }
}

/**
 * @typedef {{ onInteract: (ev: { kind: string, node: Record<string, unknown> }) => void }} VaultTreeHandlers
 */

/**
 * JIT hydrate for Vault browse chrome (explorer table + upload strip utilities).
 *
 * @param {HTMLElement} mount
 */
async function hydrateVaultMountJit(mount) {
    try {
        const JIT = await razyui.load('JIT');
        const root =
            typeof mount.closest === 'function'
                ? mount.closest('.oaao-vault-root')
                : mount.querySelector('.oaao-vault-root');
        if (JIT && typeof JIT.hydrate === 'function') JIT.hydrate(root ?? mount);
    } catch {
        /* optional */
    }
}

/**
 * Root vault overview — cards with counts / RAG flags ({@see mountVaultExplorer}).
 *
 * @param {HTMLElement} rlShell
 * @param {unknown[]} rows
 * @param {(next: { vaultId: number | null, containerId: number | null }) => void} navigate
 * @param {VaultTreeHandlers} handlers
 * @param {AbortSignal} signal
 */
function paintVaultGallery(rlShell, rows, navigate, handlers, signal) {
    rlShell.classList.add('oaao-gallery-card-grid-container');
    const vaultNodes = Array.isArray(rows)
        ? rows.filter(
              (r) =>
                  r &&
                  typeof r === 'object' &&
                  /** @type {{ kind?: string }} */ (r).kind === 'vault',
          )
        : [];

    const hint = document.createElement('p');
    hint.className = 'text-[0.6875rem] fg-[var(--grid-caption)] m-0 px-sm pt-sm shrink-0';
    hint.textContent = vaultSidebarUiString('vault_gallery_hint');

    const grid = document.createElement('div');
    grid.className = 'oaao-vault-gallery oaao-gallery-card-grid';

    rlShell.append(hint, grid);

    const syncCardSelectionClasses = () => {
        for (const el of grid.querySelectorAll('[data-oaao-vault-card-id]')) {
            if (!(el instanceof HTMLElement)) continue;
            const id = Math.floor(Number(el.dataset.oaaoVaultCardId ?? NaN));
            el.classList.toggle(
                'oaao-vault-card--selected',
                vaultGallerySelectedVaultId != null && id === vaultGallerySelectedVaultId,
            );
        }
    };

    /** @param {number} vid @param {Record<string, unknown>} node */
    const applySelect = (vid, node) => {
        vaultGallerySelectedVaultId = vid;
        syncCardSelectionClasses();
        handlers.onInteract({ kind: 'vault', node });
    };

    if (vaultNodes.length === 0) {
        const p = document.createElement('p');
        p.className =
            'oaao-gallery-card-grid-span-full text-[0.8125rem] fg-[var(--grid-caption)] py-md m-0';
        p.textContent = vaultSidebarUiString('empty');
        grid.append(p);

        if (vaultRlDropAbort) wireVaultExplorerDropTarget(grid, vaultRlDropAbort.signal);

        syncVaultExplorerScrollHeights(vaultMountRef ?? rlShell.closest('[data-module="oaao-vault"]') ?? document.body);
        return;
    }

    const lang = vaultSidebarUiLang();

    for (const raw of vaultNodes) {
        const node = /** @type {Record<string, unknown>} */ (raw);
        const vid = typeof node.id === 'number' ? node.id : Math.floor(Number(node.id ?? NaN));
        if (!Number.isFinite(vid) || vid < 1) continue;

        const card = document.createElement('article');
        card.className =
            'oaao-vault-card rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] p-md flex flex-col gap-2 min-h-0 shadow-none cursor-default outline-none transition-colors hover:bg-[var(--grid-line)]/12';
        card.tabIndex = -1;
        card.dataset.oaaoVaultCardId = String(vid);

        const title = document.createElement('h3');
        title.className =
            'text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] m-0 leading-snug truncate';
        title.textContent =
            typeof node.name === 'string' && node.name.trim() ? node.name.trim() : `Vault #${vid}`;

        const descRaw = typeof node.description === 'string' ? node.description.trim() : '';
        const desc = descRaw !== '' ? descRaw : null;

        const fc =
            typeof node.folder_count === 'number'
                ? node.folder_count
                : Math.floor(Number(node.folder_count ?? 0));
        const dc =
            typeof node.document_count === 'number'
                ? node.document_count
                : Math.floor(Number(node.document_count ?? 0));

        const stats = document.createElement('p');
        stats.className = 'text-[0.72rem] fg-[var(--grid-caption)] m-0';
        stats.textContent =
            lang === 'zh-Hant'
                ? `${fc} 個資料夾 · ${dc} 個檔案`
                : `${fc} folders · ${dc} files`;

        const badges = document.createElement('div');
        badges.className = 'oaao-vault-status-chips';

        const ragOn = Number(node.is_enabled ?? 1) === 1;
        const rag = document.createElement('span');
        rag.className = ragOn ? 'oaao-vault-badge oaao-vault-badge--ok' : 'oaao-vault-badge oaao-vault-badge--muted';
        rag.textContent = ragOn ? vaultSidebarUiString('vault_rag_on') : vaultSidebarUiString('vault_rag_off');
        badges.append(rag);

        if (Number(node.graph_mode ?? 0) !== 0) {
            const g = document.createElement('span');
            g.className = 'oaao-vault-badge oaao-vault-badge--muted';
            g.textContent = vaultSidebarUiString('vault_graph_on');
            badges.append(g);
        }

        const footer = document.createElement('div');
        footer.className = 'oaao-vault-btn-row mt-1 pt-0.5';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className =
            'rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 shrink-0 inline-flex items-center justify-center';
        openBtn.textContent = vaultSidebarUiString('vault_card_open');
        openBtn.addEventListener(
            'click',
            (ev) => {
                ev.stopPropagation();
                navigate({ vaultId: vid, containerId: null });
            },
            { signal },
        );

        const configBtn = document.createElement('button');
        configBtn.type = 'button';
        configBtn.dataset.oaaoVaultCardConfig = '1';
        configBtn.className =
            'rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-transparent border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 shrink-0 inline-flex items-center justify-center';
        configBtn.textContent = vaultSidebarUiString('vault_card_config');
        configBtn.addEventListener(
            'click',
            (ev) => {
                ev.stopPropagation();
                void openVaultConfigDialog(node, {
                    signal,
                    onDeleted: () => {
                        if (vaultGallerySelectedVaultId === vid) vaultGallerySelectedVaultId = null;
                        if (vaultExplorerNav.vaultId === vid) navigate({ vaultId: null, containerId: null });
                    },
                });
            },
            { signal },
        );

        footer.append(openBtn, configBtn);

        card.append(title);
        if (desc) {
            const dp = document.createElement('p');
            dp.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)] m-0 leading-snug line-clamp-3';
            dp.textContent = desc;
            card.append(dp);
        }
        card.append(stats, badges, footer);

        card.addEventListener(
            'click',
            (ev) => {
                const t = ev.target;
                if (t instanceof HTMLElement && t.closest('[data-oaao-vault-card-config]')) return;
                if (t instanceof HTMLElement && t.closest('button')) return;
                applySelect(vid, node);
            },
            { signal },
        );

        card.addEventListener(
            'dblclick',
            (ev) => {
                ev.preventDefault();
                navigate({ vaultId: vid, containerId: null });
            },
            { signal },
        );

        grid.append(card);
    }

    syncCardSelectionClasses();
    if (
        vaultGallerySelectedVaultId != null &&
        !vaultNodes.some((v) => {
            const n = /** @type {Record<string, unknown>} */ (v);
            const id = typeof n.id === 'number' ? n.id : Math.floor(Number(n.id ?? NaN));

            return id === vaultGallerySelectedVaultId;
        })
    ) {
        vaultGallerySelectedVaultId = null;
        syncCardSelectionClasses();
    }

    if (vaultRlDropAbort) wireVaultExplorerDropTarget(grid, vaultRlDropAbort.signal);
    syncVaultExplorerScrollHeights(vaultMountRef ?? rlShell.closest('[data-module="oaao-vault"]') ?? document.body);
}

/**
 * OneDrive-style breadcrumb navigation: show immediate children only; double-click vault/folder opens.
 *
 * @param {HTMLElement} host
 * @param {unknown[]} treeRows
 * @param {AbortSignal} signal
 * @param {VaultTreeHandlers} handlers
 * @param {HTMLElement} mount
 */
async function mountVaultExplorer(host, treeRows, signal, handlers, mount) {
    vaultExplorerTreeCache = Array.isArray(treeRows) ? treeRows : [];
    if (vaultExplorerPendingNav !== null) {
        vaultExplorerNav = vaultValidateExplorerNav(vaultExplorerTreeCache, vaultExplorerPendingNav);
        vaultExplorerPendingNav = null;
    } else {
        /** Hash fragment wins over {@code sessionStorage} so links + browser refresh reopen the same folder. */
        let candidateNav = vaultExplorerNav;
        const hNav = vaultReadNavFromLocationHash();
        if (hNav && Number.isFinite(hNav.vaultId) && Math.floor(hNav.vaultId) > 0) {
            candidateNav = { vaultId: Math.floor(hNav.vaultId), containerId: hNav.containerId };
        } else {
            const v0 = candidateNav.vaultId != null ? Number(candidateNav.vaultId) : NaN;
            const hasVault = Number.isFinite(v0) && Math.floor(v0) > 0;
            if (!hasVault) {
                const restored = vaultReadStoredExplorerNav();
                const rv = restored?.vaultId != null ? Number(restored.vaultId) : NaN;
                if (Number.isFinite(rv) && Math.floor(rv) > 0) candidateNav = restored;
            }
        }

        vaultExplorerNav = vaultValidateExplorerNav(vaultExplorerTreeCache, candidateNav);
        vaultPersistStoredExplorerNav();
    }

    vaultExplorerEmbedPollRefreshRef = null;
    vaultExplorerListRefreshRef = null;

    destroyVaultExplorer();
    host.textContent = '';
    host.setAttribute('aria-busy', 'false');
    host.setAttribute('aria-label', vaultSidebarUiString('explorer_region'));

    /** @type {Promise<unknown> | null} */
    let rlCtorPromise = null;
    const loadResourceListCtor = async () => {
        if (!rlCtorPromise) {
            rlCtorPromise = razyui.load('ResourceList').catch((e) => {
                console.warn('[oaao vault] ResourceList load failed', e);

                return null;
            });
        }

        const Ctor = await rlCtorPromise;
        if (signal.aborted) return null;

        return typeof Ctor === 'function' ? /** @type {new (...args: unknown[]) => unknown} */ (Ctor) : null;
    };

    const navEl = document.createElement('nav');
    navEl.setAttribute('aria-label', 'Vault path');

    const rlShell = document.createElement('div');
    rlShell.className = 'oaao-vault-rl-shell flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden';
    vaultExplorerRlShellRef = rlShell;
    const rlChatSourceNote = document.createElement('p');
    rlChatSourceNote.className =
        'hidden shrink-0 m-0 px-sm py-1 text-[0.6875rem] fg-[var(--grid-caption)] leading-snug border-b-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]';
    rlChatSourceNote.setAttribute('data-oaao-vault-chat-source-note', '');
    host.append(navEl, rlShell);
    rlShell.append(rlChatSourceNote);
    vaultBindRlShellScrollSync(mount, rlShell);

    /** @type {Map<string, Record<string, unknown>>} */
    let rowNodeByKey = new Map();

    const applyUploadScopeFromNav = () => {
        const { vaultId, containerId } = vaultExplorerNav;
        const listEl = getWorkspaceVaultSidebarListHost();
        if (vaultId == null) {
            syncVaultUploadTargets(mount, null, null);
            paintWorkspaceVaultSidebarListSelection(listEl, null);

            return;
        }
        syncVaultUploadTargets(mount, vaultId, containerId);
        paintWorkspaceVaultSidebarListSelection(listEl, vaultId);
    };

    /** @param {{ vaultId: number | null, containerId: number | null }} next */
    const navigate = (next) => {
        vaultExplorerNav = vaultValidateExplorerNav(vaultExplorerTreeCache, next);
        vaultPersistStoredExplorerNav();
        resetVaultDetailPanel(mount);
        applyUploadScopeFromNav();
        vaultRenderBreadcrumb(navEl, vaultExplorerTreeCache, vaultExplorerNav, navigate);
        syncVaultExplorerFolderUi(mount);
        void paintTable();
    };
    vaultExplorerNavigateRef = navigate;

    vaultOpenActiveVaultConfigRef = () => {
        const activeVid = vaultExplorerNav.vaultId;
        if (activeVid == null) return;
        const vNode = vaultFindVaultNode(vaultExplorerTreeCache, activeVid);
        if (!vNode) return;
        void openVaultConfigDialog(vNode, {
            signal,
            onDeleted: () => navigate({ vaultId: null, containerId: null }),
        });
    };

    const paintTable = async (opts = {}) => {
        const reuseResourceList = !!opts.reuseResourceList;
        if (signal.aborted) return;

        const children = vaultGetExplorerChildren(vaultExplorerTreeCache, vaultExplorerNav);

        /** @type {Map<string, Record<string, unknown>>} */
        const rowNext = new Map();

        /** @type {Array<Record<string, unknown>>} */
        const flatData = [];

        for (const raw of children) {
            const n = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : {});
            const kind = typeof n.kind === 'string' ? n.kind : '';
            const idRaw = n.id;
            const idNum = typeof idRaw === 'number' ? idRaw : Math.floor(Number(idRaw ?? NaN));
            const rowKey = `${kind}:${Number.isFinite(idNum) && idNum > 0 ? idNum : String(idRaw ?? '')}`;
            rowNext.set(rowKey, n);

            const label =
                kind === 'document'
                    ? String(n.file_name ?? '').trim() || `Document #${n.id ?? ''}`
                    : String(n.name ?? '').trim() || `${kind || 'node'} #${n.id ?? ''}`;

            flatData.push({
                rowKey,
                nameHtml: buildVaultExplorerNameHtml(kind, label),
                kindLabel: vaultExplorerKindLabel(kind),
                sizeLabel: kind === 'document' ? formatVaultByteSize(n.byte_size) : '—',
                statusHtml: vaultBuildStatusHtml(n),
            });
        }

        if (vaultExplorerNav.vaultId === null) {
            if (!reuseResourceList) {
                vaultRlDropAbort?.abort();
                vaultRlDropAbort = new AbortController();
                destroyVaultExplorer();
                vaultClearResourceListFocusRow();
                rlShell.textContent = '';
                paintVaultGallery(rlShell, children, navigate, handlers, signal);
            }

            return;
        }

        /** Reuse mounted ResourceList (embed-status poll); row set reflects new files / status without rewiring gestures. */
        if (
            reuseResourceList &&
            vaultExplorerControl &&
            typeof vaultExplorerControl.setData === 'function'
        ) {
            rowNodeByKey = rowNext;
            vaultExplorerLatestRowKeys = new Map(rowNext);
            const prevSel =
                typeof vaultExplorerControl.getSelectedIds === 'function'
                    ? [...vaultExplorerControl.getSelectedIds()]
                    : [];
            vaultExplorerControl.setData(flatData);
            if (prevSel.length) {
                vaultExplorerControl.setSelectedIds(prevSel.filter((id) => rowNext.has(String(id))));
            }
            vaultSyncResourceListFocusRow();

            syncVaultExplorerScrollHeights(mount);
            vaultBindRlShellScrollSync(mount, rlShell);
            return;
        }

        vaultRlDropAbort?.abort();
        vaultRlDropAbort = new AbortController();

        destroyVaultExplorer();
        rlShell.classList.remove('oaao-gallery-card-grid-container');
        rlShell.textContent = '';
        vaultRlSelectionAnchorKey = '';

        const RLCtor = await loadResourceListCtor();
        if (!RLCtor) {
            const p = document.createElement('p');
            p.className = 'text-[0.8125rem] fg-[var(--grid-caption)] px-sm py-xs m-0';
            p.textContent = vaultSidebarUiString('error');
            rlShell.append(p);

            return;
        }

        rowNodeByKey = rowNext;
        vaultExplorerLatestRowKeys = new Map(rowNext);

        const rl = new RLCtor(rlShell, {
            columns: [
                {
                    key: 'nameHtml',
                    label: vaultSidebarUiString('col_name'),
                    html: true,
                    sortable: false,
                    width: '55%',
                    minWidth: '9rem',
                    ellipsis: true,
                },
                {
                    key: 'sizeLabel',
                    label: vaultSidebarUiString('col_size'),
                    sortable: false,
                    width: '5.5rem',
                    align: 'right',
                    nowrap: true,
                },
                {
                    key: 'statusHtml',
                    label: vaultSidebarUiString('col_status'),
                    html: true,
                    sortable: false,
                    minWidth: '9rem',
                },
            ],
            data: flatData,
            selection: 'multiple',
            selectionCheckboxes: true,
            rowIdKey: 'rowKey',
            emptyMessage: vaultSidebarUiString('empty'),
        });

        vaultExplorerControl = typeof rl?.getControl === 'function' ? rl.getControl() : null;

        const rlEvSig = vaultRlDropAbort.signal;

        vaultWireResourceListSelectionGestures(
            rlShell,
            rlEvSig,
            rowNodeByKey,
            handlers,
            vaultExplorerControl,
        );

        /** Dedupe paired {@code click#2}+{@code dblclick}+pointerdown-double for the same navigable row (not unrelated opens). */
        /** @type {string} */
        let vaultExplorerDedupeNavigateKey = '';
        let vaultExplorerDedupeNavigateAt = 0;

        /**
         * @param {HTMLElement} tr
         * @param {Event | null} ev
         * @returns {boolean}
         */
        const navigateIfExplorerOpenableRow = (tr, ev) => {
            if (
                ev &&
                (ev.type === 'pointerdown' || ev.type === 'click' || ev.type === 'dblclick')
            ) {
                const hit = vaultEventTargetElement(ev);
                if (!hit || hit.closest('[data-oaao-vault-drag-handle]')) return false;
                if (hit.closest('a,button,input,textarea,select,label')) return false;
                if (hit.closest('th[data-key]')) return false;
                const hitTr =
                    vaultClosestResourceListRow(ev instanceof PointerEvent ? ev : /** @type {MouseEvent} */ (ev)) ??
                    /** @type {HTMLElement | null} */ (hit.closest('tr.resource-list-row[data-row-key]'));
                if (!hitTr || hitTr !== tr) return false;
            }

            const key = tr.dataset.rowKey ?? '';
            const node = rowNodeByKey.get(key);
            if (!node) return false;

            const kind = typeof node.kind === 'string' ? node.kind : '';
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

            if (kind === 'vault') {
                const vid = typeof node.id === 'number' ? node.id : Math.floor(Number(node.id ?? NaN));
                if (!Number.isFinite(vid) || vid < 1) return false;

                const dedupe = `vault:${vid}`;
                if (vaultExplorerDedupeNavigateKey === dedupe && now - vaultExplorerDedupeNavigateAt < 520) {
                    ev?.preventDefault?.();
                    ev?.stopPropagation?.();

                    return true;
                }
                ev?.preventDefault?.();
                ev?.stopPropagation?.();

                navigate({ vaultId: vid, containerId: null });
                vaultExplorerDedupeNavigateKey = dedupe;
                vaultExplorerDedupeNavigateAt = now;
                vaultExplorerPtrTwoTap = null;

                return true;
            }
            if (kind === 'container') {
                let vid =
                    typeof node.vault_id === 'number'
                        ? node.vault_id
                        : Math.floor(Number(node.vault_id ?? NaN));
                const navVid =
                    vaultExplorerNav.vaultId != null ? Math.floor(Number(vaultExplorerNav.vaultId)) : NaN;
                if ((!Number.isFinite(vid) || vid < 1) && Number.isFinite(navVid) && navVid > 0) {
                    vid = navVid;
                }
                const cid = typeof node.id === 'number' ? node.id : Math.floor(Number(node.id ?? NaN));
                if (!Number.isFinite(vid) || vid < 1 || !Number.isFinite(cid) || cid < 1) return false;

                const dedupe = `container:${vid}:${cid}`;
                if (vaultExplorerDedupeNavigateKey === dedupe && now - vaultExplorerDedupeNavigateAt < 520) {
                    ev?.preventDefault?.();
                    ev?.stopPropagation?.();

                    return true;
                }
                ev?.preventDefault?.();
                ev?.stopPropagation?.();

                navigate({ vaultId: vid, containerId: cid });
                vaultExplorerDedupeNavigateKey = dedupe;
                vaultExplorerDedupeNavigateAt = now;
                vaultExplorerPtrTwoTap = null;

                return true;
            }

            return false;
        };

        /**
         * @param {Event} ev
         * @returns {boolean}
         */
        const tryOpenRowFromList = (ev) => {
            const hit = vaultEventTargetElement(ev);
            if (!hit || hit.closest('[data-oaao-vault-drag-handle]')) return false;
            if (hit.closest('a,button,input,textarea,select,label')) return false;
            if (hit.closest('th[data-key]')) return false;

            const tr = vaultClosestResourceListRow(ev);
            if (!(tr instanceof HTMLElement)) return false;

            return navigateIfExplorerOpenableRow(tr, ev);
        };

        /** Two quick {@code pointerdown}s — fallback when browsers skip {@code dblclick}; allow touch + mouse. */
        /** @type {{ key: string, t: number } | null} */
        let vaultExplorerPtrTwoTap = null;
        const VAULT_ROW_PTR_DBL_MS = 620;

        const onExplorerPointerHint = (/** @type {PointerEvent} */ ev) => {
            if (!(ev instanceof PointerEvent) || ev.button !== 0 || ev.ctrlKey || ev.metaKey) return;

            const hit = vaultEventTargetElement(ev);
            if (!hit) return;
            if (hit.closest('[data-oaao-vault-drag-handle]')) return;
            if (hit.closest('a,button,input,textarea,select,label')) return;
            if (hit.closest('th[data-key]')) return;

            const tr = /** @type {HTMLElement | null} */ (hit.closest('tr.resource-list-row[data-row-key]'));
            if (!(tr instanceof HTMLElement)) return;

            const key = tr.dataset.rowKey ?? '';
            const node = rowNodeByKey.get(key);
            if (!node) return;

            const kind = typeof node.kind === 'string' ? node.kind : '';
            if (kind !== 'container' && kind !== 'vault') {
                vaultExplorerPtrTwoTap = null;

                return;
            }

            const ts = typeof ev.timeStamp === 'number' && Number.isFinite(ev.timeStamp) ? ev.timeStamp : performance.now();
            const prev = vaultExplorerPtrTwoTap;

            if (prev && prev.key === key && ts - prev.t <= VAULT_ROW_PTR_DBL_MS && ts - prev.t > 8) {
                vaultExplorerPtrTwoTap = null;
                navigateIfExplorerOpenableRow(tr, ev);

                return;
            }

            vaultExplorerPtrTwoTap = { key, t: ts };
        };

        /** Capture on {@link rlShell} runs before ResourceList internal row {@code click} handling. */
        const openGestOpts = /** @type {const} */ ({ signal: rlEvSig, capture: true });

        rlShell.addEventListener('pointerdown', onExplorerPointerHint, openGestOpts);

        rlShell.addEventListener(
            'click',
            (ev) => {
                if (/** @type {MouseEvent} */ (ev).detail !== 2) return;
                void tryOpenRowFromList(ev);
            },
            openGestOpts,
        );

        rlShell.addEventListener(
            'dblclick',
            (ev) => {
                void tryOpenRowFromList(ev);
            },
            openGestOpts,
        );

        rlShell.addEventListener(
            'keydown',
            (ev) => {
                const ke = /** @type {KeyboardEvent} */ (ev);
                if (ke.key !== 'Enter' || ke.defaultPrevented || ke.repeat) return;
                const ctl = vaultExplorerControl;
                const ids = ctl && typeof ctl.getSelectedIds === 'function' ? ctl.getSelectedIds() : [];
                const rowKey =
                    Array.isArray(ids) && ids.length === 1 && typeof ids[0] === 'string' ? ids[0] : '';
                const tr =
                    rowKey !== ''
                        ? rlShell.querySelector(`tr.resource-list-row[data-row-key="${CSS.escape(rowKey)}"]`)
                        : null;
                if (!(tr instanceof HTMLElement)) return;
                if (navigateIfExplorerOpenableRow(tr, ev)) ke.preventDefault();
            },
            openGestOpts,
        );

        rlShell.addEventListener(
            'rui-resource-list:selectionchange',
            (ev) => {
                const detail = /** @type {{ ids?: string[] }} */ (/** @type {CustomEvent} */ (ev).detail || {});
                const ids = Array.isArray(detail.ids) ? detail.ids.map(String) : [];

                vaultSyncChatSourcesFromRowKeys(ids, rowNodeByKey);

                if (rlChatSourceNote.isConnected) {
                    if (ids.length > 0) {
                        rlChatSourceNote.textContent = vaultSidebarUiFormat('chat_sources_selected', {
                            n: String(ids.length),
                        });
                        rlChatSourceNote.classList.remove('hidden');
                    } else {
                        rlChatSourceNote.textContent = vaultSidebarUiString('chat_sources_sync_hint');
                        rlChatSourceNote.classList.add('hidden');
                    }
                }

                /** @type {Record<string, unknown> | null} */
                let focusNode = null;
                /** @type {string} */
                let focusKind = '';
                /** @type {string} */
                let focusRowKey = '';
                for (let i = ids.length - 1; i >= 0; i -= 1) {
                    const node = rowNodeByKey.get(ids[i]);
                    if (!node) continue;
                    const k = typeof node.kind === 'string' ? node.kind : '';
                    if (k === 'document') {
                        focusNode = node;
                        focusKind = 'document';
                        focusRowKey = ids[i];
                        break;
                    }
                }
                if (!focusNode) {
                    for (let i = ids.length - 1; i >= 0; i -= 1) {
                        const node = rowNodeByKey.get(ids[i]);
                        if (!node) continue;
                        const k = typeof node.kind === 'string' ? node.kind : '';
                        if (k === 'container') {
                            focusNode = node;
                            focusKind = 'container';
                            focusRowKey = ids[i];
                            break;
                        }
                    }
                }

                if (focusNode && focusKind) {
                    vaultSetResourceListFocusRowKey(focusRowKey);
                    handlers.onInteract({ kind: focusKind, node: focusNode });
                } else if (ids.length === 0) {
                    resetVaultDetailPanel(mount);
                }
            },
            { signal: rlEvSig },
        );

        if (vaultRlDropAbort) wireVaultExplorerDropTarget(rlShell, vaultRlDropAbort.signal);
        if (vaultRlDropAbort) {
            wireVaultExplorerNodeDragDrop(
                rlShell,
                navEl,
                rowNodeByKey,
                vaultRlDropAbort.signal,
                async () => {
                    if (typeof vaultExplorerRefreshTreeRef === 'function')
                        await vaultExplorerRefreshTreeRef();
                },
            );
        }

        vaultSyncResourceListFocusRow();
        syncVaultExplorerScrollHeights(mount);
        vaultBindRlShellScrollSync(mount, rlShell);
        requestAnimationFrame(() => syncVaultExplorerScrollHeights(mount));
        if (mount instanceof HTMLElement) await hydrateVaultMountJit(mount);
    };

    vaultExplorerRedraw = () => {
        vaultExplorerNav = vaultValidateExplorerNav(vaultExplorerTreeCache, vaultExplorerNav);
        vaultPersistStoredExplorerNav();
        vaultRenderBreadcrumb(navEl, vaultExplorerTreeCache, vaultExplorerNav, navigate);
        syncVaultExplorerFolderUi(mount);
        void paintTable();
    };

    vaultExplorerEmbedPollRefreshRef = async (opts = {}) => {
        if (signal.aborted) return;

        const watchIds = [
            ...vaultEmbedWatchDocIds,
            ...vaultTransientDocBadges.keys(),
        ]
            .map((x) => Math.floor(Number(x)))
            .filter((x) => Number.isFinite(x) && x > 0);
        const forceFullTree = opts?.forceFullTree === true || opts?.focusUpload != null;
        const focus = opts?.focusUpload ?? null;

        if (!forceFullTree && watchIds.length > 0 && vaultExplorerTreeCache.length > 0) {
            // Bulk path: when we're inside a vault view AND watching ≥8 docs,
            // one vault_status call replaces N document_status calls.
            const navVaultId =
                vaultExplorerNav && Number.isFinite(vaultExplorerNav.vaultId)
                    ? Math.floor(Number(vaultExplorerNav.vaultId))
                    : 0;
            let statuses;
            if (navVaultId > 0 && watchIds.length >= 8) {
                const watchSet = new Set(watchIds);
                const bulk = await fetchVaultStatusByVaultJson(navVaultId);
                // Bulk endpoint returns ALL transient docs in the vault — keep
                // only the ones we're actually watching to preserve old
                // patch semantics.
                statuses = bulk.filter(
                    (row) =>
                        row &&
                        typeof row === 'object' &&
                        watchSet.has(Math.floor(Number(/** @type {{ id?: unknown }} */ (row).id ?? 0))),
                );
            } else {
                statuses = await fetchVaultDocumentStatusesJson(watchIds);
            }
            if (signal.aborted) return;
            if (statuses.length > 0) {
                const cache = await loadVaultTreeCacheMod();
                /** @type {Record<string, Record<string, unknown>>} */
                const byId = {};
                for (const raw of statuses) {
                    if (!raw || typeof raw !== 'object') continue;
                    const row = /** @type {Record<string, unknown>} */ (raw);
                    byId[String(row.id ?? '')] = row;
                }
                cache.patchVaultTreeDocumentStatuses(vaultExplorerTreeCache, byId);
                vaultReconcileTransientDocBadges(vaultExplorerTreeCache);
                vaultEmbedWatchReconcile(vaultExplorerTreeCache);
                vaultPersistStoredExplorerNav();
                vaultRenderBreadcrumb(navEl, vaultExplorerTreeCache, vaultExplorerNav, navigate);
                applyUploadScopeFromNav();
                syncVaultExplorerFolderUi(mount);
                renderWorkspaceVaultSidebarList(mount, vaultExplorerTreeCache, signal);
                await paintTable({ reuseResourceList: focus ? false : vaultExplorerNav.vaultId != null });

                if (focus?.documentId && focus.documentId > 0) {
                    vaultFocusUploadedDocumentInExplorer(
                        focus,
                        vaultExplorerTreeCache,
                        vaultMountRef ?? mount,
                        signal,
                    );
                } else {
                    const oid = vaultDetailOpenDocId;
                    const dm = vaultMountRef;
                    const sig = vaultPanelAbort?.signal;
                    if (oid != null && oid > 0 && dm instanceof HTMLElement && sig && !sig.aborted) {
                        const fresh = vaultFindDocumentNodeById(vaultExplorerTreeCache, oid);
                        if (fresh && typeof fresh === 'object') {
                            renderVaultDetailPanel(fresh, dm, sig);
                        }
                    }
                }

                return;
            }
        }

        /** @type {{ success?: boolean, data?: { tree?: unknown[] } }} */
        let j = {};
        try {
            j = /** @type {{ success?: boolean, data?: { tree?: unknown[] } }} */ (
                await fetchVaultTreeJson({ force: true })
            );
        } catch {
            j = {};
        }
        if (signal.aborted || !j?.success) return;
        const rows = Array.isArray(j.data?.tree) ? j.data.tree : [];
        vaultExplorerTreeCache = rows;

        if (focus && Number.isFinite(focus.vaultId) && focus.vaultId > 0) {
            vaultExplorerNav = vaultValidateExplorerNav(rows, {
                vaultId: Math.floor(focus.vaultId),
                containerId: focus.containerId ?? null,
            });
        } else {
            vaultExplorerNav = vaultValidateExplorerNav(rows, vaultExplorerNav);
        }

        vaultReconcileTransientDocBadges(rows);
        vaultEmbedWatchReconcile(rows);
        vaultPersistStoredExplorerNav();
        vaultRenderBreadcrumb(navEl, vaultExplorerTreeCache, vaultExplorerNav, navigate);
        applyUploadScopeFromNav();
        syncVaultExplorerFolderUi(mount);
        renderWorkspaceVaultSidebarList(mount, rows, signal);
        await paintTable({ reuseResourceList: focus ? false : vaultExplorerNav.vaultId != null });

        if (focus?.documentId && focus.documentId > 0) {
            vaultFocusUploadedDocumentInExplorer(focus, rows, mount, signal);
            vaultPendingUploadFocus = null;
        } else if (vaultPendingUploadFocus?.documentId && vaultPendingUploadFocus.documentId > 0) {
            vaultFocusUploadedDocumentInExplorer(vaultPendingUploadFocus, rows, mount, signal);
            vaultPendingUploadFocus = null;
        } else {
            const oid = vaultDetailOpenDocId;
            const dm = vaultMountRef;
            const sig = vaultPanelAbort?.signal;
            if (
                oid != null &&
                oid > 0 &&
                dm instanceof HTMLElement &&
                sig &&
                !sig.aborted
            ) {
                const fresh = vaultFindDocumentNodeById(rows, oid);
                if (fresh && typeof fresh === 'object') {
                    renderVaultDetailPanel(fresh, dm, sig);
                }
            }
        }
    };

    vaultExplorerListRefreshRef = vaultExplorerEmbedPollRefreshRef;

    vaultRenderBreadcrumb(navEl, vaultExplorerTreeCache, vaultExplorerNav, navigate);
    applyUploadScopeFromNav();
    syncVaultExplorerFolderUi(mount);
    await paintTable();
}

/**
 * @param {HTMLElement} host
 * @param {AbortSignal} signal
 * @param {HTMLElement} mount
 * @param {VaultTreeHandlers} handlers
 */
async function loadVaultMainTree(host, signal, mount, handlers) {
    host.textContent = '';
    host.setAttribute('aria-busy', 'true');
    oaaoMountLoadingLogo(host, { block: true, label: vaultSidebarUiString('loading') });

    /** @type {{ success?: boolean, data?: { tree?: unknown[] } }} */
    let j = {};
    const widBefore = getOaaoActiveWorkspaceIdForVault();
    try {
        j = /** @type {{ success?: boolean, data?: { tree?: unknown[] } }} */ (
            await fetchVaultTreeJson({ force: true })
        );
    } catch {
        j = {};
    }
    if (!j?.success && widBefore != null && getOaaoActiveWorkspaceIdForVault() === null) {
        try {
            j = /** @type {{ success?: boolean, data?: { tree?: unknown[] } }} */ (
                await fetchVaultTreeJson({ force: true })
            );
        } catch {
            j = {};
        }
    }

    if (signal.aborted) return;

    host.textContent = '';
    host.setAttribute('aria-busy', 'false');

    if (!j?.success) {
        destroyVaultExplorer();
        vaultExplorerTreeCache = [];
        vaultExplorerNav = { vaultId: null, containerId: null };
        vaultExplorerPendingNav = null;
        vaultExplorerRedraw = () => {};
        vaultExplorerEmbedPollRefreshRef = null;
        vaultExplorerListRefreshRef = null;
        vaultTransientDocBadges.clear();
        vaultEmbedWatchDocIds.clear();
        vaultDetailOpenDocId = null;
        syncVaultExplorerFolderUi(mount);
        const err = document.createElement('p');
        err.className = 'text-[0.8125rem] fg-[var(--grid-caption)] px-sm py-xs m-0';
        err.textContent = vaultSidebarUiString('error');
        host.append(err);
        renderWorkspaceVaultSidebarList(mount, [], signal);

        return;
    }

    const rows = Array.isArray(j.data?.tree) ? j.data.tree : [];
    vaultReconcileTransientDocBadges(rows);
    vaultEmbedWatchReconcile(rows);
    renderWorkspaceVaultSidebarList(mount, rows, signal);

    await mountVaultExplorer(host, rows, signal, handlers, mount);
}

/** Vault multipart upload cap — keep aligned with document_upload.php (100 MiB). */
const VAULT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/**
 * @param {HTMLElement} mount
 * @param {AbortSignal} signal
 * @param {() => Promise<void>} refreshTree
 */
async function wireVaultRazyUploader(mount, signal, refreshTree) {
    const host = mount.querySelector('[data-oaao-vault-uploader-host]');
    if (!(host instanceof HTMLElement)) return;

    destroyVaultUploader();
    host.innerHTML = '';

    const UploaderCtor = await razyui.load('Uploader');
    if (signal.aborted) return;
    if (typeof UploaderCtor !== 'function') return;

    rebuildVaultMultipartFields();

    const ariaSrc = mount.querySelector('[data-oaao-vault-upload-aria-source]');
    const ariaLabel = ariaSrc?.textContent?.trim() || 'Upload files';

    vaultUploaderInstance = new UploaderCtor(host, {
        url: `${vaultApiBase()}document_upload`,
        method: 'POST',
        name: 'file',
        auto: true,
        dropZone: true,
        multiple: true,
        placeholder: vaultSidebarUiString('upload_placeholder_compact'),
        data: vaultUploadMultipartFields,
        /** @param {File} file */
        onUpload(file) {
            if (file.size > VAULT_UPLOAD_MAX_BYTES) {
                vaultDismissUploadToast();
                void (async () => {
                    const Toast = await loadVaultToastCtor();
                    Toast?.error(`File too large (max 100 MiB) · ${file.name}`, {
                        duration: 4600,
                        position: 'bottom-right',
                    });
                })();
                return;
            }
            rebuildVaultMultipartFields();
            vaultDismissUploadToast();
            void vaultToastUploadProgress(file.name, 0);
        },
        /** @param {File} file @param {number} progress */
        onProgress(file, progress) {
            void vaultToastUploadProgress(file.name, progress);
        },
        /** @param {File} file @param {unknown} response */
        onComplete(file, response) {
            void (async () => {
                vaultDismissUploadToast();
                /** @type {{ success?: boolean, message?: string, data?: unknown }} */
                const j =
                    typeof response === 'object' && response !== null
                        ? /** @type {{ success?: boolean, message?: string, data?: unknown }} */ (response)
                        : {};

                const Toast = await loadVaultToastCtor();
                const okOpts = /** @type {const} */ ({ duration: 3200, position: 'bottom-right' });

                if (j.success) {
                    Toast?.success(`${vaultSidebarUiString('upload_ok')} · ${file.name}`, okOpts);
                    vaultUploaderInstance?.getControl?.()?.clear?.();

                    const data =
                        typeof j.data === 'object' && j.data !== null
                            ? /** @type {Record<string, unknown>} */ (j.data)
                            : {};

                    vaultInvalidateTreeCache();
                    await vaultRefreshListAfterUpload(data, signal);

                    const docRaw = data.document_id;
                    const docIdUp =
                        typeof docRaw === 'number' ? docRaw : Math.floor(Number(docRaw ?? NaN));
                    const jq = data.jobs_queued;
                    const hooks = Array.isArray(jq) ? jq : [];
                    let queuedEmbed = false;
                    for (const row of hooks) {
                        if (!row || typeof row !== 'object') continue;
                        const hid = /** @type {{ hook_id?: unknown }} */ (row).hook_id;
                        if (hid === 'vh.rag.document_embed') {
                            queuedEmbed = true;
                            break;
                        }
                    }
                    if (queuedEmbed && Number.isFinite(docIdUp) && docIdUp > 0) {
                        vaultEnsureEmbedWatchDoc(docIdUp);
                        vaultTransientDocBadges.set(
                            docIdUp,
                            `${vaultSidebarUiString('badge_queued')} · upload`,
                        );
                        vaultKickEmbedPollingIfNeeded(signal);
                    }
                } else {
                    const errMsg =
                        typeof j.message === 'string' && j.message.trim()
                            ? j.message.trim()
                            : vaultSidebarUiString('upload_fail');
                    Toast?.error(`${errMsg} · ${file.name}`, { duration: 5200, position: 'bottom-right' });
                }
            })();
        },
        /** @param {File} file @param {string} [message] */
        onError(file, message) {
            void (async () => {
                vaultDismissUploadToast();
                const Toast = await loadVaultToastCtor();
                const detail =
                    typeof message === 'string' && message.trim()
                        ? message.trim()
                        : vaultSidebarUiString('upload_fail');
                const name = file && typeof file.name === 'string' ? file.name : '';
                Toast?.error(name ? `${detail} · ${name}` : detail, {
                    duration: 4800,
                    position: 'bottom-right',
                });
            })();
        },
    });

    const ctrl = vaultUploaderInstance?.getControl?.();
    if (ctrl) ctrl.label = ariaLabel;

    if (signal.aborted) {
        destroyVaultUploader();
    }
}

/**
 * @param {AbortSignal} signal
 * @param {HTMLElement} mount
 * @param {() => Promise<void>} refreshTree
 */
function wireVaultNewFolder(signal, mount, refreshTree) {
    const input = mount.querySelector('#oaao-vault-new-folder-input');
    const btn = mount.querySelector('#oaao-vault-new-folder-btn');
    const note = mount.querySelector('#oaao-vault-new-folder-note');
    if (!(input instanceof HTMLInputElement) || !(btn instanceof HTMLButtonElement)) return;

    /** @param {string} text @param {boolean} visible */
    const setNote = (text, visible) => {
        if (!note) return;
        note.textContent = text;
        note.classList.toggle('hidden', !visible);
    };

    const submit = async () => {
        const vid = vaultExplorerNav.vaultId;
        if (vid == null || vid < 1) return;

        const nm = input.value.trim();
        if (!nm) {
            setNote(vaultSidebarUiString('folder_name_required'), true);

            return;
        }
        setNote('', false);
        const prevDisabled = btn.disabled;
        btn.disabled = true;
        try {
            const wid = getOaaoActiveWorkspaceIdForVault();
            const parent = vaultExplorerNav.containerId;
            /** @type {Record<string, unknown>} */
            const payload = { vault_id: vid, name: nm };
            if (wid != null) payload.workspace_id = wid;
            if (parent != null && parent > 0) payload.parent_container_id = parent;

            const res = await fetch(`${vaultApiBase()}vault_container_create`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(payload),
                signal,
            });
            /** @type {{ success?: boolean, message?: string, data?: { container_id?: unknown } }} */
            const j = await res.json().catch(() => ({}));
            if (signal.aborted) return;

            if (!j.success) {
                const msg =
                    typeof j.message === 'string' && j.message.trim()
                        ? j.message.trim()
                        : vaultSidebarUiString('error');
                setNote(msg, true);

                return;
            }

            input.value = '';
            await vaultExplorerRefreshAfterMutation();
            await vaultToastSuccess('folder_created');
        } catch {
            if (!signal.aborted) setNote(vaultSidebarUiString('error'), true);
        } finally {
            if (!signal.aborted) btn.disabled = prevDisabled;
        }
    };

    btn.addEventListener(
        'click',
        () => {
            void submit();
        },
        { signal },
    );
    input.addEventListener(
        'keydown',
        (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                void submit();
            }
        },
        { signal },
    );
}

function getWorkspaceVaultSidebarListHost() {
    const el = document.getElementById('workspace-vault-list');

    return el instanceof HTMLElement ? el : null;
}

function cleanupWorkspaceVaultSidebarList() {
    const host = getWorkspaceVaultSidebarListHost();
    const wrap = document.getElementById('workspace-vault-list-wrap');
    if (host) host.textContent = '';
    if (wrap) wrap.classList.add('hidden');
}

/**
 * @param {HTMLElement | null} listHost
 * @param {number | null} vaultIdMaybe
 */
function paintWorkspaceVaultSidebarListSelection(listHost, vaultIdMaybe) {
    if (!listHost) return;
    const want = vaultIdMaybe != null && vaultIdMaybe > 0 ? Math.floor(vaultIdMaybe) : null;
    for (const btn of listHost.querySelectorAll('button[data-oaao-vault-id]')) {
        if (!(btn instanceof HTMLButtonElement)) continue;
        const id = Math.floor(Number(btn.dataset.oaaoVaultId ?? 0));
        btn.classList.toggle('oaao-vault-menu-active', want !== null && id === want);
    }
}

/**
 * @param {HTMLElement} mount
 * @param {unknown[]} treeRows
 * @param {AbortSignal} signal
 */
function renderWorkspaceVaultSidebarList(mount, treeRows, signal) {
    const host = getWorkspaceVaultSidebarListHost();
    const wrap = document.getElementById('workspace-vault-list-wrap');
    if (!host || !wrap) return;

    host.textContent = '';
    const rows = Array.isArray(treeRows) ? treeRows : [];
    const vaultNodes = rows.filter(
        (r) => r && typeof r === 'object' && /** @type {{ kind?: string }} */ (r).kind === 'vault',
    );

    if (vaultNodes.length === 0) {
        wrap.classList.add('hidden');

        return;
    }

    wrap.classList.remove('hidden');

    for (const raw of vaultNodes) {
        const vn = /** @type {Record<string, unknown>} */ (raw);
        const vid = typeof vn.id === 'number' ? vn.id : Math.floor(Number(vn.id ?? 0));
        const name = String(vn.name ?? '').trim() || `Vault #${vid}`;
        if (!Number.isFinite(vid) || vid < 1) continue;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'listitem');
        btn.dataset.oaaoVaultId = String(vid);
        btn.className =
            'w-full text-left px-sm py-1.5 rounded-[8px] text-[0.8125rem] fg-[var(--grid-ink)] bg-transparent border-none cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 truncate min-w-0';
        btn.textContent = name;
        btn.addEventListener(
            'click',
            () => {
                vaultExplorerNav = vaultValidateExplorerNav(vaultExplorerTreeCache, {
                    vaultId: vid,
                    containerId: null,
                });
                vaultExplorerRedraw();
                syncVaultUploadTargets(mount, vid, null);
                resetVaultDetailPanel(mount);
                paintWorkspaceVaultSidebarListSelection(host, vid);
            },
            { signal },
        );
        host.append(btn);
    }

    const cur = vaultUploadTargetVaultId;
    paintWorkspaceVaultSidebarListSelection(host, cur != null && cur > 0 ? cur : null);
}

/** @type {ResizeObserver | null} */
let vaultBrowseLayoutObserver = null;

/**
 * Inline grid placement — survives stale {@code oaao.css} / JIT flex overrides on production.
 *
 * @param {HTMLElement} mount
 * @param {AbortSignal} signal
 */
function wireVaultBrowseLayout(mount, signal) {
    vaultBrowseLayoutObserver?.disconnect();
    vaultBrowseLayoutObserver = null;
    vaultRlShellScrollObserver?.disconnect();
    vaultRlShellScrollObserver = null;

    const body = mount.querySelector('.oaao-vault-browse-body');
    const explorer = mount.querySelector('.oaao-vault-browse-body > .oaao-vault-explorer-column');
    const aside = mount.querySelector('.oaao-vault-browse-body > .oaao-vault-document-detail');
    if (!(body instanceof HTMLElement) || !(explorer instanceof HTMLElement) || !(aside instanceof HTMLElement)) {
        return;
    }

    const apply = () => {
        const wide = body.clientWidth >= 768;
        body.style.setProperty('display', 'grid', 'important');
        body.style.width = '100%';
        body.style.boxSizing = 'border-box';
        body.style.setProperty('flex', '1 1 0%', 'important');
        body.style.height = '0';
        body.style.minHeight = '0';
        body.style.minWidth = '0';
        body.style.overflow = 'hidden';
        explorer.style.display = 'flex';
        explorer.style.flexDirection = 'column';
        explorer.style.flex = '1 1 0%';
        explorer.style.minWidth = '0';
        explorer.style.minHeight = '0';
        explorer.style.overflow = 'hidden';

        const treeHost = explorer.querySelector('[data-oaao-vault="tree-main-host"]');
        if (treeHost instanceof HTMLElement) {
            treeHost.style.display = 'flex';
            treeHost.style.flexDirection = 'column';
            treeHost.style.flex = '1 1 0%';
            treeHost.style.minHeight = '0';
            treeHost.style.minWidth = '0';
            treeHost.style.overflow = 'hidden';
        }

        aside.style.display = 'flex';
        aside.style.flexDirection = 'column';
        aside.style.overflow = 'hidden';
        aside.style.minWidth = '0';
        aside.style.minHeight = '0';

        if (wide) {
            body.style.setProperty('grid-template-columns', 'minmax(0, 1fr) 280px', 'important');
            body.style.gridTemplateRows = 'minmax(0, 1fr)';
            explorer.style.gridColumn = '1';
            explorer.style.gridRow = '1';
            explorer.style.width = '100%';
            aside.style.gridColumn = '2';
            aside.style.gridRow = '1';
            aside.style.width = '100%';
            aside.style.maxWidth = '280px';
            aside.style.justifySelf = 'stretch';
            aside.style.maxHeight = 'none';
            aside.style.borderTop = '';
            aside.style.borderLeft = '1px solid var(--grid-line)';
        } else {
            body.style.setProperty('grid-template-columns', 'minmax(0, 1fr)', 'important');
            body.style.gridTemplateRows = 'minmax(0, 1fr) auto';
            explorer.style.gridColumn = '1';
            explorer.style.gridRow = '1';
            explorer.style.width = '100%';
            aside.style.gridColumn = '1';
            aside.style.gridRow = '2';
            aside.style.width = '100%';
            aside.style.maxWidth = 'none';
            aside.style.justifySelf = 'stretch';
            aside.style.maxHeight = '42vh';
            aside.style.borderLeft = '';
            aside.style.borderTop = '1px solid var(--grid-line)';
        }

        syncVaultExplorerScrollHeights(mount);
    };

    const scheduleApply = () => {
        apply();
        requestAnimationFrame(apply);
    };

    scheduleApply();
    if (typeof ResizeObserver === 'function') {
        vaultBrowseLayoutObserver = new ResizeObserver(() => scheduleApply());
        vaultBrowseLayoutObserver.observe(body);
        vaultBrowseLayoutObserver.observe(explorer);
        const treeHost = explorer.querySelector('[data-oaao-vault="tree-main-host"]');
        if (treeHost instanceof HTMLElement) vaultBrowseLayoutObserver.observe(treeHost);
        const workspaceContent = document.getElementById('workspace-content');
        if (workspaceContent instanceof HTMLElement) vaultBrowseLayoutObserver.observe(workspaceContent);
        if (vaultExplorerRlShellRef instanceof HTMLElement) {
            vaultBrowseLayoutObserver.observe(vaultExplorerRlShellRef);
        }
    }
    window.addEventListener('resize', scheduleApply, { signal });
    signal.addEventListener(
        'abort',
        () => {
            vaultBrowseLayoutObserver?.disconnect();
            vaultBrowseLayoutObserver = null;
        },
        { once: true },
    );
}

/** @type {(() => void) | null} */
let vaultResizeTeardown = null;

/** @type {AbortController | null} */
let vaultPanelAbort = null;

/** @type {HTMLElement | null} */
let vaultMountRef = null;

/** @param {{ preserveConversationSidebar?: boolean }} [_options] — ignored; keeps parity with chat shell teardown signature. */
export function teardownShellPanel(_options = {}) {
    vaultPanelAbort?.abort();
    vaultPanelAbort = null;

    vaultRlDropAbort?.abort();
    vaultRlDropAbort = null;

    vaultClearEmbedProgressTimer();

    vaultDismissUploadToast();
    destroyVaultUploader();
    destroyVaultExplorer();
    vaultTransientDocBadges.clear();
    vaultEmbedWatchDocIds.clear();
    vaultDetailOpenDocId = null;
    vaultExplorerTreeCache = [];
    vaultExplorerNav = { vaultId: null, containerId: null };
    vaultExplorerPendingNav = null;
    vaultGallerySelectedVaultId = null;
    vaultExplorerRefreshTreeRef = null;
    if ('__oaaoVaultExplorerRefreshTree' in globalThis) {
        delete globalThis.__oaaoVaultExplorerRefreshTree;
    }
    vaultExplorerEmbedPollRefreshRef = null;
    vaultExplorerListRefreshRef = null;
    vaultExplorerRedraw = () => {};
    vaultExplorerNavigateRef = () => {};
    vaultOpenActiveVaultConfigRef = null;
    vaultBreadcrumbDnDWire = null;
    vaultNodeDragPayload = null;
    vaultExplorerLatestRowKeys = new Map();
    vaultUploadTargetVaultId = null;
    vaultUploadTargetContainerId = null;
    rebuildVaultMultipartFields();

    if (vaultMountRef) {
        const tree = vaultMountRef.querySelector('[data-oaao-vault="tree-main-host"]');
        if (tree instanceof HTMLElement) {
            tree.textContent = '';
            tree.setAttribute('aria-busy', 'false');
        }
        resetVaultDetailPanel(vaultMountRef);
        const uploadNote = vaultMountRef.querySelector('[data-oaao-vault-upload-note]');
        if (uploadNote) {
            uploadNote.textContent = '';
            uploadNote.classList.add('hidden');
        }
    }
    vaultMountRef = null;

    const vNote = document.getElementById('workspace-vault-create-note');
    if (vNote) {
        vNote.textContent = '';
        vNote.classList.add('hidden');
    }
    const vIn = document.getElementById('workspace-vault-create-input');
    if (vIn instanceof HTMLInputElement) vIn.value = '';
    const vBtn = document.getElementById('workspace-vault-create-btn');
    if (vBtn instanceof HTMLButtonElement) vBtn.disabled = false;

    if (typeof vaultResizeTeardown === 'function') {
        vaultResizeTeardown();
        vaultResizeTeardown = null;
    }

    vaultBrowseLayoutObserver?.disconnect();
    vaultBrowseLayoutObserver = null;
    vaultRlShellScrollObserver?.disconnect();
    vaultRlShellScrollObserver = null;

    cleanupWorkspaceVaultSidebarList();
}

/**
 * @param {HTMLElement} mount
 */
export async function mountShellPanel(mount) {
    teardownShellPanel();
    vaultPanelAbort = new AbortController();
    const { signal } = vaultPanelAbort;
    vaultMountRef = mount;

    syncVaultUploadTargets(mount, null, null);
    resetVaultDetailPanel(mount);
    wireVaultBrowseLayout(mount, signal);

    const treeHandlers = {
        /** @param {{ kind: string, node: Record<string, unknown> }} ev */
        onInteract(ev) {
            const listEl = getWorkspaceVaultSidebarListHost();
            if (ev.kind === 'vault') {
                const vid = typeof ev.node.id === 'number' ? ev.node.id : Math.floor(Number(ev.node.id ?? 0));
                const vOk = Number.isFinite(vid) && vid > 0 ? vid : null;
                syncVaultUploadTargets(mount, vOk, null);
                resetVaultDetailPanel(mount);
                paintWorkspaceVaultSidebarListSelection(listEl, vOk);

                return;
            }
            if (ev.kind === 'container') {
                const vid =
                    typeof ev.node.vault_id === 'number'
                        ? ev.node.vault_id
                        : Math.floor(Number(ev.node.vault_id ?? NaN));
                const cid = typeof ev.node.id === 'number' ? ev.node.id : Math.floor(Number(ev.node.id ?? NaN));
                const vSel = Number.isFinite(vid) && vid > 0 ? vid : null;
                syncVaultUploadTargets(
                    mount,
                    vSel,
                    Number.isFinite(cid) && cid > 0 ? cid : null,
                );
                renderVaultContainerDetailPanel(
                    /** @type {Record<string, unknown>} */ (ev.node),
                    mount,
                    signal,
                    vaultExplorerNavigateRef,
                );
                paintWorkspaceVaultSidebarListSelection(listEl, vSel);

                return;
            }
            if (ev.kind === 'document') {
                const listEl = getWorkspaceVaultSidebarListHost();
                const vid =
                    typeof ev.node.vault_id === 'number'
                        ? ev.node.vault_id
                        : Math.floor(Number(ev.node.vault_id ?? NaN));
                if (Number.isFinite(vid) && vid > 0) {
                    paintWorkspaceVaultSidebarListSelection(listEl, vid);
                }
                renderVaultDetailPanel(ev.node, mount, signal);
            }
        },
    };

    const refreshTree = async () => {
        vaultInvalidateTreeCache();
        const host = mount.querySelector('[data-oaao-vault="tree-main-host"]');
        if (host instanceof HTMLElement) {
            await loadVaultMainTree(host, signal, mount, treeHandlers);
            await hydrateVaultMountJit(mount);
        }
    };

    vaultExplorerRefreshTreeRef = refreshTree;
    globalThis.__oaaoVaultExplorerRefreshTree = refreshTree;

    /** Manual hash edits (or tools) while Vault is mounted: reopen matching folder without full reload. */
    const onVaultExplorerFragmentChange = () => {
        if (vaultApplyingHashWrites) return;
        const parsed = vaultReadNavFromLocationHash();
        if (!parsed) return;
        vaultExplorerPendingNav = { vaultId: parsed.vaultId, containerId: parsed.containerId };
        void refreshTree();
    };
    window.addEventListener('hashchange', onVaultExplorerFragmentChange, { signal });

    wireVaultNewFolder(signal, mount, refreshTree);
    await wireVaultRazyUploader(mount, signal, refreshTree);
    wireVaultUploadPickPairs(mount, signal);

    const treeHost = mount.querySelector('[data-oaao-vault="tree-main-host"]');
    if (treeHost instanceof HTMLElement) {
        await loadVaultMainTree(treeHost, signal, mount, treeHandlers);
    }

    const onScopeChange = () => {
        void refreshTree();
    };
    window.addEventListener('oaao-workspace-scope-changed', onScopeChange, { signal });

    const onResize = () => {
        /* Reserved — JIT hydrate hook when vault chrome grows */
    };
    window.addEventListener('resize', onResize);
    vaultResizeTeardown = () => window.removeEventListener('resize', onResize);

    await hydrateVaultMountJit(mount);
    wireVaultBrowseLayout(mount, signal);
}

/** Chat RAG citations → transcript dialog with optional seek ({@see rag-citations.js}). */
if (typeof document !== 'undefined') {
    document.addEventListener('oaao-vault-explorer-refresh', () => {
        void vaultExplorerRefreshTreeRef?.();
    });

    document.addEventListener('oaao:open-vault-transcript', (ev) => {
        const detail = ev && typeof ev.detail === 'object' && ev.detail !== null ? ev.detail : {};
        const docId = Math.floor(Number(detail.document_id ?? detail.documentId ?? 0));
        if (!Number.isFinite(docId) || docId < 1) return;
        const fileName = typeof detail.file_name === 'string' ? detail.file_name.trim() : '';
        const beginMs = Math.max(0, Math.floor(Number(detail.begin_ms ?? 0)));
        const docNode = { id: docId, file_name: fileName || `Document #${docId}` };
        const signal = vaultPanelAbort?.signal ?? new AbortController().signal;
        void vaultOpenTranscriptDialog(docNode, signal, { initialBeginMs: beginMs });
    });
}
