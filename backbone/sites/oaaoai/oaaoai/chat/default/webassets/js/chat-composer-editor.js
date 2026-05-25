/**
 * Chat composer — contentEditable body with inline template slug nodes (Lexical-style decorators).
 *
 * @module chat-composer-editor
 */

import { mountRuiIcon, OAAO_RUI_ICON_TEMPLATE } from './oaao-rui-icons.js';

const TEMPLATE_SLUG_SELECTOR = '[data-oaao-chat-template-slug]';
const COMPOSER_ZWSP = '\u200B';
const COMPOSER_MAX_LEN = 32000;

/** Lovart-style inline template pill (contenteditable decorator). */
const TEMPLATE_SLUG_PILL_CLASS =
    'oaao-chat-template-slug-pill my-[1px] inline-flex h-6 max-h-6 flex-nowrap select-none items-center align-middle gap-[3px] break-words rounded-lg border-[0.5px] border-black/15 px-[3.5px] fg-[var(--grid-ink)] box-border leading-none cursor-pointer transition-opacity duration-200 ease-in-out hover:bg-[rgba(12,12,13,0.04)]';
const TEMPLATE_SLUG_THUMB_CLASS =
    'oaao-chat-template-slug-thumb block h-[11px] w-[11px] shrink-0 rounded-[2px] object-cover bg-[var(--grid-line)]/30';

/**
 * @param {unknown} el
 * @returns {el is HTMLElement}
 */
export function isChatComposerEditorEl(el) {
    return (
        el instanceof HTMLElement &&
        el.getAttribute('data-oaao-chat') === 'input' &&
        el.isContentEditable
    );
}

/**
 * @param {HTMLElement} editorEl
 */
export function focusChatComposerEditor(editorEl) {
    editorEl.focus();
}

/**
 * @param {HTMLElement} editorEl
 */
export function clearChatComposerEditor(editorEl) {
    editorEl.replaceChildren();
}

/**
 * @param {number} [sizePx]
 */
function createComposerCloseIconSvg(sizePx = 12) {
    const size = String(sizePx);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('class', `rz-icon block shrink-0 w-[${size}px] h-[${size}px] pointer-events-none`);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M18 6 6 18M6 6l12 12');
    svg.append(path);
    return svg;
}

/**
 * @param {{ template_id: string, label: string, thumb_url?: string }} template
 * @param {(() => void) | null} [onRemove]
 * @param {{ readOnly?: boolean }} [opts]
 */
export function createTemplateSlugNode(template, onRemove, opts = {}) {
    const readOnly = opts.readOnly === true;
    const tid = String(template.template_id ?? '').trim();
    const label = String(template.label ?? tid).trim() || tid;
    const thumbUrl = String(template.thumb_url ?? '').trim();

    const wrap = document.createElement('span');
    wrap.setAttribute('data-oaao-chat-template-slug', '1');
    wrap.contentEditable = 'false';
    wrap.className =
        'oaao-chat-template-slug inline-block align-middle max-w-[min(100%,14rem)] shrink-0 select-none mx-[2px] [vertical-align:-2px]';
    wrap.dataset.templateId = tid;
    wrap.dataset.templateLabel = label;
    if (thumbUrl) wrap.dataset.templateThumb = thumbUrl;
    wrap.title = label;
    wrap.setAttribute('role', 'group');

    const pill = document.createElement('span');
    pill.className = TEMPLATE_SLUG_PILL_CLASS;

    if (thumbUrl) {
        const thumb = document.createElement('img');
        thumb.className = TEMPLATE_SLUG_THUMB_CLASS;
        thumb.src = thumbUrl;
        thumb.alt = '';
        thumb.setAttribute('aria-hidden', 'true');
        thumb.loading = 'lazy';
        thumb.decoding = 'async';
        pill.append(thumb);
    } else {
        const icon = document.createElement('span');
        icon.className = `${TEMPLATE_SLUG_THUMB_CLASS} inline-flex items-center justify-center fg-[var(--grid-ink-muted)] bg-[var(--grid-line)]/25`;
        icon.setAttribute('aria-hidden', 'true');
        void mountRuiIcon(icon, OAAO_RUI_ICON_TEMPLATE, { size: 12 });
        pill.append(icon);
    }

    const labelEl = document.createElement('span');
    labelEl.className = 'truncate text-[12px] leading-none min-w-0 max-w-[8rem]';
    labelEl.textContent = label.length > 14 ? `${label.slice(0, 13)}…` : label;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className =
        'inline-flex items-center justify-center w-4 h-4 p-0 border-0 rounded-full bg-transparent cursor-pointer fg-[var(--grid-ink-muted)] hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink)] font-inherit shrink-0';
    dismiss.setAttribute('aria-label', 'Clear slide template');
    dismiss.append(createComposerCloseIconSvg(11));
    if (!readOnly) {
        dismiss.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            wrap.remove();
            onRemove?.();
        });
        pill.append(labelEl, dismiss);
    } else {
        pill.append(labelEl);
    }
    wrap.append(pill);
    return wrap;
}

