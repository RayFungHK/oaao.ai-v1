/**
 * Productivity fence previews (```oaao-calendar / ```oaao-todo) and meta rehydrate on thread reload.
 *
 * Confirmation actions live in [strip] chips only — not duplicate inline cards.
 *
 * @module productivity-inline-blocks
 */

import { oaaoT } from '../../../core/default/js/oaao-i18n.js';
import { getOaaoAgentCatalogEntry } from './oaao-agent-catalog.js';
import { mountRuiIconSync } from './oaao-rui-icons.js?v=20260530-fence-panel-v193';
import { normalizeStripItemsFromMeta } from './strip-chip-shell.js';

const INLINE_STYLE_REV = '20260530-strip-confirm-v208';

/** @typedef {'pending' | 'confirmed' | 'dismissed'} ProductivityFenceState */

/**
 * @typedef {Object} ProductivityFenceSection
 * @property {'calendar' | 'todo'} kind
 * @property {string} agent
 * @property {string} summary
 * @property {string} memo
 * @property {string[]} items
 * @property {ProductivityFenceState} state
 */

const FENCE_LUCIDE_BY_AGENT = {
    calendar_schedule: 'calendar',
    todo_extract: 'list-todo',
};

const FENCE_HOST_CLASS =
    'oaao-productivity-fence-host mt-2 flex flex-col gap-1.5 w-full min-w-0 sm:w-[40%] sm:max-w-[40%] overflow-visible pl-1';
const FENCE_STYLE_ID = 'oaao-productivity-fence-styles';

function ensureProductivityFenceStyles() {
    if (typeof document === 'undefined') return;
    let style = document.getElementById(FENCE_STYLE_ID);
    if (!(style instanceof HTMLStyleElement)) {
        style = document.createElement('style');
        style.id = FENCE_STYLE_ID;
        document.head.append(style);
    }
    if (style.dataset.oaaoRev === INLINE_STYLE_REV) return;
    style.dataset.oaaoRev = INLINE_STYLE_REV;
    style.textContent = `
.oaao-productivity-fence-host{overflow:visible}
.oaao-productivity-fence-shell{width:100%;min-width:0;box-sizing:border-box;padding:2px 4px 4px 2px}
.oaao-productivity-fence-box{width:100%;min-width:0;box-sizing:border-box;padding:0;border:1px solid var(--grid-line-strong,rgba(0,0,0,.1));border-radius:12px;background:var(--grid-panel-bright,#fff);overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.07)}
.oaao-productivity-fence-box--pending{box-shadow:0 2px 8px rgba(180,83,9,.12)}
.oaao-productivity-fence-box--pending .oaao-productivity-fence-agent-row{color:#b45309}
.oaao-productivity-fence-box--confirmed{box-shadow:0 2px 8px rgba(21,128,61,.1)}
.oaao-productivity-fence-box--confirmed .oaao-productivity-fence-agent-row{color:#15803d}
.oaao-productivity-fence-box--dismissed{opacity:0.55;box-shadow:0 1px 4px rgba(0,0,0,.05)}
.oaao-productivity-fence-box--dismissed .oaao-productivity-fence-agent-row{color:var(--grid-caption)}
.oaao-productivity-fence-agent-row{margin:0;padding:0.5625rem 0.75rem;border-bottom:1px solid var(--grid-line-strong,rgba(0,0,0,.1));background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.06)) 58%,var(--grid-panel-bright,#fff));border-radius:11px 11px 0 0}
.oaao-productivity-fence-card-body{padding:0.625rem 0.75rem 0.75rem}
.oaao-productivity-fence-agent{font-size:0.6875rem;font-weight:600;line-height:1.2;letter-spacing:.01em}
`.trim();
}

/**
 * @param {ProductivityFenceState} state
 */
function fenceBoxClassName(state) {
    ensureProductivityFenceStyles();
    const s = state === 'confirmed' || state === 'dismissed' ? state : 'pending';
    return `oaao-productivity-fence-box oaao-productivity-fence-box--${s}`;
}

/** @type {Record<ProductivityFenceState, string>} */
export const FENCE_STATE_BOX_CLASS = {
    pending: fenceBoxClassName('pending'),
    dismissed: fenceBoxClassName('dismissed'),
    confirmed: fenceBoxClassName('confirmed'),
};

