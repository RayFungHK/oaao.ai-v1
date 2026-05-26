/**
 * Inline RAG / attachment citation pills in assistant markdown.
 *
 * @module oaaoai/rag/inline-citations
 */

/** @typedef {{ cite_index?: number, cite_key?: string, vault_id?: number, document_id?: number, file_name?: string, vault_name?: string, path?: string, segment_types?: string[], begin_ms?: number, excerpt?: string, mime_type?: string, attachment_id?: number }} CitationRef */

/**
 * @param {unknown} pipeline
 * @returns {{ vault: Map<number, CitationRef>, attachment: Map<string, CitationRef> }}
 */
export function citationMapsFromPipeline(pipeline) {
    /** @type {Map<number, CitationRef>} */
    const vault = new Map();
    /** @type {Map<string, CitationRef>} */
    const attachment = new Map();
    if (!pipeline || typeof pipeline !== 'object') {
        return { vault, attachment };
    }
    const blocks = /** @type {Record<string, unknown>} */ (pipeline).blocks;
    if (!Array.isArray(blocks)) {
        return { vault, attachment };
    }
    for (const raw of blocks) {
        if (!raw || typeof raw !== 'object') continue;
        const block = /** @type {Record<string, unknown>} */ (raw);
        const type = String(block.type ?? '').trim();
        const props =
            block.props && typeof block.props === 'object'
                ? /** @type {Record<string, unknown>} */ (block.props)
                : {};
        const refs = Array.isArray(props.references) ? props.references : [];
        if (type === 'rag_citations') {
            for (const row of refs) {
                if (!row || typeof row !== 'object') continue;
                const o = /** @type {CitationRef} */ (row);
                const idx = Number(o.cite_index ?? 0);
                if (Number.isFinite(idx) && idx > 0) vault.set(Math.floor(idx), o);
            }
        } else if (type === 'attachment_citations') {
            for (const row of refs) {
                if (!row || typeof row !== 'object') continue;
                const o = /** @type {CitationRef} */ (row);
                const key = String(o.cite_key ?? '').trim().toUpperCase();
                if (/^A\d+$/.test(key)) attachment.set(key, o);
            }
        }
    }
    return { vault, attachment };
}

/**
 * Never inject pills inside fenced code — would break JSON / `[n]` literals.
 *
 * @param {Node | null | undefined} node
 */
function isCitationInjectionExempt(node) {
    if (!(node instanceof Node)) return true;
    const el = node instanceof Element ? node : node.parentElement;
    if (!(el instanceof Element)) return false;
    return Boolean(el.closest('pre, code, script, style, .oaao-inline-cite, .oaao-inline-cite-popover'));
}

/** @type {HTMLElement | null} */
let citePopoverEl = null;
/** @type {HTMLElement | null} */
let citePopoverAnchor = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let citePopoverHideTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let citePopoverHideAnimTimer = null;
/** @type {boolean} */
let citePopoverScrollBound = false;
/** @type {WeakSet<HTMLElement>} */
const citePopoverBound = new WeakSet();

const CITE_POP_TRANSITION_MS = 160;

function clearCitePopoverHideTimer() {
    if (citePopoverHideTimer) {
        clearTimeout(citePopoverHideTimer);
        citePopoverHideTimer = null;
    }
}

function finishHideCitePopoverEl(el) {
    if (citePopoverHideAnimTimer) {
        clearTimeout(citePopoverHideAnimTimer);
        citePopoverHideAnimTimer = null;
    }
    const z = globalThis.razyui?.zIndex;
    if (z && typeof z.release === 'function') {
        try {
            z.release(el);
        } catch {
            /* noop */
        }
    }
    el.remove();
    if (citePopoverEl === el) {
        citePopoverEl = null;
        citePopoverAnchor = null;
    }
}

function hideCitePopover(immediate = false) {
    clearCitePopoverHideTimer();
    const el = citePopoverEl;
    if (!el) {
        citePopoverAnchor = null;
        return;
    }
    if (immediate) {
        finishHideCitePopoverEl(el);
        return;
    }
    if (el.dataset.oaaoHiding === '1') return;
    el.dataset.oaaoHiding = '1';
    el.classList.remove('oaao-inline-cite-popover--visible');
    el.style.pointerEvents = 'none';
    citePopoverEl = null;
    citePopoverAnchor = null;
    citePopoverHideAnimTimer = setTimeout(() => {
        citePopoverHideAnimTimer = null;
        finishHideCitePopoverEl(el);
    }, CITE_POP_TRANSITION_MS);
}

