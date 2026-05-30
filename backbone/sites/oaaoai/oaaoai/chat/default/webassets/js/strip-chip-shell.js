/**
 * Unified [strip] hard shell — icon, description, Dismiss (✕), Confirm.
 *
 * Modules emit normalized items + strip_hash; this module owns DOM + API calls.
 *
 * @see docs/design/strip-chip-shell.md
 * @module strip-chip-shell
 */

import { oaaoT } from '../../../core/default/js/oaao-i18n.js';
import { getOaaoAgentCatalogEntry } from './oaao-agent-catalog.js';
import { mountRuiIconSync } from './oaao-rui-icons.js?v=20260530-fence-state-v190';
import {
    applyFenceStateToBubble,
    buildStripConfirmDialogCopy,
    isProductivityFenceKindResolved,
    stripActionToFenceKind,
} from './productivity-inline-blocks.js?v=20260530-fence-actions-v211';
import { mountProductivityChip, reorderAssistantRowAreas } from './productivity-strip-host.js';

/** @typedef {Record<string, unknown>} StripItem */

/** @typedef {'confirmed' | 'dismissed'} StripResolveState */

/** @typedef {{
 *   fetchJson?: typeof fetchStripDismiss,
 *   scopeFields?: () => Record<string, unknown>,
 *   onTodoResolve?: () => void,
 *   onStripResolved?: (conversationId: number, messageId: number, actionId: string, state: StripResolveState) => void,
 *   refreshStripFromInfoWorker?: (conversationId: number, messageId: number) => Promise<void>,
 *   ensureInfoWorkerPoll?: (conversationId: number, messageId: number) => void,
 *   mountEl?: HTMLElement | Document,
 *   lastAssistantMessageId?: number | null,
 *   onlyMountOnLastAssistant?: boolean,
 *   pruneOtherStripMessages?: boolean,
 * }} StripShellContext */

/** @type {Map<string, Set<string>>} */
const resolvedStripActionsByMessage = new Map();

/** @type {WeakMap<HTMLElement, StripShellContext>} */
const stripShellCtxByRoot = new WeakMap();

/**
 * @param {HTMLElement} chip
 * @param {StripShellContext} [ctx]
 * @returns {StripShellContext}
 */
function resolveStripShellCtx(chip, ctx = {}) {
    const strip = chip.closest('[data-oaao-chat-area="strip"]');
    if (strip instanceof HTMLElement) {
        const stored = stripShellCtxByRoot.get(strip);
        if (stored) return { ...stored, ...ctx };
    }
    const mount =
        chip.closest('[data-module="oaao-chat"]') ??
        (ctx.mountEl instanceof HTMLElement ? ctx.mountEl : null);
    const cid = Math.floor(Number(chip.dataset.oaaoConversationId ?? 0));
    const hook = globalThis.__oaaoBuildStripShellCtx;
    if (typeof hook === 'function' && mount instanceof HTMLElement && cid > 0) {
        return { ...hook(mount, cid), ...ctx };
    }
    return ctx;
}

/**
 * @param {number} conversationId
 * @param {number} messageId
 */
function stripResolvedKey(conversationId, messageId) {
    return `${Math.floor(Number(conversationId))}:${Math.floor(Number(messageId))}`;
}

/**
 * @param {number} conversationId
 * @param {number} messageId
 * @param {string} actionId
 */
export function markStripActionResolved(conversationId, messageId, actionId) {
    const action = String(actionId ?? '').trim();
    const key = stripResolvedKey(conversationId, messageId);
    if (!action) return;
    let set = resolvedStripActionsByMessage.get(key);
    if (!set) {
        set = new Set();
        resolvedStripActionsByMessage.set(key, set);
    }
    set.add(action);
}

/**
 * @param {number} conversationId
 * @param {number} messageId
 * @param {string} actionId
 */
export function isStripActionResolved(conversationId, messageId, actionId) {
    const action = String(actionId ?? '').trim();
    return resolvedStripActionsByMessage.get(stripResolvedKey(conversationId, messageId))?.has(action) === true;
}

/**
 * Restore in-memory resolved strip state after thread reload (from {@code productivity_fences}).
 *
 * @param {Record<string, unknown> | null | undefined} meta
 * @param {number} conversationId
 * @param {number} messageId
 */
export function hydrateStripResolvedFromMeta(meta, conversationId, messageId) {
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    if (cid < 1 || mid < 1 || !meta || typeof meta !== 'object') return;
    for (const actionId of [
        'calendar_event_suggested',
        'todo_item_suggested',
        'todo_items_suggested',
        'todo_resolve_suggested',
    ]) {
        const kind = stripActionToFenceKind(actionId);
        if (kind && isProductivityFenceKindResolved(meta, kind)) {
            markStripActionResolved(cid, mid, actionId);
        }
    }
}

/**
 * @param {HTMLElement | Document} root
 * @param {number} messageId
 * @param {string} [actionId]
 */
export function removeStripChipsForMessage(root, messageId, actionId = '') {
    const mid = Math.floor(Number(messageId));
    if (mid < 1) return;
    const action = String(actionId ?? '').trim();
    const scope = root instanceof HTMLElement || root instanceof Document ? root : document;
    scope.querySelectorAll('[data-oaao-strip-chip]').forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (Math.floor(Number(node.dataset.oaaoMessageId ?? 0)) !== mid) return;
        if (action && String(node.dataset.oaaoStripAction ?? '').trim() !== action) return;
        node.remove();
    });
    scope.querySelectorAll('[data-oaao-chat-area="strip"]').forEach((strip) => {
        if (!(strip instanceof HTMLElement)) return;
        if (!strip.querySelector('[data-oaao-strip-chip]')) {
            strip.remove();
        }
    });
}

/**
 * @param {HTMLElement} chip
 * @param {StripShellContext} ctx
 * @param {StripResolveState} state
 */
function applyStripResolvedUi(chip, ctx, state) {
    const cid = Math.floor(Number(chip.dataset.oaaoConversationId ?? 0));
    const mid = Math.floor(Number(chip.dataset.oaaoMessageId ?? 0));
    const actionId = String(chip.dataset.oaaoStripAction ?? '').trim();
    if (cid < 1 || mid < 1 || !actionId) return;

    markStripActionResolved(cid, mid, actionId);
    const root =
        ctx.mountEl instanceof HTMLElement || ctx.mountEl instanceof Document
            ? ctx.mountEl
            : chip.closest('[data-module="oaao-chat"]') ?? document;
    removeStripChipsForMessage(root, mid, actionId);

    const kind = stripActionToFenceKind(actionId);
    if (kind) {
        applyFenceStateToBubble(root, mid, kind, state);
    }
    if (typeof ctx.onStripResolved === 'function') {
        ctx.onStripResolved(cid, mid, actionId, state);
    }
}

