/**
 * Admin Settings → ASR pipeline (mode, chunk buffer, Speaker / FunASR, language hints).
 * Persisted on {@code oaao_purpose.meta_json} for {@code purpose_key=asr} — not in Purpose routing dialog.
 */

import { oaaoT } from '../oaao-i18n.js';
import { endpointsApiUrl, endpointsFetchJson } from '../endpoints-settings/api.js';

/** @param {HTMLFormElement} form */
export function isSpeakerMode(form) {
    const modeEl = form.elements.namedItem('asr_mode');
    return modeEl instanceof HTMLSelectElement && modeEl.value === 'speaker';
}

/** @param {HTMLFormElement} form */
export function isFunasrReady(form) {
    if (!isSpeakerMode(form)) return true;
    return form.dataset.oaaoFunasrReady === '1';
}

/** @param {HTMLFormElement} form @param {boolean} ready */
function setFunasrReady(form, ready) {
    form.dataset.oaaoFunasrReady = ready ? '1' : '0';
}

/** @param {HTMLFormElement} form @param {string} text @param {'idle'|'busy'|'ok'|'err'} tone */
function setProvisionStatus(form, text, tone = 'idle') {
    const el = form.querySelector('[data-oaao-funasr-provision-status]');
    if (!(el instanceof HTMLElement)) return;
    el.textContent = text;
    el.dataset.state = tone;
    el.classList.toggle('fg-[var(--grid-caution,#b45309)]', tone === 'busy' || tone === 'err');
    el.classList.toggle('fg-[var(--grid-ink-muted)]', tone === 'idle');
    el.classList.toggle('fg-[var(--grid-accent)]', tone === 'ok');
}

/** Build docker env overrides sent to funasr_ensure from form meta. */
function funasrEnvFromMeta(meta) {
    /** @type {Record<string, string>} */
    const out = {
        FUNASR_ADAPTER_MODE: String(meta.funasr_adapter_mode ?? 'stub').trim().toLowerCase() === 'pipeline' ? 'pipeline' : 'stub',
    };
    const spk = String(meta.funasr_spk_model ?? '').trim();
    if (spk) out.FUNASR_SPK_MODEL = spk;
    return out;
}

/** @param {HTMLFormElement} form @param {{ pull?: boolean, recreate?: boolean }} [opts] */
export async function runFunasrProvision(form, opts = {}) {
    if (!isSpeakerMode(form)) {
        setFunasrReady(form, true);
        return true;
    }
    const pull = opts.pull !== false;
    const recreate = opts.recreate === true;
    setFunasrReady(form, false);
    setProvisionStatus(form, oaaoT(pull ? 'settings.asr.funasr_provisioning' : 'settings.asr.funasr_checking'), 'busy');
    const retryBtn = form.querySelector('[data-oaao-funasr-retry]');
    if (retryBtn instanceof HTMLButtonElement) retryBtn.disabled = true;
    try {
        const meta = readAsrSettingsMetaObject(form);
        const { res, data } = await endpointsFetchJson(endpointsApiUrl('funasr_ensure'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pull, recreate, funasr_env: funasrEnvFromMeta(meta) }),
        });
        const ready = Boolean(data?.ready);
        const runtimeMode =
            typeof data?.data?.smoke?.adapter_mode === 'string'
                ? data.data.smoke.adapter_mode
                : typeof data?.data?.smoke?.health?.body?.mode === 'string'
                  ? data.data.smoke.health.body.mode
                  : '';
        const runtimeSpk =
            typeof data?.data?.smoke?.health?.body?.spk_model === 'string' ? data.data.smoke.health.body.spk_model : '';
        let msg =
            typeof data?.message === 'string' && data.message.trim()
                ? data.message.trim()
                : ready
                  ? oaaoT('settings.asr.funasr_ready')
                  : oaaoT('settings.asr.funasr_failed');
        if (ready && runtimeMode) {
            msg += runtimeSpk
                ? ` (${runtimeMode}, SPK: ${runtimeSpk.split('/').pop()})`
                : ` (${runtimeMode}${runtimeMode === 'pipeline' ? ', no SPK' : ''})`;
        }
        setProvisionStatus(form, msg, ready ? 'ok' : 'err');
        setFunasrReady(form, ready);
        if (!res.ok && !ready) {
            setProvisionStatus(
                form,
                typeof data?.message === 'string' ? data.message : oaaoT('settings.asr.funasr_failed'),
                'err',
            );
        }
        return ready;
    } catch (e) {
        setProvisionStatus(form, e instanceof Error ? e.message : oaaoT('settings.asr.funasr_failed'), 'err');
        setFunasrReady(form, false);
        return false;
    } finally {
        if (retryBtn instanceof HTMLButtonElement) retryBtn.disabled = false;
    }
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

