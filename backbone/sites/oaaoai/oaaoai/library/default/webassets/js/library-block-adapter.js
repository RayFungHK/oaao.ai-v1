/**
 * CS-2-S4 — Map library revision blocks ↔ RazyUI BlockEditor block model.
 *
 * Library contract: snake_case types ({@code bullet_list}, top-level {@code level} on headings).
 * RazyUI: kebab-case ({@code bulleted-list}, {@code meta.level} on headings).
 * Native {@code table} block (RazyUI extension) ↔ {@code table} + {@code meta.rows}.
 * Extended Notion-like types (todo, quote, callout, …) round-trip via {@code meta.ruType}.
 *
 * @module library-block-adapter
 */

/** @typedef {{ type: string, content?: string, level?: number, id?: string, meta?: Record<string, unknown> }} LibraryBlock */
/** @typedef {{ type: string, content?: string, meta?: Record<string, unknown>, id?: string }} RazyBlock */

const LIBRARY_CORE_TYPES = new Set([
    'paragraph',
    'heading',
    'bullet_list',
    'numbered_list',
    'code',
    'divider',
    'table',
]);

const RAZY_CORE_MAP = Object.freeze({
    paragraph: 'paragraph',
    heading: 'heading',
    bullet_list: 'bulleted-list',
    numbered_list: 'numbered-list',
    code: 'code',
    divider: 'divider',
    table: 'table',
});

const LIBRARY_CORE_MAP = Object.freeze({
    paragraph: 'paragraph',
    heading: 'heading',
    'bulleted-list': 'bullet_list',
    'numbered-list': 'numbered_list',
    code: 'code',
    divider: 'divider',
    table: 'table',
    regular: 'paragraph',
});

const EXTENDED_RAZY_TYPES = new Set([
    'todo',
    'quote',
    'callout',
    'toggle',
    'image',
]);

/**
 * @param {unknown} rows
 * @returns {string[][]}
 */
function normalizeTableRows(rows) {
    if (!Array.isArray(rows)) return [['', '']];
    const out = [];
    for (const row of rows) {
        if (!Array.isArray(row)) continue;
        out.push(row.map((cell) => String(cell ?? '')));
    }
    return out.length ? out : [['', '']];
}

/**
 * @param {string} content
 * @returns {string[][]}
 */
function tableRowsFromTsv(content) {
    const lines = String(content || '')
        .split(/\r?\n/)
        .map((ln) => ln.trim())
        .filter(Boolean);
    if (!lines.length) return [['', '']];
    return lines.map((ln) => ln.split('\t').map((c) => c.trim()));
}

/**
 * @param {LibraryBlock} block
 * @returns {RazyBlock}
 */
function fromLibraryBlock(block) {
    const type = String(block?.type || 'paragraph').trim().toLowerCase();
    const content = String(block?.content ?? '');
    const meta = block?.meta && typeof block.meta === 'object' ? { ...block.meta } : {};
    const id = block?.id != null ? String(block.id) : undefined;

    if (meta.ruType && typeof meta.ruType === 'string') {
        const ruType = String(meta.ruType);
        const ruMeta =
            meta.ruMeta && typeof meta.ruMeta === 'object' ? { ...meta.ruMeta } : { ...meta };
        delete ruMeta.ruType;
        delete ruMeta.ruMeta;
        delete ruMeta.libraryType;
        return {
            type: ruType,
            content,
            meta: ruMeta,
            ...(id ? { id } : {}),
        };
    }

    if (type === 'table') {
        const rows = normalizeTableRows(meta.rows ?? tableRowsFromTsv(content));
        return {
            type: 'table',
            content: '',
            meta: { rows },
            ...(id ? { id } : {}),
        };
    }

    // Legacy: table stored as code block + meta.libraryType=table
    if (meta.libraryType === 'table' || meta.language === 'table') {
        const rows = normalizeTableRows(meta.rows ?? tableRowsFromTsv(content));
        return {
            type: 'table',
            content: '',
            meta: { rows },
            ...(id ? { id } : {}),
        };
    }

    if (type === 'heading') {
        const level = block?.level ?? meta.level ?? 1;
        return {
            type: 'heading',
            content,
            meta: { level: Math.max(1, Math.min(3, Number(level) || 1)) },
            ...(id ? { id } : {}),
        };
    }

    const razyType = RAZY_CORE_MAP[type] || 'paragraph';
    return {
        type: razyType,
        content,
        ...(Object.keys(meta).length ? { meta } : {}),
        ...(id ? { id } : {}),
    };
}

/**
 * @param {RazyBlock} block
 * @returns {LibraryBlock}
 */
function toLibraryBlock(block) {
    const type = String(block?.type || 'paragraph').trim();
    const content = String(block?.content ?? '');
    const metaIn = block?.meta && typeof block.meta === 'object' ? { ...block.meta } : {};
    const id = block?.id != null ? String(block.id) : undefined;

    if (type === 'table' || metaIn.libraryType === 'table' || metaIn.language === 'table') {
        const rows =
            metaIn.rows && Array.isArray(metaIn.rows)
                ? normalizeTableRows(metaIn.rows)
                : tableRowsFromTsv(content);
        return {
            type: 'table',
            content: '',
            meta: { rows },
            ...(id ? { id } : {}),
        };
    }

    if (EXTENDED_RAZY_TYPES.has(type) || !LIBRARY_CORE_MAP[type]) {
        const ruMeta = { ...metaIn };
        return {
            type: 'paragraph',
            content,
            meta: {
                ruType: type,
                ruMeta,
            },
            ...(id ? { id } : {}),
        };
    }

    const libType = LIBRARY_CORE_MAP[type] || 'paragraph';

    if (libType === 'heading') {
        const level = metaIn.level ?? 1;
        return {
            type: 'heading',
            content,
            level: Math.max(1, Math.min(3, Number(level) || 1)),
            ...(id ? { id } : {}),
        };
    }

    if (libType === 'divider') {
        return {
            type: 'divider',
            content: '',
            ...(id ? { id } : {}),
        };
    }

    if (libType === 'table') {
        return {
            type: 'table',
            content: '',
            meta: { rows: normalizeTableRows(metaIn.rows) },
            ...(id ? { id } : {}),
        };
    }

    /** @type {LibraryBlock} */
    const out = {
        type: libType,
        content,
        ...(id ? { id } : {}),
    };
    const metaKeys = Object.keys(metaIn);
    if (metaKeys.length && libType === 'code') {
        out.meta = metaIn;
    }
    return out;
}

/**
 * @param {LibraryBlock[]|null|undefined} blocks
 * @returns {RazyBlock[]}
 */
export function fromLibraryBlocks(blocks) {
    const rows = Array.isArray(blocks) ? blocks : [];
    const mapped = rows
        .filter((b) => b && typeof b === 'object')
        .map((b) => fromLibraryBlock(/** @type {LibraryBlock} */ (b)));
    if (!mapped.length) {
        return [{ type: 'paragraph', content: '' }];
    }
    return mapped;
}

/**
 * @param {RazyBlock[]|null|undefined} blocks
 * @returns {LibraryBlock[]}
 */
export function toLibraryBlocks(blocks) {
    const rows = Array.isArray(blocks) ? blocks : [];
    const mapped = rows
        .filter((b) => b && typeof b === 'object')
        .map((b) => toLibraryBlock(/** @type {RazyBlock} */ (b)));
    if (!mapped.length) {
        return [{ type: 'paragraph', content: '' }];
    }
    return mapped.filter((b) => LIBRARY_CORE_TYPES.has(b.type) || b.meta?.ruType);
}

export default { fromLibraryBlocks, toLibraryBlocks };
