/**
 * Admin Settings — Chat completion profiles ({@code oaao_chat_endpoint} + {@code oaao_chat_endpoint_llm}).
 *
 * Cursor / embedded previews may expose this graph with {@code import.meta.url} as {@code blob:…}; {@code new URL(…, import.meta.url)}
 * then produces bogus paths (duplicate {@code /webassets/…/webassets/}). Build same-origin URLs from {@code data-oaao-mount-prefix}
 * + {@code window.location} only — aligns with Apache rewrite ({@see backbone/.htaccess}).
 */

/** @param {string} relUnderCoreDefault No leading slash, e.g. {@code js/oaao-i18n.js} */
function oaaoChatCoreDynamicImportHref(relUnderCoreDefault) {
    let pathOnly = `/webassets/core/default/${String(relUnderCoreDefault ?? '').replace(/^\/+/, '')}`.replace(
        /\/{2,}/g,
        '/',
    );

    const rawMount = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    if (rawMount !== '' && rawMount !== '/') {
        const pref = (rawMount.startsWith('/') ? rawMount : `/${rawMount}`).replace(/\/+$/, '');
        if (pref !== '' && !(pathOnly === pref || pathOnly.startsWith(`${pref}/`))) {
            pathOnly = `${pref}${pathOnly}`.replace(/\/{2,}/g, '/');
        }
    }

    let s = pathOnly;
    const dup = /\/webassets\/(core|chat|endpoints|vault)\/([^/]+)\/webassets(?:\/|$)/;
    while (dup.test(s)) {
        s = s.replace(dup, '/webassets/$1/$2/');
    }
    s = s.replace(/(\/webassets\/core\/[^/]+)\/js\/razyui\//gi, '$1/razyui/');
    pathOnly = s.replace(/\/{2,}/g, '/');

    if (
        typeof window !== 'undefined' &&
        window.location &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ) {
        const o = window.location.origin;
        if (o && o !== 'null') {
            return `${o}${pathOnly}`;
        }
    }

    return pathOnly;
}

const [_mI18n, _mJit, _mRz, _mLoading] = await Promise.all([
    import(/* webpackIgnore: true */ oaaoChatCoreDynamicImportHref('js/oaao-i18n.js')),
    import(/* webpackIgnore: true */ oaaoChatCoreDynamicImportHref('js/oaao-jit-dsl.js')),
    import(/* webpackIgnore: true */ oaaoChatCoreDynamicImportHref('razyui/razyui.js')),
    import(/* webpackIgnore: true */ oaaoChatCoreDynamicImportHref('js/oaao-loading-logo.js')),
]);

const { oaaoT } = _mI18n;
const {
    mountParsedHtml,
    replaceChildrenParsed,
    replaceSelectOptionsParsed,
    ruiBuild,
    SETTINGS_BTN_PRIMARY_JIT,
} = _mJit;
const razyui = _mRz.default;
const { oaaoMountLoadingLogo } = _mLoading;

/** @param {unknown} v */
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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

function chatApiBase() {
    const authBase = (typeof document !== 'undefined' && document.body?.dataset?.authBase || '').trim();
    if (authBase) {
        try {
            const u = new URL(authBase, window.location.href);
            let rootPath = u.pathname.replace(/\/?$/, '');
            rootPath = rootPath.replace(/\/auth$/i, '') || '/';
            if (!rootPath.endsWith('/')) rootPath += '/';

            return `${rootPath}chat/api/`;
        } catch {
            /* fall through */
        }
    }

    return '/chat/api/';
}

/** @param {string} base @param {string} action */
function apiUrl(base, action) {
    return `${base}${action.replace(/^\/+/, '')}`;
}

/** @param {string} url @param {RequestInit} [options] */
async function fetchJson(url, options = {}) {
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

/** @type {{ endpoints: Array<Record<string, unknown>> }} */
const state = { endpoints: [] };

/** @type {Array<{ close: () => void }>} */
const nestedDialogControls = [];

/** @type {{ Dialog?: unknown, JIT?: { hydrate?: (root: Element | DocumentFragment) => void }, razyui?: unknown } | null} */
let mountCtx = null;

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

/** @param {unknown} raw */
function parseProfileVersion(raw) {
    const cfg = parseChatProfileConfig(raw);
    return cfg.profile_version || '';
}

/** @param {unknown} raw */
function parseChatProfileConfig(raw) {
    /** @type {Record<string, unknown>} */
    let o = {};
    try {
        const s = String(raw ?? '').trim();
        if (s) {
            const p = JSON.parse(s);
            if (p && typeof p === 'object' && p !== null) {
                o = /** @type {Record<string, unknown>} */ (p);
            }
        }
    } catch {
        /* ignore */
    }
    const temperature =
        typeof o.temperature === 'number' && !Number.isNaN(o.temperature) ? o.temperature : 0.7;
    const fast_judgment_threshold =
        typeof o.fast_judgment_threshold === 'number' && !Number.isNaN(o.fast_judgment_threshold)
            ? o.fast_judgment_threshold
            : 0.7;
    const profile_version = typeof o.profile_version === 'string' ? o.profile_version.trim() : '';
    return { temperature, fast_judgment_threshold, profile_version };
}

/** @param {unknown} t */
function normalizeProfileType(t) {
    const x = String(t ?? 'single').toLowerCase();
    if (x === 'tree' || x === 'tot' || x === 'thought_tree') return 'tree';
    if (x === 'ddtree' || x === 'dd_tree') return 'ddtree';
    return 'single';
}

/**
 * @param {HTMLFormElement} form
 * @param {unknown} existingConfigRaw prior {@code config_json}
 */
function buildConfigJsonFromForm(form, existingConfigRaw) {
    const prev = parseChatProfileConfig(existingConfigRaw);
    const tempEl = form.elements.namedItem('temperature');
    const fjtEl = form.elements.namedItem('fast_judgment_threshold');
    const temperature =
        tempEl instanceof HTMLInputElement ? parseFloat(tempEl.value) : prev.temperature;
    const fast_judgment_threshold =
        fjtEl instanceof HTMLInputElement ? parseFloat(fjtEl.value) : prev.fast_judgment_threshold;
    /** @type {Record<string, unknown>} */
    const cfg = {
        temperature,
        fast_judgment_threshold,
    };
    if (prev.profile_version) {
        cfg.profile_version = prev.profile_version;
    }
    return cfg;
}

/** @param {HTMLFormElement} form */
function wireChatEpSliders(form) {
    const temp = form.elements.namedItem('temperature');
    const fjt = form.elements.namedItem('fast_judgment_threshold');
    const tempOut = form.querySelector('[data-oaao-temp-out]');
    const fjtOut = form.querySelector('[data-oaao-fjt-out]');
    const sync = () => {
        if (temp instanceof HTMLInputElement && tempOut) {
            tempOut.textContent = Number(temp.value).toFixed(2);
        }
        if (fjt instanceof HTMLInputElement && fjtOut) {
            fjtOut.textContent = Number(fjt.value).toFixed(2);
        }
    };
    if (temp instanceof HTMLInputElement) razyui(temp).on('input change', sync);
    if (fjt instanceof HTMLInputElement) razyui(fjt).on('input change', sync);
    sync();
}

/** @param {string} type */
function typeBadgeHtml(type) {
    const t = normalizeProfileType(type);
    const label =
        t === 'tree'
            ? oaaoT('chat.profile.type.tree_short')
            : t === 'ddtree'
              ? oaaoT('chat.profile.type.ddtree_short')
              : oaaoT('chat.profile.type.single_short');
    return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] fw-semibold tracking-wide bg-[rgba(109,40,217,0.12)] fg-[#6d28d9]">${escapeHtml(label)}</span>`;
}

/** Picker list — compact type tag (aligns with DB type). */
/** @param {unknown} typRaw */
function profileModePickerTag(typRaw) {
    const t = normalizeProfileType(typRaw);
    if (t === 'tree') return oaaoT('chat.profile.type.tree_short');
    if (t === 'ddtree') return oaaoT('chat.profile.type.ddtree_short');
    return oaaoT('chat.profile.type.single_short');
}

/** @param {unknown} typRaw */
function profileModePickerDescription(typRaw) {
    const t = normalizeProfileType(typRaw);
    if (t === 'tree') return oaaoT('chat.profile.desc.tree');
    if (t === 'ddtree') return oaaoT('chat.profile.desc.ddtree');
    return oaaoT('chat.profile.desc.single');
}

/** @param {unknown} typRaw */
function profileDefaultViewMode(typRaw) {
    const t = normalizeProfileType(typRaw);
    if (t === 'tree') return oaaoT('chat.profile.default_view_mode.tree');
    if (t === 'ddtree') return oaaoT('chat.profile.default_view_mode.ddtree');
    return oaaoT('chat.profile.default_view_mode.single');
}

/** @param {ReadonlyArray<Record<string, unknown>>} profiles */
function profilePickerSummaryProfile(profiles) {
    const list = Array.isArray(profiles) ? profiles : [];
    const def = list.find((p) => Number(p?.is_default) === 1);
    if (def) return def;
    const en = list.find((p) => Number(p?.is_enabled) === 1);
    if (en) return en;
    return list[0] ?? null;
}

/**
 * One row in the purpose-allocation profile picker — {@link ruiBuild} tree (keeps {@code data-act} hooks stable).
 *
 * @param {Record<string, unknown>} p
 * @returns {HTMLElement}
 */
function buildChatProfilePickerRow(p) {
    const id = Number(p.id);
    const typ = normalizeProfileType(p.type);
    const modeLbl = profileModePickerTag(typ);
    const desc = profileModePickerDescription(typ);
    const isDef = Number(p.is_default) === 1;
    const enabled = Number(p.is_enabled) === 1;
    const cfg = parseChatProfileConfig(p.config_json);
    const tuneTxt =
        typ !== 'single'
            ? oaaoT('chat.profile.summary.temp_fjt', '', {
                  t: cfg.temperature.toFixed(2),
                  f: cfg.fast_judgment_threshold.toFixed(2),
              })
            : oaaoT('chat.profile.summary.temp', '', { t: cfg.temperature.toFixed(2) });

    /** @type {Record<string, string>} */
    const rootAttrs = { 'data-oaao-chat-profile-card': '' };
    if (Number.isFinite(id)) rootAttrs['data-chat-eid'] = String(id);
    if (!enabled) rootAttrs['data-oaao-chat-ep-disabled'] = '1';

    const rowJit = [
        'border-b border-[var(--grid-line)] px-3 py-2.5 last:border-b-0 hover:bg-[rgba(55,53,47,0.03)]',
        enabled ? '' : 'opacity-[0.72] saturate-[0.7]',
    ]
        .filter(Boolean)
        .join(' ');

    const rightCol = [
        {
            t: 'span',
            j: 'inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] fw-semibold tracking-wide bg-[rgba(109,40,217,0.12)] fg-[#6d28d9]',
            txt: modeLbl,
        },
    ];
    if (isDef) {
        rightCol.push({
            t: 'i',
            j: 'ri-check-line rz-icon text-[1.125rem] fg-[var(--grid-accent)]',
            a: { 'aria-hidden': 'true' },
        });
    }

    const defaultCb = /** @type {HTMLInputElement} */ (
        ruiBuild({
            t: 'input',
            a: {
                type: 'checkbox',
                'data-act': 'ch-ep-default',
                class: 'rounded border-[var(--grid-line)]',
            },
        })
    );
    defaultCb.checked = isDef;

    return ruiBuild({
        t: 'div',
        j: rowJit,
        a: rootAttrs,
        c: [
            {
                t: 'div',
                j: 'flex items-start gap-2',
                c: [
                    {
                        t: 'div',
                        j: 'min-w-0 flex-1',
                        c: [
                            {
                                t: 'span',
                                j: 'block text-[0.875rem] fw-semibold fg-[var(--grid-ink)] leading-snug',
                                txt: String(p.name ?? ''),
                            },
                            {
                                t: 'span',
                                j: 'mt-0.5 block text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug',
                                txt: desc,
                            },
                            {
                                t: 'span',
                                j: 'mt-1 block text-[0.6875rem] fg-[var(--grid-ink-muted)] tabular-nums',
                                txt: tuneTxt,
                            },
                        ],
                    },
                    { t: 'div', j: 'flex shrink-0 flex-col items-end gap-1 pt-0.5', c: rightCol },
                ],
            },
            {
                t: 'div',
                j: 'mt-2 flex flex-wrap items-center gap-x-3 gap-y-1',
                c: [
                    ruiBuild({
                        t: 'button',
                        j: 'text-[0.75rem] fg-[var(--grid-accent)] hover:underline bg-transparent border-0 cursor-pointer font-inherit p-0',
                        a: { type: 'button', 'data-act': 'ch-ep-edit' },
                        txt: oaaoT('chat.profile.edit'),
                    }),
                    ruiBuild({
                        t: 'button',
                        j: 'text-[0.75rem] fg-[var(--grid-caution,#b45309)] hover:underline bg-transparent border-0 cursor-pointer font-inherit p-0',
                        a: { type: 'button', 'data-act': 'ch-ep-del' },
                        txt: oaaoT('chat.profile.delete'),
                    }),
                    {
                        t: 'label',
                        j: 'flex cursor-pointer select-none items-center gap-1.5 text-[0.75rem] fg-[var(--grid-ink-muted)]',
                        c: [defaultCb, { t: 'span', txt: oaaoT('chat.profile.set_default') }],
                    },
                ],
            },
        ],
    });
}

/**
 * Purpose allocation — dropdown-style profile list as a composed DSL tree (expand/collapse {@code <details>}
 * stays closed until the user opens it).
 *
 * @param {ReadonlyArray<Record<string, unknown>>} profiles
 * @returns {HTMLElement}
 */
export function buildChatCompletionProfilesPicker(profiles) {
    const list = Array.isArray(profiles) ? profiles : [];
    const head = profilePickerSummaryProfile(list);

    const summaryHeadChildren = [
        {
            t: 'span',
            j: 'text-[0.875rem] fw-semibold fg-[var(--grid-ink)] leading-snug',
            txt: oaaoT('chat.profile.head_title'),
        },
    ];
    if (list.length > 0) {
        summaryHeadChildren.push({
            t: 'span',
            j: 'inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] fw-semibold tracking-wide bg-[rgba(109,40,217,0.12)] fg-[#6d28d9]',
            a: { 'aria-label': oaaoT('chat.profile.count_aria') },
            txt: String(list.length),
        });
    }

    const hintJit = 'mt-0.5 text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug';
    /** @type {HTMLElement} */
    let summaryHintEl;
    if (list.length === 0) {
        summaryHintEl = ruiBuild({ t: 'div', j: hintJit, txt: oaaoT('chat.profile.hint_empty_list') });
    } else if (head) {
        summaryHintEl = ruiBuild({ t: 'div', j: hintJit });
        mountParsedHtml(
            summaryHintEl,
            oaaoT('chat.profile.hint_default', '', {
                name: escapeHtml(String(head.name ?? '')),
                mode: escapeHtml(profileDefaultViewMode(head.type)),
            }),
        );
    } else {
        summaryHintEl = ruiBuild({ t: 'div', j: hintJit, txt: oaaoT('chat.profile.hint_expand') });
    }

    const listBody =
        list.length > 0
            ? ruiBuild({
                  t: 'div',
                  j: 'max-h-[min(22rem,50vh)] overflow-y-auto overscroll-contain',
                  c: list.map((row) => buildChatProfilePickerRow(row)),
              })
            : ruiBuild({
                  t: 'p',
                  j: 'px-3 py-6 text-center text-[0.8125rem] fg-[var(--grid-ink-muted)]',
                  txt: oaaoT('chat.profile.list_empty'),
              });

    return ruiBuild({
        t: 'div',
        j: 'flex min-w-0 flex-col gap-2',
        c: [
            {
                t: 'div',
                j: 'flex justify-end',
                c: [
                    ruiBuild({
                        t: 'button',
                        j: SETTINGS_BTN_PRIMARY_JIT,
                        a: { type: 'button', 'data-act': 'ch-ep-add' },
                        txt: oaaoT('chat.profile.create_btn'),
                    }),
                ],
            },
            {
                t: 'details',
                j: 'group rounded-lg border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[0_1px_0_rgba(0,0,0,0.03)] overflow-hidden',
                c: [
                    {
                        t: 'summary',
                        j: 'flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden hover:bg-[rgba(55,53,47,0.04)]',
                        c: [
                            {
                                t: 'div',
                                j: 'min-w-0 flex-1',
                                c: [
                                    {
                                        t: 'div',
                                        j: 'flex flex-wrap items-center gap-x-2 gap-y-1',
                                        c: summaryHeadChildren,
                                    },
                                    summaryHintEl,
                                ],
                            },
                            ruiBuild({
                                t: 'i',
                                j: 'ri-arrow-down-s-line rz-icon shrink-0 text-[1.125rem] fg-[var(--grid-ink-muted)] transition-transform duration-200 group-open:rotate-180',
                                a: { 'aria-hidden': 'true' },
                            }),
                        ],
                    },
                    {
                        t: 'div',
                        j: 'bg-[var(--grid-paper)]',
                        c: [listBody],
                    },
                ],
            },
        ],
    });
}

/** @param {string} role */
function roleHeading(role) {
    const r = String(role ?? '').toLowerCase();
    if (r === 'default') return oaaoT('chat.profile.role.default');
    if (r === 'hint') return oaaoT('chat.profile.role.hint');
    if (r === 'expand') return oaaoT('chat.profile.role.expand');
    if (r === 'judge') return oaaoT('chat.profile.role.judge');
    return r.toUpperCase();
}

/**
 * @param {ReadonlyArray<Record<string, unknown>>} endpointsList
 * @param {unknown} selectedId
 */
function endpointSelectOptionsHtml(endpointsList, selectedId) {
    const list = Array.isArray(endpointsList) ? endpointsList : [];
    const sel = selectedId != null && selectedId !== '' ? Number(selectedId) : NaN;
    let html = `<option value="">${escapeHtml(oaaoT('chat.profile.select_endpoint'))}</option>`;
    for (const r of list) {
        const id = Number(r.id);
        const picked = Number.isFinite(id) && id === sel ? ' selected' : '';
        const label = `${String(r.name ?? '')} · ${String(r.model ?? '')}`;
        html += `<option value="${Number.isFinite(id) ? id : ''}"${picked}>${escapeHtml(label)}</option>`;
    }
    return html;
}

/**
 * @param {Record<string, unknown>} p
 * @param {Record<string, unknown>} [overrides]
 */
function profileToPayload(p, overrides = {}) {
    const typ = normalizeProfileType(p.type);
    const llmsRaw = Array.isArray(p.llms) ? p.llms : [];
    /** @type {Array<{ endpoint_id: number, role: string }>} */
    const llms = [];
    for (const row of llmsRaw) {
        if (!row || typeof row !== 'object') continue;
        const o = /** @type {Record<string, unknown>} */ (row);
        const eid = Number(o.endpoint_id ?? 0);
        const role = String(o.role ?? '').trim().toLowerCase();
        if (Number.isFinite(eid) && eid > 0 && role) {
            llms.push({ endpoint_id: eid, role });
        }
    }
    const pv = parseProfileVersion(p.config_json);
    return {
        ...(Number(p.id) > 0 ? { id: Number(p.id) } : {}),
        name: String(p.name ?? ''),
        type: typ,
        is_enabled: Number(p.is_enabled) === 1,
        is_default: Number(p.is_default) === 1,
        profile_version: pv,
        llms,
        ...overrides,
    };
}

/**
 * @param {Record<string, unknown>} p
 * @param {string} typ normalized type
 */
function chatProfileLlmGridHtml(p, typ) {
    const llms = Array.isArray(p.llms) ? p.llms : [];
    const order = typ === 'single' ? ['default'] : ['hint', 'expand', 'judge'];
    /** @type {Record<string, Record<string, unknown>>} */
    const byRole = {};
    for (const row of llms) {
        if (!row || typeof row !== 'object') continue;
        const o = /** @type {Record<string, unknown>} */ (row);
        const role = String(o.role ?? '').toLowerCase();
        if (role) byRole[role] = o;
    }

    let llmBlocks = '';
    for (const role of order) {
        const row = byRole[role];
        if (!row) continue;
        const epName = escapeHtml(row.endpoint_name ?? '');
        const epModel = escapeHtml(row.endpoint_model ?? '');
        const rh = escapeHtml(roleHeading(role));
        llmBlocks += `<div class="rounded border border-[var(--grid-line)] bg-[var(--grid-paper)] px-2 py-1.5 text-[0.8125rem]">
  <div class="text-[0.6875rem] fw-semibold fg-[var(--grid-caption,var(--grid-ink-muted))] mb-0.5">${rh}</div>
  <div class="font-mono text-[0.75rem] sm:text-[0.8125rem] fg-[var(--grid-ink)] break-all">${epName} · ${epModel}</div>
</div>`;
    }
    if (!llmBlocks) {
        llmBlocks = `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)]">${escapeHtml(oaaoT('chat.profile.no_llm'))}</p>`;
    }
    return `<div class="grid gap-2 border-t border-[var(--grid-line)] pt-2">${llmBlocks}</div>`;
}

/**
 * Purpose allocation — nested collapsible profile row (legacy accordion-style).
 *
 * @param {Record<string, unknown>} p
 */
export function chatProfileNestedDetailsHtml(p) {
    const id = Number(p.id);
    const enabled = Number(p.is_enabled) === 1;
    const isDef = Number(p.is_default) === 1;
    const name = escapeHtml(p.name);
    const typ = normalizeProfileType(p.type);
    const cfg = parseChatProfileConfig(p.config_json);
    const ver = cfg.profile_version;
    const dimClass = enabled ? '' : ' opacity-[0.72] saturate-[0.7]';
    const disabledAttr = enabled ? '' : ' data-oaao-chat-ep-disabled="1"';
    const disabledLblHtml = escapeHtml(oaaoT('chat.profile.disabled'));
    const disabledLbl = enabled
        ? ''
        : `<div class="mt-2 flex justify-end pt-0.5"><span class="text-[0.6875rem] fw-semibold uppercase tracking-wide fg-[var(--grid-ink-muted)]">${disabledLblHtml}</span></div>`;

    const tuneSummary =
        typ !== 'single'
            ? escapeHtml(
                  oaaoT('chat.profile.summary.temp_fjt', '', {
                      t: cfg.temperature.toFixed(2),
                      f: cfg.fast_judgment_threshold.toFixed(2),
                  }),
              )
            : escapeHtml(oaaoT('chat.profile.summary.temp', '', { t: cfg.temperature.toFixed(2) }));

    const verHtml = ver
        ? `<span class="text-[0.8125rem] fg-[var(--grid-ink-muted)] tabular-nums">${escapeHtml(ver)}</span>`
        : '';

    const llmGrid = chatProfileLlmGridHtml(p, typ);

    const actionsAria = escapeHtml(oaaoT('chat.profile.actions_aria'));
    const editL = escapeHtml(oaaoT('chat.profile.edit'));
    const delL = escapeHtml(oaaoT('chat.profile.delete'));
    const setDef = escapeHtml(oaaoT('chat.profile.set_default'));

    return `<details data-chat-eid="${Number.isFinite(id) ? id : ''}" data-oaao-chat-profile-card${disabledAttr} class="group oaao-chat-profile-card mb-2 last:mb-0 rounded-md border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[0_1px_0_rgba(0,0,0,0.03)] overflow-hidden${dimClass}">
  <summary class="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 sm:px-3 [&::-webkit-details-marker]:hidden hover:bg-[rgba(55,53,47,0.04)]">
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-[0.875rem] fw-semibold fg-[var(--grid-ink)]">${name}</span>
        <span class="flex flex-wrap items-center gap-x-2 gap-y-1">${typeBadgeHtml(typ)}${verHtml}</span>
      </div>
      <span class="text-[0.6875rem] fg-[var(--grid-ink-muted)] tabular-nums">${tuneSummary}</span>
    </div>
    <i class="ri-arrow-down-s-line rz-icon shrink-0 text-[1.125rem] fg-[var(--grid-ink-muted)] transition-transform duration-200 group-open:rotate-180" aria-hidden="true"></i>
  </summary>
  <div class="border-t border-[var(--grid-line)] px-2.5 pb-2.5 pt-2 sm:px-3">
    <div class="flex justify-end mb-2">
      <div class="inline-flex shrink-0 overflow-hidden rounded border border-[var(--grid-line)] bg-[var(--grid-paper)] text-[0.8125rem]" role="group" aria-label="${actionsAria}">
        <button type="button" data-act="ch-ep-edit" class="px-2 py-1 fw-medium fg-[var(--grid-accent)] hover:bg-[rgba(55,53,47,0.06)] bg-transparent border-0 cursor-pointer font-inherit leading-none whitespace-nowrap">${editL}</button>
        <span class="w-px shrink-0 self-stretch bg-[var(--grid-line)]" aria-hidden="true"></span>
        <button type="button" data-act="ch-ep-del" class="px-2 py-1 fw-medium fg-[var(--grid-caution,#b45309)] hover:bg-[rgba(55,53,47,0.06)] bg-transparent border-0 cursor-pointer font-inherit leading-none whitespace-nowrap">${delL}</button>
      </div>
    </div>
    ${llmGrid}
    <label class="mt-2 flex items-center gap-2 text-[0.8125rem] cursor-pointer select-none">
      <input type="checkbox" data-act="ch-ep-default" class="rounded border-[var(--grid-line)]"${isDef ? ' checked' : ''} />
      <span>${setDef}</span>
    </label>${disabledLbl}
  </div>
</details>`;
}

function profilesSectionHtml() {
    const redirTitle = escapeHtml(oaaoT('chat.profile.redirect.title'));
    const redirBody = oaaoT('chat.profile.redirect.body');
    const asstTitle = escapeHtml(oaaoT('chat.settings.assistant_stream_title'));
    const asstDesc = oaaoT('chat.settings.assistant_stream_desc');
    const phased = escapeHtml(oaaoT('chat.settings.phased_stream_checkbox'));
    return `
<div class="oaao-sdlg-section-title mb-sm">${redirTitle}</div>
<p class="oaao-sdlg-section-desc mb-md text-[0.8125rem] fg-[var(--grid-ink-muted)] max-w-[40rem] leading-relaxed">
  ${redirBody}</p>
<div class="oaao-sdlg-section-title mt-lg mb-sm">${asstTitle}</div>
<p class="oaao-sdlg-section-desc mb-md text-[0.8125rem] fg-[var(--grid-ink-muted)] max-w-[40rem] leading-relaxed">
  ${asstDesc}</p>
<label class="flex items-center gap-sm text-[0.875rem] fg-[var(--grid-ink-muted)] cursor-not-allowed opacity-70 select-none">
  <input type="checkbox" disabled class="rounded border-[var(--grid-line)]" />
  <span>${phased}</span>
</label>`;
}

/** @param {HTMLElement} host */
function render(host) {
    replaceChildrenParsed(host, profilesSectionHtml());
}

/** @param {HTMLElement} host */
async function reload(host) {
    const epUrl = apiUrl(endpointsApiBase(), 'endpoints_list');
    const er = await fetchJson(epUrl);
    if (!er.res.ok || !er.data?.success) {
        throw new Error(typeof er.data?.message === 'string' ? er.data.message : oaaoT('settings.errors.load_endpoints'));
    }
    state.endpoints = Array.isArray(er.data.endpoints) ? er.data.endpoints : [];
    render(host);
    mountCtx?.JIT?.hydrate?.(host);
}

function editorFormHtml() {
    const fjtHelp = oaaoT('chat.profile.form.fjt_help');
    return `<form id="oaao-ch-ep-form" class="grid gap-sm max-w-full">
  <input type="hidden" name="id" value="" />
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('chat.profile.form.name'))}</span><input name="name" required placeholder="${escapeHtml(oaaoT('chat.profile.form.name_ph'))}" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" /></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('chat.profile.form.type'))}</span>
    <select name="ptype" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-full min-w-0">
      <option value="single">${escapeHtml(oaaoT('chat.profile.type.single'))}</option>
      <option value="tree">${escapeHtml(oaaoT('chat.profile.type.tree'))}</option>
      <option value="ddtree">${escapeHtml(oaaoT('chat.profile.form.type_ddtree_long'))}</option>
    </select>
  </label>
  <div data-oaao-ch-ep-single="" class="grid gap-sm">
    <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('chat.profile.form.llm_default'))}</span><select name="ep_default" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-full min-w-0"></select></label>
  </div>
  <div data-oaao-ch-ep-tree="" class="hidden grid gap-sm">
    <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('chat.profile.form.llm_hint'))}</span><select name="ep_hint" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-full min-w-0"></select></label>
    <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('chat.profile.form.llm_expand'))}</span><select name="ep_expand" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-full min-w-0"></select></label>
    <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${escapeHtml(oaaoT('chat.profile.form.llm_judge'))}</span><select name="ep_judge" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-full min-w-0"></select></label>
  </div>
  <div data-oaao-ch-ep-tree-extra="" class="hidden grid gap-sm">
    <label class="flex flex-col gap-1 text-[0.8125rem]">
      <span class="flex justify-between gap-2 fg-[var(--grid-ink)]"><span class="fw-medium">${escapeHtml(oaaoT('chat.profile.form.fjt_label'))}</span><span data-oaao-fjt-out class="tabular-nums fg-[var(--grid-ink-muted)]">0.70</span></span>
      <input type="range" name="fast_judgment_threshold" min="0" max="1" step="0.01" value="0.7" class="w-full max-w-full accent-[var(--grid-accent)]" />
      <p class="text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${fjtHelp}</p>
    </label>
  </div>
  <label class="flex flex-col gap-1 text-[0.8125rem]">
    <span class="flex justify-between gap-2 fg-[var(--grid-ink)]"><span class="fw-medium">${escapeHtml(oaaoT('chat.profile.form.temp'))}</span><span data-oaao-temp-out class="tabular-nums fg-[var(--grid-ink-muted)]">0.70</span></span>
    <input type="range" name="temperature" min="0" max="2" step="0.01" value="0.7" class="w-full max-w-full accent-[var(--grid-accent)]" />
  </label>
  <label class="flex items-center gap-2 text-[0.8125rem] cursor-pointer"><input type="checkbox" name="is_enabled" checked class="rounded border-[var(--grid-line)]" /><span>${escapeHtml(oaaoT('chat.profile.form.enabled'))}</span></label>
  <label class="flex items-center gap-2 text-[0.8125rem] cursor-pointer"><input type="checkbox" name="is_default" class="rounded border-[var(--grid-line)]" /><span>${escapeHtml(oaaoT('chat.profile.form.is_default'))}</span></label>
  <p id="oaao-ch-ep-msg" class="text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem]" role="status"></p>
</form>`;
}

/**
 * @param {HTMLFormElement} form
 * @param {Record<string, unknown>|null} row
 * @param {ReadonlyArray<Record<string, unknown>>} [endpointsList]
 */
function fillEditorForm(form, row, endpointsList) {
    const eps = endpointsList ?? state.endpoints;
    const hid = form.querySelector('input[name="id"]');
    if (hid instanceof HTMLInputElement) hid.value = '';
    form.reset();
    const en = form.elements.namedItem('is_enabled');
    if (en instanceof HTMLInputElement) en.checked = true;
    const idef = form.elements.namedItem('is_default');
    if (idef instanceof HTMLInputElement) idef.checked = false;
    const ptypeSel = form.elements.namedItem('ptype');
    if (ptypeSel instanceof HTMLSelectElement) ptypeSel.value = 'single';

    const selDefault = form.elements.namedItem('ep_default');
    const selHint = form.elements.namedItem('ep_hint');
    const selExpand = form.elements.namedItem('ep_expand');
    const selJudge = form.elements.namedItem('ep_judge');
    const opts = endpointSelectOptionsHtml(eps, NaN);
    if (selDefault instanceof HTMLSelectElement) replaceSelectOptionsParsed(selDefault, opts);
    if (selHint instanceof HTMLSelectElement) replaceSelectOptionsParsed(selHint, opts);
    if (selExpand instanceof HTMLSelectElement) replaceSelectOptionsParsed(selExpand, opts);
    if (selJudge instanceof HTMLSelectElement) replaceSelectOptionsParsed(selJudge, opts);

    const tempIn = form.elements.namedItem('temperature');
    const fjtIn = form.elements.namedItem('fast_judgment_threshold');
    const cfg0 = parseChatProfileConfig(null);
    if (tempIn instanceof HTMLInputElement) tempIn.value = String(cfg0.temperature);
    if (fjtIn instanceof HTMLInputElement) fjtIn.value = String(cfg0.fast_judgment_threshold);

    if (!row) {
        syncEditorMode(form);
        return;
    }

    if (hid instanceof HTMLInputElement) hid.value = String(row.id ?? '');
    const nm = form.elements.namedItem('name');
    if (nm instanceof HTMLInputElement) nm.value = String(row.name ?? '');
    const typ = normalizeProfileType(row.type);
    if (ptypeSel instanceof HTMLSelectElement) {
        ptypeSel.value = typ === 'ddtree' ? 'ddtree' : typ === 'tree' ? 'tree' : 'single';
    }

    const cfg = parseChatProfileConfig(row.config_json);
    if (tempIn instanceof HTMLInputElement) tempIn.value = String(cfg.temperature);
    if (fjtIn instanceof HTMLInputElement) fjtIn.value = String(cfg.fast_judgment_threshold);

    const llms = Array.isArray(row.llms) ? row.llms : [];
    /** @type {Record<string, string>} */
    const byRole = {};
    for (const x of llms) {
        if (!x || typeof x !== 'object') continue;
        const o = /** @type {Record<string, unknown>} */ (x);
        const role = String(o.role ?? '').toLowerCase();
        const eid = String(o.endpoint_id ?? '');
        if (role && eid) byRole[role] = eid;
    }
    const setSel = (el, val) => {
        if (el instanceof HTMLSelectElement) el.value = val || '';
    };
    setSel(selDefault, byRole.default || '');
    setSel(selHint, byRole.hint || '');
    setSel(selExpand, byRole.expand || '');
    setSel(selJudge, byRole.judge || '');

    if (en instanceof HTMLInputElement) en.checked = Number(row.is_enabled) === 1;
    if (idef instanceof HTMLInputElement) idef.checked = Number(row.is_default) === 1;

    syncEditorMode(form);
}

/** @param {HTMLFormElement} form */
function syncEditorMode(form) {
    const sel = form.elements.namedItem('ptype');
    const v = sel instanceof HTMLSelectElement ? sel.value : 'single';
    const isMulti = v === 'tree' || v === 'ddtree';
    const singleWrap = form.querySelector('[data-oaao-ch-ep-single]');
    const treeWrap = form.querySelector('[data-oaao-ch-ep-tree]');
    const treeExtra = form.querySelector('[data-oaao-ch-ep-tree-extra]');
    if (singleWrap instanceof HTMLElement) {
        singleWrap.classList.toggle('hidden', isMulti);
        singleWrap.toggleAttribute('hidden', isMulti);
    }
    if (treeWrap instanceof HTMLElement) {
        treeWrap.classList.toggle('hidden', !isMulti);
        treeWrap.toggleAttribute('hidden', !isMulti);
    }
    if (treeExtra instanceof HTMLElement) {
        treeExtra.classList.toggle('hidden', !isMulti);
        treeExtra.toggleAttribute('hidden', !isMulti);
    }
}

/**
 * @param {HTMLFormElement} form
 * @returns {Array<{ endpoint_id: number, role: string }>}
 */
function readLlmsFromForm(form) {
    const sel = form.elements.namedItem('ptype');
    const v = sel instanceof HTMLSelectElement ? sel.value : 'single';
    if (v === 'tree' || v === 'ddtree') {
        const gh = form.elements.namedItem('ep_hint');
        const ge = form.elements.namedItem('ep_expand');
        const gj = form.elements.namedItem('ep_judge');
        const h = gh instanceof HTMLSelectElement ? parseInt(gh.value, 10) : 0;
        const e = ge instanceof HTMLSelectElement ? parseInt(ge.value, 10) : 0;
        const j = gj instanceof HTMLSelectElement ? parseInt(gj.value, 10) : 0;
        return [
            { endpoint_id: h, role: 'hint' },
            { endpoint_id: e, role: 'expand' },
            { endpoint_id: j, role: 'judge' },
        ];
    }
    const sd = form.elements.namedItem('ep_default');
    const id = sd instanceof HTMLSelectElement ? parseInt(sd.value, 10) : 0;
    return [{ endpoint_id: id, role: 'default' }];
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>|null} row
 * @param {{ endpointsList?: ReadonlyArray<Record<string, unknown>>, onSaved?: () => Promise<void> }} [opts]
 */
async function openProfileEditor(host, row, opts) {
    const endpointsList = opts?.endpointsList ?? state.endpoints;
    const onSaved = opts?.onSaved ?? (async () => {
        await reload(host);
    });
    if (!hasDialog()) {
        window.alert(oaaoT('chat.profile.dialog.no_shell'));
        return;
    }
    if (!endpointsList.length) {
        window.alert(oaaoT('chat.profile.dialog.no_endpoints'));
        return;
    }
    const Dialog = /** @type {new (o: Record<string, unknown>) => { getControl: () => { close?: () => void } }} */ (mountCtx.Dialog);
    const wrap = document.createElement('div');
    wrap.className = '[padding:0]';
    replaceChildrenParsed(wrap, editorFormHtml());
    const form = wrap.querySelector('#oaao-ch-ep-form');
    const msgEl = wrap.querySelector('#oaao-ch-ep-msg');
    if (!(form instanceof HTMLFormElement)) return;
    fillEditorForm(form, row, endpointsList);
    wireChatEpSliders(form);
    const ptypeSel = form.elements.namedItem('ptype');
    if (ptypeSel instanceof HTMLSelectElement) {
        razyui(ptypeSel).on('change', () => {
            syncEditorMode(form);
        });
    }

    const dlg = new Dialog({
        title: row ? oaaoT('chat.profile.dialog.edit_title') : oaaoT('chat.profile.dialog.create_title'),
        content: wrap,
        size: 'lg',
        closable: true,
        buttons: [
            { text: oaaoT('chat.profile.dialog.cancel'), color: 'muted', role: 'cancel' },
            {
                text: row ? oaaoT('chat.profile.dialog.save') : oaaoT('chat.profile.dialog.create'),
                color: 'accent',
                action: async () => {
                    const idStr = String(new FormData(form).get('id') || '').trim();
                    const sel = form.elements.namedItem('ptype');
                    const ptype = sel instanceof HTMLSelectElement ? sel.value : 'single';
                    const llms = readLlmsFromForm(form);
                    const config_json = buildConfigJsonFromForm(form, row?.config_json ?? null);
                    /** @type {Record<string, unknown>} */
                    const payload = {
                        ...(idStr ? { id: parseInt(idStr, 10) } : {}),
                        name: String(new FormData(form).get('name') || '').trim(),
                        type: ptype,
                        is_enabled: new FormData(form).get('is_enabled') === 'on',
                        is_default: new FormData(form).get('is_default') === 'on',
                        config_json,
                        llms,
                    };
                    if (msgEl) msgEl.textContent = oaaoT('chat.profile.dialog.saving');
                    const { res, data } = await fetchJson(apiUrl(chatApiBase(), 'chat_endpoints_save'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!res.ok || !data?.success) {
                        if (msgEl) {
                            msgEl.textContent =
                                typeof data?.message === 'string'
                                    ? data.message
                                    : oaaoT('chat.profile.dialog.save_failed', '', { status: String(res.status) });
                        }
                        return false;
                    }
                    try {
                        await onSaved();
                    } catch (e) {
                        if (msgEl) msgEl.textContent = e instanceof Error ? e.message : oaaoT('chat.profile.dialog.reload_failed');
                        return false;
                    }
                    return undefined;
                },
            },
        ],
        onOpen: (ctrl) => {
            mountCtx?.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
        },
    });
    trackDialog(dlg);
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} profile
 * @param {boolean} isDefault
 * @param {() => Promise<void>} [onReload]
 */
async function patchDefault(host, profile, isDefault, onReload) {
    const reloadFn =
        typeof onReload === 'function'
            ? onReload
            : async () => {
                  await reload(host);
              };
    const payload = profileToPayload(profile, { is_default: isDefault });
    const { res, data } = await fetchJson(apiUrl(chatApiBase(), 'chat_endpoints_save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok || !data?.success) {
        window.alert(
            typeof data?.message === 'string'
                ? data.message
                : oaaoT('chat.profile.dialog.save_failed', '', { status: String(res.status) }),
        );
        await reloadFn();
        return;
    }
    await reloadFn();
}

/**
 * Purpose allocation panel — open create/edit dialog (shared with legacy Chat nav copy).
 *
 * @param {HTMLElement} panelHost
 * @param {Record<string, unknown>|null} row
 * @param {{ Dialog?: unknown, JIT?: unknown }} ctx
 * @param {ReadonlyArray<Record<string, unknown>>} endpointsList
 * @param {() => Promise<void>} onReload
 */
export async function openPurposesChatProfileEditor(panelHost, row, ctx, endpointsList, onReload) {
    mountCtx = ctx && typeof ctx === 'object' ? ctx : null;
    await openProfileEditor(panelHost, row, { endpointsList, onSaved: onReload });
}

/**
 * @param {unknown} ctx
 * @param {number} profileId
 * @param {() => Promise<void>} onReload
 */
export async function deletePurposesChatProfile(ctx, profileId, onReload) {
    mountCtx = ctx && typeof ctx === 'object' ? ctx : null;
    const eid = Number(profileId);
    if (!Number.isFinite(eid) || eid < 1) return;
    const ok = await confirmDestructive(
        oaaoT('chat.profile.delete_confirm_title'),
        `<p class="text-[0.8125rem] m-0">${oaaoT('chat.profile.delete_confirm_body', '', { id: escapeHtml(String(eid)) })}</p>`
    );
    if (!ok) return;
    const { res, data } = await fetchJson(apiUrl(chatApiBase(), 'chat_endpoints_delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: eid }),
    });
    if (!res.ok || !data?.success) {
        window.alert(
            typeof data?.message === 'string'
                ? data.message
                : oaaoT('chat.profile.delete_failed', '', { status: String(res.status) }),
        );
        return;
    }
    await onReload();
}

/**
 * @param {HTMLElement} panelHost
 * @param {Record<string, unknown>} profile
 * @param {boolean} isDefault
 * @param {unknown} ctx
 * @param {() => Promise<void>} onReload
 */
export async function patchPurposesChatProfileDefault(panelHost, profile, isDefault, ctx, onReload) {
    mountCtx = ctx && typeof ctx === 'object' ? ctx : null;
    await patchDefault(panelHost, profile, isDefault, onReload);
}

/** Chat completion profiles are edited under Purpose allocation; nothing to delegate here. */
function bindPanelDelegation(_host) {}

/**
 * @param {HTMLElement} host
 * @param {{ razyui?: unknown, section?: Record<string, unknown>, Dialog?: unknown, JIT?: unknown }} [ctx]
 */
export async function mountSettingsPanel(host, ctx) {
    mountCtx = ctx && typeof ctx === 'object' ? ctx : null;
    if (host.dataset.oaaoChatSettingsBound !== '1') {
        bindPanelDelegation(host);
        host.dataset.oaaoChatSettingsBound = '1';
    }
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: oaaoT('settings.dialog.loading_panel') });
    try {
        await reload(host);
    } catch (e) {
        host.replaceChildren();
        host.appendChild(
            ruiBuild({
                t: 'p',
                j: 'text-sm fg-[var(--grid-ink-muted)]',
                txt: e instanceof Error ? e.message : oaaoT('settings.errors.load_generic'),
            }),
        );
    }
}

export function teardownSettingsPanel() {
    closeNestedDialogs();
    mountCtx = null;
}
