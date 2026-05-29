/**
 * UX-1-S2 — Composer Advanced inference parameters (LM Studio–style, portaled panel).
 *
 * @module composer-model-params
 */

/** @typedef {{ key: string, label: string, badge: string, min: number, max: number, step: number, integer?: boolean }} ParamDef */

/** @type {ParamDef[]} */
export const INFERENCE_PARAM_DEFS = [
    { key: 'temperature', label: 'Temperature', badge: 'temp', min: 0, max: 2, step: 0.05 },
    { key: 'top_p', label: 'Top P Sampling', badge: 'top_p', min: 0, max: 1, step: 0.01 },
    { key: 'top_k', label: 'Top K Sampling', badge: 'top_k', min: 1, max: 200, step: 1, integer: true },
    { key: 'presence_penalty', label: 'Presence Penalty', badge: 'presence', min: -2, max: 2, step: 0.05 },
    { key: 'frequency_penalty', label: 'Frequency Penalty', badge: 'frequency', min: -2, max: 2, step: 0.05 },
    { key: 'max_tokens', label: 'Tokens to generate', badge: 'max_tokens', min: 256, max: 8192, step: 64, integer: true },
];

const PANEL_STYLE_ID = 'oaao-inference-panel-styles';
const PANEL_STYLE_REV = '20260529-inference-v11';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @typedef {'off' | 'manual' | 'auto_tune'} InferenceMode */

/** Lucide inner markup — sync SVG, no Icons.js import. */
const INFERENCE_MODE_SVG_INNER = {
    off:
        '<circle cx="12" cy="12" r="4"/><path d="M12 3v1"/><path d="M12 20v1"/><path d="M3 12h1"/><path d="M21 12h1"/><path d="m18.364 5.636-.707-.707"/><path d="m5.343 18.364-.707.707"/><path d="m19.071 19.071-.707-.707"/><path d="m5.636 5.636-.707.707"/>',
    auto_tune:
        '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    manual:
        '<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
};

/** Default for index / next chat before the user picks a mode. */
const DEFAULT_INFERENCE_MODE = 'auto_tune';

const OAAO_INFERENCE_PENDING_KEY = 'oaao_inference_pending';

/**
 * @param {unknown} m
 * @returns {InferenceMode}
 */
export function normalizeInferenceMode(m) {
    const s = String(m || '').toLowerCase();
    if (s === 'manual' || s === 'auto_tune') return s;
    return 'off';
}

/**
 * @returns {{ mode: InferenceMode, model_params: Record<string, number|null> }}
 */
export function readPendingInference() {
    try {
        const raw = sessionStorage.getItem(OAAO_INFERENCE_PENDING_KEY);
        if (!raw) {
            return { mode: DEFAULT_INFERENCE_MODE, model_params: {} };
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return { mode: DEFAULT_INFERENCE_MODE, model_params: {} };
        }
        return {
            mode: normalizeInferenceMode(parsed.inference_mode),
            model_params: normalizePatch(
                /** @type {Record<string, unknown>} */ (parsed.model_params ?? {}),
            ),
        };
    } catch {
        return { mode: DEFAULT_INFERENCE_MODE, model_params: {} };
    }
}

/**
 * @param {InferenceMode} mode
 * @param {Record<string, number|null>} modelParams
 */
function writePendingInference(mode, modelParams) {
    try {
        sessionStorage.setItem(
            OAAO_INFERENCE_PENDING_KEY,
            JSON.stringify({
                inference_mode: mode,
                model_params: modelParams,
            }),
        );
    } catch {
        /* ignore */
    }
}

/**
 * @param {number | null | undefined} conversationId
 * @returns {{ mode: InferenceMode, model_params: Record<string, number|null> }}
 */