/** @type {boolean} */
let dismissDelegationBound = false;

/** Lucide names aligned with [info] Cal/Todo pills — not planner task catalog icons. */
/** @type {Record<string, string>} */
const STRIP_LUCIDE_BY_AGENT = {
    calendar_schedule: 'calendar',
    todo_extract: 'list-todo',
};

/** @type {Promise<((msg: string, kind?: string) => void) | null> | null} */
let stripToastFirePromise = null;

/** @type {number} */
let stripWaitReadyToastAt = 0;

const STRIP_WAIT_READY_TOAST_MS = 4500;

/**
 * @param {string} msg
 * @param {'success' | 'error' | 'info' | 'warning'} [kind]
 */
function fireStripWaitReadyToast() {
    const now = Date.now();
    if (now - stripWaitReadyToastAt < STRIP_WAIT_READY_TOAST_MS) return;
    stripWaitReadyToastAt = now;
    void fireStripToast(
        pt('productivity.strip.wait_ready', 'Still preparing — try again in a moment.'),
        'info',
    );
}

async function fireStripToast(msg, kind = 'warning') {
    if (!stripToastFirePromise) {
        const prefix = mountPrefix();
        const url = `${prefix}/webassets/core/default/js/oaao-razy-toast.js`.replace(/\/{2,}/g, '/');
        stripToastFirePromise = import(/* webpackIgnore: true */ url)
            .then((m) => (typeof m.oaaoRazyToastFire === 'function' ? m.oaaoRazyToastFire : null))
            .catch(() => null);
    }
    const fire = await stripToastFirePromise;
    if (typeof fire === 'function') {
        fire(msg, kind);
    }
}

/** @type {Promise<typeof import('../../../core/default/webassets/razyui/component/Dialog.js').default>|null} */
let dialogCtorPromise = null;

/** @type {Promise<typeof import('../../../core/default/webassets/razyui/component/MarkdownHelpers.js')>|null} */
let markdownHelpersPromise = null;

/**
 * @param {string} key
 * @param {string} fallback
 */
function pt(key, fallback) {
    return oaaoT(key, fallback);
}

/**
 * @returns {string}
 */
function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

/**
 * @param {string} path
 */
function prefixed(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    const prefix = mountPrefix();
    return prefix ? `${prefix}${p}`.replace(/\/{2,}/g, '/') : p;
}

/**
 * @param {string} path
 */
