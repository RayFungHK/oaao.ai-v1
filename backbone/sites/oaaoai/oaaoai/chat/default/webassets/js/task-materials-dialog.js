/**
 * Task materials list — RazyUI Dialog (SD-1).
 *
 * @module task-materials-dialog
 */

/** @typedef {'all' | 'document' | 'image' | 'code' | 'link' | 'slide'} MaterialFilter */

/** @typedef {{ material_id?: string, title?: string, kind?: string, category?: string, mime?: string, size_bytes?: number, uri?: string, created_at?: string, meta?: Record<string, unknown> }} MaterialRow */

import {
    materialIconName,
    mountRuiIcon,
    mountRuiIconSync,
    OAAO_RUI_ICON_DOWNLOAD,
    OAAO_RUI_ICON_MATERIALS,
    OAAO_RUI_ICON_SOFT_CLASS,
} from './oaao-rui-icons.js';

let dialogCtorPromise = null;

/**
 * @param {string} path
 */
function prefixed(path) {
    const g = globalThis;
    if (typeof g.oaaoPrefixedSitePath === 'function') {
        return g.oaaoPrefixedSitePath(path.startsWith('/') ? path : `/${path}`);
    }

    return path;
}

function loadDialogCtor() {
    if (!dialogCtorPromise) {
        dialogCtorPromise = import(/* webpackIgnore: true */ prefixed('/webassets/core/default/razyui/component/Dialog.js')).then(
            (m) => m.default,
        );
    }

    return dialogCtorPromise;
}

/**
 * @param {unknown} n
 */
