/**
 * Workspace templates gallery — import card first (manus-style), then template cards.
 *
 * @module template-gallery-sidebar
 */

import {
    createGalleryPreviewEyeIcon,
    ensureTemplateAnalyzeConfig,
    fetchTemplateList,
    isTemplateAnalyzeConfigured,
    mountSlideThumb,
    prefixed,
    templateDisplayLabel,
    isRasterTemplateThumb,
    templateRowHasThumb,
    templateThumbUrl,
    toast,
    wrapFadeTitleEl,
} from './slide-template-api.js';
import { openSlideTemplateImportDialog } from './template-import-dialog.js';
import { openSlideTemplatePreviewModal } from './template-preview-modal.js';

const CSS_REV = '20260524-p1-gallery-import-persist';

const TEMPLATE_IMPORT_QUEUE_SS_KEY = 'oaao_tpl_import_queue';
const TEMPLATE_ANALYZE_IN_FLIGHT_SS_KEY = 'oaao_tpl_analyze_in_flight';

let cssLoaded = false;
/** @type {'published' | 'all'} */
let listMode = 'all';

/** @type {Map<string, { pendingId: string, label: string, scope: string, fileName: string, state: 'analyzing' | 'error', error?: string }>} */
const importQueue = new Map();

/** Monotonic token — ignore stale {@link refreshGallery} completions after rapid events. */
let galleryRefreshGen = 0;

/** @type {HTMLElement | null} */
let gridEl = null;

/** @type {HTMLElement | null} */
let tplMountRef = null;

/** @type {(() => void) | null} */
let onGalleryRefresh = null;

/** @type {((mode: 'published' | 'all') => void) | null} */
let setListModeFn = null;

/** @type {string | null} */
let highlightTemplateId = null;

let importQueueListenersBound = false;

function hasBackgroundTemplateAnalyze() {
    try {
        return sessionStorage.getItem(TEMPLATE_ANALYZE_IN_FLIGHT_SS_KEY) === '1';
    } catch {
        return false;
    }
}

function persistImportQueue() {
    try {
        const arr = [...importQueue.values()];
        if (arr.length) {
            sessionStorage.setItem(TEMPLATE_IMPORT_QUEUE_SS_KEY, JSON.stringify(arr));
        } else {
            sessionStorage.removeItem(TEMPLATE_IMPORT_QUEUE_SS_KEY);
        }
    } catch {
        /* quota */
    }
}

function restoreImportQueueFromSession() {
    importQueue.clear();
    try {
        const raw = sessionStorage.getItem(TEMPLATE_IMPORT_QUEUE_SS_KEY) ?? '';
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        for (const entry of parsed) {
            if (!entry || typeof entry !== 'object') continue;
            const pendingId = String(entry.pendingId ?? '').trim();
            if (!pendingId) continue;
            importQueue.set(pendingId, {
                pendingId,
                label: String(entry.label ?? ''),
                scope: String(entry.scope ?? 'personal'),
                fileName: String(entry.fileName ?? ''),
                state: entry.state === 'error' ? 'error' : 'analyzing',
                error: typeof entry.error === 'string' ? entry.error : undefined,
            });
        }
    } catch {
        /* ignore */
    }
}

/** Last successful {@link fetchTemplateList} rows — keep visible during import analyze. */
/** @type {Record<string, unknown>[]} */
let cachedGalleryRows = [];

function ensureCss() {
    if (cssLoaded) return;
    cssLoaded = true;
    const preview = document.createElement('link');
    preview.rel = 'stylesheet';
    preview.href = prefixed(
        `/webassets/slide-designer/default/css/oaao-slide-preview.css?v=${encodeURIComponent(CSS_REV)}`,
    );
    document.head.append(preview);
}

function openImportDialog() {
    void openSlideTemplateImportDialog({});
}

/**
 * First grid cell — import PPTX (manus.im-style).
 */