export function stripApiUrl(path) {
    const base = `${mountPrefix()}/chat/api/strip`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

async function loadDialogCtor() {
    if (!dialogCtorPromise) {
        dialogCtorPromise = import(
            /* webpackIgnore: true */ prefixed('/webassets/core/default/razyui/component/Dialog.js'),
        ).then((m) => m.default);
    }
    return dialogCtorPromise;
}

async function loadMarkdownHelpers() {
    if (!markdownHelpersPromise) {
        markdownHelpersPromise = import(
            /* webpackIgnore: true */ prefixed('/webassets/core/default/razyui/component/MarkdownHelpers.js'),
        );
    }
    return markdownHelpersPromise;
}

/**
 * @param {HTMLElement} host
 * @param {string} message
 * @param {string} format
 */
/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeStripFenceItems(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {string[]} */
    const out = [];
    for (const row of raw) {
        let text = '';
        if (typeof row === 'string') text = row.trim();
        else if (row && typeof row === 'object') {
            const o = /** @type {Record<string, unknown>} */ (row);
            for (const key of ['text', 'title', 'label', 'memo']) {
                if (o[key] != null && String(o[key]).trim()) {
                    text = String(o[key]).trim();
                    break;
                }
            }
        }
        if (text) out.push(text.slice(0, 240));
        if (out.length >= 24) break;
    }
    return out;
}

/**
 * @param {string} agentKind
 * @returns {HTMLElement}
 */
function buildStripConfirmDialogTitle(agentKind) {
    const agent = String(agentKind ?? '').trim() || 'todo_extract';
    const row = document.createElement('div');
    row.className = 'flex items-center gap-1.5 min-w-0';
    row.append(resolveAgentIcon(agent));
    const label = document.createElement('span');
    label.className = 'truncate text-[0.95rem] fw-semibold leading-tight fg-[var(--grid-ink)]';
    label.textContent = resolveAgentLabel(agent);
    row.append(label);
    return row;
}

/**
 * @param {HTMLElement} host
 * @param {{ paragraphs: { role: string, text: string }[] }} copy
 */
function mountStripConfirmDialogBody(host, copy) {
    host.replaceChildren();
    host.className = 'oaao-strip-confirm-body min-w-0 flex flex-col gap-2.5';
    for (const block of copy.paragraphs) {
        const el = document.createElement('p');
        const role = String(block.role ?? 'line');
        if (role === 'caption') {
            el.className = 'm-0 text-[0.75rem] leading-snug fg-[var(--grid-caption)]';
        } else if (role === 'lead') {
            el.className = 'm-0 text-[0.875rem] leading-snug fw-semibold fg-[var(--grid-ink)]';
        } else {
            el.className = 'm-0 text-[0.8125rem] leading-relaxed fg-[var(--grid-ink)]';
        }
        el.textContent = String(block.text ?? '');
        host.append(el);
    }
}

async function renderStripPreviewBody(host, message, format) {
    const text = String(message ?? '').trim();
    host.replaceChildren();
    if (!text) {
        host.textContent = pt('productivity.strip.preview_empty', 'Confirm this action?');
        return;
    }
    const fmt = String(format || 'markdown').toLowerCase();
    if (fmt === 'html') {
        host.className = 'oaao-strip-preview oaao-md-bubble text-[0.875rem] min-w-0';
        host.innerHTML = text;
        return;
    }
    host.className = 'oaao-strip-preview oaao-md-bubble text-[0.875rem] min-w-0';
    try {
        const { parseSafe } = await loadMarkdownHelpers();
        host.innerHTML = parseSafe(text);
    } catch {
        host.textContent = text;
    }
}

/**
 * Normalize legacy meta_json / ui_stage keys into canonical strip items (no strip_hash yet).
 *
 * @param {Record<string, unknown> | null | undefined} meta
 * @returns {StripItem[]}
 */
export function normalizeStripItemsFromMeta(meta) {
    if (!meta || typeof meta !== 'object') return [];

    if (Array.isArray(meta.items) && meta.items.length > 0) {
        /** @type {StripItem[]} */
        const canonical = [];
        for (const row of meta.items) {
            if (row && typeof row === 'object') {
                canonical.push(/** @type {StripItem} */ (row));
            }
        }
        if (canonical.length > 0) return canonical;
    }

    /** @type {StripItem[]} */
    const items = [];

    const cal = meta.calendar_event_suggested;
    if (cal && typeof cal === 'object' && !isProductivityFenceKindResolved(meta, 'calendar')) {
        items.push({
            agent: 'calendar_schedule',
            action_id: 'calendar_event_suggested',
            description: String(/** @type {Record<string, unknown>} */ (cal).title || '').trim()
                || pt('productivity.calendar.add_prompt', 'Add to calendar?'),
            confirm_label: pt('productivity.calendar.add', 'Add to calendar'),
            confirmation: true,
            payload: cal,
        });
    }

    const todo = meta.todo_item_suggested;
    if (todo && typeof todo === 'object' && !isProductivityFenceKindResolved(meta, 'todo')) {
        items.push({
            agent: 'todo_extract',
            action_id: 'todo_item_suggested',
            description: pt('productivity.todo.add_prompt', 'Add to todos?'),
            confirm_label: pt('productivity.todo.add', 'Add to todos'),
            confirmation: true,
            payload: todo,
        });
    }

    const todoFenceMemo = String(meta.todo_items_fence_memo ?? '').trim();
    const todoFenceItems = normalizeStripFenceItems(meta.todo_items_fence_items);
    const todos = meta.todo_items_suggested;
    if (Array.isArray(todos) && todos.length >= 1 && !isProductivityFenceKindResolved(meta, 'todo')) {
        const n = todos.length;
        /** @type {Record<string, unknown>} */
        const payload = { items: todos };
        if (todoFenceMemo) payload.fence_memo = todoFenceMemo;
        if (todoFenceItems.length) payload.fence_items = todoFenceItems;
        items.push({
            agent: 'todo_extract',
            action_id: 'todo_items_suggested',
            description:
                n >= 2
                    ? pt('productivity.todo.add_many_prompt', 'Add {n} todos?').replace(
                          '{n}',
                          String(n),
                      )
                    : pt('productivity.todo.add_prompt', 'Add to todos?'),
            confirm_label: pt('productivity.todo.add', 'Add to todos'),
            confirmation: true,
            payload,
        });
    }

    const resolve = meta.todo_resolve_suggested;
    if (resolve && typeof resolve === 'object' && !isProductivityFenceKindResolved(meta, 'todo')) {
        items.push({
            agent: 'todo_extract',
            action_id: 'todo_resolve_suggested',
            description: pt('productivity.todo.resolve_prompt', 'Mark todos complete?'),
            confirm_label: pt('productivity.todo.resolve', 'Resolve'),
            confirmation: false,
            payload: resolve,
        });
    }

    return items.filter((item) => {
        const kind = stripActionToFenceKind(String(item.action_id ?? ''));
        return !kind || !isProductivityFenceKindResolved(meta, kind);
    });
}

/**
 * Strip item for an inline fence kind (calendar / todo).
 *
 * @param {Record<string, unknown> | null | undefined} meta
 * @param {'calendar' | 'todo'} kind
 * @returns {StripItem | null}
 */
export function findStripItemForFenceKind(meta, kind) {
    if (!meta || typeof meta !== 'object') return null;
    const items = normalizeStripItemsFromMeta(meta);
    /** @type {string[]} */
    const actionIds =
        kind === 'calendar'
            ? ['calendar_event_suggested']
            : ['todo_item_suggested', 'todo_items_suggested', 'todo_resolve_suggested'];
    for (const id of actionIds) {
        const hit = items.find((row) => String(row.action_id ?? '').trim() === id);
        if (hit) return hit;
    }
    return null;
}

/**
 * @param {HTMLElement | Document} queryRoot
 * @param {number} messageId
 * @param {StripItem} item
 */
function shouldSkipStripItemForFencePanel(queryRoot, messageId, item) {
    const kind = stripActionToFenceKind(String(item.action_id ?? ''));
    if (!kind) return false;
    const mid = Math.floor(Number(messageId));
    if (mid < 1) return false;
    const root = queryRoot instanceof HTMLElement || queryRoot instanceof Document ? queryRoot : document;
    const bubble =
        root.querySelector(`[data-oaao-msg-id="${mid}"][data-oaao-msg-role="assistant"]`) ??
        root.querySelector(`[data-oaao-msg-id="${mid}"]`);
    if (!(bubble instanceof HTMLElement)) return false;
    return Boolean(bubble.querySelector(`[data-oaao-productivity-fence="${kind}"]`));
}

/**
 * Confirm / dismiss row on an inline fence panel (same strip_hash API as [strip] chips).
 *
 * @param {HTMLElement} fenceHost
 * @param {StripItem} item
 * @param {number} conversationId
 * @param {number} messageId
 * @param {StripShellContext} [ctx]
 * @returns {HTMLElement | null}
 */
export function mountProductivityFenceStripActions(fenceHost, item, conversationId, messageId, ctx = {}) {
    if (!(fenceHost instanceof HTMLElement)) return null;
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    if (cid < 1 || mid < 1 || !item || typeof item !== 'object') return null;

    const agent = String(item.agent ?? '').trim() || 'productivity';
    const actionId = String(item.action_id ?? '').trim();
    const stripHash = String(item.strip_hash ?? '').trim();
    const confirmLabel =
        String(item.confirm_label ?? '').trim() || pt('productivity.strip.confirm', 'Confirm');
    const dismissLabel = String(item.dismiss_label ?? '').trim() || pt('productivity.dismiss', 'Dismiss');
    const confirmation = item.confirmation !== false && item.confirmation !== 'false';
    const previewMessage = String(item.message ?? '').trim();
    const messageFormat = String(item.message_format ?? 'markdown').trim() || 'markdown';

    const queryRoot = chatStripQueryRoot(ctx.mountEl ?? document);
    const existing = actionId ? queryStripChip(queryRoot, mid, actionId) : null;
    if (existing instanceof HTMLElement && existing.closest('[data-oaao-chat-area="strip"]')) {
        existing.remove();
    }

    fenceHost.querySelector('[data-oaao-productivity-fence-actions]')?.remove();

    const actions = document.createElement('div');
    actions.className = 'oaao-productivity-fence-actions';
    if (actionId) actions.dataset.oaaoProductivityFenceActions = actionId;
    actions.dataset.oaaoStripChip = '1';
    actions.dataset.oaaoStripAgent = agent;
    actions.dataset.oaaoStripAction = actionId;
    actions.dataset.oaaoConversationId = String(cid);
    actions.dataset.oaaoMessageId = String(mid);
    if (stripHash) actions.dataset.oaaoStripHash = stripHash;
    actions.dataset.oaaoStripConfirmation = confirmation ? '1' : '0';
    if (previewMessage) actions.dataset.oaaoStripMessage = previewMessage;
    actions.dataset.oaaoStripMessageFormat = messageFormat;
    if (item.payload && typeof item.payload === 'object') {
        try {
            actions.dataset.oaaoStripPayload = JSON.stringify(item.payload);
        } catch {
            /* ignore */
        }
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.dataset.oaaoStripDismiss = '1';
    dismissBtn.className = 'oaao-productivity-fence-dismiss';
    dismissBtn.setAttribute('aria-label', dismissLabel);
    dismissBtn.textContent = '✕';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.dataset.oaaoStripConfirm = '1';
    confirmBtn.className = 'oaao-productivity-fence-confirm';
    confirmBtn.textContent = confirmLabel;
    if (!confirmation) {
        confirmBtn.hidden = true;
        confirmBtn.setAttribute('aria-hidden', 'true');
    }

    actions.append(dismissBtn, confirmBtn);
    fenceHost.append(actions);

    wireStripChipButtonHandlers(actions, item);
    syncStripChipReadyState(actions);

    if (!stripHash && typeof ctx.ensureInfoWorkerPoll === 'function') {
        ctx.ensureInfoWorkerPoll(cid, mid);
    }

    return actions;
}

/**
 * Dedupe key for strip chips (prefer server {@code strip_hash}; else stable cid/mid scope).
 *
 * @param {StripItem} item
 * @param {number} [conversationId]
 * @param {number} [messageId]
 * @returns {string}
 */
function stripItemHash(item, conversationId = 0, messageId = 0) {
    const h = String(item.strip_hash ?? '').trim();
    if (h) return h;
    const agent = String(item.agent ?? item.action_id ?? 'strip');
    const action = String(item.action_id ?? 'action');
    const cid = Math.floor(Number(item.conversation_id ?? conversationId));
    const mid = Math.floor(Number(item.message_id ?? messageId));
    return `${agent}:${action}:${cid}:${mid}`;
}

/**
 * @param {string} agentKind
 */
function resolveAgentLabel(agentKind) {
    const kind = String(agentKind ?? '').trim() || 'todo_extract';
    const entry = getOaaoAgentCatalogEntry(kind);
    if (entry) return pt(entry.labelKey, entry.fallbackLabel);
    if (kind === 'calendar_schedule') return pt('settings.planner.agent.calendar_schedule', 'Calendar');
    return pt('settings.planner.agent.todo_extract', 'Todos');
}

/**
 * @param {string} agentKind
 */
function resolveAgentIcon(agentKind) {
    const wrap = document.createElement('span');
    wrap.className = 'oaao-strip-chip__icon-svg inline-flex shrink-0 items-center justify-center';
    const lucide = STRIP_LUCIDE_BY_AGENT[String(agentKind ?? '').trim()];
    if (lucide) {
        mountRuiIconSync(wrap, lucide, { size: 14, strokeWidth: 2, class: 'oaao-strip-chip__icon-svg-inner' });
        return wrap;
    }
    const entry = getOaaoAgentCatalogEntry(agentKind);
    if (entry?.icon) {
        wrap.innerHTML = entry.icon;
        return wrap;
    }
    const fallback = document.createElement('span');
    fallback.className = 'oaao-strip-chip__icon-fallback shrink-0 size-3.5 rounded-full bg-[var(--grid-line)]';
    fallback.setAttribute('aria-hidden', 'true');
    return fallback;
}

/**
 * @param {StripItem} item
 * @param {number} conversationId
 * @param {number} messageId
 * @returns {HTMLElement}
 */
export function createStripChipElement(item, conversationId, messageId) {
    const agent = String(item.agent ?? '').trim() || 'productivity';
    const actionId = String(item.action_id ?? '').trim();
    const cid = Math.floor(Number(item.conversation_id ?? conversationId));
    const mid = Math.floor(Number(item.message_id ?? messageId));
    const stripHash = String(item.strip_hash ?? '').trim();
    const description =
        String(item.description ?? '').trim() ||
        pt('productivity.strip.prompt', 'Suggested action');
    const confirmLabel =
        String(item.confirm_label ?? '').trim() ||
        pt('productivity.strip.confirm', 'Confirm');
    const dismissLabel = String(item.dismiss_label ?? '').trim() || pt('productivity.dismiss', 'Dismiss');
    const confirmation = item.confirmation !== false && item.confirmation !== 'false';
    const previewMessage = String(item.message ?? '').trim();
    const messageFormat = String(item.message_format ?? 'markdown').trim() || 'markdown';

    const chip = document.createElement('div');
    chip.dataset.oaaoStripChip = '1';
    chip.dataset.oaaoStripAgent = agent;
    chip.dataset.oaaoStripAction = actionId;
    chip.dataset.oaaoConversationId = String(cid);
    chip.dataset.oaaoMessageId = String(mid);
    if (stripHash) chip.dataset.oaaoStripHash = stripHash;
    chip.dataset.oaaoStripConfirmation = confirmation ? '1' : '0';
    if (previewMessage) chip.dataset.oaaoStripMessage = previewMessage;
    chip.dataset.oaaoStripMessageFormat = messageFormat;
    if (item.payload && typeof item.payload === 'object') {
        try {
            chip.dataset.oaaoStripPayload = JSON.stringify(item.payload);
        } catch {
            /* ignore */
        }
    }
    chip.className = `oaao-strip-chip oaao-strip-chip--${agent.replace(/[^a-z0-9_-]/gi, '_')} inline-flex items-center gap-1.5 min-w-0 w-full max-w-full rounded-lg border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-2 py-1.5`;

    const icon = document.createElement('span');
    icon.dataset.oaaoStripIcon = '1';
    icon.className = 'oaao-strip-chip__icon shrink-0 self-center';
    icon.append(resolveAgentIcon(agent));

    const textCol = document.createElement('div');
    textCol.className =
        'oaao-strip-chip__text min-w-0 flex-1 flex flex-col gap-0.5 overflow-hidden';

    const agentLabel = document.createElement('span');
    agentLabel.dataset.oaaoStripAgentLabel = '1';
    agentLabel.className =
        'block min-w-0 truncate text-[0.6875rem] fw-medium leading-tight fg-[var(--grid-caption)] whitespace-nowrap';
    agentLabel.textContent = resolveAgentLabel(agent);

    const desc = document.createElement('span');
    desc.dataset.oaaoStripDesc = '1';
    desc.className =
        'oaao-strip-chip__desc block min-w-0 truncate text-[0.75rem] leading-snug fg-[var(--grid-ink)] whitespace-nowrap';
    desc.textContent = description;
    desc.title = description;

    textCol.append(agentLabel, desc);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.dataset.oaaoStripDismiss = '1';
    dismissBtn.className =
        'oaao-strip-chip__dismiss relative z-[1] shrink-0 rounded-[6px] h-6 w-6 border-none bg-transparent fg-[var(--grid-caption)] cursor-pointer font-inherit text-[0.875rem] leading-none pointer-events-auto';
    dismissBtn.setAttribute('aria-label', dismissLabel);
    dismissBtn.textContent = '✕';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.dataset.oaaoStripConfirm = '1';
    confirmBtn.className =
        'oaao-strip-chip__confirm relative z-[1] shrink-0 rounded-[6px] h-6 px-2 text-[0.6875rem] fw-medium whitespace-nowrap border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit pointer-events-auto';
    confirmBtn.textContent = confirmLabel;
    if (!confirmation) {
        confirmBtn.hidden = true;
        confirmBtn.setAttribute('aria-hidden', 'true');
    }

    chip.append(icon, textCol, dismissBtn, confirmBtn);
    wireStripChipButtonHandlers(chip, item);
    syncStripChipReadyState(chip);
    return chip;
}

/**
 * Direct button handlers — reliable even when strip delegation ctx was bound early without refresh hooks.
 *
 * @param {HTMLElement} chip
 * @param {StripItem} [item]
 */
function wireStripChipButtonHandlers(chip, item = {}) {
    const dismissBtn = chip.querySelector('[data-oaao-strip-dismiss]');
    if (dismissBtn instanceof HTMLButtonElement && dismissBtn.dataset.oaaoStripWired !== '1') {
        dismissBtn.dataset.oaaoStripWired = '1';
        dismissBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void dismissStripChip(chip, resolveStripShellCtx(chip, {}));
        });
    }

    const confirmBtn = chip.querySelector('[data-oaao-strip-confirm]');
    if (confirmBtn instanceof HTMLButtonElement && confirmBtn.dataset.oaaoStripWired !== '1') {
        confirmBtn.dataset.oaaoStripWired = '1';
        confirmBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void confirmStripChip(chip, parseStripItemFromChip(chip, item), resolveStripShellCtx(chip, {}));
        });
    }
}