const FENCE_ITEMS_MAX = 24;
const FENCE_ITEM_MAX_LEN = 240;

const CALENDAR_FENCE_RE = /```oaao-calendar\s*\n([\s\S]*?)```/gi;
const TODO_FENCE_RE = /```oaao-todo\s*\n([\s\S]*?)```/gi;
const STRIP_OAAO_RE = /```oaao-(?:calendar|todo)\s*\n[\s\S]*?```\s*/gi;

const CALENDAR_MIN_CONF = 0.62;
const TODO_MIN_CONF = 0.58;

/**
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
function parseJsonObject(raw) {
    let text = String(raw ?? '').trim();
    if (!text) return null;
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = String(fence[1] ?? '').trim();
    try {
        const obj = JSON.parse(text);
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            const obj = JSON.parse(text.slice(start, end + 1));
            return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
        } catch {
            return null;
        }
    }
}

/**
 * @param {unknown} raw
 * @param {number} fallback
 */
function clampConf(raw, fallback) {
    const v = Number(raw);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/**
 * Display-only list lines from fence JSON (separate from confirmable todo `items`).
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeFenceItems(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {string[]} */
    const out = [];
    for (const row of raw) {
        let text = '';
        if (typeof row === 'string') {
            text = row.trim();
        } else if (row && typeof row === 'object') {
            const o = /** @type {Record<string, unknown>} */ (row);
            for (const key of ['text', 'title', 'label', 'memo']) {
                const val = o[key];
                if (typeof val === 'string' && val.trim()) {
                    text = val.trim();
                    break;
                }
            }
        }
        if (!text) continue;
        out.push(text.slice(0, FENCE_ITEM_MAX_LEN));
        if (out.length >= FENCE_ITEMS_MAX) break;
    }
    return out;
}

function normalizeCalendar(obj, conversationId) {
    const title = String(obj.title ?? '').trim();
    const start = String(obj.start_at ?? '').trim();
    if (!title || !start) return null;
    const conf = clampConf(obj.confidence, 0.85);
    if (conf < CALENDAR_MIN_CONF) return null;
    const end = String(obj.end_at ?? start).trim() || start;
    /** @type {Record<string, unknown>} */
    const out = {
        title,
        start_at: start,
        end_at: end,
        all_day: Boolean(obj.all_day),
        timezone: String(obj.timezone ?? 'UTC').trim() || 'UTC',
        location: String(obj.location ?? '').trim(),
        notes: String(obj.notes ?? '').trim(),
        confidence: conf,
        conversation_id: conversationId,
    };
    const memo = String(obj.fence_memo ?? '').trim();
    if (memo) out.fence_memo = memo.slice(0, 1200);
    const fenceItems = normalizeFenceItems(obj.fence_items);
    if (fenceItems.length) out.fence_items = fenceItems;
    return out;
}

function normalizeTodoItem(obj, conversationId) {
    const title = String(obj.title ?? '').trim();
    if (!title) return null;
    const conf = clampConf(obj.confidence, 0.8);
    if (conf < TODO_MIN_CONF) return null;
    return {
        title,
        context_snippet: String(obj.context_snippet ?? '').trim(),
        confidence: conf,
        conversation_id: conversationId,
        priority: String(obj.priority ?? 'normal').trim() || 'normal',
        due_at: obj.due_at ?? null,
    };
}

function parseCalendarFence(body, conversationId) {
    const obj = parseJsonObject(body);
    if (!obj) return null;
    if (String(obj.type ?? '') === 'calendar_event_suggested') {
        return normalizeCalendar(obj, conversationId);
    }
    const actions = obj.actions;
    if (Array.isArray(actions)) {
        for (const row of actions) {
            if (!row || typeof row !== 'object') continue;
            const r = /** @type {Record<string, unknown>} */ ({ ...row });
            if (String(r.type ?? '') !== 'calendar_event_suggested') continue;
            delete r.type;
            const hit = normalizeCalendar(r, conversationId);
            if (hit) return hit;
        }
        return null;
    }
    return normalizeCalendar(obj, conversationId);
}

/**
 * @param {string} body
 * @param {number} conversationId
 * @returns {Record<string, unknown>}
 */
