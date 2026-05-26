/**
 * Article Research workspace panel — watch CRUD + manual run.
 */

/** @type {((spec: string) => string) | null} */
let resolveRegistryUrl = null;
/** @type {number} */
let mountGeneration = 0;
/** @type {AbortController | null} */
let mountAbort = null;
/** @type {ReturnType<typeof setInterval> | null} */
let researchQueuePollTimer = null;
/** @type {Set<number>} */
const researchQueueMonitorExpanded = new Set();

function stopResearchQueuePoll() {
    if (researchQueuePollTimer) {
        clearInterval(researchQueuePollTimer);
        researchQueuePollTimer = null;
    }
}

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

async function ensureRegistryUrlResolver() {
    if (resolveRegistryUrl) return resolveRegistryUrl;
    let importPath = '/webassets/core/default/js/shell-registry-url.js';
    const prefix = mountPrefix();
    if (prefix && prefix !== '/') {
        importPath = `${prefix.replace(/\/+$/, '')}${importPath}`.replace(/\/{2,}/g, '/');
    }
    try {
        const mod = await import(/* webpackIgnore: true */ importPath);
        if (typeof mod.resolveShellRegistryUrl === 'function') {
            resolveRegistryUrl = mod.resolveShellRegistryUrl;
            return resolveRegistryUrl;
        }
    } catch {
        /* fallback below */
    }
    resolveRegistryUrl = (spec) => {
        const s = String(spec ?? '').trim();
        const candidate = s.startsWith('/') ? s : `/${s}`;
        const p = mountPrefix();
        if (!p || p === '/') return candidate;
        if (candidate === p || candidate.startsWith(`${p}/`)) return candidate;
        return `${p}${candidate}`.replace(/\/{2,}/g, '/');
    };
    return resolveRegistryUrl;
}

