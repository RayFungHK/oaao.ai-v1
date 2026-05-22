/**
 * Slide preview strip — pipeline block {@code slide_preview_strip} (SD-2).
 * Completed decks render as a single Manus-style hero block (editor opens on click — TBD).
 *
 * @module slide-preview-strip
 */

/** @typedef {{ conversationId?: number, messageId?: number }} SlidePreviewRenderContext */

import { wrapFadeTitleEl } from './slide-template-api.js';

const SLIDE_PREVIEW_NATIVE_W = 1280;
const SLIDE_PREVIEW_NATIVE_H = 720;
const CSS_REV = '20260523-slide-deck-hero-block';

let cssLoaded = false;

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

/**
 * @param {number} n
 */
function formatBytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 1) return '';
    if (v < 1024) return `${Math.round(v)} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(2)} KB`;
    return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * @param {HTMLElement} frame
 * @param {HTMLIFrameElement} iframe
 */
function mountSlidePreviewCardThumb(frame, iframe) {
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
    } else {
        window.addEventListener('resize', apply, { passive: true });
    }
}

function ensureSlidePreviewCss() {
    if (cssLoaded) return;
    cssLoaded = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = prefixed(
        `/webassets/slide-designer/default/css/oaao-slide-preview.css?v=${encodeURIComponent(CSS_REV)}`,
    );
    document.head.append(link);
}

/**
 * @param {string} kind
 */
function buildPreviewCanvas(kind) {
    const canvas = document.createElement('div');
    if (kind === 'platform_layers') {
        canvas.className = 'oaao-slide-preview-card__canvas oaao-slide-preview-card__canvas--light';
        const h = document.createElement('h4');
        h.textContent = 'OAAO 的定位很明確';
        const p = document.createElement('p');
        p.textContent = '不只是聊天工具，而是企業工作系統。';
        const grid = document.createElement('div');
        grid.className = 'oaao-slide-preview-card__layers';
        for (const label of ['對話層', '知識層', '工作層']) {
            const cell = document.createElement('div');
            cell.className = 'oaao-slide-preview-card__layer';
            cell.textContent = label;
            grid.append(cell);
        }
        canvas.append(h, p, grid);

        return canvas;
    }

    canvas.className = 'oaao-slide-preview-card__canvas oaao-slide-preview-card__canvas--dark';
    const h = document.createElement('h4');
    h.textContent = 'Executive Problem Frame';
    const p = document.createElement('p');
    p.textContent = '管理層關心的不是功能列表，而是可信度與可治理性。';
    const ul = document.createElement('ul');
    for (const line of ['答案是否可信？', '能否被管理？', '能否被稽核？']) {
        const li = document.createElement('li');
        li.textContent = line;
        ul.append(li);
    }
    canvas.append(h, p, ul);

    return canvas;
}

/**
 * @param {Record<string, unknown>[]} slides
 */
function pickHeroSlide(slides) {
    const sorted = [...slides].sort(
        (a, b) => (Number(a.index) || 0) - (Number(b.index) || 0),
    );
    const withUrl = sorted.find((s) => String(s.preview_url ?? '').trim());
    return withUrl || sorted[0] || null;
}

/**
 * @param {SlidePreviewRenderContext & { projectId?: string, deckTitle?: string, slides?: Record<string, unknown>[] }} detail
 */
export function openSlideDeckEditor(detail) {
    document.dispatchEvent(
        new CustomEvent('oaao-open-slide-deck', {
            detail,
            bubbles: true,
        }),
    );
}

/**
 * @param {string} projectId
 * @param {string} filename
 * @param {number} [conversationId]
 */
function deckDownloadUrl(projectId, filename, conversationId) {
    const qs = new URLSearchParams({
        project_id: projectId,
        file: filename,
    });
    if (conversationId && conversationId > 0) {
        qs.set('conversation_id', String(conversationId));
    }
    return prefixed(`/slide-designer/api/download?${qs.toString()}`);
}

/**
 * @param {Record<string, unknown>} slide
 * @param {SlidePreviewRenderContext} ctx
 */