function parseTodoFence(body, conversationId) {
    const out = {};
    const obj = parseJsonObject(body);
    if (!obj) return out;

    const fenceMemo = String(obj.fence_memo ?? '').trim();
    if (fenceMemo) out.todo_items_fence_memo = fenceMemo.slice(0, 1200);
    const fenceItems = normalizeFenceItems(obj.fence_items);
    if (fenceItems.length) out.todo_items_fence_items = fenceItems;

    const pack = (items) => {
        const norm = [];
        for (const row of items) {
            if (!row || typeof row !== 'object') continue;
            const hit = normalizeTodoItem(/** @type {Record<string, unknown>} */ (row), conversationId);
            if (hit) norm.push(hit);
        }
        if (norm.length >= 2) out.todo_items_suggested = norm;
        else if (norm.length === 1) out.todo_item_suggested = norm[0];
    };

    const type = String(obj.type ?? '').toLowerCase();
    if (type === 'todo_items_suggested' && Array.isArray(obj.items)) {
        pack(obj.items);
        return out;
    }
    if (type === 'todo_item_suggested') {
        const one = normalizeTodoItem(obj, conversationId);
        if (one) out.todo_item_suggested = one;
        return out;
    }
    if (Array.isArray(obj.actions)) {
        const items = [];
        for (const row of obj.actions) {
            if (!row || typeof row !== 'object') continue;
            const r = /** @type {Record<string, unknown>} */ ({ ...row });
            if (String(r.type ?? '') !== 'todo_item_suggested') continue;
            delete r.type;
            const hit = normalizeTodoItem(r, conversationId);
            if (hit) items.push(hit);
        }
        pack(items);
        return out;
    }
    if (Array.isArray(obj.items)) {
        pack(obj.items);
        return out;
    }
    const one = normalizeTodoItem(obj, conversationId);
    if (one) out.todo_item_suggested = one;
    return out;
}

/**
 * @param {Record<string, unknown>} cal
 */
function calendarFenceMemoFallback(cal) {
    const lines = [];
    const title = String(cal.title ?? '').trim();
    if (title) lines.push(`**${title}**`, '');
    const start = String(cal.start_at ?? '').trim();
    const end = String(cal.end_at ?? '').trim();
    if (start) lines.push(end && end !== start ? `${start} – ${end}` : start);
    const loc = String(cal.location ?? '').trim();
    if (loc) lines.push(loc);
    const notes = String(cal.notes ?? '').trim();
    if (notes) lines.push(notes);
    return lines.join('\n').trim();
}

/**
 * @param {unknown} raw
 * @returns {ProductivityFenceState}
 */
function normalizeFenceState(raw) {
    const s = String(raw ?? '').toLowerCase();
    if (s === 'confirmed' || s === 'dismissed') return s;
    return 'pending';
}

/**
 * @param {string} agentKind
 */
function resolveAgentPresentation(agentKind) {
    const kind = String(agentKind ?? '').trim() || 'todo_extract';
    const entry = getOaaoAgentCatalogEntry(kind);
    const lucide = FENCE_LUCIDE_BY_AGENT[kind] ?? 'list-todo';
    const label = entry
        ? oaaoT(entry.labelKey, entry.fallbackLabel)
        : kind === 'calendar_schedule'
          ? oaaoT('settings.planner.agent.calendar_schedule', 'Calendar')
          : oaaoT('settings.planner.agent.todo_extract', 'Todos');
    return { kind, lucide, label };
}

/**
 * @param {'calendar' | 'todo'} fenceKind
 */
function defaultAgentForFenceKind(fenceKind) {
    return fenceKind === 'calendar' ? 'calendar_schedule' : 'todo_extract';
}

/**
 * @param {'calendar' | 'todo'} fenceKind
 * @param {Record<string, unknown>} meta
 * @param {string[]} items
 * @param {string} memo
 */
function buildPostTurnSummary(fenceKind, meta, items, memo) {
    if (fenceKind === 'calendar') {
        const cal = meta.calendar_event_suggested;
        const title =
            cal && typeof cal === 'object'
                ? String(/** @type {Record<string, unknown>} */ (cal).title ?? '').trim()
                : '';
        if (title) {
            return `${oaaoT('productivity.calendar.add_prompt', 'Add to calendar?')} · ${title}`;
        }
        return oaaoT('productivity.calendar.add_prompt', 'Add to calendar?');
    }
    const n = items.length;
    if (n >= 2) {
        return oaaoT('productivity.fence.summary_todos', 'Add {n} todos?').replace('{n}', String(n));
    }
    if (n === 1) {
        return `${oaaoT('productivity.todo.add_prompt', 'Add to todos?')} · ${items[0]}`;
    }
    const memoTrim = String(memo ?? '').trim();
    if (memoTrim) return memoTrim.slice(0, 120);
    return oaaoT('productivity.todo.add_prompt', 'Add to todos?');
}

