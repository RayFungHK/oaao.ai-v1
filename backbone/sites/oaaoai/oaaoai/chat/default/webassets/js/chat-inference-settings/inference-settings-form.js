/**
 * Settings → Chat inference defaults ({@code chat.*} {@code meta_json.inference_params}).
 */

/** @type {ReadonlyArray<{ key: string, label: string, badge: string, min: number, max: number, step: number, integer?: boolean }>} */
export const INFERENCE_PARAM_FIELDS = [
    { key: 'temperature', label: 'Temperature', badge: 'temp', min: 0, max: 2, step: 0.05 },
    { key: 'top_p', label: 'Top P', badge: 'top_p', min: 0, max: 1, step: 0.01 },
    { key: 'top_k', label: 'Top K', badge: 'top_k', min: 1, max: 200, step: 1, integer: true },
    { key: 'presence_penalty', label: 'Presence', badge: 'presence', min: -2, max: 2, step: 0.05 },
    { key: 'frequency_penalty', label: 'Frequency', badge: 'frequency', min: -2, max: 2, step: 0.05 },
    { key: 'max_tokens', label: 'Max tokens', badge: 'max_tokens', min: 256, max: 8192, step: 64, integer: true },
];

/** @param {unknown} metaJson */
function decodeMetaRoot(metaJson) {
    if (typeof metaJson === 'string' && metaJson.trim()) {
        try {
            const dec = JSON.parse(metaJson.trim());
            return dec && typeof dec === 'object' ? /** @type {Record<string, unknown>} */ (dec) : {};
        } catch {
            return {};
        }
    }
    if (metaJson && typeof metaJson === 'object') {
        return /** @type {Record<string, unknown>} */ (metaJson);
    }
    return {};
}

/** @param {unknown} metaJson @returns {Record<string, number|null>} */
export function readInferenceParamsFromMeta(metaJson) {
    const root = decodeMetaRoot(metaJson);
    const block =
        root.inference_params && typeof root.inference_params === 'object'
            ? /** @type {Record<string, unknown>} */ (root.inference_params)
            : {};
    /** @type {Record<string, number|null>} */
    const out = {};
    for (const f of INFERENCE_PARAM_FIELDS) {
        const v = block[f.key];
        out[f.key] = v === null || v === undefined || v === '' ? null : Number(v);
    }
    return out;
}

/**
 * @param {(s: string) => string} esc
 * @param {(key: string, vars?: Record<string, string|number>) => string} t
 */
export function inferenceSettingsFormHtml(esc, t) {
    const rows = INFERENCE_PARAM_FIELDS.map((f) => {
        return `<div class="grid grid-cols-[auto_1fr_auto_minmax(5rem,6rem)] gap-x-3 gap-y-1 items-center py-2 border-b border-solid border-[var(--grid-line)]/60" data-inference-row="${esc(f.key)}">
<label class="inline-flex items-center gap-2 min-w-0"><input type="checkbox" data-inference-enabled="${esc(f.key)}" class="shrink-0 m-0 cursor-pointer"/>
<span class="text-[0.8125rem] fg-[var(--grid-ink)] truncate">${esc(f.label)}</span>
<span class="text-[0.625rem] font-mono px-1 rounded bg-[color-mix(in_srgb,var(--grid-accent)_12%,transparent)] fg-[var(--grid-accent)]">${esc(f.badge)}</span></label>
<input type="range" data-inference-range="${esc(f.key)}" min="${f.min}" max="${f.max}" step="${f.step}" class="w-full min-w-0 cursor-pointer"/>
<input type="number" data-inference-num="${esc(f.key)}" min="${f.min}" max="${f.max}" step="${f.step}" placeholder="—" class="rounded-[6px] border border-solid border-[var(--grid-line)] px-1.5 py-1 text-[0.75rem] font-mono w-full bg-[var(--grid-paper)]"/>
</div>`;
    }).join('');

    return `<form id="oaao-chat-inference-settings-form" class="flex flex-col gap-3 min-w-0 max-w-xl">
<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${esc(t('settings.inference.hint', 'Defaults for chat runs (purpose chat.*). Users and per-thread overrides can still apply on top.'))}</p>
<div class="rounded-[10px] border border-solid border-[var(--grid-line)] px-3 py-1 bg-[var(--grid-paper)]">${rows}</div>
<p id="oaao-chat-inference-settings-msg" class="text-[0.75rem] fg-[var(--grid-caption)] min-h-[1rem] m-0"></p>
<button type="submit" class="self-start rounded-[8px] h-9 px-4 text-[0.8125rem] fw-medium border-none bg-[var(--grid-accent)] fg-white cursor-pointer font-inherit">${esc(t('settings.inference.save', 'Save defaults'))}</button>
</form>`;
}