function renderHeroPreviewBody(slide, ctx) {
    const title = String(slide.title ?? 'Slide');
    const kind = String(slide.preview_kind ?? 'executive_problem');
    const previewUrl = typeof slide.preview_url === 'string' ? slide.preview_url.trim() : '';

    if (previewUrl) {
        let src = previewUrl;
        if (!src.includes('conversation_id=') && ctx.conversationId) {
            const sep = src.includes('?') ? '&' : '?';
            src = `${src}${sep}conversation_id=${encodeURIComponent(String(ctx.conversationId))}`;
        }
        const frameWrap = document.createElement('div');
        frameWrap.className = 'oaao-slide-deck-block__frame';
        const iframe = document.createElement('iframe');
        iframe.className = 'oaao-slide-deck-block__iframe';
        iframe.title = title;
        iframe.loading = 'lazy';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.tabIndex = -1;
        iframe.src = prefixed(src.startsWith('/') ? src : `/${src}`);
        mountSlidePreviewCardThumb(frameWrap, iframe);
        return frameWrap;
    }

    const canvas = buildPreviewCanvas(kind);
    canvas.classList.add('oaao-slide-deck-block__canvas-fallback');
    return canvas;
}

/**
 * @param {Record<string, unknown>} props
 * @param {SlidePreviewRenderContext} ctx
 */
function renderSlideDeckHeroBlock(props, ctx) {
    const slidesRaw = props.slides;
    /** @type {Record<string, unknown>[]} */
    const slides = Array.isArray(slidesRaw)
        ? slidesRaw.filter((s) => s && typeof s === 'object').map((s) => /** @type {Record<string, unknown>} */ (s))
        : [];

    const projectId = String(props.project_id ?? '').trim();
    const deckTitle = String(props.project_title ?? 'Slide deck').trim() || 'Slide deck';
    const slideCount = Math.max(
        Number(props.slide_count) || 0,
        slides.length ? Math.max(...slides.map((s) => Number(s.total) || Number(s.index) || 0)) : 0,
    );
    const hero = pickHeroSlide(slides);

    const block = document.createElement('div');
    block.className = 'oaao-slide-deck-block';
    block.dataset.oaaoPipelineBlock = 'slide_preview_strip';

    const heroBtn = document.createElement('button');
    heroBtn.type = 'button';
    heroBtn.className = 'oaao-slide-deck-block__hero';
    heroBtn.setAttribute('aria-label', `Open slide editor: ${deckTitle}`);

    const head = document.createElement('header');
    head.className = 'oaao-slide-deck-block__head';

    const icon = document.createElement('span');
    icon.className = 'oaao-slide-deck-block__head-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<i class="ri-slideshow-3-fill"></i>';

    const titleWrap = wrapFadeTitleEl(deckTitle, 'oaao-slide-deck-block__head-title');
    titleWrap.classList.add('oaao-slide-deck-block__head-title-wrap');

    const meta = document.createElement('span');
    meta.className = 'oaao-slide-deck-block__head-meta';
    if (slideCount > 0) {
        meta.textContent = slideCount === 1 ? '1 slide' : `${slideCount} slides`;
    } else if (hero) {
        const idx = Number(hero.index) || 1;
        const total = Number(hero.total) || idx;
        meta.textContent = `${idx} / ${total}`;
    }

    head.append(icon, titleWrap, meta);

    if (hero) {
        heroBtn.append(head, renderHeroPreviewBody(hero, ctx));
    } else {
        const empty = document.createElement('p');
        empty.className = 'oaao-slide-deck-block__empty';
        empty.textContent = 'Slide previews will appear when generation completes.';
        heroBtn.append(head, empty);
    }

    heroBtn.addEventListener('click', () => {
        openSlideDeckEditor({
            projectId,
            conversationId: ctx.conversationId,
            messageId: ctx.messageId,
            slideIndex: hero ? Number(hero.index) || 1 : 1,
            deckTitle,
            slides,
        });
    });

    block.append(heroBtn);

    const footer = document.createElement('div');
    footer.className = 'oaao-slide-deck-block__footer';

    const deckArtifact =
        props.deck_artifact && typeof props.deck_artifact === 'object'
            ? /** @type {Record<string, unknown>} */ (props.deck_artifact)
            : null;
    const pptxName = deckArtifact ? String(deckArtifact.filename ?? '').trim() : '';
    if (pptxName && projectId) {
        const pill = document.createElement('a');
        pill.className = 'oaao-slide-deck-block__file-pill';
        pill.href = deckDownloadUrl(projectId, pptxName, ctx.conversationId);
        pill.download = pptxName;
        pill.setAttribute('aria-label', `Download ${pptxName}`);
        pill.addEventListener('click', (ev) => ev.stopPropagation());

        const pptxIcon = document.createElement('span');
        pptxIcon.className = 'oaao-slide-deck-block__file-pill-icon';
        pptxIcon.setAttribute('aria-hidden', 'true');
        pptxIcon.innerHTML = '<i class="ri-file-ppt-2-line"></i>';

        const pillBody = document.createElement('span');
        pillBody.className = 'oaao-slide-deck-block__file-pill-body';
        const pillTitle = document.createElement('span');
        pillTitle.className = 'oaao-slide-deck-block__file-pill-name';
        pillTitle.textContent = pptxName;
        const pillSize = document.createElement('span');
        pillSize.className = 'oaao-slide-deck-block__file-pill-size';
        const sz = formatBytes(deckArtifact.size_bytes);
        pillSize.textContent = sz;
        pillBody.append(pillTitle, pillSize);
        pill.append(pptxIcon, pillBody);
        footer.append(pill);
    }

    const thumbRaw = props.material_thumb;
    if (thumbRaw && typeof thumbRaw === 'object' && ctx.messageId && ctx.conversationId) {
        const filesBtn = document.createElement('button');
        filesBtn.type = 'button';
        filesBtn.className = 'oaao-slide-deck-block__files-cta';
        filesBtn.textContent = 'View all files in this task';
        filesBtn.setAttribute('aria-label', 'View all files in this task');
        filesBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void openMaterialsFromThumb(ctx);
        });
        footer.append(filesBtn);
    }

    if (footer.childElementCount > 0) {
        block.append(footer);
    }

    return block;
}