/**
 * @param {HTMLElement} chip
 */
function syncStripChipReadyState(chip) {
    const hash = String(chip.dataset.oaaoStripHash ?? '').trim();
    const needsConfirm = chip.dataset.oaaoStripConfirmation !== '0';
    chip.dataset.oaaoStripReady = hash ? '1' : '0';
    const confirmBtn = chip.querySelector('[data-oaao-strip-confirm]');
    if (confirmBtn instanceof HTMLButtonElement && needsConfirm) {
        confirmBtn.disabled = false;
        confirmBtn.classList.toggle('opacity-80', !hash);
        confirmBtn.dataset.oaaoStripAwaitingHash = hash ? '' : '1';
        confirmBtn.title = hash
            ? ''
            : pt('productivity.strip.wait_ready', 'Still preparing — try again in a moment.');
    }
}

/**
 * @param {HTMLElement} chip
 * @param {StripShellContext} [ctx]
 * @param {number} [maxMs]
 */
async function waitForStripHash(chip, ctx = {}, maxMs = 14000) {
    if (String(chip.dataset.oaaoStripHash ?? '').trim()) return true;

    const shellCtx = resolveStripShellCtx(chip, ctx);
    const cid = Math.floor(Number(chip.dataset.oaaoConversationId ?? 0));
    const mid = Math.floor(Number(chip.dataset.oaaoMessageId ?? 0));
    if (cid < 1 || mid < 1) return false;

    if (typeof shellCtx.ensureInfoWorkerPoll === 'function') {
        shellCtx.ensureInfoWorkerPoll(cid, mid);
    }

    const refresh = shellCtx.refreshStripFromInfoWorker;
    if (typeof refresh !== 'function') return false;

    const started = Date.now();
    const stepMs = 450;
    while (Date.now() - started < maxMs) {
        if (String(chip.dataset.oaaoStripHash ?? '').trim()) return true;
        try {
            await refresh(cid, mid);
        } catch {
            /* ignore */
        }
        if (String(chip.dataset.oaaoStripHash ?? '').trim()) return true;
        await new Promise((resolve) => {
            setTimeout(resolve, stepMs);
        });
    }
    return Boolean(String(chip.dataset.oaaoStripHash ?? '').trim());
}