function scheduleHideCitePopover(delayMs = 120) {
    clearCitePopoverHideTimer();
    citePopoverHideTimer = setTimeout(() => {
        citePopoverHideTimer = null;
        hideCitePopover(false);
    }, delayMs);
}

/**
 * @param {HTMLElement} anchor
 */
function positionCitePopover(anchor) {
    if (!(citePopoverEl instanceof HTMLElement)) return;
    const rect = anchor.getBoundingClientRect();
    const fr = citePopoverEl.getBoundingClientRect();
    const margin = 10;
    let top = rect.top - fr.height - 10;
    let left = rect.left + rect.width / 2 - fr.width / 2;
    const maxLeft = window.innerWidth - fr.width - margin;
    left = Math.max(margin, Math.min(left, maxLeft));
    if (top < margin) {
        top = rect.bottom + 10;
    }
    citePopoverEl.style.top = `${top}px`;
    citePopoverEl.style.left = `${left}px`;
}

/**
 * @param {CitationRef} row
 * @param {'vault' | 'attachment'} kind
 * @returns {{ title: string, subtitle: string, body: string }}
 */
function citePopoverContent(row, kind) {
    const fn = String(row.file_name ?? '').trim() || (kind === 'vault' ? `Document #${row.document_id ?? ''}` : 'Attachment');
    const mime = String(row.mime_type ?? '').trim();
    const excerpt = String(row.excerpt ?? '').trim();
    if (kind === 'vault') {
        const vn = String(row.vault_name ?? '').trim();
        const path = String(row.path ?? '').trim();
        const subtitle = vn && path ? `${vn} › ${path}` : vn || path || 'Knowledge base';
        return { title: fn, subtitle, body: excerpt };
    }
    const subtitle = mime || 'Uploaded file';
    return { title: fn, subtitle, body: excerpt };
}

/**
 * @param {HTMLElement} card
 */
function ensureCitePopoverCardEvents(card) {
    if (!(card instanceof HTMLElement) || card.dataset.oaaoCitePopEvents === '1') return;
    card.dataset.oaaoCitePopEvents = '1';
    card.addEventListener('mouseenter', clearCitePopoverHideTimer);
    card.addEventListener('mouseleave', () => scheduleHideCitePopover(80));
}

/**
 * @param {HTMLElement} card
 * @param {CitationRef} row
 * @param {'vault' | 'attachment'} kind
 * @param {{ title: string, subtitle: string, body: string }} content
 */
function populateCitePopoverCard(card, row, kind, content) {
    const { title, subtitle, body } = content;
    card.replaceChildren();
    card.classList.add('oaao-inline-cite-popover');
    card.setAttribute('role', 'tooltip');

    const head = document.createElement('div');
    head.className = 'oaao-inline-cite-popover__header';

    const icon = document.createElement('span');
    icon.className = 'oaao-inline-cite-popover__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = kind === 'vault' ? 'KB' : 'A';

    const headText = document.createElement('div');
    headText.className = 'oaao-inline-cite-popover__headtext';

    const titleEl = document.createElement('div');
    titleEl.className = 'oaao-inline-cite-popover__title';
    titleEl.textContent = title;

    const subEl = document.createElement('div');
    subEl.className = 'oaao-inline-cite-popover__subtitle';
    subEl.textContent = subtitle;

    headText.append(titleEl, subEl);
    head.append(icon, headText);
    card.append(head);

    if (body) {
        const excerptEl = document.createElement('div');
        excerptEl.className = 'oaao-inline-cite-popover__body';
        excerptEl.textContent = body;
        card.append(excerptEl);
    }
}

/**
 * Gemini-style source preview card (portal to body — escapes overflow-hidden thread).
 *
 * @param {HTMLElement} anchor
 * @param {CitationRef} row
 * @param {'vault' | 'attachment'} kind
 */
