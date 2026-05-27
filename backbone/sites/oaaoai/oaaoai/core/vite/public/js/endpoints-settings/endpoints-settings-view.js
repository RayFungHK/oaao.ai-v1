/**
 * Endpoints settings — view layer (markup + DOM assembly). Mutable state lives in {@link ./runtime.js}.
 *
 * Relatives from {@code …/js/endpoints-settings/} — no import map (embedded browsers / dynamic {@code import()}).
 */

import { oaaoT } from '../oaao-i18n.js';
import { resolveShellRegistryUrl } from '../shell-registry-url.js';
import {
    jitApply,
    mountParsedHtml,
    replaceChildrenMixed,
    replaceChildrenParsed,
    ruiBuild,
    SETTINGS_BTN_PRIMARY_JIT,
} from '../oaao-jit-dsl.js';
import { buildChatCompletionProfilesPicker } from '../../../../chat/default/js/chat-settings-panel.js';
import { rt } from './runtime.js';
import { purposeKeyToEndpointFilterPrefix } from './purpose-key-prefix.js';
import { endpointUsagePanelHtml } from './endpoint-usage-chart.js';

/** @param {unknown} v */
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @param {Record<string, unknown>} slot */
function purposeSlotLabel(slot) {
    const k = typeof slot.label_key === 'string' ? slot.label_key.trim() : '';
    const fb = typeof slot.label === 'string' ? slot.label : '';
    return k ? oaaoT(k, fb) : fb;
}

/** @param {Record<string, unknown>} slot */
function purposeSlotSubParagraph(slot) {
    const k = typeof slot.sub_key === 'string' ? slot.sub_key.trim() : '';
    if (k) {
        const inner = oaaoT(k);
        return inner.trim() !== ''
            ? `<p class="mt-1 text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug">${inner}</p>`
            : '';
    }
    const s = typeof slot.sub === 'string' ? slot.sub : '';
    if (!s.trim()) return '';
    return `<p class="mt-1 text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug">${escapeHtml(s)}</p>`;
}

function endpointsApiBase() {
    const authBase = (typeof document !== 'undefined' && document.body?.dataset?.authBase || '').trim();
    if (authBase) {
        try {
            const u = new URL(authBase, window.location.href);
            let rootPath = u.pathname.replace(/\/?$/, '');
            rootPath = rootPath.replace(/\/auth$/i, '') || '/';
            if (!rootPath.endsWith('/')) rootPath += '/';

            return `${rootPath}endpoints/api/`;
        } catch {
            /* fall through */
        }
    }

    return '/endpoints/api/';
}

/** @param {string} action */
function endpointsApiUrl(action) {
    const base = endpointsApiBase();
    return `${base}${action.replace(/^\/+/, '')}`;
}

/** @param {string} action */
function chatApiUrl(action) {
    const authBase = (typeof document !== 'undefined' && document.body?.dataset?.authBase || '').trim();
    let base = '/chat/api/';
    if (authBase) {
        try {
            const u = new URL(authBase, window.location.href);
            let rootPath = u.pathname.replace(/\/?$/, '');
            rootPath = rootPath.replace(/\/auth$/i, '') || '/';
            if (!rootPath.endsWith('/')) rootPath += '/';
            base = `${rootPath}chat/api/`;
        } catch {
            /* fall through */
        }
    }
    return `${base}${action.replace(/^\/+/, '')}`;
}

/** @param {string} url @param {RequestInit} [options] */
async function endpointsFetchJson(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(options.headers || {}),
        },
        ...options,
    });
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = {};
    }
    return { res, data };
}

/** @type {Array<{ close: () => void }>} */
const nestedDialogControls = [];

/** @type {{ Dialog?: unknown, JIT?: { hydrate?: (root: Element | DocumentFragment) => void }, razyui?: unknown } | null} */
let mountCtx = null;

/** @type {Promise<{ default: new (host: Element, config?: Record<string, unknown>) => unknown; registerElement?: () => Promise<void> }> | null} */
let comboboxModulePromise = null;
let comboboxCustomElementRegistered = false;

/**
 * Load RazyUI {@code Combobox} (registers {@code <rui-combobox>} for the rest of the app).
 */
async function ensureComboboxRegistered() {
    if (!comboboxModulePromise) {
        const href = resolveShellRegistryUrl('/webassets/core/default/razyui/component/Combobox.js');
        comboboxModulePromise = import(/* webpackIgnore: true */ href);
    }
    const mod = await comboboxModulePromise;
    if (!comboboxCustomElementRegistered && typeof mod.registerElement === 'function') {
        await mod.registerElement();
        comboboxCustomElementRegistered = true;
    }
    return mod.default;
}

/**
 * @param {HTMLFormElement} form
 * @returns {string} comma-separated purpose prefixes (stable sort)
 */
function readEndpointTypesFromForm(form) {
    const el = form.elements.namedItem('endpoint_type');
    if (el instanceof HTMLSelectElement && el.multiple) {
        const s = Array.from(el.selectedOptions)
            .map((o) => String(o.value).trim())
            .filter(Boolean)
            .sort()
            .join(',');
        return s || 'chat';
    }
    if (el instanceof HTMLSelectElement) {
        const v = String(el.value || '').trim();
        return v || 'chat';
    }
    return 'chat';
}

/**
 * @param {HTMLFormElement} form
 */
/**
 * Progressive-enhance the native multi-select once. Do **not** wrap with {@code <rui-combobox>} here — CE upgrade +
 * manual {@code new Combobox(host)} would insert two {@code .combobox-container} rows.
 */