async function apiUrl(path) {
    const resolve = await ensureRegistryUrlResolver();
    const base = resolve('/research/api');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base.replace(/\/+$/, '')}/${p}` : base;
}

async function fetchJson(path, options = {}) {
    const res = await fetch(await apiUrl(path), {
        credentials: 'include',
        headers: { Accept: 'application/json', ...(options.headers || {}) },
        ...options,
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    return { res, data };
}

/** @type {typeof import('../../../../../core/default/razyui/component/Dialog.js').default | null} */
let DialogCtor = null;

/** @returns {Promise<typeof DialogCtor>} */
async function loadDialogCtor() {
    if (DialogCtor) return DialogCtor;
    try {
        const prefix = mountPrefix();
        let path = '/webassets/core/default/razyui/component/Dialog.js';
        if (prefix && prefix !== '/') {
            path = `${prefix.replace(/\/+$/, '')}${path}`.replace(/\/{2,}/g, '/');
        }
        const shellV = document.body?.dataset?.oaaoShellEsmV?.trim() ?? '';
        if (shellV) path += `${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(shellV)}`;
        const mod = await import(/* webpackIgnore: true */ path);
        const Dialog = mod.default;
        if (typeof Dialog !== 'function' || typeof Dialog.open !== 'function') {
            console.error('[research] Dialog export invalid', mod);
            return null;
        }
        DialogCtor = Dialog;
        return DialogCtor;
    } catch (err) {
        console.error('[research] Dialog load failed', err);
        return null;
    }
}

/** @type {Promise<{ default?: unknown, registerElement?: () => Promise<void> }> | null} */
let comboboxModulePromise = null;
/** @type {boolean} */
let comboboxCustomElementRegistered = false;

/** @returns {Promise<((sel: HTMLSelectElement, opts?: Record<string, unknown>) => unknown) | null>} */
async function loadComboboxCtor() {
    try {
        if (!comboboxModulePromise) {
            const prefix = mountPrefix();
            let path = '/webassets/core/default/razyui/component/Combobox.js';
            if (prefix && prefix !== '/') {
                path = `${prefix.replace(/\/+$/, '')}${path}`.replace(/\/{2,}/g, '/');
            }
            const shellV = document.body?.dataset?.oaaoShellEsmV?.trim() ?? '';
            if (shellV) path += `${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(shellV)}`;
            comboboxModulePromise = import(/* webpackIgnore: true */ path);
        }
        const mod = await comboboxModulePromise;
        if (!comboboxCustomElementRegistered && typeof mod.registerElement === 'function') {
            await mod.registerElement();
            comboboxCustomElementRegistered = true;
        }
        return typeof mod.default === 'function' ? mod.default : null;
    } catch (err) {
        console.error('[research] Combobox load failed', err);
        return null;
    }
}

/** @type {ReadonlyArray<{ id: string, label: string }>} */
const RESEARCH_SUMMARY_LANGUAGES = [
    { id: 'zh-Hant', label: '繁體中文' },
    { id: 'zh-Hans', label: '简体中文' },
    { id: 'en', label: 'English' },
    { id: 'ja', label: '日本語' },
    { id: 'ko', label: '한국어' },
    { id: 'yue', label: '粵語' },
];

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeSummaryLanguage(raw) {
    const code = String(raw ?? '').trim();
    if (!code) return 'zh-Hant';
    const lower = code.toLowerCase();
    if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-hant') return 'zh-Hant';
    if (lower === 'zh-cn' || lower === 'zh-hans' || lower === 'zh') return 'zh-Hans';
    if (lower === 'en' || lower.startsWith('en-')) return 'en';
    if (lower === 'ja' || lower.startsWith('ja-')) return 'ja';
    if (lower === 'ko' || lower.startsWith('ko-')) return 'ko';
    if (lower === 'yue' || lower === 'zh-yue') return 'yue';
    return RESEARCH_SUMMARY_LANGUAGES.some((lang) => lang.id === code) ? code : 'zh-Hant';
}

/**
 * @param {Element | null | undefined} el
 * @returns {string}
 */
function readSummaryLanguageValue(el) {
    const wrap =
        el instanceof Element ? el.closest('[data-oaao-research-summary-lang]') : null;
    if (wrap instanceof HTMLElement && el instanceof HTMLSelectElement) {
        return normalizeSummaryLanguage(readComboboxSelectString(wrap, el, el.value));
    }
    if (el instanceof HTMLSelectElement) {
        return normalizeSummaryLanguage(el.value);
    }
    if (el instanceof HTMLInputElement) {
        return normalizeSummaryLanguage(el.value);
    }
    return 'zh-Hant';
}

/**
 * @param {HTMLElement} wrap
 * @returns {{ getValue?: () => unknown, getControl?: () => { value?: unknown } } | null}
 */
function researchComboboxInstance(wrap) {
    if (!(wrap instanceof HTMLElement)) return null;
    return /** @type {{ getValue?: () => unknown, getControl?: () => { value?: unknown } } | null} */ (
        wrap._oaaoCombobox ?? null
    );
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 * @param {string} [fallback]
 * @returns {string}
 */
function readComboboxSelectString(wrap, sel, fallback = '') {
    const inst = researchComboboxInstance(wrap);
    if (inst && typeof inst.getValue === 'function') {
        const raw = inst.getValue();
        const v = Array.isArray(raw) ? raw[0] : raw;
        if (v != null && String(v).trim() !== '') {
            return String(v);
        }
    }
    if (inst && typeof inst.getControl === 'function') {
        const ctrl = inst.getControl();
        const cv = ctrl?.value;
        if (cv != null && String(cv).trim() !== '') {
            return String(cv);
        }
    }
    if (sel instanceof HTMLSelectElement && sel.value.trim() !== '') {
        return sel.value;
    }
    return fallback;
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 * @param {{ placeholder?: string, initialValue?: string }} [opts]
 */
async function mountResearchSelectCombobox(wrap, sel, opts = {}) {
    if (wrap.dataset.oaaoComboboxMounted === '1') return;
    const ComboboxCls = await loadComboboxCtor();
    if (typeof ComboboxCls !== 'function') return;
    try {
        /** @type {{ setValue?: (v: string) => void } | null} */
        const instance = new ComboboxCls(sel, {
            placeholder: opts.placeholder ?? 'Select…',
            onSelect: (value) => {
                const v = Array.isArray(value) ? value[0] : value;
                if (v != null && String(v) !== '') {
                    sel.value = String(v);
                }
            },
        });
        wrap.dataset.oaaoComboboxMounted = '1';
        wrap._oaaoCombobox = instance;
        const initial =
            opts.initialValue != null && String(opts.initialValue) !== ''
                ? String(opts.initialValue)
                : sel.value;
        if (initial) {
            sel.value = initial;
            if (instance && typeof instance.setValue === 'function') {
                instance.setValue(initial);
            }
        }
    } catch (err) {
        console.warn('[research] Combobox init failed', err);
    }
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 */
async function mountSummaryLanguageCombobox(wrap, sel) {
    const value = normalizeSummaryLanguage(sel.value);
    sel.value = value;
    await mountResearchSelectCombobox(wrap, sel, {
        placeholder: 'Select language',
        initialValue: value,
    });
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 * @param {number} minutes
 */
async function mountIntervalCombobox(wrap, sel, minutes) {
    const value = String(normalizeWatchIntervalMinutes(minutes));
    sel.value = value;
    await mountResearchSelectCombobox(wrap, sel, {
        placeholder: 'Select interval',
        initialValue: value,
    });
}

/** @type {Promise<{ default?: unknown, registerElement?: () => Promise<void> }> | null} */
let datePickerModulePromise = null;
/** @type {boolean} */
let datePickerCustomElementRegistered = false;

/** @returns {Promise<((sel: HTMLInputElement, opts?: Record<string, unknown>) => unknown) | null>} */
async function loadDatePickerCtor() {
    try {
        if (!datePickerModulePromise) {
            const prefix = mountPrefix();
            let path = '/webassets/core/default/razyui/component/DatePicker.js';
            if (prefix && prefix !== '/') {
                path = `${prefix.replace(/\/+$/, '')}${path}`.replace(/\/{2,}/g, '/');
            }
            const shellV = document.body?.dataset?.oaaoShellEsmV?.trim() ?? '';
            if (shellV) path += `${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(shellV)}`;
            datePickerModulePromise = import(/* webpackIgnore: true */ path);
        }
        const mod = await datePickerModulePromise;
        if (!datePickerCustomElementRegistered && typeof mod.registerElement === 'function') {
            await mod.registerElement();
            datePickerCustomElementRegistered = true;
        }
        return typeof mod.default === 'function' ? mod.default : null;
    } catch (err) {
        console.error('[research] DatePicker load failed', err);
        return null;
    }
}

/**
 * @param {Element | null | undefined} el
 * @returns {number}
 */
function readIntervalMinutesValue(el) {
    const wrap = el instanceof Element ? el.closest('[data-oaao-research-interval]') : null;
    let raw = '1440';
    if (wrap instanceof HTMLElement && el instanceof HTMLSelectElement) {
        raw = readComboboxSelectString(wrap, el, el.value || '1440');
    } else if (el instanceof HTMLSelectElement && el.value) {
        raw = el.value;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1440;
}

/**
 * @param {Element | null | undefined} el
 * @returns {string}
 */
function readScheduleStartTimeValue(el) {
    if (el instanceof HTMLInputElement) {
        return normalizeResearchStartTime(el.value);
    }
    return RESEARCH_DEFAULT_START_TIME;
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLInputElement} input
 */
async function mountStartTimeDatePicker(wrap, input) {
    if (wrap.dataset.oaaoDatePickerMounted === '1') return;
    const DatePickerCls = await loadDatePickerCtor();
    if (typeof DatePickerCls !== 'function') return;
    try {
        const value = readScheduleStartTimeValue(input);
        input.value = value;
        new DatePickerCls(input, {
            type: 'time',
            value,
            placeholder: 'HH:mm',
        });
        wrap.dataset.oaaoDatePickerMounted = '1';
    } catch (err) {
        console.warn('[research] start time DatePicker init failed', err);
    }
}

/**
 * @param {string} message
 * @returns {HTMLElement}
 */
function createResearchLoadingBlock(message) {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col items-center justify-center gap-3 py-10';
    const spinner = document.createElement('div');
    spinner.className = 'spinner-container';
    const ring = document.createElement('span');
    ring.className = 'spinner-ring';
    ring.setAttribute('aria-hidden', 'true');
    spinner.append(ring);
    const label = document.createElement('p');
    label.className = 'text-sm fg-[var(--grid-ink-muted)] m-0';
    label.textContent = message;
    wrap.append(spinner, label);
    return wrap;
}

/**
 * @param {typeof DialogCtor} DialogMod
 * @param {Array<{url: string, kind: string}>} sources
 * @returns {Promise<Record<string, unknown> | null>}
 */
function openResearchSourceDiscoverDialog(DialogMod, sources) {
    if (sources.length === 1) {
        return openResearchDiscoverWizard(DialogMod, sources[0].url);
    }
    return openResearchBatchDiscoverDialog(DialogMod, sources);
}

/**
 * @param {Record<string, unknown>} it
 * @returns {string}
 */
function researchLinkDisplayTitle(it) {
    const display = String(it.display_title ?? it.title ?? '').trim();
    if (display && display.length > 2 && !/^(html|pdf|abs|link)$/i.test(display)) return display;
    const url = String(it.url ?? '').trim();
    const m = url.match(/([0-9]{4}\.[0-9]{4,5})/);
    if (m) return `arXiv ${m[1]}`;
    try {
        const u = new URL(url);
        const seg = u.pathname.replace(/\/+$/, '').split('/').pop();
        if (seg && seg.length > 2) return seg.replace(/[-_]+/g, ' ');
        return url;
    } catch {
        return url || '—';
    }
}

/**
 * @param {Record<string, unknown>} it
 * @returns {string}
 */
function researchLinkKind(it) {
    const kind = String(it.link_kind ?? '').trim();
    if (kind) return kind;
    const url = String(it.url ?? '').toLowerCase();
    if (url.includes('/pdf') || url.endsWith('.pdf')) return 'pdf';
    if (url.includes('/html')) return 'html';
    if (url.includes('arxiv.org/abs/')) return 'abs';
    return 'link';
}

/**
 * @param {Record<string, unknown>} it
 * @param {{ inputType: 'checkbox' | 'radio', name?: string, checked?: boolean, onChange?: (checked: boolean) => void }} opts
 * @returns {HTMLElement}
 */
function buildResearchDiscoverLinkRow(it, opts) {
    const row = document.createElement('label');
    row.className =
        'grid gap-0.5 cursor-pointer border border-solid border-[var(--grid-line)] rounded p-2 text-xs bg-[var(--grid-paper)]';

    const top = document.createElement('div');
    top.className = 'flex gap-2 items-start';

    const input = document.createElement('input');
    input.type = opts.inputType;
    if (opts.name) input.name = opts.name;
    input.checked = Boolean(opts.checked);
    input.className = 'mt-0.5 shrink-0';
    input.addEventListener('change', () => {
        opts.onChange?.(input.checked);
    });

    const textCol = document.createElement('div');
    textCol.className = 'min-w-0 grid gap-0.5';

    const titleEl = document.createElement('div');
    titleEl.className = 'font-medium break-words leading-snug';
    titleEl.textContent = researchLinkDisplayTitle(it);

    const urlEl = document.createElement('div');
    urlEl.className = 'text-[10px] fg-[var(--grid-ink-muted)] break-all leading-snug';
    urlEl.textContent = String(it.url ?? '');

    const score =
        typeof it.article_score === 'number'
            ? `${Math.round(it.article_score * 100)}%`
            : String(it.article_score ?? '—');
    const reasons = Array.isArray(it.reasons) ? it.reasons.slice(0, 4).join(', ') : '';
    const metaEl = document.createElement('div');
    metaEl.className = 'text-[10px] fg-[var(--grid-ink-muted)]';
    metaEl.textContent = `${score} · ${researchLinkKind(it)}${reasons ? ` · ${reasons}` : ''}`;

    textCol.append(titleEl, urlEl, metaEl);
    const contentUrl = String(it.content_url ?? '').trim();
    if (contentUrl && contentUrl !== String(it.url ?? '').trim()) {
        const fetchEl = document.createElement('div');
        fetchEl.className = 'text-[10px] fg-[var(--grid-accent,#2563eb)] break-all leading-snug';
        const hint = String(it.content_hint ?? '').trim();
        fetchEl.textContent = hint
            ? `Fetch target: ${contentUrl} (${hint})`
            : `Fetch target: ${contentUrl}`;
        textCol.append(fetchEl);
    }
    top.append(input, textCol);
    row.append(top);
    return row;
}

/**
 * @param {Record<string, unknown>} step
 * @returns {boolean}
 */
function researchStepHasEnoughArticles(step) {
    const items = Array.isArray(step.fetch_candidates) ? step.fetch_candidates : [];
    const good = items.filter((it) => {
        const score = Number(it.article_score ?? 0);
        return score >= 0.55 || String(it.action ?? '') === 'fetch';
    });
    return good.length >= 2 || Boolean(step.auto_sufficient);
}

/**
 * @param {Record<string, unknown>} step
 * @returns {string}
 */
function researchPickAutoDrillUrl(step) {
    const fromApi = String(step.auto_drill_url ?? '').trim();
    if (fromApi) return fromApi;
    const items = [...(Array.isArray(step.drill_candidates) ? step.drill_candidates : [])].sort(
        (a, b) => Number(b.article_score ?? 0) - Number(a.article_score ?? 0),
    );
    for (const it of items) {
        const score = Number(it.article_score ?? 0);
        if (score < 0.12) continue;
        const anchor = String(it.anchor ?? it.display_title ?? it.title ?? '').toLowerCase();
        if (/login|sign in|sign up|register|ignore|privacy|terms|about|contact/.test(anchor)) continue;
        const u = String(it.url ?? '').trim();
        if (u) return u;
    }
    if (step.can_drill_fetch_preview) {
        const fetchItems = Array.isArray(step.fetch_candidates) ? step.fetch_candidates : [];
        const first = fetchItems[0];
        const u = String(first?.url ?? '').trim();
        if (u) return u;
    }
    return '';
}

/**
 * @param {string} rootUrl
 * @param {Array<Record<string, unknown>>} pathSteps
 * @returns {string}
 */
function researchIndexUrlFromPath(rootUrl, pathSteps) {
    for (const step of pathSteps) {
        const u = String(step.url ?? '').trim();
        if (/arxiv\.org\/list\//i.test(u) || String(step.page_type ?? '') === 'index') return u;
    }
    if (/arxiv\.org\/list\//i.test(rootUrl)) return rootUrl;
    for (let i = pathSteps.length - 1; i >= 0; i -= 1) {
        const step = pathSteps[i];
        if (String(step.page_type ?? '') === 'index') return String(step.url ?? rootUrl).trim() || rootUrl;
    }
    return rootUrl;
}

/**
 * @param {Record<string, unknown>} step
 * @returns {string}
 */
function researchStepHeadline(step, autoReady) {
    const layer = String(step.page_layer ?? '');
    const chain = String(step.layer_chain ?? 'index → metadata → fulltext');
    const good = Number(step.good_fetch_count ?? 0);
    if (layer === 'fulltext') {
        return 'Layer 3/3: HTML (experimental) full text — use list URL as index source when saving.';
    }
    if (layer === 'metadata') {
        return 'Layer 2/3: /abs/ metadata — Drill down to HTML (experimental), or Back to return to list.';
    }
    if (layer === 'index' || String(step.page_type ?? '') === 'index') {
        if (autoReady) {
            return `Layer 1/3: index — ${good} paper(s) found. Check papers to include, or Drill down to preview /abs/ → HTML.`;
        }
        return `Layer 1/3: index — pick a paper link and Drill down to preview ${chain}.`;
    }
    if (autoReady) {
        return `${good} likely article link(s) found — confirm selection below.`;
    }
    return String(step.reason ?? step.suggested_action ?? 'Confirm links below.');
}

/**
 * Single-URL step wizard: auto-drill best links first, then manual confirm.
 * @param {typeof DialogCtor} DialogMod
 * @param {string} rootUrl
 * @returns {Promise<Record<string, unknown> | null>}
 */
function openResearchDiscoverWizard(DialogMod, rootUrl) {
    return new Promise((resolve) => {
        const body = document.createElement('div');
        body.className = 'grid gap-3 min-h-[12rem]';
        body.append(createResearchLoadingBlock('Analyzing page structure…'));

        /** @type {Array<Record<string, unknown>>} */
        const path = [];
        /** @type {Set<string>} */
        const selectedFetch = new Set();
        /** @type {Record<string, unknown> | null} */
        let currentStep = null;
        let drillUrl = '';
        let loading = false;
        let manualMode = false;
        let autoReady = false;
        /** @type {string[]} */
        const autoTrail = [];

        /** @type {Record<string, unknown> | null} */
        let discoverData = null;

        const statusEl = document.createElement('p');
        statusEl.className = 'text-xs fg-[var(--grid-ink-muted)] m-0';

        const autoNoteEl = document.createElement('p');
        autoNoteEl.className = 'text-xs m-0 fg-[var(--grid-ink)] hidden';

        function renderBreadcrumb() {
            const crumbs = [rootUrl, ...path.map((p) => String(p.url ?? ''))].filter(Boolean);
            statusEl.textContent =
                crumbs.length > 1
                    ? `Path (${crumbs.length} level${crumbs.length > 1 ? 's' : ''}): ${crumbs.join(' → ')}`
                    : `Analyzing: ${rootUrl}`;
            if (autoTrail.length) {
                autoNoteEl.textContent = `Auto-drilled ${autoTrail.length} level(s): ${autoTrail.join(' → ')}`;
                autoNoteEl.classList.remove('hidden');
            } else {
                autoNoteEl.classList.add('hidden');
            }
        }

        /**
         * @param {Record<string, unknown>} step
         * @param {{ manual?: boolean }} [opts]
         */
        function renderStepPanel(step, opts = {}) {
            body.replaceChildren(statusEl, autoNoteEl);
            renderBreadcrumb();

            if (!opts.manual && !manualMode) {
                return;
            }

            const head = document.createElement('div');
            head.className =
                'rounded border border-solid border-[var(--grid-line)] p-2 text-xs bg-[var(--grid-paper)]';
            const pageType = String(step.page_type ?? '?');
            const conf =
                typeof step.confidence === 'number' ? `${Math.round(step.confidence * 100)}%` : '—';
            const headTitle = document.createElement('p');
            headTitle.className = 'm-0 font-medium break-all';
            headTitle.textContent = String(step.url ?? '');
            const headMeta = document.createElement('p');
            headMeta.className = 'm-0 mt-1';
            const layerBadge = researchLayerBadgeText(String(step.page_layer ?? ''));
            headMeta.textContent = layerBadge
                ? `${layerBadge} · ${pageType} · confidence ${conf} · depth ${String(step.depth ?? 1)}/${String(step.max_depth ?? 3)}`
                : `${pageType} · confidence ${conf} · depth ${String(step.depth ?? 1)}/${String(step.max_depth ?? 3)}`;
            const headReason = document.createElement('p');
            headReason.className = 'm-0 mt-1 fg-[var(--grid-ink-muted)]';
            headReason.textContent = researchStepHeadline(step, autoReady);
            head.append(headTitle, headMeta, headReason);
            body.append(head);

            const fetchHint = String(step.fetch_resolution_hint ?? '').trim();
            if (fetchHint) {
                const hintBox = document.createElement('p');
                hintBox.className =
                    'text-xs m-0 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-2 py-1.5 fg-[var(--grid-ink)] leading-snug';
                hintBox.textContent = fetchHint;
                body.append(hintBox);
            }

            if (String(step.page_layer ?? '') === 'fulltext') {
                const note = document.createElement('p');
                note.className = 'text-xs m-0 fg-[var(--grid-ink)]';
                note.textContent =
                    'This is the full-text HTML page. Saving will still watch the list/index URL and fetch all papers.';
                body.append(note);
            } else if (pageType === 'article' && String(step.page_layer ?? '') === 'metadata') {
                const drillItemsMeta = Array.isArray(step.drill_candidates) ? step.drill_candidates : [];
                const hasHtml = Boolean(step.html_drill_available) || drillItemsMeta.length > 0;
                const note = document.createElement('p');
                note.className = 'text-xs m-0 fg-[var(--grid-ink)]';
                note.textContent = hasHtml
                    ? '/abs/ metadata page. Drill down to preview HTML (experimental), or save — fetch will try HTML full text for each queued paper.'
                    : 'No HTML (experimental) link on this /abs/ page. Fetch will use title + abstract only (not full paper HTML).';
                body.append(note);
            } else if (pageType === 'article') {
                const note = document.createElement('p');
                note.className = 'text-xs m-0 fg-[var(--grid-ink)]';
                note.textContent = 'This page looks like an article. Confirm to use it as a static source.';
                body.append(note);
                selectedFetch.clear();
                selectedFetch.add(String(step.url ?? rootUrl));
                return;
            }

            const fetchItems = Array.isArray(step.fetch_candidates) ? step.fetch_candidates : [];
            const drillItems = Array.isArray(step.drill_candidates) ? step.drill_candidates : [];

            if (fetchItems.length) {
                const sec = document.createElement('div');
                sec.className = 'grid gap-1';
                const title = document.createElement('p');
                title.className = 'text-xs font-medium m-0';
                title.textContent = 'Likely articles — check links to include when fetching';
                sec.append(title);
                const list = document.createElement('div');
                list.className = 'grid gap-1 max-h-48 overflow-y-auto pr-1';
                for (const it of fetchItems.slice(0, 25)) {
                    const u = String(it.url ?? '');
                    const prechecked = selectedFetch.has(u) || String(it.action ?? '') === 'fetch';
                    if (prechecked) selectedFetch.add(u);
                    list.append(
                        buildResearchDiscoverLinkRow(it, {
                            inputType: 'checkbox',
                            checked: prechecked,
                            onChange: (checked) => {
                                if (checked) selectedFetch.add(u);
                                else selectedFetch.delete(u);
                            },
                        }),
                    );
                }
                sec.append(list);
                body.append(sec);
            }

            const canPreviewDrill =
                Boolean(step.can_drill_fetch_preview) &&
                fetchItems.length > 0 &&
                String(step.page_layer ?? '') === 'index';
            if (canPreviewDrill) {
                const sec = document.createElement('div');
                sec.className = 'grid gap-1';
                const title = document.createElement('p');
                title.className = 'text-xs font-medium m-0';
                title.textContent =
                    'Drill down — pick one paper to preview /abs/ → HTML (experimental) layers';
                sec.append(title);
                const list = document.createElement('div');
                list.className = 'grid gap-1 max-h-36 overflow-y-auto pr-1';
                for (const it of fetchItems.slice(0, 12)) {
                    const u = String(it.url ?? '');
                    list.append(
                        buildResearchDiscoverLinkRow(it, {
                            inputType: 'radio',
                            name: 'research-drill',
                            checked: drillUrl === u,
                            onChange: (checked) => {
                                if (checked) drillUrl = u;
                            },
                        }),
                    );
                }
                sec.append(list);
                body.append(sec);
            }

            if (
                drillItems.length &&
                (Boolean(step.can_drill_down) || String(step.page_layer ?? '') === 'metadata') &&
                !canPreviewDrill
            ) {
                const sec = document.createElement('div');
                sec.className = 'grid gap-1';
                const title = document.createElement('p');
                title.className = 'text-xs font-medium m-0';
                title.textContent =
                    String(step.page_layer ?? '') === 'metadata'
                        ? 'Drill down — open HTML (experimental) full text'
                        : 'Hub / list pages — pick one to drill down (optional, max 3 levels)';
                sec.append(title);
                const list = document.createElement('div');
                list.className = 'grid gap-1 max-h-36 overflow-y-auto pr-1';

                if (String(step.page_layer ?? '') !== 'metadata') {
                    const noneWrap = document.createElement('label');
                    noneWrap.className = 'flex gap-2 items-center text-xs cursor-pointer p-1';
                    const noneRb = document.createElement('input');
                    noneRb.type = 'radio';
                    noneRb.name = 'research-drill';
                    noneRb.checked = !drillUrl;
                    noneRb.addEventListener('change', () => {
                        drillUrl = '';
                    });
                    noneWrap.append(noneRb, document.createTextNode('Stop here — use current page as index'));
                    list.append(noneWrap);
                }

                for (const it of drillItems.slice(0, 15)) {
                    const u = String(it.url ?? '');
                    list.append(
                        buildResearchDiscoverLinkRow(it, {
                            inputType: 'radio',
                            name: 'research-drill',
                            checked: drillUrl === u,
                            onChange: (checked) => {
                                if (checked) drillUrl = u;
                            },
                        }),
                    );
                }
                sec.append(list);
                body.append(sec);
            }
        }

        /**
         * @param {string} url
         * @param {number} depth
         * @param {string | undefined} parentUrl
         * @returns {Promise<Record<string, unknown> | null>}
         */
        async function fetchStep(url, depth, parentUrl) {
            const { res, data } = await fetchJson('source_discover_step', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    depth,
                    max_depth: 3,
                    parent_url: parentUrl || undefined,
                    use_llm: true,
                }),
            });
            if (!res.ok || !data?.success || !data?.data?.ok) {
                body.replaceChildren();
                const err = document.createElement('p');
                err.className = 'text-sm text-red-600 m-0 py-4';
                err.textContent =
                    typeof data?.message === 'string'
                        ? data.message
                        : String(data?.data?.error ?? 'Analyze step failed');
                body.append(err);
                return null;
            }
            return /** @type {Record<string, unknown>} */ (data.data);
        }

        /**
         * @param {string} url
         * @param {number} depth
         * @param {string | undefined} parentUrl
         * @param {{ render?: boolean }} [opts]
         */
        async function loadStep(url, depth, parentUrl, opts = {}) {
            loading = true;
            if (opts.render !== false) {
                body.replaceChildren(createResearchLoadingBlock(`Analyzing level ${depth}…`));
            }
            const step = await fetchStep(url, depth, parentUrl);
            loading = false;
            if (!step) {
                currentStep = null;
                return null;
            }
            currentStep = step;
            drillUrl = '';
            if (opts.render !== false) {
                renderStepPanel(step, { manual: manualMode });
            }
            return step;
        }

        async function runAutoExplore() {
            autoTrail.length = 0;
            path.length = 0;
            selectedFetch.clear();
            manualMode = false;
            autoReady = false;

            let url = rootUrl;
            let depth = 1;
            /** @type {string | undefined} */
            let parentUrl = undefined;

            while (depth <= 3) {
                const layerHint =
                    depth === 1
                        ? 'Analyzing index layer…'
                        : depth === 2
                          ? 'Auto drill — /abs/ metadata layer…'
                          : 'Auto drill — HTML (experimental) full text…';
                body.replaceChildren(createResearchLoadingBlock(layerHint));
                const step = await fetchStep(url, depth, parentUrl);
                if (!step) return;
                currentStep = step;

                if (String(step.page_layer ?? '') === 'index') {
                    for (const it of Array.isArray(step.fetch_candidates) ? step.fetch_candidates : []) {
                        const u = String(it.url ?? '');
                        if (u) selectedFetch.add(u);
                    }
                }

                if (Boolean(step.auto_sufficient)) {
                    autoReady = true;
                    manualMode = true;
                    renderStepPanel(step, { manual: true });
                    return;
                }

                const nextUrl = researchPickAutoDrillUrl(step);
                if (!nextUrl || !step.can_drill_down) {
                    manualMode = true;
                    renderStepPanel(step, { manual: true });
                    return;
                }

                path.push({ ...step, auto: true });
                autoTrail.push(nextUrl);
                parentUrl = url;
                url = nextUrl;
                depth += 1;
            }

            manualMode = true;
            autoReady = Boolean(currentStep?.auto_sufficient);
            if (currentStep) renderStepPanel(currentStep, { manual: true });
        }

        async function finalizeWizard() {
            if (!currentStep) return null;
            const articles = [...selectedFetch];
            const fullPath = [...path, { ...currentStep }];
            const indexUrl = researchIndexUrlFromPath(rootUrl, fullPath);
            const { res, data } = await fetchJson('source_discover_finalize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    root_url: rootUrl,
                    path: fullPath,
                    selected_article_urls: articles,
                    final_index_url: drillUrl ? undefined : indexUrl,
                }),
            });
            if (!res.ok || !data?.success || !data?.data?.source) {
                body.replaceChildren();
                const err = document.createElement('p');
                err.className = 'text-sm text-red-600 m-0 py-4';
                err.textContent =
                    typeof data?.message === 'string' ? data.message : 'Finalize failed';
                body.append(err);
                return null;
            }
            const src = /** @type {Record<string, unknown>} */ (data.data.source);
            const preview = /** @type {Record<string, unknown>} */ (
                data.data.preview ?? {
                    ...src,
                    ok: true,
                    page_type: src.kind ?? src.resolved_kind,
                }
            );
            discoverData = {
                ok: true,
                wizard: true,
                previews: [preview],
                sources: [src],
            };
            return discoverData;
        }

        DialogMod.open({
            title: 'Source analysis (step-by-step)',
            content: body,
            size: 'lg',
            closable: true,
            overlayClose: false,
            buttons: [
                {
                    text: 'Cancel',
                    color: 'muted',
                    action: async () => {
                        resolve(null);
                        return true;
                    },
                },
                {
                    text: 'Back',
                    color: 'muted',
                    action: async () => {
                        if (loading || path.length === 0) return false;
                        path.pop();
                        selectedFetch.clear();
                        autoTrail.pop();
                        manualMode = true;
                        const prev = path[path.length - 1];
                        if (prev) {
                            await loadStep(String(prev.url ?? rootUrl), path.length, path.length > 1 ? String(path[path.length - 2]?.url ?? '') : undefined);
                        } else {
                            await runAutoExplore();
                        }
                        return false;
                    },
                },
                {
                    text: 'Drill down',
                    color: 'primary',
                    action: async () => {
                        if (loading || !currentStep) return false;
                        if (!drillUrl) {
                            statusEl.textContent =
                                'Select a link under "Drill down" first, then click Drill down again.';
                            statusEl.className = 'text-xs text-red-600 m-0';
                            body.prepend(statusEl);
                            return false;
                        }
                        const depth = path.length + 2;
                        if (depth > 3) {
                            statusEl.textContent = 'Maximum drill depth (3) reached.';
                            statusEl.className = 'text-xs text-red-600 m-0';
                            return false;
                        }
                        path.push({ ...currentStep });
                        autoTrail.push(drillUrl);
                        manualMode = true;
                        statusEl.className = 'text-xs fg-[var(--grid-ink-muted)] m-0';
                        await loadStep(drillUrl, depth, String(currentStep.url ?? rootUrl));
                        return false;
                    },
                },
                {
                    text: 'Use these sources',
                    color: 'accent',
                    action: async () => {
                        if (loading || !currentStep) return false;
                        if (drillUrl) return false;
                        const result = await finalizeWizard();
                        if (!result) return false;
                        resolve(result);
                        return true;
                    },
                },
            ],
            onOpen: () => {
                void runAutoExplore();
            },
        });
    });
}

/**
 * @param {typeof DialogCtor} DialogMod
 * @param {Array<{url: string, kind: string}>} sources
 * @returns {Promise<Record<string, unknown> | null>}
 */
function openResearchBatchDiscoverDialog(DialogMod, sources) {
    return new Promise((resolve) => {
        const body = document.createElement('div');
        body.className = 'grid gap-3 min-h-[10rem]';
        body.append(createResearchLoadingBlock('Analyzing sources…'));

        /** @type {Record<string, unknown> | null} */
        let discoverData = null;

        DialogMod.open({
            title: 'Source analysis',
            content: body,
            size: 'lg',
            closable: true,
            overlayClose: false,
            buttons: [
                {
                    text: 'Cancel',
                    color: 'muted',
                    action: async () => {
                        resolve(null);
                        return true;
                    },
                },
                {
                    text: 'Use these sources',
                    color: 'accent',
                    action: async () => {
                        if (!discoverData) return false;
                        resolve(discoverData);
                        return true;
                    },
                },
            ],
            onOpen: () => {
                void (async () => {
                    body.replaceChildren(createResearchLoadingBlock('Analyzing sources…'));
                    discoverData = null;
                    const { res, data } = await fetchJson('source_discover', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sources, use_llm: true }),
                    });
                    if (!res.ok || !data?.success || !data?.data) {
                        body.replaceChildren();
                        const err = document.createElement('p');
                        err.className = 'text-sm text-red-600 m-0 py-4';
                        err.textContent =
                            typeof data?.message === 'string' ? data.message : 'Analyze failed';
                        body.append(err);
                        return;
                    }
                    discoverData = /** @type {Record<string, unknown>} */ (data.data);
                    body.className = 'grid gap-2 max-h-[min(60vh,28rem)] overflow-y-auto pr-1';
                    renderResearchDiscoverPreview(body, discoverData);
                })();
            },
        });
    });
}

function researchVaultApiBase() {
    const prefix = mountPrefix();
    const base = `${prefix}/vault/api`.replace(/\/{2,}/g, '/');
    return base.endsWith('/') ? base : `${base}/`;
}

/** @returns {Promise<{ tree: unknown[] }>} */
async function fetchResearchVaultTreeJson() {
    let cachePath = '/webassets/core/default/js/vault-tree-cache.js';
    const prefix = mountPrefix();
    if (prefix && prefix !== '/') {
        cachePath = `${prefix.replace(/\/+$/, '')}${cachePath}`.replace(/\/{2,}/g, '/');
    }
    const cache = await import(/* webpackIgnore: true */ cachePath);
    const buildUrl = () => `${researchVaultApiBase()}vault_tree?scope=all`;
    const j = await cache.fetchVaultTreeCached('all', buildUrl, {});
    const tree = j && typeof j === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (j).tree)
        ? /** @type {Record<string, unknown>} */ (j).tree
        : j?.data && typeof j.data === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (j.data).tree)
          ? /** @type {Record<string, unknown>} */ (j.data).tree
          : [];

    return { tree };
}

/**
 * @typedef {{ rowKey: string, kind: 'vault' | 'folder', id: number, vault_id: number, name: string, breadcrumb: string, parent_container_id: number | null }} ResearchVaultPathRow
 */

/**
 * @param {unknown[]} tree
 * @returns {ResearchVaultPathRow[]}
 */
function flattenVaultPathsForResearchPicker(tree) {
    /** @type {ResearchVaultPathRow[]} */
    const out = [];

    /**
     * @param {unknown[]} children
     * @param {number} vaultId
     * @param {string} pathPrefix
     */
    function walkChildren(children, vaultId, pathPrefix) {
        if (!Array.isArray(children)) return;
        for (const raw of children) {
            if (!raw || typeof raw !== 'object') continue;
            const node = /** @type {Record<string, unknown>} */ (raw);
            if (String(node.kind ?? '') !== 'container') continue;
            const cid = Number(node.id);
            if (!Number.isFinite(cid) || cid < 1) continue;
            const nm = typeof node.name === 'string' ? node.name : `Folder ${cid}`;
            const crumb = `${pathPrefix} › ${nm}`;
            out.push({
                rowKey: `folder:${cid}`,
                kind: 'folder',
                id: cid,
                vault_id: vaultId,
                name: nm,
                breadcrumb: crumb,
                parent_container_id: cid,
            });
            walkChildren(Array.isArray(node.children) ? node.children : [], vaultId, crumb);
        }
    }

    for (const raw of tree) {
        if (!raw || typeof raw !== 'object') continue;
        const node = /** @type {Record<string, unknown>} */ (raw);
        if (String(node.kind ?? '') !== 'vault') continue;
        const vid = Number(node.id);
        if (!Number.isFinite(vid) || vid < 1) continue;
        const vname = typeof node.name === 'string' ? node.name : `Vault ${vid}`;
        out.push({
            rowKey: `vault:${vid}`,
            kind: 'vault',
            id: vid,
            vault_id: vid,
            name: vname,
            breadcrumb: vname,
            parent_container_id: null,
        });
        walkChildren(Array.isArray(node.children) ? node.children : [], vid, vname);
    }

    return out;
}

/**
 * @param {unknown[]} tree
 * @returns {Map<string, ResearchVaultPathRow>}
 */
function buildResearchVaultRowMap(tree) {
    const rows = flattenVaultPathsForResearchPicker(tree);
    return new Map(rows.map((r) => [r.rowKey, r]));
}

/**
 * @param {Record<string, unknown>} node
 * @returns {Record<string, unknown>[]}
 */
function researchVaultFolderChildren(node) {
    const kids = Array.isArray(node.children) ? node.children : [];
    return kids.filter((c) => c && typeof c === 'object' && String(/** @type {Record<string, unknown>} */ (c).kind ?? '') === 'container');
}

/**
 * @param {string} rowKey
 * @param {unknown[]} tree
 * @returns {Set<string>}
 */
function researchVaultExpandKeysForRow(rowKey, tree) {
    /** @type {Set<string>} */
    const keys = new Set();
    if (!rowKey) return keys;

    if (rowKey.startsWith('vault:')) {
        keys.add(rowKey);
        return keys;
    }

    const folderId = Number(rowKey.replace(/^folder:/, ''));
    if (!Number.isFinite(folderId) || folderId < 1) return keys;

    /**
     * @param {unknown[]} children
     * @param {number} vaultId
     * @param {string} pathPrefix
     * @returns {boolean}
     */
    function walkFolders(children, vaultId, pathPrefix) {
        if (!Array.isArray(children)) return false;
        for (const raw of children) {
            if (!raw || typeof raw !== 'object') continue;
            const node = /** @type {Record<string, unknown>} */ (raw);
            if (String(node.kind ?? '') !== 'container') continue;
            const cid = Number(node.id);
            if (!Number.isFinite(cid) || cid < 1) continue;
            const nm = typeof node.name === 'string' ? node.name : `Folder ${cid}`;
            const crumb = `${pathPrefix} › ${nm}`;
            if (cid === folderId) {
                keys.add(`vault:${vaultId}`);
                keys.add(`folder:${cid}`);
                return true;
            }
            if (walkFolders(researchVaultFolderChildren(node), vaultId, crumb)) {
                keys.add(`folder:${cid}`);
                return true;
            }
        }
        return false;
    }

    for (const raw of tree) {
        if (!raw || typeof raw !== 'object') continue;
        const node = /** @type {Record<string, unknown>} */ (raw);
        if (String(node.kind ?? '') !== 'vault') continue;
        const vid = Number(node.id);
        if (!Number.isFinite(vid) || vid < 1) continue;
        const vname = typeof node.name === 'string' ? node.name : `Vault ${vid}`;
        if (walkFolders(researchVaultFolderChildren(node), vid, vname)) break;
    }

    return keys;
}

/**
 * @typedef {{ rowKey: string, kind: 'vault' | 'folder', depth: number, name: string, breadcrumb: string, hasChildren: boolean }} ResearchVaultTreeVisibleRow
 */

/**
 * @param {unknown[]} tree
 * @param {Set<string>} expandedKeys
 * @param {string} filter
 * @returns {ResearchVaultTreeVisibleRow[]}
 */
function researchVaultVisibleTreeRows(tree, expandedKeys, filter) {
    /** @type {ResearchVaultTreeVisibleRow[]} */
    const out = [];
    const q = filter.trim().toLowerCase();

    /**
     * @param {Record<string, unknown>} folderNode
     * @param {number} vaultId
     * @param {number} depth
     * @param {string} breadcrumb
     */
    function walkFolder(folderNode, vaultId, depth, pathPrefix) {
        const cid = Number(folderNode.id);
        if (!Number.isFinite(cid) || cid < 1) return;
        const nm = typeof folderNode.name === 'string' ? folderNode.name : `Folder ${cid}`;
        const breadcrumb = pathPrefix ? `${pathPrefix} › ${nm}` : nm;
        const rowKey = `folder:${cid}`;
        const kids = researchVaultFolderChildren(folderNode);
        const hay = `${nm} ${breadcrumb} folder`.toLowerCase();
        const match = q === '' || hay.includes(q);
        if (match) {
            out.push({
                rowKey,
                kind: 'folder',
                depth,
                name: nm,
                breadcrumb,
                hasChildren: kids.length > 0,
            });
        }
        const showKids = q !== '' || expandedKeys.has(rowKey);
        if (showKids) {
            for (const raw of kids) {
                if (!raw || typeof raw !== 'object') continue;
                walkFolder(/** @type {Record<string, unknown>} */ (raw), vaultId, depth + 1, breadcrumb);
            }
        }
    }

    for (const raw of tree) {
        if (!raw || typeof raw !== 'object') continue;
        const node = /** @type {Record<string, unknown>} */ (raw);
        if (String(node.kind ?? '') !== 'vault') continue;
        const vid = Number(node.id);
        if (!Number.isFinite(vid) || vid < 1) continue;
        const vname = typeof node.name === 'string' ? node.name : `Vault ${vid}`;
        const rowKey = `vault:${vid}`;
        const kids = researchVaultFolderChildren(node);
        const hay = `${vname} vault`.toLowerCase();
        const match = q === '' || hay.includes(q);
        if (match) {
            out.push({
                rowKey,
                kind: 'vault',
                depth: 0,
                name: vname,
                breadcrumb: vname,
                hasChildren: kids.length > 0,
            });
        }
        const showKids = q !== '' || expandedKeys.has(rowKey);
        if (showKids) {
            for (const child of kids) {
                if (!child || typeof child !== 'object') continue;
                walkFolder(/** @type {Record<string, unknown>} */ (child), vid, 1, vname);
            }
        }
    }

    return out;
}

/**
 * @param {ResearchVaultPathRow[]} rows
 * @param {Record<string, unknown> | null | undefined} watch
 * @returns {ResearchVaultPathRow | null}
 */
function findVaultPathRowForWatch(rows, watch) {
    const containerId = watch?.container_id != null ? Number(watch.container_id) : 0;
    if (Number.isFinite(containerId) && containerId > 0) {
        const folder = rows.find((r) => r.kind === 'folder' && r.id === containerId);
        if (folder) return folder;
    }
    const vaultId = Number(watch?.vault_id ?? 0);
    if (Number.isFinite(vaultId) && vaultId > 0) {
        return rows.find((r) => r.kind === 'vault' && r.id === vaultId) ?? null;
    }
    return null;
}

/**
 * @param {typeof DialogCtor} DialogMod
 * @param {unknown[]} tree
 * @param {string | null} initialRowKey
 * @returns {Promise<ResearchVaultPathRow | null>}
 */
async function openResearchVaultPathPickerDialog(DialogMod, tree, initialRowKey) {
    if (!DialogMod || typeof DialogMod.open !== 'function') return null;

    const rowByKey = buildResearchVaultRowMap(tree);
    /** @type {Set<string>} */
    const expandedKeys = researchVaultExpandKeysForRow(initialRowKey ?? '', tree);
    let selectedKey = initialRowKey;

    const body = document.createElement('div');
    body.className = 'flex flex-col gap-2 min-h-0 max-h-[min(420px,calc(100vh-10rem))]';
    body.dataset.oaaoResearchVaultPicker = '1';

    const hint = document.createElement('p');
    hint.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 shrink-0';
    hint.textContent = 'Expand a vault or folder, click a row to select, then confirm.';
    body.append(hint);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = RESEARCH_INPUT_CLASS;
    search.placeholder = 'Filter by name…';
    body.append(search);

    const treeHost = document.createElement('div');
    treeHost.className =
        'oaao-research-vault-tree min-h-[220px] flex-1 min-w-0 overflow-y-auto border border-solid border-[var(--grid-line)] rounded-lg bg-[var(--grid-panel-bright)]';
    body.append(treeHost);

    /** @param {string} filter */
    function paintTree(filter = '') {
        treeHost.replaceChildren();
        const rows = researchVaultVisibleTreeRows(tree, expandedKeys, filter);
        if (!rows.length) {
            const empty = document.createElement('p');
            empty.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 p-3';
            empty.textContent = filter.trim() ? 'No matching vaults or folders.' : 'No vaults available.';
            treeHost.append(empty);
            return;
        }

        for (const row of rows) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'oaao-research-vault-tree-row';
            btn.dataset.rowKey = row.rowKey;
            btn.style.paddingLeft = `${0.5 + row.depth * 1.125}rem`;
            if (selectedKey === row.rowKey) btn.classList.add('is-active');

            const toggle = document.createElement('span');
            toggle.className = 'oaao-research-vault-tree-toggle';
            toggle.setAttribute('aria-hidden', 'true');
            if (!row.hasChildren) {
                toggle.classList.add('is-leaf');
                toggle.textContent = '·';
            } else {
                toggle.textContent = expandedKeys.has(row.rowKey) ? '▾' : '▸';
            }

            const label = document.createElement('span');
            label.className = 'oaao-research-vault-tree-label';
            label.textContent = row.name;
            label.title = row.breadcrumb;

            const type = document.createElement('span');
            type.className = 'oaao-research-vault-tree-type';
            type.textContent = row.kind === 'vault' ? 'Vault' : 'Folder';

            btn.append(toggle, label, type);

            toggle.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (!row.hasChildren) return;
                if (expandedKeys.has(row.rowKey)) expandedKeys.delete(row.rowKey);
                else expandedKeys.add(row.rowKey);
                paintTree(search.value);
            });

            btn.addEventListener('click', () => {
                selectedKey = row.rowKey;
                if (row.hasChildren && !expandedKeys.has(row.rowKey)) {
                    expandedKeys.add(row.rowKey);
                }
                paintTree(search.value);
            });

            treeHost.append(btn);
        }
    }

    return new Promise((resolve) => {
        let settled = false;
        /** @param {ResearchVaultPathRow | null} row */
        const finish = (row) => {
            if (settled) return;
            settled = true;
            resolve(row);
        };

        DialogMod.open({
            title: 'Path of Vault',
            content: body,
            size: 'md',
            onClose: () => finish(null),
            onOpen: () => paintTree(''),
            buttons: [
                {
                    text: 'Cancel',
                    color: 'muted',
                    action: async () => {
                        finish(null);
                        return true;
                    },
                },
                {
                    text: 'Select',
                    color: 'accent',
                    action: async () => {
                        finish(selectedKey ? rowByKey.get(selectedKey) ?? null : null);
                        return true;
                    },
                },
            ],
        });

        search.addEventListener('input', () => paintTree(search.value));
    });
}

const RESEARCH_INPUT_CLASS =
    'rounded border border-solid border-[var(--grid-line)] px-2 py-1.5 w-full box-border';
const RESEARCH_TEXTAREA_CLASS = `${RESEARCH_INPUT_CLASS} font-mono text-xs`;

/** @type {ReadonlyArray<{ minutes: number, label: string }>} */
const RESEARCH_FETCH_INTERVALS = [
    { minutes: 60, label: '1 hour' },
    { minutes: 240, label: '4 hours' },
    { minutes: 480, label: '8 hours' },
    { minutes: 720, label: '12 hours' },
    { minutes: 1440, label: '1 day' },
];
const RESEARCH_DEFAULT_START_TIME = '09:00';

/**
 * @param {unknown} raw
 * @returns {number}
 */
function normalizeWatchIntervalMinutes(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return 1440;
    const matched = RESEARCH_FETCH_INTERVALS.find((x) => x.minutes === n);
    return matched ? matched.minutes : 1440;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeResearchStartTime(value) {
    const s = String(value ?? RESEARCH_DEFAULT_START_TIME);
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return RESEARCH_DEFAULT_START_TIME;
    return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** @returns {string} */
function browserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

/**
 * @param {Record<string, unknown> | null | undefined} watch
 * @returns {string}
 */
function formatResearchScheduleLine(watch) {
    const enabled = Number(watch?.is_enabled ?? 1) === 1;
    const iv = Number(watch?.interval_minutes ?? 0);
    if (!enabled || !iv) return 'Auto fetch off';
    const slot =
        RESEARCH_FETCH_INTERVALS.find((x) => x.minutes === iv)?.label ?? `${iv} min`;
    const start = normalizeResearchStartTime(watch?.schedule_start_time);
    const tz = String(watch?.schedule_timezone ?? browserTimezone());
    return `Every ${slot} from ${start} (${tz})`;
}

/**
 * @param {Record<string, unknown> | null | undefined} watch
 * @returns {Record<string, unknown>}
 */
function decodeWatchConfig(watch) {
    const raw = watch?.config_json;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const dec = JSON.parse(raw);
            return dec && typeof dec === 'object' ? dec : {};
        } catch {
            return {};
        }
    }
    if (raw && typeof raw === 'object') return /** @type {Record<string, unknown>} */ (raw);
    return {};
}

/**
 * @param {Record<string, unknown>} cfg
 * @returns {string}
 */
function formatResearchFetchPolicyLine(cfg) {
    const maxNew = Number(cfg.max_new_per_run ?? 20);
    const backfill = Boolean(cfg.backfill_enabled);
    const days = Number(cfg.backfill_max_days ?? 30);
    const parts = [`Queue max ${maxNew}/run`, 'URL+hash dedupe'];
    if (backfill) parts.push(`backfill ≤${days}d`);
    const matchPrompt = String(cfg.match_prompt ?? '').trim();
    if (matchPrompt) {
        const minPct = Math.round(Number(cfg.match_min_confidence ?? 0.7) * 100);
        parts.push(`match ≥${minPct}%`);
    }
    return parts.join(' · ');
}

/**
 * @param {Record<string, unknown> | null | undefined} watch
 * @returns {Record<string, unknown>}
 */
function decodeResearchLastStats(watch) {
    const direct = watch?.last_stats;
    if (direct && typeof direct === 'object') {
        return /** @type {Record<string, unknown>} */ (direct);
    }
    const run = watch?.last_run;
    if (run && typeof run === 'object') {
        const raw = /** @type {Record<string, unknown>} */ (run).stats_json;
        if (typeof raw === 'string' && raw.trim()) {
            try {
                const dec = JSON.parse(raw);
                return dec && typeof dec === 'object' ? /** @type {Record<string, unknown>} */ (dec) : {};
            } catch {
                return {};
            }
        }
        if (raw && typeof raw === 'object') {
            return /** @type {Record<string, unknown>} */ (raw);
        }
    }
    return {};
}

/**
 * @param {Record<string, unknown>} stats
 * @param {boolean} [success]
 * @returns {string}
 */
function formatResearchRunStatsBrief(stats, success = true) {
    const queued = Number(stats.queued ?? 0);
    const fetched = Number(stats.new_docs ?? 0);
    const skipped = Number(stats.skipped ?? 0);
    const hits = Number(stats.hits ?? 0);
    const prefix = success ? 'Done' : 'Run failed';
    return `${prefix} — queued: ${queued}, fetched: ${fetched}, skipped: ${skipped}, matches: ${hits}`;
}

/**
 * @param {Record<string, unknown> | null | undefined} watch
 * @returns {HTMLElement}
 */
function buildResearchLastRunRow(watch) {
    const stats = decodeResearchLastStats(watch);
    const run = watch?.last_run;
    const status =
        run && typeof run === 'object' ? String(/** @type {Record<string, unknown>} */ (run).status ?? '') : '';
    const row = document.createElement('div');
    row.className = 'flex flex-wrap items-center gap-1.5 pt-0.5';

    const label = document.createElement('span');
    label.className = 'text-[0.68rem] uppercase tracking-wide font-medium fg-[var(--grid-ink-muted)]';
    label.textContent = status === 'failed' ? 'Last run failed' : 'Last run';
    row.append(label);

    const hasStats = Object.keys(stats).length > 0;
    if (!hasStats) {
        const at =
            watch?.last_run_at ??
            (run && typeof run === 'object' ? /** @type {Record<string, unknown>} */ (run).finished_at : null);
        const plain = document.createElement('span');
        plain.className = 'text-xs fg-[var(--grid-ink-muted)]';
        plain.textContent = at ? String(at) : 'No runs yet';
        row.append(plain);
        return row;
    }

    /** @param {string} text @param {boolean} [accent] */
    const pill = (text, accent = false) => {
        const el = document.createElement('span');
        el.className = accent
            ? 'inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.68rem] font-semibold bg-[var(--grid-ink)] fg-[var(--grid-paper)]'
            : 'inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.68rem] font-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] fg-[var(--grid-ink-muted)]';
        el.textContent = text;
        return el;
    };

    const queued = Number(stats.queued ?? 0);
    const fetched = Number(stats.new_docs ?? 0);
    const skipped = Number(stats.skipped ?? 0);
    const hits = Number(stats.hits ?? 0);
    if (queued > 0) row.append(pill(`run +${queued}`));
    row.append(pill(`fetched ${fetched}`, fetched > 0));
    if (skipped > 0) row.append(pill(`skipped ${skipped}`));
    if (hits > 0) row.append(pill(`matches ${hits}`, true));
    return row;
}

/**
 * @param {Record<string, unknown> | null | undefined} job
 * @returns {string}
 */
function researchJobLabel(job) {
    const title = String(job?.title ?? '').trim();
    const url = String(job?.canonical_url ?? '').trim();
    return title || url || 'Untitled';
}

/**
 * arXiv jobs queue /abs/ (layer 2); worker resolves HTML (experimental) at fetch time.
 *
 * @param {string} url
 * @returns {{ fetchUrl: string, hint: string } | null}
 */
function researchArxivFetchResolution(url) {
    const u = String(url ?? '').trim();
    if (!/arxiv\.org\/abs\//i.test(u)) return null;
    const m = u.match(/([0-9]{4}\.[0-9]{4,5})/i);
    if (!m) return null;
    return {
        fetchUrl: `https://arxiv.org/html/${m[1]}v1`,
        hint: 'Layer 3 at fetch — HTML (experimental), else /abs/ abstract',
    };
}

