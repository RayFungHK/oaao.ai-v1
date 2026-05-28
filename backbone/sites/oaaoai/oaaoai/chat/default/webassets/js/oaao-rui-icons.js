/**
 * Lazy RazyUI Icons — Lucide SVG with LineIcons font fallback.
 *
 * OAAO-critical glyphs ({@code package}, {@code square-dashed-kanban}, {@code gallery-thumbnails}, {@code book-marked})
 * are embedded here because bundled {@code razyui-icons.css} may lag the font file; {@code Icons.js}
 * dynamic import can also fail on subdirectory mounts.
 *
 * @module oaao-rui-icons
 */

/** Toolbar / list default for task materials. */
export const OAAO_RUI_ICON_MATERIALS = 'package';

/** Slide template chip, user-message refs, composer template slug. */
export const OAAO_RUI_ICON_TEMPLATE = 'square-dashed-kanban';

/** Desk / slide-deck gallery mode badge and desk-mode conversation rows. */
export const OAAO_RUI_ICON_GALLERY_MODE = 'gallery-thumbnails';

/** Default chat thread in the conversation sidebar. */
export const OAAO_RUI_ICON_CONVERSATION = 'message-square';

/** Material row download action. */
export const OAAO_RUI_ICON_DOWNLOAD = 'download';

/** Muted stroke for toolbar / list action icons. */
export const OAAO_RUI_ICON_SOFT_CLASS = 'fg-[var(--grid-caption)] opacity-80';

/** Slide-deck material rows and active-deck chip. */
export const OAAO_RUI_ICON_SLIDE = 'layout';

/** Conversation row overflow menu (sidebar). */
export const OAAO_RUI_ICON_MORE = 'ellipsis';

/** Expand / collapse chevron (thread health, dropups). */
export const OAAO_RUI_ICON_CHEVRON_DOWN = 'chevron-down';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Embedded Lucide paths — always render without {@code Icons.js}. */
const OAAO_SVG_ICONS = {
    'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />',
    'square-dashed-kanban':
        '<path d="M8 7v7" /><path d="M12 7v4" /><path d="M16 7v9" /><path d="M5 3a2 2 0 0 0-2 2" /><path d="M9 3h1" /><path d="M14 3h1" /><path d="M19 3a2 2 0 0 1 2 2" /><path d="M21 9v1" /><path d="M21 14v1" /><path d="M21 19a2 2 0 0 1-2 2" /><path d="M14 21h1" /><path d="M9 21h1" /><path d="M5 21a2 2 0 0 1-2-2" /><path d="M3 14v1" /><path d="M3 9v1" />',
    'gallery-thumbnails':
        '<rect width="18" height="14" x="3" y="3" rx="2" /><path d="M4 21h1" /><path d="M9 21h1" /><path d="M14 21h1" /><path d="M19 21h1" />',
    /** Corpus Studio rail + SPA nav ({@see workspace.tpl}, {@see corpus.php}). */
    'book-marked':
        '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" /><path d="M10 2v10l3-3 3 3V2" />',
    package:
        '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12" /><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7" /><path d="m7.5 4.27 9 5.15" />',
    download:
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />',
    ellipsis: '<circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />',
    'chevron-down': '<path d="m6 9 6 6 6-6" />',
    /** Lucide {@code group} — workspace / team rows ({@see workspace.js}). */
    group:
        '<path d="M3 7V5c0-1.1.9-2 2-2h2" /><path d="M17 3h2c1.1 0 2 .9 2 2v2" /><path d="M21 17v2c0 1.1-.9 2-2 2h-2" /><path d="M7 21H5c-1.1 0-2-.9-2-2v-2" /><rect width="7" height="5" x="7" y="7" rx="1" /><rect width="7" height="5" x="10" y="12" rx="1" />',
};

/** @type {Promise<{ el?: (name: string, opts?: object) => Element | null, registerAll?: (icons: Record<string, string>) => void }> | null} */
let iconsModulePromise = null;

let oaaoExtraIconsRegistered = false;

/**
 * @param {number | string | undefined} strokeWidth
 */
function resolveStrokeWidth(strokeWidth) {
    if (strokeWidth == null) return 2;
    if (typeof strokeWidth === 'string') {
        const map = { regular: 1, medium: 1.5, bold: 2 };
        return map[strokeWidth] ?? 2;
    }

    return strokeWidth;
}

/**
 * @param {string} name
 * @param {{ size?: number, strokeWidth?: number | string, class?: string }} [opts]
 * @returns {HTMLElement | null}
 */