function showCitePopover(anchor, row, kind) {
    const content = citePopoverContent(row, kind);
    if (!content.title && !content.body) return;

    clearCitePopoverHideTimer();

    if (
        citePopoverEl?.isConnected &&
        citePopoverAnchor === anchor &&
        citePopoverEl.dataset.oaaoHiding !== '1'
    ) {
        return;
    }

    if (citePopoverEl?.isConnected && citePopoverEl.dataset.oaaoHiding !== '1') {
        populateCitePopoverCard(citePopoverEl, row, kind, content);
        citePopoverEl.dataset.oaaoHiding = '';
        citePopoverEl.style.pointerEvents = '';
        citePopoverEl.classList.add('oaao-inline-cite-popover--visible');
        citePopoverAnchor = anchor;
        positionCitePopover(anchor);
        requestAnimationFrame(() => positionCitePopover(anchor));
        return;
    }

    if (citePopoverEl) {
        hideCitePopover(true);
    }

    const card = document.createElement('div');
    populateCitePopoverCard(card, row, kind, content);
    ensureCitePopoverCardEvents(card);

    document.body.appendChild(card);
    citePopoverEl = card;
    citePopoverAnchor = anchor;
    card.style.position = 'fixed';
    card.style.zIndex = '9200';
    positionCitePopover(anchor);
    requestAnimationFrame(() => {
        card.classList.add('oaao-inline-cite-popover--visible');
        positionCitePopover(anchor);
    });

    const z = globalThis.razyui?.zIndex;
    if (z && typeof z.acquire === 'function') {
        z.acquire(card);
    }
}

function bindCitePopoverDismissOnScroll() {
    if (citePopoverScrollBound) return;
    citePopoverScrollBound = true;
    document.addEventListener(
        'scroll',
        (ev) => {
            if (!citePopoverEl) return;
            const t = ev.target;
            if (t instanceof Node) {
                if (citePopoverEl.contains(t)) return;
                if (citePopoverAnchor instanceof Node && citePopoverAnchor.contains(t)) return;
            }
            hideCitePopover();
        },
        true,
    );
}

/**
 * @param {HTMLElement} pill
 * @param {CitationRef} row
 * @param {'vault' | 'attachment'} kind
 */
function bindCitePopover(pill, row, kind, markerLabel = '') {
    if (!(pill instanceof HTMLElement) || citePopoverBound.has(pill)) return;
    citePopoverBound.add(pill);

    const citeLabel = String(markerLabel || pill.textContent || '').trim() || (kind === 'vault' ? 'citation' : 'attachment');
    pill.setAttribute('aria-label', kind === 'vault' ? `Source ${citeLabel}` : `Attachment ${citeLabel}`);
    bindCitePopoverDismissOnScroll();
}

/**
 * @param {CitationRef} row
 */
function dispatchOpenVaultTranscript(row) {
    const documentId = Math.floor(Number(row.document_id ?? 0));
    if (!Number.isFinite(documentId) || documentId < 1) return;
    document.dispatchEvent(
        new CustomEvent('oaao:open-vault-transcript', {
            bubbles: true,
            detail: {
                vault_id: Math.floor(Number(row.vault_id ?? 0)) || undefined,
                document_id: documentId,
                file_name: String(row.file_name ?? '').trim(),
                begin_ms: Math.max(0, Math.floor(Number(row.begin_ms ?? 0))),
            },
        }),
    );
}

/**
 * Parse [1] / [A1] into bracket parts for styled pills.
 *
 * @param {string} label
 * @returns {{ prefix: string, num: string } | null}
 */
function parseCitationPillLabel(label) {
    const m = /^\[(A?)(\d+)\]$/.exec(String(label ?? '').trim());
    if (!m) return null;
    return { prefix: m[1] || '', num: m[2] };
}

/**
 * @param {string} label
 * @param {CitationRef} row
 * @param {'vault' | 'attachment'} kind
 */
function createCitationPill(label, row, kind) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
        kind === 'attachment'
            ? 'oaao-inline-cite oaao-inline-cite--attachment'
            : 'oaao-inline-cite oaao-inline-cite--vault';

    const parts = parseCitationPillLabel(label);
    if (parts) {
        const inner = document.createElement('span');
        inner.className = 'oaao-inline-cite__inner';
        inner.setAttribute('aria-hidden', 'true');

        const open = document.createElement('span');
        open.textContent = '[';

        if (parts.prefix) {
            const prefix = document.createElement('span');
            prefix.className = 'oaao-inline-cite__prefix';
            prefix.textContent = parts.prefix;
            inner.append(open, prefix);
        } else {
            inner.append(open);
        }

        const num = document.createElement('span');
        num.className = 'oaao-inline-cite__num';
        num.textContent = parts.num;

        const close = document.createElement('span');
        close.textContent = ']';

        inner.append(num, close);
        btn.append(inner);
        btn.setAttribute('aria-label', label);
    } else {
        btn.textContent = label;
    }

    bindCitePopover(btn, row, kind, label);

    btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (kind === 'vault') {
            dispatchOpenVaultTranscript(row);
        }
    });

    return btn;
}