/**
 * @param {string} layer
 * @returns {string}
 */
function researchLayerBadgeText(layer) {
    if (layer === 'fulltext') return 'Layer 3/3 · HTML full text';
    if (layer === 'metadata') return 'Layer 2/3 · /abs/ metadata';
    if (layer === 'index') return 'Layer 1/3 · Index / list';
    return '';
}

/** @returns {HTMLElement} */
function createResearchArxivPipelineNote() {
    const p = document.createElement('p');
    p.className =
        'm-0 text-xs leading-snug fg-[var(--grid-ink-muted)] rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-2.5 py-2';
    p.textContent =
        'arXiv pipeline: list (layer 1) → /abs/ queued below (layer 2) → HTML (experimental) full text resolved automatically when each job runs (layer 3).';
    return p;
}

/**
 * @param {Record<string, unknown> | null | undefined} watch
 * @returns {Record<string, unknown> | null}
 */
function decodeResearchQueueStatus(watch) {
    const qs = watch?.queue_status;
    return qs && typeof qs === 'object' ? /** @type {Record<string, unknown>} */ (qs) : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} watch
 * @param {{ expanded?: boolean }} [opts]
 * @returns {HTMLElement}
 */
function buildResearchQueueStatusSection(watch, opts = {}) {
    const qs = decodeResearchQueueStatus(watch);
    const watchId = Number(watch?.watch_id ?? 0);
    const expanded =
        opts.expanded === true ||
        (opts.expanded !== false && watchId > 0 && researchQueueMonitorExpanded.has(watchId));

    const section = document.createElement('div');
    section.className =
        'grid gap-1.5 rounded-lg border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] p-2.5';
    section.dataset.oaaoResearchQueue = String(watchId);
    section.dataset.oaaoResearchQueueOpen = expanded ? '1' : '0';

    const counts =
        qs?.counts && typeof qs.counts === 'object'
            ? /** @type {Record<string, unknown>} */ (qs.counts)
            : {};
    const pending = Number(
        qs?.pending ?? Number(counts.queued ?? 0) + Number(counts.running ?? 0),
    );
    const nextJob =
        qs?.next_job && typeof qs.next_job === 'object'
            ? /** @type {Record<string, unknown>} */ (qs.next_job)
            : null;
    const lastEnqueued =
        qs?.last_enqueued && typeof qs.last_enqueued === 'object'
            ? /** @type {Record<string, unknown>} */ (qs.last_enqueued)
            : null;
    const pendingJobs = Array.isArray(qs?.pending_jobs) ? qs.pending_jobs : [];

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className =
        'w-full flex flex-wrap items-center justify-between gap-2 p-0 border-none bg-transparent cursor-pointer text-left';
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    const toggleLeft = document.createElement('span');
    toggleLeft.className = 'inline-flex items-center gap-1.5 min-w-0';
    const chevron = document.createElement('span');
    chevron.className = 'text-[0.65rem] fg-[var(--grid-ink-muted)] shrink-0';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = expanded ? '▾' : '▸';
    const title = document.createElement('span');
    title.className = 'text-[0.68rem] uppercase tracking-wide font-semibold fg-[var(--grid-ink-muted)]';
    title.textContent = 'Status';
    toggleLeft.append(chevron, title);

    const badgeRow = document.createElement('span');
    badgeRow.className = 'flex flex-wrap gap-1 justify-end';

    /** @param {string} text @param {boolean} [live] */
    const badge = (text, live = false) => {
        const el = document.createElement('span');
        el.className = live
            ? 'inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.65rem] font-semibold bg-[var(--grid-ink)] fg-[var(--grid-paper)]'
            : 'inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.65rem] font-medium border border-solid border-[var(--grid-line)] fg-[var(--grid-ink-muted)]';
        el.textContent = text;
        return el;
    };

    if (pending > 0) badgeRow.append(badge(`${pending} backlog`, true));
    const refetchPending = Number(qs?.refetch_pending ?? 0);
    const refetchCounts =
        qs?.refetch && typeof qs.refetch === 'object'
            ? /** @type {Record<string, unknown>} */ (qs.refetch)
            : {};
    const refetchQueued = Number(refetchCounts.queued ?? 0);
    const refetchRunning = Number(refetchCounts.running ?? 0);
    const refetchRunningItem =
        qs?.refetch_running_item && typeof qs.refetch_running_item === 'object'
            ? /** @type {Record<string, unknown>} */ (qs.refetch_running_item)
            : null;
    if (refetchPending > 0) badgeRow.append(badge(`${refetchPending} refetch`, true));
    if (Number(counts.running ?? 0) > 0) badgeRow.append(badge(`${counts.running} running`));
    if (Number(counts.done ?? 0) > 0) badgeRow.append(badge(`${counts.done} done`));
    if (Number(counts.failed ?? 0) > 0) badgeRow.append(badge(`${counts.failed} failed`));
    if (!badgeRow.childElementCount) badgeRow.append(badge('idle'));
    toggle.append(toggleLeft, badgeRow);

    const hint = document.createElement('p');
    hint.className = 'm-0 text-xs fg-[var(--grid-ink-muted)] truncate';
    if (nextJob) {
        hint.textContent = `Next: ${researchJobLabel(nextJob)}`;
        hint.title = researchJobLabel(nextJob);
    } else if (refetchRunningItem) {
        const label = researchJobLabel(refetchRunningItem);
        hint.textContent =
            refetchQueued > 0
                ? `Refetching: ${label} — ${refetchQueued} more queued (one at a time, ~30s each)`
                : `Refetching: ${label}`;
        hint.title = label;
    } else if (refetchPending > 0) {
        hint.textContent = `${refetchPending} article(s) queued for background refetch`;
    } else if (pending > 0) {
        hint.textContent = `${pending} in backlog — click to monitor`;
    } else {
        hint.textContent = 'Queue idle — click to monitor';
    }
    if (expanded) hint.classList.add('hidden');

    const body = document.createElement('div');
    body.dataset.oaaoResearchQueueBody = '1';
    body.className = expanded ? 'grid gap-2' : 'hidden';

    /** @param {boolean} open */
    const setQueueBodyOpen = (open) => {
        body.className = open ? 'grid gap-2' : 'hidden';
    };

    if (nextJob || lastEnqueued || refetchRunningItem) {
        const meta = document.createElement('div');
        meta.className = 'grid gap-1 text-xs';
        if (refetchRunningItem) {
            const row = document.createElement('p');
            row.className = 'm-0 fg-[var(--grid-ink)]';
            const prefix = document.createElement('span');
            prefix.className = 'fg-[var(--grid-ink-muted)] font-medium';
            prefix.textContent = 'Refetching now: ';
            row.append(prefix, document.createTextNode(researchJobLabel(refetchRunningItem)));
            meta.append(row);
            const rlink = document.createElement('a');
            rlink.className = 'm-0 text-[0.68rem] break-all fg-[var(--grid-ink-muted)] hover:underline';
            rlink.href = String(refetchRunningItem.canonical_url ?? '#');
            rlink.target = '_blank';
            rlink.rel = 'noopener noreferrer';
            rlink.textContent = String(refetchRunningItem.canonical_url ?? '');
            meta.append(rlink);
        }
        if (nextJob) {
            const row = document.createElement('p');
            row.className = 'm-0 fg-[var(--grid-ink)]';
            const prefix = document.createElement('span');
            prefix.className = 'fg-[var(--grid-ink-muted)] font-medium';
            prefix.textContent = 'Next: ';
            row.append(prefix, document.createTextNode(researchJobLabel(nextJob)));
            meta.append(row);
            const link = document.createElement('a');
            link.className = 'm-0 text-[0.68rem] break-all fg-[var(--grid-ink-muted)] hover:underline';
            link.href = String(nextJob.canonical_url ?? '#');
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = String(nextJob.canonical_url ?? '');
            meta.append(link);
            const nextRes = researchArxivFetchResolution(String(nextJob.canonical_url ?? ''));
            if (nextRes) {
                const fetchNote = document.createElement('p');
                fetchNote.className = 'm-0 text-[0.68rem] fg-[var(--grid-accent,#2563eb)] break-all leading-snug';
                fetchNote.textContent = `→ ${nextRes.fetchUrl} · ${nextRes.hint}`;
                meta.append(fetchNote);
            }
        }
        if (lastEnqueued && lastEnqueued !== nextJob) {
            const row = document.createElement('p');
            row.className = 'm-0 fg-[var(--grid-ink-muted)]';
            row.textContent = `Last queued: ${researchJobLabel(lastEnqueued)}`;
            meta.append(row);
        }
        body.append(meta);
    }

    if (pendingJobs.length) {
        const listTitle = document.createElement('p');
        listTitle.className = 'm-0 text-[0.68rem] uppercase tracking-wide font-medium fg-[var(--grid-ink-muted)]';
        listTitle.textContent = 'In queue';
        const list = document.createElement('ul');
        list.className = 'm-0 pl-0 list-none grid gap-1 max-h-28 overflow-y-auto';
        for (const raw of pendingJobs.slice(0, 6)) {
            if (!raw || typeof raw !== 'object') continue;
            const job = /** @type {Record<string, unknown>} */ (raw);
            const li = document.createElement('li');
            li.className =
                'flex items-start gap-2 rounded border border-solid border-[var(--grid-line)]/70 px-2 py-1.5 bg-[var(--grid-panel-bright)]';
            const dot = document.createElement('span');
            dot.className = 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full';
            dot.style.background =
                String(job.status ?? '') === 'running'
                    ? 'var(--grid-ink)'
                    : 'color-mix(in srgb, var(--grid-ink-muted) 55%, transparent)';
            const jobBody = document.createElement('div');
            jobBody.className = 'min-w-0 grid gap-0.5';
            const label = document.createElement('span');
            label.className = 'text-xs font-medium fg-[var(--grid-ink)] truncate block';
            label.textContent = researchJobLabel(job);
            label.title = researchJobLabel(job);
            const sub = document.createElement('span');
            sub.className = 'text-[0.65rem] fg-[var(--grid-ink-muted)] truncate block';
            sub.textContent = String(job.canonical_url ?? '');
            sub.title = String(job.canonical_url ?? '');
            jobBody.append(label, sub);
            const resolution = researchArxivFetchResolution(String(job.canonical_url ?? ''));
            if (resolution) {
                const fetchLine = document.createElement('span');
                fetchLine.className =
                    'text-[0.65rem] fg-[var(--grid-accent,#2563eb)] break-all leading-snug block';
                fetchLine.textContent = `→ ${resolution.fetchUrl} · ${resolution.hint}`;
                fetchLine.title = resolution.hint;
                jobBody.append(fetchLine);
            }
            li.append(dot, jobBody);
            list.append(li);
        }
        body.append(listTitle, list);
    } else if (pending === 0 && refetchPending === 0) {
        const idle = document.createElement('p');
        idle.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
        idle.textContent = 'No articles waiting in queue.';
        body.append(idle);
    } else if (refetchPending > 0 && pendingJobs.length === 0) {
        const refetchNote = document.createElement('p');
        refetchNote.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
        refetchNote.textContent = `${refetchPending} article(s) queued for background refetch (one at a time).`;
        body.append(refetchNote);
    }

    toggle.addEventListener('click', () => {
        const nowOpen = section.dataset.oaaoResearchQueueOpen === '1';
        const nextOpen = !nowOpen;
        section.dataset.oaaoResearchQueueOpen = nextOpen ? '1' : '0';
        toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        chevron.textContent = nextOpen ? '▾' : '▸';
        setQueueBodyOpen(nextOpen);
        hint.classList.toggle('hidden', nextOpen);
        if (watchId > 0) {
            if (nextOpen) researchQueueMonitorExpanded.add(watchId);
            else researchQueueMonitorExpanded.delete(watchId);
        }
    });

    section.append(toggle, hint, body);
    return section;
}