export function readComposerInferenceForSend(conversationId) {
    const cid = Math.floor(Number(conversationId ?? 0));
    if (cid > 0) {
        const rows = globalThis.__oaaoCachedConversations;
        if (Array.isArray(rows)) {
            const row = rows.find((r) => Number(r?.id) === cid);
            if (row) {
                const rawMode = row.inference_mode;
                const mode =
                    rawMode === null || rawMode === undefined || String(rawMode).trim() === ''
                        ? DEFAULT_INFERENCE_MODE
                        : normalizeInferenceMode(rawMode);
                return {
                    mode,
                    model_params: normalizePatch(
                        /** @type {Record<string, unknown>} */ (row.model_params ?? {}),
                    ),
                };
            }
        }
        return { mode: DEFAULT_INFERENCE_MODE, model_params: {} };
    }
    return readPendingInference();
}

/**
 * @param {number} conversationId
 * @param {{ mode?: InferenceMode, model_params?: Record<string, number|null> }} block
 */
export function rememberInferenceLocal(conversationId, block) {
    const cid = Math.floor(Number(conversationId) || 0);
    if (cid < 1) return;
    const mode = normalizeInferenceMode(block.mode ?? 'off');
    const modelParams = normalizePatch(block.model_params ?? {});
    const rows = globalThis.__oaaoCachedConversations;
    if (Array.isArray(rows)) {
        for (const row of rows) {
            if (Number(row?.id) === cid) {
                row.inference_mode = mode;
                if (Object.keys(modelParams).length > 0) {
                    row.model_params = modelParams;
                } else {
                    delete row.model_params;
                }
                break;
            }
        }
    }
}

/** @type {Record<string, number|null>} */
let cachedPurposeParams = {};

/** @type {Record<string, number|null>} */
let cachedThreadParams = {};

/** @type {InferenceMode} */
let cachedInferenceMode = 'off';

/** @type {number} */
let panelZ = 9100;

function chatApiUrl(path) {
    const prefix = (document.body?.dataset?.oaaoMountPrefix || '').trim();
    const base = prefix ? `${prefix}/chat/api` : '/chat/api';
    return `${base}/${String(path).replace(/^\//, '')}`;
}

/** @type {Promise<(msg: string, kind?: string) => void> | null} */
let oaaoToastFirePromise = null;

/**
 * @param {string} message
 * @param {'success' | 'error' | 'info' | 'warning'} [kind]
 */
function fireOaaoToast(message, kind = 'success') {
    const prefix = (document.body?.dataset?.oaaoMountPrefix || '').trim();
    const path = '/webassets/core/default/js/oaao-razy-toast.js'.replace(/\/{2,}/g, '/');
    const url = prefix ? `${prefix.replace(/\/+$/, '')}${path}` : path;
    if (!oaaoToastFirePromise) {
        oaaoToastFirePromise = import(/* webpackIgnore: true */ url).then(
            (m) => /** @type {(msg: string, kind?: string) => void} */ (m.oaaoRazyToastFire),
        );
    }
    void oaaoToastFirePromise.then((fn) => fn(message, kind)).catch(() => {});
}

/**
 * @param {boolean} nextChat
 */
function inferenceSavedToastMessage(nextChat) {
    const key = nextChat ? 'chat.inference.saved_next_chat' : 'chat.inference.saved';
    const fallback = nextChat ? 'Saved for your next chat' : 'Inference settings saved';
    const i18n = globalThis.oaaoI18n;
    if (i18n && typeof i18n.t === 'function') {
        const v = i18n.t(key);
        if (typeof v === 'string' && v.trim() !== '' && v !== key) return v;
    }
    return fallback;
}