function formatBytes(n) {
    const num = typeof n === 'number' && Number.isFinite(n) ? n : Number(n);
    if (!Number.isFinite(num) || num < 0) return '';
    if (num < 1024) return `${Math.round(num)} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;

    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * @param {string} iso
 */
function formatMaterialDate(iso) {
    const raw = String(iso ?? '').trim();
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw.slice(0, 10);

    return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * @param {Record<string, unknown> | null | undefined} meta
 */
export function countMaterialsFromMeta(meta) {
    if (!meta || typeof meta !== 'object') return 0;
    /** @type {Set<string>} */
    const seen = new Set();
    let n = 0;

    const materials = meta.materials;
    if (Array.isArray(materials)) {
        for (const raw of materials) {
            if (!raw || typeof raw !== 'object') continue;
            const id = String(/** @type {Record<string, unknown>} */ (raw).material_id
                ?? /** @type {Record<string, unknown>} */ (raw).id
                ?? '').trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            n += 1;
        }
    }

    const pipe = meta.oaao_pipeline;
    if (pipe && typeof pipe === 'object') {
        const arts = /** @type {Record<string, unknown>} */ (pipe).artifacts;
        if (Array.isArray(arts)) {
            for (const raw of arts) {
                if (!raw || typeof raw !== 'object') continue;
                const id = String(/** @type {Record<string, unknown>} */ (raw).id ?? '').trim();
                if (!id || seen.has(id)) continue;
                seen.add(id);
                n += 1;
            }
        }
    }

    return n;
}

/**
 * @param {string} key
 * @param {string} [fallback]
 */
/** @type {Promise<((key: string, fallback?: string) => string) | null> | null} */
let translateFnPromise = null;

/**
 * @param {string} key
 * @param {string} [fallback]
 */
async function loadTranslateFn() {
    if (!translateFnPromise) {
        translateFnPromise = import(/* webpackIgnore: true */ prefixed('/webassets/core/default/js/oaao-i18n.js'))
            .then((m) => (typeof m.oaaoT === 'function' ? m.oaaoT : null))
            .catch(() => null);
    }

    return translateFnPromise;
}

/**
 * @param {string} key
 * @param {string} fallback
 */
/** @type {((key: string, fallback?: string) => string) | null} */
let translateFn = null;

/**
 * @param {string} key
 * @param {string} fallback
 */
function t(key, fallback) {
    return translateFn ? translateFn(key, fallback) : fallback;
}

/**
 * @param {string} title
 */
function materialDownloadFilename(title) {
    const base = String(title ?? 'download').trim() || 'download';

    return base.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 180);
}

/**
 * @param {string} uri
 * @param {number} conversationId
 */
function resolveMaterialDownloadUrl(uri, conversationId) {
    const raw = String(uri ?? '').trim();
    if (!raw) return '';

    let path = raw;
    if (path.startsWith('/')) {
        path = prefixed(path);
    }

    if (!path.includes('/slide-designer/api/download')) {
        return path;
    }

    try {
        const base =
            typeof window.location?.origin === 'string' && window.location.origin
                ? window.location.origin
                : '';
        const url = new URL(path, base || undefined);
        const cid = Number(conversationId) || 0;
        if (cid > 0 && !url.searchParams.has('conversation_id')) {
            url.searchParams.set('conversation_id', String(cid));
        }
        if (base) {
            return url.toString();
        }

        return url.pathname + url.search;
    } catch {
        const cid = Number(conversationId) || 0;
        if (cid > 0 && !path.includes('conversation_id=')) {
            const sep = path.includes('?') ? '&' : '?';
            return `${path}${sep}conversation_id=${encodeURIComponent(String(cid))}`;
        }

        return path;
    }
}

/**
 * @param {string} message
 */
function toastMaterialsError(message) {
    const g = globalThis;
    if (typeof g.toastOaao === 'function') {
        g.toastOaao(message);
    }
}

/**
 * @param {MaterialRow} row
 * @param {number} conversationId
 */
async function triggerMaterialDownload(row, conversationId) {
    const url = resolveMaterialDownloadUrl(row.uri, conversationId);
    if (!url) return;

    try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
            toastMaterialsError(t('chat.materials.download_failed', 'Download failed'));
            return;
        }

        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = materialDownloadFilename(row.title);
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.append(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
        toastMaterialsError(t('chat.materials.download_failed', 'Download failed'));
    }
}

/**
 * @param {{ conversationId: number, messageId?: number, apiUrl: (action: string, query?: Record<string, string>) => string }} opts
 */
function triggerMaterialsZipDownload(opts) {
    const cid = Number(opts.conversationId) || 0;
    if (cid < 1) return;

    const q = { conversation_id: String(cid) };
    const mid = Number(opts.messageId) || 0;
    if (mid > 0) {
        q.message_id = String(mid);
    }

    const url = opts.apiUrl('materials_zip', q);
    window.location.assign(url);
}

/**
 * @param {HTMLElement} actions
 * @param {MaterialRow} row
 * @param {{ conversationId: number }} opts
 */
function appendMaterialDownloadButton(actions, row, opts) {
    const uri = String(row.uri ?? '').trim();
    if (!uri) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
        'oaao-task-materials-download-btn inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-[8px] border-none bg-transparent cursor-pointer hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink-muted)] transition-colors font-inherit';
    btn.title = t('chat.materials.download', 'Download');
    btn.setAttribute('aria-label', btn.title);
    mountRuiIconSync(btn, OAAO_RUI_ICON_DOWNLOAD, { size: 16, class: OAAO_RUI_ICON_SOFT_CLASS });
    btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void triggerMaterialDownload(row, opts.conversationId);
    });
    actions.append(btn);
}

/**
 * @param {MaterialRow[]} rows
 * @param {{ conversationId: number, messageId?: number, apiUrl: (action: string, query?: Record<string, string>) => string }} opts
 */
function buildMaterialsDialogButtons(rows, opts) {
    const downloadables = rows.filter((r) => String(r.uri ?? '').trim() !== '');

    /** @type {Array<{ text: string, color?: string, role?: string, close?: boolean, action?: (ctrl: { close: () => void }) => void }>} */
    const buttons = [];
    if (downloadables.length) {
        buttons.push({
            text: t('chat.materials.download_all', 'Download all'),
            color: 'muted',
            close: false,
            action: () => {
                triggerMaterialsZipDownload(opts);
            },
        });
    }
    buttons.push({ text: t('chat.materials.close', 'Close'), color: 'accent', role: 'cancel' });

    return buttons;
}

/**
 * @param {MaterialFilter} filter
 * @param {MaterialRow[]} rows
 */
function filterMaterials(filter, rows) {
    if (filter === 'all') return rows;

    return rows.filter((r) => String(r.category ?? '').toLowerCase() === filter);
}

/**
 * @param {HTMLElement} root
 * @param {MaterialRow[]} rows
 * @param {MaterialFilter} active
 * @param {(f: MaterialFilter) => void} onFilter
 * @param {{ conversationId: number }} opts
 */
function renderList(root, rows, active, onFilter, opts) {
    root.replaceChildren();

    const filters = /** @type {const} */ (['all', 'document', 'image', 'code', 'link', 'slide']);
    const filterBar = document.createElement('div');
    filterBar.className = 'oaao-task-materials-filters';
    const filterLabels = {
        all: t('chat.materials.filter_all', 'All'),
        document: t('chat.materials.filter_documents', 'Documents'),
        image: t('chat.materials.filter_images', 'Images'),
        code: t('chat.materials.filter_code', 'Code files'),
        link: t('chat.materials.filter_links', 'Links'),
        slide: t('chat.materials.filter_slides', 'Slides'),
    };
    for (const f of filters) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'oaao-task-materials-filter' + (active === f ? ' is-active' : '');
        btn.textContent = filterLabels[f];
        btn.addEventListener('click', () => onFilter(f));
        filterBar.append(btn);
    }
    root.append(filterBar);

    const filtered = filterMaterials(active, rows);
    if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0';
        empty.textContent = t('chat.materials.empty', 'No files in this category.');
        root.append(empty);

        return;
    }

    const section = document.createElement('div');
    section.className = 'oaao-task-materials-section';
    const head = document.createElement('div');
    head.className = 'oaao-task-materials-section-head';
    head.textContent = t('chat.materials.section_earlier', 'Earlier');
    section.append(head);

    const list = document.createElement('div');
    list.className = 'oaao-task-materials-rows';

    for (const row of filtered) {
        const item = document.createElement('div');
        item.className = 'oaao-task-materials-row';

        const iconWrap = document.createElement('div');
        iconWrap.className =
            'shrink-0 w-9 h-9 rounded-[8px] bg-[var(--grid-line)]/30 flex items-center justify-center';
        iconWrap.setAttribute('aria-hidden', 'true');
        void mountRuiIcon(iconWrap, materialIconName(row.category, row.mime), { size: 18, class: OAAO_RUI_ICON_SOFT_CLASS });

        const body = document.createElement('div');
        body.className = 'min-w-0 flex-1 flex flex-col gap-0.5';
        const title = document.createElement('div');
        title.className = 'oaao-task-materials-row-title';
        title.textContent = String(row.title ?? 'File');
        const sub = document.createElement('div');
        sub.className = 'oaao-task-materials-row-sub';
        const date = formatMaterialDate(row.created_at);
        const sz = formatBytes(row.size_bytes);
        sub.textContent = [date, sz].filter(Boolean).join(' · ');
        body.append(title, sub);

        const actions = document.createElement('div');
        actions.className = 'flex flex-row flex-wrap items-center justify-end gap-1 shrink-0';

        const kind = String(row.kind ?? '').toLowerCase();
        const cat = String(row.category ?? '').toLowerCase();
        const meta = row.meta && typeof row.meta === 'object' ? row.meta : null;
        const projectId = meta && typeof meta.project_id === 'string' ? meta.project_id.trim() : '';
        const materialId = String(row.material_id ?? '').trim();
        const isSlideDeck =
            kind === 'slide_project' || cat === 'slide' || materialId.startsWith('slide-') || projectId !== '';

        if (isSlideDeck && materialId) {
            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className =
                'rounded-full px-2.5 py-1 text-[0.7rem] fw-semibold border border-[var(--grid-line)] bg-transparent cursor-pointer font-inherit fg-[var(--grid-accent,#2563eb)] hover:bg-[var(--grid-line)]/25';
            previewBtn.textContent = t('chat.materials.preview_deck', 'Preview');
            previewBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                void openSlideDeckFromMaterialRow(row, opts.conversationId);
            });
            actions.append(previewBtn);

            const cont = document.createElement('button');
            cont.type = 'button';
            cont.className =
                'rounded-full px-2.5 py-1 text-[0.7rem] fw-semibold border border-[var(--grid-line)] bg-transparent cursor-pointer font-inherit fg-[var(--grid-ink)] hover:bg-[var(--grid-line)]/25';
            cont.textContent = t('chat.materials.continue_deck', 'Continue this deck');
            cont.addEventListener('click', (ev) => {
                ev.stopPropagation();
                document.dispatchEvent(
                    new CustomEvent('oaao-continue-slide-material', {
                        bubbles: true,
                        detail: {
                            material_id: materialId,
                            title: String(row.title ?? 'Slide deck'),
                            project_id: projectId || undefined,
                        },
                    }),
                );
            });
            actions.append(cont);
        }

        appendMaterialDownloadButton(actions, row, opts);

        item.append(iconWrap, body, actions);

        list.append(item);
    }

    section.append(list);
    root.append(section);
}

/**
 * @param {MaterialRow} row
 * @param {number} conversationId
 */
async function openSlideDeckFromMaterialRow(row, conversationId) {
    const cid = Number(conversationId) || 0;
    if (cid < 1) return;
    const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
    let projectId = String(meta.project_id ?? '').trim();
    const materialId = String(row.material_id ?? '').trim();
    if (!projectId && materialId.startsWith('slide-')) {
        projectId = materialId.slice('slide-'.length);
    }
    if (!projectId) return;

    const mod = await import(/* webpackIgnore: true */ prefixed('/webassets/chat/default/js/slide-deck-viewer.js')).catch(
        () => null,
    );
    if (!mod || typeof mod.openSlideDeckViewerFromEvent !== 'function') return;

    await mod.openSlideDeckViewerFromEvent({
        projectId,
        conversationId: cid,
        deckTitle: String(row.title ?? 'Slide deck'),
        slideIndex: 1,
    });
}

/**
 * @param {{ conversationId: number, messageId?: number, fetchJson: (url: string) => Promise<{ res: Response, data: Record<string, unknown> }>, apiUrl: (action: string, query?: Record<string, string>) => string }} opts
 */
async function loadMaterialsRows(opts) {
    const mid = Number(opts.messageId) || 0;
    if (mid > 0) {
        const url = opts.apiUrl('message_materials', {
            conversation_id: String(opts.conversationId),
            message_id: String(mid),
        });
        const { res, data } = await opts.fetchJson(url);
        if (!res.ok || !data.success) {
            return { ok: false, data, rows: [] };
        }
        return {
            ok: true,
            data,
            rows: Array.isArray(data.materials) ? /** @type {MaterialRow[]} */ (data.materials) : [],
        };
    }

    const url = opts.apiUrl('conversation_materials', {
        conversation_id: String(opts.conversationId),
    });
    const { res, data } = await opts.fetchJson(url);
    if (!res.ok || !data.success) {
        return { ok: false, data, rows: [] };
    }
    return {
        ok: true,
        data,
        rows: Array.isArray(data.materials) ? /** @type {MaterialRow[]} */ (data.materials) : [],
    };
}

/**
 * @param {{ conversationId: number, fetchJson: (url: string) => Promise<{ res: Response, data: Record<string, unknown> }>, apiUrl: (action: string, query?: Record<string, string>) => string }} opts
 */
export async function openConversationMaterialsDialog(opts) {
    const Dialog = await loadDialogCtor();
    if (typeof Dialog !== 'function') return;

    translateFn = await loadTranslateFn();

    const loaded = await loadMaterialsRows({ ...opts, messageId: 0 });
    if (!loaded.ok) {
        const g = globalThis;
        if (typeof g.toastOaao === 'function') {
            g.toastOaao(String(loaded.data?.message ?? t('chat.materials.load_failed', 'Could not load materials')));
        }
        return;
    }

    const rows = loaded.rows;
    const shell = document.createElement('div');
    shell.className = 'oaao-task-materials-dialog flex flex-col min-w-0 max-h-[min(70vh,32rem)]';
    const listHost = document.createElement('div');
    listHost.className = 'oaao-task-materials-list overflow-y-auto min-h-0 flex-1 pr-1';
    shell.append(listHost);

    /** @type {MaterialFilter} */
    let activeFilter = 'all';
    const paint = () => renderList(listHost, rows, activeFilter, (f) => {
        activeFilter = f;
        paint();
    }, opts);
    paint();

    void new Dialog({
        title: t('chat.materials.dialog_title', 'All files in this task'),
        content: shell,
        size: 'sm',
        closable: true,
        buttons: buildMaterialsDialogButtons(rows, opts),
    });
}

/**
 * @param {{ conversationId: number, messageId: number, fetchJson: (url: string) => Promise<{ res: Response, data: Record<string, unknown> }>, apiUrl: (action: string, query?: Record<string, string>) => string }} opts
 */
export async function openTaskMaterialsDialog(opts) {
    const Dialog = await loadDialogCtor();
    if (typeof Dialog !== 'function') return;

    translateFn = await loadTranslateFn();

    const loaded = await loadMaterialsRows(opts);
    if (!loaded.ok) {
        const g = globalThis;
        if (typeof g.toastOaao === 'function') {
            g.toastOaao(String(loaded.data?.message ?? t('chat.materials.load_failed', 'Could not load materials')));
        }

        return;
    }

    const rows = loaded.rows;

    const shell = document.createElement('div');
    shell.className = 'oaao-task-materials-dialog flex flex-col min-w-0 max-h-[min(70vh,32rem)]';

    const listHost = document.createElement('div');
    listHost.className = 'oaao-task-materials-list overflow-y-auto min-h-0 flex-1 pr-1';
    shell.append(listHost);

    /** @type {MaterialFilter} */
    let activeFilter = 'all';
    const paint = () => renderList(listHost, rows, activeFilter, (f) => {
        activeFilter = f;
        paint();
    }, opts);
    paint();

    void new Dialog({
        title: t('chat.materials.dialog_title', 'All files in this task'),
        content: shell,
        size: 'sm',
        closable: true,
        buttons: buildMaterialsDialogButtons(rows, opts),
    });
}

/**
 * Material toolbar icon — RazyUI Lucide {@code package}.
 *
 * @param {string} tip
 * @param {(btn: HTMLButtonElement) => void | Promise<void>} onClick
 * @param {AbortSignal} signal
 */
export function createTaskMaterialsToolbarIcon(tip, onClick, signal) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.dataset.oaaoChat = 'task-materials';
    b.className =
        'oaao-chat-task-materials-btn inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-[8px] border-none bg-transparent cursor-pointer hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink-muted)] transition-colors font-inherit';

    mountRuiIconSync(b, OAAO_RUI_ICON_MATERIALS, { size: 18, class: OAAO_RUI_ICON_SOFT_CLASS });

    b.addEventListener(
        'click',
        () => {
            void Promise.resolve(onClick(b)).catch(() => {});
        },
        { signal },
    );

    return b;
}