/**
 * @param {Record<string, unknown> | null | undefined} meta
 * @param {'calendar' | 'todo'} kind
 */
export function isProductivityFenceKindResolved(meta, kind) {
    if (!meta || typeof meta !== 'object') return false;
    const fences = meta.productivity_fences;
    if (!fences || typeof fences !== 'object') return false;
    const row = /** @type {Record<string, unknown>} */ (fences)[kind];
    if (!row || typeof row !== 'object') return false;
    const state = String(/** @type {Record<string, unknown>} */ (row).state ?? '').toLowerCase();
    return state === 'confirmed' || state === 'dismissed';
}

/**
 * Merge inline fence parse into meta without reviving confirmed/dismissed kinds.
 *
 * @param {Record<string, unknown> | null | undefined} baseMeta
 * @param {Record<string, unknown> | null | undefined} parsedMeta
 * @returns {Record<string, unknown>}
 */
export function mergeProductivityMetaFromContent(baseMeta, parsedMeta) {
    /** @type {Record<string, unknown>} */
    const out = baseMeta && typeof baseMeta === 'object' ? { ...baseMeta } : {};
    const parsed = parsedMeta && typeof parsedMeta === 'object' ? parsedMeta : {};
    if (!isProductivityFenceKindResolved(out, 'calendar') && parsed.calendar_event_suggested) {
        out.calendar_event_suggested = parsed.calendar_event_suggested;
    }
    if (!isProductivityFenceKindResolved(out, 'todo')) {
        for (const key of [
            'todo_item_suggested',
            'todo_items_suggested',
            'todo_items_fence_memo',
            'todo_items_fence_items',
            'productivity_inline_extracted',
        ]) {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                out[key] = parsed[key];
            }
        }
    }
    return out;
}

/**
 * @param {Record<string, unknown>} meta
 * @param {'calendar' | 'todo'} kind
 * @returns {ProductivityFenceSection | null}
 */
function fenceSectionFromActiveMeta(meta, kind) {
    const agent = defaultAgentForFenceKind(kind);
    if (kind === 'calendar') {
        const cal = meta.calendar_event_suggested;
        if (!cal || typeof cal !== 'object') return null;
        const calObj = /** @type {Record<string, unknown>} */ (cal);
        const rawMemo = String(calObj.fence_memo ?? '').trim();
        const title = String(calObj.title ?? '').trim();
        const items = normalizeFenceItems(calObj.fence_items);
        if (!rawMemo && !items.length && !title) return null;
        const summary = buildPostTurnSummary('calendar', meta, items, rawMemo);
        const detailMemo = rawMemo && rawMemo !== summary ? rawMemo : '';
        return {
            kind: 'calendar',
            agent,
            summary,
            memo: detailMemo,
            items,
            state: 'pending',
        };
    }

    const todoMemo = String(meta.todo_items_fence_memo ?? '').trim();
    const todoItems = normalizeFenceItems(meta.todo_items_fence_items);
    /** @type {string[]} */
    let items = [...todoItems];
    if (!items.length && Array.isArray(meta.todo_items_suggested)) {
        for (const row of meta.todo_items_suggested) {
            if (!row || typeof row !== 'object') continue;
            const t = String(/** @type {Record<string, unknown>} */ (row).title ?? '').trim();
            if (t) items.push(t);
        }
    } else if (!items.length && meta.todo_item_suggested && typeof meta.todo_item_suggested === 'object') {
        const t = String(
            /** @type {Record<string, unknown>} */ (meta.todo_item_suggested).title ?? '',
        ).trim();
        if (t) items = [t];
    }
    if (!todoMemo && !items.length) return null;
    const summary = buildPostTurnSummary('todo', meta, items, todoMemo);
    const detailMemo = todoMemo && todoMemo !== summary ? todoMemo : '';
    return {
        kind: 'todo',
        agent,
        summary,
        memo: detailMemo,
        items,
        state: 'pending',
    };
}