async function mountEndpointTypeCombobox(form) {
    const wrap = form.querySelector('[data-oaao-ep-endpoint-type]');
    const sel = form.querySelector('select[name="endpoint_type"]');
    if (!(wrap instanceof HTMLElement) || !(sel instanceof HTMLSelectElement) || !sel.multiple) return;
    if (wrap.dataset.oaaoComboboxMounted === '1') return;
    try {
        const ComboboxCls = await ensureComboboxRegistered();
        if (typeof ComboboxCls === 'function') {
            new ComboboxCls(sel, { placeholder: oaaoT('settings.endpoints.type_combobox_placeholder'), checkbox: true });
            wrap.dataset.oaaoComboboxMounted = '1';
        }
    } catch (e) {
        console.warn('[oaao] endpoints: Combobox init failed', e);
    }
}

function closeNestedDialogs() {
    while (nestedDialogControls.length) {
        const c = nestedDialogControls.pop();
        try {
            c.close();
        } catch {
            /* ignore */
        }
    }
}

/** @param {unknown} instance */
function trackDialog(instance) {
    const inst = /** @type {{ getControl?: () => { close?: () => void } }} */ (instance);
    const ctrl = typeof inst?.getControl === 'function' ? inst.getControl() : null;
    if (ctrl && typeof ctrl.close === 'function') nestedDialogControls.push(ctrl);
}

function hasDialog() {
    return typeof mountCtx?.Dialog === 'function';
}

/**
 * @param {string} title
 * @param {string} htmlBody trusted / escaped HTML fragment
 */
async function confirmDestructive(title, htmlBody) {
    const D = mountCtx?.Dialog;
    if (D && typeof D.confirm === 'function') {
        return D.confirm(title, htmlBody);
    }
    const strip = htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return window.confirm(strip || title);
}

/** Settings panel mode — stored on host {@code dataset.oaaoEndpointsPanel} so one module can serve two nav rows safely. */
/** @param {HTMLElement} host @returns {'endpoints' | 'purposes'} */
function readPanelMode(host) {
    return host.dataset.oaaoEndpointsPanel === 'purposes' ? 'purposes' : 'endpoints';
}

/** @param {HTMLElement} host @param {'endpoints' | 'purposes'} mode */
function writePanelMode(host, mode) {
    host.dataset.oaaoEndpointsPanel = mode;
}

/**
 * Whether endpoint row tags ({@code endpoint_type}, comma-separated) satisfy a purpose prefix family.
 *
 * @param {Record<string, unknown>} row
 * @param {string} prefix trimmed non-empty segment (e.g. {@code embedding}, {@code rerank})
 */
function endpointRowMatchesPurposePrefix(row, prefix) {
    const p = String(prefix ?? '').trim();
    if (!p) return true;

    const raw = String(row.endpoint_type ?? 'chat');
    const tokens = raw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    for (const t of tokens) {
        if (t === p || t.startsWith(`${p}.`)) {
            return true;
        }
    }

    return false;
}

/**
 * Endpoints assignable to an allocation slot — filters by {@code endpoint_type} first token / dotted family.
 * When no row matches the prefix, returns an empty list (strict) so admins are not offered wrong-typed endpoints;
 * {@code forceIncludeId} still appends the current row if present (legacy / mis-tagged selection stays visible).
 *
 * @param {string} purposePrefix
 * @param {number} forceIncludeId
 * @returns {Array<Record<string, unknown>>}
 */
function listEndpointsForPurposeSlot(purposePrefix, forceIncludeId = NaN) {
    const p = String(purposePrefix ?? '').trim();
    if (!p) {
        return rt.state.endpoints.slice();
    }

    const fid = Number(forceIncludeId);
    const byMatch = rt.state.endpoints.filter((r) => endpointRowMatchesPurposePrefix(r, p));

    /** @type {Array<Record<string, unknown>>} */
    const out = byMatch.slice();
    if (Number.isFinite(fid) && fid > 0 && !out.some((r) => Number(r.id) === fid)) {
        const row = rt.state.endpoints.find((r) => Number(r.id) === fid);
        if (row) {
            out.push(row);
        }
    }

    return out;
}

/** @param {string} [purposePrefix] @param {number} [forceIncludeId] */
function endpointOptionHtml(purposePrefix = '', forceIncludeId = NaN) {
    const rows = listEndpointsForPurposeSlot(purposePrefix, forceIncludeId);

    return rows
        .map((r) => {
            const id = Number(r.id);
            const name = escapeHtml(r.name);

            return `<option value="${Number.isFinite(id) ? id : ''}">${name}</option>`;
        })
        .join('');
}

/** Endpoint &lt;select&gt; options with optional preselection (purpose inline editors). */
/** @param {unknown} selectedId @param {string} [purposeKeyPrefix] slot's {@code purpose_key_prefix}; filters by endpoint_type */
function endpointSelectOptionsHtml(selectedId, purposeKeyPrefix = '') {
    const sel = selectedId != null && selectedId !== '' ? Number(selectedId) : NaN;
    const pfx = typeof purposeKeyPrefix === 'string' ? purposeKeyPrefix.trim() : '';
    const rows = listEndpointsForPurposeSlot(pfx, sel);
    let html = `<option value="">${escapeHtml(oaaoT('settings.endpoints.none_option'))}</option>`;
    for (const r of rows) {
        const id = Number(r.id);
        const picked = Number.isFinite(id) && id === sel ? ' selected' : '';
        html += `<option value="${Number.isFinite(id) ? id : ''}"${picked}>${escapeHtml(r.name)}</option>`;
    }

    return html;
}

