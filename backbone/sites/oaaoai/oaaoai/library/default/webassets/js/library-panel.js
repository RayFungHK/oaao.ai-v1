/**
 * CS-2-S4 — Library split shell: sidebar list (workspace) + block editor (main).
 *
 * @module library-panel
 */

/** @type {number|null} */
let activeDocumentId = null;

/** @type {{ document_id: number, title: string, blocks: Array<{ type: string, content: string }> }|null} */
let editorState = null;

let saveTimer = null;

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

function libraryApiUrl(path) {
    const base = `${mountPrefix()}/library/api`.replace(/\/{2,}/g, '/');
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
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.documentId = String(id);
        const active = id === activeDocumentId;
        btn.className = [
            'w-full text-left rounded-[8px] px-2 py-2 text-[0.8125rem] leading-snug fg-[var(--grid-ink)]',
            'border-none bg-transparent cursor-pointer font-inherit transition-colors truncate',
            active ? 'bg-[var(--grid-line)]/45 fw-semibold' : 'hover:bg-[var(--grid-line)]/20',
        ].join(' ');
        btn.textContent = String(row.title || 'Untitled').trim() || 'Untitled';
        btn.addEventListener('click', () => {
            void openLibraryDocument(id);
        });
        listHost.append(btn);
    }
}

/**
 * @param {HTMLElement} editorHost
 */
function renderLibraryEditorEmpty(editorHost) {
    editorHost.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className =
        'flex flex-col items-center justify-center flex-1 gap-2 p-8 text-center fg-[var(--grid-caption)]';
    wrap.innerHTML =
        '<p class="m-0 text-sm">Select a document from the sidebar or create a new one.</p>';
    editorHost.append(wrap);
    const JIT = globalThis.JIT;
    if (JIT?.hydrate) JIT.hydrate(wrap);
}

/**
 * @param {HTMLElement} editorHost
 */
function renderLibraryEditor(editorHost) {
    if (!editorState) {
        renderLibraryEditorEmpty(editorHost);
        return;
    }
    editorHost.replaceChildren();

    const shell = document.createElement('div');
    shell.className = 'flex flex-col flex-1 min-h-0 min-w-0';

    const head = document.createElement('header');
    head.className =
        'flex flex-wrap items-center gap-2 shrink-0 px-6 py-3 border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className =
        'flex-1 min-w-[12rem] rounded-[8px] border border-solid border-[var(--grid-line)] px-3 py-1.5 text-[0.9375rem] fg-[var(--grid-ink)] bg-[var(--grid-paper)] font-inherit';
    titleInput.value = editorState.title || 'Untitled';
    titleInput.addEventListener('input', () => {
        if (editorState) {
            editorState.title = titleInput.value;
            scheduleLibrarySave();
        }
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className =
        'rounded-[8px] h-9 px-3 text-[0.8125rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25';
    addBtn.textContent = 'Add paragraph';
    addBtn.addEventListener('click', () => {
        if (!editorState) return;
        editorState.blocks.push({ type: 'paragraph', content: '' });
        renderLibraryEditor(editorHost);
        scheduleLibrarySave();
    });

    const saveLbl = document.createElement('span');
    saveLbl.dataset.oaaoLibrarySaveStatus = '1';
    saveLbl.className = 'text-[0.75rem] fg-[var(--grid-caption)] shrink-0';
    saveLbl.textContent = '';

    head.append(titleInput, addBtn, saveLbl);

    const body = document.createElement('div');
    body.className =
        'flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4 flex flex-col gap-3 max-w-[48rem] w-full mx-auto box-border';

    editorState.blocks.forEach((block, idx) => {
        const row = document.createElement('div');
        row.className = 'flex flex-col gap-1 min-w-0';

        if (block.type === 'heading') {
            const el = document.createElement('div');
            el.contentEditable = 'true';
            el.className =
                'oaao-library-block text-[1.125rem] fw-semibold fg-[var(--grid-ink)] outline-none min-h-[1.5rem] whitespace-pre-wrap break-words';
            el.textContent = block.content || '';
            el.addEventListener('input', () => {
                block.content = el.textContent || '';
                scheduleLibrarySave();
            });
            row.append(el);
        } else {
            const el = document.createElement('div');
            el.contentEditable = 'true';
            el.className =
                'oaao-library-block text-[0.9375rem] leading-relaxed fg-[var(--grid-ink)] outline-none min-h-[1.25rem] whitespace-pre-wrap break-words';
            el.textContent = block.content || '';
            el.addEventListener('input', () => {
                block.content = el.textContent || '';
                scheduleLibrarySave();
            });
            row.append(el);
        }

        const tools = document.createElement('div');
        tools.className = 'flex gap-2';
        const toHeading = document.createElement('button');
        toHeading.type = 'button';
        toHeading.className = 'text-[0.6875rem] fg-[var(--grid-caption)] bg-transparent border-none cursor-pointer font-inherit underline';
        toHeading.textContent = block.type === 'heading' ? 'Paragraph' : 'Heading';
        toHeading.addEventListener('click', () => {
            block.type = block.type === 'heading' ? 'paragraph' : 'heading';
            renderLibraryEditor(editorHost);
            scheduleLibrarySave();
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'text-[0.6875rem] fg-[var(--grid-caption)] bg-transparent border-none cursor-pointer font-inherit underline';
        del.textContent = 'Remove';
        del.addEventListener('click', () => {
            editorState.blocks.splice(idx, 1);
            if (editorState.blocks.length === 0) {
                editorState.blocks.push({ type: 'paragraph', content: '' });
            }
            renderLibraryEditor(editorHost);
            scheduleLibrarySave();
        });
        tools.append(toHeading, del);
        row.append(tools);
        body.append(row);
    });

    shell.append(head, body);
    editorHost.append(shell);
    const JIT = globalThis.JIT;
    if (JIT?.hydrate) JIT.hydrate(shell);
}

function setSaveStatus(text) {
    const el = document.querySelector('[data-oaao-library-save-status]');
    if (el instanceof HTMLElement) {
        el.textContent = text;
    }
}

function scheduleLibrarySave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        void persistLibraryEditor();
    }, 800);
}

async function persistLibraryEditor() {
    if (!editorState || !activeDocumentId) return;
    setSaveStatus('Saving…');
    const { res, data } = await libraryFetchJson('library_revision_save', {
        method: 'POST',
        body: JSON.stringify({
            document_id: activeDocumentId,
            title: editorState.title,
            blocks: editorState.blocks,
        }),
    });
    if (!res.ok || !data?.success) {
        setSaveStatus('Save failed');
        return;
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

    const { res, data } = await libraryFetchJson(
        `library_document_get?document_id=${encodeURIComponent(String(documentId))}`,
    );
    if (!res.ok || !data?.success) {
        renderLibraryEditorEmpty(editorHost);
        return;
    }
    const d = data.data;
    editorState = {
        document_id: Number(d.document_id),
        title: String(d.title || 'Untitled'),
        blocks: Array.isArray(d.blocks) ? d.blocks : [{ type: 'paragraph', content: '' }],
    };
    renderLibraryEditor(editorHost);
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

    document.addEventListener('oaao-workspace-scope-changed', () => {
        activeDocumentId = null;
        editorState = null;
        if (listHost) void refreshLibrarySidebarList(listHost);
        if (editorHost instanceof HTMLElement) renderLibraryEditorEmpty(editorHost);
    });
}

export default { mountLibraryPanel };
