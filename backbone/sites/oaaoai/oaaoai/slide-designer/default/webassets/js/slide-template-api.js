/**
 * Slide template API helpers — shared by gallery sidebar and import dialog.
 *
 * @module slide-template-api
 */

export const SLIDE_PREVIEW_NATIVE_W = 1280;
export const SLIDE_PREVIEW_NATIVE_H = 720;
export const SLIDE_PREVIEW_IFRAME_SANDBOX = 'allow-scripts allow-same-origin';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Eye icon for template gallery preview — inline SVG (no icon font).
 *
 * @param {number} [size]
 */
export function createGalleryPreviewEyeIcon(size = 16) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'oaao-tpl-gallery-card__preview-icon');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute(
        'd',
        'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
    );
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '3');
    svg.append(path, circle);
    return svg;
}

/**
 * @param {string} path
 */
export function prefixed(path) {
    const g = globalThis;
    if (typeof g.oaaoPrefixedSitePath === 'function') {
        return g.oaaoPrefixedSitePath(path.startsWith('/') ? path : `/${path}`);
    }

    return path;
}

export function slideDesignerApiUrl(action) {
    const a = String(action || '').replace(/^\/+/, '');
    return prefixed(`/slide-designer/api/${a}`);
}

/**
 * @returns {number | null}
 */
export function getChatEndpointId() {
    const tr = document.getElementById('workspace-purpose-selector-trigger');
    const ds =
        typeof tr?.dataset?.routingChatEndpointId === 'string' ? tr.dataset.routingChatEndpointId.trim() : '';
    const fromUi = ds !== '' ? Number(ds) : NaN;
    if (Number.isFinite(fromUi) && fromUi > 0) {
        return Math.floor(fromUi);
    }
    try {
        const raw = (localStorage.getItem('oaao.workspace.chat_endpoint_id') || '').trim();
        const v = Number(raw);

        return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 */
export async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json', ...(options.headers || {}) },
        ...options,
    });
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = {};
    }

    return { res, data };
}

/**
 * @param {string} msg
 */
export function toast(msg) {
    const g = globalThis;
    if (typeof g.oaaoFireToast === 'function') {
        g.oaaoFireToast(msg, 'info');
        return;
    }
    const el = document.createElement('div');
    el.className = 'oaao-template-import-toast';
    el.textContent = msg;
    el.setAttribute('role', 'status');
    document.body.append(el);
    window.setTimeout(() => el.remove(), 4200);
}

/**
 * @param {Record<string, unknown>} row
 */
/**
 * @param {string} source
 */
export function isRasterTemplateThumb(source) {
    const s = String(source ?? 'auto').trim().toLowerCase();
    return s === 'custom' || s === 'pptx_render';
}

/**
 * Whether the row has on-disk preview assets safe to load in a thumb iframe/img.
 *
 * @param {Record<string, unknown> | null | undefined} row
 */
export function templateRowHasThumb(row) {
    if (!row || typeof row !== 'object') return false;
    const tid = String(row.template_id ?? '').trim();
    if (!tid) return false;
    const status = String(row.status ?? 'draft').toLowerCase();
    if (status !== 'preview' && status !== 'published') return false;
    const src = String(row.thumbnail_source ?? 'auto').trim().toLowerCase();
    if (src === 'pptx_render' || src === 'custom') return true;
    if (String(row.preview_mode ?? '').trim().toLowerCase() === 'pptx_render') return true;
    const pages = row.preview_pages;
    return Array.isArray(pages) && pages.length > 0;
}

/**
 * Single-line label with horizontal fade (no hard ellipsis).
 *
 * @param {string} text
 * @param {string} [titleClass]
 */
export function wrapFadeTitleEl(text, titleClass = 'oaao-fade-title__text') {
    const wrap = document.createElement('span');
    wrap.className = 'oaao-fade-title';
    const inner = document.createElement('span');
    inner.className = titleClass;
    inner.textContent = text;
    wrap.append(inner);
    return wrap;
}