/** @param {ReadonlyArray<Record<string, unknown>>} rows @param {string} prefix */
function findPrimaryPurposeRow(rows, prefix) {
    const p = prefix.trim();
    return rows.find((r) => String(r.purpose_key || '') === p) ?? null;
}

function endpointCardsHtml() {
    const L_ID = oaaoT('settings.endpoints.field_id');
    const L_TYPE = oaaoT('settings.endpoints.field_type');
    const disTag = oaaoT('settings.endpoints.card_disabled');
    const ariaActions = oaaoT('settings.endpoints.card_actions_aria');
    const edit = oaaoT('settings.endpoints.edit');
    const del = oaaoT('settings.endpoints.delete');
    const L_BASE = oaaoT('settings.endpoints.field_base_url');
    const L_MODEL = oaaoT('settings.endpoints.field_model');

    return rt.state.endpoints
        .map((r) => {
            const id = Number(r.id);
            const enabled = Number(r.is_enabled) === 1;
            const name = escapeHtml(r.name);
            const baseUrl = escapeHtml(r.base_url);
            const model = escapeHtml(r.model);
            const epType = escapeHtml(r.endpoint_type);
            const dimClass = enabled ? '' : ' opacity-[0.72] saturate-[0.7]';
            const disabledAttr = enabled ? '' : ' data-oaao-ep-disabled="1"';
            const disabledLbl = enabled
                ? ''
                : `<div class="mt-2 flex justify-end pt-0.5"><span class="text-[0.6875rem] fw-semibold uppercase tracking-wide fg-[var(--grid-ink-muted)]">${escapeHtml(disTag)}</span></div>`;
            const usageHtml = endpointUsagePanelHtml(rt.state.endpointUsageStats?.[String(id)] ?? null);
            return `<article data-eid="${id}" data-oaao-ep-card${disabledAttr} class="oaao-ep-card mb-2 last:mb-0 rounded-md border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] p-2.5 sm:p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)]${dimClass}">
  <div class="flex flex-wrap items-start justify-between gap-x-2 gap-y-2">
    <div class="min-w-0 flex-1 basis-[min(100%,10rem)]">
      <h3 class="text-[0.875rem] sm:text-[0.9375rem] fw-semibold leading-tight tracking-tight fg-[var(--grid-ink)]">${name}</h3>
      <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug">
        <span><span class="opacity-70">${escapeHtml(L_ID)}</span> <code class="font-mono tabular-nums text-[0.75rem] sm:text-[0.8125rem]">${escapeHtml(String(r.id))}</code></span>
        <span><span class="opacity-70">${escapeHtml(L_TYPE)}</span> <code class="font-mono break-all text-[0.75rem] sm:text-[0.8125rem]">${epType}</code></span>
      </div>
    </div>
    <div class="inline-flex shrink-0 overflow-hidden rounded border border-[var(--grid-line)] bg-[var(--grid-paper)] text-[0.8125rem]" role="group" aria-label="${escapeHtml(ariaActions)}">
      <button type="button" data-act="ep-edit" class="px-2 py-1 fw-medium fg-[var(--grid-accent)] hover:bg-[rgba(55,53,47,0.06)] bg-transparent border-0 cursor-pointer font-inherit leading-none whitespace-nowrap">${escapeHtml(edit)}</button>
      <span class="w-px shrink-0 self-stretch bg-[var(--grid-line)]" aria-hidden="true"></span>
      <button type="button" data-act="ep-del" class="px-2 py-1 fw-medium fg-[var(--grid-caution,#b45309)] hover:bg-[rgba(55,53,47,0.06)] bg-transparent border-0 cursor-pointer font-inherit leading-none whitespace-nowrap">${escapeHtml(del)}</button>
    </div>
  </div>
  <dl class="mt-2 grid gap-2 border-t border-[var(--grid-line)] pt-2 text-[0.8125rem] sm:text-[0.875rem]">
    <div>
      <dt class="mb-0.5 text-[0.6875rem] sm:text-[0.75rem] fw-semibold uppercase tracking-wide fg-[var(--grid-caption,var(--grid-ink-muted))]">${escapeHtml(L_BASE)}</dt>
      <dd class="break-all font-mono leading-snug fg-[var(--grid-ink)]">${baseUrl}</dd>
    </div>
    <div>
      <dt class="mb-0.5 text-[0.6875rem] sm:text-[0.75rem] fw-semibold uppercase tracking-wide fg-[var(--grid-caption,var(--grid-ink-muted))]">${escapeHtml(L_MODEL)}</dt>
      <dd class="break-all font-mono leading-snug fg-[var(--grid-ink)]">${model}</dd>
    </div>
  </dl>${usageHtml}${disabledLbl}
</article>`;
        })
        .join('');
}

