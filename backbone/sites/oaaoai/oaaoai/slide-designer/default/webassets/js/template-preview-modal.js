/**
 * Template preview modal — manus-style layout strip + edit / lock / publish.
 *
 * @module template-preview-modal
 */

import {
    SLIDE_PREVIEW_IFRAME_SANDBOX,
    applyTemplateForChat,
    bustPreviewSrc,
    deleteTemplate,
    fetchTemplateRow,
    fixTemplateSlide,
    isCustomTemplateRow,
    isPptxMasterPreviewPage,
    isPptxRenderPreviewPage,
    pageFidelityRenderUrl,
    isPptxRenderTemplateRow,
    mountSlideThumb,
    pageStagePreviewUrl,
    pageThumbPreviewUrl,
    pagesFromPayload,
    prefixed,
    buildTemplatePreviewDialogTitle,
    normalizeTemplatePublishIssues,
    publishTemplate,
    toast,
    unpublishTemplate,
} from './slide-template-api.js';

const CSS_REV = '20260524-p1-publish-chips';

let dialogCtorPromise = null;
let cssLoaded = false;

function ensureCss() {
    if (cssLoaded) return;
    cssLoaded = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = prefixed(
        `/webassets/slide-designer/default/css/oaao-slide-preview.css?v=${encodeURIComponent(CSS_REV)}`,
    );
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

/**
 * @param {HTMLElement} frame
 * @param {string} previewUrl
 * @param {string} title
 */
function mountStageIframe(frame, previewUrl, title) {
    frame.replaceChildren();
    const iframe = document.createElement('iframe');
    iframe.className = 'oaao-tpl-preview-modal__stage-iframe';
    iframe.title = title;
    iframe.setAttribute('sandbox', SLIDE_PREVIEW_IFRAME_SANDBOX);
    if (previewUrl) {
        iframe.src = bustPreviewSrc(previewUrl);
    }
    mountSlideThumb(frame, iframe);
}

/**
 * @param {HTMLElement} frame
 * @param {string} previewUrl
 * @param {string} title
 */
function mountStageImage(frame, previewUrl, title) {
    frame.replaceChildren();
    const img = document.createElement('img');
    img.className = 'oaao-tpl-preview-modal__stage-img';
    img.alt = title;
    if (previewUrl) {
        img.src = bustPreviewSrc(previewUrl);
    }
    frame.append(img);
}

/**
 * @param {HTMLElement} frame
 * @param {string} previewUrl
 * @param {string} title
 * @param {Record<string, unknown> | undefined} page
 */
function mountStagePreview(frame, previewUrl, title, page) {
    const fidelity = pageFidelityRenderUrl(page);
    if (fidelity) {
        mountStageImage(frame, fidelity, title);
        return;
    }
    if (isPptxMasterPreviewPage(page)) {
        mountStageIframe(frame, previewUrl, title);
        return;
    }
    if (isPptxRenderPreviewPage(page)) {
        mountStageImage(frame, previewUrl, title);
        return;
    }
    mountStageIframe(frame, previewUrl, title);
}

/**
 * @param {Record<string, unknown>} row
 * @param {(() => void) | void} [onChange]
 */
export async function openSlideTemplatePreviewModal(row, onChange) {
    const templateId = String(row.template_id ?? '').trim();
    if (!templateId) return;

    ensureCss();
    const Dialog = await loadDialogCtor();

    const body = document.createElement('div');
    body.className = 'oaao-tpl-preview-modal';

    const statusEl = document.createElement('p');
    statusEl.className = 'oaao-tpl-preview-modal__status';
    statusEl.hidden = true;

    const stage = document.createElement('div');
    stage.className = 'oaao-tpl-preview-modal__stage';

    const strip = document.createElement('div');
    strip.className = 'oaao-tpl-preview-modal__strip';
    strip.setAttribute('role', 'tablist');

    const slideBar = document.createElement('div');
    slideBar.className = 'oaao-tpl-preview-modal__slide-bar';
    const fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.className = 'oaao-template-import-btn oaao-template-import-btn--ghost';
    fixBtn.textContent = 'Fix layout';
    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'oaao-template-import-btn oaao-template-import-btn--ghost';
    lockBtn.textContent = 'Lock layout';
    slideBar.append(fixBtn, lockBtn);

    const footer = document.createElement('div');
    footer.className = 'oaao-tpl-preview-modal__footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'oaao-template-import-btn oaao-template-import-btn--ghost';
    cancelBtn.textContent = 'Cancel';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'oaao-template-import-btn oaao-template-import-btn--ghost oaao-template-import-btn--danger';
    deleteBtn.textContent = 'Delete';
    const unpublishBtn = document.createElement('button');
    unpublishBtn.type = 'button';
    unpublishBtn.className = 'oaao-template-import-btn oaao-template-import-btn--ghost';
    unpublishBtn.textContent = 'Unpublish';
    const publishBtn = document.createElement('button');
    publishBtn.type = 'button';
    publishBtn.className = 'oaao-template-import-btn oaao-template-import-btn--primary';
    publishBtn.textContent = 'Publish';
    const useChatBtn = document.createElement('button');
    useChatBtn.type = 'button';
    useChatBtn.className = 'oaao-template-import-btn oaao-template-import-btn--primary';
    useChatBtn.textContent = 'Use in chat';
    footer.append(cancelBtn, deleteBtn, unpublishBtn, publishBtn, useChatBtn);
    deleteBtn.hidden = !isCustomTemplateRow(row);

    let rowStatus = String(row.status ?? 'draft');
    let label = String(row.label ?? templateId);
    const pptxRenderDeck = isPptxRenderTemplateRow(row);
    /** @type {Record<string, unknown>[]} */
    let pages = pagesFromPayload(row, null);
    const hasMasterPages = pages.some((p) => isPptxMasterPreviewPage(p));

    if (pptxRenderDeck || pages.some((p) => pageFidelityRenderUrl(p))) {
        statusEl.hidden = false;
        statusEl.textContent =
            'Slide preview uses LibreOffice PNGs (fonts and images from your PPTX). Slot layout editing uses master HTML when PNGs are unavailable.';
    } else if (hasMasterPages) {
        statusEl.hidden = false;
        statusEl.textContent =
            'Master HTML shows positioned text slots only — not full PPTX design. Re-import with orchestrator LibreOffice for PNG previews.';
    } else if (!pptxRenderDeck && pages.length > 0) {
        statusEl.hidden = false;
        statusEl.textContent =
            'Previews are approximated layout placeholders, not your PPTX design. Rebuild the orchestrator with LibreOffice and re-import for true slide images.';
    } else if (!pptxRenderDeck && !pages.length) {
        statusEl.hidden = false;
        statusEl.textContent =
            'No slide previews yet. Rebuild the orchestrator image (LibreOffice + poppler) and re-import this template.';
    }

    if (pptxRenderDeck || !pages.length) {
        fixBtn.hidden = true;
        lockBtn.hidden = true;
    }

    const issuesPanel = document.createElement('div');
    issuesPanel.className = 'oaao-tpl-preview-modal__issues';
    issuesPanel.hidden = true;

    const scroll = document.createElement('div');
    scroll.className = 'oaao-tpl-preview-modal__scroll';
    scroll.append(stage, strip, slideBar);
    body.append(statusEl, issuesPanel, scroll);
    let activeIndex = pages.length ? Number(pages[0].index) || 1 : 1;
    /** @type {Set<number>} */
    const lockedSlides = new Set(
        pages.filter((p) => p.verified === true).map((p) => Number(p.index) || 0),
    );

    const setBusy = (msg, busy = false) => {
        statusEl.hidden = !msg;
        statusEl.textContent = msg;
        fixBtn.disabled = busy;
        lockBtn.disabled = busy;
        deleteBtn.disabled = busy;
        unpublishBtn.disabled = busy;
        publishBtn.disabled = busy;
        useChatBtn.disabled = busy;
    };

    const isSlideLocked = (idx) => lockedSlides.has(idx) || pages.find((p) => Number(p.index) === idx)?.verified === true;

    const syncLockBtn = () => {
        const locked = isSlideLocked(activeIndex);
        lockBtn.textContent = locked ? 'Unlock layout' : 'Lock layout';
        lockBtn.classList.toggle('oaao-tpl-preview-modal__lock--on', locked);
        fixBtn.disabled = locked;
    };

    const hidePublishIssues = () => {
        issuesPanel.hidden = true;
        issuesPanel.replaceChildren();
    };

    /**
     * @param {unknown} rawIssues
     */
    const showPublishIssues = (rawIssues) => {
        const items = normalizeTemplatePublishIssues(rawIssues);
        issuesPanel.replaceChildren();
        if (!items.length) {
            issuesPanel.hidden = true;
            return;
        }
        issuesPanel.hidden = false;
        const head = document.createElement('p');
        head.className = 'oaao-tpl-preview-modal__issues-head';
        head.textContent = `${items.length} slide(s) need layout fix before publish:`;
        const list = document.createElement('ul');
        list.className = 'oaao-tpl-preview-modal__issues-list';
        for (const item of items) {
            const li = document.createElement('li');
            li.className = 'oaao-tpl-preview-modal__issues-item';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'oaao-tpl-preview-modal__issue-link';
            btn.textContent = item.label;
            btn.addEventListener('click', () => {
                selectSlide(item.index);
                if (!fixBtn.hidden) {
                    fixBtn.focus();
                }
            });
            li.append(btn);
            if (item.errorsSummary) {
                const hint = document.createElement('span');
                hint.className = 'oaao-tpl-preview-modal__issue-hint';
                hint.textContent = item.errorsSummary;
                li.append(hint);
            }
            list.append(li);
        }
        issuesPanel.append(head, list);
        selectSlide(items[0].index);
    };

    const selectSlide = (idx) => {
        activeIndex = idx;
        const page = pages.find((p) => Number(p.index) === idx);
        const previewUrl = pageStagePreviewUrl(page);
        const title = String(page?.title ?? `Slide ${idx}`);
        mountStagePreview(stage, previewUrl, title, page);
        strip.querySelectorAll('.oaao-tpl-preview-modal__thumb').forEach((el) => {
            el.classList.toggle('oaao-tpl-preview-modal__thumb--active', Number(el.getAttribute('data-slide-index')) === idx);
        });
        syncLockBtn();
    };

    const renderStrip = () => {
        strip.replaceChildren();
        for (const p of pages) {
            if (!p || typeof p !== 'object') continue;
            const idx = Number(p.index) || 1;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'oaao-tpl-preview-modal__thumb';
            btn.dataset.slideIndex = String(idx);
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', idx === activeIndex ? 'true' : 'false');

            const frame = document.createElement('div');
            frame.className = 'oaao-tpl-preview-modal__thumb-frame';
            const miniUrl = pageThumbPreviewUrl(p);
            if (miniUrl) {
                if (pageFidelityRenderUrl(p)) {
                    const img = document.createElement('img');
                    img.className = 'oaao-tpl-preview-modal__thumb-img';
                    img.alt = String(p.title ?? `Slide ${idx}`);
                    img.loading = 'lazy';
                    img.src = bustPreviewSrc(miniUrl);
                    frame.append(img);
                } else {
                    const iframe = document.createElement('iframe');
                    iframe.className = 'oaao-tpl-preview-modal__thumb-iframe';
                    iframe.loading = 'lazy';
                    iframe.setAttribute('sandbox', SLIDE_PREVIEW_IFRAME_SANDBOX);
                    iframe.tabIndex = -1;
                    iframe.src = bustPreviewSrc(miniUrl);
                    mountSlideThumb(frame, iframe);
                }
            }

            if (isSlideLocked(idx)) {
                const lockIcon = document.createElement('span');
                lockIcon.className = 'oaao-tpl-preview-modal__thumb-lock';
                lockIcon.title = 'Locked';
                lockIcon.innerHTML = '<i class="ri-lock-fill" aria-hidden="true"></i>';
                frame.append(lockIcon);
            } else if (p.verified !== true) {
                const warn = document.createElement('span');
                warn.className = 'oaao-tpl-preview-modal__thumb-warn';
                warn.title = 'Needs review';
                warn.textContent = '!';
                frame.append(warn);
            }

            btn.append(frame);
            btn.addEventListener('click', () => selectSlide(idx));
            if (idx === activeIndex) {
                btn.classList.add('oaao-tpl-preview-modal__thumb--active');
            }
            strip.append(btn);
        }
    };

    const reload = async () => {
        const found = await fetchTemplateRow(templateId);
        if (!found) return;
        rowStatus = String(found.status ?? rowStatus);
        label = String(found.label ?? label);
        pages = pagesFromPayload(found, null);
        for (const p of pages) {
            const idx = Number(p.index) || 0;
            if (p.verified === true) lockedSlides.add(idx);
        }
        if (!pages.some((p) => Number(p.index) === activeIndex)) {
            activeIndex = pages.length ? Number(pages[0].index) || 1 : 1;
        }
        renderStrip();
        selectSlide(activeIndex);
    };

    renderStrip();
    selectSlide(activeIndex);

    fixBtn.addEventListener('click', async () => {
        if (isSlideLocked(activeIndex)) return;
        setBusy('Fixing layout with LLM…', true);
        const { res, data } = await fixTemplateSlide(templateId, activeIndex);
        setBusy('', false);
        const payload = data?.data && typeof data.data === 'object' ? data.data : data;
        const ok = payload?.verified === true || payload?.ok === true || data.success === true;
        if (!res.ok || !ok) {
            toast(data.message || 'Fix failed');
            return;
        }
        toast('Layout updated');
        lockedSlides.add(activeIndex);
        await reload();
        hidePublishIssues();
        if (typeof onChange === 'function') onChange();
    });

    lockBtn.addEventListener('click', () => {
        if (lockedSlides.has(activeIndex)) {
            lockedSlides.delete(activeIndex);
        } else {
            lockedSlides.add(activeIndex);
        }
        renderStrip();
        syncLockBtn();
    });

    const syncFooter = () => {
        const pub = rowStatus === 'published';
        unpublishBtn.hidden = !pub;
        publishBtn.hidden = pub;
        useChatBtn.hidden = !pub;
        dialogCtrl?.getControl?.()?.setTitle?.(buildTemplatePreviewDialogTitle(label, rowStatus));
    };

    /** @type {{ close?: () => void } | null} */
    let dialogCtrl = null;

    cancelBtn.addEventListener('click', () => dialogCtrl?.close?.());

    deleteBtn.addEventListener('click', async () => {
        const name = label || templateId;
        if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) {
            return;
        }
        setBusy('Deleting…', true);
        const { res, data } = await deleteTemplate(templateId);
        setBusy('', false);
        if (!res.ok || data.success === false) {
            toast(data.message || 'Delete failed');
            return;
        }
        toast('Template deleted');
        dialogCtrl?.close?.();
        if (typeof onChange === 'function') onChange();
    });

    unpublishBtn.addEventListener('click', async () => {
        setBusy('Unpublishing…', true);
        const { res, data } = await unpublishTemplate(templateId);
        setBusy('', false);
        if (!res.ok || data.success === false) {
            toast(data.message || 'Unpublish failed');
            return;
        }
        rowStatus = 'preview';
        syncFooter();
        toast('Template unpublished');
        await reload();
        if (typeof onChange === 'function') onChange();
    });

    publishBtn.addEventListener('click', async () => {
        setBusy('Publishing…', true);
        const { res, data } = await publishTemplate(templateId, true);
        setBusy('', false);
        if (!res.ok || data.success === false) {
            const items = normalizeTemplatePublishIssues(data.issues);
            if (items.length > 0) {
                showPublishIssues(data.issues);
                toast(`${items.length} slide(s) need layout fix — open the list above`);
            } else {
                hidePublishIssues();
                toast(data.message || 'Publish failed');
            }
            return;
        }
        hidePublishIssues();
        rowStatus = 'published';
        syncFooter();
        toast('Template published');
        await reload();
        if (typeof onChange === 'function') onChange();
    });

    useChatBtn.addEventListener('click', () => {
        applyTemplateForChat({ ...row, template_id: templateId, label, status: rowStatus });
        dialogCtrl?.close?.();
    });

    dialogCtrl = new Dialog({
        title: buildTemplatePreviewDialogTitle(label, rowStatus),
        content: body,
        size: 'lg',
        closable: true,
        buttons: [],
    });
    const dialogFooter = dialogCtrl.getControl().footer;
    if (dialogFooter) {
        dialogFooter.replaceChildren();
        dialogFooter.append(footer);
    }
    syncFooter();
}

/** @deprecated Use {@link openSlideTemplatePreviewModal} */
export const openSlideTemplateEditorDialog = openSlideTemplatePreviewModal;