/**
 * @param {Record<string, unknown>} meta
 * @param {number} [conversationId]
 * @param {string} [content]
 * @returns {ProductivityFenceSection[]}
 */
export function buildFenceSectionsFromMeta(meta, conversationId = 0, content = '') {
    if (!meta || typeof meta !== 'object') return [];
    /** @type {ProductivityFenceSection[]} */
    const sections = [];
    const archived =
        meta.productivity_fences && typeof meta.productivity_fences === 'object'
            ? /** @type {Record<string, unknown>} */ (meta.productivity_fences)
            : {};

    for (const kind of /** @type {const} */ (['calendar', 'todo'])) {
        const row = archived[kind];
        if (row && typeof row === 'object') {
            const o = /** @type {Record<string, unknown>} */ (row);
            let memo = String(o.memo ?? '').trim();
            let items = normalizeFenceItems(o.items);
            const state = normalizeFenceState(o.state);
            const agent = String(o.agent ?? defaultAgentForFenceKind(kind)).trim();
            let summary = String(o.summary ?? '').trim();
            if ((!memo && !items.length) && String(content).trim()) {
                const parsed = extractProductivityInlineBlocks(content, conversationId);
                const merged = mergeProductivityMetaFromContent(meta, parsed.meta);
                const active = fenceSectionFromActiveMeta(merged, kind);
                if (active) {
                    if (!memo) memo = String(active.memo ?? '').trim();
                    if (!items.length) items = active.items ?? [];
                    if (!summary) summary = String(active.summary ?? '').trim();
                }
            }
            if (!summary) {
                summary = buildPostTurnSummary(kind, meta, items, memo);
            }
            let detailMemo = memo && memo !== summary ? memo : '';
            if (kind === 'calendar' && !detailMemo) {
                const cal = meta.calendar_event_suggested;
                if (cal && typeof cal === 'object') {
                    const title = String(/** @type {Record<string, unknown>} */ (cal).title ?? '').trim();
                    if (title && title !== summary) detailMemo = title;
                }
            }
            if (memo || items.length || state !== 'pending' || summary) {
                sections.push({
                    kind,
                    agent,
                    summary,
                    memo: detailMemo,
                    items,
                    state,
                });
                continue;
            }
        }
        if (isProductivityFenceKindResolved(meta, kind)) {
            continue;
        }
        const active = fenceSectionFromActiveMeta(meta, kind);
        if (active) sections.push(active);
    }

    return sections;
}

/**
 * @param {string} actionId
 * @returns {'calendar' | 'todo' | null}
 */
export function stripActionToFenceKind(actionId) {
    const id = String(actionId ?? '').toLowerCase();
    if (id === 'calendar_event_suggested') return 'calendar';
    if (id.startsWith('todo_')) return 'todo';
    return null;
}

/**
 * @param {Record<string, unknown>} meta
 * @param {'calendar' | 'todo'} kind
 * @param {ProductivityFenceState} state
 * @param {{ agent?: string, summary?: string, memo?: string, items?: string[] }} [preview]
 */
export function archiveFenceInMeta(meta, kind, state, preview = {}) {
    if (!meta || typeof meta !== 'object') return;
    const fences =
        meta.productivity_fences && typeof meta.productivity_fences === 'object'
            ? { .../** @type {Record<string, unknown>} */ (meta.productivity_fences) }
            : {};
    const active = fenceSectionFromActiveMeta(meta, kind);
    fences[kind] = {
        state,
        agent: String(preview.agent ?? active?.agent ?? defaultAgentForFenceKind(kind)).trim(),
        summary: String(preview.summary ?? active?.summary ?? '').trim(),
        memo: String(preview.memo ?? active?.memo ?? '').trim(),
        items: Array.isArray(preview.items) ? preview.items : active?.items ?? [],
    };
    meta.productivity_fences = fences;
    if (kind === 'calendar') {
        delete meta.calendar_event_suggested;
    } else {
        delete meta.todo_item_suggested;
        delete meta.todo_items_suggested;
        delete meta.todo_items_fence_memo;
        delete meta.todo_items_fence_items;
    }
}