/** Unmatched {@code oaao_purpose} keys (fallback bucket) — compact list, edit/delete only */
/** @param {ReadonlyArray<Record<string, unknown>>} rows @param {string} [emptyMessage] plain text when {@code rows} is empty */
function orphanPurposeRowsHtml(rows, emptyMessage) {
    if (!rows.length) {
        const msg =
            typeof emptyMessage === 'string' && emptyMessage.trim() !== ''
                ? emptyMessage.trim()
                : oaaoT('settings.purpose.rows_empty');
        return `<p class="p-3 text-[0.8125rem] fg-[var(--grid-ink-muted)]">${escapeHtml(msg)}</p>`;
    }
    const puAria = escapeHtml(oaaoT('settings.purpose_rows.actions_aria'));
    const puEdit = escapeHtml(oaaoT('settings.endpoints.edit'));
    const puDel = escapeHtml(oaaoT('settings.endpoints.delete'));
    return rows
        .map((r) => {
            const id = Number(r.id);
            const pk = String(r.purpose_key ?? '');
            const enabled = Number(r.is_enabled) === 1;
            const dim = enabled ? '' : ' opacity-[0.72] saturate-[0.7]';
            const dep = r.default_endpoint_name ? escapeHtml(String(r.default_endpoint_name)) : '—';
            return `<div data-oaao-pu-row data-pid="${Number.isFinite(id) ? id : ''}" data-purpose-key="${escapeHtml(pk)}" class="flex flex-wrap items-center gap-2 border-b border-[var(--grid-line)] px-2 py-2 last:border-b-0${dim}">
  <code class="font-mono text-[0.75rem] shrink-0">${escapeHtml(pk)}</code>
  <span class="text-[0.8125rem] fg-[var(--grid-ink)] min-w-0">${escapeHtml(r.label)}</span>
  <span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${dep}</span>
  <div class="ml-auto inline-flex shrink-0 overflow-hidden rounded border border-[var(--grid-line)] bg-[var(--grid-paper)] text-[0.8125rem]" role="group" aria-label="${puAria}">
    <button type="button" data-act="pu-edit" class="px-2 py-1 fw-medium fg-[var(--grid-accent)] hover:bg-[rgba(55,53,47,0.06)] bg-transparent border-0 cursor-pointer font-inherit leading-none">${puEdit}</button>
    <span class="w-px shrink-0 self-stretch bg-[var(--grid-line)]" aria-hidden="true"></span>
    <button type="button" data-act="pu-del" class="px-2 py-1 fw-medium fg-[var(--grid-caution,#b45309)] hover:bg-[rgba(55,53,47,0.06)] bg-transparent border-0 cursor-pointer font-inherit leading-none">${puDel}</button>
  </div>
</div>`;
        })
        .join('');
}

function readPurposeAllocationSlots() {
    const raw = globalThis.OAAO_PURPOSE_ALLOCATION_REGISTRY;
    return Array.isArray(raw) ? raw : [];
}

/** When {@code OAAO_PURPOSE_ALLOCATION_REGISTRY} is empty — matches {@see PurposeAllocationRegister} seed prefixes. */
const ENDPOINT_TYPE_FALLBACK_PREFIXES = ['chat', 'embedding', 'rerank', 'rag', 'planning', 'vault', 'uiqe', 'asr', 'asr.live', 'asr_summary', 'other'];

/**
 * Options for {@code endpoint_type}: purpose routing prefixes ({@code purpose_key} / allocation slots). Supports multi-select.
 *
 * @param {string|string[]} currentValue comma-separated persist value or list of selected prefixes
 */
function endpointTypeSelectOptionsHtml(currentValue) {
    /** @type {Set<string>} */
    const curSet = new Set();
    if (Array.isArray(currentValue)) {
        for (const v of currentValue) {
            const s = String(v ?? '').trim();
            if (s) curSet.add(s);
        }
    } else {
        for (const part of String(currentValue ?? 'chat').split(',')) {
            const s = part.trim();
            if (s) curSet.add(s);
        }
    }
    if (curSet.size === 0) curSet.add('chat');

    const slots = readPurposeAllocationSlots();
    /** @type {{ value: string, label: string }[]} */
    const opts = [];
    const seen = new Set();

    for (const slot of slots) {
        if (slot.fallback === true) continue;
        const pfx = typeof slot.purpose_key_prefix === 'string' ? slot.purpose_key_prefix.trim() : '';
        if (!pfx || seen.has(pfx)) continue;
        seen.add(pfx);
        const lab = purposeSlotLabel(slot);
        opts.push({ value: pfx, label: lab.trim() !== '' ? lab : pfx });
    }

    if (opts.length === 0) {
        for (const pfx of ENDPOINT_TYPE_FALLBACK_PREFIXES) {
            opts.push({ value: pfx, label: pfx });
        }
    }

    let html = '';
    for (const o of opts) {
        const sel = curSet.has(o.value) ? ' selected' : '';
        html += `<option value="${escapeHtml(o.value)}"${sel}>${escapeHtml(o.label)} — ${escapeHtml(o.value)}</option>`;
    }
    const valuesInOpts = new Set(opts.map((x) => x.value));
    for (const v of curSet) {
        if (!valuesInOpts.has(v)) {
            html += `<option value="${escapeHtml(v)}" selected>${escapeHtml(v)} — ${escapeHtml(oaaoT('settings.endpoints.endpoint_type_custom'))}</option>`;
        }
    }

    return html;
}