/** @param {Record<string, unknown>} meta @returns {'normal'|'speaker'} */
function inferMode(meta) {
    const provider = String(meta.provider ?? 'openai_compat').trim().toLowerCase();
    if (provider === 'funasr' && meta.diarization_enabled) return 'speaker';
    return 'normal';
}

/** @param {unknown} raw @returns {string} */
function languageHintsToInput(raw) {
    if (!Array.isArray(raw)) return '';
    return raw
        .map((h) => String(h ?? '').trim())
        .filter(Boolean)
        .join(', ');
}

/** @param {string} raw @returns {string[]} */
function parseLanguageHintsInput(raw) {
    return String(raw ?? '')
        .split(/[,;\s]+/)
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean);
}

/** @param {HTMLFormElement} form @returns {Record<string, unknown>} */
export function readAsrSettingsMetaObject(form) {
    const modeEl = form.elements.namedItem('asr_mode');
    const mode = modeEl instanceof HTMLSelectElement ? modeEl.value : 'normal';
    /** @type {Record<string, unknown>} */
    const out = {};
    const lh = form.elements.namedItem('asr_language_hints');
    const hints = parseLanguageHintsInput(lh instanceof HTMLInputElement ? lh.value : '');
    if (hints.length) out.language_hints = hints;

    if (mode === 'speaker') {
        out.provider = 'funasr';
        out.diarization_enabled = true;
        out.funasr_managed = true;
        const sc = form.elements.namedItem('asr_speaker_count');
        if (sc instanceof HTMLInputElement && sc.value.trim() !== '') {
            const n = parseInt(sc.value, 10);
            if (Number.isFinite(n) && n >= 2 && n <= 100) out.speaker_count = n;
        }
        const itn = form.elements.namedItem('asr_enable_itn');
        out.enable_itn = !(itn instanceof HTMLInputElement) || itn.checked;
        const adapterEl = form.elements.namedItem('asr_funasr_adapter_mode');
        const adapter =
            adapterEl instanceof HTMLSelectElement ? adapterEl.value.trim().toLowerCase() : 'stub';
        out.funasr_adapter_mode = adapter === 'pipeline' ? 'pipeline' : 'stub';
        const spkEl = form.elements.namedItem('asr_funasr_spk_model');
        if (spkEl instanceof HTMLSelectElement) {
            let spk = spkEl.value.trim();
            if (spk === 'custom') {
                const custom = form.elements.namedItem('asr_funasr_spk_model_custom');
                spk = custom instanceof HTMLInputElement ? custom.value.trim() : '';
            }
            if (spk && spk !== 'custom') out.funasr_spk_model = spk;
        }
        return out;
    }

    out.provider = 'openai_compat';
    const buf = form.elements.namedItem('asr_chunk_buffer_sec');
    if (buf instanceof HTMLInputElement && buf.value.trim() !== '') {
        const v = parseFloat(buf.value);
        if (Number.isFinite(v) && v >= 0 && v <= 120) out.chunk_buffer_sec = Math.round(v * 1000) / 1000;
    }
    return out;
}

/** @param {HTMLFormElement} form */
export function readAsrSettingsMetaJson(form) {
    return JSON.stringify(readAsrSettingsMetaObject(form));
}

/** @param {HTMLFormElement} form */
function updateActiveGuide(form) {
    const el = form.querySelector('[data-oaao-asr-active-guide]');
    if (!(el instanceof HTMLElement)) return;

    let key = 'settings.asr.guide_active_normal';
    if (isSpeakerMode(form)) {
        const adapterEl = form.elements.namedItem('asr_funasr_adapter_mode');
        const adapter =
            adapterEl instanceof HTMLSelectElement ? adapterEl.value.trim().toLowerCase() : 'stub';
        if (adapter === 'pipeline') {
            const spkEl = form.elements.namedItem('asr_funasr_spk_model');
            let spk = spkEl instanceof HTMLSelectElement ? spkEl.value.trim() : '';
            if (spk === 'custom') {
                const custom = form.elements.namedItem('asr_funasr_spk_model_custom');
                spk = custom instanceof HTMLInputElement ? custom.value.trim() : '';
            }
            key =
                spk && spk !== 'custom'
                    ? 'settings.asr.guide_active_speaker_pipeline'
                    : 'settings.asr.guide_active_speaker_pipeline_no_spk';
        } else {
            key = 'settings.asr.guide_active_speaker_stub';
        }
    }
    el.textContent = oaaoT(key);
}