/**
 * Merge server-signed strip fields onto a chip mounted earlier from client meta (no hash yet).
 *
 * @param {HTMLElement} chip
 * @param {StripItem} item
 */
function upgradeStripChipFromItem(chip, item) {
    const stripHash = String(item.strip_hash ?? '').trim();
    if (stripHash) {
        chip.dataset.oaaoStripHash = stripHash;
    }

    const agent = String(item.agent ?? chip.dataset.oaaoStripAgent ?? '').trim();
    if (agent) {
        chip.dataset.oaaoStripAgent = agent;
        const agentLabel = chip.querySelector('[data-oaao-strip-agent-label]');
        if (agentLabel instanceof HTMLElement) {
            agentLabel.textContent = resolveAgentLabel(agent);
        }
    }

    const description = String(item.description ?? '').trim();
    if (description) {
        const desc = chip.querySelector('[data-oaao-strip-desc]');
        if (desc instanceof HTMLElement) {
            desc.textContent = description;
            desc.title = description;
        }
    }

    const previewMessage = String(item.message ?? '').trim();
    if (previewMessage) {
        chip.dataset.oaaoStripMessage = previewMessage;
    }
    const messageFormat = String(item.message_format ?? '').trim();
    if (messageFormat) {
        chip.dataset.oaaoStripMessageFormat = messageFormat;
    }

    const confirmation = item.confirmation !== false && item.confirmation !== 'false';
    chip.dataset.oaaoStripConfirmation = confirmation ? '1' : '0';
    const confirmBtn = chip.querySelector('[data-oaao-strip-confirm]');
    if (confirmBtn instanceof HTMLButtonElement) {
        const confirmLabel = String(item.confirm_label ?? '').trim();
        if (confirmLabel) confirmBtn.textContent = confirmLabel;
        confirmBtn.hidden = !confirmation;
        confirmBtn.toggleAttribute('aria-hidden', !confirmation);
    }

    if (item.payload && typeof item.payload === 'object') {
        try {
            chip.dataset.oaaoStripPayload = JSON.stringify(item.payload);
        } catch {
            /* ignore */
        }
    }

    syncStripChipReadyState(chip);
    wireStripChipButtonHandlers(chip, item);
}

/**
 * @param {HTMLElement} chip
 * @param {StripItem} [item]
 */