/**
 * @param {string} label
 * @param {number} value
 * @param {{ accent?: boolean, muted?: boolean }} [opts]
 * @returns {HTMLElement}
 */
function createResearchStatTile(label, value, opts = {}) {
    const tile = document.createElement('div');
    tile.className =
        'rounded-lg border border-solid border-[var(--grid-line)] p-3 flex flex-col gap-0.5 min-w-0 bg-[var(--grid-paper)]';
    if (opts.accent) {
        tile.className +=
            ' border-[color-mix(in_srgb,var(--grid-ink)_22%,var(--grid-line))] bg-[var(--grid-panel-bright)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--grid-paper)_60%,transparent)]';
    }
    const valEl = document.createElement('span');
    valEl.className = `text-2xl font-semibold tabular-nums leading-none tracking-tight ${
        opts.accent ? 'fg-[var(--grid-ink)]' : 'fg-[var(--grid-ink)]'
    }`;
    valEl.textContent = String(value);
    const labelEl = document.createElement('span');
    labelEl.className = `text-[0.68rem] uppercase tracking-wide font-medium ${
        opts.muted ? 'fg-[var(--grid-ink-muted)]' : 'fg-[var(--grid-ink-muted)]'
    }`;
    labelEl.textContent = label;
    tile.append(valEl, labelEl);
    return tile;
}