/** @param {HTMLFormElement} form */
function syncModeUi(form) {
    const modeEl = form.elements.namedItem('asr_mode');
    const mode = modeEl instanceof HTMLSelectElement ? modeEl.value : 'normal';
    const normal = form.querySelector('[data-oaao-asr-normal-fields]');
    const speaker = form.querySelector('[data-oaao-asr-speaker-fields]');
    const provision = form.querySelector('[data-oaao-asr-funasr-provision]');
    const normalHint = form.querySelector('[data-oaao-asr-normal-when]');
    const speakerHint = form.querySelector('[data-oaao-asr-speaker-when]');
    if (normal instanceof HTMLElement) normal.classList.toggle('hidden', mode !== 'normal');
    if (speaker instanceof HTMLElement) speaker.classList.toggle('hidden', mode !== 'speaker');
    if (provision instanceof HTMLElement) provision.classList.toggle('hidden', mode !== 'speaker');
    if (normalHint instanceof HTMLElement) normalHint.classList.toggle('hidden', mode !== 'normal');
    if (speakerHint instanceof HTMLElement) speakerHint.classList.toggle('hidden', mode !== 'speaker');
    if (mode !== 'speaker') {
        setFunasrReady(form, true);
        setProvisionStatus(form, '', 'idle');
    }
    updateActiveGuide(form);
}

/** @param {HTMLFormElement} form @param {unknown} metaJsonRaw */
export function fillAsrSettingsForm(form, metaJsonRaw) {
    const meta = decodeMeta(metaJsonRaw);
    const modeEl = form.elements.namedItem('asr_mode');
    if (modeEl instanceof HTMLSelectElement) modeEl.value = inferMode(meta);
    const buf = form.elements.namedItem('asr_chunk_buffer_sec');
    if (buf instanceof HTMLInputElement) {
        const sym = meta.chunk_buffer_sec ?? meta.asr_chunk_buffer_sec ?? meta.chunk_pad_sec;
        buf.value = sym != null && sym !== '' ? String(sym) : '';
    }
    const sc = form.elements.namedItem('asr_speaker_count');
    if (sc instanceof HTMLInputElement) sc.value = meta.speaker_count != null ? String(meta.speaker_count) : '';
    const lh = form.elements.namedItem('asr_language_hints');
    if (lh instanceof HTMLInputElement) lh.value = languageHintsToInput(meta.language_hints);
    const itn = form.elements.namedItem('asr_enable_itn');
    if (itn instanceof HTMLInputElement) itn.checked = meta.enable_itn == null ? true : Boolean(meta.enable_itn);
    const adapterEl = form.elements.namedItem('asr_funasr_adapter_mode');
    if (adapterEl instanceof HTMLSelectElement) {
        adapterEl.value = String(meta.funasr_adapter_mode ?? 'stub').trim().toLowerCase() === 'pipeline' ? 'pipeline' : 'stub';
    }
    const spkEl = form.elements.namedItem('asr_funasr_spk_model');
    if (spkEl instanceof HTMLSelectElement) {
        const spk = String(meta.funasr_spk_model ?? '').trim();
        const known = new Set(['', 'iic/speech_campplus_sv_zh-cn_16k-common']);
        if (known.has(spk)) {
            spkEl.value = spk;
        } else if (spk) {
            spkEl.value = 'custom';
        }
        const custom = form.elements.namedItem('asr_funasr_spk_model_custom');
        if (custom instanceof HTMLInputElement) {
            custom.value = spkEl.value === 'custom' ? spk : '';
            custom.classList.toggle('hidden', spkEl.value !== 'custom');
        }
    }
    syncModeUi(form);
}

