/**
 * RAG pipeline block — referenced vault files ({@code kind: message_block}, {@code message_zone: after}).
 *
 * @module oaaoai/rag/rag-citations
 */

import { oaaoT } from '../../../core/default/js/oaao-i18n.js';

/** @type {Promise<typeof import('../../../core/default/webassets/js/vault-tree-cache.js')> | null} */
let cacheModPromise = null;

/** @type {Map<string, { file_name: string, vault_name: string, path: string }> | null} */
let citationIndexCache = null;

function oaaoPrefixedSitePath(pathOnly) {
    const raw = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    const path = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
    if (!raw || raw === '/') return path;
    const prefix = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/{2,}/g, '/').replace(/\/$/, '');
    if (!prefix) return path;
    if (path === prefix || path.startsWith(`${prefix}/`)) return path;

    return `${prefix}${path}`;
}

function vaultApiBaseForCitations() {
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

function activeWorkspaceIdForCitations() {
    const root = document.getElementById('workspace-view');
    const ds =
        typeof root?.dataset?.oaaoActiveWorkspaceId === 'string' ? root.dataset.oaaoActiveWorkspaceId.trim() : '';
    if (!ds) return null;
    const n = Number(ds);

    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function loadCacheMod() {
    if (!cacheModPromise) {
        const url = oaaoPrefixedSitePath('/webassets/core/default/js/vault-tree-cache.js');
        cacheModPromise = import(/* webpackIgnore: true */ url);
    }

    return cacheModPromise;
}

/**
 * @param {unknown[]} children
 * @param {number} vaultId
 * @param {string} vaultName
 * @param {string} pathPrefix
 * @param {Map<string, { file_name: string, vault_name: string, path: string }>} index
 */
function walkVaultTreeForCitationIndex(children, vaultId, vaultName, pathPrefix, index) {
    if (!Array.isArray(children)) return;
    for (const raw of children) {
        if (!raw || typeof raw !== 'object') continue;
        const node = /** @type {Record<string, unknown>} */ (raw);
        const kind = String(node.kind ?? '');
        if (kind === 'container') {
            const cid = Number(node.id);
            if (!Number.isFinite(cid) || cid < 1) continue;
            const nm = typeof node.name === 'string' && node.name.trim() ? node.name.trim() : `Folder ${cid}`;
            const nextPath = pathPrefix ? `${pathPrefix} › ${nm}` : nm;
            walkVaultTreeForCitationIndex(
                Array.isArray(node.children) ? node.children : [],
                vaultId,
                vaultName,
                nextPath,
                index,
            );
        } else if (kind === 'document') {
            const did = Number(node.id);
            if (!Number.isFinite(did) || did < 1) continue;
            const fn =
                typeof node.file_name === 'string' && node.file_name.trim()
                    ? node.file_name.trim()
                    : `Document #${did}`;
            index.set(`${vaultId}:${did}`, {
                file_name: fn,
                vault_name: vaultName,
                path: pathPrefix,
            });
        }
    }
}

/**
 * @param {unknown[]} tree
 * @returns {Map<string, { file_name: string, vault_name: string, path: string }>}
 */
function buildCitationIndexFromTree(tree) {
    /** @type {Map<string, { file_name: string, vault_name: string, path: string }>} */
    const index = new Map();
    if (!Array.isArray(tree)) return index;
    for (const raw of tree) {
        if (!raw || typeof raw !== 'object') continue;
        const vault = /** @type {Record<string, unknown>} */ (raw);
        if (String(vault.kind ?? '') !== 'vault') continue;
        const vid = Number(vault.id);
        if (!Number.isFinite(vid) || vid < 1) continue;
        const vname =
            typeof vault.name === 'string' && vault.name.trim() ? vault.name.trim() : `Vault ${vid}`;
        walkVaultTreeForCitationIndex(
            Array.isArray(vault.children) ? vault.children : [],
            vid,
            vname,
            '',
            index,
        );
    }

    return index;
}

async function ensureCitationIndex() {
    if (citationIndexCache?.size) return citationIndexCache;

    const wid = activeWorkspaceIdForCitations();
    const cache = await loadCacheMod();
    const base = vaultApiBaseForCitations();
    const buildUrl = () => {
        const q = wid != null ? `?workspace_id=${encodeURIComponent(String(wid))}` : '';
        return `${base}vault_tree${q}`;
    };
    const j = await cache.fetchVaultTreeCached(wid, buildUrl);
    const tree = j?.data?.tree;
    citationIndexCache = buildCitationIndexFromTree(Array.isArray(tree) ? tree : []);

    return citationIndexCache;
}

/** @param {number} ms */
function formatMsHms(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** @param {string} type */
function segmentTypeLabel(type) {
    const t = String(type ?? '').trim();
    if (t === 'transcript_summary') return oaaoT('rag.citation.transcript_summary');
    if (t === 'asr_transcript') return oaaoT('rag.citation.asr_transcript');
    return '';
}

/** @param {string} fileName */
function citationFileNameLooksAudio(fileName) {
    const fn = String(fileName ?? '').trim().toLowerCase();
    return /\.(mp3|wav|m4a|ogg|flac|webm|aac|wma|opus|caf)(\?.*)?$/i.test(fn);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function citationRowIsAsrAudio(row) {
    const rawTypes = Array.isArray(row.segment_types) ? row.segment_types : [];
    const types = rawTypes.map((t) => String(t ?? '').trim());
    if (types.includes('asr_transcript')) return true;
    if (types.includes('transcript_summary') && !types.includes('asr_transcript')) return false;
    return citationFileNameLooksAudio(String(row.file_name ?? ''));
}

/**
 * RazyUI icon font ({@code razyui-icons.css}) — file vs ASR audio.
 *
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function citationIconClassForRow(row) {
    return citationRowIsAsrAudio(row) ? 'ri-microphone-1' : 'ri-file-pencil';
}

/** @param {string} className */
function createCitationRzIcon(className) {
    const ic = document.createElement('i');
    ic.className = `${className} rz-icon shrink-0 text-[0.875rem] leading-none fg-[var(--grid-accent)]`;
    ic.setAttribute('aria-hidden', 'true');

    return ic;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Map<string, { file_name: string, vault_name: string, path: string }> | null} [index]
 */
function formatCitationLabel(row, index = null) {
    const docId = Number(row.document_id ?? 0);
    const vaultId = Number(row.vault_id ?? 0);
    const key = vaultId > 0 && docId > 0 ? `${vaultId}:${docId}` : '';

    let fileName = String(row.file_name ?? '').trim();
    let vaultName = String(row.vault_name ?? '').trim();
    let path = String(row.path ?? '').trim();

    if (key && index?.has(key)) {
        const hit = index.get(key);
        if (hit) {
            if (!fileName || /^Document #\d+$/i.test(fileName)) fileName = hit.file_name;
            if (!vaultName) vaultName = hit.vault_name;
            if (!path) path = hit.path;
        }
    }

    const leaf = fileName || (docId > 0 ? `Document #${docId}` : 'Document');
    let base = leaf;
    if (vaultName && path) base = `${vaultName} › ${path} › ${leaf}`;
    else if (vaultName) base = `${vaultName} › ${leaf}`;
    else if (path) base = `${path} › ${leaf}`;

    const rawTypes = Array.isArray(row.segment_types) ? row.segment_types : [];
    const typeLabels = rawTypes
        .map((t) => segmentTypeLabel(String(t ?? '')))
        .filter((s) => s !== '');
    if (typeLabels.length) base = `${base} · ${typeLabels.join(' · ')}`;

    const speaker = String(row.speaker_label ?? '').trim();
    const beginMs = Math.max(0, Number(row.begin_ms ?? 0));
    if (speaker) base = `${base} · ${speaker}`;
    if (beginMs > 0) base = `${base} @ ${formatMsHms(beginMs)}`;

    const excerpt = String(row.excerpt ?? '').trim();
    if (excerpt) {
        const short = excerpt.length > 72 ? `${excerpt.slice(0, 71)}…` : excerpt;
        base = `${base} — ${short}`;
    }

    return base;
}

/**
 * @param {Record<string, unknown>} row
 */
function dispatchOpenVaultTranscript(row) {
    const documentId = Math.floor(Number(row.document_id ?? 0));
    if (!Number.isFinite(documentId) || documentId < 1) return;
    document.dispatchEvent(
        new CustomEvent('oaao:open-vault-transcript', {
            bubbles: true,
            detail: {
                vault_id: Math.floor(Number(row.vault_id ?? 0)) || undefined,
                document_id: documentId,
                file_name: String(row.file_name ?? '').trim(),
                begin_ms: Math.max(0, Math.floor(Number(row.begin_ms ?? 0))),
            },
        }),
    );
}

/**
 * @param {HTMLElement} list
 * @param {unknown[]} refs
 * @param {Map<string, { file_name: string, vault_name: string, path: string }> | null} [index]
 */
function paintCitationList(list, refs, index = null) {
    list.replaceChildren();
    for (const raw of refs) {
        const row = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
        const label = formatCitationLabel(row, index);
        const beginMs = Math.max(0, Number(row.begin_ms ?? 0));
        const docId = Math.floor(Number(row.document_id ?? 0));
        const canOpen = Number.isFinite(docId) && docId > 0;
        const canSeek = beginMs > 0;

        const li = document.createElement('li');
        li.className = 'flex flex-row items-center gap-2 min-w-0 text-[0.8125rem] fg-[var(--grid-ink-muted)]';

        const iconWrap = document.createElement('span');
        iconWrap.className =
            'oaao-rag-citation-icon shrink-0 inline-flex items-center justify-center w-4 h-4 fg-[var(--grid-accent)]';
        iconWrap.setAttribute('aria-hidden', 'true');
        iconWrap.append(createCitationRzIcon(citationIconClassForRow(row)));

        const nameEl = document.createElement(canOpen ? 'button' : 'span');
        if (nameEl instanceof HTMLButtonElement) {
            nameEl.type = 'button';
            nameEl.className =
                'truncate min-w-0 font-mono text-[0.78rem] text-left bg-transparent border-none p-0 cursor-pointer hover:underline fg-inherit';
            nameEl.title = canSeek ? oaaoT('rag.citation.open_transcript_seek') : oaaoT('rag.citation.open_transcript');
            nameEl.addEventListener('click', () => dispatchOpenVaultTranscript(row));
        } else {
            nameEl.className = 'truncate min-w-0 font-mono text-[0.78rem]';
        }
        nameEl.textContent = label;
        if (!(nameEl instanceof HTMLButtonElement)) nameEl.title = label;

        li.append(iconWrap, nameEl);
        list.append(li);
    }
}

/**
 * @param {HTMLElement} wrap
 * @param {Record<string, unknown>} block
 */
export function renderRagCitationsBlock(wrap, block) {
    const props = block.props && typeof block.props === 'object' ? /** @type {Record<string, unknown>} */ (block.props) : {};
    const refs = Array.isArray(props.references) ? props.references : [];
    if (!refs.length) return;

    const shell = document.createElement('div');
    shell.className =
        'rounded-[10px] border border-[var(--grid-line)] bg-[var(--grid-panel)]/60 px-sm py-sm w-full min-w-0 max-w-full flex flex-col gap-1.5';

    const heading = document.createElement('div');
    heading.className = 'text-[0.68rem] fw-semibold fg-[var(--grid-caption)] tracking-wide uppercase';
    heading.textContent = String(block.title ?? 'References');

    const list = document.createElement('ul');
    list.className = 'm-0 p-0 list-none flex flex-col gap-1 min-w-0';
    list.setAttribute('aria-label', 'Referenced vault files');

    const needsLookup = refs.some((raw) => {
        const row = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
        const fn = String(row.file_name ?? '').trim();
        const vn = String(row.vault_name ?? '').trim();
        return !fn || !vn || /^Document #\d+$/i.test(fn);
    });

    paintCitationList(list, refs);

    shell.append(heading, list);
    wrap.append(shell);

    if (needsLookup) {
        void ensureCitationIndex().then((index) => {
            if (!index.size || !wrap.isConnected) return;
            paintCitationList(list, refs, index);
        });
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('oaao:vault-tree-invalidate', () => {
        citationIndexCache = null;
    });
}