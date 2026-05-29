/**
 * CS-2-S4 — Library split shell: sidebar list + RazyUI BlockEditor (Notion-like).
 *
 * @module library-panel
 */

import { fromLibraryBlocks, toLibraryBlocks } from './library-block-adapter.js';

/** @type {number|null} */
let activeDocumentId = null;

/** @type {{ document_id: number, title: string, revision_id: number|null, corpus_id: number|null, blocks: Array<Record<string, unknown>> }|null} */
let editorState = null;

/** @type {import('../../../core/default/webassets/razyui/BlockEditorOaao.js').default|null} */
let blockEditorInstance = null;

/** @type {ReturnType<NonNullable<typeof blockEditorInstance>['getControl']>|null} */
let blockEditorControl = null;

/** @type {Promise<{ BlockEditor: typeof import('../../../core/default/webassets/razyui/BlockEditorOaao.js').default, buildOaaoEditorPlugins: typeof import('../../../core/default/webassets/razyui/extensions/block-editor/index.js').buildOaaoEditorPlugins }>|null} */
let blockEditorModulePromise = null;

/** @type {Array<{ corpus_id: number, name: string }>} */
let cachedCorpusProfiles = [];

let saveTimer = null;
let editorStylesInjected = false;

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

function blockEditorModuleUrl() {
    const prefix = mountPrefix();
    return `${prefix}/webassets/core/default/razyui/component/BlockEditor.js`.replace(/\/{2,}/g, '/');
}

/** @returns {Promise<{ load: (name: string) => Promise<unknown> }>} */
async function loadRazyui() {
    const mod = await import(/* webpackIgnore: true */ 'razyui');
    return mod.default ?? mod;
}

async function hydrateBlockEditorMount(root) {
    if (!(root instanceof HTMLElement)) return;
    try {
        let JIT = globalThis.JIT;
        if (!JIT?.hydrate) {
            const razyui = await loadRazyui();
            JIT = await razyui.load('JIT');
        }
        if (JIT?.hydrate) {
            JIT.hydrate(root);
        }
    } catch {
        /* BlockEditor still usable with CSS fallbacks */
    }
}

function libraryCssHref() {
    const prefix = mountPrefix();
    return `${prefix}/webassets/library/default/css/library-block-editor.css`.replace(/\/{2,}/g, '/');
}

/** @param {HTMLElement|null|undefined} root */
function hydrateJitRoot(root) {
    if (!(root instanceof HTMLElement)) return;
    const JIT = globalThis.JIT ?? globalThis.razyui?.JIT;
    if (JIT?.hydrate) JIT.hydrate(root);
}

const LIBRARY_DOC_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" class="block shrink-0 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

function injectLibraryEditorStyles() {
    if (editorStylesInjected || typeof document === 'undefined') return;
    editorStylesInjected = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = libraryCssHref();
    document.head.append(link);
}

async function loadBlockEditorModule() {
    if (!blockEditorModulePromise) {
        blockEditorModulePromise = import(/* webpackIgnore: true */ blockEditorModuleUrl())
            .then((mod) => {
                const BlockEditor = mod.default ?? mod;
                const buildPlugins =
                    mod.buildBlockEditorPlugins ??
                    BlockEditor?.plugins?.build ??
                    ((Ctor, opts) => Ctor.plugins?.build?.(Ctor, opts) ?? []);
                return { BlockEditor, buildBlockEditorPlugins: buildPlugins };
            })
            .catch((err) => {
                blockEditorModulePromise = null;
                throw err;
            });
    }
    return blockEditorModulePromise;
}

function corpusApiUrl(path) {
    const base = `${mountPrefix()}/corpus/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

async function fetchCorpusProfiles() {
    const wid = activeWorkspaceId();
    const q = scopeQuery(wid);
    const path = q ? `corpus_profiles_list${q}` : 'corpus_profiles_list';
    try {
        const res = await fetch(corpusApiUrl(path), { credentials: 'include', headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (!res.ok || !data?.success) return [];
        const rows = Array.isArray(data?.data?.profiles) ? data.data.profiles : [];
        cachedCorpusProfiles = [];
        for (const row of rows) {
            const id = Number(row.corpus_id ?? row.id ?? 0);
            if (!Number.isFinite(id) || id < 1) continue;
            cachedCorpusProfiles.push({
                corpus_id: id,
                name: String(row.name ?? row.title ?? `Corpus #${id}`),
            });
        }
        return cachedCorpusProfiles;
    } catch {
        return [];
    }
}

