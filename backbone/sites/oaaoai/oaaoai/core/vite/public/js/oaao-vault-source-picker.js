/**
 * Shared vault tree picker (folder + document) — used by Corpus Studio, Research, etc.
 *
 * @module oaao/vault-source-picker
 */

/**
 * @typedef {'vault' | 'folder' | 'document'} OaaoVaultPickerKind
 */

/**
 * @typedef {{
 *   rowKey: string,
 *   kind: OaaoVaultPickerKind,
 *   id: number,
 *   vault_id: number,
 *   name: string,
 *   breadcrumb: string,
 *   depth: number,
 *   hasChildren: boolean,
 *   parent_container_id?: number | null
 * }} OaaoVaultPickerVisibleRow
 */

/**
 * @typedef {{
 *   kind: OaaoVaultPickerKind,
 *   vault_id: number,
 *   container_id?: number,
 *   document_id?: number,
 *   name: string,
 *   breadcrumb: string
 * }} OaaoVaultPickerSelection
 */

/**
 * @param {unknown[]} children
 */
function vaultPickerFolderChildren(children) {
    if (!Array.isArray(children)) return [];
    return children.filter((raw) => {
        if (!raw || typeof raw !== 'object') return false;
        return String(/** @type {Record<string, unknown>} */ (raw).kind ?? '') === 'container';
    });
}

/**
 * @param {unknown[]} tree
 * @param {{ allowVault?: boolean, allowFolder?: boolean, allowDocument?: boolean, documentsEmbeddedOnly?: boolean }} [opts]
 * @returns {Map<string, OaaoVaultPickerSelection>}
 */
