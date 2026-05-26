/**
 * Admin Settings — ASR batch pipeline + Live ASR preferences.
 * Routing (default endpoints) stays on Purpose allocation; tuning lives here.
 */

import { oaaoT } from '@oaao/core-js/oaao-i18n.js';
import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';
import { replaceChildrenParsed, ruiBuild } from '@oaao/core-js/oaao-jit-dsl.js';
import { endpointsApiUrl, endpointsFetchJson } from '@oaao/core-js/endpoints-settings/api.js';
import {
    asrSettingsFormHtml,
    fillAsrSettingsForm,
    isFunasrReady,
    isSpeakerMode,
    readAsrSettingsMetaJson,
    runFunasrProvision,
    wireAsrSettingsForm,
} from '@oaao/core-js/asr-settings/asr-settings-form.js';
import {
    asrLiveSettingsSectionHtml,
    decodeMeta,
    fillAsrLiveSettingsForm,
    readAsrLiveSettingsMetaJson,
    wireAsrLiveSettingsForm,
} from '@oaao/core-js/asr-settings/asr-live-settings-form.js';

/** @param {unknown} v */
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @param {Array<unknown>} purposes @param {string} key */
function findPurposeRow(purposes, key) {
    const row =
        purposes.find((r) => String(r?.purpose_key ?? '').trim() === key) ??
        (key === 'asr.live'
            ? purposes.find((r) => String(r?.purpose_key ?? '').startsWith('asr.live.'))
            : null);
    return row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : null;
}

/** @type {{ purpose: Record<string, unknown>|null, livePurpose: Record<string, unknown>|null, postgresqlOnly: boolean }} */
const state = { purpose: null, livePurpose: null, postgresqlOnly: false };

/**
 * @param {HTMLElement} host
 * @param {{ JIT?: { hydrate?: (el: HTMLElement) => void } }} [ctx]
 */
export async function mountSettingsPanel(host, ctx = {}) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: oaaoT('settings.asr.loading') });

    const { res, data } = await endpointsFetchJson(endpointsApiUrl('purposes_list'));
    if (!res.ok || !data?.success) {
        host.textContent = '';
        host.appendChild(
            ruiBuild({
                t: 'p',
                j: 'text-sm fg-[var(--grid-caution,#b45309)]',
                txt: oaaoT('settings.asr.load_failed'),
            }),
        );
        return;
    }

    state.postgresqlOnly = Boolean(data.purposes_postgresql_only);
    if (state.postgresqlOnly) {
        host.textContent = '';
        host.appendChild(
            ruiBuild({
                t: 'p',
                j: 'text-sm fg-[var(--grid-ink-muted)]',
                txt: oaaoT('settings.asr.postgresql_only'),
            }),
        );
        return;
    }

    const purposes = Array.isArray(data.purposes) ? data.purposes : [];
    state.purpose = findPurposeRow(purposes, 'asr');
    state.livePurpose = findPurposeRow(purposes, 'asr.live');

    const wrap = document.createElement('div');
    wrap.className = 'grid gap-md min-w-0';

    /** @type {string[]} */
    const htmlParts = [];

    htmlParts.push(
        `<section class="grid gap-md min-w-0 max-w-[36rem]"><h3 class="text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] m-0">${escapeHtml(oaaoT('settings.asr.section_batch'))}</h3>`,
    );

    if (state.purpose) {
        const epName = String(state.purpose.default_endpoint_name ?? state.purpose.default_endpoint_id ?? '—');
        const routingNote = oaaoT('settings.asr.routing_note', '', { endpoint: epName });
        htmlParts.push(
            `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${escapeHtml(routingNote)}</p>${asrSettingsFormHtml(escapeHtml)}`,
        );
    } else {
        htmlParts.push(
            `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${escapeHtml(oaaoT('settings.asr.no_purpose_row'))}</p>`,
        );
    }
    htmlParts.push('</section>');

    if (state.livePurpose) {
        const liveEp = String(
            state.livePurpose.default_endpoint_name ?? state.livePurpose.default_endpoint_id ?? '—',
        );
        const liveRouting = escapeHtml(
            oaaoT('settings.asr_live.routing_note', '', { endpoint: liveEp }),
        );
        htmlParts.push(asrLiveSettingsSectionHtml(escapeHtml, liveRouting));
    } else {
        htmlParts.push(`
<section id="oaao-asr-live-settings-section" class="grid gap-md min-w-0 max-w-xl pt-lg mt-lg border-t border-solid border-[var(--grid-line)]">
  <h3 class="text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] m-0">${escapeHtml(oaaoT('settings.asr_live.section_title'))}</h3>
  <p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${escapeHtml(oaaoT('settings.asr_live.no_purpose_row'))}</p>
</section>`);
    }

    replaceChildrenParsed(wrap, htmlParts.join(''));

    const form = wrap.querySelector('#oaao-asr-settings-form');
    const msgEl = wrap.querySelector('#oaao-asr-settings-msg');
    if (form instanceof HTMLFormElement && state.purpose) {
        fillAsrSettingsForm(form, state.purpose.meta_json ?? '');
        wireAsrSettingsForm(form);
        form.addEventListener('submit', (ev) => {
            ev.preventDefault();
            void saveAsrSettings(form, msgEl instanceof HTMLElement ? msgEl : null);
        });
    }

    const liveForm = wrap.querySelector('#oaao-asr-live-settings-form');
    const liveMsgEl = wrap.querySelector('#oaao-asr-live-settings-msg');
    if (liveForm instanceof HTMLFormElement && state.livePurpose) {
        fillAsrLiveSettingsForm(liveForm, decodeMeta(state.livePurpose.meta_json ?? ''));
        wireAsrLiveSettingsForm(liveForm);
        liveForm.addEventListener('submit', (ev) => {
            ev.preventDefault();
            void saveAsrLiveSettings(liveForm, liveMsgEl instanceof HTMLElement ? liveMsgEl : null);
        });
    }

    host.textContent = '';
    host.appendChild(wrap);
    try {
        ctx.JIT?.hydrate?.(host);
    } catch (hydrateErr) {
        console.warn('[oaao] asr-settings-panel: JIT hydrate failed', hydrateErr);
    }
}