/**
 * @param {HTMLFormElement} form
 * @param {unknown} metaJson
 */
export function fillInferenceSettingsForm(form, metaJson) {
    const params = readInferenceParamsFromMeta(metaJson);
    for (const f of INFERENCE_PARAM_FIELDS) {
        const enabled = form.querySelector(`[data-inference-enabled="${f.key}"]`);
        const range = form.querySelector(`[data-inference-range="${f.key}"]`);
        const num = form.querySelector(`[data-inference-num="${f.key}"]`);
        const row = form.querySelector(`[data-inference-row="${f.key}"]`);
        const v = params[f.key];
        const on = v !== null && Number.isFinite(v);
        if (enabled instanceof HTMLInputElement) enabled.checked = on;
        if (row instanceof HTMLElement) row.classList.toggle('opacity-45', !on);
        if (range instanceof HTMLInputElement) {
            range.disabled = !on;
            if (on) range.value = String(v);
        }
        if (num instanceof HTMLInputElement) {
            num.disabled = !on;
            num.value = on ? (f.integer ? String(Math.round(Number(v))) : String(v)) : '';
        }
    }
    wireInferenceFormSync(form);
}

/** @param {HTMLFormElement} form */
function wireInferenceFormSync(form) {
    if (form.dataset.oaaoInferenceWired === '1') return;
    form.dataset.oaaoInferenceWired = '1';
    for (const f of INFERENCE_PARAM_FIELDS) {
        const enabled = form.querySelector(`[data-inference-enabled="${f.key}"]`);
        const range = form.querySelector(`[data-inference-range="${f.key}"]`);
        const num = form.querySelector(`[data-inference-num="${f.key}"]`);
        const row = form.querySelector(`[data-inference-row="${f.key}"]`);
        const syncDisabled = () => {
            const on = enabled instanceof HTMLInputElement && enabled.checked;
            if (row instanceof HTMLElement) row.classList.toggle('opacity-45', !on);
            if (range instanceof HTMLInputElement) range.disabled = !on;
            if (num instanceof HTMLInputElement) num.disabled = !on;
        };
        enabled?.addEventListener('change', syncDisabled);
        range?.addEventListener('input', () => {
            if (num instanceof HTMLInputElement && range instanceof HTMLInputElement) {
                num.value = f.integer ? String(Math.round(Number(range.value))) : String(range.value);
            }
        });
        num?.addEventListener('input', () => {
            if (range instanceof HTMLInputElement && num instanceof HTMLInputElement && num.value !== '') {
                const n = Number(num.value);
                if (Number.isFinite(n)) range.value = String(Math.max(f.min, Math.min(f.max, n)));
            }
        });
    }
}

/** @param {HTMLFormElement} form */
export function readInferenceSettingsMetaJson(form) {
    /** @type {Record<string, number|null>} */
    const inference_params = {};
    for (const f of INFERENCE_PARAM_FIELDS) {
        const enabled = form.querySelector(`[data-inference-enabled="${f.key}"]`);
        const num = form.querySelector(`[data-inference-num="${f.key}"]`);
        if (!(enabled instanceof HTMLInputElement) || !enabled.checked) {
            inference_params[f.key] = null;
            continue;
        }
        const raw = num instanceof HTMLInputElement ? num.value.trim() : '';
        inference_params[f.key] = raw === '' ? null : Number(raw);
    }
    return JSON.stringify({ inference_params });
}