/** @param {string|string[]} [initialEndpointTypes] default selection(s) before {@code fillEndpointForm} */
function endpointEditorFormHtml(initialEndpointTypes = 'chat') {
    const typeOpts = endpointTypeSelectOptionsHtml(initialEndpointTypes);
    const multilineHint = oaaoT('settings.ep.form.endpoint_type_hint');
    const phEsc = escapeHtml(oaaoT('settings.endpoints.type_combobox_placeholder'));
    return `<form id="oaao-ep-dlg-form" class="grid gap-sm max-w-full">
  <input type="hidden" name="id" value="" />
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.ep.form.name'))}</span><input name="name" required class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" /></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.ep.form.endpoint_type'))}</span><span class="text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug">${multilineHint}</span><div data-oaao-ep-endpoint-type="" class="w-full max-w-full mt-0.5 min-w-0"><select name="endpoint_type" multiple data-placeholder="${phEsc}">${typeOpts}</select></div></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]" data-oaao-ep-base-url-wrap="">
    <span class="fw-medium" data-oaao-ep-base-url-label="">${escapeHtml(oaaoT('settings.ep.form.base_url'))}</span>
    <span class="text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug hidden" data-oaao-ep-base-url-hint=""></span>
    <input name="base_url" placeholder="https://…" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" />
  </label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.ep.form.model'))}</span><input name="model" required class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" /></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.ep.form.api_key_ref'))}</span><input name="api_key_ref" placeholder="vault / env ref" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" /></label>
  <label class="flex items-center gap-2 text-[0.8125rem] cursor-pointer"><input type="checkbox" name="is_enabled" checked class="rounded border-[var(--grid-line)]" /><span>${escapeHtml(oaaoT('settings.ep.form.enabled'))}</span></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.ep.form.tokens_per_credit'))}</span><span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${escapeHtml(oaaoT('settings.ep.form.tokens_per_credit_hint'))}</span><input name="tokens_per_credit" type="number" min="1" step="1" placeholder="1000" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs max-w-[12rem]" /></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.ep.form.config_json'))}</span><textarea name="config_json" rows="3" placeholder="{}" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs"></textarea></label>
  <p id="oaao-ep-dlg-msg" class="text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem]" role="status"></p>
</form>`;
}

/** @param {string} epOpts @param {{ hideMetaJson?: boolean }} [opts] */
function purposeEditorFormHtml(epOpts, opts = {}) {
    const noneOpt = escapeHtml(oaaoT('settings.endpoints.none_option'));
    const hideMeta = Boolean(opts.hideMetaJson);
    const metaJsonField = hideMeta
        ? ''
        : `<label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.pu.form.meta_json'))}</span><textarea name="meta_json" rows="3" placeholder="{}" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs"></textarea></label>`;
    return `<form id="oaao-pu-dlg-form" class="grid gap-sm max-w-full">
  <input type="hidden" name="id" value="" />
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.pu.form.purpose_key'))}</span><input name="purpose_key" required pattern="[a-zA-Z0-9][a-zA-Z0-9_.:-]*" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs" placeholder="chat.default" /></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.pu.form.label'))}</span><input name="label" required class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" /></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.pu.form.description'))}</span><textarea name="description" rows="2" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] text-xs"></textarea></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.pu.form.default_endpoint'))}</span>
    <select name="default_endpoint_id" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]"><option value="">${noneOpt}</option>${epOpts}</select></label>
  <label class="flex items-center gap-2 text-[0.8125rem] cursor-pointer"><input type="checkbox" name="is_enabled" checked class="rounded border-[var(--grid-line)]" /><span>${escapeHtml(oaaoT('settings.purposes.enabled'))}</span></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.pu.form.sort_order'))}</span><input name="sort_order" type="number" value="500" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs" /></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('settings.pu.form.credit_multiplier'))}</span><span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${escapeHtml(oaaoT('settings.pu.form.credit_multiplier_hint'))}</span><input name="credit_multiplier" type="number" min="0.01" step="0.01" placeholder="1" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs max-w-[12rem]" /></label>
  ${metaJsonField}
  <p id="oaao-pu-dlg-msg" class="text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem]" role="status"></p>
</form>`;
}

/**
 * Lucide-ish tokens from PHP {@code purpose_allocation.register} → classes defined in bundled {@code razyui-icons.css}.
 * Bare tokens become {@code ri-<token>} otherwise; unknown names render empty glyphs.
 *
 * @type {Readonly<Record<string, string>>}
 */
const PURPOSE_SLOT_ICON_ALIASES = {
    // oaaoai/endpoints
    'message-circle-more': 'ri-message-3-text',
    sparkles: 'ri-star-fat',
    mic: 'ri-microphone-1',
    'circle-dotted': 'ri-question-mark-circle',
    // oaaoai/chat (planning)
    map: 'ri-map-pin-5',
    // oaaoai/rag
    layers: 'ri-layers-1',
    'arrow-down-wide-narrow': 'ri-sort-high-to-low',
    'book-open': 'ri-books-2',
    vault: 'ri-database-2',
};

/** @param {unknown} icon */
function slotIconClasses(icon) {
    const s = String(icon ?? '').trim();
    if (!s) return 'ri-layout-9 rz-icon';
    if (s.includes(' ') || s.startsWith('ri-')) {
        return `${s}${s.includes('rz-icon') ? '' : ' rz-icon'}`;
    }
    const mapped = PURPOSE_SLOT_ICON_ALIASES[s];
    if (mapped) {
        return `${mapped} rz-icon`;
    }
    return `ri-${s} rz-icon`;
}

/**
 * @param {ReadonlyArray<Record<string, unknown>>} slots
 * @param {ReadonlyArray<Record<string, unknown>>} purposes
 */
function partitionPurposesBySlots(slots, purposes) {
    /** @type {Map<string, Record<string, unknown>[]>} */
    const bySlotId = new Map();
    for (const s of slots) {
        const sid = typeof s.slot_id === 'string' ? s.slot_id : '';
        if (sid) bySlotId.set(sid, []);
    }
    const normalSlots = slots.filter((s) => !s.fallback);
    const fallbackSlots = slots.filter((s) => s.fallback === true);
    const matched = new Set();
    for (const s of normalSlots) {
        const sid = String(s.slot_id || '');
        const pfx = typeof s.purpose_key_prefix === 'string' ? s.purpose_key_prefix.trim() : '';
        const bucket = bySlotId.get(sid);
        if (!bucket || !pfx) continue;
        for (const r of purposes) {
            const k = String(r.purpose_key || '');
            if (k === pfx || k.startsWith(`${pfx}.`)) {
                bucket.push(r);
                matched.add(Number(r.id));
            }
        }
    }
    const unmatched = purposes.filter((r) => !matched.has(Number(r.id)));
    const fb = fallbackSlots[0];
    if (fb && typeof fb.slot_id === 'string') {
        const b = bySlotId.get(fb.slot_id);
        if (b) {
            for (const r of unmatched) b.push(r);
        }
    }
    return bySlotId;
}