export function parseStripItemFromChip(chip, item = {}) {
    /** @type {StripItem} */
    const parsed = { ...item };
    parsed.agent = chip.dataset.oaaoStripAgent ?? parsed.agent;
    parsed.action_id = chip.dataset.oaaoStripAction ?? parsed.action_id;
    parsed.conversation_id = Number(chip.dataset.oaaoConversationId ?? parsed.conversation_id);
    parsed.message_id = Number(chip.dataset.oaaoMessageId ?? parsed.message_id);
    parsed.strip_hash = chip.dataset.oaaoStripHash ?? parsed.strip_hash;
    parsed.confirmation = chip.dataset.oaaoStripConfirmation !== '0';
    parsed.message = chip.dataset.oaaoStripMessage ?? parsed.message;
    parsed.message_format = chip.dataset.oaaoStripMessageFormat ?? parsed.message_format ?? 'markdown';
    const raw = String(chip.dataset.oaaoStripPayload ?? '').trim();
    if (raw) {
        try {
            const payload = JSON.parse(raw);
            if (payload && typeof payload === 'object') parsed.payload = payload;
        } catch {
            /* ignore */
        }
    }
    return parsed;
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} body
 */
export async function fetchStripDismiss(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        /* ignore */
    }
    return { res, data };
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} body
 */
export async function fetchStripConfirm(url, body) {
    return fetchStripDismiss(url, body);
}

/**
 * @param {HTMLElement} chip
 * @param {StripShellContext} [ctx]
 */
export async function dismissStripChip(chip, ctx = {}) {
    const shellCtx = resolveStripShellCtx(chip, ctx);
    const hash = String(chip.dataset.oaaoStripHash ?? '').trim();
    if (!hash) {
        applyStripResolvedUi(chip, shellCtx, 'dismissed');
        return { ok: true, skipped: true };
    }

    const fetchJson = shellCtx.fetchJson ?? fetchStripDismiss;
    const scope = typeof shellCtx.scopeFields === 'function' ? shellCtx.scopeFields() : {};
    const { res, data } = await fetchJson(stripApiUrl('dismiss'), { strip_hash: hash, ...scope });
    const body = data && typeof data === 'object' ? data : {};
    if (!res.ok || body.success !== true) {
        return { ok: false, data: body };
    }
    applyStripResolvedUi(chip, shellCtx, 'dismissed');
    return { ok: true, data: body };
}

/**
 * @param {HTMLElement} chip
 * @param {StripItem} item
 * @param {StripShellContext} [ctx]
 */
async function postStripConfirm(chip, item, ctx = {}) {
    const shellCtx = resolveStripShellCtx(chip, ctx);
    const merged = parseStripItemFromChip(chip, item);
    let hash = String(merged.strip_hash ?? chip.dataset.oaaoStripHash ?? '').trim();
    if (!hash) {
        const ready = await waitForStripHash(chip, shellCtx);
        hash = String(chip.dataset.oaaoStripHash ?? '').trim();
        if (!ready || !hash) {
            fireStripWaitReadyToast();
            return { ok: false, reason: 'missing_hash' };
        }
        merged.strip_hash = hash;
    }
    const scope = typeof shellCtx.scopeFields === 'function' ? shellCtx.scopeFields() : {};
    const { res, data } = await fetchStripConfirm(stripApiUrl('confirm'), { strip_hash: hash, ...scope });
    const body = data && typeof data === 'object' ? data : {};
    const apiOk = res.ok && body.success === true;
    if (!apiOk) {
        const msg =
            typeof body.message === 'string' && body.message.trim()
                ? body.message.trim()
                : pt('productivity.strip.confirm_failed', 'Could not complete this action.');
        void fireStripToast(msg, 'error');
        return { ok: false, data: body };
    }

    const actionId = String(merged.action_id ?? chip.dataset.oaaoStripAction ?? '').trim();
    applyStripResolvedUi(chip, shellCtx, 'confirmed');

    if (actionId.includes('calendar')) {
        document.dispatchEvent(new CustomEvent('oaao:calendar-changed'));
    }
    if (actionId.startsWith('todo_')) {
        document.dispatchEvent(new CustomEvent('oaao:todos-changed'));
        if (typeof shellCtx.onTodoResolve === 'function') {
            shellCtx.onTodoResolve();
        }
    }

    const idempotent = Boolean(body.idempotent);
    void fireStripToast(
        idempotent
            ? pt('productivity.strip.already_done', 'Already added.')
            : actionId.startsWith('todo_')
              ? pt('productivity.strip.todos_added', 'Todos added.')
              : pt('productivity.strip.calendar_added', 'Added to calendar.'),
        'success',
    );

    return { ok: true, data: body, idempotent };
}

/**
 * @param {HTMLElement} chip
 * @param {StripItem} item
 * @param {StripShellContext} [ctx]
 */
async function runStripConfirm(chip, item, ctx = {}) {
    const result = await postStripConfirm(chip, parseStripItemFromChip(chip, item), ctx);
    if (!result.ok && result.reason === 'missing_hash') {
        fireStripWaitReadyToast();
    }
    return result;
}

/**
 * @param {HTMLElement} chip
 * @param {StripItem} item
 * @param {StripShellContext} [ctx]
 */
async function showStripPreviewDialog(chip, item, ctx = {}) {
    const Dialog = await loadDialogCtor();
    const merged = parseStripItemFromChip(chip, item);
    const body = document.createElement('div');
    body.className = 'min-w-0';

    const dialogCopy = buildStripConfirmDialogCopy(merged);
    const agentKind = String(dialogCopy?.agent ?? merged.agent ?? '').trim();
    if (dialogCopy) {
        mountStripConfirmDialogBody(body, dialogCopy);
    } else {
        await renderStripPreviewBody(
            body,
            String(merged.message ?? ''),
            String(merged.message_format ?? 'markdown'),
        );
    }

    const confirmLabel =
        String(item.confirm_label ?? '').trim() ||
        chip.querySelector('[data-oaao-strip-confirm]')?.textContent?.trim() ||
        pt('productivity.strip.confirm', 'Confirm');

    void new Dialog({
        title: dialogCopy ? buildStripConfirmDialogTitle(agentKind) : pt('productivity.strip.preview_title', 'Confirm action'),
        content: body,
        size: 'md',
        closable: true,
        buttons: [
            { text: pt('productivity.common.cancel', 'Cancel'), color: 'muted', role: 'cancel' },
            {
                text: confirmLabel,
                color: 'accent',
                close: false,
                action: async (ctrl) => {
                    const result = await runStripConfirm(chip, merged, ctx);
                    if (result.ok && typeof ctrl?.close === 'function') {
                        ctrl.close();
                    }
                },
            },
        ],
    });
}