function renderImportCard() {
    const card = document.createElement('article');
    card.className = 'oaao-tpl-gallery-card oaao-tpl-gallery-card--import';
    card.setAttribute('role', 'listitem');
    card.tabIndex = 0;
    card.setAttribute('aria-label', 'Import slide template');

    const inner = document.createElement('div');
    inner.className = 'oaao-tpl-gallery-card__import-inner';

    const icon = document.createElement('i');
    icon.className = 'ri-cloud-upload rz-icon oaao-tpl-gallery-card__import-icon';
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'oaao-tpl-gallery-card__import-label';
    label.textContent = 'Import template';

    inner.append(icon, label);
    card.append(inner);

    const activate = () => openImportDialog();
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            activate();
        }
    });

    return card;
}

/**
 * @param {{ pendingId: string, label: string, scope: string, fileName: string, state?: 'analyzing' | 'error', error?: string }} entry
 */
function renderPendingCard(entry) {
    const state = entry.state ?? 'analyzing';
    const card = document.createElement('article');
    card.className = 'oaao-tpl-gallery-card oaao-tpl-gallery-card--loading';
    card.dataset.pendingId = entry.pendingId;
    card.setAttribute('role', 'listitem');

    const thumb = document.createElement('div');
    thumb.className = 'oaao-tpl-gallery-card__thumb';
    if (state === 'error') {
        const errIcon = document.createElement('span');
        errIcon.className = 'oaao-tpl-gallery-card__thumb-error-icon';
        errIcon.setAttribute('aria-hidden', 'true');
        errIcon.innerHTML = '<i class="ri-xmark-circle rz-icon" aria-hidden="true"></i>';
        thumb.append(errIcon);
    } else {
        thumb.classList.add('oaao-tpl-gallery-card__thumb--loading');
        const loading = document.createElement('div');
        loading.className = 'oaao-tpl-gallery-card__thumb-loading';
        const spinner = document.createElement('div');
        spinner.className = 'oaao-tpl-gallery-card__spinner';
        spinner.setAttribute('aria-hidden', 'true');
        loading.append(spinner);
        thumb.append(loading);
    }

    const meta = document.createElement('div');
    meta.className = 'oaao-tpl-gallery-card__meta';
    const title = wrapFadeTitleEl(
        entry.label || entry.fileName || 'Importing…',
        'oaao-tpl-gallery-card__title',
    );
    const badge = document.createElement('span');
    badge.className = 'oaao-tpl-gallery-card__badge oaao-tpl-gallery-card__badge--queue';
    badge.textContent = state === 'error' ? 'Failed' : 'Analyzing…';
    meta.append(title, badge);

    card.append(thumb, meta);
    return card;
}

/**
 * @param {Record<string, unknown>} row
 */
function renderGalleryCard(row) {
    const tid = String(row.template_id ?? '').trim();
    const label = templateDisplayLabel(tid, String(row.label ?? ''));

    const card = document.createElement('article');
    card.className = 'oaao-tpl-gallery-card';
    if (tid && tid === highlightTemplateId) {
        card.classList.add('oaao-tpl-gallery-card--highlight');
    }
    card.dataset.templateId = tid;
    card.setAttribute('role', 'listitem');

    const thumb = document.createElement('div');
    thumb.className = 'oaao-tpl-gallery-card__thumb';

    const hover = document.createElement('div');
    hover.className = 'oaao-tpl-gallery-card__hover';
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'oaao-tpl-gallery-card__preview-btn';
    previewBtn.setAttribute('aria-label', 'Preview template');
    previewBtn.append(createGalleryPreviewEyeIcon(16));
    previewBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void openSlideTemplatePreviewModal(row, onGalleryRefresh);
    });
    hover.append(previewBtn);

    const thumbUrl = templateRowHasThumb(row) ? templateThumbUrl(row) : '';
    const thumbSource = String(row.thumbnail_source ?? 'auto').trim().toLowerCase();
    if (thumbUrl) {
        if (isRasterTemplateThumb(thumbSource)) {
            const img = document.createElement('img');
            img.className = 'oaao-tpl-gallery-card__img';
            img.alt = label;
            img.loading = 'lazy';
            img.src = thumbUrl;
            thumb.append(hover, img);
        } else {
            const iframe = document.createElement('iframe');
            iframe.className = 'oaao-tpl-gallery-card__iframe';
            iframe.title = label;
            iframe.loading = 'lazy';
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
            iframe.src = thumbUrl;
            thumb.append(hover);
            mountSlideThumb(thumb, iframe);
        }
    } else {
        thumb.append(hover);
    }

    const meta = document.createElement('div');
    meta.className = 'oaao-tpl-gallery-card__meta';
    meta.append(wrapFadeTitleEl(label, 'oaao-tpl-gallery-card__title'));

    card.append(thumb, meta);
    return card;
}