/**
 * @param {object} payload
 * @param {AbortSignal} [payload.signal]
 */
async function libraryAskAI(payload) {
    if (!activeDocumentId || !editorState) {
        throw new Error('No active document');
    }
    syncEditorStateFromControl();
    const skill = payload?.skill ?? {};
    const skillId = String(payload?.skillId ?? skill?.id ?? 'improve-writing');
    const action = skillId.replace(/^ai:(slash|blockmenu|format):/, '').replace(/^ai:/, '') || 'improve-writing';
    const selection = payload?.selection ?? null;
    const block = payload?.block ?? null;
    const blocks = Array.isArray(payload?.blocks) ? payload.blocks : blockEditorControl?.getBlocks?.() ?? [];

    const { res, data } = await libraryFetchJson('library_ai_transform', {
        method: 'POST',
        body: JSON.stringify({
            document_id: activeDocumentId,
            action,
            skill_id: skillId,
            selection_text: String(selection?.text ?? ''),
            block_id: block?.id ?? selection?.blockId ?? null,
            blocks: toLibraryBlocks(blocks),
            corpus_id: editorState.corpus_id,
            workspace_id: activeWorkspaceId(),
        }),
        signal: payload?.signal,
    });
    if (!res.ok || !data?.success) {
        throw new Error(String(data?.message || 'AI transform failed'));
    }
    const result = data.data ?? {};
    return {
        mode: String(result.mode || 'replace-selection'),
        text: String(result.text || ''),
        message: String(result.message || ''),
    };
}

function destroyBlockEditor() {
    if (blockEditorInstance && typeof blockEditorInstance.destroy === 'function') {
        blockEditorInstance.destroy();
    }
    blockEditorInstance = null;
    blockEditorControl = null;
}

function syncEditorStateFromControl() {
    if (!editorState || !blockEditorControl) return;
    editorState.blocks = toLibraryBlocks(blockEditorControl.getBlocks());
    const title = String(blockEditorControl.title || '').trim();
    if (title) {
        editorState.title = title;
    }
}

