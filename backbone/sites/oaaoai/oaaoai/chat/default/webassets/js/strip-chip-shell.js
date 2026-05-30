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
import { mountProductivityChip } from './productivity-strip-host.js';

/** @typedef {Record<string, unknown>} StripItem */

/** @typedef {{ fetchJson?: typeof fetchStripDismiss, scopeFields?: () => Record<string, unknown>, onTodoResolve?: () => void }} StripShellContext */

/** @type {boolean} */
let dismissDelegationBound = false;

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
    if (cal && typeof cal === 'object') {
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
    if (todo && typeof todo === 'object') {
        items.push({
            agent: 'todo_extract',
            action_id: 'todo_item_suggested',
            description: pt('productivity.todo.add_prompt', 'Add to todos?'),
            confirm_label: pt('productivity.todo.add', 'Add to todos'),
            confirmation: true,
            payload: todo,
        });
    }

    const todos = meta.todo_items_suggested;
    if (Array.isArray(todos) && todos.length >= 2) {
        items.push({
            agent: 'todo_extract',
            action_id: 'todo_items_suggested',
            description: pt('productivity.todo.add_many_prompt', 'Add todos?').replace(
                '{n}',
                String(todos.length),
            ),
            confirm_label: pt('productivity.todo.add', 'Add to todos'),
            confirmation: true,
            payload: { items: todos },
        });
    }

    const resolve = meta.todo_resolve_suggested;
    if (resolve && typeof resolve === 'object') {
        items.push({
            agent: 'todo_extract',
            action_id: 'todo_resolve_suggested',
            description: pt('productivity.todo.resolve_prompt', 'Mark todos complete?'),
            confirm_label: pt('productivity.todo.resolve', 'Resolve'),
            confirmation: false,
            payload: resolve,
        });
    }

    return items;
}

/**
 * @param {StripItem} item
 * @returns {string}
 */
function stripItemHash(item) {
    const h = String(item.strip_hash ?? '').trim();
    if (h) return h;
    const agent = String(item.agent ?? item.action_id ?? 'strip');
    const action = String(item.action_id ?? 'action');
    const cid = String(item.conversation_id ?? '');
    const mid = String(item.message_id ?? '');
    return `${agent}:${action}:${cid}:${mid}`;
}

/**
 * @param {string} agentKind
 */
function resolveAgentIcon(agentKind) {
    const entry = getOaaoAgentCatalogEntry(agentKind);
    if (entry?.icon) {
        const wrap = document.createElement('span');
        wrap.className = 'oaao-strip-chip__icon-svg inline-flex shrink-0 size-4';
        wrap.innerHTML = entry.icon;
        return wrap;
    }
    const fallback = document.createElement('span');
    fallback.className = 'oaao-strip-chip__icon-fallback shrink-0 size-4 rounded-full bg-[var(--grid-line)]';
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
    chip.className = `oaao-strip-chip oaao-strip-chip--${agent.replace(/[^a-z0-9_-]/gi, '_')} flex flex-wrap items-center gap-2 w-full min-w-0 rounded-xl border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-3 py-2`;

    const icon = document.createElement('span');
    icon.dataset.oaaoStripIcon = '1';
    icon.className = 'oaao-strip-chip__icon shrink-0';
    icon.append(resolveAgentIcon(agent));

    const desc = document.createElement('span');
    desc.dataset.oaaoStripDesc = '1';
    desc.className = 'oaao-strip-chip__desc flex-1 min-w-0 text-[0.8125rem] fg-[var(--grid-ink)] truncate';
    desc.textContent = description;
    desc.title = description;

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.dataset.oaaoStripDismiss = '1';
    dismissBtn.className =
        'oaao-strip-chip__dismiss rounded-[8px] h-8 w-8 shrink-0 border-none bg-transparent fg-[var(--grid-caption)] cursor-pointer font-inherit text-[1rem] leading-none';
    dismissBtn.setAttribute('aria-label', dismissLabel);
    dismissBtn.textContent = '✕';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.dataset.oaaoStripConfirm = '1';
    confirmBtn.className =
        'oaao-strip-chip__confirm rounded-[8px] h-8 px-2.5 text-[0.75rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
    confirmBtn.textContent = confirmLabel;

    chip.append(icon, desc, dismissBtn, confirmBtn);
    return chip;
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
    const hash = String(chip.dataset.oaaoStripHash ?? '').trim();
    if (!hash) {
        chip.remove();
        return { ok: true, skipped: true };
    }

    const fetchJson = ctx.fetchJson ?? fetchStripDismiss;
    const scope = typeof ctx.scopeFields === 'function' ? ctx.scopeFields() : {};
    const { res, data } = await fetchJson(stripApiUrl('dismiss'), { strip_hash: hash, ...scope });
    if (!res.ok) {
        return { ok: false, data };
    }
    chip.remove();
    return { ok: true, data };
}

/**
 * @param {HTMLElement} chip
 * @param {StripItem} item
 * @param {StripShellContext} [ctx]
 */
async function postStripConfirm(chip, item, ctx = {}) {
    const hash = String(item.strip_hash ?? chip.dataset.oaaoStripHash ?? '').trim();
    if (!hash) {
        return { ok: false, reason: 'missing_hash' };
    }
    const scope = typeof ctx.scopeFields === 'function' ? ctx.scopeFields() : {};
    const { res, data } = await fetchStripConfirm(stripApiUrl('confirm'), { strip_hash: hash, ...scope });
    if (!res.ok) {
        return { ok: false, data };
    }
    chip.remove();
    const actionId = String(item.action_id ?? chip.dataset.oaaoStripAction ?? '').trim();
    if (actionId.startsWith('todo_')) {
        document.dispatchEvent(new CustomEvent('oaao:todos-changed'));
        if (typeof ctx.onTodoResolve === 'function') {
            ctx.onTodoResolve();
        }
    }
    return { ok: true, data };
}