function selectedChatEndpointId() {
    const tr = document.getElementById('workspace-purpose-selector-trigger');
    const raw = tr?.dataset?.routingChatEndpointId ?? '0';
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function activeConversationId() {
    const n = Math.floor(Number(globalThis.__oaaoActiveConversationId ?? 0));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * POST scope for inference — thread workspace wins over shell (personal threads omit workspace_id).
 *
 * @param {number} conversationId
 */
function conversationScopeBodyFields(conversationId) {
    const cid = Math.floor(Number(conversationId));
    if (cid > 0) {
        const rows = globalThis.__oaaoCachedConversations;
        if (Array.isArray(rows)) {
            const row = rows.find((r) => Number(r?.id) === cid);
            const wid = row?.workspace_id;
            if (wid != null && Number(wid) > 0) {
                return { workspace_id: Math.floor(Number(wid)) };
            }
        }
        return {};
    }
    const root = document.getElementById('workspace-view');
    const ds =
        typeof root?.dataset?.oaaoActiveWorkspaceId === 'string' ? root.dataset.oaaoActiveWorkspaceId.trim() : '';
    const n = Number(ds);
    return Number.isFinite(n) && n > 0 ? { workspace_id: Math.floor(n) } : {};
}

/**
 * @param {InferenceMode} mode
 * @param {boolean} [compact] composer trigger (18px) vs segment (12px)
 * @returns {SVGSVGElement}
 */
function buildInferenceModeIcon(mode, compact = false) {
    const size = compact ? 18 : 12;
    const px = compact ? 'w-[18px] h-[18px]' : 'w-3 h-3';
    const inner = INFERENCE_MODE_SVG_INNER[mode] ?? INFERENCE_MODE_SVG_INNER.off;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `rz-icon oaao-inference-mode-glyph block shrink-0 pointer-events-none ${px}`.trim());
    svg.innerHTML = inner;
    return svg;
}

/** @param {InferenceMode} mode */
function inferenceModeIconColor(mode) {
    if (mode === 'auto_tune') return 'var(--grid-accent,#2563eb)';
    if (mode === 'manual') return '#d97706';
    return 'var(--grid-ink-muted,#6b7280)';
}

/**
 * @param {HTMLButtonElement} triggerBtn
 * @param {InferenceMode} mode
 */
function syncInferenceComposerTriggerIcon(triggerBtn, mode) {
    triggerBtn.replaceChildren(buildInferenceModeIcon(mode, true));
    triggerBtn.style.color = inferenceModeIconColor(mode);
}

function ensurePanelStyles() {
    if (typeof document === 'undefined') return;
    const prev = document.getElementById(PANEL_STYLE_ID);
    if (prev?.dataset.oaaoRev === PANEL_STYLE_REV) return;
    prev?.remove();
    const style = document.createElement('style');
    style.id = PANEL_STYLE_ID;
    style.dataset.oaaoRev = PANEL_STYLE_REV;
    style.textContent = `
.oaao-inference-panel-anchor{position:fixed;margin:0;padding:0;box-sizing:border-box;pointer-events:auto;z-index:9200}
.oaao-inference-panel-anchor.hidden{display:none!important}
.oaao-inference-panel{border-radius:10px;border:1px solid color-mix(in srgb,var(--grid-line) 65%,transparent);background:var(--grid-panel-bright,#fff);box-shadow:0 6px 18px rgba(0,0,0,.1);color:var(--grid-ink,#111);display:flex;flex-direction:column;overflow:hidden}
.oaao-inference-panel--manual{max-height:min(52vh,20rem)}
.oaao-inference-panel-head{padding:.5rem .625rem .5rem;flex-shrink:0}
.oaao-inference-panel-head-row{margin:0 0 .375rem}
.oaao-inference-panel-hint{margin:.125rem 0 0}
.oaao-inference-panel-body{padding:.25rem .625rem .375rem;overflow-y:auto;overscroll-contain;flex:0 0 auto;min-height:0;border-top:1px solid color-mix(in srgb,var(--grid-line) 45%,transparent)}
.oaao-inference-row{display:grid;grid-template-columns:1rem 3.5rem minmax(0,1fr) 3.25rem;gap:0 .35rem;align-items:center;padding:.2rem 0}
.oaao-inference-row.is-disabled{opacity:.5}
.oaao-inference-badge{font-size:.625rem;line-height:1.2;font-family:ui-monospace,monospace;color:var(--grid-ink-muted,#666);white-space:nowrap}
.oaao-inference-range-wrap{min-width:0;display:flex;align-items:center}
.oaao-inference-panel input[type=range].oaao-inference-range{width:100%;height:1.125rem;margin:0;padding:0;accent-color:var(--grid-accent,#2563eb);cursor:pointer}
.oaao-inference-num{box-sizing:border-box;min-width:3.25rem;width:100%;text-align:right;font-size:.6875rem;line-height:1.25;padding:.125rem .25rem;border:1px solid color-mix(in srgb,var(--grid-line) 55%,transparent);border-radius:4px;font-family:ui-monospace,monospace;background:var(--grid-paper,#fff);-moz-appearance:textfield}
.oaao-inference-num::-webkit-outer-spin-button,.oaao-inference-num::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.oaao-inference-row.is-disabled .oaao-inference-num{color:var(--grid-caption,#888);background:color-mix(in srgb,var(--grid-line) 20%,transparent)}
.oaao-inference-panel-foot{padding:.375rem .625rem;border-top:1px solid color-mix(in srgb,var(--grid-line) 45%,transparent);flex-shrink:0;display:flex;align-items:center;gap:.35rem}
.oaao-inference-mode-wrap{display:inline-flex;overflow:hidden;border-radius:6px;border:1px solid color-mix(in srgb,var(--grid-line) 70%,transparent)}
.oaao-inference-mode-btn{display:inline-flex;align-items:center;gap:.2rem;padding:.125rem .375rem;font-size:.625rem;line-height:1.25;font-family:inherit;font-weight:500;border:none;border-right:1px solid color-mix(in srgb,var(--grid-line) 65%,transparent);cursor:pointer;background:transparent;color:var(--grid-ink,#111)}
.oaao-inference-mode-btn:last-child{border-right:none}
.oaao-inference-mode-btn.is-selected{background:var(--grid-accent,#2563eb);color:#fff}
.oaao-inference-mode-btn.is-selected[data-inference-mode="manual"]{background:#d97706;color:#fff}
.oaao-inference-mode-btn.is-selected .oaao-inference-mode-glyph{color:currentColor!important}
.oaao-inference-panel input[type=checkbox]{width:.8125rem;height:.8125rem;margin:0}
.oaao-inference-panel--compact{max-height:none}
`;
    document.head.append(style);
}

/**
 * @param {HTMLElement} trigger
 * @param {HTMLElement} anchor
 */
function positionInferencePanel(trigger, anchor) {
    const rect = trigger.getBoundingClientRect();
    const pr = anchor.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    let top = rect.top - pr.height - gap;
    let left = rect.right - pr.width;
    if (top < margin) {
        top = rect.bottom + gap;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - pr.width - margin));
    anchor.style.top = `${Math.round(top)}px`;
    anchor.style.left = `${Math.round(left)}px`;
}