/**
 * @param {unknown} custom
 * @returns {Record<string, unknown>[]}
 */
/**
 * @param {string} text
 */
function normalizeGalleryLabel(text) {
    return String(text ?? '')
        .trim()
        .toLowerCase()
        .replace(/\.pptx$/i, '')
        .replace(/\s+/g, ' ');
}

/**
 * @param {Record<string, unknown>} row
 */
function galleryRowLabel(row) {
    const tid = String(row.template_id ?? '').trim();
    return normalizeGalleryLabel(templateDisplayLabel(tid, String(row.label ?? '')));
}

/**
 * Hide stale draft rows that duplicate an in-flight / failed import queue card (same title).
 *
 * @param {Record<string, unknown>[]} rows
 * @param {{ label?: string, fileName?: string }[]} pending
 */
function filterRowsAgainstPending(rows, pending) {
    if (!pending.length) return rows;
    const keys = new Set();
    for (const p of pending) {
        const label = normalizeGalleryLabel(p.label);
        const file = normalizeGalleryLabel(p.fileName);
        if (label) keys.add(label);
        if (file) keys.add(file);
    }
    if (!keys.size) return rows;

    return rows.filter((row) => {
        const key = galleryRowLabel(row);
        if (!keys.has(key)) return true;
        const st = String(row.status ?? '').toLowerCase();
        if ((st === 'draft' || st === 'preview') && !templateRowHasThumb(row)) {
            return false;
        }
        return true;
    });
}

function normalizeTemplateRows(custom) {
    if (!Array.isArray(custom)) return [];
    const out = [];
    const seen = new Set();
    for (const raw of custom) {
        if (!raw || typeof raw !== 'object') continue;
        const tid = String(/** @type {Record<string, unknown>} */ (raw).template_id ?? '').trim();
        if (!tid || seen.has(tid)) continue;
        seen.add(tid);
        out.push(/** @type {Record<string, unknown>} */ (raw));
    }
    return out;
}

/**
 * Paint gallery grid — all cards are direct children of {@code .oaao-tpl-gallery-grid} (CSS grid).
 *
 * @param {HTMLElement} grid
 * @param {{
 *   rows: Record<string, unknown>[];
 *   pending: { pendingId: string; label: string; scope: string; fileName: string; state?: string; error?: string }[];
 *   showPending: boolean;
 *   showImport: boolean;
 *   statusMessage?: string;
 * }} opts
 */
function paintGalleryGrid(grid, opts) {
    const { rows, pending, showPending, showImport, statusMessage } = opts;
    const visibleRows = filterRowsAgainstPending(rows, showPending ? pending : []);
    grid.replaceChildren();

    if (showImport) {
        grid.append(renderImportCard());
    }
    if (showPending && pending.length) {
        for (const entry of pending) {
            grid.append(renderPendingCard(entry));
        }
    }

    for (const raw of visibleRows) {
        grid.append(renderGalleryCard(raw));
    }

    if (statusMessage) {
        const msg = document.createElement('p');
        msg.className = 'oaao-tpl-gallery-empty';
        msg.textContent = statusMessage;
        grid.append(msg);
    }
}

/**
 * @param {HTMLElement} grid
 * @param {{ fetchList?: boolean }} [options]
 */