function createEmbeddedSvgIcon(name, opts = {}) {
    const inner = OAAO_SVG_ICONS[name];
    if (!inner) return null;

    const size = opts.size ?? 18;
    const sw = resolveStrokeWidth(opts.strokeWidth);
    const extra = opts.class ? ` ${opts.class}` : '';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(sw));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', `rz-icon rz-icon-${name} block shrink-0 pointer-events-none${extra}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = inner;

    return svg;
}

/**
 * @param {{ registerAll?: (icons: Record<string, string>) => void }} Icons
 */
function ensureOaaoExtraLucideIcons(Icons) {
    if (oaaoExtraIconsRegistered || typeof Icons.registerAll !== 'function') return;
    Icons.registerAll(OAAO_SVG_ICONS);
    oaaoExtraIconsRegistered = true;
}

/**
 * @param {string} path
 */
function prefixed(path) {
    const g = globalThis;
    if (typeof g.oaaoPrefixedSitePath === 'function') {
        return g.oaaoPrefixedSitePath(path.startsWith('/') ? path : `/${path}`);
    }

    return path.startsWith('/') ? path : `/${path}`;
}

export function loadRazyIcons() {
    if (!iconsModulePromise) {
        const url = prefixed('/webassets/core/default/razyui/component/Icons.js');
        iconsModulePromise = import(/* webpackIgnore: true */ url)
            .then((m) => {
                const Icons = m.default ?? m;
                ensureOaaoExtraLucideIcons(Icons);
                return Icons;
            })
            .catch(() => null);
    }

    return iconsModulePromise;
}

/**
 * @param {string} name
 * @param {{ size?: number, strokeWidth?: number | string, class?: string }} [opts]
 * @returns {Promise<HTMLElement | null>}
 */
export async function createRuiIconEl(name, opts = {}) {
    const embedded = createEmbeddedSvgIcon(name, opts);
    if (embedded) return embedded;

    const Icons = await loadRazyIcons();
    if (!Icons?.el) return null;

    const size = opts.size ?? 18;
    const extra = opts.class ? String(opts.class) : '';
    const el = Icons.el(name, {
        size,
        strokeWidth: opts.strokeWidth ?? 2,
        class: ['block', 'shrink-0', 'pointer-events-none', extra].filter(Boolean).join(' ').trim(),
    });

    return el instanceof HTMLElement ? el : null;
}

/**
 * @param {HTMLElement} host
 * @param {string} name
 * @param {{ size?: number, strokeWidth?: number | string, class?: string }} [opts]
 * @returns {Promise<HTMLElement | null>}
 */
export async function mountRuiIcon(host, name, opts = {}) {
    const el = await createRuiIconEl(name, opts);
    if (el) {
        host.replaceChildren(el);
    }

    return el;
}

/**
 * Mount embedded SVG immediately; fall back to async {@link mountRuiIcon} for other names.
 *
 * @param {HTMLElement} host
 * @param {string} name
 * @param {{ size?: number, strokeWidth?: number | string, class?: string }} [opts]
 * @returns {HTMLElement | null}
 */
export function mountRuiIconSync(host, name, opts = {}) {
    const el = createEmbeddedSvgIcon(name, opts);
    if (el) {
        host.replaceChildren(el);
        return el;
    }

    void mountRuiIcon(host, name, opts);
    return null;
}

/**
 * Material list row icon by category.
 *
 * @param {string} category
 */
export function materialIconName(category) {
    const c = String(category ?? '').toLowerCase();
    if (c === 'image') return 'image';
    if (c === 'code') return 'code';
    if (c === 'link') return 'link';
    if (c === 'slide') return OAAO_RUI_ICON_SLIDE;

    return OAAO_RUI_ICON_MATERIALS;
}

/**
 * Hydrate {@code data-oaao-rui-icon} placeholders (e.g. desk mode badge in tpl).
 *
 * @param {ParentNode} [root]
 */
export function hydrateRuiIconSlots(root = document) {
    const nodes = root.querySelectorAll('[data-oaao-rui-icon]:not([data-oaao-rui-icon-done])');
    for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const name = String(node.dataset.oaaoRuiIcon ?? '').trim();
        if (!name) continue;
        node.dataset.oaaoRuiIconDone = '1';
        const size = Number(node.dataset.oaaoRuiIconSize) || 14;
        const extraClass = String(node.dataset.oaaoRuiIconClass ?? '').trim();
        void mountRuiIcon(node, name, { size, class: extraClass });
    }
}