/**
 * @param {HTMLElement} chip
 * @param {StripItem} item
 * @param {StripShellContext} [ctx]
 */
async function showStripPreviewDialog(chip, item, ctx = {}) {
    const Dialog = await loadDialogCtor();
    const body = document.createElement('div');
    body.className = 'min-w-0';
    await renderStripPreviewBody(
        body,
        String(item.message ?? chip.dataset.oaaoStripMessage ?? ''),
        String(item.message_format ?? chip.dataset.oaaoStripMessageFormat ?? 'markdown'),
    );

    const confirmLabel =
        String(item.confirm_label ?? '').trim() ||
        chip.querySelector('[data-oaao-strip-confirm]')?.textContent?.trim() ||
        pt('productivity.strip.confirm', 'Confirm');

    void new Dialog({
        title: pt('productivity.strip.preview_title', 'Confirm action'),
        content: body,
        size: 'md',
        closable: true,
        buttons: [
            { text: pt('productivity.common.cancel', 'Cancel'), color: 'muted', role: 'cancel' },
            {
                text: confirmLabel,
                color: 'accent',
                close: false,
                action: async () => postStripConfirm(chip, item, ctx),
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
    if (typeof ctx.onConfirm === 'function') {
        await ctx.onConfirm(chip, item);
        return { ok: true, delegated: true };
    }

    const merged = parseStripItemFromChip(chip, item);
    const needsPreview =
        merged.confirmation !== false &&
        merged.confirmation !== 'false' &&
        String(merged.message ?? '').trim() !== '';

    if (needsPreview) {
        await showStripPreviewDialog(chip, merged, ctx);
        return { ok: true, preview: true };
    }

    return postStripConfirm(chip, merged, ctx);
}

/**
 * @param {HTMLElement} stripRoot
 * @param {StripShellContext} [ctx]
 */
export function bindStripChipDelegation(stripRoot, ctx = {}) {
    if (!(stripRoot instanceof HTMLElement)) return;
    if (stripRoot.dataset.oaaoStripDelegation === '1') return;
    stripRoot.dataset.oaaoStripDelegation = '1';

    stripRoot.addEventListener('click', (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const chip = target.closest('[data-oaao-strip-chip]');
        if (!(chip instanceof HTMLElement) || !stripRoot.contains(chip)) return;

        if (target.closest('[data-oaao-strip-dismiss]')) {
            ev.preventDefault();
            void dismissStripChip(chip, ctx);
            return;
        }

        if (target.closest('[data-oaao-strip-confirm]')) {
            ev.preventDefault();
            void confirmStripChip(chip, parseStripItemFromChip(chip), ctx);
        }
    });
}

/**
 * Ensure `[data-oaao-chat-area="strip"]` exists on the assistant row.
 *
 * @param {HTMLElement} outer
 * @returns {HTMLElement | null}
 */
function ensureStripHost(outer) {
    let strip = outer.querySelector('[data-oaao-chat-area="strip"]');
    if (strip instanceof HTMLElement) return strip;

    strip = document.createElement('div');
    strip.dataset.oaaoChatArea = 'strip';
    strip.dataset.oaaoChat = 'action-strip';
    strip.className = 'oaao-chat-area oaao-chat-area--strip w-full min-w-0 max-w-full';
    const anchor =
        outer.querySelector('[data-oaao-chat-area="info"]') ||
        outer.querySelector('[data-oaao-chat="turn-score"]') ||
        outer.querySelector('[data-oaao-chat-area="state"]') ||
        outer.querySelector('[data-oaao-chat="assistant-summary-wrap"]') ||
        outer.querySelector('.oaao-chat-assistant-toolbar');
    if (anchor instanceof HTMLElement) {
        outer.insertBefore(strip, anchor);
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

    let strip = ensureStripHost(outer);
    if (!(strip instanceof HTMLElement)) return;

    bindStripChipDelegation(strip, ctx);

    /** @type {Set<string>} */
    const seen = new Set();
    strip.querySelectorAll('[data-oaao-strip-chip]').forEach((node) => {
        if (node instanceof HTMLElement) {
            seen.add(
                stripItemHash({
                    strip_hash: node.dataset.oaaoStripHash,
                    action_id: node.dataset.oaaoStripAction,
                    agent: node.dataset.oaaoStripAgent,
                    conversation_id: node.dataset.oaaoConversationId,
                    message_id: node.dataset.oaaoMessageId,
                }),
            );
        }
    });

    for (const item of items) {
        const key = stripItemHash(item);
        if (seen.has(key)) continue;
        seen.add(key);

        const chip = createStripChipElement(item, cid, mid);
        mountProductivityChip(outer, chip);
    }
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

/** One-time document-level delegation for dynamically added strips (optional). */
export function ensureGlobalStripDelegation(ctx = {}) {
    if (dismissDelegationBound || typeof document === 'undefined') return;
    dismissDelegationBound = true;
    document.addEventListener('click', (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const chip = target.closest('[data-oaao-strip-chip]');
        if (!(chip instanceof HTMLElement)) return;
        const strip = chip.closest('[data-oaao-chat-area="strip"]');
        if (!(strip instanceof HTMLElement)) return;
        bindStripChipDelegation(strip, ctx);
    });
}

export default {
    mountStripItems,
    mountStripFromEnvelope,
    normalizeStripItemsFromMeta,
    createStripChipElement,
    dismissStripChip,
    confirmStripChip,
    stripApiUrl,
    fetchStripDismiss,
    fetchStripConfirm,
};
