/**
 * Admin Settings — ASR / speech pipeline ({@code oaao_purpose.meta_json} for {@code asr}).
 * Routing (default endpoint, enabled) stays on Purpose allocation; pipeline tuning lives here.
 */

import { oaaoT } from './oaao-i18n.js';
import { replaceChildrenParsed, ruiBuild } from './oaao-jit-dsl.js';
import { endpointsApiUrl, endpointsFetchJson } from './endpoints-settings/api.js';
import {
    asrSettingsFormHtml,
    fillAsrSettingsForm,
    isFunasrReady,
    isSpeakerMode,
    readAsrSettingsMetaJson,
    runFunasrProvision,
    wireAsrSettingsForm,
} from './asr-settings/asr-settings-form.js';

/** @param {unknown} v */
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @type {{ purpose: Record<string, unknown>|null, postgresqlOnly: boolean }} */
const state = { purpose: null, postgresqlOnly: false };

/**
 * @param {HTMLElement} host
 * @param {{ JIT?: { hydrate?: (el: HTMLElement) => void } }} [ctx]
 */
export async function mountSettingsPanel(host, ctx = {}) {
    host.textContent = '';
    const loading = document.createElement('p');
    loading.className = 'text-sm fg-[var(--grid-ink-muted)]';
    loading.textContent = oaaoT('settings.asr.loading');
    host.appendChild(loading);

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
    const asrRow = purposes.find((r) => String(r?.purpose_key ?? '').trim() === 'asr') ?? null;
    state.purpose = asrRow && typeof asrRow === 'object' ? /** @type {Record<string, unknown>} */ (asrRow) : null;

    const wrap = document.createElement('div');
    wrap.className = 'grid gap-md min-w-0';

    if (!state.purpose) {
        replaceChildrenParsed(
            wrap,
            `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${escapeHtml(oaaoT('settings.asr.no_purpose_row'))}</p>`,
        );
        host.textContent = '';
        host.appendChild(wrap);
        ctx.JIT?.hydrate?.(host);
        return;
    }

    const epName = String(state.purpose.default_endpoint_name ?? state.purpose.default_endpoint_id ?? '—');
    const routingNote = oaaoT('settings.asr.routing_note', '', { endpoint: epName });
    replaceChildrenParsed(
        wrap,
        `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${escapeHtml(routingNote)}</p>${asrSettingsFormHtml(escapeHtml)}`,
    );

    const form = wrap.querySelector('#oaao-asr-settings-form');
    const msgEl = wrap.querySelector('#oaao-asr-settings-msg');
    if (form instanceof HTMLFormElement) {
        fillAsrSettingsForm(form, state.purpose.meta_json ?? '');
        wireAsrSettingsForm(form);
        form.addEventListener('submit', (ev) => {
            ev.preventDefault();
            void saveAsrSettings(form, msgEl instanceof HTMLElement ? msgEl : null);
        });
    }

    host.textContent = '';
    host.appendChild(wrap);
    ctx.JIT?.hydrate?.(host);
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

export function teardownSettingsPanel() {
    state.purpose = null;
    state.postgresqlOnly = false;
}