async function refreshGallery(grid, options = {}) {
    const fetchList = options.fetchList !== false;
    const gen = ++galleryRefreshGen;
    const pending = [...importQueue.values()];
    const showPending = listMode === 'all';
    const showImport = listMode === 'all' && isTemplateAnalyzeConfigured();

    let bootMessage = '';
    if (fetchList && cachedGalleryRows.length === 0 && pending.length === 0) {
        bootMessage = hasBackgroundTemplateAnalyze() ? 'Analyzing PPTX…' : 'Loading…';
    }

    paintGalleryGrid(grid, {
        rows: cachedGalleryRows,
        pending,
        showPending,
        showImport,
        statusMessage: bootMessage,
    });

    if (!fetchList) {
        applyGalleryHighlight(grid);
        return;
    }

    const { res, data } = await fetchTemplateList(listMode === 'published', '');
    if (gen !== galleryRefreshGen) {
        return;
    }

    const showImportAfter = listMode === 'all' && isTemplateAnalyzeConfigured();
    let statusMessage = '';

    if (!res.ok || !data.success) {
        statusMessage = String(data?.message ?? 'Could not load templates');
        if (!isTemplateAnalyzeConfigured()) {
            statusMessage +=
                ' Import requires an LLM on the Slide template purpose (Settings → Purpose allocation, slide_template.*).';
        }
        paintGalleryGrid(grid, {
            rows: cachedGalleryRows,
            pending: [...importQueue.values()],
            showPending,
            showImport: showImportAfter,
            statusMessage,
        });
        applyGalleryHighlight(grid);
        return;
    }

    cachedGalleryRows = normalizeTemplateRows(data?.data?.custom_templates);
    if (cachedGalleryRows.length === 0 && !isTemplateAnalyzeConfigured()) {
        statusMessage =
            'Import is disabled until an administrator assigns an LLM to the Slide template purpose (Settings → Purpose allocation, slide_template.*).';
    } else if (cachedGalleryRows.length === 0 && pending.length === 0 && hasBackgroundTemplateAnalyze()) {
        statusMessage = 'Analyzing PPTX…';
    }

    paintGalleryGrid(grid, {
        rows: cachedGalleryRows,
        pending: [...importQueue.values()],
        showPending,
        showImport: showImportAfter,
        statusMessage,
    });
    applyGalleryHighlight(grid);
}

/**
 * @param {HTMLElement} grid
 */
function applyGalleryHighlight(grid) {
    if (!highlightTemplateId) return;
    const el = grid.querySelector(`[data-template-id="${CSS.escape(highlightTemplateId)}"]`);
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    window.setTimeout(() => {
        highlightTemplateId = null;
        el?.classList.remove('oaao-tpl-gallery-card--highlight');
    }, 2400);
}

/** @param {Event} ev */
function onImportStart(ev) {
    const detail = ev.detail;
    if (!detail || typeof detail !== 'object') return;
    const pendingId = String(detail.pendingId ?? '').trim();
    if (!pendingId) return;
    importQueue.set(pendingId, {
        pendingId,
        label: String(detail.label ?? ''),
        scope: String(detail.scope ?? 'personal'),
        fileName: String(detail.fileName ?? ''),
        state: 'analyzing',
    });
    persistImportQueue();
    if (setListModeFn) setListModeFn('all');
    if (gridEl) void refreshGallery(gridEl, { fetchList: false });
}

/** @param {Event} ev */
function onImportDone(ev) {
    const detail = ev.detail;
    if (!detail || typeof detail !== 'object') return;
    const pendingId = String(detail.pendingId ?? '').trim();
    if (pendingId) importQueue.delete(pendingId);
    persistImportQueue();

    const ok = detail.ok === true;
    if (!ok) {
        let msg = String(detail.message ?? 'Import failed');
        const status = Number(detail.httpStatus);
        if (status === 503 && !/orchestrator|llm|purpose/i.test(msg)) {
            msg =
                'Import unavailable (503). Check Settings → Purpose allocation for Slide template LLM, and that the orchestrator is running.';
        }
        toast(msg);
        if (pendingId) {
            importQueue.set(pendingId, {
                pendingId,
                label: String(detail.label ?? ''),
                scope: String(detail.scope ?? 'personal'),
                fileName: String(detail.fileName ?? ''),
                state: 'error',
                error: msg,
            });
        }
    } else {
        const tpl =
            detail.template && typeof detail.template === 'object'
                ? /** @type {Record<string, unknown>} */ (detail.template)
                : null;
        const tid = tpl ? String(tpl.template_id ?? '').trim() : '';
        if (tid) {
            highlightTemplateId = tid;
            cachedGalleryRows = cachedGalleryRows.filter(
                (row) => String(row.template_id ?? '').trim() !== tid,
            );
        }
        const renderOk =
            tpl &&
            (String(tpl.preview_mode ?? '') === 'pptx_render' ||
                String(tpl.thumbnail_source ?? '') === 'pptx_render');
        toast(
            renderOk
                ? 'Template ready — previews match your PPTX. Publish when ready.'
                : 'Template analyzed, but slide previews could not be rendered. Rebuild the orchestrator image (LibreOffice) and re-import.',
        );
    }

    if (setListModeFn) setListModeFn('all');
    persistImportQueue();
    if (gridEl) void refreshGallery(gridEl);
}