/**
 * @param {HTMLElement} editorEl
 */
export function removeTemplateSlugsFromEditor(editorEl) {
    for (const node of editorEl.querySelectorAll(TEMPLATE_SLUG_SELECTOR)) {
        node.remove();
    }
}

/**
 * @param {HTMLElement} editorEl
 * @param {Node} node
 */
function insertNodeAtCaret(editorEl, node) {
    editorEl.focus();
    const sel = window.getSelection();
    /** @type {Range} */
    let range;
    if (sel && sel.rangeCount > 0 && editorEl.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
        range.deleteContents();
    } else {
        range = document.createRange();
        range.selectNodeContents(editorEl);
        range.collapse(false);
    }
    range.insertNode(node);
    const tail = document.createTextNode(` ${COMPOSER_ZWSP}`);
    range.setStartAfter(node);
    range.collapse(true);
    range.insertNode(tail);
    range.setStartAfter(tail);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
}

/**
 * @param {{ template_id: string, label: string, thumb_url?: string }} template
 * @param {HTMLElement} editorEl
 * @param {() => void} [onRemove]
 */
export function insertTemplateSlugInEditor(editorEl, template, onRemove) {
    removeTemplateSlugsFromEditor(editorEl);
    const node = createTemplateSlugNode(template, onRemove);
    insertNodeAtCaret(editorEl, node);
}

/**
 * @param {HTMLElement} editorEl
 * @param {string} [thumbUrl]
 */
export function updateTemplateSlugThumbInEditor(editorEl, thumbUrl) {
    const url = String(thumbUrl ?? '').trim();
    if (!url) return;
    const wrap = editorEl.querySelector(TEMPLATE_SLUG_SELECTOR);
    if (!(wrap instanceof HTMLElement)) return;
    wrap.dataset.templateThumb = url;
    const pill = wrap.querySelector('.oaao-chat-template-slug-pill');
    if (!(pill instanceof HTMLElement)) return;
    const oldThumb = pill.querySelector('img');
    if (oldThumb instanceof HTMLImageElement) {
        oldThumb.src = url;
        return;
    }
    const icon = pill.querySelector('span');
    icon?.remove();
    const thumb = document.createElement('img');
    thumb.className = TEMPLATE_SLUG_THUMB_CLASS;
    thumb.src = url;
    thumb.alt = '';
    thumb.setAttribute('aria-hidden', 'true');
    thumb.loading = 'lazy';
    pill.prepend(thumb);
}

/**
 * @param {HTMLElement} editorEl
 * @returns {{ text: string, template_id: string, label: string, thumb_url: string }}
 */
export function getChatComposerEditorPayload(editorEl) {
    let text = '';
    let template_id = '';
    let label = '';
    let thumb_url = '';

    /**
     * @param {Node} node
     */
    const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += String(node.textContent ?? '').replace(/\u200B/g, '');
            return;
        }
        if (!(node instanceof HTMLElement)) return;
        if (node.matches(TEMPLATE_SLUG_SELECTOR)) {
            template_id = String(node.dataset.templateId ?? '').trim();
            label = String(node.dataset.templateLabel ?? '').trim();
            thumb_url = String(node.dataset.templateThumb ?? '').trim();
            return;
        }
        if (node.tagName === 'BR') {
            text += '\n';
            return;
        }
        for (const child of node.childNodes) {
            walk(child);
        }
    };

    for (const child of editorEl.childNodes) {
        walk(child);
    }

    return {
        text: text.replace(/\s+/g, ' ').trim(),
        template_id,
        label,
        thumb_url,
    };
}

/**
 * @param {HTMLElement} editorEl
 * @param {string} text
 * @param {{ keepTemplate?: boolean }} [opts]
 */
