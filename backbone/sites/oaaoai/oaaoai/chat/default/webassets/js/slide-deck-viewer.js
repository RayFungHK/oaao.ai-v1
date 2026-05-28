/**
 * Full-screen slide deck preview — prev/next navigation (Dialog + iframe).
 *
 * @module slide-deck-viewer
 */

import { oaaoLoadingLogoElement } from '@oaao/core-js/oaao-loading-logo.js';

/** @typedef {{ index: number, title?: string, preview_url?: string, total?: number }} SlidePreviewRow */

/** @typedef {{ deckTitle?: string, slides: SlidePreviewRow[], conversationId?: number, projectId?: string, startIndex?: number }} SlideDeckViewerOpts */

let dialogCtorPromise = null;
let cssLoaded = false;

const NATIVE_W = 1280;
const NATIVE_H = 720;

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

function ensureViewerCss() {
    if (cssLoaded) return;
    cssLoaded = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = prefixed('/webassets/slide-designer/default/css/oaao-slide-preview.css?v=20260519-deck-viewer-height');
    document.head.append(link);
}

/**
 * @param {HTMLElement} frame
 * @param {HTMLIFrameElement} iframe
 * @returns {{ apply: () => void, scheduleRelayout: () => void }}
 */
function mountScaledIframe(frame, iframe) {
    iframe.setAttribute('width', String(NATIVE_W));
    iframe.setAttribute('height', String(NATIVE_H));
    const scale = document.createElement('div');
    scale.className = 'oaao-slide-deck-viewer__scale';
    scale.append(iframe);
    frame.append(scale);

    const apply = () => {
        const w = frame.clientWidth;
        const h = frame.clientHeight;
        if (w < 1 || h < 1) return;
        const s = Math.min(w / NATIVE_W, h / NATIVE_H);
        const dx = (w - NATIVE_W * s) / 2;
        const dy = (h - NATIVE_H * s) / 2;
        scale.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    };

    const scheduleRelayout = () => {
        requestAnimationFrame(() => {
            requestAnimationFrame(apply);
        });
    };

    apply();
    scheduleRelayout();
    iframe.addEventListener('load', () => {
        apply();
        scheduleRelayout();
    });
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
            apply();
        }).observe(frame);
    } else {
        window.addEventListener('resize', apply, { passive: true });
    }

    if (typeof IntersectionObserver !== 'undefined') {
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    apply();
                    scheduleRelayout();
                }
            },
            { threshold: 0.01 },
        );
        io.observe(frame);
    }

    return { apply, scheduleRelayout };
}

/**
 * @param {string} previewUrl
 * @param {number} [conversationId]
 */
function resolvePreviewSrc(previewUrl, conversationId) {
    let src = String(previewUrl ?? '').trim();
    if (!src) return '';
    if (!src.startsWith('/')) src = `/${src}`;
    src = prefixed(src);
    if (conversationId && conversationId > 0 && !src.includes('conversation_id=')) {
        src += `${src.includes('?') ? '&' : '?'}conversation_id=${encodeURIComponent(String(conversationId))}`;
    }
    const u = new URL(src, window.location.href);
    u.searchParams.set('_t', String(Date.now()));
    return u.href;
}

/**
 * @param {string} projectId
 * @param {number} page
 * @param {number} conversationId
 */
export function slideHtmlPreviewPath(projectId, page, conversationId) {
    const qs = new URLSearchParams({
        project_id: projectId,
        page: String(Math.max(1, page)),
    });
    if (conversationId > 0) {
        qs.set('conversation_id', String(conversationId));
    }
    return prefixed(`/slide-designer/api/slide_html?${qs.toString()}`);
}

/**
 * @param {string} projectId
 * @param {number} conversationId
 * @returns {Promise<{ deckTitle: string, slides: SlidePreviewRow[] } | null>}
 */