/** @param {HTMLFormElement} form */
export function wireAsrSettingsForm(form) {
    const modeEl = form.elements.namedItem('asr_mode');
    const onModeChange = () => {
        syncModeUi(form);
        if (isSpeakerMode(form)) void runFunasrProvision(form, { pull: true, recreate: false });
    };
    if (modeEl instanceof HTMLSelectElement) modeEl.addEventListener('change', onModeChange);
    const retryBtn = form.querySelector('[data-oaao-funasr-retry]');
    if (retryBtn instanceof HTMLButtonElement) {
        retryBtn.addEventListener('click', () => void runFunasrProvision(form, { pull: true, recreate: false }));
    }
    const spkEl = form.elements.namedItem('asr_funasr_spk_model');
    const spkCustom = form.elements.namedItem('asr_funasr_spk_model_custom');
    const onSpkChange = () => {
        if (spkCustom instanceof HTMLInputElement && spkEl instanceof HTMLSelectElement) {
            spkCustom.classList.toggle('hidden', spkEl.value !== 'custom');
        }
    };
    if (spkEl instanceof HTMLSelectElement) spkEl.addEventListener('change', () => {
        onSpkChange();
        updateActiveGuide(form);
        if (isSpeakerMode(form)) void runFunasrProvision(form, { pull: true, recreate: true });
    });
    const adapterEl = form.elements.namedItem('asr_funasr_adapter_mode');
    if (adapterEl instanceof HTMLSelectElement) {
        adapterEl.addEventListener('change', () => {
            updateActiveGuide(form);
            if (isSpeakerMode(form)) void runFunasrProvision(form, { pull: true, recreate: true });
        });
    }
    syncModeUi(form);
    if (isSpeakerMode(form)) void runFunasrProvision(form, { pull: false });
}