export function buildOaaoVaultPickerRowMap(tree, opts = {}) {
    const allowVault = opts.allowVault !== false;
    const allowFolder = opts.allowFolder !== false;
    const allowDocument = opts.allowDocument !== false;
    const embeddedOnly = opts.documentsEmbeddedOnly === true;
    /** @type {Map<string, OaaoVaultPickerSelection>} */
    const map = new Map();

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
            if (k === 'container' && allowFolder) {
                const cid = Number(node.id);
                if (!Number.isFinite(cid) || cid < 1) continue;
                const nm = typeof node.name === 'string' ? node.name : `Folder ${cid}`;
                const crumb = `${pathPrefix} › ${nm}`;
                map.set(`folder:${cid}`, {
                    kind: 'folder',
                    vault_id: vaultId,
                    container_id: cid,
                    name: nm,
                    breadcrumb: crumb,
                });
                walkChildren(Array.isArray(node.children) ? node.children : [], vaultId, crumb);
            } else if (k === 'document' && allowDocument) {
                if (embeddedOnly && String(node.embed_status ?? '') !== 'embedded') continue;
                const did = Number(node.id);
                if (!Number.isFinite(did) || did < 1) continue;
                const fn = typeof node.file_name === 'string' ? node.file_name : `Document ${did}`;
                const crumb = `${pathPrefix} › ${fn}`;
                map.set(`document:${did}`, {
                    kind: 'document',
                    vault_id: vaultId,
                    document_id: did,
                    name: fn,
                    breadcrumb: crumb,
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
        if (allowVault) {
            map.set(`vault:${vid}`, {
                kind: 'vault',
                vault_id: vid,
                name: vname,
                breadcrumb: vname,
            });
        }
        walkChildren(Array.isArray(node.children) ? node.children : [], vid, vname);
    }

    return map;
}

/**
 * @param {unknown[]} tree
 * @param {Set<string>} expandedKeys
 * @param {string} filter
 * @param {{ allowVault?: boolean, allowFolder?: boolean, allowDocument?: boolean, documentsEmbeddedOnly?: boolean }} [opts]
 * @returns {OaaoVaultPickerVisibleRow[]}
 */
export function oaaoVaultPickerVisibleRows(tree, expandedKeys, filter = '', opts = {}) {
    const allowVault = opts.allowVault !== false;
    const allowFolder = opts.allowFolder !== false;
    const allowDocument = opts.allowDocument !== false;
    const embeddedOnly = opts.documentsEmbeddedOnly === true;
    const q = filter.trim().toLowerCase();
    /** @type {OaaoVaultPickerVisibleRow[]} */
    const out = [];

    /**
     * @param {unknown[]} children
     * @param {number} vaultId
     * @param {number} depth
     * @param {string} pathPrefix
     */
    function walkChildren(children, vaultId, depth, pathPrefix) {
        if (!Array.isArray(children)) return;
        for (const raw of children) {
            if (!raw || typeof raw !== 'object') continue;
            const node = /** @type {Record<string, unknown>} */ (raw);
            const k = String(node.kind ?? '');
            if (k === 'container' && allowFolder) {
                const cid = Number(node.id);
                if (!Number.isFinite(cid) || cid < 1) continue;
                const nm = typeof node.name === 'string' ? node.name : `Folder ${cid}`;
                const crumb = `${pathPrefix} › ${nm}`;
                const rowKey = `folder:${cid}`;
                const kids = vaultPickerFolderChildren(Array.isArray(node.children) ? node.children : []);
                const docKids = allowDocument
                    ? (Array.isArray(node.children) ? node.children : []).filter((c) => {
                          if (!c || typeof c !== 'object') return false;
                          const dn = /** @type {Record<string, unknown>} */ (c);
                          if (String(dn.kind ?? '') !== 'document') return false;
                          return !embeddedOnly || String(dn.embed_status ?? '') === 'embedded';
                      })
                    : [];
                const hasChildren = kids.length > 0 || docKids.length > 0;
                const hay = `${nm} ${crumb} folder`.toLowerCase();
                if (q === '' || hay.includes(q)) {
                    out.push({
                        rowKey,
                        kind: 'folder',
                        id: cid,
                        vault_id: vaultId,
                        name: nm,
                        breadcrumb: crumb,
                        depth,
                        hasChildren,
                        parent_container_id: cid,
                    });
                }
                if (q !== '' || expandedKeys.has(rowKey)) {
                    walkChildren(Array.isArray(node.children) ? node.children : [], vaultId, depth + 1, crumb);
                }
            } else if (k === 'document' && allowDocument) {
                if (embeddedOnly && String(node.embed_status ?? '') !== 'embedded') continue;
                const did = Number(node.id);
                if (!Number.isFinite(did) || did < 1) continue;
                const fn = typeof node.file_name === 'string' ? node.file_name : `Document ${did}`;
                const crumb = `${pathPrefix} › ${fn}`;
                const rowKey = `document:${did}`;
                const hay = `${fn} ${crumb} file document`.toLowerCase();
                if (q === '' || hay.includes(q)) {
                    out.push({
                        rowKey,
                        kind: 'document',
                        id: did,
                        vault_id: vaultId,
                        name: fn,
                        breadcrumb: crumb,
                        depth,
                        hasChildren: false,
                    });
                }
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
        const rowKey = `vault:${vid}`;
        const kids = Array.isArray(node.children) ? node.children : [];
        const hasChildren = vaultPickerFolderChildren(kids).length > 0 || kids.some((c) => {
            if (!c || typeof c !== 'object') return false;
            const dn = /** @type {Record<string, unknown>} */ (c);
            return String(dn.kind ?? '') === 'document';
        });
        if (allowVault) {
            const hay = `${vname} vault`.toLowerCase();
            if (q === '' || hay.includes(q)) {
                out.push({
                    rowKey,
                    kind: 'vault',
                    id: vid,
                    vault_id: vid,
                    name: vname,
                    breadcrumb: vname,
                    depth: 0,
                    hasChildren,
                });
            }
        }
        if (q !== '' || expandedKeys.has(rowKey) || !allowVault) {
            walkChildren(kids, vid, allowVault ? 1 : 0, vname);
        } else if (expandedKeys.has(`vault:${vid}`)) {
            walkChildren(kids, vid, 1, vname);
        }
    }

    return out;
}

/**
 * @param {string | null | undefined} rowKey
 * @param {unknown[]} tree
 */
export function oaaoVaultPickerExpandKeysForRow(rowKey, tree) {
    /** @type {Set<string>} */
    const keys = new Set();
    if (!rowKey) return keys;
    const parts = String(rowKey).split(':');
    if (parts.length < 2) return keys;
    const kind = parts[0];
    const id = Number(parts[1]);
    if (!Number.isFinite(id) || id < 1) return keys;

    if (kind === 'vault') {
        keys.add(`vault:${id}`);
        return keys;
    }

    /** @param {unknown[]} nodes @param {number} vaultId @param {string | null} parentKey */
    function walk(nodes, vaultId, parentKey) {
        if (!Array.isArray(nodes)) return false;
        for (const raw of nodes) {
            if (!raw || typeof raw !== 'object') continue;
            const node = /** @type {Record<string, unknown>} */ (raw);
            const nk = String(node.kind ?? '');
            if (nk === 'vault') {
                const vid = Number(node.id);
                if (vid === vaultId) keys.add(`vault:${vid}`);
                if (walk(Array.isArray(node.children) ? node.children : [], vaultId, `vault:${vid}`)) return true;
            } else if (nk === 'container') {
                const cid = Number(node.id);
                const key = `folder:${cid}`;
                if (kind === 'folder' && cid === id) {
                    if (parentKey) keys.add(parentKey);
                    keys.add(key);
                    return true;
                }
                if (walk(Array.isArray(node.children) ? node.children : [], vaultId, key)) {
                    keys.add(key);
                    return true;
                }
            } else if (nk === 'document' && kind === 'document' && Number(node.id) === id) {
                if (parentKey) keys.add(parentKey);
                return true;
            }
        }
        return false;
    }

    for (const raw of tree) {
        if (!raw || typeof raw !== 'object') continue;
        const node = /** @type {Record<string, unknown>} */ (raw);
        if (String(node.kind ?? '') !== 'vault') continue;
        const vid = Number(node.id);
        walk(Array.isArray(node.children) ? node.children : [], vid, `vault:${vid}`);
    }

    return keys;
}

const PICKER_INPUT_CLASS =
    'w-full text-sm px-2 py-1.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)]';

/**
 * @param {typeof import('./razyui/component/Dialog.js').default} DialogMod
 * @param {unknown[]} tree
 * @param {{
 *   title?: string,
 *   hint?: string,
 *   confirmLabel?: string,
 *   initialRowKey?: string | null,
 *   allowVault?: boolean,
 *   allowFolder?: boolean,
 *   allowDocument?: boolean,
 *   documentsEmbeddedOnly?: boolean
 * }} [opts]
 * @returns {Promise<OaaoVaultPickerSelection | null>}
 */
export async function openOaaoVaultSourcePickerDialog(DialogMod, tree, opts = {}) {
    if (!DialogMod || typeof DialogMod.open !== 'function') return null;

    const rowByKey = buildOaaoVaultPickerRowMap(tree, opts);
    /** @type {Set<string>} */
    const expandedKeys = oaaoVaultPickerExpandKeysForRow(opts.initialRowKey ?? null, tree);
    let selectedKey = opts.initialRowKey ?? null;

    const body = document.createElement('div');
    body.className = 'flex flex-col gap-2 min-h-0 max-h-[min(420px,calc(100vh-10rem))]';
    body.dataset.oaaoVaultSourcePicker = '1';

    const hint = document.createElement('p');
    hint.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 shrink-0';
    hint.textContent =
        opts.hint ?? 'Expand vaults or folders, select a folder or file, then confirm.';
    body.append(hint);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = PICKER_INPUT_CLASS;
    search.placeholder = 'Filter by name…';
    body.append(search);

    const treeHost = document.createElement('div');
    treeHost.className =
        'oaao-vault-picker-tree min-h-[220px] flex-1 min-w-0 overflow-y-auto border border-solid border-[var(--grid-line)] rounded-lg bg-[var(--grid-panel-bright)]';
    body.append(treeHost);

    /** @param {string} filter */
    function paintTree(filter = '') {
        treeHost.replaceChildren();
        const rows = oaaoVaultPickerVisibleRows(tree, expandedKeys, filter, opts);
        if (!rows.length) {
            const empty = document.createElement('p');
            empty.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 p-3';
            empty.textContent = filter.trim()
                ? 'No matching vaults, folders, or files.'
                : 'No vaults available.';
            treeHost.append(empty);
            return;
        }

        for (const row of rows) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'oaao-vault-picker-tree-row';
            btn.dataset.rowKey = row.rowKey;
            btn.dataset.kind = row.kind;
            btn.dataset.depth = String(row.depth);
            btn.style.setProperty('--oaao-vault-picker-depth', String(row.depth));
            if (selectedKey === row.rowKey) btn.classList.add('is-active');

            const toggle = document.createElement('span');
            toggle.className = 'oaao-vault-picker-tree-toggle';
            toggle.setAttribute('aria-hidden', 'true');
            if (!row.hasChildren) {
                toggle.classList.add('is-leaf');
                toggle.textContent = '·';
            } else {
                toggle.textContent = expandedKeys.has(row.rowKey) ? '▾' : '▸';
            }

            const label = document.createElement('span');
            label.className = 'oaao-vault-picker-tree-label';
            label.textContent = row.name;
            label.title = row.breadcrumb;

            const type = document.createElement('span');
            type.className = 'oaao-vault-picker-tree-type';
            type.textContent =
                row.kind === 'vault' ? 'Vault' : row.kind === 'folder' ? 'Folder' : 'File';

            btn.append(toggle, label, type);

            toggle.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (!row.hasChildren) return;
                if (expandedKeys.has(row.rowKey)) expandedKeys.delete(row.rowKey);
                else expandedKeys.add(row.rowKey);
                paintTree(search.value);
            });

            btn.addEventListener('click', () => {
                selectedKey = row.rowKey;
                if (row.hasChildren && !expandedKeys.has(row.rowKey)) {
                    expandedKeys.add(row.rowKey);
                }
                paintTree(search.value);
            });

            treeHost.append(btn);
        }
    }

    search.addEventListener('input', () => paintTree(search.value));

    return new Promise((resolve) => {
        let settled = false;
        /** @param {OaaoVaultPickerSelection | null} row */
        const finish = (row) => {
            if (settled) return;
            settled = true;
            resolve(row);
        };

        DialogMod.open({
            title: opts.title ?? 'Select from Vault',
            content: body,
            size: 'md',
            onClose: () => finish(null),
            onOpen: () => paintTree(''),
            buttons: [
                {
                    text: 'Cancel',
                    color: 'muted',
                    action: async () => {
                        finish(null);
                        return true;
                    },
                },
                {
                    text: opts.confirmLabel ?? 'Add reference',
                    color: 'accent',
                    action: async () => {
                        if (!selectedKey || !rowByKey.has(selectedKey)) return false;
                        finish(rowByKey.get(selectedKey) ?? null);
                        return true;
                    },
                },
            ],
        });
    });
}

/**
 * @param {string} mountPrefix
 * @param {number | null | undefined | 'all'} workspaceId
 */
export async function fetchOaaoVaultTreeForPicker(mountPrefix, workspaceId = 'all') {
    let cachePath = '/webassets/core/default/js/vault-tree-cache.js';
    const prefix = (mountPrefix || '').trim();
    if (prefix && prefix !== '/') {
        cachePath = `${prefix.replace(/\/+$/, '')}${cachePath}`.replace(/\/{2,}/g, '/');
    }
    const cache = await import(/* webpackIgnore: true */ cachePath);
    const base = `${prefix}/vault/api`.replace(/\/{2,}/g, '/');
    const scopeKey = workspaceId;
    const buildUrl = () => {
        const q = new URLSearchParams();
        if (scopeKey === 'all') q.set('scope', 'all');
        else if (scopeKey != null && Number(scopeKey) > 0) q.set('workspace_id', String(scopeKey));
        const qs = q.toString();
        return `${base}/vault_tree${qs ? `?${qs}` : ''}`;
    };
    const j = await cache.fetchVaultTreeCached(scopeKey === 'all' ? 'all' : scopeKey, buildUrl, {});
    const tree =
        j?.data && typeof j.data === 'object' && Array.isArray(j.data.tree)
            ? j.data.tree
            : Array.isArray(j?.tree)
              ? j.tree
              : [];

    return /** @type {unknown[]} */ (tree);
}