function libraryApiUrl(path) {
    const base = `${mountPrefix()}/library/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

function vaultApiUrl(path) {
    const base = `${mountPrefix()}/vault/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

/**
 * @param {number|null} workspaceId
 */
function scopeQuery(workspaceId) {
    const q = new URLSearchParams();
    if (workspaceId != null && workspaceId > 0) {
        q.set('workspace_id', String(workspaceId));
    }
    const s = q.toString();
    return s ? `?${s}` : '';
}

/**
 * @returns {number|null}
 */
function activeWorkspaceId() {
    const root = document.getElementById('workspace-view');
    const ds = root?.dataset?.oaaoActiveWorkspaceId?.trim() ?? '';
    if (!ds) return null;
    const n = Number(ds);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

async function libraryFetchJson(path, options = {}) {
    const res = await fetch(libraryApiUrl(path), {
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
        ...options,
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    return { res, data };
}

/**
 * @param {HTMLElement} listHost
 */
async function refreshLibrarySidebarList(listHost) {
    if (!(listHost instanceof HTMLElement)) return;
    const wid = activeWorkspaceId();
    const { res, data } = await libraryFetchJson(`library_documents_list${scopeQuery(wid)}`);
    listHost.textContent = '';
    if (!res.ok || !data?.success) {
        const err = document.createElement('p');
        err.className = 'px-md py-2 text-[0.75rem] fg-[var(--grid-caption)] m-0';
        err.textContent = 'Could not load documents.';
        listHost.append(err);
        return;
    }
    const docs = Array.isArray(data?.data?.documents) ? data.data.documents : [];
    if (docs.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'px-md py-2 text-[0.75rem] fg-[var(--grid-caption)] m-0';
        empty.textContent = 'No documents yet.';
        listHost.append(empty);
        return;
    }
    for (const row of docs) {
        const id = Number(row.document_id);
        if (!Number.isFinite(id) || id < 1) continue;
        const active = id === activeDocumentId;

        const rowWrap = document.createElement('div');
        rowWrap.setAttribute('role', 'listitem');
        rowWrap.className = `oaao-library-doc-row shrink-0 self-stretch${active ? ' oaao-library-doc-active' : ''}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.documentId = String(id);
        btn.className = 'oaao-library-doc-pick';
        btn.title = String(row.title || 'Untitled').trim() || 'Untitled';

        const icon = document.createElement('span');
        icon.className = 'oaao-library-doc-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = LIBRARY_DOC_ICON_SVG;

        const label = document.createElement('span');
        label.className = 'truncate min-w-0';
        label.textContent = btn.title;

        btn.append(icon, label);
        btn.addEventListener('click', () => {
            void openLibraryDocument(id);
        });
        rowWrap.append(btn);
        listHost.append(rowWrap);
    }
    hydrateJitRoot(listHost);
}

/**
 * @param {HTMLElement} editorHost
 */
function renderLibraryEditorEmpty(editorHost) {
    destroyBlockEditor();
    editorHost.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className =
        'flex flex-col items-center justify-center flex-1 gap-2 p-8 text-center fg-[var(--grid-caption)]';
    wrap.innerHTML =
        '<p class="m-0 text-sm">Select a document from the sidebar or create a new one.</p>' +
        '<p class="m-0 text-xs opacity-80">Type <kbd class="px-1 rounded bg-[var(--grid-line)]/40">/</kbd> for blocks · ' +
        '<kbd class="px-1 rounded bg-[var(--grid-line)]/40">#</kbd>+<kbd class="px-1 rounded bg-[var(--grid-line)]/40">Space</kbd> for headings</p>';
    editorHost.append(wrap);
    const JIT = globalThis.JIT;
    if (JIT?.hydrate) JIT.hydrate(wrap);
}

function setSaveStatus(text) {
    const el = document.querySelector('[data-oaao-library-save-status]');
    if (el instanceof HTMLElement) {
        el.textContent = text;
    }
}

/**
 * @param {HTMLElement} editorHost
 */
async function renderLibraryEditor(editorHost) {
    destroyBlockEditor();

    if (!editorState) {
        renderLibraryEditorEmpty(editorHost);
        return;
    }

    injectLibraryEditorStyles();
    editorHost.replaceChildren();

    const shell = document.createElement('div');
    shell.className = 'flex flex-col flex-1 min-h-0 min-w-0';

    const head = document.createElement('header');
    head.className =
        'oaao-library-block-editor-toolbar flex flex-wrap items-center gap-2 shrink-0 px-6 py-2.5';

    const hint = document.createElement('span');
    hint.className = 'text-[0.75rem] fg-[var(--grid-caption)] flex-1 min-w-[10rem]';
    hint.textContent =
        "Type / for blocks · #/##/### + Space for headings · Table in slash menu · drag ⠇ to reorder";

    const corpusWrap = document.createElement('label');
    corpusWrap.className =
        'flex items-center gap-1.5 text-[0.75rem] fg-[var(--grid-caption)] shrink-0';
    corpusWrap.title = 'Corpus profile for AI style (CS-2-S6)';

    const corpusLbl = document.createElement('span');
    corpusLbl.textContent = 'Corpus';

    const corpusSelect = document.createElement('select');
    corpusSelect.className = 'oaao-library-select';
    corpusSelect.innerHTML = '<option value="">Default</option>';
    corpusSelect.addEventListener('change', () => {
        if (!editorState) return;
        const raw = corpusSelect.value;
        editorState.corpus_id = raw ? Number(raw) : null;
        scheduleLibrarySave();
    });

    corpusWrap.append(corpusLbl, corpusSelect);

    void fetchCorpusProfiles().then((profiles) => {
        if (!editorState) return;
        const current = editorState.corpus_id;
        corpusSelect.replaceChildren();
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'Default';
        corpusSelect.append(defaultOpt);
        for (const p of profiles) {
            const opt = document.createElement('option');
            opt.value = String(p.corpus_id);
            opt.textContent = p.name;
            corpusSelect.append(opt);
        }
        corpusSelect.value =
            current != null && Number.isFinite(current) && current > 0 ? String(current) : '';
    });

    const finalizeBtn = document.createElement('button');
    finalizeBtn.type = 'button';
    finalizeBtn.className = 'oaao-library-toolbar-btn';
    finalizeBtn.textContent = 'Finalize to Vault';
    finalizeBtn.title = 'Copy this document into Vault for Hard-RAG indexing';
    finalizeBtn.addEventListener('click', () => {
        if (activeDocumentId) {
            void openLibraryFinalizeDialog(activeDocumentId, editorHost);
        }
    });

    const saveLbl = document.createElement('span');
    saveLbl.dataset.oaaoLibrarySaveStatus = '1';
    saveLbl.className = 'text-[0.75rem] fg-[var(--grid-caption)] shrink-0 min-w-[4.5rem] text-right';
    saveLbl.textContent = '';

    head.append(hint, corpusWrap, finalizeBtn, saveLbl);

    const body = document.createElement('div');
    body.className = 'oaao-library-block-editor-mount flex-1 min-h-0 overflow-y-auto overscroll-contain';

    const loading = document.createElement('p');
    loading.className = 'p-6 text-sm fg-[var(--grid-caption)] m-0';
    loading.textContent = 'Loading editor…';
    body.append(loading);

    shell.append(head, body);
    editorHost.append(shell);

    try {
        const { BlockEditor, buildBlockEditorPlugins } = await loadBlockEditorModule();
        if (!editorState) return;

        body.replaceChildren();
        const blocks = fromLibraryBlocks(/** @type {Array<Record<string, unknown>>} */ (editorState.blocks));

        blockEditorInstance = new BlockEditor(body, {
            title: editorState.title || '',
            blocks,
            placeholder: "Type '/' for blocks, or start writing…",
            titleEditable: true,
            virtualize: {
                enabled: true,
                minBlocks: 48,
                rootMargin: '900px 0px',
            },
            plugins: buildBlockEditorPlugins(BlockEditor, {
                askAI: libraryAskAI,
            }),
            onChange: (ruBlocks) => {
                if (!editorState) return;
                editorState.blocks = toLibraryBlocks(ruBlocks);
                if (blockEditorControl) {
                    const t = String(blockEditorControl.title || '').trim();
                    if (t) editorState.title = t;
                }
                scheduleLibrarySave();
            },
        });
        blockEditorControl = blockEditorInstance.getControl();
        await hydrateBlockEditorMount(body);
    } catch (err) {
        console.error('[library-panel] BlockEditor failed', err);
        body.replaceChildren();
        const fail = document.createElement('p');
        fail.className = 'p-6 text-sm fg-red-6 m-0';
        fail.textContent = 'Could not load block editor.';
        body.append(fail);
    }

    const JIT = globalThis.JIT;
    if (JIT?.hydrate) JIT.hydrate(shell);
    hydrateJitRoot(head);
}

function scheduleLibrarySave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        void persistLibraryEditor();
    }, 800);
}

async function persistLibraryEditor() {
    if (!editorState || !activeDocumentId) return;
    syncEditorStateFromControl();
    setSaveStatus('Saving…');
    const { res, data } = await libraryFetchJson('library_revision_save', {
        method: 'POST',
        body: JSON.stringify({
            document_id: activeDocumentId,
            base_revision_id: editorState.revision_id,
            title: editorState.title,
            blocks: editorState.blocks,
            corpus_id: editorState.corpus_id,
        }),
    });
    if (res.status === 409) {
        setSaveStatus('Conflict — reloading…');
        const editorHost = document.querySelector('[data-oaao-library-mount]');
        if (activeDocumentId && editorHost instanceof HTMLElement) {
            await openLibraryDocument(activeDocumentId);
        }
        return;
    }
    if (!res.ok || !data?.success) {
        setSaveStatus('Save failed');
        return;
    }
    const saved = data.data ?? {};
    if (saved.revision_id != null) {
        editorState.revision_id = Number(saved.revision_id);
    }
    if (Object.prototype.hasOwnProperty.call(saved, 'corpus_id')) {
        editorState.corpus_id =
            saved.corpus_id != null && Number(saved.corpus_id) > 0 ? Number(saved.corpus_id) : null;
    }
    setSaveStatus('Saved');
    const listHost = document.getElementById('workspace-library-doc-list');
    if (listHost) {
        void refreshLibrarySidebarList(listHost);
    }
}

/**
 * @param {number} documentId
 */
async function openLibraryDocument(documentId) {
    activeDocumentId = documentId;
    const editorHost = document.querySelector('[data-oaao-library-mount]');
    if (!(editorHost instanceof HTMLElement)) return;

    setSaveStatus('');
    const { res, data } = await libraryFetchJson(
        `library_document_get?document_id=${encodeURIComponent(String(documentId))}`,
    );
    if (!res.ok || !data?.success) {
        editorState = null;
        renderLibraryEditorEmpty(editorHost);
        return;
    }
    const d = data.data;
    editorState = {
        document_id: Number(d.document_id),
        title: String(d.title || 'Untitled'),
        revision_id:
            d.current_revision_id != null
                ? Number(d.current_revision_id)
                : d.revision_id != null
                  ? Number(d.revision_id)
                  : null,
        corpus_id:
            d.corpus_id != null && Number(d.corpus_id) > 0 ? Number(d.corpus_id) : null,
        blocks: Array.isArray(d.blocks) ? d.blocks : [{ type: 'paragraph', content: '' }],
    };
    await renderLibraryEditor(editorHost);
    const listHost = document.getElementById('workspace-library-doc-list');
    if (listHost) {
        void refreshLibrarySidebarList(listHost);
    }
}

async function importLibraryText() {
    const title = window.prompt('Document title', 'Imported')?.trim() || 'Imported';
    const text = window.prompt('Paste text to convert into blocks')?.trim() ?? '';
    if (!text) return;
    const wid = activeWorkspaceId();
    const { res, data } = await libraryFetchJson('library_document_convert', {
        method: 'POST',
        body: JSON.stringify({
            title,
            text,
            workspace_id: wid,
        }),
    });
    if (!res.ok || !data?.success) return;
    const id = Number(data?.data?.document_id);
    if (!Number.isFinite(id) || id < 1) return;
    const listHost = document.getElementById('workspace-library-doc-list');
    if (listHost) {
        await refreshLibrarySidebarList(listHost);
    }
    await openLibraryDocument(id);
}

async function createLibraryDocument() {
    const wid = activeWorkspaceId();
    const { res, data } = await libraryFetchJson('library_document_create', {
        method: 'POST',
        body: JSON.stringify({
            title: 'Untitled',
            workspace_id: wid,
        }),
    });
    if (!res.ok || !data?.success) return;
    const id = Number(data?.data?.document_id);
    if (!Number.isFinite(id) || id < 1) return;
    const listHost = document.getElementById('workspace-library-doc-list');
    if (listHost) {
        await refreshLibrarySidebarList(listHost);
    }
    await openLibraryDocument(id);
}

/**
 * CS-2-S9 — pick vault folder and copy library doc into vault for Hard-RAG.
 *
 * @param {number} documentId
 * @param {HTMLElement} editorHost
 */
async function openLibraryFinalizeDialog(documentId, editorHost) {
    syncEditorStateFromControl();
    await persistLibraryEditor();

    const overlay = document.createElement('div');
    overlay.className =
        'fixed inset-0 z-[1200] flex items-center justify-center bg-black/35 p-4 box-border';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Finalize to Vault');

    const card = document.createElement('div');
    card.className =
        'w-full max-w-md rounded-[12px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-lg p-4 flex flex-col gap-3';

    const title = document.createElement('h2');
    title.className = 'm-0 text-[1rem] fw-semibold fg-[var(--grid-ink)]';
    title.textContent = 'Finalize to Vault';

    const hint = document.createElement('p');
    hint.className = 'm-0 text-[0.8125rem] leading-snug fg-[var(--grid-caption)]';
    hint.textContent =
        'Creates a Vault document from this library draft and enqueues embedding. After finalize, content is discoverable via Vault RAG only.';

    const status = document.createElement('p');
    status.className = 'm-0 text-[0.75rem] fg-[var(--grid-caption)] min-h-[1rem]';

    const vaultLabel = document.createElement('label');
    vaultLabel.className = 'flex flex-col gap-1 text-[0.8125rem] fg-[var(--grid-ink)]';
    vaultLabel.textContent = 'Vault';
    const vaultSelect = document.createElement('select');
    vaultSelect.className =
        'rounded-[8px] border border-solid border-[var(--grid-line)] px-2 py-1.5 text-[0.8125rem] bg-[var(--grid-paper)] font-inherit';
    vaultLabel.append(vaultSelect);

    const folderLabel = document.createElement('label');
    folderLabel.className = 'flex flex-col gap-1 text-[0.8125rem] fg-[var(--grid-ink)]';
    folderLabel.textContent = 'Folder (optional)';
    const folderSelect = document.createElement('select');
    folderSelect.className =
        'rounded-[8px] border border-solid border-[var(--grid-line)] px-2 py-1.5 text-[0.8125rem] bg-[var(--grid-paper)] font-inherit';
    folderLabel.append(folderSelect);

    const actions = document.createElement('div');
    actions.className = 'flex justify-end gap-2 pt-1';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'oaao-library-toolbar-btn-ghost';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'oaao-library-toolbar-btn disabled:opacity-45';
    confirmBtn.textContent = 'Finalize';
    confirmBtn.disabled = true;

    actions.append(cancelBtn, confirmBtn);
    card.append(title, hint, vaultLabel, folderLabel, status, actions);
    overlay.append(card);
    document.body.append(overlay);
    hydrateJitRoot(overlay);

    /** @type {Array<{ id: number, name: string }>} */
    let vaults = [];
    /** @type {Array<{ id: number, vault_id: number, name: string, breadcrumb: string }>} */
    let containers = [];

    function closeDialog() {
        overlay.remove();
    }

    function rebuildFolderOptions(vaultId) {
        folderSelect.replaceChildren();
        const rootOpt = document.createElement('option');
        rootOpt.value = '';
        rootOpt.textContent = 'Vault root';
        folderSelect.append(rootOpt);
        for (const c of containers) {
            if (Number(c.vault_id) !== vaultId) continue;
            const opt = document.createElement('option');
            opt.value = String(c.id);
            opt.textContent = c.breadcrumb || c.name || `Folder #${c.id}`;
            folderSelect.append(opt);
        }
    }

    cancelBtn.addEventListener('click', closeDialog);
    overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) closeDialog();
    });

    vaultSelect.addEventListener('change', () => {
        const vid = Number(vaultSelect.value);
        rebuildFolderOptions(Number.isFinite(vid) ? vid : 0);
        confirmBtn.disabled = !(Number.isFinite(vid) && vid > 0);
    });

    confirmBtn.addEventListener('click', async () => {
        const vaultId = Number(vaultSelect.value);
        if (!Number.isFinite(vaultId) || vaultId < 1) return;
        const containerRaw = folderSelect.value;
        const containerId =
            containerRaw !== '' && Number.isFinite(Number(containerRaw)) ? Number(containerRaw) : null;
        const wid = activeWorkspaceId();

        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        status.textContent = 'Finalizing…';

        const { res, data } = await libraryFetchJson('library_finalize_to_vault', {
            method: 'POST',
            body: JSON.stringify({
                document_id: documentId,
                vault_id: vaultId,
                ...(containerId != null ? { container_id: containerId } : {}),
                ...(wid != null ? { workspace_id: wid } : {}),
            }),
        });

        if (!res.ok || !data?.success) {
            status.textContent = String(data?.message || 'Finalize failed');
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            return;
        }

        const vaultDocId = Number(data?.data?.vault_document_id);
        status.textContent =
            vaultDocId > 0
                ? `Created Vault document #${vaultDocId}. Embedding queued.`
                : 'Finalized to Vault.';
        confirmBtn.textContent = 'Done';
        confirmBtn.disabled = false;
        cancelBtn.textContent = 'Close';
        setSaveStatus('Finalized');
        if (editorHost instanceof HTMLElement) {
            await renderLibraryEditor(editorHost);
        }
    });

    status.textContent = 'Loading vaults…';
    const wid = activeWorkspaceId();
    const treeQ =
        wid != null
            ? `?workspace_id=${encodeURIComponent(String(wid))}&include=flat`
            : '?include=flat';
    try {
        const res = await fetch(vaultApiUrl(`vault_tree${treeQ}`), { credentials: 'include' });
        const data = await res.json();
        if (!res.ok || !data?.success) {
            status.textContent = 'Could not load vault tree.';
            return;
        }
        const payload = data?.data && typeof data.data === 'object' ? data.data : {};
        const vaultRows = Array.isArray(payload?.vaults) ? payload.vaults : [];
        const containerRows = Array.isArray(payload?.containers) ? payload.containers : [];

        vaults = [];
        for (const row of vaultRows) {
            if (!row || typeof row !== 'object') continue;
            const id = Number(row.id ?? 0);
            if (!Number.isFinite(id) || id < 1) continue;
            vaults.push({ id, name: String(row.name ?? row.label ?? `Vault #${id}`) });
        }

        containers = [];
        for (const row of containerRows) {
            if (!row || typeof row !== 'object') continue;
            const id = Number(row.id ?? 0);
            const vaultId = Number(row.vault_id ?? 0);
            if (!Number.isFinite(id) || id < 1 || !Number.isFinite(vaultId) || vaultId < 1) continue;
            containers.push({
                id,
                vault_id: vaultId,
                name: String(row.name ?? row.label ?? `Folder #${id}`),
                breadcrumb: String(row.breadcrumb ?? row.path ?? row.name ?? ''),
            });
        }

        vaultSelect.replaceChildren();
        if (vaults.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No vaults in this scope';
            vaultSelect.append(opt);
            status.textContent = 'Create a vault first, then finalize.';
            return;
        }

        for (const v of vaults) {
            const opt = document.createElement('option');
            opt.value = String(v.id);
            opt.textContent = v.name;
            vaultSelect.append(opt);
        }

        rebuildFolderOptions(vaults[0].id);
        confirmBtn.disabled = false;
        status.textContent = '';
    } catch {
        status.textContent = 'Could not load vault tree.';
    }
}