export function templateThumbUrl(row) {
    const tid = String(row.template_id ?? '').trim();
    if (!tid) return '';
    const source = String(row.thumbnail_source ?? 'auto').trim().toLowerCase();
    if (source === 'custom') {
        const u = slideDesignerApiUrl('template_thumbnail') + `?template_id=${encodeURIComponent(tid)}`;
        return prefixed(u.startsWith('/') ? u : `/${u}`);
    }
    const page = Math.max(1, Number(row.thumbnail_page) || 1);
    if (source === 'pptx_render') {
        let u = slideDesignerApiUrl('template_render');
        u += `?template_id=${encodeURIComponent(tid)}&page=${page}`;
        return prefixed(u.startsWith('/') ? u : `/${u}`);
    }
    let u = slideDesignerApiUrl('template_preview_html');
    u += `?template_id=${encodeURIComponent(tid)}&page=${page}`;
    return prefixed(u.startsWith('/') ? u : `/${u}`);
}

/**
 * @param {Record<string, unknown> | null | undefined} page
 */
export function isPptxRenderPreviewPage(page) {
    if (!page || typeof page !== 'object') return false;
    const layout = String(page.layout ?? '').trim().toLowerCase();
    if (layout === 'pptx_render') return true;
    const url = String(page.preview_url ?? '');
    return url.includes('template_render');
}

/**
 * Phase 3 positioned master shell (geometry-derived HTML).
 *
 * @param {Record<string, unknown> | null | undefined} page
 */
export function isPptxMasterPreviewPage(page) {
    if (!page || typeof page !== 'object') return false;
    const layout = String(page.layout ?? '').trim().toLowerCase();
    const suggested = String(page.suggested_layout ?? '').trim().toLowerCase();
    if (layout === 'pptx_master' || suggested === 'pptx_master') return true;
    const masterUrl = String(page.master_preview_url ?? '');
    if (masterUrl.includes('template_master_html')) return true;
    return Boolean(String(page.master_path ?? '').trim());
}

/**
 * LibreOffice slide PNG when this page has template_render preview_url.
 *
 * @param {Record<string, unknown> | null | undefined} page
 */
export function pageFidelityRenderUrl(page) {
    if (!page || typeof page !== 'object') return '';
    const url = String(page.preview_url ?? '').trim();
    if (!url.includes('template_render')) return '';
    return prefixed(url.startsWith('/') ? url : `/${url}`);
}

/**
 * Main-stage preview: fidelity PNG first (fonts/images from PPTX raster), else master HTML.
 *
 * @param {Record<string, unknown> | null | undefined} page
 */
export function pageStagePreviewUrl(page) {
    if (!page || typeof page !== 'object') return '';
    const fidelity = pageFidelityRenderUrl(page);
    if (fidelity) return fidelity;
    const master = String(page.master_preview_url ?? '').trim();
    if (master) return prefixed(master.startsWith('/') ? master : `/${master}`);
    const url = String(page.preview_url ?? '').trim();
    return url ? prefixed(url.startsWith('/') ? url : `/${url}`) : '';
}

/**
 * Strip thumbnail: same priority as main stage (PNG when available).
 *
 * @param {Record<string, unknown> | null | undefined} page
 */
export function pageThumbPreviewUrl(page) {
    const fidelity = pageFidelityRenderUrl(page);
    if (fidelity) return fidelity;
    if (isPptxMasterPreviewPage(page)) {
        const stage = pageStagePreviewUrl(page);
        if (stage) return stage;
    }
    const url = String(page?.preview_url ?? '').trim();
    return url ? prefixed(url.startsWith('/') ? url : `/${url}`) : '';
}

/**
 * @param {HTMLElement} frame
 * @param {HTMLIFrameElement} iframe
 */
export function mountSlideThumb(frame, iframe) {
    iframe.setAttribute('width', String(SLIDE_PREVIEW_NATIVE_W));
    iframe.setAttribute('height', String(SLIDE_PREVIEW_NATIVE_H));
    const scale = document.createElement('div');
    scale.className = 'oaao-slide-preview-card__scale';
    scale.append(iframe);
    frame.append(scale);

    const apply = () => {
        const w = frame.clientWidth;
        const h = frame.clientHeight;
        if (w < 1 || h < 1) return;
        const s = Math.min(w / SLIDE_PREVIEW_NATIVE_W, h / SLIDE_PREVIEW_NATIVE_H);
        const dx = (w - SLIDE_PREVIEW_NATIVE_W * s) / 2;
        const dy = (h - SLIDE_PREVIEW_NATIVE_H * s) / 2;
        scale.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    };
    apply();
    iframe.addEventListener('load', apply, { once: true });
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(apply).observe(frame);
    }
}

/**
 * @param {Record<string, unknown>} template
 * @param {Record<string, unknown> | null} preview
 */