/**
 * @param {number} value
 * @param {number} max
 * @param {string} caption
 * @returns {HTMLElement}
 */
function createResearchRunProgress(value, max, caption) {
    const wrap = document.createElement('div');
    wrap.className = 'grid gap-1.5';
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between gap-2 text-xs';
    const cap = document.createElement('span');
    cap.className = 'fg-[var(--grid-ink-muted)] font-medium';
    cap.textContent = caption;
    const pctLabel = document.createElement('span');
    pctLabel.className = 'fg-[var(--grid-ink)] tabular-nums font-semibold';
    const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
    pctLabel.textContent = max > 0 ? `${value} / ${max} (${pct}%)` : '—';
    head.append(cap, pctLabel);

    const track = document.createElement('div');
    track.className =
        'h-2 w-full overflow-hidden rounded-full border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]';
    const bar = document.createElement('div');
    bar.className = 'h-full rounded-full transition-[width] duration-500 ease-out';
    bar.style.width = `${pct}%`;
    bar.style.background =
        'linear-gradient(90deg, color-mix(in srgb, var(--grid-ink) 78%, transparent), var(--grid-ink))';
    track.append(bar);
    wrap.append(head, track);
    return wrap;
}

/**
 * @param {boolean} success
 * @param {string} title
 * @param {string} [subtitle]
 * @returns {HTMLElement}
 */
function createResearchRunStatusBanner(success, title, subtitle) {
    const banner = document.createElement('div');
    banner.className =
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-3 py-2';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-2 min-w-0';

    const dot = document.createElement('span');
    dot.className = 'inline-block h-1.5 w-1.5 shrink-0 rounded-full';
    dot.style.background = success ? 'var(--grid-ink)' : '#dc2626';
    dot.setAttribute('aria-hidden', 'true');

    const h = document.createElement('span');
    h.className = `text-sm font-semibold leading-snug ${success ? 'fg-[var(--grid-ink)]' : 'text-red-700'}`;
    h.textContent = title;
    left.append(dot, h);

    banner.append(left);

    if (subtitle) {
        const sub = document.createElement('span');
        sub.className = 'text-xs fg-[var(--grid-ink-muted)] leading-snug text-right';
        sub.textContent = subtitle;
        banner.append(sub);
    }

    return banner;
}

/**
 * @param {HTMLElement} host
 * @param {{ success?: boolean, runId?: number, stats?: Record<string, unknown>, message?: string, error?: string, purge?: Record<string, unknown> }} opts
 */
