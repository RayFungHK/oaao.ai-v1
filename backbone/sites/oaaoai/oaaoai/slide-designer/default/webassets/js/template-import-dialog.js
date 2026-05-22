/**
 * Slide template import — PPTX upload → gallery queue → layout editor → publish.
 *
 * @module template-import-dialog
 */

import {
    ensureTemplateAnalyzeConfig,
    fetchTemplateList,
    getCachedScopeCapabilities,
    isPptxMasterPreviewPage,
    isPptxRenderPreviewPage,
    pageFidelityRenderUrl,
    pageStagePreviewUrl,
    rememberScopeCapabilities,
    resolveTemplateAnalyzeResponse,
    uploadTemplateAnalyze,
    wrapFadeTitleEl,
} from './slide-template-api.js';

const SLIDE_PREVIEW_NATIVE_W = 1280;
const SLIDE_PREVIEW_NATIVE_H = 720;
const SLIDE_PREVIEW_IFRAME_SANDBOX = 'allow-scripts allow-same-origin';

let dialogCtorPromise = null;
let razyuiPromise = null;
let cssLoaded = false;

/** @type {{ getControl?: () => { destroy?: () => void, upload?: () => void, clear?: () => void, getFiles?: () => File[] } } } | null} */
let templateImportUploader = null;

let templateImportAnalyzeInFlight = false;

/** Multipart fields for {@code template_analyze} — mutated before each upload (see vault uploader). */
const templateUploadFields = {};

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

function slideDesignerApiUrl(action) {
    const a = String(action || '').replace(/^\/+/, '');
    return prefixed(`/slide-designer/api/${a}`);
}

/**
 * @returns {number | null}
 */