function onWorkspaceScopeChanged() {
    activeDocumentId = null;
    editorState = null;
    destroyBlockEditor();
    const listHost = document.getElementById('workspace-library-doc-list');
    if (listHost) void refreshLibrarySidebarList(listHost);
    const editorHost = document.querySelector('[data-oaao-library-mount]');
    if (editorHost instanceof HTMLElement) renderLibraryEditorEmpty(editorHost);
}

export async function mountLibraryPanel(host) {
    const editorHost =
        host?.querySelector?.('[data-oaao-library-mount]') ||
        document.querySelector('[data-oaao-library-mount]');
    const listHost = document.getElementById('workspace-library-doc-list');
    const newBtn = document.getElementById('workspace-library-new-doc');
    const importBtn = document.getElementById('workspace-library-import-text');

    if (editorHost instanceof HTMLElement) {
        renderLibraryEditorEmpty(editorHost);
    }

    if (listHost) {
        await refreshLibrarySidebarList(listHost);
    }

    hydrateJitRoot(document.getElementById('workspace-library-sidebar-section'));

    if (newBtn && newBtn.dataset.oaaoLibraryNewBound !== '1') {
        newBtn.dataset.oaaoLibraryNewBound = '1';
        newBtn.addEventListener('click', () => {
            void createLibraryDocument();
        });
    }
    if (importBtn && importBtn.dataset.oaaoLibraryImportBound !== '1') {
        importBtn.dataset.oaaoLibraryImportBound = '1';
        importBtn.addEventListener('click', () => {
            void importLibraryText();
        });
    }

    if (document.body?.dataset?.oaaoLibraryScopeBound !== '1') {
        document.body.dataset.oaaoLibraryScopeBound = '1';
        document.addEventListener('oaao-workspace-scope-changed', onWorkspaceScopeChanged);
    }
}

/** Workspace shell entry (matches vault/corpus panels). */
export async function mountShellPanel(mount) {
    await mountLibraryPanel(mount);
}

export function teardownShellPanel() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    destroyBlockEditor();
    activeDocumentId = null;
    editorState = null;
}

export default mountShellPanel;
