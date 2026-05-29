/**
 * Purpose routing dialog markup (label, endpoint, enabled). Pipeline config → {@link ../oaao-asr-settings-panel.js}.
 */

import { oaaoT } from '../oaao-i18n.js';

/**
 * @param {string} epOpts
 * @param {{ hideMetaJson?: boolean }} [opts]
 * @param {(s: string) => string} esc
 */
export function purposeEditorFormHtml(epOpts, opts, esc) {
    const hideMeta = Boolean(opts?.hideMetaJson);
    const noneOpt = esc(oaaoT('settings.endpoints.none_option'));
    const metaJsonField = hideMeta
        ? ''
        : `<label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('settings.pu.form.meta_json'))}</span><textarea name="meta_json" rows="4" placeholder='{"inference_params":{"temperature":0.8,"top_p":0.95}}' class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs"></textarea><span class="text-[0.6875rem] fg-[var(--grid-caption)]">Chat purposes: optional inference_params preset (temp, top_p, top_k, penalties, max_tokens).</span></label>`;

    return `<form id="oaao-pu-dlg-form" class="grid gap-sm max-w-full">
  <input type="hidden" name="id" value="" />
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('settings.pu.form.purpose_key'))}</span><input name="purpose_key" required pattern="[a-zA-Z0-9][a-zA-Z0-9_.:-]*" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs" placeholder="chat.default" /></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('settings.pu.form.label'))}</span><input name="label" required class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" /></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('settings.pu.form.description'))}</span><textarea name="description" rows="2" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] text-xs"></textarea></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('settings.pu.form.default_endpoint'))}</span>
    <select name="default_endpoint_id" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]"><option value="">${noneOpt}</option>${epOpts}</select></label>
  <label class="flex items-center gap-2 text-[0.8125rem] cursor-pointer"><input type="checkbox" name="is_enabled" checked class="rounded border-[var(--grid-line)]" /><span>${esc(oaaoT('settings.purposes.enabled'))}</span></label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('settings.pu.form.sort_order'))}</span><input name="sort_order" type="number" value="500" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs" /></label>
  ${metaJsonField}
  <p id="oaao-pu-dlg-msg" class="text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem]" role="status"></p>
</form>`;
}

/** @param {string} purposeKey */
export function isAsrRoutingPurposeKey(purposeKey) {
    const pk = String(purposeKey ?? '').trim();
    return pk === 'asr' || pk.startsWith('asr.');
}