function getChatEndpointId() {
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
async function fetchJson(url, options = {}) {
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
function toast(msg) {
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

function ensureCss() {
    if (cssLoaded) return;
    cssLoaded = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = prefixed('/webassets/slide-designer/default/css/oaao-slide-preview.css?v=20260525-gallery-import-dedupe');
    document.head.append(link);
}

function loadDialogCtor() {
    if (!dialogCtorPromise) {
        dialogCtorPromise = import(/* webpackIgnore: true */ prefixed('/webassets/core/default/razyui/component/Dialog.js')).then(
            (m) => m.default,
        );
    }

    return dialogCtorPromise;
}

function loadRazyui() {
    if (!razyuiPromise) {
        razyuiPromise = import(/* webpackIgnore: true */ prefixed('/webassets/core/default/razyui/razyui.js')).then(
            (m) => m.default,
        );
    }

    return razyuiPromise;
}

function destroyTemplateImportUploader() {
    if (!templateImportUploader || typeof templateImportUploader.getControl !== 'function') {
        templateImportUploader = null;
        return;
    }
    try {
        templateImportUploader.getControl().destroy();
    } catch {
        /* ignore */
    }
    templateImportUploader = null;
}

/**
 * @param {Record<string, string>} fields
 */
function rebuildTemplateUploadFields(fields) {
    for (const key of Object.keys(templateUploadFields)) {
        delete templateUploadFields[key];
    }
    Object.assign(templateUploadFields, fields);
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   buildFormFields: () => Record<string, string>,
 *   setStatus: (msg: string, busy?: boolean) => void,
 *   onAnalyzed: (data: Record<string, unknown>) => void,
 * }} hooks
 */
async function wireTemplateImportUploader(host, hooks) {
    destroyTemplateImportUploader();
    host.replaceChildren('');

    const razyui = await loadRazyui();
    const UploaderCtor = await razyui.load('Uploader');
    if (typeof UploaderCtor !== 'function') {
        host.textContent = 'Uploader unavailable';
        return;
    }

    rebuildTemplateUploadFields(hooks.buildFormFields());

    templateImportUploader = new UploaderCtor(host, {
        url: slideDesignerApiUrl('template_analyze'),
        method: 'POST',
        name: 'pptx',
        accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation',
        multiple: false,
        maxFiles: 1,
        auto: false,
        dropZone: true,
        placeholder: 'Drop .pptx here or click to browse',
        data: templateUploadFields,
        onUpload() {
            rebuildTemplateUploadFields(hooks.buildFormFields());
            hooks.setStatus('Analyzing PPTX and generating preview slides…', true);
        },
        onComplete(_file, response) {
            const kick =
                typeof response === 'object' && response !== null
                    ? /** @type {Record<string, unknown>} */ (response)
                    : {};
            hooks.setStatus('Analyzing PPTX and generating preview slides…', true);
            void (async () => {
                try {
                    const { data } = await resolveTemplateAnalyzeResponse(kick, {
                        onPoll: () => {
                            hooks.setStatus('Analyzing PPTX and generating preview slides…', true);
                        },
                    });
                    hooks.setStatus('', false);
                    if (data.success === false) {
                        toast(String(data.message ?? 'Analyze failed'));
                        return;
                    }
                    hooks.onAnalyzed(data);
                } catch {
                    hooks.setStatus('', false);
                    toast('Analyze failed');
                }
            })();
        },
        onError(_file, message) {
            hooks.setStatus('', false);
            toast(typeof message === 'string' && message ? message : 'Upload failed');
        },
    });
}

/**
 * @param {Record<string, unknown> | undefined} caps
 * @param {Record<string, HTMLInputElement>} scopeRadios
 */
function applyScopeCapabilities(caps, scopeRadios) {
    if (!caps || typeof caps !== 'object') return;

    const canTenant = caps.can_write_tenant === true;
    if (scopeRadios.tenant) {
        scopeRadios.tenant.disabled = !canTenant;
        const lab = scopeRadios.tenant.closest('label');
        if (lab instanceof HTMLElement) {
            lab.classList.toggle('oaao-template-import-scope-opt--disabled', !canTenant);
        }
    }
    if (scopeRadios.personal) {
        scopeRadios.personal.disabled = caps.can_write_personal === false;
    }
    if (!canTenant || scopeRadios.tenant?.disabled) {
        if (scopeRadios.personal) scopeRadios.personal.checked = true;
    }
}

/**
 * @param {HTMLElement} frame
 * @param {HTMLIFrameElement} iframe
 */
function mountThumb(frame, iframe) {
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
 * @param {string} previewUrl
 */
function bustPreviewSrc(previewUrl) {
    const base = prefixed(previewUrl.startsWith('/') ? previewUrl : `/${previewUrl}`);
    const u = new URL(base, window.location.href);
    u.searchParams.set('_t', String(Date.now()));
    return u.href;
}

/**
 * @param {Record<string, unknown>} page
 */
function renderPreviewCard(page, templateId, onRefresh) {
    const idx = Number(page.index) || 1;
    const title = String(page.title ?? `Slide ${idx}`);
    const verified = page.verified === true;
    const previewUrl = pageStagePreviewUrl(page);

    const card = document.createElement('article');
    card.className = 'oaao-slide-preview-card oaao-template-import-card';
    card.dataset.templateId = templateId;
    card.dataset.slideIndex = String(idx);

    const head = document.createElement('header');
    head.className = 'oaao-slide-preview-card__head';
    const badge = document.createElement('span');
    badge.className = 'oaao-slide-preview-card__head-badge';
    badge.textContent = verified ? '✓' : '!';
    badge.title = verified ? 'Verified' : 'Needs fix';
    if (!verified) {
        badge.classList.add('oaao-template-import-card__badge--warn');
    }
    head.append(wrapFadeTitleEl(title, 'oaao-slide-preview-card__head-title'), badge);

    const frameWrap = document.createElement('div');
    frameWrap.className = 'oaao-slide-preview-card__frame';
    if (pageFidelityRenderUrl(page) || (isPptxRenderPreviewPage(page) && previewUrl)) {
        const img = document.createElement('img');
        img.className = 'oaao-slide-preview-card__img';
        img.alt = title;
        img.loading = 'lazy';
        img.src = bustPreviewSrc(pageFidelityRenderUrl(page) || previewUrl);
        frameWrap.append(img);
    } else {
        const iframe = document.createElement('iframe');
        iframe.className = 'oaao-slide-preview-card__iframe';
        iframe.title = title;
        iframe.loading = 'lazy';
        iframe.setAttribute('sandbox', SLIDE_PREVIEW_IFRAME_SANDBOX);
        if (previewUrl) {
            iframe.src = bustPreviewSrc(previewUrl);
        }
        mountThumb(frameWrap, iframe);
    }

    const actions = document.createElement('div');
    actions.className = 'oaao-template-import-card__actions';
    const fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.className = 'oaao-template-import-btn oaao-template-import-btn--ghost';
    fixBtn.textContent = 'Fix layout';
    fixBtn.disabled = verified;
    fixBtn.addEventListener('click', async () => {
        fixBtn.disabled = true;
        const ep = getChatEndpointId();
        const { res, data } = await fetchJson(slideDesignerApiUrl('template_fix'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                template_id: templateId,
                slide_index: idx,
                ...(ep ? { chat_endpoint_id: ep } : {}),
            }),
        });
        const payload = data?.data && typeof data.data === 'object' ? data.data : data;
        const ok = payload?.verified === true || payload?.ok === true || data.ok === true;
        if (!res.ok || !ok) {
            toast(data.message || 'Fix failed');
            fixBtn.disabled = false;
            return;
        }
        toast('Slide fixed');
        await onRefresh();
    });
    actions.append(fixBtn);

    card.append(head, frameWrap, actions);
    return card;
}

/**
 * @param {HTMLElement} host
 * @param {string} templateId
 * @param {Record<string, unknown>[]} pages
 */
function renderPreviewStrip(host, templateId, pages, onRefresh) {
    host.replaceChildren();
    const strip = document.createElement('div');
    strip.className = 'oaao-template-import-strip';
    for (const p of pages) {
        if (!p || typeof p !== 'object') continue;
        strip.append(renderPreviewCard(/** @type {Record<string, unknown>} */ (p), templateId, onRefresh));
    }
    host.append(strip);
}

/**
 * Background analyze after import dialog closes (gallery shows queue card).
 *
 * @param {string} pendingId
 * @param {File} file
 * @param {Record<string, string>} fields
 * @param {{ label: string, scope: string, fileName: string }} meta
 */
const TEMPLATE_ANALYZE_IN_FLIGHT_SS_KEY = 'oaao_tpl_analyze_in_flight';

async function runQueuedTemplateAnalyze(pendingId, file, fields, meta) {
    try {
        try {
            sessionStorage.setItem(TEMPLATE_ANALYZE_IN_FLIGHT_SS_KEY, '1');
        } catch {
            /* ignore */
        }
        const { res, data } = await uploadTemplateAnalyze(file, fields);
        const ok = res.ok && data.success !== false;
        const tpl =
            data.template && typeof data.template === 'object'
                ? /** @type {Record<string, unknown>} */ (data.template)
                : null;
        document.dispatchEvent(
            new CustomEvent('oaao-slide-template-import-done', {
                detail: {
                    pendingId,
                    ok,
                    httpStatus: res.status,
                    message: String(data.message ?? (ok ? 'Template analyzed' : 'Analyze failed')),
                    template: tpl,
                    preview: data.preview,
                    label: tpl?.label ? String(tpl.label) : meta.label,
                    scope: meta.scope,
                    fileName: meta.fileName,
                },
            }),
        );
    } finally {
        try {
            sessionStorage.removeItem(TEMPLATE_ANALYZE_IN_FLIGHT_SS_KEY);
        } catch {
            /* ignore */
        }
        templateImportAnalyzeInFlight = false;
    }
}

/**
 * @param {Record<string, unknown>} [ctx]
 * @param {(() => void) | void} [onChange]
 */
export async function openSlideTemplateImportDialog(ctx = {}, onChange) {
    ensureCss();
    if (!(await ensureTemplateAnalyzeConfig())) {
        toast(
            'Slide template import requires an LLM in Settings → Purpose allocation (Slide template / slide_template.*).',
        );
        return;
    }
    destroyTemplateImportUploader();
    const Dialog = await loadDialogCtor();
    const body = document.createElement('div');
    body.className = 'oaao-template-import-body oaao-template-import-body--import-only';

    const uploadSection = document.createElement('section');
    uploadSection.className = 'oaao-template-import-upload';

    const scopeRow = document.createElement('div');
    scopeRow.className = 'oaao-template-import-scope';
    const scopeLabel = document.createElement('span');
    scopeLabel.className = 'oaao-template-import-scope-label';
    scopeLabel.textContent = 'Save to';
    scopeRow.append(scopeLabel);

    /** @type {Record<string, HTMLInputElement>} */
    const scopeRadios = {};
    for (const [value, text] of [
        ['personal', 'Personal'],
        ['tenant', 'Tenant'],
    ]) {
        const lab = document.createElement('label');
        lab.className = 'oaao-template-import-scope-opt';
        const inp = document.createElement('input');
        inp.type = 'radio';
        inp.name = 'oaao-template-import-scope';
        inp.value = value;
        if (value === 'personal') inp.checked = true;
        scopeRadios[value] = inp;
        lab.append(inp, document.createTextNode(` ${text}`));
        scopeRow.append(lab);
    }

    const scopeHint = document.createElement('p');
    scopeHint.className = 'oaao-template-import-scope-hint';
    scopeHint.textContent =
        'Tenant scope requires an administrator. Global templates are managed in platform settings.';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'oaao-template-import-input';
    labelInput.placeholder = 'Template name (optional)';

    const uploaderHost = document.createElement('div');
    uploaderHost.className = 'oaao-template-import-uploader-host';

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'oaao-template-import-btn oaao-template-import-btn--primary';
    uploadBtn.textContent = 'Upload PPTX & analyze';
    uploadSection.append(scopeRow, scopeHint, labelInput, uploaderHost, uploadBtn);
    body.append(uploadSection);

    const selectedScope = () => {
        for (const [value, inp] of Object.entries(scopeRadios)) {
            if (inp.checked && !inp.disabled) return value;
        }
        return 'personal';
    };

    const buildFormFields = () => {
        /** @type {Record<string, string>} */
        const fields = { scope: selectedScope() };
        const label = labelInput.value.trim();
        if (label) fields.label = label;
        const ep = getChatEndpointId();
        if (ep) fields.chat_endpoint_id = String(ep);
        return fields;
    };

    /** @type {{ close?: () => void } | null} */
    let dialogCtrl = null;

    void wireTemplateImportUploader(uploaderHost, {
        buildFormFields,
        setStatus: () => {},
        onAnalyzed: () => {},
    });

    uploadBtn.addEventListener('click', () => {
        if (templateImportAnalyzeInFlight) {
            return;
        }
        const scope = selectedScope();
        if (scope === 'tenant' && scopeRadios.tenant?.disabled) {
            toast('Tenant templates require an administrator account');
            return;
        }
        const files = templateImportUploader?.getControl?.()?.getFiles?.() ?? [];
        const file = files[0];
        if (!(file instanceof File)) {
            toast('Choose a .pptx file');
            return;
        }

        templateImportAnalyzeInFlight = true;
        uploadBtn.disabled = true;

        const label = labelInput.value.trim() || file.name.replace(/\.pptx$/i, '') || 'New template';
        const pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const fields = { ...buildFormFields(), label, original_filename: file.name };

        document.dispatchEvent(
            new CustomEvent('oaao-slide-template-import-start', {
                detail: {
                    pendingId,
                    label,
                    scope,
                    fileName: file.name,
                },
            }),
        );

        if (dialogCtrl && typeof dialogCtrl.close === 'function') {
            dialogCtrl.close();
        }
        destroyTemplateImportUploader();

        void runQueuedTemplateAnalyze(pendingId, file, fields, {
            label,
            scope,
            fileName: file.name,
        })
            .then(() => {
                if (typeof onChange === 'function') onChange();
            })
            .finally(() => {
                uploadBtn.disabled = false;
            });
    });

    const cachedCaps = getCachedScopeCapabilities();
    if (cachedCaps) {
        applyScopeCapabilities(cachedCaps, scopeRadios);
    } else {
        const capsRes = await fetchJson(slideDesignerApiUrl('template_list'));
        if (capsRes.res.ok && capsRes.data.success) {
            rememberScopeCapabilities(capsRes.data?.data);
            applyScopeCapabilities(getCachedScopeCapabilities() ?? undefined, scopeRadios);
        }
    }

    dialogCtrl = new Dialog({
        title: 'Import slide template',
        content: body,
        size: 'md',
        closable: true,
        buttons: [{ text: 'Cancel', color: 'muted', role: 'cancel' }],
    });

    void ctx;
}

export { openSlideTemplatePreviewModal as openSlideTemplateEditorDialog } from './template-preview-modal.js';

/**
 * Composer toolbar icon — {@code cp.slide_designer.template_import}.
 *
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} [ctx]
 */
export async function mountSlideTemplateComposerSlot(host, ctx = {}) {
    if (!(await ensureTemplateAnalyzeConfig())) {
        return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--grid-line)] bg-transparent cursor-pointer text-[var(--grid-ink-muted)] hover:bg-[var(--grid-line)]/30 hover:text-[var(--grid-ink)]';
    btn.title = 'Import slide template (PPTX)';
    btn.setAttribute('aria-label', 'Import slide template');
    btn.innerHTML = '<i class="ri-layout-masonry-line text-[1.05rem]" aria-hidden="true"></i>';
    btn.addEventListener('click', () => {
        void openSlideTemplateImportDialog(ctx);
    });
    host.append(btn);
}