/**
 * Replace [1] / [A1] markers in HTML string with interactive pills.
 *
 * @param {string} html
 * @param {Map<number, CitationRef>} vaultCites
 * @param {Map<string, CitationRef>} attachmentCites
 */
export function injectInlineCitationPillsIntoHtml(html, vaultCites, attachmentCites) {
    if (!html || (!vaultCites.size && !attachmentCites.size)) return html;

    const wrap = document.createElement('div');
    wrap.innerHTML = html;

    const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
    /** @type {Text[]} */
    const textNodes = [];
    let n = walker.nextNode();
    while (n) {
        if (n instanceof Text && !isCitationInjectionExempt(n) && /\[A?\d+\]/.test(n.data)) {
            textNodes.push(n);
        }
        n = walker.nextNode();
    }

    const markerRe = /\[A(\d+)\]|\[(\d+)\]/gi;

    for (const textNode of textNodes) {
        const raw = textNode.data;
        if (!markerRe.test(raw)) continue;
        markerRe.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        let m = markerRe.exec(raw);
        while (m) {
            const start = m.index;
            if (start > last) frag.append(raw.slice(last, start));
            const full = m[0];
            if (m[1]) {
                const key = `A${m[1]}`;
                const row = attachmentCites.get(key);
                if (row) {
                    frag.append(createCitationPill(full, row, 'attachment'));
                } else {
                    frag.append(full);
                }
            } else if (m[2]) {
                const idx = Number(m[2]);
                const row = vaultCites.get(idx);
                if (row) {
                    frag.append(createCitationPill(full, row, 'vault'));
                } else {
                    frag.append(full);
                }
            } else {
                frag.append(full);
            }
            last = start + full.length;
            m = markerRe.exec(raw);
        }
        if (last < raw.length) frag.append(raw.slice(last));
        textNode.replaceWith(frag);
    }

    return wrap.innerHTML;
}

/**
 * @param {HTMLElement} bubble
 * @param {{ vault: Map<number, CitationRef>, attachment: Map<string, CitationRef> }} maps
 */
export function hydrateInlineCitationPills(bubble, maps) {
    if (!(bubble instanceof HTMLElement)) return;
    if (!maps.vault.size && !maps.attachment.size) return;
    const outer = bubble.closest('.oaao-chat-assistant-row');
    const hadInlineMarkers = /\[(?:A?\d+)\]/.test(bubble.textContent ?? '');
    bubble.innerHTML = injectInlineCitationPillsIntoHtml(bubble.innerHTML, maps.vault, maps.attachment);
    if (outer instanceof HTMLElement) {
        outer.querySelector('[data-oaao-inline-cite-fallback]')?.remove();
    }
    if (hadInlineMarkers) {
        return;
    }
}

/**
 * When the model omits [1]/[A1] markers, show a compact source row under the reply.
 *
 * @param {HTMLElement} bubble
 * @param {{ vault: Map<number, CitationRef>, attachment: Map<string, CitationRef> }} maps
 */