function renderResearchRunSummary(host, opts) {
    host.replaceChildren();
    host.className = 'grid gap-3 min-h-[8rem]';
    const stats = opts.stats && typeof opts.stats === 'object' ? opts.stats : {};
    const success = opts.success !== false;
    const errors = Array.isArray(stats.errors) ? stats.errors : [];

    const planned = Number(stats.planned ?? stats.fetched ?? 0);
    const queued = Number(stats.queued ?? 0);
    const processed = Number(stats.processed ?? 0);
    const fetched = Number(stats.new_docs ?? 0);
    const skipped = Number(stats.skipped ?? 0);
    const hits = Number(stats.hits ?? 0);
    const indexUnchanged = Number(stats.index_unchanged ?? 0);
    const refetchItems = Number(stats.refetch_items ?? stats.refetch_queued ?? 0);
    const refetchPending = Number(stats.refetch_pending ?? 0);
    const backgroundQueued = Number(stats.background_queued ?? 0);

    const runLabel = opts.runId ? `Run #${opts.runId}` : 'Run';
    const subtitle =
        refetchPending > 0
            ? `${refetchPending} article(s) queued — background worker refetches one at a time`
            : refetchItems > 0
              ? `${refetchItems} article(s) queued for background refetch`
              : backgroundQueued > 0
            ? `${processed} processed now — ${backgroundQueued} still in background queue`
            : refetchItems > 0 && queued > 0
              ? `Refetch: ${queued} article(s) queued (${refetchItems} stored URLs)`
              : queued > 0 && processed === 0
                ? `${queued} item(s) queued for background fetch`
                : queued > processed
                  ? `${queued - processed} item(s) still in background queue`
                  : fetched > 0
                    ? `${fetched} new article(s) saved to vault`
                    : hits > 0
                      ? `${hits} match(es) found`
                      : refetchItems > 0 && queued === 0
                        ? 'Refetch found no stored articles to queue'
                        : 'Fetch cycle finished with no new articles';

    host.append(
        createResearchRunStatusBanner(
            success,
            success ? `${runLabel} completed` : `${runLabel} failed`,
            success ? subtitle : String(opts.message || opts.error || 'The run did not finish successfully'),
        ),
    );

    if (success && (planned > 0 || queued > 0 || refetchPending > 0 || refetchItems > 0)) {
        host.append(
            createResearchRunProgress(
                processed || refetchPending || queued,
                Math.max(planned, queued, refetchPending, refetchItems),
                refetchPending > 0 || refetchItems > 0 ? 'Refetch progress' : 'Queue progress',
            ),
        );
    }

    const primaryGrid = document.createElement('div');
    primaryGrid.className = 'grid grid-cols-2 sm:grid-cols-3 gap-2';
    primaryGrid.append(
        createResearchStatTile('Queued', queued),
        createResearchStatTile('Fetched', fetched, { accent: fetched > 0 }),
        createResearchStatTile('Matches', hits, { accent: hits > 0 }),
        createResearchStatTile('Processed', processed, { muted: true }),
        createResearchStatTile('Skipped', skipped, { muted: true }),
        createResearchStatTile('Index same', indexUnchanged, { muted: true }),
    );
    host.append(primaryGrid);

    const purge =
        opts.purge && typeof opts.purge === 'object'
            ? /** @type {Record<string, unknown>} */ (opts.purge)
            : null;
    if (purge) {
        const removed = Number(purge.documents_removed ?? 0);
        if (removed > 0) {
            const purgeNote = document.createElement('p');
            purgeNote.className = 'm-0 text-xs fg-[var(--grid-ink-muted)] text-center';
            purgeNote.textContent = `Purged ${removed} vault file(s) — markdown, summaries, and embeddings removed before refetch.`;
            host.append(purgeNote);
        }
    }

    if (planned > 0 && planned !== queued) {
        const foot = document.createElement('p');
        foot.className = 'm-0 text-xs fg-[var(--grid-ink-muted)] text-center';
        foot.textContent = `${planned} URL(s) planned this run`;
        host.append(foot);
    }

    if (!success && (opts.message || opts.error)) {
        const err = document.createElement('div');
        err.className =
            'rounded-lg border border-solid border-red-300/70 bg-red-50/40 px-3 py-2 text-sm text-red-700';
        err.textContent = String(opts.message || opts.error || 'Run failed');
        host.append(err);
    }

    if (errors.length) {
        const errBox = document.createElement('div');
        errBox.className =
            'rounded-lg border border-solid border-red-300/60 bg-red-50/35 p-3 grid gap-2';
        const errTitle = document.createElement('p');
        errTitle.className = 'text-xs font-semibold uppercase tracking-wide text-red-700 m-0';
        errTitle.textContent = `Errors (${errors.length})`;
        const list = document.createElement('ul');
        list.className = 'm-0 pl-4 text-xs text-red-700 max-h-32 overflow-y-auto grid gap-1';
        for (const e of errors.slice(0, 20)) {
            const li = document.createElement('li');
            li.className = 'break-all';
            if (e && typeof e === 'object') {
                const url = String(/** @type {Record<string, unknown>} */ (e).url ?? '');
                const msg = String(/** @type {Record<string, unknown>} */ (e).error ?? 'error');
                li.textContent = url ? `${url} — ${msg}` : msg;
            } else {
                li.textContent = String(e);
            }
            list.append(li);
        }
        errBox.append(errTitle, list);
        host.append(errBox);
    }
}

/**
 * @param {typeof DialogCtor} DialogMod
 * @param {Record<string, unknown>} watch
 * @param {{ onDone?: (result: { success: boolean, stats: Record<string, unknown>, runId?: number }) => void | Promise<void>, refetch?: boolean }} [hooks]
 */
function openResearchRunDialog(DialogMod, watch, hooks = {}) {
    const watchId = Number(watch?.watch_id ?? 0);
    const label = String(watch?.label ?? 'Watch');
    const refetch = Boolean(hooks.refetch);
    const body = document.createElement('div');
    body.className = 'grid gap-3 min-h-[8rem]';
    body.append(createResearchLoadingBlock(refetch ? 'Queueing articles for background refetch…' : 'Running fetch queue…'));

    DialogMod.open({
        title: refetch ? `Refetch all: ${label}` : `Run: ${label}`,
        content: body,
        size: 'lg',
        closable: true,
        overlayClose: false,
        buttons: [
            {
                text: 'Close',
                color: 'accent',
                action: async () => true,
            },
        ],
        onOpen: () => {
            void (async () => {
                const endpoint = refetch ? 'refetch_all' : 'run_now';
                const { res, data } = await fetchJson(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ watch_id: watchId }),
                });
                const success = Boolean(res.ok && data?.success);
                const stats =
                    data?.stats && typeof data.stats === 'object'
                        ? /** @type {Record<string, unknown>} */ (data.stats)
                        : data?.data?.stats && typeof data.data.stats === 'object'
                          ? /** @type {Record<string, unknown>} */ (data.data.stats)
                          : {};
                const errText =
                    typeof data?.message === 'string' && data.message
                        ? data.message
                        : typeof data?.data?.error === 'string'
                          ? data.data.error
                          : typeof stats.error === 'string'
                            ? stats.error
                            : !res.ok
                              ? `HTTP ${res.status}`
                              : undefined;
                renderResearchRunSummary(body, {
                    success,
                    runId: typeof data?.run_id === 'number' ? data.run_id : undefined,
                    stats,
                    purge:
                        data?.purge && typeof data.purge === 'object'
                            ? /** @type {Record<string, unknown>} */ (data.purge)
                            : undefined,
                    message: errText,
                    error: errText,
                });
                const q = await fetchJson(`fetch_queue_status?watch_id=${watchId}`);
                if (q.res.ok && q.data?.success && q.data.status) {
                    const qs = /** @type {Record<string, unknown>} */ (q.data.status);
                    const pendingJobs = Array.isArray(qs.pending_jobs) ? qs.pending_jobs : [];
                    const hasArxivQueue = pendingJobs.some((raw) => {
                        if (!raw || typeof raw !== 'object') return false;
                        return /arxiv\.org\/abs\//i.test(String(/** @type {Record<string, unknown>} */ (raw).canonical_url ?? ''));
                    });
                    if (hasArxivQueue || refetch) {
                        body.append(createResearchArxivPipelineNote());
                    }
                    body.append(
                        buildResearchQueueStatusSection({
                            watch_id: watchId,
                            queue_status: q.data.status,
                        }),
                    );
                }
                await hooks.onDone?.({ success, stats, runId: typeof data?.run_id === 'number' ? data.run_id : undefined });
            })();
        },
    });
}

/**
 * @param {string} labelText
 * @param {HTMLElement} field
 */
function researchFormField(labelText, field) {
    const label = document.createElement('label');
    label.className = 'grid gap-1 text-sm';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span, field);
    return label;
}

/**
 * @param {Record<string, unknown> | null | undefined} watch
 * @returns {string}
 */
function watchSourceLines(watch) {
    const sources = Array.isArray(watch?.sources) ? watch.sources : [];
    return sources
        .map((s) => {
            if (!s || typeof s !== 'object') return '';
            let url = '';
            const directUrl = s.url ?? s.feed_url;
            if (typeof directUrl === 'string' && directUrl.trim()) {
                url = directUrl.trim();
            }
            if (!url) {
                try {
                    const raw = s.config_json;
                    if (raw && typeof raw === 'object') {
                        url = String(/** @type {Record<string, unknown>} */ (raw).url ?? '').trim();
                    } else if (typeof raw === 'string' && raw.trim()) {
                        const dec = JSON.parse(raw);
                        url = String(dec?.url ?? '').trim();
                    }
                } catch {
                    url = '';
                }
            }
            if (!url) return '';
            const kind = String(s.kind ?? '').toLowerCase();
            if (kind === 'index') return `index:${url}`;
            if (kind === 'static') return `static:${url}`;
            if (kind === 'rss') return url;
            if (kind === 'arxiv') return url;
            if (kind === 'blog') return url;
            return url;
        })
        .filter(Boolean)
        .join('\n');
}

/**
 * @param {Record<string, unknown>} preview
 * @returns {string}
 */
