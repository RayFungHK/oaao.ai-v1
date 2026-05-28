/**
 * CS-2-S1 — Library workspace shell (list + convert API wired; editor in CS-2-S4).
 */
const LIBRARY_API = '/library/api';

async function libraryFetchJson(path, init = {}) {
    const res = await fetch(`${LIBRARY_API}/${path}`, {
        credentials: 'same-origin',
        ...init,
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    return { res, data };
}

function renderLibraryShell(mount) {
    if (!(mount instanceof HTMLElement)) return;
    mount.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col items-center justify-center flex-1 gap-3 p-8 text-center';
    const h = document.createElement('h2');
    h.className = 'm-0 text-lg font-semibold fg-[var(--grid-ink)]';
    h.textContent = 'Library';
    const p = document.createElement('p');
    p.className = 'm-0 text-sm max-w-md fg-[var(--grid-ink-muted)]';
    p.textContent =
        'Block Editor and document CRUD are coming in CS-2-S4. Upload convert is available via API (orchestrator /v1/library/convert).';
    wrap.append(h, p);
    mount.append(wrap);
    const JIT = globalThis.JIT;
    if (JIT?.hydrate) JIT.hydrate(wrap);
}

export async function mountLibraryPanel(host) {
    const root =
        host?.querySelector?.('[data-oaao-library-root]') ||
        host?.querySelector?.('[data-oaao-library-mount]') ||
        host;
    const mount = root?.querySelector?.('[data-oaao-library-mount]') || root;
    renderLibraryShell(mount);
    try {
        await libraryFetchJson('library_documents_list');
    } catch {
        /* ignore — shell only */
    }
}

export default { mountLibraryPanel };
