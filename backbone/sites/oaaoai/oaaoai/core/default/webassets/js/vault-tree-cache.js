/**
 * Shared vault tree fetch cache — dedupe in-flight requests, ETag revalidation, scope keys.
 *
 * @module oaao/vault-tree-cache
 */

/** @typedef {{ tree: unknown[], scope: { workspace_id?: number | null, personal?: boolean }, etag?: string, fetchedAt: number }} VaultTreeCacheEntry */

/** @type {Map<string, VaultTreeCacheEntry>} */
const treeByScope = new Map();

/** @type {Map<string, Promise<VaultTreeCacheEntry | null>>} */
const inflightTree = new Map();

const TREE_TTL_MS = 45_000;

/**
 * @param {number | null | undefined} workspaceId
 */
export function vaultTreeScopeKey(workspaceId) {
    if (workspaceId != null && Number.isFinite(workspaceId) && workspaceId > 0) {
        return `ws:${Math.floor(workspaceId)}`;
    }

    return 'personal';
}

export function invalidateVaultTreeCache(scopeKey = null) {
    if (scopeKey) {
        treeByScope.delete(scopeKey);
        inflightTree.delete(scopeKey);

        return;
    }
    treeByScope.clear();
    inflightTree.clear();
}

/**
 * @param {unknown[]} tree
 * @param {Record<string, Record<string, unknown>>} statusById keyed by document id string
 * @returns {boolean} true when at least one node was patched
 */
export function patchVaultTreeDocumentStatuses(tree, statusById) {
    if (!Array.isArray(tree) || !statusById || typeof statusById !== 'object') return false;

    let patched = false;

    /** @param {unknown[]} nodes */
    function walk(nodes) {
        for (const raw of nodes) {
            if (!raw || typeof raw !== 'object') continue;
            const node = /** @type {Record<string, unknown>} */ (raw);
            const kind = String(node.kind ?? '');
            if (kind === 'document') {
                const id = String(node.id ?? '');
                const hit = statusById[id];
                if (hit) {
                    if (hit.embed_status != null) node.embed_status = hit.embed_status;
                    if (hit.embed_error !== undefined) node.embed_error = hit.embed_error;
                    if (hit.embed_attempts != null) node.embed_attempts = hit.embed_attempts;
                    if (hit.graph_status !== undefined) node.graph_status = hit.graph_status;
                    if (hit.byte_size !== undefined) node.byte_size = hit.byte_size;
                    if (hit.file_name != null) node.file_name = hit.file_name;
                    if (hit.has_transcript != null) node.has_transcript = hit.has_transcript ? 1 : 0;
                    patched = true;
                }
            }
            if (Array.isArray(node.children)) walk(node.children);
        }
    }

    walk(tree);

    return patched;
}

/**
 * @param {number | null | undefined} workspaceId
 * @param {() => string} buildUrl — full URL for GET vault_tree (lite default on server)
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ success?: boolean, data?: { tree?: unknown[], scope?: Record<string, unknown> } } | null>}
 */
export async function fetchVaultTreeCached(workspaceId, buildUrl, opts = {}) {
    const scopeKey = vaultTreeScopeKey(workspaceId);
    const force = opts.force === true;
    const now = Date.now();
    const cached = treeByScope.get(scopeKey);

    if (!force && cached && now - cached.fetchedAt < TREE_TTL_MS) {
        return {
            success: true,
            data: { tree: cached.tree, scope: cached.scope },
        };
    }

    let pending = inflightTree.get(scopeKey);
    if (!pending) {
        pending = (async () => {
            const url = buildUrl();
            /** @type {Record<string, string>} */
            const headers = { Accept: 'application/json' };
            if (cached?.etag) headers['If-None-Match'] = cached.etag;

            const res = await fetch(url, { credentials: 'include', headers });
            if (res.status === 304 && cached) {
                cached.fetchedAt = Date.now();
                treeByScope.set(scopeKey, cached);

                return cached;
            }
            if (!res.ok) return null;

            const etag = res.headers.get('ETag') ?? undefined;
            const j = await res.json().catch(() => null);
            if (!j || typeof j !== 'object' || j.success !== true) return null;

            const data = j.data && typeof j.data === 'object' ? j.data : {};
            const tree = Array.isArray(data.tree) ? data.tree : [];
            const scope =
                data.scope && typeof data.scope === 'object'
                    ? /** @type {{ workspace_id?: number | null, personal?: boolean }} */ (data.scope)
                    : { workspace_id: workspaceId ?? null, personal: workspaceId == null };

            /** @type {VaultTreeCacheEntry} */
            const entry = { tree, scope, etag, fetchedAt: Date.now() };
            treeByScope.set(scopeKey, entry);

            return entry;
        })().finally(() => {
            inflightTree.delete(scopeKey);
        });
        inflightTree.set(scopeKey, pending);
    }

    const entry = await pending;
    if (!entry) return null;

    return { success: true, data: { tree: entry.tree, scope: entry.scope } };
}

/**
 * @param {number | null | undefined} workspaceId
 * @param {() => string} buildDocumentStatusUrl
 * @param {number[]} documentIds
 */
export async function fetchVaultDocumentStatuses(workspaceId, buildDocumentStatusUrl, documentIds) {
    const ids = [...new Set(documentIds.map((x) => Math.floor(Number(x))).filter((x) => x > 0))].slice(0, 64);
    if (!ids.length) return [];

    const url = buildDocumentStatusUrl(ids);
    const res = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
    });
    if (!res.ok) return [];

    const j = await res.json().catch(() => null);
    const docs = j?.data?.documents;

    return Array.isArray(docs) ? docs : [];
}

if (typeof document !== 'undefined') {
    document.addEventListener('oaao:vault-tree-invalidate', () => {
        invalidateVaultTreeCache();
    });
}