export function pagesFromPayload(template, preview) {
    if (preview && Array.isArray(preview.pages)) {
        return /** @type {Record<string, unknown>[]} */ (preview.pages);
    }
    if (template && Array.isArray(template.preview_pages)) {
        return /** @type {Record<string, unknown>[]} */ (template.preview_pages);
    }

    return [];
}

/** @type {Record<string, unknown> | null} */
let cachedScopeCapabilities = null;

/** @type {boolean | null} */
let templateAnalyzeLlmConfigured = null;

/** @type {boolean | null} */
let pptxRenderAvailable = null;

/**
 * Scope write caps from the last successful {@link fetchTemplateList} (or import dialog fetch).
 *
 * @returns {Record<string, unknown> | null}
 */
export function getCachedScopeCapabilities() {
    return cachedScopeCapabilities;
}

/** Whether Settings → Purpose allocation has {@code slide_template.*} with an LLM endpoint. */
export function isTemplateAnalyzeConfigured() {
    return templateAnalyzeLlmConfigured === true;
}

/** Whether orchestrator can LibreOffice-render uploaded PPTX to PNG previews. */
export function isPptxRenderAvailable() {
    return pptxRenderAvailable === true;
}

/** Load {@link fetchTemplateList} once if the configured flag is not cached yet. */
export async function ensureTemplateAnalyzeConfig() {
    if (templateAnalyzeLlmConfigured === null) {
        await fetchTemplateList(false, '');
    }
    return isTemplateAnalyzeConfigured();
}

/**
 * @param {unknown} payload
 */
export function rememberScopeCapabilities(payload) {
    const caps =
        payload &&
        typeof payload === 'object' &&
        payload !== null &&
        'scope_capabilities' in /** @type {Record<string, unknown>} */ (payload) &&
        typeof /** @type {Record<string, unknown>} */ (payload).scope_capabilities === 'object'
            ? /** @type {Record<string, unknown>} */ (
                  /** @type {Record<string, unknown>} */ (payload).scope_capabilities
              )
            : null;
    if (caps) {
        cachedScopeCapabilities = caps;
    }
}

/**
 * @param {boolean} [publishedOnly]
 * @param {string} [scopeFilter]
 */
export async function fetchTemplateList(publishedOnly = false, scopeFilter = '') {
    let url = slideDesignerApiUrl('template_list');
    const qs = new URLSearchParams();
    if (publishedOnly) qs.set('published_only', '1');
    if (scopeFilter) qs.set('scope_filter', scopeFilter);
    const q = qs.toString();
    if (q) url += `?${q}`;
    const result = await fetchJson(url);
    const payload = result.data?.data;
    if (payload && typeof payload === 'object') {
        rememberScopeCapabilities(payload);
        if ('template_analyze_llm_configured' in /** @type {Record<string, unknown>} */ (payload)) {
            const flag = /** @type {Record<string, unknown>} */ (payload).template_analyze_llm_configured;
            templateAnalyzeLlmConfigured = flag === true || flag === 1 || flag === '1';
        }
        if ('pptx_render_available' in /** @type {Record<string, unknown>} */ (payload)) {
            const renderFlag = /** @type {Record<string, unknown>} */ (payload).pptx_render_available;
            pptxRenderAvailable = renderFlag === true || renderFlag === 1 || renderFlag === '1';
        }
    }
    return result;
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 */
export function isPptxRenderTemplateRow(row) {
    if (!row || typeof row !== 'object') return false;
    const mode = String(row.preview_mode ?? '').trim().toLowerCase();
    const thumb = String(row.thumbnail_source ?? '').trim().toLowerCase();
    return mode === 'pptx_render' || thumb === 'pptx_render';
}

/**
 * @param {string} tid
 * @param {string} rawLabel
 */
export function templateDisplayLabel(tid, rawLabel) {
    const label = String(rawLabel ?? '').trim();
    if (!label || label === tid || /^import_[a-f0-9]{8,}$/i.test(label)) {
        return 'Imported template';
    }
    return label;
}

/**
 * Human-readable gallery status (queue + server row).
 *
 * @param {Record<string, unknown> | null | undefined} row
 * @param {'analyzing' | 'error' | null} [queueState]
 */
export function templateStatusLabel(row, queueState = null) {
    if (queueState === 'analyzing') return 'Analyzing…';
    if (queueState === 'error') return 'Import failed';
    const st = String(row?.status ?? 'draft').toLowerCase();
    if (st === 'published') return 'Published';
    if (st === 'preview') return 'Preview';
    return 'Draft';
}

/**
 * CSS modifier for dialog / gallery status tags.
 *
 * @param {string} status
 */
/**
 * Publish / preview verification failures — jump targets for preview modal.
 *
 * @param {unknown} raw
 * @returns {{ index: number, title: string, label: string, errorsSummary: string }[]}
 */
export function normalizeTemplatePublishIssues(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {{ index: number, title: string, label: string, errorsSummary: string }[]} */
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const row = /** @type {Record<string, unknown>} */ (item);
        const index = Number(row.index) || 0;
        if (index < 1) continue;
        const title = String(row.title ?? `Slide ${index}`).trim() || `Slide ${index}`;
        const errs = row.validation_errors;
        let errorsSummary = '';
        if (Array.isArray(errs) && errs.length > 0) {
            const parts = errs.slice(0, 2).map((e) => String(e).trim()).filter(Boolean);
            errorsSummary = parts.join('; ');
            if (errs.length > 2) errorsSummary = `${errorsSummary}…`;
        }
        out.push({
            index,
            title,
            label: `${index}. ${title}`,
            errorsSummary,
        });
    }
    out.sort((a, b) => a.index - b.index);
    return out;
}