export async function fetchSlideDeckFromProject(projectId, conversationId) {
    const pid = String(projectId ?? '').trim();
    const cid = Number(conversationId) || 0;
    if (!pid || cid < 1) return null;

    const qs = new URLSearchParams({
        project_id: pid,
        conversation_id: String(cid),
    });
    const url = prefixed(`/slide-designer/api/project_resume?${qs.toString()}`);

    try {
        const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        const manifest = data?.data?.manifest;
        if (!manifest || typeof manifest !== 'object') return null;

        const projectIdFromManifest = String(manifest.project_id ?? pid).trim();
        const cidFromManifest = Number(manifest.conversation_id) || cid;
        const totalCount = Number(manifest.slide_count) || 0;

        /** @type {Map<number, Record<string, unknown>>} */
        const pageByIndex = new Map();
        const pagesRaw = manifest.pages;
        if (Array.isArray(pagesRaw)) {
            for (const raw of pagesRaw) {
                if (!raw || typeof raw !== 'object') continue;
                const row = /** @type {Record<string, unknown>} */ (raw);
                const idx = Number(row.index) || 0;
                if (idx > 0) pageByIndex.set(idx, row);
            }
        }

        /** @type {Map<number, Record<string, unknown>>} */
        const specByIndex = new Map();
        const specsRaw = manifest.slides_spec;
        if (Array.isArray(specsRaw)) {
            for (const raw of specsRaw) {
                if (!raw || typeof raw !== 'object') continue;
                const row = /** @type {Record<string, unknown>} */ (raw);
                const idx = Number(row.index) || 0;
                if (idx > 0) specByIndex.set(idx, row);
            }
        }

        /** @type {Set<number>} */
        const indices = new Set([...pageByIndex.keys(), ...specByIndex.keys()]);
        if (!indices.size && totalCount > 0) {
            for (let i = 1; i <= totalCount; i += 1) indices.add(i);
        }
        if (!indices.size) return null;

        const deckTotal =
            totalCount > 0 ? totalCount : Math.max(...indices, 0);

        /** @type {SlidePreviewRow[]} */
        const slides = [];
        for (const idx of [...indices].sort((a, b) => a - b)) {
            if (deckTotal > 0 && idx > deckTotal) continue;
            const page = pageByIndex.get(idx) ?? {};
            const spec = specByIndex.get(idx) ?? {};
            let preview = String(page.preview_url ?? '').trim();
            if (!preview && projectIdFromManifest) {
                preview = slideHtmlPreviewPath(projectIdFromManifest, idx, cidFromManifest);
            }
            slides.push({
                index: idx,
                title: String(page.title ?? spec.title ?? `Slide ${idx}`),
                preview_url: preview,
            });
        }
        slides.sort((a, b) => a.index - b.index);
        const deckTitle = String(manifest.title ?? 'Slide deck').trim() || 'Slide deck';
        const total = slides.length;
        for (const s of slides) {
            s.total = total;
        }
        return { deckTitle, slides };
    } catch {
        return null;
    }
}

/**
 * @param {SlideDeckViewerOpts} opts
 */