/**
 * Chat pipeline card: no profiles, no enabled profiles, or no enabled profile with an LLM endpoint bound.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} profiles
 */
function chatPurposeSlotIncomplete(profiles) {
    const list = Array.isArray(profiles) ? profiles : [];
    if (list.length === 0) {
        return true;
    }

    const enabled = list.filter((p) => Number(p.is_enabled) === 1);
    if (enabled.length === 0) {
        return true;
    }

    return !enabled.some((p) => chatProfileHasEndpointBound(p));
}

/**
 * @param {Record<string, unknown>} p
 */
function chatProfileHasEndpointBound(p) {
    const llms = Array.isArray(p.llms) ? p.llms : [];
    for (const x of llms) {
        if (!x || typeof x !== 'object') continue;
        const eid = Number(/** @type {Record<string, unknown>} */ (x).endpoint_id);
        if (Number.isFinite(eid) && eid > 0) {
            return true;
        }
    }

    return false;
}

/** @param {unknown} raw */
function purposeRowMetaJson(raw) {
    if (raw == null) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) return /** @type {Record<string, unknown>} */ ({ ...raw });
    const s = String(raw).trim();
    if (!s) return {};
    try {
        const dec = JSON.parse(s);
        return dec && typeof dec === 'object' && !Array.isArray(dec) ? /** @type {Record<string, unknown>} */ (dec) : {};
    } catch {
        return {};
    }
}

/** @param {Record<string, unknown>|null} primaryRow */
function mmPurposeSlotComplete(primaryRow) {
    if (!primaryRow) return false;
    const meta = purposeRowMetaJson(primaryRow.meta_json);
    if (String(meta.backend ?? '').toLowerCase() === 'python_module') return true;
    const depNum = Number(primaryRow.default_endpoint_id);
    return Number.isFinite(depNum) && depNum > 0;
}

/**
 * Registered pipeline card — one primary {@code purpose_key === prefix}. Wrapped in {@code <details>}
 * (closed by default). Chat picker subtree is {@link buildChatCompletionProfilesPicker} (DSL).
 *
 * @param {Record<string, unknown>} slot
 * @param {Record<string, unknown>|null} primaryRow
 * @param {ReadonlyArray<Record<string, unknown>>} chatProfiles
 * @returns {HTMLElement | null}
 */