export function templateStatusTagClass(status) {
    const st = String(status ?? 'draft').toLowerCase();
    if (st === 'published') return 'oaao-tpl-status-tag--published';
    if (st === 'preview') return 'oaao-tpl-status-tag--preview';
    return 'oaao-tpl-status-tag--draft';
}

/**
 * Dialog title row: colored status tag + template label.
 *
 * @param {string} label
 * @param {string} status
 */
export function buildTemplatePreviewDialogTitle(label, status) {
    const row = document.createElement('div');
    row.className = 'oaao-tpl-preview-modal__title-row';

    const tag = document.createElement('span');
    tag.className = `oaao-tpl-status-tag ${templateStatusTagClass(status)}`;
    tag.textContent = templateStatusLabel({ status });

    const text = document.createElement('span');
    text.className = 'oaao-tpl-preview-modal__title-text';
    text.textContent = label;

    row.append(tag, text);
    return row;
}

const TEMPLATE_IMPORT_POLL_MS = 2000;
const TEMPLATE_IMPORT_POLL_MAX_MS = 600_000;

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Poll background template import until done, failed, or timeout.
 *
 * @param {string} jobId
 * @param {{ onPoll?: (data: Record<string, unknown>) => void }} [opts]
 */
export async function waitTemplateImportJob(jobId, opts = {}) {
    const started = Date.now();
    /** @type {{ ok: boolean, status: number }} */
    let lastRes = { ok: false, status: 0 };
    /** @type {Record<string, unknown>} */
    let lastData = {};
    while (Date.now() - started < TEMPLATE_IMPORT_POLL_MAX_MS) {
        const url = `${slideDesignerApiUrl('template_import_job')}?job_id=${encodeURIComponent(jobId)}`;
        const { res, data } = await fetchJson(url);
        lastRes = res;
        lastData = data;
        opts.onPoll?.(data);
        const status = String(data.status ?? '');
        if (!res.ok || data.success === false) {
            return { res, data };
        }
        if (status === 'done' || status === 'failed') {
            return { res, data };
        }
        await sleep(TEMPLATE_IMPORT_POLL_MS);
    }
    return {
        res: lastRes,
        data: {
            ...lastData,
            success: false,
            status: 'timeout',
            message: 'Template import timed out',
        },
    };
}

/**
 * @param {Record<string, unknown>} initial Kickoff or legacy sync response from template_analyze.
 * @param {{ onPoll?: (data: Record<string, unknown>) => void }} [opts]
 */
export async function resolveTemplateAnalyzeResponse(initial, opts = {}) {
    const jobId = String(initial.job_id ?? '').trim();
    const status = String(initial.status ?? '');
    if (jobId !== '' && status === 'running') {
        return waitTemplateImportJob(jobId, opts);
    }
    return {
        res: { ok: initial.success !== false, status: initial.success === false ? 502 : 200 },
        data: initial,
    };
}

/**
 * @param {File} file
 * @param {Record<string, string>} fields
 * @param {{ onPoll?: (data: Record<string, unknown>) => void }} [opts]
 */