/**
 * @param {HTMLElement | Document} root
 * @param {number} messageId
 * @param {'calendar' | 'todo'} kind
 * @param {ProductivityFenceState} state
 * @param {{ agent?: string, summary?: string, memo?: string, items?: string[] }} [preview]
 * @param {{ renderMarkdown?: (el: HTMLElement, md: string) => void }} [opts]
 */
export function applyFenceStateToBubble(root, messageId, kind, state, preview = {}, opts = {}) {
    const mid = Math.floor(Number(messageId));
    if (mid < 1) return;
    const bubble =
        root.querySelector(`[data-oaao-msg-id="${mid}"][data-oaao-msg-role="assistant"]`) ??
        root.querySelector(`[data-oaao-msg-id="${mid}"]`);
    if (!(bubble instanceof HTMLElement)) return;

    let box = bubble.querySelector(`[data-oaao-productivity-fence="${kind}"]`);
    if (!(box instanceof HTMLElement)) {
        mountProductivityFenceMemos(
            bubble,
            {
                productivity_fences: {
                    [kind]: {
                        state,
                        agent: preview.agent ?? defaultAgentForFenceKind(kind),
                        summary: preview.summary ?? '',
                        memo: preview.memo ?? '',
                        items: preview.items ?? [],
                    },
                },
            },
            opts,
        );
        box = bubble.querySelector(`[data-oaao-productivity-fence="${kind}"]`);
    }
    if (!(box instanceof HTMLElement)) return;

    box.dataset.oaaoProductivityFenceState = state;
    box.className = fenceBoxClassName(state);
}

/**
 * Build fence panel content from a canonical strip item (confirm dialog).
 *
 * @param {Record<string, unknown>} item
 * @returns {ProductivityFenceSection | null}
 */
export function buildFencePreviewFromStripItem(item) {
    if (!item || typeof item !== 'object') return null;
    const actionId = String(item.action_id ?? '').trim();
    const kind = stripActionToFenceKind(actionId);
    if (!kind) return null;

    const agent = String(item.agent ?? defaultAgentForFenceKind(kind)).trim();
    const summary = String(item.description ?? '').trim();
    const payload =
        item.payload && typeof item.payload === 'object'
            ? /** @type {Record<string, unknown>} */ (item.payload)
            : {};

    let memo = '';
    /** @type {string[]} */
    let items = [];

    if (kind === 'calendar') {
        const fenceMemo = String(payload.fence_memo ?? '').trim();
        const title = String(payload.title ?? '').trim();
        items = normalizeFenceItems(payload.fence_items);
        const loc = String(payload.location ?? '').trim();
        if (!items.length && loc) items = [loc];
        memo = title || fenceMemo;
    } else {
        memo = String(payload.fence_memo ?? '').trim();
        items = normalizeFenceItems(payload.fence_items);
        if (!items.length && Array.isArray(payload.items)) {
            for (const row of payload.items) {
                if (!row || typeof row !== 'object') continue;
                const t = String(/** @type {Record<string, unknown>} */ (row).title ?? '').trim();
                if (t) items.push(t);
            }
        } else if (!items.length && Array.isArray(payload)) {
            for (const row of payload) {
                if (!row || typeof row !== 'object') continue;
                const t = String(/** @type {Record<string, unknown>} */ (row).title ?? '').trim();
                if (t) items.push(t);
            }
        }
    }

    const fenceMemoCal =
        kind === 'calendar' ? String(payload.fence_memo ?? '').trim() : '';
    const titleCal = kind === 'calendar' ? String(payload.title ?? '').trim() : '';
    const detailMemo =
        kind === 'calendar' && fenceMemoCal && titleCal
            ? titleCal
            : memo && memo !== summary
              ? memo
              : '';
    const builtSummary =
        summary || buildPostTurnSummary(kind, /** @type {Record<string, unknown>} */ ({}), items, memo);

    if (!builtSummary && !detailMemo && !items.length) return null;

    return {
        kind,
        agent,
        summary: builtSummary,
        memo: detailMemo,
        items,
        state: 'pending',
    };
}

/**
 * Plain copy for strip confirm dialog — not a fence clone.
 *
 * @param {Record<string, unknown>} item
 * @returns {{ agent: string, paragraphs: { role: 'caption' | 'lead' | 'line', text: string }[] } | null}
 */