function sourceLineFromDiscoverPreview(preview) {
    if (!preview || preview.ok === false) return '';
    const url = String(preview.url ?? '').trim();
    if (!url) return '';
    const kind = String(preview.resolved_kind ?? preview.page_type ?? '').toLowerCase();
    if (kind === 'index') return `index:${url}`;
    if (kind === 'static') return `static:${url}`;
    return url;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
function discoverResultToSourceLines(data) {
    const previews = Array.isArray(data.previews) ? data.previews : [];
    return previews.map((p) => sourceLineFromDiscoverPreview(/** @type {Record<string, unknown>} */ (p))).filter(Boolean).join('\n');
}

const RESEARCH_SOURCES_PLACEHOLDER = `# Paste URLs — Analyze to detect list vs article before creating
https://arxiv.org/list/cs.AI/recent
https://example.com/blog/

# Or specify explicitly:
index:https://arxiv.org/list/cs.AI/recent
static:https://example.com/article
https://example.com/feed.xml`;

/**
 * @param {string} line
 * @returns {{ kind: string, url: string } | null}
 */
function parseResearchSourceLine(line) {
    const t = line.trim();
    if (!t || t.startsWith('#')) return null;

    let rest = t;
    let kind = '';
    const prefix = rest.match(/^(index|static|rss|arxiv|blog|auto):/i);
    if (prefix) {
        kind = prefix[1].toLowerCase();
        rest = rest.slice(prefix[0].length).trim();
    }

    const url = rest.trim();
    if (!url) return null;

    if (!kind) {
        if (/rss|feed|atom/i.test(url) || url.endsWith('.xml')) kind = 'rss';
        else if (/arxiv\.org\/list\//i.test(url)) kind = 'index';
        else if (/arxiv\.org\/(abs|pdf)\//i.test(url) || /^[0-9]{4}\.[0-9]{4,5}/.test(url)) kind = 'arxiv';
        else kind = 'auto';
    }

    return { kind, url };
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} data
 */
function renderResearchDiscoverPreview(host, data) {
    host.replaceChildren();
    const previews = Array.isArray(data.previews) ? data.previews : [];
    if (!previews.length) {
        host.textContent = 'No preview results.';
        return;
    }
    for (const p of previews) {
        const block = document.createElement('div');
        block.className =
            'rounded border border-solid border-[var(--grid-line)] p-2 text-xs fg-[var(--grid-ink)] bg-[var(--grid-paper)]';
        if (!p.ok) {
            block.textContent = `${String(p.url ?? '')}: ${String(p.error ?? 'failed')}`;
            host.append(block);
            continue;
        }
        const type = String(p.page_type ?? p.resolved_kind ?? '?');
        const conf = typeof p.confidence === 'number' ? `${Math.round(p.confidence * 100)}%` : '—';
        const head = document.createElement('p');
        head.className = 'm-0 font-medium';
        head.textContent = `${String(p.url ?? '')} → ${type} (${conf}, ${String(p.method ?? '')})`;
        block.append(head);
        if (p.reason) {
            const reason = document.createElement('p');
            reason.className = 'm-0 mt-1 fg-[var(--grid-ink-muted)]';
            reason.textContent = String(p.reason);
            block.append(reason);
        }
        const items = Array.isArray(p.items) ? p.items : [];
        if (items.length) {
            const list = document.createElement('ul');
            list.className = 'm-0 mt-2 pl-4 max-h-32 overflow-y-auto';
            for (const it of items.slice(0, 30)) {
                const li = document.createElement('li');
                li.className = 'break-all';
                const contentUrl =
                    typeof it.content_url === 'string' && it.content_url.trim() ? it.content_url.trim() : '';
                const contentHint =
                    typeof it.content_hint === 'string' && it.content_hint.trim() ? it.content_hint.trim() : '';
                const score =
                    typeof it.article_score === 'number' || typeof it.article_score === 'string'
                        ? ` · score ${it.article_score}`
                        : '';
                li.textContent = contentUrl
                    ? `${String(it.title ?? it.url ?? '')} — ${String(it.url ?? '')}${score} · fetch: ${contentUrl}${contentHint ? ` (${contentHint})` : ''}`
                    : `${String(it.title ?? it.url ?? '')} — ${String(it.url ?? '')}${score}`;
                list.append(li);
            }
            if (items.length > 30) {
                const more = document.createElement('li');
                more.textContent = `… and ${items.length - 30} more`;
                list.append(more);
            }
            block.append(list);
        }
        host.append(block);
    }
}

/** @param {HTMLElement} host @param {{ generation?: number, signal?: AbortSignal }} [opts] */
async function mountResearchPanel(host, opts = {}) {
    const generation = opts.generation ?? mountGeneration;
    const signal = opts.signal;
    const listEl = host.querySelector('[data-oaao-research="list"]');
    const msgEl = host.querySelector('[data-oaao-research="msg"]');
    const newBtn = host.querySelector('[data-oaao-research="new"]');
    if (!(listEl instanceof HTMLElement) || !(msgEl instanceof HTMLElement)) return;

    /** @type {Array<Record<string, unknown>>} */
    let watches = [];

    function setMsg(text) {
        msgEl.textContent = text;
    }

    /**
     * @param {HTMLElement} formRoot
     * @param {number} watchId
     * @param {Record<string, unknown> | null} [discoverData]
     */
    function buildWatchPayload(formRoot, watchId, discoverData = null) {
        const get = (name) => formRoot.querySelector(`[data-f="${name}"]`);
        const labelEl = get('label');
        const vaultEl = get('vault_id');
        const parentEl = get('parent_container_id');
        const folderNameEl = get('folder_name');
        const langEl = get('summary_language');
        const intervalEl = get('interval_minutes');
        const startTimeEl = get('schedule_start_time');
        const enabledEl = get('is_enabled');
        const maxNewEl = get('max_new_per_run');
        const backfillEl = get('backfill_enabled');
        const backfillDaysEl = get('backfill_max_days');
        const matchPromptEl = get('match_prompt');
        const matchMinConfEl = get('match_min_confidence');
        const notifyEl = get('notify_in_app');
        const sourcesEl = get('sources');
        /** @type {Array<{kind: string, url: string}>} */
        const sources = [];
        if (discoverData && Array.isArray(discoverData.sources)) {
            for (const src of discoverData.sources) {
                if (!src || typeof src !== 'object') continue;
                const row = /** @type {Record<string, unknown>} */ (src);
                const url = String(row.url ?? '').trim();
                if (!url) continue;
                /** @type {Record<string, unknown>} */
                const out = {
                    url,
                    kind: String(row.kind ?? row.resolved_kind ?? 'static'),
                    resolved_kind: String(row.resolved_kind ?? row.kind ?? 'static'),
                    discovered_mode: String(row.discovered_mode ?? row.resolved_kind ?? 'static'),
                };
                if (row.html_hash) out.html_hash = String(row.html_hash);
                if (row.item_url_pattern) {
                    out.item_url_pattern = String(row.item_url_pattern);
                    out.link_pattern = String(row.item_url_pattern);
                }
                if (Array.isArray(row.confirmed_sample_urls)) {
                    out.confirmed_sample_urls = row.confirmed_sample_urls;
                }
                if (Array.isArray(row.discover_path)) {
                    out.discover_path = row.discover_path;
                }
                sources.push(/** @type {{kind: string, url: string}} */ (out));
            }
        } else if (discoverData && Array.isArray(discoverData.previews)) {
            for (const p of discoverData.previews) {
                if (!p || p.ok === false) continue;
                const pageType = String(p.page_type ?? '');
                /** @type {Record<string, unknown>} */
                const src = {
                    url: String(p.url ?? ''),
                    kind: String(p.resolved_kind ?? 'static'),
                    resolved_kind: String(p.resolved_kind ?? 'static'),
                    discovered_mode: pageType === 'index' ? 'index' : pageType === 'rss' ? 'rss' : 'static',
                };
                if (p.html_hash) src.html_hash = String(p.html_hash);
                sources.push(/** @type {{kind: string, url: string}} */ (src));
            }
        } else if (sourcesEl instanceof HTMLTextAreaElement) {
            for (const line of sourcesEl.value.split(/\n/)) {
                const parsed = parseResearchSourceLine(line);
                if (parsed) sources.push(parsed);
            }
        }
        /** @type {Record<string, unknown>} */
        const payload = {
            watch_id: watchId > 0 ? watchId : undefined,
            label: labelEl instanceof HTMLInputElement ? labelEl.value.trim() : '',
            vault_id: vaultEl instanceof HTMLInputElement ? Number(vaultEl.value) : 0,
            summary_language: readSummaryLanguageValue(langEl),
            interval_minutes: readIntervalMinutesValue(intervalEl),
            schedule_start_time: readScheduleStartTimeValue(startTimeEl),
            schedule_timezone: browserTimezone(),
            is_enabled: enabledEl instanceof HTMLInputElement ? enabledEl.checked : true,
            max_new_per_run:
                maxNewEl instanceof HTMLInputElement ? Number(maxNewEl.value) : 20,
            backfill_enabled: backfillEl instanceof HTMLInputElement ? backfillEl.checked : false,
            backfill_max_days:
                backfillDaysEl instanceof HTMLInputElement ? Number(backfillDaysEl.value) : 30,
            match_prompt:
                matchPromptEl instanceof HTMLTextAreaElement ? matchPromptEl.value.trim() : '',
            match_min_confidence:
                matchMinConfEl instanceof HTMLInputElement
                    ? Number(matchMinConfEl.value) / 100
                    : 0.7,
            notify_in_app: notifyEl instanceof HTMLInputElement ? notifyEl.checked : false,
            sources,
        };
        if (watchId < 1) {
            const parentRaw = parentEl instanceof HTMLInputElement ? parentEl.value.trim() : '';
            payload.parent_container_id =
                parentRaw === '' ? null : Number.isFinite(Number(parentRaw)) ? Number(parentRaw) : null;
            const folderName = folderNameEl instanceof HTMLInputElement ? folderNameEl.value.trim() : '';
            if (folderName) payload.folder_name = folderName;
        }
        if (watchId < 1 && discoverData) {
            payload.discover_confirmed = true;
        }
        return payload;
    }

    /** @param {Record<string, unknown> | null} [watch] */
    async function openWatchDialog(watch = null) {
        const DialogMod = await loadDialogCtor();
        if (!DialogMod) {
            setMsg('Dialog unavailable.');
            return;
        }

        const watchId = watch?.watch_id ? Number(watch.watch_id) : 0;
        const isEdit = watchId > 0;

        const wrap = document.createElement('div');
        wrap.className = 'grid gap-3';

        const errEl = document.createElement('p');
        errEl.className = 'hidden text-xs text-red-600 m-0';

        const labelInput = document.createElement('input');
        labelInput.dataset.f = 'label';
        labelInput.className = RESEARCH_INPUT_CLASS;
        labelInput.value = watch ? String(watch.label ?? '') : '';

        const vaultIdHidden = document.createElement('input');
        vaultIdHidden.type = 'hidden';
        vaultIdHidden.dataset.f = 'vault_id';

        const parentHidden = document.createElement('input');
        parentHidden.type = 'hidden';
        parentHidden.dataset.f = 'parent_container_id';

        const pathWrap = document.createElement('div');
        pathWrap.className = 'grid gap-2 min-w-0';

        const pathRow = document.createElement('div');
        pathRow.className = 'flex flex-wrap items-center gap-2 min-w-0';

        const pathDisplay = document.createElement('div');
        pathDisplay.className =
            'flex-1 min-w-0 rounded border border-solid border-[var(--grid-line)] px-2 py-1.5 text-sm fg-[var(--grid-ink)] bg-[var(--grid-panel-bright)] min-h-[2.25rem] flex items-center';
        pathDisplay.textContent = 'Select a vault or folder…';

        const browseBtn = document.createElement('button');
        browseBtn.type = 'button';
        browseBtn.className =
            'shrink-0 text-sm px-3 py-1.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer hover:bg-[var(--grid-line)]/25 disabled:opacity-50 disabled:cursor-not-allowed';
        browseBtn.textContent = 'Browse…';

        pathRow.append(pathDisplay, browseBtn);
        pathWrap.append(pathRow);

        const folderNameInput = document.createElement('input');
        folderNameInput.dataset.f = 'folder_name';
        folderNameInput.className = RESEARCH_INPUT_CLASS;
        folderNameInput.placeholder = 'Folder name (optional — defaults to watch label)';
        folderNameInput.value = watch ? String(watch.label ?? '') : '';

        const pathNote = document.createElement('p');
        pathNote.className = 'text-xs fg-[var(--grid-ink-muted)] m-0';
        pathNote.textContent = isEdit
            ? 'Research folder path (managed here — not deletable from Vault).'
            : 'Pick a vault or parent folder, then name the Research folder to create on save.';

        /** @type {ResearchVaultPathRow[]} */
        let vaultPathRows = [];
        /** @type {unknown[]} */
        let vaultTree = [];
        /** @type {ResearchVaultPathRow | null} */
        let selectedPathRow = null;

        /**
         * @param {ResearchVaultPathRow | null} row
         */
        function paintVaultPathSelection(row) {
            selectedPathRow = row;
            if (!row) {
                pathDisplay.textContent = 'Select a vault or folder…';
                vaultIdHidden.value = '';
                parentHidden.value = '';
                return;
            }
            pathDisplay.textContent = row.breadcrumb;
            pathDisplay.title = row.breadcrumb;
            vaultIdHidden.value = String(row.vault_id);
            parentHidden.value = row.kind === 'folder' ? String(row.id) : '';
        }

        void (async () => {
            try {
                const { tree } = await fetchResearchVaultTreeJson();
                vaultTree = tree;
                vaultPathRows = flattenVaultPathsForResearchPicker(tree);
                const initial = findVaultPathRowForWatch(vaultPathRows, watch);
                if (initial) paintVaultPathSelection(initial);
                else if (!isEdit && vaultPathRows.length === 0) {
                    pathDisplay.textContent = 'No vaults available for your account.';
                    browseBtn.disabled = true;
                }
            } catch (err) {
                console.warn('[research] vault tree load failed', err);
                pathDisplay.textContent = 'Could not load vault tree.';
                browseBtn.disabled = true;
            }
        })();

        browseBtn.addEventListener('click', () => {
            void (async () => {
                if (browseBtn.disabled || vaultTree.length === 0) return;
                const picked = await openResearchVaultPathPickerDialog(
                    DialogMod,
                    vaultTree,
                    selectedPathRow?.rowKey ?? null,
                );
                if (picked) paintVaultPathSelection(picked);
            })();
        });

        if (isEdit) {
            browseBtn.disabled = true;
            folderNameInput.readOnly = true;
            folderNameInput.classList.add('opacity-70');
        }

        labelInput.addEventListener('input', () => {
            if (!isEdit && !folderNameInput.dataset.userEdited) {
                folderNameInput.value = labelInput.value;
            }
        });
        folderNameInput.addEventListener('input', () => {
            folderNameInput.dataset.userEdited = '1';
        });

        const langWrap = document.createElement('div');
        langWrap.className = 'min-w-0 w-full';
        langWrap.dataset.oaaoResearchSummaryLang = '1';

        const langSel = document.createElement('select');
        langSel.dataset.f = 'summary_language';
        langSel.className = 'w-full min-w-0 font-inherit';
        for (const lang of RESEARCH_SUMMARY_LANGUAGES) {
            const opt = document.createElement('option');
            opt.value = lang.id;
            opt.textContent = lang.label;
            langSel.append(opt);
        }
        langSel.value = normalizeSummaryLanguage(watch?.summary_language);
        langWrap.append(langSel);

        const scheduleRow = document.createElement('div');
        scheduleRow.className = 'grid gap-2 sm:grid-cols-2';

        const intervalWrap = document.createElement('div');
        intervalWrap.className = 'min-w-0 w-full';
        intervalWrap.dataset.oaaoResearchInterval = '1';

        const intervalSel = document.createElement('select');
        intervalSel.dataset.f = 'interval_minutes';
        intervalSel.className = 'w-full min-w-0 font-inherit';
        for (const iv of RESEARCH_FETCH_INTERVALS) {
            const opt = document.createElement('option');
            opt.value = String(iv.minutes);
            opt.textContent = iv.label;
            intervalSel.append(opt);
        }
        const watchInterval = normalizeWatchIntervalMinutes(watch?.interval_minutes);
        intervalSel.value = String(watchInterval);
        intervalWrap.append(intervalSel);

        const startTimeWrap = document.createElement('div');
        startTimeWrap.className = 'min-w-0 w-full';
        startTimeWrap.dataset.oaaoResearchStartTime = '1';

        const startTimeInput = document.createElement('input');
        startTimeInput.type = 'text';
        startTimeInput.dataset.f = 'schedule_start_time';
        startTimeInput.className = RESEARCH_INPUT_CLASS;
        startTimeInput.value = normalizeResearchStartTime(watch?.schedule_start_time);
        startTimeInput.autocomplete = 'off';
        startTimeWrap.append(startTimeInput);

        scheduleRow.append(
            researchFormField('Auto fetch interval', intervalWrap),
            researchFormField('Start time', startTimeWrap),
        );

        const autoFetchLabel = document.createElement('label');
        autoFetchLabel.className = 'flex items-center gap-2 text-sm cursor-pointer';
        const autoFetchCb = document.createElement('input');
        autoFetchCb.type = 'checkbox';
        autoFetchCb.dataset.f = 'is_enabled';
        autoFetchCb.checked = watch ? Number(watch.is_enabled ?? 1) === 1 : true;
        autoFetchLabel.append(autoFetchCb, document.createTextNode('Enable auto fetch'));

        const scheduleNote = document.createElement('p');
        scheduleNote.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 leading-snug';
        scheduleNote.textContent =
            'Uses your browser timezone. Example: 09:00 + 1 day → daily at 9:00 AM; 10:00 + 4 hours → 10:00, 14:00, 18:00…';

        const watchCfg = decodeWatchConfig(watch);

        const fetchPolicyRow = document.createElement('div');
        fetchPolicyRow.className = 'grid gap-2 sm:grid-cols-2';

        const maxNewInput = document.createElement('input');
        maxNewInput.type = 'number';
        maxNewInput.min = '1';
        maxNewInput.max = '100';
        maxNewInput.dataset.f = 'max_new_per_run';
        maxNewInput.className = RESEARCH_INPUT_CLASS;
        maxNewInput.value = String(watchCfg.max_new_per_run ?? 20);

        const backfillDaysInput = document.createElement('input');
        backfillDaysInput.type = 'number';
        backfillDaysInput.min = '1';
        backfillDaysInput.max = '3650';
        backfillDaysInput.dataset.f = 'backfill_max_days';
        backfillDaysInput.className = RESEARCH_INPUT_CLASS;
        backfillDaysInput.value = String(watchCfg.backfill_max_days ?? 30);

        fetchPolicyRow.append(
            researchFormField('Max articles per run (queue)', maxNewInput),
            researchFormField('Backfill max days', backfillDaysInput),
        );

        const backfillLabel = document.createElement('label');
        backfillLabel.className = 'flex items-center gap-2 text-sm cursor-pointer';
        const backfillCb = document.createElement('input');
        backfillCb.type = 'checkbox';
        backfillCb.dataset.f = 'backfill_enabled';
        backfillCb.checked = Boolean(watchCfg.backfill_enabled);
        backfillLabel.append(
            backfillCb,
            document.createTextNode('Pagination backfill — crawl older index/list pages within max days'),
        );

        const fetchNote = document.createElement('p');
        fetchNote.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 leading-snug';
        fetchNote.textContent =
            'Incremental: index list hash + known URLs prevent duplicate archive. Static pages re-fetch when content hash changes. Each article fetch runs through a queue (one at a time).';

        const matchPromptInput = document.createElement('textarea');
        matchPromptInput.dataset.f = 'match_prompt';
        matchPromptInput.rows = 4;
        matchPromptInput.className = RESEARCH_TEXTAREA_CLASS;
        matchPromptInput.placeholder =
            'e.g. Papers about multimodal LLMs for medical imaging, published in 2024–2025';
        matchPromptInput.value = String(watchCfg.match_prompt ?? '');

        const matchMinConfInput = document.createElement('input');
        matchMinConfInput.type = 'number';
        matchMinConfInput.min = '0';
        matchMinConfInput.max = '100';
        matchMinConfInput.step = '5';
        matchMinConfInput.dataset.f = 'match_min_confidence';
        matchMinConfInput.className = RESEARCH_INPUT_CLASS;
        matchMinConfInput.value = String(
            Math.round(Number(watchCfg.match_min_confidence ?? 0.7) * 100),
        );

        const normalizedPreview = document.createElement('textarea');
        normalizedPreview.readOnly = true;
        normalizedPreview.rows = 3;
        normalizedPreview.className = RESEARCH_TEXTAREA_CLASS;
        normalizedPreview.placeholder = 'LLM-normalized criteria appear here after preview or first run';
        normalizedPreview.value = String(watchCfg.match_prompt_normalized ?? '');

        const matchPreviewBtn = document.createElement('button');
        matchPreviewBtn.type = 'button';
        matchPreviewBtn.className = 'oaao-btn oaao-btn-secondary text-sm w-fit';
        matchPreviewBtn.textContent = 'Preview normalized prompt';

        const notifyMatchLabel = document.createElement('label');
        notifyMatchLabel.className = 'flex items-center gap-2 text-sm cursor-pointer';
        const notifyMatchCb = document.createElement('input');
        notifyMatchCb.type = 'checkbox';
        notifyMatchCb.dataset.f = 'notify_in_app';
        const hasMatchPrompt = String(watchCfg.match_prompt ?? '').trim() !== '';
        notifyMatchCb.checked =
            watchCfg.notify_in_app !== undefined ? Boolean(watchCfg.notify_in_app) : hasMatchPrompt;
        notifyMatchLabel.append(
            notifyMatchCb,
            document.createTextNode('In-app notification when an article matches (confidence ≥ threshold)'),
        );

        const matchNote = document.createElement('p');
        matchNote.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 leading-snug';
        matchNote.textContent =
            'LLM normalizes your criteria once per run, then scores each new article. Matches at or above the confidence threshold trigger a notification.';

        matchPreviewBtn.addEventListener('click', async () => {
            const raw = matchPromptInput.value.trim();
            if (!raw) {
                errEl.textContent = 'Enter match criteria first.';
                errEl.classList.remove('hidden');
                return;
            }
            matchPreviewBtn.disabled = true;
            matchPreviewBtn.textContent = 'Normalizing…';
            try {
                const { res, data } = await fetchJson('match_prompt_preview', {
                    method: 'POST',
                    body: JSON.stringify({ match_prompt: raw }),
                });
                if (!res.ok || !data?.success) {
                    errEl.textContent = String(data?.message ?? 'Normalize failed');
                    errEl.classList.remove('hidden');
                    return;
                }
                normalizedPreview.value = String(data.normalized_prompt ?? '');
                errEl.classList.add('hidden');
            } catch (e) {
                errEl.textContent = String(e);
                errEl.classList.remove('hidden');
            } finally {
                matchPreviewBtn.disabled = false;
                matchPreviewBtn.textContent = 'Preview normalized prompt';
            }
        });

        const sourcesInput = document.createElement('textarea');
        sourcesInput.dataset.f = 'sources';
        sourcesInput.rows = 7;
        sourcesInput.className = RESEARCH_TEXTAREA_CLASS;
        sourcesInput.placeholder = isEdit
            ? 'One URL per line — index:…, static:…, or plain URL'
            : RESEARCH_SOURCES_PLACEHOLDER;
        sourcesInput.value = watchSourceLines(watch);

        const sourcesNote = document.createElement('p');
        sourcesNote.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 -mt-1 leading-snug';
        sourcesNote.textContent = isEdit
            ? 'Edit sources directly, or Analyze sources to re-detect page types.'
            : 'Add source URLs, then click Analyze sources to preview page types and links.';

        /** @type {Record<string, unknown> | null} */
        let discoverResult = null;
        let discoverConfirmed = isEdit;

        wrap.append(
            researchFormField('Label', labelInput),
            researchFormField('Path of Vault', pathWrap),
            pathNote,
            ...(isEdit ? [] : [researchFormField('Folder name', folderNameInput)]),
            vaultIdHidden,
            parentHidden,
            researchFormField('Sources', sourcesInput),
            sourcesNote,
            researchFormField('Summary language', langWrap),
            scheduleRow,
            autoFetchLabel,
            scheduleNote,
            fetchPolicyRow,
            backfillLabel,
            fetchNote,
            researchFormField('Match criteria (prompt)', matchPromptInput),
            researchFormField('Min confidence (%)', matchMinConfInput),
            matchPreviewBtn,
            researchFormField('Normalized prompt (read-only)', normalizedPreview),
            notifyMatchLabel,
            matchNote,
            errEl,
        );

        /** @type {Array<Record<string, unknown>>} */
        const buttons = [
            {
                text: 'Cancel',
                color: 'muted',
                action: async () => true,
            },
            {
                text: 'Analyze sources',
                color: 'primary',
                action: async () => {
                    errEl.classList.add('hidden');
                    if (!isEdit) {
                        discoverConfirmed = false;
                        discoverResult = null;
                    }
                    const lines = sourcesInput.value.split(/\n/);
                    /** @type {Array<{url: string, kind: string}>} */
                    const srcs = [];
                    for (const line of lines) {
                        const parsed = parseResearchSourceLine(line);
                        if (parsed) srcs.push({ url: parsed.url, kind: parsed.kind || 'auto' });
                    }
                    if (!srcs.length) {
                        errEl.textContent = 'Add at least one source URL.';
                        errEl.classList.remove('hidden');
                        return false;
                    }
                    const result = await openResearchSourceDiscoverDialog(DialogMod, srcs);
                    if (!result) return false;
                    discoverResult = result;
                    if (!isEdit) discoverConfirmed = true;
                    const normalized = discoverResultToSourceLines(result);
                    if (normalized) sourcesInput.value = normalized;
                    const previews = Array.isArray(result.previews) ? result.previews : [];
                    const okCount = previews.filter((p) => p && p.ok !== false).length;
                    sourcesNote.textContent = `Analysis complete — ${okCount}/${previews.length} source(s) ready. Save to apply changes.`;
                    sourcesNote.classList.add('fg-[var(--grid-ink)]');
                    return false;
                },
            },
        ];

        buttons.push({
            text: isEdit ? 'Save' : 'Confirm & create',
            color: 'accent',
            action: async () => {
                errEl.classList.add('hidden');
                if (!isEdit && (!vaultIdHidden.value || Number(vaultIdHidden.value) < 1)) {
                    errEl.textContent = 'Select a vault or folder path.';
                    errEl.classList.remove('hidden');
                    return false;
                }
                if (!isEdit && !discoverConfirmed) {
                    errEl.textContent = 'Analyze sources and review the preview first.';
                    errEl.classList.remove('hidden');
                    return false;
                }
                setMsg('Saving…');
                const payload = buildWatchPayload(wrap, watchId, discoverResult);
                const { res, data } = await fetchJson('watch_save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok || !data?.success) {
                    errEl.textContent = typeof data?.message === 'string' ? data.message : 'Save failed';
                    errEl.classList.remove('hidden');
                    setMsg('');
                    return false;
                }
                setMsg('Saved.');
                await loadWatches();
                return true;
            },
        });

        if (isEdit) {
            buttons.unshift({
                text: 'Delete watch',
                color: 'danger',
                action: async () => {
                    if (typeof DialogMod.confirm !== 'function') return false;
                    const ok = await DialogMod.confirm(
                        'Delete watch',
                        'Delete this watch and its Research vault folder?',
                    );
                    if (!ok) return false;
                    setMsg('Deleting…');
                    const { res, data } = await fetchJson('watch_delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ watch_id: watchId }),
                    });
                    if (!res.ok || !data?.success) {
                        errEl.textContent = typeof data?.message === 'string' ? data.message : 'Delete failed';
                        errEl.classList.remove('hidden');
                        setMsg('');
                        return false;
                    }
                    setMsg('Deleted.');
                    await loadWatches();
                    return true;
                },
            });
        }

        DialogMod.open({
            title: isEdit ? 'Edit watch' : 'New watch',
            content: wrap,
            size: 'lg',
            buttons,
            onOpen(ctrl) {
                void mountSummaryLanguageCombobox(langWrap, langSel);
                void mountIntervalCombobox(intervalWrap, intervalSel, watchInterval);
                void mountStartTimeDatePicker(startTimeWrap, startTimeInput);
                const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
                const host = ctrl?.body instanceof HTMLElement ? ctrl.body : wrap;
                if (JIT && typeof JIT.hydrate === 'function') JIT.hydrate(host);
            },
        });
    }

    async function runWatch(watchId, opts = {}) {
        const watch = watches.find((w) => Number(w.watch_id) === watchId) ?? { watch_id: watchId };
        const DialogMod = await loadDialogCtor();
        if (!DialogMod) {
            setMsg('Dialog unavailable.');
            return;
        }
        openResearchRunDialog(DialogMod, /** @type {Record<string, unknown>} */ (watch), {
            refetch: Boolean(opts.refetch),
            onDone: async ({ success, stats }) => {
                setMsg(formatResearchRunStatsBrief(stats, success));
                await loadWatches();
            },
        });
    }

    async function refetchWatch(watchId) {
        const watch = watches.find((w) => Number(w.watch_id) === watchId);
        const DialogMod = await loadDialogCtor();
        if (!DialogMod) {
            setMsg('Dialog unavailable.');
            return;
        }
        const label = String(watch?.label ?? 'Watch');
        const ok =
            typeof DialogMod.confirm === 'function'
                ? await DialogMod.confirm(
                      'Refetch all',
                      'Queue every stored article for background refetch (one at a time)?',
                  )
                : window.confirm('Queue all articles for background refetch?');
        if (!ok) return;
        await runWatch(watchId, { refetch: true });
    }

    async function purgeOrphansWatch(watchId) {
        const watch = watches.find((w) => Number(w.watch_id) === watchId);
        const DialogMod = await loadDialogCtor();
        if (!DialogMod) {
            setMsg('Dialog unavailable.');
            return;
        }

        const { res: scanRes, data: scanData } = await fetchJson('purge_orphans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ watch_id: watchId, dry_run: true }),
        });
        const found = Number(scanData?.orphans_found ?? 0);
        if (!scanRes.ok || !scanData?.success) {
            setMsg(typeof scanData?.message === 'string' ? scanData.message : 'Could not scan for orphan files');
            return;
        }
        if (found < 1) {
            setMsg('No unlinked files in this watch folder.');
            return;
        }

        const label = String(watch?.label ?? 'Watch');
        const ok =
            typeof DialogMod.confirm === 'function'
                ? await DialogMod.confirm(
                      'Clean orphan files',
                      `Remove ${found} unlinked file(s) from "${label}"? These are leftover copies not linked to any article (e.g. after refetch).`,
                  )
                : window.confirm(`Remove ${found} unlinked file(s) from this watch folder?`);
        if (!ok) return;

        const { res, data } = await fetchJson('purge_orphans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ watch_id: watchId }),
        });
        if (res.ok && data?.success) {
            const removed = Number(data?.purge?.documents_removed ?? found);
            setMsg(
                typeof data.message === 'string' && data.message
                    ? data.message
                    : `Removed ${removed} orphan file(s). Refresh Vault to update the list.`,
            );
        } else {
            setMsg(typeof data?.message === 'string' ? data.message : 'Could not remove orphan files');
        }
    }

    function researchWatchHasPendingQueue(w) {
        const qs = decodeResearchQueueStatus(w);
        const fetchPending = Number(qs?.pending ?? 0);
        const refetchPending = Number(qs?.refetch_pending ?? 0);
        return fetchPending > 0 || refetchPending > 0;
    }

    function updateResearchQueueStatusCard(watchId, queueStatus) {
        const host = listEl.querySelector(`[data-oaao-research-queue="${watchId}"]`);
        if (!(host instanceof HTMLElement)) return;
        const watch = watches.find((w) => Number(w.watch_id) === watchId);
        if (!watch) return;
        watch.queue_status = queueStatus;
        const expanded = host.dataset.oaaoResearchQueueOpen === '1';
        host.replaceWith(buildResearchQueueStatusSection(watch, { expanded }));
    }

    async function refreshPendingQueueStatuses() {
        if (generation !== mountGeneration) return;
        const pendingWatches = watches.filter(researchWatchHasPendingQueue);
        if (!pendingWatches.length) {
            stopResearchQueuePoll();
            return;
        }
        for (const w of pendingWatches) {
            const wid = Number(w.watch_id ?? 0);
            if (wid < 1) continue;
            try {
                const { res, data } = await fetchJson(
                    `fetch_queue_status?watch_id=${wid}`,
                    signal ? { signal } : {},
                );
                if (generation !== mountGeneration) return;
                if (!res.ok || !data?.success || !data.status) continue;
                updateResearchQueueStatusCard(wid, data.status);
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') return;
            }
        }
    }

    function startResearchQueuePollIfNeeded() {
        if (!watches.some(researchWatchHasPendingQueue)) {
            stopResearchQueuePoll();
            return;
        }
        if (researchQueuePollTimer) return;
        researchQueuePollTimer = setInterval(() => {
            void refreshPendingQueueStatuses();
        }, 4000);
    }

    function renderList() {
        listEl.innerHTML = '';
        if (!watches.length) {
            listEl.innerHTML = '<p class="text-sm fg-[var(--grid-ink-muted)] m-0">No watches yet.</p>';
            return;
        }
        for (const w of watches) {
            const card = document.createElement('div');
            card.className = 'border border-solid border-[var(--grid-line)] rounded-lg p-3 grid gap-2 bg-[var(--grid-panel-bright)]';
            const srcCount = Array.isArray(w.sources) ? w.sources.length : 0;
            card.innerHTML = `
<div class="flex flex-wrap items-center justify-between gap-2">
<strong class="text-sm">${String(w.label ?? 'Watch')}</strong>
<div class="flex gap-2">
<button type="button" data-act="edit" class="text-xs px-2 py-1 rounded border border-solid border-[var(--grid-line)] cursor-pointer">Edit</button>
<button type="button" data-act="run" class="text-xs px-2 py-1 rounded bg-[var(--grid-ink)] fg-[var(--grid-paper)] border-none cursor-pointer">Run now</button>
<button type="button" data-act="refetch" class="text-xs px-2 py-1 rounded border border-solid border-[var(--grid-line)] cursor-pointer">Refetch all</button>
<button type="button" data-act="purge-orphans" class="text-xs px-2 py-1 rounded border border-solid border-[var(--grid-line)] cursor-pointer">Clean orphans</button>
</div></div>
<p class="text-xs fg-[var(--grid-ink-muted)] m-0">Vault ${String(w.vault_id ?? '—')} · folder ${String(w.container_id ?? '—')} · ${srcCount} source(s)</p>
<p class="text-xs fg-[var(--grid-ink-muted)] m-0">${formatResearchScheduleLine(w)}</p>
<p class="text-xs fg-[var(--grid-ink-muted)] m-0">${formatResearchFetchPolicyLine(decodeWatchConfig(w))}</p>`;
            card.append(buildResearchLastRunRow(w));
            card.append(buildResearchQueueStatusSection(w));
            card.querySelector('[data-act="edit"]')?.addEventListener('click', () => void openWatchDialog(w));
            card.querySelector('[data-act="run"]')?.addEventListener('click', () => void runWatch(Number(w.watch_id)));
            card.querySelector('[data-act="refetch"]')?.addEventListener('click', () => void refetchWatch(Number(w.watch_id)));
            card.querySelector('[data-act="purge-orphans"]')?.addEventListener('click', () => void purgeOrphansWatch(Number(w.watch_id)));
            listEl.appendChild(card);
        }
    }

    async function loadWatches() {
        if (generation !== mountGeneration) return;
        let res;
        let data;
        try {
            ({ res, data } = await fetchJson('watch_list', signal ? { signal } : {}));
        } catch (err) {
            if (generation !== mountGeneration) return;
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setMsg('Could not load watches.');
            return;
        }
        if (generation !== mountGeneration) return;
        if (!res.ok || !data?.success) {
            const hint =
                typeof data?.message === 'string' && data.message
                    ? data.message
                    : !data && !res.ok
                      ? `Could not load watches (HTTP ${res.status}).`
                      : 'Could not load watches.';
            setMsg(hint);
            return;
        }
        watches = Array.isArray(data.watches) ? data.watches : [];
        renderList();
        startResearchQueuePollIfNeeded();
        if (watches.length) setMsg('');
    }

    newBtn?.addEventListener('click', () => void openWatchDialog(null), signal ? { signal } : undefined);
    await loadWatches();
}
/**
 * Workspace shell entry — must match {@code workspace.js} dynamic panel loader.
 * @param {HTMLElement} mount
 */
export async function mountShellPanel(mount) {
    teardownShellPanel();
    mountGeneration += 1;
    const generation = mountGeneration;
    mountAbort = new AbortController();
    await mountResearchPanel(mount, { generation, signal: mountAbort.signal });
}

/** @param {Record<string, unknown>} [_opts] */
export function teardownShellPanel(_opts = {}) {
    mountGeneration += 1;
    stopResearchQueuePoll();
    researchQueueMonitorExpanded.clear();
    mountAbort?.abort();
    mountAbort = null;
}
/** Legacy alias */
export async function mount(host) {
    await mountResearchPanel(host);
}

export function teardown() {}
