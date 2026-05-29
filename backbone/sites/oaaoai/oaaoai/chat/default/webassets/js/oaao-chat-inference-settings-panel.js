/**
 * Admin Settings — chat inference defaults ({@code chat.*} {@code meta_json.inference_params}).
 */

/** @param {string} relUnderCoreDefault */
function oaaoInferenceCoreImportHref(relUnderCoreDefault) {
    let pathOnly = `/webassets/core/default/${String(relUnderCoreDefault ?? '').replace(/^\/+/, '')}`.replace(
        /\/{2,}/g,
        '/',
    );
    const rawMount = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    if (rawMount !== '' && rawMount !== '/') {
        const pref = (rawMount.startsWith('/') ? rawMount : `/${rawMount}`).replace(/\/+$/, '');
        if (pref !== '' && !(pathOnly === pref || pathOnly.startsWith(`${pref}/`))) {
            pathOnly = `${pref}${pathOnly}`.replace(/\/{2,}/g, '/');
        }
    }
    if (
        typeof window !== 'undefined' &&
        window.location &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ) {
        const o = window.location.origin;
        if (o && o !== 'null') {
            return `${o}${pathOnly}`;
        }
    }
    return pathOnly;
}

const [_mI18n, _mJit, _mApi, _mLoading, _mToast] = await Promise.all([
    import(/* webpackIgnore: true */ oaaoInferenceCoreImportHref('js/oaao-i18n.js')),
    import(/* webpackIgnore: true */ oaaoInferenceCoreImportHref('js/oaao-jit-dsl.js')),
    import(/* webpackIgnore: true */ oaaoInferenceCoreImportHref('js/endpoints-settings/api.js')),
    import(/* webpackIgnore: true */ oaaoInferenceCoreImportHref('js/oaao-loading-logo.js')),
    import(/* webpackIgnore: true */ oaaoInferenceCoreImportHref('js/oaao-razy-toast.js')),
]);

const { oaaoT } = _mI18n;
const { replaceChildrenParsed, ruiBuild } = _mJit;
const { endpointsApiUrl, endpointsFetchJson } = _mApi;
const { oaaoMountLoadingLogo } = _mLoading;
const { oaaoRazyToastFire } = _mToast;

import {
    fillInferenceSettingsForm,
    inferenceSettingsFormHtml,
    readInferenceSettingsMetaJson,
} from './chat-inference-settings/inference-settings-form.js';

/** @param {unknown} v */
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @param {Record<string, unknown>} row */
function isChatPurposeRow(row) {
    const pk = String(row?.purpose_key ?? '').trim();
    return pk === 'chat' || pk.startsWith('chat.');
}

/** @param {Record<string, unknown>[]} purposes */
function pickChatPurposeRow(purposes) {
    const rows = purposes.filter((r) => r && typeof r === 'object' && isChatPurposeRow(r));
    return (
        rows.find((r) => String(r?.purpose_key ?? '') === 'chat.primary') ??
        rows.find((r) => String(r?.purpose_key ?? '') === 'chat') ??
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
    oaaoMountLoadingLogo(host, { label: oaaoT('settings.inference.loading') });

    const { res, data } = await endpointsFetchJson(endpointsApiUrl('purposes_list'));
    if (!res.ok || !data?.success) {
        host.textContent = '';
        host.appendChild(
            ruiBuild({
                t: 'p',
                j: 'text-sm fg-[var(--grid-caution,#b45309)]',
                txt: oaaoT('settings.inference.load_failed'),
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
                txt: oaaoT('settings.inference.postgresql_only'),
            }),
        );
        return;
    }

    const purposes = Array.isArray(data.purposes) ? data.purposes : [];
    const chatRow = pickChatPurposeRow(purposes);
    state.purpose =
        chatRow && typeof chatRow === 'object' ? /** @type {Record<string, unknown>} */ (chatRow) : null;

    const wrap = document.createElement('div');
    wrap.className = 'grid gap-md min-w-0';

    if (!state.purpose) {
        replaceChildrenParsed(
            wrap,
            `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${escapeHtml(oaaoT('settings.inference.no_purpose_row'))}</p>`,
        );
        host.textContent = '';
        host.appendChild(wrap);
        ctx.JIT?.hydrate?.(host);
        return;
    }

    const epName = String(state.purpose.default_endpoint_name ?? state.purpose.default_endpoint_id ?? '—');
    const routingNote = oaaoT('settings.inference.routing_note', '', { endpoint: epName });
    replaceChildrenParsed(
        wrap,
        `<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${escapeHtml(routingNote)}</p>${inferenceSettingsFormHtml(escapeHtml, oaaoT)}`,
    );

    const form = wrap.querySelector('#oaao-chat-inference-settings-form');
    const msgEl = wrap.querySelector('#oaao-chat-inference-settings-msg');
    if (form instanceof HTMLFormElement) {
        fillInferenceSettingsForm(form, state.purpose.meta_json ?? '');
        form.addEventListener('submit', (ev) => {
            ev.preventDefault();
            void saveInferenceSettings(form, msgEl instanceof HTMLElement ? msgEl : null);
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
async function saveInferenceSettings(form, msgEl) {
    const row = state.purpose;
    if (!row) {
        if (msgEl) msgEl.textContent = oaaoT('settings.inference.no_purpose_row');
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

    const parsed = JSON.parse(readInferenceSettingsMetaJson(form));
    const metaJson = JSON.stringify({ ...existing, ...parsed });

    if (msgEl) msgEl.textContent = oaaoT('settings.inference.saving');

    const payload = {
        id: Number(row.id),
        purpose_key: String(row.purpose_key ?? 'chat'),
        label: String(row.label ?? 'Chat'),
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
                    : oaaoT('settings.inference.save_failed', '', { status: String(res.status) });
        }
        return;
    }

    state.purpose = { ...row, meta_json: metaJson };
    if (msgEl) msgEl.textContent = oaaoT('settings.inference.saved');
    oaaoRazyToastFire(oaaoT('settings.inference.saved'), 'success');
}

export function teardownSettingsPanel() {
    state.purpose = null;
    state.postgresqlOnly = false;
}