/**
 * @param {SlidePreviewRenderContext} ctx
 */
async function openMaterialsFromThumb(ctx) {
    if (!ctx.conversationId || !ctx.messageId) return;
    const url = prefixed('/webassets/chat/default/js/task-materials-dialog.js');
    const mod = await import(/* webpackIgnore: true */ url).catch(() => null);
    if (!mod || typeof mod.openTaskMaterialsDialog !== 'function') return;

    const g = globalThis;
    const fetchJson =
        typeof g.chatFetchJson === 'function'
            ? g.chatFetchJson
            : async (u) => {
                  const res = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } });
                  const text = await res.text();
                  let data = {};
                  try {
                      data = text ? JSON.parse(text) : {};
                  } catch {
                      data = {};
                  }
                  return { res, data };
              };
    const apiUrl =
        typeof g.chatApiUrl === 'function'
            ? g.chatApiUrl
            : (action, query = {}) => {
                  const qs = new URLSearchParams(query).toString();
                  const base = typeof g.chatApiBase === 'function' ? g.chatApiBase() : '/chat/api/';
                  return `${base}${action.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
              };

    await mod.openTaskMaterialsDialog({
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        fetchJson,
        apiUrl,
    });
}

/**
 * @param {HTMLElement} wrap
 * @param {Record<string, unknown>} block
 * @param {SlidePreviewRenderContext} [ctx]
 */
export function renderSlidePreviewStripBlock(wrap, block, ctx = {}) {
    ensureSlidePreviewCss();

    const props = block.props && typeof block.props === 'object' ? /** @type {Record<string, unknown>} */ (block.props) : {};

    wrap.append(renderSlideDeckHeroBlock(props, ctx));
}