export function buildStripConfirmDialogCopy(item) {
    if (!item || typeof item !== 'object') return null;
    const section = buildFencePreviewFromStripItem(item);
    if (!section) return null;

    const payload =
        item.payload && typeof item.payload === 'object'
            ? /** @type {Record<string, unknown>} */ (item.payload)
            : {};

    const fenceMemo = String(
        section.kind === 'calendar' ? payload.fence_memo ?? '' : payload.fence_memo ?? '',
    ).trim();
    const title = String(payload.title ?? '').trim();
    const desc = String(item.description ?? '').trim();

    /** @type {{ role: 'caption' | 'lead' | 'line', text: string }[]} */
    const paragraphs = [];

    let caption = fenceMemo;
    if (!caption && desc.includes('·')) {
        caption = desc
            .split('·')
            .slice(1)
            .join('·')
            .trim();
    }
    if (!caption) {
        const summary = String(section.summary ?? '').trim();
        const dot = summary.indexOf('·');
        if (dot >= 0) caption = summary.slice(dot + 1).trim();
        else if (summary && !/^add\s/i.test(summary)) caption = summary;
    }
    if (caption) paragraphs.push({ role: 'caption', text: caption });

    const lead =
        title ||
        (String(section.memo ?? '').trim() &&
        String(section.memo ?? '').trim() !== caption
            ? String(section.memo ?? '').trim()
            : '');
    if (lead && lead !== caption) paragraphs.push({ role: 'lead', text: lead });

    for (const line of section.items) {
        const t = String(line ?? '').trim();
        if (!t || t === caption || t === lead) continue;
        paragraphs.push({ role: 'line', text: t });
    }

    if (!paragraphs.length) {
        const fallback = String(item.message ?? '').trim();
        if (!fallback) return null;
        for (const block of fallback.split(/\n{2,}/)) {
            const t = block.trim();
            if (t) paragraphs.push({ role: 'line', text: t });
        }
    }

    if (!paragraphs.length) return null;

    return {
        agent: String(item.agent ?? section.agent ?? defaultAgentForFenceKind(section.kind)).trim(),
        paragraphs,
    };
}

/**
 * @param {HTMLElement} host
 * @param {ProductivityFenceSection} section
 * @param {{ renderMarkdown?: (el: HTMLElement, md: string) => void | Promise<void>, boxed?: boolean }} [opts]
 */
export function mountProductivityFencePanel(host, section, opts = {}) {
    if (!(host instanceof HTMLElement)) return;
    ensureProductivityFenceStyles();

    const agent = resolveAgentPresentation(section.agent);
    const summary = String(section.summary ?? '').trim();
    const memo = String(section.memo ?? '').trim();
    const items = Array.isArray(section.items)
        ? section.items.map((line) => String(line ?? '').trim()).filter(Boolean)
        : [];

    if (opts.boxed !== false) {
        host.className = fenceBoxClassName(section.state);
        host.dataset.oaaoProductivityFence = section.kind;
        host.dataset.oaaoProductivityFenceState = section.state;
    }

    host.replaceChildren();

    const agentRow = document.createElement('div');
    agentRow.className = 'oaao-productivity-fence-agent-row flex items-center gap-1.5';
    const agentIcon = document.createElement('span');
    agentIcon.className =
        'oaao-productivity-fence-agent-icon inline-flex shrink-0 size-3.5';
    mountRuiIconSync(agentIcon, agent.lucide, { size: 14, strokeWidth: 2 });
    const agentLabel = document.createElement('span');
    agentLabel.className = 'oaao-productivity-fence-agent';
    agentLabel.textContent = agent.label;
    agentRow.append(agentIcon, agentLabel);
    host.append(agentRow);

    const inner = document.createElement('div');
    inner.className = 'oaao-productivity-fence-card-body min-w-0 flex flex-col';

    if (summary) {
        const summaryEl = document.createElement('p');
        summaryEl.className =
            'm-0 mb-1.5 text-[0.75rem] leading-snug fg-[var(--grid-caption)]';
        summaryEl.textContent = summary;
        inner.append(summaryEl);
    }

    if (memo) {
        const memoEl = document.createElement('div');
        memoEl.className =
            'oaao-md-bubble text-[0.8125rem] leading-snug fw-medium min-w-0 fg-[var(--grid-ink)] mb-2';
        if (typeof opts.renderMarkdown === 'function') {
            void opts.renderMarkdown(memoEl, memo);
        } else {
            memoEl.style.whiteSpace = 'pre-wrap';
            memoEl.textContent = memo;
        }
        inner.append(memoEl);
    }

    if (items.length) {
        const ul = document.createElement('ul');
        ul.className =
            'm-0 pl-3.5 list-disc text-[0.75rem] leading-relaxed fg-[var(--grid-ink)] space-y-0.5' +
            (memo ? ' mt-2' : summary ? ' mt-1' : '');
        for (const line of items) {
            const li = document.createElement('li');
            li.textContent = line;
            ul.append(li);
        }
        inner.append(ul);
    }

    if (summary || memo || items.length) {
        host.append(inner);
    }
}

