/**
 * Admin Settings → ASR-Live preferences ({@code oaao_purpose.meta_json} for {@code asr.live}).
 * Routing (FunASR Nano base URL, model) lives on Purpose allocation + Endpoints — not here.
 */

import { oaaoT } from '../oaao-i18n.js';

/** @param {unknown} v */
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @param {unknown} raw */
function decodeMeta(raw) {
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

/**
 * Live ASR block for Settings → ASR (second section below batch pipeline).
 *
 * @param {(s: string) => string} esc
 * @param {string} [routingNoteHtml] escaped routing note paragraph
 */
export function asrLiveSettingsSectionHtml(esc, routingNoteHtml = '') {
    const note = routingNoteHtml
        ? `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${routingNoteHtml}</p>`
        : '';
    return `
<section id="oaao-asr-live-settings-section" class="grid gap-md min-w-0 max-w-xl pt-lg mt-lg border-t border-solid border-[var(--grid-line)]">
  <h3 class="text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] m-0">${esc(oaaoT('settings.asr_live.section_title'))}</h3>
  ${note}
  ${asrLiveSettingsFormHtml(esc)}
</section>`;
}

/**
 * @param {(s: string) => string} esc
 */
export function asrLiveSettingsFormHtml(esc) {
    return `
<form id="oaao-asr-live-settings-form" class="grid gap-md min-w-0 max-w-xl">
  <p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${esc(oaaoT('settings.asr_live.intro'))}</p>
  <label class="grid gap-1 text-sm">
    <span class="fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.asr_live.preferred_language'))}</span>
    <input type="text" name="asr_live_language" class="rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-2 py-1.5 text-sm" placeholder="中文" autocomplete="off" />
    <span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.asr_live.preferred_language_hint'))}</span>
  </label>
  <label class="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
    <input type="checkbox" name="asr_live_itn" class="m-0 accent-[var(--grid-ink)]" checked />
    <span>${esc(oaaoT('settings.asr_live.itn'))}</span>
  </label>
  <div class="flex flex-wrap gap-2 pt-1">
    <button type="submit" class="text-sm px-4 py-2 rounded bg-[var(--grid-ink)] fg-[var(--grid-paper)] border-none cursor-pointer">${esc(oaaoT('settings.asr_live.save'))}</button>
  </div>
  <p id="oaao-asr-live-settings-msg" class="text-xs fg-[var(--grid-ink-muted)] m-0 min-h-[1rem]"></p>
</form>`;
}

/** @param {HTMLFormElement} form @param {unknown} metaJson */
export function fillAsrLiveSettingsForm(form, metaJson) {
    const meta = decodeMeta(metaJson);
    const langEl = form.elements.namedItem('asr_live_language');
    if (langEl instanceof HTMLInputElement) {
        langEl.value = String(meta.language ?? meta.preferred_language ?? 'yue');
    }
    const itnEl = form.elements.namedItem('asr_live_itn');
    if (itnEl instanceof HTMLInputElement) {
        itnEl.checked = meta.itn !== false && meta.enable_itn !== false;
    }
}

/** @param {HTMLFormElement} form @param {Record<string, unknown>} [existingMeta] */
export function readAsrLiveSettingsMetaObject(form, existingMeta = {}) {
    const langEl = form.elements.namedItem('asr_live_language');
    const lang = langEl instanceof HTMLInputElement ? langEl.value.trim() : '';
    const itnEl = form.elements.namedItem('asr_live_itn');
    /** @type {Record<string, unknown>} */
    const out = { ...existingMeta };
    out.provider = 'funasr_nano';
    out.mode = 'streaming';
    out.input_fallback = true;
    if (lang) {
        out.language = lang;
        out.preferred_language = lang;
    }
    out.itn = itnEl instanceof HTMLInputElement ? itnEl.checked : true;
    delete out.funasr_base_url;
    delete out.funasr_live_base_url;
    return out;
}

/** @param {HTMLFormElement} form @param {Record<string, unknown>} [existingMeta] */
export function readAsrLiveSettingsMetaJson(form, existingMeta = {}) {
    return JSON.stringify(readAsrLiveSettingsMetaObject(form, existingMeta));
}

/** @param {HTMLFormElement} _form */
export function wireAsrLiveSettingsForm(_form) {
    /* no-op — endpoint smoke test lives under Endpoints / Purpose allocation */
}

export { escapeHtml, decodeMeta };