function buildPurposePipelineCard(slot, primaryRow, chatProfiles) {
    const profiles = Array.isArray(chatProfiles) ? chatProfiles : [];
    const sid = typeof slot.slot_id === 'string' ? slot.slot_id : '';
    const pfx = typeof slot.purpose_key_prefix === 'string' ? slot.purpose_key_prefix.trim() : '';
    if (!sid || !pfx) return null;

    const label = purposeSlotLabel(slot);
    const subHtml = purposeSlotSubParagraph(slot);
    const allocMode = typeof slot.allocation_mode === 'string' ? slot.allocation_mode.trim() : '';
    const pid = primaryRow && Number(primaryRow.id) > 0 ? Number(primaryRow.id) : 0;
    const depId = primaryRow?.default_endpoint_id ?? '';
    const enabled = primaryRow ? Number(primaryRow.is_enabled) === 1 : true;
    const disabledPurpose = Boolean(primaryRow && !enabled);

    const depNum = depId !== '' && depId != null ? Number(depId) : Number.NaN;
    const hasDefaultEndpoint = Number.isFinite(depNum) && depNum > 0;
    const isMmSlot = pfx.startsWith('mm.');
    const slotIncomplete =
        allocMode === 'chat_multi'
            ? chatPurposeSlotIncomplete(profiles)
            : isMmSlot
              ? !mmPurposeSlotComplete(primaryRow)
              : !hasDefaultEndpoint;

    const icon = slotIconClasses(slot.icon);

    /** @type {Record<string, string>} */
    const detailsAttrs = {
        'data-oaao-pa-slot': '',
        'data-slot-id': sid,
        'data-slot-prefix': pfx,
    };
    if (pid > 0) detailsAttrs['data-pid'] = String(pid);
    if (disabledPurpose) detailsAttrs['data-oaao-pu-disabled'] = '1';
    if (slotIncomplete && !disabledPurpose) {
        detailsAttrs['data-oaao-pa-incomplete'] = '1';
        detailsAttrs.title = oaaoT('settings.purposes.card_incomplete_tooltip');
    }

    /** @type {Array<HTMLElement | ReturnType<typeof ruiBuild>>} */
    const titleRowChildren = [
        ruiBuild({
            t: 'h3',
            j: 'text-[0.875rem] sm:text-[0.9375rem] fw-semibold leading-tight fg-[var(--grid-ink)]',
            txt: label,
        }),
    ];
    if (allocMode === 'chat_multi' && profiles.length > 0) {
        titleRowChildren.push(
            ruiBuild({
                t: 'span',
                j: 'inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] fw-semibold tracking-wide bg-[rgba(109,40,217,0.12)] fg-[#6d28d9]',
                a: { 'aria-label': oaaoT('settings.purposes.chat_profile_count_aria') },
                txt: String(profiles.length),
            }),
        );
    }

    const summaryMain = ruiBuild({
        t: 'div',
        j: 'min-w-0 flex-1',
        c: [{ t: 'div', j: 'flex flex-wrap items-center gap-x-2 gap-y-0.5', c: titleRowChildren }],
    });
    if (subHtml.trim()) mountParsedHtml(summaryMain, subHtml);

    const iconI = document.createElement('i');
    jitApply(iconI, `${icon} text-[1.125rem] fg-[var(--grid-accent)] rz-icon`);

    const summary = ruiBuild({
        t: 'summary',
        j: 'flex cursor-pointer list-none items-center gap-3 px-2.5 py-2.5 sm:px-3 [&::-webkit-details-marker]:hidden hover:bg-[rgba(55,53,47,0.04)]',
        c: [
            ruiBuild({
                t: 'span',
                j: 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--grid-line)] bg-[var(--grid-paper)]',
                a: { 'aria-hidden': 'true' },
                c: [iconI],
            }),
            summaryMain,
            ruiBuild({
                t: 'i',
                j: 'ri-arrow-down-s-line rz-icon shrink-0 text-[1.125rem] fg-[var(--grid-ink-muted)] transition-transform duration-200 group-open:rotate-180',
                a: { 'aria-hidden': 'true' },
            }),
        ],
    });

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'px-2.5 pb-2.5 pt-3 sm:px-3';

    if (allocMode === 'chat_multi') {
        const sec = document.createElement('section');
        sec.setAttribute('aria-label', oaaoT('settings.purposes.chat_section_title'));
        sec.appendChild(
            ruiBuild({
                t: 'div',
                j: 'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] mb-sm',
                txt: oaaoT('settings.purposes.chat_section_title'),
            }),
        );
        const descP = document.createElement('p');
        descP.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug mb-md max-w-[40rem]';
        mountParsedHtml(descP, oaaoT('settings.purposes.chat_section_desc'));
        sec.appendChild(descP);
        sec.appendChild(buildChatCompletionProfilesPicker(profiles));
        bodyWrap.appendChild(sec);
    } else {
        const slotSort = Number(slot.sort ?? 500);
        const selEp = endpointSelectOptionsHtml(depId, pfx);
        const editLbl = escapeHtml(oaaoT('settings.purposes.edit_details'));
        const editDetails =
            pid > 0 && allocMode !== 'chat_multi'
                ? `<button type="button" data-act="pu-edit-primary" data-pid="${pid}" class="text-[0.8125rem] fg-[var(--grid-accent)] hover:underline bg-transparent border-0 cursor-pointer font-inherit p-0 shrink-0">${editLbl}</button>`
                : '';
        const assignP = oaaoT('settings.purposes.assign_prefix', '', { prefix: escapeHtml(pfx) });
        const llmEpLbl = escapeHtml(oaaoT('settings.purposes.llm_endpoint'));
        const enLbl = escapeHtml(oaaoT('settings.purposes.enabled'));
        const saveLbl = escapeHtml(oaaoT('settings.purposes.save'));
        const disSpan = escapeHtml(oaaoT('settings.purposes.disabled_tag'));
        const disabledLbl =
            primaryRow && !enabled
                ? `<div class="mt-2 flex justify-end pt-0.5"><span class="text-[0.6875rem] fw-semibold uppercase tracking-wide fg-[var(--grid-ink-muted)]">${disSpan}</span></div>`
                : '';
        const asrPipelineHint =
            pfx === 'asr'
                ? `<p class="mt-2 text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug">${escapeHtml(oaaoT('settings.slot.asr.pipeline_hint'))}</p>`
                : pfx === 'asr.live'
                  ? `<p class="mt-2 text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug">${escapeHtml(oaaoT('settings.slot.asr_live.pipeline_hint'))}</p>`
                  : isMmSlot
                    ? `<p class="mt-2 text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug">${escapeHtml(oaaoT('settings.slot.mm.pipeline_hint'))}</p>`
                    : '';
        const primaryPurposeControlsHtml =
            `<p class="mt-2 text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug">${assignP}</p>
      <label class="mt-2 flex flex-col gap-0.5 text-[0.8125rem] max-w-full"><span class="fw-medium">${llmEpLbl}</span>
        <select data-oaao-pa-default-ep class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-paper)] max-w-full min-w-0">${selEp}</select></label>
      <label class="mt-2 flex items-center gap-2 text-[0.8125rem] cursor-pointer select-none"><input type="checkbox" data-oaao-pa-enabled class="rounded border-[var(--grid-line)]"${enabled ? ' checked' : ''} /><span>${enLbl}</span></label>
      ${asrPipelineHint}
      <div class="mt-3 flex flex-wrap items-center gap-2 justify-end">${editDetails}<button type="button" data-act="pu-primary-save" data-slot-sort="${slotSort}" class="${SETTINGS_BTN_PRIMARY_JIT}">${saveLbl}</button></div>`;
        replaceChildrenParsed(bodyWrap, `${primaryPurposeControlsHtml}${disabledLbl}`);
    }

    return ruiBuild({
        t: 'details',
        j: 'group oaao-pa-pipeline-card mb-2 rounded-md border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[0_1px_0_rgba(0,0,0,0.03)] overflow-hidden',
        a: detailsAttrs,
        c: [summary, bodyWrap],
    });
}