/**
 * @param {HTMLFormElement} form
 * @param {HTMLElement|null} msgEl
 */
async function saveAsrSettings(form, msgEl) {
    if (isSpeakerMode(form) && !isFunasrReady(form)) {
        if (msgEl) msgEl.textContent = oaaoT('settings.asr.save_blocked_not_ready');
        return;
    }
    const row = state.purpose;
    if (!row) {
        if (msgEl) msgEl.textContent = oaaoT('settings.asr.no_purpose_row');
        return;
    }

    const metaJson = readAsrSettingsMetaJson(form);
    if (msgEl) msgEl.textContent = oaaoT('settings.asr.saving');

    const payload = {
        id: Number(row.id),
        purpose_key: 'asr',
        label: String(row.label ?? 'ASR'),
        description: String(row.description ?? ''),
        default_endpoint_id:
            row.default_endpoint_id != null && row.default_endpoint_id !== ''
                ? Number(row.default_endpoint_id)
                : null,
        is_enabled: Number(row.is_enabled) === 1,
        sort_order: Number(row.sort_order ?? 500),
        meta_json: metaJson,
    };

    const { res, data } = await endpointsFetchJson(endpointsApiUrl('purposes_save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok || !data?.success) {
        if (msgEl) {
            msgEl.textContent =
                typeof data?.message === 'string'
                    ? data.message
                    : oaaoT('settings.asr.save_failed', '', { status: String(res.status) });
        }
        return;
    }

    state.purpose = { ...row, meta_json: metaJson };
    if (msgEl) msgEl.textContent = oaaoT('settings.asr.saved');
}

/**
 * @param {HTMLFormElement} form
 * @param {HTMLElement|null} msgEl
 */
async function saveAsrLiveSettings(form, msgEl) {
    const row = state.livePurpose;
    if (!row) {
        if (msgEl) msgEl.textContent = oaaoT('settings.asr_live.no_purpose_row');
        return;
    }

    const existingMeta = decodeMeta(row.meta_json ?? '');
    const metaJson = readAsrLiveSettingsMetaJson(form, existingMeta);
    if (msgEl) msgEl.textContent = oaaoT('settings.asr_live.saving');

    const payload = {
        id: Number(row.id),
        purpose_key: String(row.purpose_key ?? 'asr.live'),
        label: String(row.label ?? 'ASR-Live'),
        description: String(row.description ?? ''),
        default_endpoint_id:
            row.default_endpoint_id != null && row.default_endpoint_id !== ''
                ? Number(row.default_endpoint_id)
                : null,
        is_enabled: Number(row.is_enabled) === 1,
        sort_order: Number(row.sort_order ?? 510),
        meta_json: metaJson,
    };

    const { res, data } = await endpointsFetchJson(endpointsApiUrl('purposes_save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok || !data?.success) {
        if (msgEl) {
            msgEl.textContent =
                typeof data?.message === 'string'
                    ? data.message
                    : oaaoT('settings.asr_live.save_failed', '', { status: String(res.status) });
        }
        return;
    }

    state.livePurpose = { ...row, meta_json: metaJson };
    if (msgEl) msgEl.textContent = oaaoT('settings.asr_live.saved');
}

export function teardownSettingsPanel() {
    state.purpose = null;
    state.livePurpose = null;
    state.postgresqlOnly = false;
}