/** @param {(s: string) => string} esc */
export function asrSettingsFormHtml(esc) {
    return `<form id="oaao-asr-settings-form" class="grid gap-md max-w-[36rem]" data-oaao-funasr-ready="1">
  <p class="text-[0.8125rem] m-0 fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.asr.intro'))}</p>
  <fieldset class="grid gap-sm border border-solid border-[var(--grid-line)] rounded-[10px] p-3 m-0 min-w-0 bg-[var(--grid-panel)]">
    <legend class="text-[0.875rem] fw-semibold px-1">${esc(oaaoT('settings.asr.choose_guide_legend'))}</legend>
    <ul class="list-none m-0 p-0 grid gap-3 text-[0.8125rem] leading-snug">
      <li class="grid gap-0.5">
        <span class="fw-semibold fg-[var(--grid-ink)]">${esc(oaaoT('settings.asr.choose_normal_title'))}</span>
        <span class="fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.asr.choose_normal_body'))}</span>
      </li>
      <li class="grid gap-0.5">
        <span class="fw-semibold fg-[var(--grid-ink)]">${esc(oaaoT('settings.asr.choose_speaker_stub_title'))}</span>
        <span class="fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.asr.choose_speaker_stub_body'))}</span>
      </li>
      <li class="grid gap-0.5">
        <span class="fw-semibold fg-[var(--grid-ink)]">${esc(oaaoT('settings.asr.choose_speaker_pipeline_title'))}</span>
        <span class="fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.asr.choose_speaker_pipeline_body'))}</span>
      </li>
    </ul>
    <div class="mt-2 pt-2 border-t border-solid border-[var(--grid-line)] grid gap-1">
      <span class="text-[0.72rem] uppercase tracking-wide fw-semibold fg-[var(--grid-caption)]">${esc(oaaoT('settings.asr.guide_active_label'))}</span>
      <p data-oaao-asr-active-guide class="text-[0.8125rem] m-0 fg-[var(--grid-accent)] leading-snug"></p>
    </div>
  </fieldset>
  <fieldset class="grid gap-sm border-0 p-0 m-0 min-w-0">
    <legend class="text-[0.875rem] fw-semibold mb-1">${esc(oaaoT('settings.asr.pipeline_legend'))}</legend>
    <label class="flex flex-col gap-0.5 text-[0.8125rem]">
      <span class="fw-medium">${esc(oaaoT('settings.asr.mode'))}</span>
      <span class="text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.asr.mode_hint'))}</span>
      <select name="asr_mode" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-full">
        <option value="normal">${esc(oaaoT('settings.asr.mode_normal'))}</option>
        <option value="speaker">${esc(oaaoT('settings.asr.mode_speaker'))}</option>
      </select>
    </label>
  </fieldset>
  <fieldset data-oaao-asr-normal-fields class="grid gap-sm border-0 p-0 m-0 min-w-0">
    <legend class="text-[0.875rem] fw-semibold mb-1">${esc(oaaoT('settings.asr.normal_legend'))}</legend>
    <p data-oaao-asr-normal-when class="text-[0.75rem] m-0 fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.asr.normal_when_hint'))}</p>
    <label class="flex flex-col gap-0.5 text-[0.8125rem]">
      <span class="fw-medium">${esc(oaaoT('settings.asr.chunk_buffer_sec'))}</span>
      <span class="text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.asr.chunk_buffer_hint'))}</span>
      <input name="asr_chunk_buffer_sec" type="number" min="0" max="120" step="0.5" placeholder="3" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-[8rem]" />
    </label>
  </fieldset>
  <fieldset data-oaao-asr-speaker-fields class="hidden grid gap-sm border-0 p-0 m-0 min-w-0">
    <legend class="text-[0.875rem] fw-semibold mb-1">${esc(oaaoT('settings.asr.speaker_legend'))}</legend>
    <p data-oaao-asr-speaker-when class="text-[0.75rem] m-0 fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.asr.speaker_when_hint'))}</p>
    <p class="text-[0.8125rem] m-0 fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.asr.funasr_builtin'))}</p>
    <div data-oaao-asr-funasr-provision class="hidden rounded border border-[var(--grid-line)] px-3 py-2 grid gap-2 bg-[var(--grid-panel-bright)]">
      <p data-oaao-funasr-provision-status class="text-[0.8125rem] m-0 min-h-[1.25rem]" role="status"></p>
      <button type="button" data-oaao-funasr-retry class="justify-self-start text-[0.8125rem] px-2 py-1 rounded border border-[var(--grid-line)] bg-transparent cursor-pointer font-inherit fg-[var(--grid-accent)]">${esc(oaaoT('settings.asr.funasr_retry'))}</button>
    </div>
    <label class="flex flex-col gap-0.5 text-[0.8125rem]">
      <span class="fw-medium">${esc(oaaoT('settings.asr.funasr_adapter_mode'))}</span>
      <span class="text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.asr.funasr_adapter_mode_hint'))}</span>
      <select name="asr_funasr_adapter_mode" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-full">
        <option value="stub">${esc(oaaoT('settings.asr.funasr_adapter_stub'))}</option>
        <option value="pipeline">${esc(oaaoT('settings.asr.funasr_adapter_pipeline'))}</option>
      </select>
    </label>
    <label class="flex flex-col gap-0.5 text-[0.8125rem]">
      <span class="fw-medium">${esc(oaaoT('settings.asr.funasr_spk_model'))}</span>
      <span class="text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.asr.funasr_spk_model_hint'))}</span>
      <select name="asr_funasr_spk_model" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-full">
        <option value="">${esc(oaaoT('settings.asr.funasr_spk_none'))}</option>
        <option value="iic/speech_campplus_sv_zh-cn_16k-common">${esc(oaaoT('settings.asr.funasr_spk_campp_zh'))}</option>
        <option value="custom">${esc(oaaoT('settings.asr.funasr_spk_custom'))}</option>
      </select>
      <input name="asr_funasr_spk_model_custom" type="text" placeholder="iic/speech_campplus_sv_zh-cn_16k-common" class="hidden rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-full" />
    </label>
    <label class="flex flex-col gap-0.5 text-[0.8125rem]">
      <span class="fw-medium">${esc(oaaoT('settings.asr.speaker_count'))}</span>
      <input name="asr_speaker_count" type="number" min="2" max="100" step="1" placeholder="6" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-[8rem]" />
    </label>
    <label class="flex items-center gap-2 text-[0.8125rem] cursor-pointer">
      <input type="checkbox" name="asr_enable_itn" checked class="rounded border-[var(--grid-line)]" />
      <span>${esc(oaaoT('settings.asr.enable_itn'))}</span>
    </label>
  </fieldset>
  <fieldset class="grid gap-sm border-0 p-0 m-0 min-w-0">
    <legend class="text-[0.875rem] fw-semibold mb-1">${esc(oaaoT('settings.asr.shared_legend'))}</legend>
    <label class="flex flex-col gap-0.5 text-[0.8125rem]">
      <span class="fw-medium">${esc(oaaoT('settings.asr.language_hints'))}</span>
      <input name="asr_language_hints" placeholder="yue, zh" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" />
    </label>
  </fieldset>
  <p id="oaao-asr-settings-msg" class="text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem]" role="status"></p>
  <div class="flex flex-wrap gap-2">
    <button type="submit" data-oaao-asr-save class="${esc('px-3 py-1.5 rounded-md border-0 cursor-pointer font-inherit text-[0.8125rem] fw-medium bg-[var(--grid-accent)] fg-white')}">${esc(oaaoT('settings.asr.save'))}</button>
  </div>
</form>`;
}