/**
 * @param {string} md
 */
export function stripProductivityInlineFences(md) {
    const stripped = String(md ?? '').replace(STRIP_OAAO_RE, '');
    return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * @param {string} md
 * @param {number} [conversationId]
 */
export function extractProductivityInlineBlocks(md, conversationId = 0) {
    const text = String(md ?? '');
    const cid = Math.floor(Number(conversationId));
    /** @type {Record<string, unknown>} */
    const meta = {};
    let hasFence = false;

    const calMatch = CALENDAR_FENCE_RE.exec(text);
    CALENDAR_FENCE_RE.lastIndex = 0;
    if (calMatch) {
        hasFence = true;
        const cal = parseCalendarFence(calMatch[1], cid);
        if (cal) meta.calendar_event_suggested = cal;
    }

    const todoMatch = TODO_FENCE_RE.exec(text);
    TODO_FENCE_RE.lastIndex = 0;
    if (todoMatch) {
        hasFence = true;
        Object.assign(meta, parseTodoFence(todoMatch[1], cid));
    }

    if (hasFence) meta.productivity_inline_extracted = true;

    return {
        stripped: hasFence ? stripProductivityInlineFences(text) : text,
        meta,
        blocks: buildFenceSectionsFromMeta(meta),
        hasFences: hasFence,
    };
}

/**
 * @param {Record<string, unknown>} meta
 */
export function productivityMetaHasStripChips(meta) {
    return normalizeStripItemsFromMeta(meta).length > 0;
}

/**
 * @param {Record<string, unknown> | null | undefined} meta
 */
export function productivityMetaHasFencePreview(meta, conversationId = 0, content = '') {
    return buildFenceSectionsFromMeta(
        meta && typeof meta === 'object' ? meta : {},
        conversationId,
        content,
    ).length > 0;
}

/**
 * Rehydrate ```oaao-*``` fence previews after refresh (body may already be stripped in DB).
 *
 * @param {HTMLElement} bubble
 * @param {Record<string, unknown> | null | undefined} meta
 * @param {{ renderMarkdown?: (el: HTMLElement, md: string) => void }} [opts]
 */
export function mountProductivityFenceMemos(bubble, meta, opts = {}) {
    bubble?.querySelector('[data-oaao-productivity-fence-host]')?.remove();
    bubble?.querySelector('[data-oaao-productivity-inline-host]')?.remove();

    const sections = buildFenceSectionsFromMeta(
        meta && typeof meta === 'object' ? meta : {},
        Math.floor(Number(opts.conversationId ?? 0)),
        String(opts.assistantContent ?? ''),
    );
    if (!(bubble instanceof HTMLElement) || sections.length < 1) return;

    const host = document.createElement('div');
    host.dataset.oaaoProductivityFenceHost = '1';
    host.className = FENCE_HOST_CLASS;

    for (const sec of sections) {
        const shell = document.createElement('div');
        shell.className = 'oaao-productivity-fence-shell';
        const box = document.createElement('div');
        mountProductivityFencePanel(box, sec, opts);
        shell.append(box);
        host.append(shell);
    }

    bubble.append(host);
    if (typeof globalThis.JIT?.hydrate === 'function') {
        globalThis.JIT.hydrate(host);
    }
}

/** @deprecated Use mountProductivityFenceMemos + [strip] chips only. */
export function mountProductivityInlineCards(bubble, blocks, opts = {}) {
    void blocks;
    void opts;
    bubble?.querySelector('[data-oaao-productivity-inline-host]')?.remove();
}

export {
    CALENDAR_MIN_CONF,
    TODO_MIN_CONF,
    INLINE_STYLE_REV,
};
