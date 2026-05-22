/**
 * Admin Settings → RAG retrieval tuning (Qdrant limits, score thresholds, ASR boosts).
 * Persisted on {@code oaao_purpose.meta_json.vault_rag} for {@code embedding.*} (Settings → RAG).
 */

import { oaaoT } from '../oaao-i18n.js';

/** @param {unknown} v */
function numOr(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {unknown} metaJson
 * @returns {{ qdrant_limit: number, min_score: number, graph_limit: number, transcript_summary_boost: number, asr_transcript_boost: number }}
 */
export function readRagSettingsFromMeta(metaJson) {
    /** @type {Record<string, unknown>} */
    let root = {};
    if (typeof metaJson === 'string' && metaJson.trim()) {
        try {
            const dec = JSON.parse(metaJson.trim());
            if (dec && typeof dec === 'object') root = /** @type {Record<string, unknown>} */ (dec);
        } catch {
            root = {};
        }
    } else if (metaJson && typeof metaJson === 'object') {
        root = /** @type {Record<string, unknown>} */ (metaJson);
    }
    const nested =
        root.vault_rag && typeof root.vault_rag === 'object'
            ? /** @type {Record<string, unknown>} */ (root.vault_rag)
            : root;

    return {
        qdrant_limit: Math.max(2, Math.min(24, Math.round(numOr(nested.qdrant_limit, 6)))),
        min_score: Math.max(0, Math.min(1, numOr(nested.min_score, 0.38))),
        graph_limit: Math.max(4, Math.min(16, Math.round(numOr(nested.graph_limit, 12)))),
        transcript_summary_boost: Math.max(0, Math.min(0.3, numOr(nested.transcript_summary_boost, 0.1))),
        asr_transcript_boost: Math.max(0, Math.min(0.2, numOr(nested.asr_transcript_boost, 0.03))),
    };
}

/** @param {HTMLFormElement} form */
export function readRagSettingsMetaJson(form) {
    return JSON.stringify(readRagSettingsMetaObject(form));
}

/** @param {HTMLFormElement} form */
export function readRagSettingsMetaObject(form) {
    const q = form.elements.namedItem('rag_qdrant_limit');
    const ms = form.elements.namedItem('rag_min_score');
    const gl = form.elements.namedItem('rag_graph_limit');
    const ts = form.elements.namedItem('rag_transcript_summary_boost');
    const at = form.elements.namedItem('rag_asr_transcript_boost');
    const cfg = {
        qdrant_limit: q instanceof HTMLInputElement ? numOr(q.value, 6) : 6,
        min_score: ms instanceof HTMLInputElement ? numOr(ms.value, 0.38) : 0.38,
        graph_limit: gl instanceof HTMLInputElement ? numOr(gl.value, 12) : 12,
        transcript_summary_boost: ts instanceof HTMLInputElement ? numOr(ts.value, 0.06) : 0.06,
        asr_transcript_boost: at instanceof HTMLInputElement ? numOr(at.value, 0.03) : 0.03,
    };
    return { vault_rag: readRagSettingsFromMeta({ vault_rag: cfg }) };
}

/**
 * @param {HTMLFormElement} form
 * @param {unknown} metaJson
 */
export function fillRagSettingsForm(form, metaJson) {
    const cfg = readRagSettingsFromMeta(metaJson);
    const set = (name, value) => {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement) el.value = String(value);
    };
    set('rag_qdrant_limit', cfg.qdrant_limit);
    set('rag_min_score', cfg.min_score);
    set('rag_graph_limit', cfg.graph_limit);
    set('rag_transcript_summary_boost', cfg.transcript_summary_boost);
    set('rag_asr_transcript_boost', cfg.asr_transcript_boost);
}

/**
 * @param {(s: string) => string} esc
 */
export function ragSettingsFormHtml(esc) {
    return `<form id="oaao-rag-settings-form" class="grid gap-md max-w-[36rem]">
  <fieldset class="border border-[var(--grid-line)] rounded-md p-md m-0 grid gap-sm">
    <legend class="text-[0.8125rem] fw-semibold px-1">${esc(oaaoT('settings.rag.retrieval_legend'))}</legend>
    <p class="text-[0.75rem] m-0 fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.rag.retrieval_intro'))}</p>
    <label class="grid gap-1">
      <span class="text-[0.8125rem] fw-medium">${esc(oaaoT('settings.rag.qdrant_limit'))}</span>
      <input type="number" name="rag_qdrant_limit" min="2" max="24" step="1" required class="font-inherit text-[0.8125rem] px-2 py-1.5 rounded border border-[var(--grid-line)] bg-[var(--grid-panel)] max-w-[8rem]" />
      <span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.rag.qdrant_limit_hint'))}</span>
    </label>
    <label class="grid gap-1">
      <span class="text-[0.8125rem] fw-medium">${esc(oaaoT('settings.rag.min_score'))}</span>
      <input type="number" name="rag_min_score" min="0" max="1" step="0.01" required class="font-inherit text-[0.8125rem] px-2 py-1.5 rounded border border-[var(--grid-line)] bg-[var(--grid-panel)] max-w-[8rem]" />
      <span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.rag.min_score_hint'))}</span>
    </label>
    <label class="grid gap-1">
      <span class="text-[0.8125rem] fw-medium">${esc(oaaoT('settings.rag.graph_limit'))}</span>
      <input type="number" name="rag_graph_limit" min="4" max="16" step="1" required class="font-inherit text-[0.8125rem] px-2 py-1.5 rounded border border-[var(--grid-line)] bg-[var(--grid-panel)] max-w-[8rem]" />
      <span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.rag.graph_limit_hint'))}</span>
    </label>
  </fieldset>
  <fieldset class="border border-[var(--grid-line)] rounded-md p-md m-0 grid gap-sm">
    <legend class="text-[0.8125rem] fw-semibold px-1">${esc(oaaoT('settings.rag.asr_boost_legend'))}</legend>
    <p class="text-[0.75rem] m-0 fg-[var(--grid-ink-muted)] leading-snug">${esc(oaaoT('settings.rag.asr_boost_intro'))}</p>
    <label class="grid gap-1">
      <span class="text-[0.8125rem] fw-medium">${esc(oaaoT('settings.rag.transcript_summary_boost'))}</span>
      <input type="number" name="rag_transcript_summary_boost" min="0" max="0.3" step="0.01" required class="font-inherit text-[0.8125rem] px-2 py-1.5 rounded border border-[var(--grid-line)] bg-[var(--grid-panel)] max-w-[8rem]" />
      <span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.rag.transcript_summary_boost_hint'))}</span>
    </label>
    <label class="grid gap-1">
      <span class="text-[0.8125rem] fw-medium">${esc(oaaoT('settings.rag.asr_transcript_boost'))}</span>
      <input type="number" name="rag_asr_transcript_boost" min="0" max="0.2" step="0.01" required class="font-inherit text-[0.8125rem] px-2 py-1.5 rounded border border-[var(--grid-line)] bg-[var(--grid-panel)] max-w-[8rem]" />
      <span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.rag.asr_transcript_boost_hint'))}</span>
    </label>
  </fieldset>
  <p id="oaao-rag-settings-msg" class="text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem]" role="status"></p>
  <div>
    <button type="submit" data-oaao-rag-save class="${esc('px-3 py-1.5 rounded-md border-0 cursor-pointer font-inherit text-[0.8125rem] fw-medium bg-[var(--grid-accent)] fg-white')}">${esc(oaaoT('settings.rag.save'))}</button>
  </div>
</form>`;
}