export function renderInlineCitationFallbackRow(bubble, maps) {
    if (!(bubble instanceof HTMLElement)) return;
    const outer = bubble.closest('.oaao-chat-assistant-row');
    if (!(outer instanceof HTMLElement)) return;

    /** @type {Array<{ label: string, row: CitationRef, kind: 'vault' | 'attachment' }>} */
    const items = [];
    for (const [idx, row] of [...maps.vault.entries()].sort((a, b) => a[0] - b[0])) {
        items.push({ label: `[${idx}]`, row, kind: 'vault' });
    }
    for (const [key, row] of [...maps.attachment.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        items.push({ label: `[${key}]`, row, kind: 'attachment' });
    }
    if (!items.length) return;

    let host = outer.querySelector('[data-oaao-inline-cite-fallback]');
    if (!(host instanceof HTMLElement)) {
        host = document.createElement('div');
        host.dataset.oaaoInlineCiteFallback = '1';
        host.className = 'oaao-inline-cite-fallback';
        const label = document.createElement('span');
        label.className = 'oaao-inline-cite-fallback__label';
        label.textContent = 'Sources';
        host.append(label);
        bubble.insertAdjacentElement('afterend', host);
    } else {
        host.replaceChildren();
        const label = document.createElement('span');
        label.className = 'oaao-inline-cite-fallback__label';
        label.textContent = 'Sources';
        host.append(label);
    }

    for (const item of items) {
        host.append(createCitationPill(item.label, item.row, item.kind));
    }
}

/**
 * @param {HTMLElement} pill
 * @param {{ vault: Map<number, CitationRef>, attachment: Map<string, CitationRef> }} maps
 * @returns {{ ref: CitationRef, kind: 'vault' | 'attachment' } | null}
 */
export function lookupCitationForPill(pill, maps) {
    if (!(pill instanceof HTMLElement) || !maps) return null;
    const label = String(pill.textContent ?? '').trim();
    const attach = label.match(/^\[A(\d+)\]$/i);
    if (attach) {
        const key = `A${attach[1]}`;
        const ref = maps.attachment.get(key);
        if (ref) return { ref, kind: 'attachment' };
    }
    const vault = label.match(/^\[(\d+)\]$/);
    if (vault) {
        const ref = maps.vault.get(Number(vault[1]));
        if (ref) return { ref, kind: 'vault' };
    }
    return null;
}

/**
 * Event delegation — survives markdown re-hydrate; hover + click toggle card.
 *
 * @param {HTMLElement} root
 * @param {(outer: HTMLElement) => { vault: Map<number, CitationRef>, attachment: Map<string, CitationRef> } | null | undefined} resolveMaps
 */
export function bindInlineCitationHoverRoot(root, resolveMaps) {
    if (!(root instanceof HTMLElement) || root.dataset.oaaoCiteHoverRoot === '1') return;
    root.dataset.oaaoCiteHoverRoot = '1';

    root.addEventListener('pointerover', (ev) => {
        const pill = ev.target instanceof Element ? ev.target.closest('.oaao-inline-cite') : null;
        if (!(pill instanceof HTMLElement)) return;
        const outer = pill.closest('.oaao-chat-assistant-row');
        if (!(outer instanceof HTMLElement)) return;
        const maps = resolveMaps(outer);
        if (!maps) return;
        const hit = lookupCitationForPill(pill, maps);
        if (hit) showCitePopover(pill, hit.ref, hit.kind);
    });

    root.addEventListener('focusin', (ev) => {
        const pill = ev.target instanceof Element ? ev.target.closest('.oaao-inline-cite') : null;
        if (!(pill instanceof HTMLElement)) return;
        const outer = pill.closest('.oaao-chat-assistant-row');
        if (!(outer instanceof HTMLElement)) return;
        const maps = resolveMaps(outer);
        if (!maps) return;
        const hit = lookupCitationForPill(pill, maps);
        if (hit) showCitePopover(pill, hit.ref, hit.kind);
    });

    root.addEventListener('pointerout', (ev) => {
        const pill = ev.target instanceof Element ? ev.target.closest('.oaao-inline-cite') : null;
        if (!(pill instanceof HTMLElement) || citePopoverAnchor !== pill) return;
        const related = ev.relatedTarget;
        if (related instanceof Node) {
            if (citePopoverEl?.contains(related)) return;
            if (pill.contains(related)) return;
        }
        scheduleHideCitePopover(140);
    });

    root.addEventListener('focusout', (ev) => {
        const pill = ev.target instanceof Element ? ev.target.closest('.oaao-inline-cite') : null;
        if (!(pill instanceof HTMLElement) || citePopoverAnchor !== pill) return;
        const related = ev.relatedTarget;
        if (related instanceof Node) {
            if (citePopoverEl?.contains(related)) return;
            if (pill.contains(related)) return;
        }
        scheduleHideCitePopover(140);
    });

    root.addEventListener(
        'click',
        (ev) => {
            const pill = ev.target instanceof Element ? ev.target.closest('.oaao-inline-cite') : null;
            if (!(pill instanceof HTMLElement)) return;
            const outer = pill.closest('.oaao-chat-assistant-row');
            if (!(outer instanceof HTMLElement)) return;
            const maps = resolveMaps(outer);
            if (!maps) return;
            const hit = lookupCitationForPill(pill, maps);
            if (!hit) return;
            ev.preventDefault();
            ev.stopPropagation();
            if (citePopoverAnchor === pill && citePopoverEl) {
                hideCitePopover(true);
                return;
            }
            showCitePopover(pill, hit.ref, hit.kind);
        },
        true,
    );
}