function bindImportQueueListeners() {
    if (importQueueListenersBound) return;
    importQueueListenersBound = true;
    document.addEventListener('oaao-slide-template-import-start', onImportStart);
    document.addEventListener('oaao-slide-template-import-done', onImportDone);
}

/**
 * @param {HTMLElement} tabsHost
 */
function bindGalleryTabs(tabsHost) {
    tabsHost.replaceChildren();
    const tabs = document.createElement('div');
    tabs.className = 'oaao-tpl-gallery-tabs';

    const pubTab = document.createElement('button');
    pubTab.type = 'button';
    pubTab.className = 'oaao-tpl-gallery-tab';
    pubTab.textContent = 'Published';

    const allTab = document.createElement('button');
    allTab.type = 'button';
    allTab.className = 'oaao-tpl-gallery-tab oaao-tpl-gallery-tab--active';
    allTab.textContent = 'All mine';

    const setTab = (mode) => {
        listMode = mode;
        pubTab.classList.toggle('oaao-tpl-gallery-tab--active', mode === 'published');
        allTab.classList.toggle('oaao-tpl-gallery-tab--active', mode === 'all');
        if (gridEl) void refreshGallery(gridEl);
    };
    setListModeFn = setTab;
    pubTab.addEventListener('click', () => setTab('published'));
    allTab.addEventListener('click', () => setTab('all'));

    tabs.append(pubTab, allTab);
    tabsHost.append(tabs);
}

/**
 * @param {HTMLElement} grid
 * @param {HTMLElement} tabsHost
 */
function bindTemplateGallery(grid, tabsHost) {
    if (grid.dataset.oaaoTplGalleryBound === '1') return;
    grid.dataset.oaaoTplGalleryBound = '1';
    ensureCss();
    restoreImportQueueFromSession();
    bindImportQueueListeners();
    bindGalleryTabs(tabsHost);

    gridEl = grid;
    onGalleryRefresh = () => {
        if (gridEl) void refreshGallery(gridEl);
    };

    void refreshGallery(grid);
    void ensureTemplateAnalyzeConfig().then(() => {
        if (grid.dataset.oaaoTplGalleryBound === '1' && gridEl) {
            void refreshGallery(gridEl);
        }
    });
}

/**
 * @param {HTMLElement} mount
 */
function teardownTemplateGallery(mount) {
    persistImportQueue();
    galleryRefreshGen += 1;
    cachedGalleryRows = [];
    highlightTemplateId = null;

    const grid = mount.querySelector('[data-oaao-tpl-gallery="root"]');
    const tabs = mount.querySelector('[data-oaao-tpl-gallery="tabs"]');
    if (grid instanceof HTMLElement) {
        grid.replaceChildren();
        delete grid.dataset.oaaoTplGalleryBound;
    }
    if (tabs instanceof HTMLElement) {
        tabs.replaceChildren();
    }
    gridEl = null;
    onGalleryRefresh = null;
    setListModeFn = null;
}

/** @param {{ preserveConversationSidebar?: boolean }} [_options] */
export function teardownShellPanel(_options = {}) {
    if (tplMountRef) {
        teardownTemplateGallery(tplMountRef);
        tplMountRef = null;
    }
}

/**
 * SPA shell mount — {@code workspace/templates} (Gallery layout).
 *
 * @param {HTMLElement} mount
 */
export async function mountShellPanel(mount) {
    const grid = mount.querySelector('[data-oaao-tpl-gallery="root"]');
    const tabsHost = mount.querySelector('[data-oaao-tpl-gallery="tabs"]');
    if (!(grid instanceof HTMLElement) || !(tabsHost instanceof HTMLElement)) {
        return;
    }

    tplMountRef = mount;
    bindTemplateGallery(grid, tabsHost);
}

bindImportQueueListeners();