export function setChatComposerEditorPlainText(editorEl, text, opts = {}) {
    const keepTemplate = opts.keepTemplate === true;
    const slug = keepTemplate ? editorEl.querySelector(TEMPLATE_SLUG_SELECTOR) : null;
    editorEl.replaceChildren();
    const trimmed = String(text ?? '');
    if (trimmed) {
        editorEl.append(document.createTextNode(trimmed));
    }
    if (slug) {
        if (trimmed) {
            editorEl.append(document.createTextNode(' '));
        }
        editorEl.append(slug);
    }
}

/**
 * @param {HTMLElement} editorEl
 * @param {string} text
 */
export function appendChatComposerEditorText(editorEl, text) {
    const add = String(text ?? '').trim();
    if (!add) return;
    const payload = getChatComposerEditorPayload(editorEl);
    const merged = payload.text ? `${payload.text} ${add}` : add;
    setChatComposerEditorPlainText(editorEl, merged, { keepTemplate: Boolean(payload.template_id) });
    focusChatComposerEditor(editorEl);
}

/**
 * @param {string} value
 * @returns {{ body: string, slug: string }}
 */
export function extractInlineTemplateSlugDirective(value) {
    const raw = String(value ?? '');
    const lead = raw.match(/^\/template\s+(\S+)(?:\s+)?/i);
    if (lead) {
        return { body: raw.slice(lead[0].length).trim(), slug: String(lead[1] ?? '').trim() };
    }
    const trail = raw.match(/(?:^|\s)\/template\s+(\S+)\s*$/i);
    if (trail) {
        const slug = String(trail[1] ?? '').trim();
        const body = raw.slice(0, trail.index).trim();
        return { body, slug };
    }
    return { body: raw.trim(), slug: '' };
}

/**
 * @param {HTMLElement} editorEl
 * @param {(slug: string) => Promise<{ template_id: string, label: string, thumb_url?: string } | null>} resolveSlug
 * @param {(template: { template_id: string, label: string, thumb_url?: string }) => void} onResolved
 * @param {() => void} [onRemoved]
 */
export async function tryConvertTemplateDirectiveInEditor(editorEl, resolveSlug, onResolved, onRemoved) {
    const payload = getChatComposerEditorPayload(editorEl);
    const { body, slug } = extractInlineTemplateSlugDirective(payload.text);
    if (!slug || payload.template_id) return;
    const hit = await resolveSlug(slug);
    if (!hit) return;
    setChatComposerEditorPlainText(editorEl, body, { keepTemplate: false });
    onResolved(hit);
}

/**
 * @param {HTMLElement} editorEl
 * @param {AbortSignal} signal
 * @param {{
 *   onTemplateRemoved: () => void,
 *   onTemplateInserted: (t: { template_id: string, label: string, thumb_url?: string }) => void,
 *   resolveTemplateSlug: (slug: string) => Promise<{ template_id: string, label: string, thumb_url?: string } | null>,
 * }} hooks
 */
export function mountChatComposerEditor(editorEl, signal, hooks) {
    editorEl.addEventListener(
        '        keydown',
        (ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                const form = editorEl.closest('form');
                const card = editorEl.closest('[data-oaao-chat="composer-card-wrap"]');
                if (card instanceof HTMLElement && card.dataset.oaaoComposerBusy) return;
                if (form instanceof HTMLFormElement) {
                    form.requestSubmit();
                }
            }
        },
        { signal },
    );

    editorEl.addEventListener(
        'paste',
        (ev) => {
            ev.preventDefault();
            const text = ev.clipboardData?.getData('text/plain') ?? '';
            if (text) {
                document.execCommand('insertText', false, text);
            }
        },
        { signal },
    );

    editorEl.addEventListener(
        'input',
        () => {
            const payload = getChatComposerEditorPayload(editorEl);
            if (payload.text.length > COMPOSER_MAX_LEN) {
                setChatComposerEditorPlainText(editorEl, payload.text.slice(0, COMPOSER_MAX_LEN), {
                    keepTemplate: Boolean(payload.template_id),
                });
            }
            void tryConvertTemplateDirectiveInEditor(
                editorEl,
                hooks.resolveTemplateSlug,
                (hit) => {
                    hooks.onTemplateInserted(hit);
                },
                hooks.onTemplateRemoved,
            );
        },
        { signal },
    );
}