/** @param {HTMLElement} host */
function renderPurposesPanel(host) {
    const puPgOnly = rt.state.purposesPostgresqlOnly;
    const slots = readPurposeAllocationSlots();
    const bySlot = partitionPurposesBySlots(slots, rt.state.purposes);

    const introTitle = escapeHtml(oaaoT('settings.purposes.intro_title'));
    const introBody = oaaoT('settings.purposes.intro_body');
    const intro = `
<div class="oaao-sdlg-section-title mb-sm">${introTitle}</div>
<p class="oaao-sdlg-section-desc mb-md text-[0.8125rem] fg-[var(--grid-ink-muted)] max-w-[40rem] leading-relaxed">
  ${introBody}</p>`;

    if (puPgOnly) {
        replaceChildrenParsed(
            host,
            `${intro}
<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] mb-sm leading-snug max-w-[40rem]">
  ${oaaoT('settings.purposes.pg_only')}</p>`,
        );
        return;
    }

    if (!slots.length) {
        replaceChildrenParsed(
            host,
            `${intro}
<p class="text-[0.8125rem] fg-[var(--grid-caution,#b45309)] mb-sm leading-snug max-w-[40rem]">
  ${oaaoT('settings.purposes.slots_missing')}</p>
<div class="rounded-md border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] overflow-hidden">${orphanPurposeRowsHtml(rt.state.purposes, oaaoT('settings.purposes.orphan_empty'))}</div>`,
        );
        return;
    }

    const pipelineSlots = slots.filter((s) => s.fallback !== true);
    const fbSlot = slots.find((s) => s.fallback === true);
    const orphanBucket = fbSlot && typeof fbSlot.slot_id === 'string' ? bySlot.get(fbSlot.slot_id) || [] : [];

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'flex flex-col gap-0 min-w-0';
    for (const slot of pipelineSlots) {
        const sid = typeof slot.slot_id === 'string' ? slot.slot_id : '';
        const pfx = typeof slot.purpose_key_prefix === 'string' ? slot.purpose_key_prefix.trim() : '';
        if (!sid || !pfx) continue;
        const bucket = bySlot.get(sid) || [];
        const primary = findPrimaryPurposeRow(bucket, pfx);
        const card = buildPurposePipelineCard(slot, primary, rt.state.chatProfiles);
        if (card) cardsWrap.appendChild(card);
    }

    const otherSummary = escapeHtml(oaaoT('settings.purposes.other_section', '', { count: String(orphanBucket.length) }));
    const otherSection =
        fbSlot && orphanBucket.length > 0
            ? `<details class="group mb-2 mt-3 overflow-hidden rounded-md border border-[var(--grid-line)] bg-[var(--grid-panel-bright)]">
  <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden hover:bg-[rgba(55,53,47,0.04)]">
    <span class="min-w-0 flex-1 text-[0.875rem] fw-semibold fg-[var(--grid-ink)]">${otherSummary}</span>
    <i class="ri-arrow-down-s-line rz-icon shrink-0 text-[1.125rem] fg-[var(--grid-ink-muted)] transition-transform duration-200 group-open:rotate-180" aria-hidden="true"></i>
  </summary>
  <div class="border-t border-[var(--grid-line)] bg-[var(--grid-paper)]">${orphanPurposeRowsHtml(orphanBucket)}</div>
</details>`
            : '';

    replaceChildrenMixed(host, [intro, cardsWrap, otherSection || undefined]);
}

/** @param {HTMLElement} host — endpoints tab (LLM registry list). */
function renderEndpointsPanel(host) {
    const secDesc = oaaoT('settings.endpoints.section_desc');
    const epCards = endpointCardsHtml();

    const titleEl = ruiBuild({
        t: 'div',
        j: 'oaao-sdlg-section-title mb-sm',
        txt: oaaoT('settings.endpoints.section_title'),
    });

    const descEl = ruiBuild({
        t: 'p',
        j: 'oaao-sdlg-section-desc mb-md text-[0.8125rem] fg-[var(--grid-ink-muted)] max-w-[40rem] leading-relaxed',
    });
    mountParsedHtml(descEl, secDesc);

    const addBtn = ruiBuild({
        t: 'button',
        j: SETTINGS_BTN_PRIMARY_JIT,
        a: { type: 'button', 'data-act': 'ep-add' },
        txt: oaaoT('settings.endpoints.add'),
    });

    const toolbar = ruiBuild({
        t: 'div',
        j: 'flex justify-end mb-md',
        c: [addBtn],
    });

    const hintEl = ruiBuild({
        t: 'p',
        j: 'text-[0.8125rem] fg-[var(--grid-ink-muted)] mb-sm leading-snug',
        txt: oaaoT('settings.endpoints.cards_hint'),
    });

    const listCol = document.createElement('div');
    listCol.className = 'flex min-w-0 flex-col';
    if (epCards.trim()) {
        mountParsedHtml(listCol, epCards);
    } else {
        listCol.appendChild(
            ruiBuild({
                t: 'p',
                j: 'rounded-lg border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-4 py-6 text-center text-[0.875rem] fg-[var(--grid-ink-muted)]',
                txt: oaaoT('settings.endpoints.empty'),
            }),
        );
    }

    replaceChildrenMixed(host, [titleEl, descEl, toolbar, hintEl, listCol]);
}

/** @param {HTMLElement} host */
function render(host) {
    const mode = readPanelMode(host);

    if (mode === 'endpoints') {
        renderEndpointsPanel(host);
        return;
    }

    renderPurposesPanel(host);
}

export {
    escapeHtml,
    readPanelMode,
    writePanelMode,
    readPurposeAllocationSlots,
    endpointEditorFormHtml,
    purposeEditorFormHtml,
    endpointOptionHtml,
    render,
};