/**
 * @param {Record<string, number|null|undefined>} src
 * @returns {Record<string, number|null>}
 */
function normalizePatch(src) {
    /** @type {Record<string, number|null>} */
    const out = {};
    for (const def of INFERENCE_PARAM_DEFS) {
        if (!Object.prototype.hasOwnProperty.call(src, def.key)) continue;
        const v = src[def.key];
        out[def.key] = v === null || v === undefined || v === '' ? null : Number(v);
    }
    return out;
}

/**
 * @param {HTMLElement} host
 * @param {AbortSignal} signal
 */
export function mountComposerModelParams(host, signal) {
    if (!(host instanceof HTMLElement)) return;
    ensurePanelStyles();

    const btnClass =
        'oaao-composer-toggle oaao-chat-composer-toggle inline-flex items-center justify-center w-8 h-8 p-0 [border:1px_solid_var(--grid-line)] rounded-full bg-transparent fg-[var(--grid-ink-muted)] hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink)] cursor-pointer font-inherit shrink-0 transition-colors';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.oaaoComposerToggle = 'model_params';
    btn.className = btnClass;
    btn.title = 'Inference parameters';
    btn.setAttribute('aria-label', 'Inference parameters');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'dialog');
    syncInferenceComposerTriggerIcon(btn, DEFAULT_INFERENCE_MODE);

    const anchor = document.createElement('div');
    anchor.className = 'oaao-inference-panel-anchor hidden';
    anchor.setAttribute('role', 'dialog');
    anchor.setAttribute('aria-label', 'Inference parameters');

    const panel = document.createElement('div');
    panel.className = 'oaao-inference-panel w-[min(18.5rem,calc(100vw-1rem))]';

    const head = document.createElement('div');
    head.className = 'oaao-inference-panel-head flex flex-col';

    const headRow = document.createElement('div');
    headRow.className = 'oaao-inference-panel-head-row flex items-center justify-between gap-2 min-w-0';

    const title = document.createElement('span');
    title.className = 'text-[0.75rem] fw-semibold fg-[var(--grid-ink)] shrink-0';
    title.textContent = 'Inference';

    const modeWrap = document.createElement('div');
    modeWrap.className = 'oaao-inference-mode-wrap shrink-0';
    modeWrap.setAttribute('role', 'group');
    modeWrap.setAttribute('aria-label', 'Inference control');

    /** @type {InferenceMode} */
    let panelInferenceMode = DEFAULT_INFERENCE_MODE;

    /** @type {Record<InferenceMode, HTMLButtonElement>} */
    const modeBtns = {};
    for (const [mode, label] of /** @type {const} */ ([
        ['off', 'Off'],
        ['auto_tune', 'Auto'],
        ['manual', 'Manual'],
    ])) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.inferenceMode = mode;
        b.className = 'oaao-inference-mode-btn text-[0.625rem] leading-snug';
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        b.append(buildInferenceModeIcon(mode, false), labelSpan);
        b.style.color = inferenceModeIconColor(mode);
        modeBtns[mode] = b;
        if (mode === 'auto_tune') {
            b.title = 'Auto tune (planner delta + baseline)';
        } else if (mode === 'manual') {
            b.title = 'Manual parameter overrides';
        } else {
            b.title = 'Endpoint defaults only';
        }
        b.addEventListener(
            'click',
            () => {
                panelInferenceMode = mode;
                if (activeConversationId() < 1) {
                    const patch = mode === 'manual' ? readPatchFromRows() : {};
                    writePendingInference(mode, patch);
                    cachedInferenceMode = mode;
                    cachedThreadParams = patch;
                } else {
                    void persistInferenceModeToThread();
                }
                syncModeUi();
            },
            { signal },
        );
        modeWrap.append(b);
    }

    const hint = document.createElement('p');
    hint.className = 'oaao-inference-panel-hint m-0 text-[0.625rem] leading-snug fg-[var(--grid-caption)]';
    hint.textContent = 'Endpoint defaults';

    /**
     * @param {string} [statusHint]
     */
    async function persistInferenceModeToThread(statusHint) {
        const cid = activeConversationId();
        if (cid < 1) return;
        const patch = panelInferenceMode === 'manual' ? readPatchFromRows() : {};
        if (statusHint) status.textContent = statusHint;
        try {
            const res = await fetch(chatApiUrl('conversation_mode'), {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation_id: cid,
                    inference_mode: panelInferenceMode,
                    model_params: panelInferenceMode === 'manual' ? patch : null,
                    chat_endpoint_id: selectedChatEndpointId(),
                    ...conversationScopeBodyFields(cid),
                }),
            });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                status.textContent = data?.message || 'Could not update conversation mode';
                return;
            }
            cachedInferenceMode = normalizeInferenceMode(data?.inference_mode ?? panelInferenceMode);
            cachedThreadParams =
                panelInferenceMode === 'manual'
                    ? normalizePatch(data?.model_params ?? patch ?? {})
                    : {};
            rememberInferenceLocal(cid, {
                mode: cachedInferenceMode,
                model_params: cachedThreadParams,
            });
            if (statusHint) status.textContent = '';
        } catch {
            status.textContent = 'Could not update conversation mode';
        }
    }

    function syncModeUi() {
        for (const [mode, b] of Object.entries(modeBtns)) {
            const sel = panelInferenceMode === mode;
            b.classList.toggle('is-selected', sel);
            b.style.color = sel ? '' : inferenceModeIconColor(mode);
        }
        syncInferenceComposerTriggerIcon(btn, panelInferenceMode);
        const manual = panelInferenceMode === 'manual';
        panel.classList.toggle('oaao-inference-panel--compact', !manual);
        panel.classList.toggle('oaao-inference-panel--manual', manual);
        if (manual) {
            if (!body.isConnected) {
                panel.insertBefore(body, foot);
            }
        } else if (body.isConnected) {
            body.remove();
        }
        const cid = activeConversationId();
        if (cid < 1) {
            hint.textContent =
                panelInferenceMode === 'off'
                    ? 'Next chat: endpoint presets only'
                    : panelInferenceMode === 'auto_tune'
                      ? 'Next chat: auto-tune (ACCS) from first message'
                      : 'Next chat: manual overrides';
        } else if (panelInferenceMode === 'off') {
            hint.textContent = 'Endpoint presets only';
        } else if (panelInferenceMode === 'auto_tune') {
            hint.textContent = 'Auto-tune from ACCS over this thread';
        } else {
            hint.textContent = 'Manual overrides for this thread';
        }
        if (!anchor.classList.contains('hidden')) {
            positionInferencePanel(btn, anchor);
        }
    }

    headRow.append(title, modeWrap);
    head.append(headRow, hint);

    const body = document.createElement('div');
    body.className = 'oaao-inference-panel-body';

    /** @type {Record<string, { row: HTMLElement, enabled: HTMLInputElement, range: HTMLInputElement, num: HTMLInputElement }>} */
    const rowControls = {};

    for (const def of INFERENCE_PARAM_DEFS) {
        const row = document.createElement('div');
        row.className = 'oaao-inference-row';
        row.dataset.paramKey = def.key;

        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.className = 'oaao-inference-cb shrink-0 m-0 cursor-pointer';
        enabled.setAttribute('aria-label', `Enable ${def.label}`);

        const badge = document.createElement('span');
        badge.className = 'oaao-inference-badge';
        badge.textContent = def.badge;
        badge.title = def.label;

        const rangeWrap = document.createElement('div');
        rangeWrap.className = 'oaao-inference-range-wrap min-w-0';

        const range = document.createElement('input');
        range.type = 'range';
        range.min = String(def.min);
        range.max = String(def.max);
        range.step = String(def.step);
        range.className = 'oaao-inference-range w-full min-w-0 cursor-pointer block';

        const num = document.createElement('input');
        num.type = 'number';
        num.min = String(def.min);
        num.max = String(def.max);
        num.step = String(def.step);
        num.className = 'oaao-inference-num';

        const formatRangeVal = () =>
            def.integer ? String(Math.round(Number(range.value))) : String(Number(range.value));

        const syncFromNum = () => {
            const v = num.value.trim();
            if (v === '') {
                range.value = String(def.min);
                return;
            }
            const n = Number(v);
            if (Number.isFinite(n)) {
                range.value = String(Math.max(def.min, Math.min(def.max, n)));
            }
        };
        const syncFromRange = () => {
            num.value = formatRangeVal();
        };

        range.value = String(def.min);
        num.value = formatRangeVal();

        range.addEventListener('input', syncFromRange, { signal });
        num.addEventListener('input', syncFromNum, { signal });
        enabled.addEventListener('change', () => {
            row.classList.toggle('is-disabled', !enabled.checked);
            range.disabled = !enabled.checked;
            num.disabled = !enabled.checked;
            if (enabled.checked) {
                syncFromRange();
            } else {
                num.value = formatRangeVal();
            }
        }, { signal });

        rangeWrap.append(range);
        row.append(enabled, badge, rangeWrap, num);
        body.append(row);
        rowControls[def.key] = { row, enabled, range, num };
    }

    const foot = document.createElement('div');
    foot.className = 'oaao-inference-panel-foot';
    const status = document.createElement('span');
    status.className = 'flex-1 min-w-0 text-[0.625rem] fg-[var(--grid-caption)] truncate empty:hidden';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className =
        'text-[0.625rem] px-1.5 py-0.5 rounded border border-solid border-[var(--grid-line)] bg-transparent cursor-pointer font-inherit shrink-0';
    resetBtn.textContent = 'Reset';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className =
        'text-[0.625rem] px-1.5 py-0.5 rounded border-none bg-[var(--grid-accent)] fg-white cursor-pointer font-inherit shrink-0';
    saveBtn.textContent = 'Save';
    foot.append(status, resetBtn, saveBtn);

    panel.append(head, foot);
    anchor.append(panel);

    const slot = document.createElement('span');
    slot.className = 'oaao-chat-composer-dropup-icon-slot inline-flex flex-col items-center shrink-0';
    slot.append(btn);
    const root = document.createElement('div');
    root.className = 'oaao-chat-composer-dropup-root inline-flex shrink-0';
    root.append(slot);
    host.append(root);

    /** @param {Record<string, number|null|undefined>} params */
    function applyParamsToRows(params) {
        for (const def of INFERENCE_PARAM_DEFS) {
            const ctl = rowControls[def.key];
            if (!ctl) continue;
            const v = params[def.key];
            const on = v !== null && v !== undefined && v !== '';
            ctl.enabled.checked = on;
            ctl.row.classList.toggle('is-disabled', !on);
            ctl.range.disabled = !on;
            ctl.num.disabled = !on;
            if (on) {
                const n = Number(v);
                ctl.range.value = String(n);
            } else {
                ctl.range.value = String(def.min);
            }
            ctl.num.value = def.integer
                ? String(Math.round(Number(ctl.range.value)))
                : String(Number(ctl.range.value));
        }
    }

    /** @returns {Record<string, number|null>} */
    function readPatchFromRows() {
        /** @type {Record<string, number|null>} */
        const patch = {};
        for (const def of INFERENCE_PARAM_DEFS) {
            const ctl = rowControls[def.key];
            if (!ctl) continue;
            if (!ctl.enabled.checked) {
                patch[def.key] = null;
                continue;
            }
            const raw = ctl.num.value.trim();
            patch[def.key] = raw === '' ? null : Number(raw);
        }
        return patch;
    }

    function applyInferenceStateToUi() {
        panelInferenceMode = normalizeInferenceMode(cachedInferenceMode);
        syncModeUi();
        if (panelInferenceMode === 'manual') {
            applyParamsToRows(cachedThreadParams);
        }
    }

    function fillRowsForMode() {
        applyInferenceStateToUi();
    }

    async function loadPurposeDefaults() {
        const eid = selectedChatEndpointId();
        const q = eid > 0 ? `?chat_endpoint_id=${encodeURIComponent(String(eid))}` : '';
        try {
            const res = await fetch(`${chatApiUrl('inference_defaults')}${q}`, { credentials: 'include' });
            const data = await res.json();
            if (res.ok && data?.success) {
                cachedPurposeParams = normalizePatch(data?.data?.inference_params ?? {});
            }
        } catch {
            cachedPurposeParams = {};
        }
    }

    function loadInferenceState() {
        const cid = activeConversationId();
        if (cid < 1) {
            const pending = readPendingInference();
            cachedInferenceMode = pending.mode;
            cachedThreadParams = pending.model_params;
            return;
        }
        const block = readComposerInferenceForSend(cid);
        cachedInferenceMode = block.mode;
        cachedThreadParams = block.model_params;
    }

    const closePanel = () => {
        anchor.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        if (anchor.parentElement === document.body) {
            document.body.removeChild(anchor);
        }
    };

    const openPanel = async () => {
        loadInferenceState();
        await loadPurposeDefaults();
        fillRowsForMode();
        if (!anchor.isConnected) {
            document.body.append(anchor);
        }
        anchor.classList.remove('hidden');
        panelZ += 1;
        anchor.style.zIndex = String(panelZ);
        syncModeUi();
        positionInferencePanel(btn, anchor);
        btn.setAttribute('aria-expanded', 'true');
    };

    btn.addEventListener(
        'click',
        (ev) => {
            ev.stopPropagation();
            if (anchor.classList.contains('hidden')) {
                void openPanel();
            } else {
                closePanel();
            }
        },
        { signal },
    );

    document.addEventListener(
        'click',
        (ev) => {
            if (!(ev.target instanceof Node)) return;
            if (anchor.classList.contains('hidden')) return;
            if (anchor.contains(ev.target) || btn.contains(ev.target)) return;
            closePanel();
        },
        { signal, capture: true },
    );

    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') closePanel();
    }, { signal });

    window.addEventListener(
        'resize',
        () => {
            if (!anchor.classList.contains('hidden')) positionInferencePanel(btn, anchor);
        },
        { signal },
    );

    document.addEventListener(
        'oaao-chat-endpoint-changed',
        () => {
            if (!anchor.classList.contains('hidden')) void loadPurposeDefaults().then(fillRowsForMode);
        },
        { signal },
    );

    resetBtn.addEventListener(
        'click',
        () => {
            for (const def of INFERENCE_PARAM_DEFS) {
                const ctl = rowControls[def.key];
                if (!ctl) continue;
                ctl.enabled.checked = false;
                ctl.row.classList.add('is-disabled');
                ctl.range.disabled = true;
                ctl.num.disabled = true;
                ctl.range.value = String(def.min);
                ctl.num.value = def.integer
                    ? String(Math.round(Number(ctl.range.value)))
                    : String(Number(ctl.range.value));
            }
            status.textContent = 'Cleared (save to apply)';
        },
        { signal },
    );

    saveBtn.addEventListener(
        'click',
        async () => {
            const cid = activeConversationId();
            const patch = panelInferenceMode === 'manual' ? readPatchFromRows() : {};
            status.textContent = 'Saving…';
            if (cid < 1) {
                writePendingInference(panelInferenceMode, patch);
                cachedInferenceMode = panelInferenceMode;
                cachedThreadParams = patch;
                status.textContent = '';
                fireOaaoToast(inferenceSavedToastMessage(true), 'success');
                closePanel();
                return;
            }
            try {
                const res = await fetch(chatApiUrl('conversation_mode'), {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        conversation_id: cid,
                        inference_mode: panelInferenceMode,
                        model_params: panelInferenceMode === 'manual' ? patch : null,
                        chat_endpoint_id: selectedChatEndpointId(),
                        ...conversationScopeBodyFields(cid),
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data?.success) {
                    status.textContent = data?.message || 'Save failed';
                    fireOaaoToast(data?.message || 'Save failed', 'error');
                    return;
                }
                cachedInferenceMode = normalizeInferenceMode(data?.inference_mode ?? panelInferenceMode);
                cachedThreadParams =
                    panelInferenceMode === 'manual'
                        ? normalizePatch(data?.model_params ?? patch ?? {})
                        : {};
                rememberInferenceLocal(cid, {
                    mode: cachedInferenceMode,
                    model_params: cachedThreadParams,
                });
                status.textContent = '';
                fireOaaoToast(inferenceSavedToastMessage(false), 'success');
                closePanel();
            } catch {
                status.textContent = 'Save failed';
                fireOaaoToast('Save failed', 'error');
            }
        },
        { signal },
    );

    document.addEventListener(
        'oaao-conversation-opened',
        () => {
            loadInferenceState();
            applyInferenceStateToUi();
        },
        { signal },
    );

    loadInferenceState();
    applyInferenceStateToUi();
    globalThis.JIT?.hydrate?.(panel);
}