export async function openSlideDeckViewer(opts) {
    const Dialog = await loadDialogCtor();
    if (typeof Dialog !== 'function') return;

    ensureViewerCss();

    const slides = [...(opts.slides || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
    if (!slides.length) return;

    const deckTitle = String(opts.deckTitle ?? 'Slide deck').trim() || 'Slide deck';
    const conversationId = Number(opts.conversationId) || 0;
    let cursor = Math.max(0, slides.findIndex((s) => s.index === (opts.startIndex || 1)));
    if (cursor < 0) cursor = 0;

    const shell = document.createElement('div');
    shell.className = 'oaao-slide-deck-viewer';

    const top = document.createElement('div');
    top.className = 'oaao-slide-deck-viewer__top';
    const titleEl = document.createElement('div');
    titleEl.className = 'oaao-slide-deck-viewer__title';
    titleEl.textContent = deckTitle;
    const counter = document.createElement('div');
    counter.className = 'oaao-slide-deck-viewer__counter';
    top.append(titleEl, counter);

    const stage = document.createElement('div');
    stage.className = 'oaao-slide-deck-viewer__stage';
    const frame = document.createElement('div');
    frame.className = 'oaao-slide-deck-viewer__frame';
    const iframe = document.createElement('iframe');
    iframe.className = 'oaao-slide-deck-viewer__iframe';
    iframe.title = 'Slide preview';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    const layout = mountScaledIframe(frame, iframe);
    stage.append(frame);

    const loading = oaaoLoadingLogoElement({ block: false, label: 'Loading preview…' });
    loading.className = 'oaao-slide-deck-viewer__loading oaao-loading-logo';
    frame.append(loading);

    const setLoading = (busy) => {
        frame.classList.toggle('oaao-slide-deck-viewer__frame--loading', busy);
        loading.hidden = !busy;
    };
    iframe.addEventListener(
        'load',
        () => {
            setLoading(false);
            layout.scheduleRelayout();
        },
        { once: false },
    );

    const nav = document.createElement('div');
    nav.className = 'oaao-slide-deck-viewer__nav';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'oaao-slide-deck-viewer__nav-btn';
    prevBtn.textContent = '← Previous';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'oaao-slide-deck-viewer__nav-btn';
    nextBtn.textContent = 'Next →';
    nav.append(prevBtn, nextBtn);

    shell.append(top, stage, nav);

    const paint = () => {
        const slide = slides[cursor];
        const idx = Number(slide?.index) || cursor + 1;
        const total = Number(slide?.total) || slides.length;
        const label = String(slide?.title ?? `Slide ${idx}`).trim();
        counter.textContent = `Slide ${idx} / ${total} — ${label}`;
        titleEl.textContent = deckTitle;
        const src = resolvePreviewSrc(String(slide?.preview_url ?? ''), conversationId);
        if (src) {
            setLoading(true);
            iframe.src = src;
        } else {
            setLoading(false);
            iframe.removeAttribute('src');
        }
        layout.scheduleRelayout();
        prevBtn.disabled = cursor <= 0;
        nextBtn.disabled = cursor >= slides.length - 1;
    };

    prevBtn.addEventListener('click', () => {
        if (cursor > 0) {
            cursor -= 1;
            paint();
        }
    });
    nextBtn.addEventListener('click', () => {
        if (cursor < slides.length - 1) {
            cursor += 1;
            paint();
        }
    });

    const dialog = new Dialog({
        title: 'Slide preview',
        content: shell,
        size: 'lg',
        closable: true,
        buttons: [{ text: 'Close', color: 'accent', role: 'cancel' }],
    });

    const onKey = (ev) => {
        if (ev.key === 'ArrowLeft' && cursor > 0) {
            cursor -= 1;
            paint();
        } else if (ev.key === 'ArrowRight' && cursor < slides.length - 1) {
            cursor += 1;
            paint();
        }
    };
    document.addEventListener('keydown', onKey);
    const origClose = dialog.close?.bind(dialog);
    if (typeof origClose === 'function') {
        dialog.close = (...args) => {
            document.removeEventListener('keydown', onKey);
            return origClose(...args);
        };
    }

    paint();
    layout.scheduleRelayout();
    window.setTimeout(() => layout.scheduleRelayout(), 80);
    window.setTimeout(() => layout.scheduleRelayout(), 280);
    window.setTimeout(() => layout.scheduleRelayout(), 720);
}

/**
 * @param {Record<string, unknown>} detail
 */
export async function openSlideDeckViewerFromEvent(detail) {
    if (!detail || typeof detail !== 'object') return;

    const conversationId = Number(detail.conversationId) || 0;
    const projectId = String(detail.projectId ?? '').trim();
    const startIndex = Number(detail.slideIndex) || 1;
    let deckTitle = String(detail.deckTitle ?? '').trim();
    /** @type {SlidePreviewRow[]} */
    let slides = Array.isArray(detail.slides)
        ? detail.slides.filter((s) => s && typeof s === 'object').map((s) => /** @type {SlidePreviewRow} */ (s))
        : [];

    if (!slides.length && projectId && conversationId > 0) {
        const fetched = await fetchSlideDeckFromProject(projectId, conversationId);
        if (fetched) {
            slides = fetched.slides;
            if (!deckTitle) deckTitle = fetched.deckTitle;
        }
    }

    if (!slides.length) return;

    await openSlideDeckViewer({
        deckTitle: deckTitle || 'Slide deck',
        slides,
        conversationId,
        projectId,
        startIndex,
    });
}