/**
 * @param {HTMLElement} chip
 * @param {StripItem} item
 * @param {StripShellContext} [ctx]
 */
export async function confirmStripChip(chip, item, ctx = {}) {
    const shellCtx = resolveStripShellCtx(chip, ctx);
    if (typeof shellCtx.onConfirm === 'function') {
        await shellCtx.onConfirm(chip, item);
        return { ok: true, delegated: true };
    }

    const merged = parseStripItemFromChip(chip, item);
    const needsPreview =
        merged.confirmation !== false &&
        merged.confirmation !== 'false' &&
        String(merged.message ?? '').trim() !== '';

    if (needsPreview) {
        if (!String(chip.dataset.oaaoStripHash ?? merged.strip_hash ?? '').trim()) {
            const ready = await waitForStripHash(chip, shellCtx);
            if (!ready) {
                fireStripWaitReadyToast();
                return { ok: false, reason: 'missing_hash' };
            }
        }
        await showStripPreviewDialog(chip, parseStripItemFromChip(chip, merged), shellCtx);
        return { ok: true, preview: true };
    }

    return runStripConfirm(chip, merged, shellCtx);
}

/**
 * @param {HTMLElement} stripRoot
 * @param {StripShellContext} [ctx]
 */
export function bindStripChipDelegation(stripRoot, ctx = {}) {
    if (!(stripRoot instanceof HTMLElement)) return;
    const prev = stripShellCtxByRoot.get(stripRoot) ?? {};
    stripShellCtxByRoot.set(stripRoot, { ...prev, ...ctx });
    if (stripRoot.dataset.oaaoStripDelegation === '1') return;
    stripRoot.dataset.oaaoStripDelegation = '1';

    stripRoot.addEventListener('click', (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const chip = target.closest('[data-oaao-strip-chip]');
        if (!(chip instanceof HTMLElement) || !stripRoot.contains(chip)) return;
        const shellCtx = resolveStripShellCtx(chip, stripShellCtxByRoot.get(stripRoot) ?? {});

        if (target.closest('[data-oaao-strip-dismiss]')) {
            ev.preventDefault();
            ev.stopPropagation();
            void dismissStripChip(chip, shellCtx);
            return;
        }

        if (target.closest('[data-oaao-strip-confirm]')) {
            ev.preventDefault();
            ev.stopPropagation();
            void confirmStripChip(chip, parseStripItemFromChip(chip), shellCtx);
        }
    });
}

/**
 * Ensure `[data-oaao-chat-area="strip"]` exists on the assistant row.
 *
 * @param {HTMLElement} outer
 * @returns {HTMLElement | null}
 */
const STRIP_HOST_CLASS =
    'oaao-chat-area oaao-chat-area--strip grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 w-full min-w-0 max-w-full';

function ensureStripHost(outer) {
    let strip = outer.querySelector('[data-oaao-chat-area="strip"]');
    if (strip instanceof HTMLElement) {
        strip.className = STRIP_HOST_CLASS;
        return strip;
    }

    strip = document.createElement('div');
    strip.dataset.oaaoChatArea = 'strip';
    strip.dataset.oaaoChat = 'action-strip';
    strip.className = STRIP_HOST_CLASS;
    const toolbar = outer.querySelector('.oaao-chat-assistant-toolbar');
    if (toolbar instanceof HTMLElement) {
        outer.insertBefore(strip, toolbar);
    } else {
        outer.append(strip);
    }
    return strip;
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} messageId
 * @param {string} actionId
 */
export function queryStripChip(mount, messageId, actionId) {
    const mid = Math.floor(Number(messageId));
    const action = String(actionId ?? '').trim();
    if (mid < 1 || !action) return null;
    const root = mount instanceof HTMLElement || mount instanceof Document ? mount : document;
    const chip = root.querySelector(
        `[data-oaao-strip-chip][data-oaao-message-id="${mid}"][data-oaao-strip-action="${action}"]`,
    );
    return chip instanceof HTMLElement ? chip : null;
}

/**
 * @param {HTMLElement | Document} mount
 * @returns {HTMLElement | Document}
 */
export function chatStripQueryRoot(mount) {
    if (mount instanceof HTMLElement && mount.matches('[data-module="oaao-chat"]')) {
        return mount;
    }
    if (mount instanceof HTMLElement) {
        const closest = mount.closest('[data-module="oaao-chat"]');
        if (closest instanceof HTMLElement) return closest;
    }
    const docRoot = document.querySelector('[data-module="oaao-chat"]');
    return docRoot instanceof HTMLElement ? docRoot : mount instanceof HTMLElement || mount instanceof Document ? mount : document;
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} conversationId
 * @param {{ exceptMessageId?: number | null }} [opts]
 * @returns {HTMLElement[]}
 */
export function collectStripChipsInConversation(mount, conversationId, opts = {}) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return [];
    const exceptMid =
        opts.exceptMessageId != null && Number.isFinite(Number(opts.exceptMessageId))
            ? Math.floor(Number(opts.exceptMessageId))
            : null;
    const root = chatStripQueryRoot(mount);
    const nodes = root.querySelectorAll(`[data-oaao-strip-chip][data-oaao-conversation-id="${cid}"]`);
    /** @type {HTMLElement[]} */
    const chips = [];
    nodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const mid = Math.floor(Number(node.dataset.oaaoMessageId ?? 0));
        if (exceptMid != null && exceptMid > 0 && mid === exceptMid) return;
        chips.push(node);
    });
    return chips;
}

/**
 * Remove chip from DOM immediately; persist dismiss when {@code strip_hash} is set.
 *
 * @param {HTMLElement} chip
 * @param {StripShellContext} [ctx]
 */
export function dismissStripChipImmediate(chip, ctx = {}) {
    const hash = String(chip.dataset.oaaoStripHash ?? '').trim();
    chip.remove();
    if (!hash) return;
    const fetchJson = ctx.fetchJson ?? fetchStripDismiss;
    const scope = typeof ctx.scopeFields === 'function' ? ctx.scopeFields() : {};
    void fetchJson(stripApiUrl('dismiss'), { strip_hash: hash, ...scope }).catch(() => {});
}

/**
 * @param {HTMLElement | Document} mount
 * @param {number} conversationId
 * @param {StripShellContext} [ctx]
 */
export function dismissAllStripChipsInConversation(mount, conversationId, ctx = {}) {
    for (const chip of collectStripChipsInConversation(mount, conversationId)) {
        dismissStripChipImmediate(chip, ctx);
    }
}

/**
 * Keep strip chips only on {@code keepMessageId}; dismiss others in the same conversation.
 *
 * @param {HTMLElement | Document} mount
 * @param {number} conversationId
 * @param {number} keepMessageId
 * @param {StripShellContext} [ctx]
 */