export async function uploadTemplateAnalyze(file, fields, opts = {}) {
    const fd = new FormData();
    fd.append('pptx', file);
    for (const [key, value] of Object.entries(fields)) {
        if (value !== '') fd.append(key, value);
    }
    const kick = await fetchJson(slideDesignerApiUrl('template_analyze'), { method: 'POST', body: fd });
    const finished = await resolveTemplateAnalyzeResponse(kick.data, opts);
    return {
        res: finished.res,
        data: finished.data,
    };
}

/**
 * @param {string} templateId
 */
export async function publishTemplate(templateId, autoFix = true) {
    const ep = getChatEndpointId();
    return fetchJson(slideDesignerApiUrl('template_publish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            template_id: templateId,
            auto_fix: autoFix,
            ...(ep ? { chat_endpoint_id: ep } : {}),
        }),
    });
}

/**
 * @param {string} templateId
 */
export async function unpublishTemplate(templateId) {
    return fetchJson(slideDesignerApiUrl('template_unpublish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId }),
    });
}

/**
 * @param {string} templateId
 */
export async function deleteTemplate(templateId) {
    return fetchJson(slideDesignerApiUrl('template_delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId }),
    });
}

/**
 * @param {Record<string, unknown> | null | undefined} row
 */
export function isCustomTemplateRow(row) {
    const src = String(row?.source ?? 'custom').trim().toLowerCase();
    return src === 'custom' || src === '';
}

/**
 * @param {string} previewUrl
 */
export function bustPreviewSrc(previewUrl) {
    const base = prefixed(previewUrl.startsWith('/') ? previewUrl : `/${previewUrl}`);
    const u = new URL(base, window.location.href);
    u.searchParams.set('_t', String(Date.now()));
    return u.href;
}

/**
 * @param {string} templateId
 * @param {number} [slideIndex]
 */
export async function fixTemplateSlide(templateId, slideIndex) {
    const ep = getChatEndpointId();
    return fetchJson(slideDesignerApiUrl('template_fix'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            template_id: templateId,
            ...(slideIndex != null && slideIndex > 0 ? { slide_index: slideIndex } : {}),
            ...(ep ? { chat_endpoint_id: ep } : {}),
        }),
    });
}

/**
 * @param {string} templateId
 */
export async function fetchTemplateRow(templateId) {
    const { res, data } = await fetchTemplateList(false, '');
    if (!res.ok || !data.success) return null;
    const custom = data?.data?.custom_templates;
    if (!Array.isArray(custom)) return null;
    const row = custom.find((t) => t && typeof t === 'object' && String(t.template_id) === templateId);
    return row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : null;
}

/** Survives Chat SPA remount after {@code __oaaoWorkspaceNavigate('workspace/chat')} ({@see chat-panel.js}). */
export const CHAT_PENDING_SLIDE_TEMPLATE_KEY = 'oaao_chat_pending_slide_template';

/**
 * @param {{ template_id: string, label: string, thumb_url?: string, scope?: unknown, status?: unknown }} detail
 */
export function persistChatPendingSlideTemplate(detail) {
    try {
        sessionStorage.setItem(CHAT_PENDING_SLIDE_TEMPLATE_KEY, JSON.stringify(detail));
    } catch {
        /* quota */
    }
}

/**
 * @param {Record<string, unknown>} row
 */
export async function applyTemplateForChat(row) {
    const tid = String(row.template_id ?? '').trim();
    const label = String(row.label ?? tid);
    if (!tid) return;
    if (String(row.status ?? '') !== 'published') {
        toast('Publish the template before using it in Chat');
        return;
    }

    const detail = {
        template_id: tid,
        label,
        scope: row.scope,
        status: row.status,
        thumb_url: templateThumbUrl(row),
        row,
    };
    persistChatPendingSlideTemplate(detail);

    const hasChat = Array.isArray(globalThis.OAAO_SPA_REGISTRY)
        ? globalThis.OAAO_SPA_REGISTRY.some((p) => p && p.page_id === 'workspace/chat')
        : true;
    const navigateFn = globalThis.__oaaoWorkspaceNavigate;
    if (hasChat && typeof navigateFn === 'function') {
        void navigateFn('workspace/chat');
    }

    document.dispatchEvent(new CustomEvent('oaao-select-slide-template', { detail }));

    toast(`Template “${label}” ready — send a message to start a deck.`);
}
