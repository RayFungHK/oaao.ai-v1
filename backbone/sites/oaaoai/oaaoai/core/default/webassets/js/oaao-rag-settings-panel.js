/**
 * Admin Settings — RAG retrieval tuning ({@code oaao_purpose.meta_json.vault_rag} on {@code embedding.*}).
 * Embedding endpoint routing stays on Purpose allocation; Qdrant limits and ASR boosts live here.
 */

import { oaaoT } from './oaao-i18n.js';
import { oaaoRazyToastFire } from './oaao-razy-toast.js';
import { oaaoMountLoadingLogo } from './oaao-loading-logo.js';
import { replaceChildrenParsed, ruiBuild } from './oaao-jit-dsl.js';
import { endpointsApiUrl, endpointsFetchJson } from './endpoints-settings/api.js';
import {
    fillRagSettingsForm,
    ragSettingsFormHtml,
    readRagSettingsMetaJson,
} from './rag-settings/rag-settings-form.js';

/** @param {unknown} v */
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @param {Record<string, unknown>} row */
function isEmbeddingPurposeRow(row) {
    const pk = String(row?.purpose_key ?? '').trim();
    return pk === 'embedding' || pk.startsWith('embedding.');
}

/** @param {Record<string, unknown>[]} purposes */
function pickEmbeddingPurposeRow(purposes) {
    const rows = purposes.filter((r) => r && typeof r === 'object' && isEmbeddingPurposeRow(r));
    return (
        rows.find((r) => String(r?.purpose_key ?? '') === 'embedding.primary') ??
        rows.find((r) => String(r?.purpose_key ?? '') === 'embedding') ??
        rows[0] ??
        null
    );
}

/** @type {{ purpose: Record<string, unknown>|null, postgresqlOnly: boolean }} */
const state = { purpose: null, postgresqlOnly: false };

/**
 * @param {HTMLElement} host
 * @param {{ JIT?: { hydrate?: (el: HTMLElement) => void } }} [ctx]
 */
export async function mountSettingsPanel(host, ctx = {}) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: oaaoT('settings.rag.loading') });

    const { res, data } = await endpointsFetchJson(endpointsApiUrl('purposes_list'));
    if (!res.ok || !data?.success) {
        host.textContent = '';
        host.appendChild(
            ruiBuild({
                t: 'p',
                j: 'text-sm fg-[var(--grid-caution,#b45309)]',
                txt: oaaoT('settings.rag.load_failed'),
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
                txt: oaaoT('settings.rag.postgresql_only'),
            }),
        );
        return;
    }

    const purposes = Array.isArray(data.purposes) ? data.purposes : [];
    const embedRow = pickEmbeddingPurposeRow(purposes);
    state.purpose = embedRow && typeof embedRow === 'object' ? /** @type {Record<string, unknown>} */ (embedRow) : null;

    const wrap = document.createElement('div');
    wrap.className = 'grid gap-md min-w-0';

    if (!state.purpose) {
        replaceChildrenParsed(
            wrap,
            `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${escapeHtml(oaaoT('settings.rag.no_purpose_row'))}</p>`,
        );
        host.textContent = '';
        host.appendChild(wrap);
        ctx.JIT?.hydrate?.(host);
        return;
    }

    const epName = String(state.purpose.default_endpoint_name ?? state.purpose.default_endpoint_id ?? '—');
    const routingNote = oaaoT('settings.rag.routing_note', '', { endpoint: epName });
    replaceChildrenParsed(
        wrap,
        `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${escapeHtml(routingNote)}</p>${ragSettingsFormHtml(escapeHtml)}`,
    );

    const form = wrap.querySelector('#oaao-rag-settings-form');
    const msgEl = wrap.querySelector('#oaao-rag-settings-msg');
    if (form instanceof HTMLFormElement) {
        fillRagSettingsForm(form, state.purpose.meta_json ?? '');
        form.addEventListener('submit', (ev) => {
            ev.preventDefault();
            void saveRagSettings(form, msgEl instanceof HTMLElement ? msgEl : null);
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
async function saveRagSettings(form, msgEl) {
    const row = state.purpose;
    if (!row) {
        if (msgEl) msgEl.textContent = oaaoT('settings.rag.no_purpose_row');
        return;
    }

    /** @type {Record<string, unknown>} */
    let existing = {};
    const rawMeta = row.meta_json;
    if (typeof rawMeta === 'string' && rawMeta.trim()) {
        try {
            const dec = JSON.parse(rawMeta.trim());
            if (dec && typeof dec === 'object') existing = /** @type {Record<string, unknown>} */ (dec);
        } catch {
            existing = {};
        }
    } else if (rawMeta && typeof rawMeta === 'object') {
        existing = /** @type {Record<string, unknown>} */ (rawMeta);
    }

    const parsed = JSON.parse(readRagSettingsMetaJson(form));
    const metaJson = JSON.stringify({ ...existing, ...parsed });

    if (msgEl) msgEl.textContent = oaaoT('settings.rag.saving');

    const payload = {
        id: Number(row.id),
        purpose_key: String(row.purpose_key ?? 'embedding'),
        label: String(row.label ?? 'Embedding'),
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
                    : oaaoT('settings.rag.save_failed', '', { status: String(res.status) });
        }
        return;
    }

    state.purpose = { ...row, meta_json: metaJson };
    if (msgEl) msgEl.textContent = oaaoT('settings.rag.saved');
    oaaoRazyToastFire(oaaoT('settings.rag.saved'), 'success');
}

export function teardownSettingsPanel() {
    state.purpose = null;
    state.postgresqlOnly = false;
}