export function pruneStripChipsExceptMessage(mount, conversationId, keepMessageId, ctx = {}) {
    const keepMid = Math.floor(Number(keepMessageId));
    if (keepMid < 1) return;
    for (const chip of collectStripChipsInConversation(mount, conversationId, { exceptMessageId: keepMid })) {
        dismissStripChipImmediate(chip, ctx);
    }
}

/**
 * Mount normalized strip items into [strip] area (dedupe by strip_hash).
 *
 * @param {HTMLElement} outer Assistant row (`.oaao-chat-assistant-row`)
 * @param {StripItem[]} items
 * @param {number} conversationId
 * @param {number} messageId
 * @param {StripShellContext} [ctx]
 */
export function mountStripItems(outer, items, conversationId, messageId, ctx = {}) {
    if (!(outer instanceof HTMLElement)) return;
    const cid = Math.floor(Number(conversationId));
    const mid = Math.floor(Number(messageId));
    if (cid < 1 || mid < 1 || !Array.isArray(items) || items.length < 1) return;

    const lastMid =
        ctx.lastAssistantMessageId != null && Number.isFinite(Number(ctx.lastAssistantMessageId))
            ? Math.floor(Number(ctx.lastAssistantMessageId))
            : null;
    if (ctx.onlyMountOnLastAssistant === true && lastMid != null && lastMid > 0 && mid !== lastMid) {
        return;
    }

    const shouldPrune =
        ctx.pruneOtherStripMessages === true ||
        (lastMid != null && lastMid > 0 && mid === lastMid);
    if (shouldPrune) {
        const pruneRoot =
            ctx.mountEl instanceof HTMLElement || ctx.mountEl instanceof Document
                ? ctx.mountEl
                : outer;
        pruneStripChipsExceptMessage(pruneRoot, cid, mid, ctx);
    }

    let strip = ensureStripHost(outer);
    if (!(strip instanceof HTMLElement)) return;

    bindStripChipDelegation(strip, ctx);

    /** @type {Map<string, HTMLElement>} */
    const keepByAction = new Map();
    strip.querySelectorAll('[data-oaao-strip-chip]').forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (Math.floor(Number(node.dataset.oaaoMessageId ?? 0)) !== mid) return;
        const action = String(node.dataset.oaaoStripAction ?? '').trim();
        if (!action) return;
        const prev = keepByAction.get(action);
        if (prev instanceof HTMLElement) {
            node.remove();
            return;
        }
        keepByAction.set(action, node);
    });

    const queryRoot =
        ctx.mountEl instanceof HTMLElement || ctx.mountEl instanceof Document
            ? ctx.mountEl
            : outer;

    /** @type {Set<string>} */
    const seen = new Set();
    strip.querySelectorAll('[data-oaao-strip-chip]').forEach((node) => {
        if (node instanceof HTMLElement) {
            seen.add(
                stripItemHash(
                    {
                        strip_hash: node.dataset.oaaoStripHash,
                        action_id: node.dataset.oaaoStripAction,
                        agent: node.dataset.oaaoStripAgent,
                        conversation_id: node.dataset.oaaoConversationId,
                        message_id: node.dataset.oaaoMessageId,
                    },
                    cid,
                    mid,
                ),
            );
        }
    });

    for (const item of items) {
        const actionId = String(item.action_id ?? '').trim();
        if (actionId && isStripActionResolved(cid, mid, actionId)) {
            continue;
        }
        if (shouldSkipStripItemForFencePanel(queryRoot, mid, item)) {
            const inlineChip = actionId ? queryStripChip(queryRoot, mid, actionId) : null;
            if (inlineChip instanceof HTMLElement) {
                upgradeStripChipFromItem(inlineChip, item);
                continue;
            }
            const kind = stripActionToFenceKind(actionId);
            if (kind) {
                const bubble =
                    queryRoot.querySelector(`[data-oaao-msg-id="${mid}"][data-oaao-msg-role="assistant"]`) ??
                    queryRoot.querySelector(`[data-oaao-msg-id="${mid}"]`);
                const fenceBox = bubble?.querySelector(`[data-oaao-productivity-fence="${kind}"]`);
                if (fenceBox instanceof HTMLElement) {
                    mountProductivityFenceStripActions(fenceBox, item, cid, mid, ctx);
                    continue;
                }
            }
        }
        const existing = actionId ? queryStripChip(queryRoot, mid, actionId) : null;
        if (existing instanceof HTMLElement) {
            upgradeStripChipFromItem(existing, item);
            seen.add(stripItemHash(item, cid, mid));
            continue;
        }

        const key = stripItemHash(item, cid, mid);
        if (seen.has(key)) continue;
        seen.add(key);

        const chip = createStripChipElement(item, cid, mid);
        if (!String(item.strip_hash ?? '').trim() && typeof ctx.ensureInfoWorkerPoll === 'function') {
            ctx.ensureInfoWorkerPoll(cid, mid);
        }
        mountProductivityChip(outer, chip);
    }
    reorderAssistantRowAreas(outer);
}

/**
 * @param {HTMLElement} outer
 * @param {Record<string, unknown>} envelope ui_stage strip payload or legacy meta
 * @param {number} conversationId
 * @param {number} messageId
 * @param {StripShellContext} [ctx]
 */
export function mountStripFromEnvelope(outer, envelope, conversationId, messageId, ctx = {}) {
    const items = normalizeStripItemsFromMeta(envelope);
    mountStripItems(outer, items, conversationId, messageId, ctx);
}

/** One-time document-level delegation — refresh strip ctx before bubble handlers run. */
export function ensureGlobalStripDelegation(ctx = {}) {
    if (dismissDelegationBound || typeof document === 'undefined') return;
    dismissDelegationBound = true;
    document.addEventListener(
        'click',
        (ev) => {
            const target = ev.target;
            if (!(target instanceof HTMLElement)) return;
            const chip = target.closest('[data-oaao-strip-chip]');
            if (!(chip instanceof HTMLElement)) return;
            const strip = chip.closest('[data-oaao-chat-area="strip"]');
            if (!(strip instanceof HTMLElement)) return;
            bindStripChipDelegation(strip, resolveStripShellCtx(chip, ctx));
        },
        true,
    );
}

export default {
    mountStripItems,
    mountStripFromEnvelope,
    normalizeStripItemsFromMeta,
    createStripChipElement,
    dismissStripChip,
    dismissStripChipImmediate,
    dismissAllStripChipsInConversation,
    pruneStripChipsExceptMessage,
    collectStripChipsInConversation,
    confirmStripChip,
    stripApiUrl,
    fetchStripDismiss,
    fetchStripConfirm,
};
