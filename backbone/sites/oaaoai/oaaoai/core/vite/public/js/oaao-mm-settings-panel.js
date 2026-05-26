/**
 * Admin Settings — Multimodal Python module config (no Purpose allocation).
 */

import { oaaoT } from '@oaao/core-js/oaao-i18n.js';
import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';
import { replaceChildrenParsed, ruiBuild } from '@oaao/core-js/oaao-jit-dsl.js';
import { endpointsApiUrl, endpointsFetchJson } from '@oaao/core-js/endpoints-settings/api.js';
import {
    fillMmSettingsForm,
    mmSettingsFormHtml,
    readMmSettingsConfig,
    wireMmSettingsForm,
    wireMmModuleConfigButton,
    escapeHtml,
} from '@oaao/core-js/mm-settings/mm-settings-form.js';

/**
 * @param {HTMLElement} host
 * @param {{ Dialog?: new (opts: Record<string, unknown>) => unknown, JIT?: { hydrate?: (el: HTMLElement) => void } }} [ctx]
 */
export async function mountSettingsPanel(host, ctx = {}) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: oaaoT('settings.mm.loading', 'Loading multimodal settings…') });

    const { res, data } = await endpointsFetchJson(endpointsApiUrl('mm_settings'));
    if (!res.ok || !data?.success) {
        host.textContent = '';
        host.appendChild(
            ruiBuild({
                t: 'p',
                j: 'text-sm fg-[var(--grid-caution,#b45309)]',
                txt: oaaoT('settings.mm.load_failed', 'Failed to load multimodal settings.'),
            }),
        );
        return;
    }

    const config =
        data.data && typeof data.data === 'object'
            ? /** @type {Record<string, unknown>} */ (data.data)
            : { python_module: 'mm_lance', axes: {} };
    const mmModules = Array.isArray(data.mm_python_modules) ? data.mm_python_modules : [];
    const mediaCapabilities = Array.isArray(data.media_capabilities) ? data.media_capabilities : [];
    const envHints =
        data.env_hints && typeof data.env_hints === 'object'
            ? /** @type {Record<string, string>} */ (data.env_hints)
            : {};
    const registry = { modules: mmModules, mediaCapabilities, envHints };

    const wrap = document.createElement('div');
    wrap.className = 'grid gap-md min-w-0';
    replaceChildrenParsed(
        wrap,
        `<section class="grid gap-md min-w-0"><h3 class="text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] m-0">${escapeHtml(oaaoT('settings.mm.title', 'Multimodal'))}</h3>${mmSettingsFormHtml(escapeHtml, registry)}</section>`,
    );
    host.textContent = '';
    host.appendChild(wrap);

    const form = wrap.querySelector('#oaao-mm-settings-form');
    if (!(form instanceof HTMLFormElement)) return;
    fillMmSettingsForm(form, config, registry);
    wireMmSettingsForm(form, saveMmSettings);
    wireMmModuleConfigButton(
        form,
        { ...ctx, modules: mmModules, envHints },
        async (f) => {
            const msgEl = f.querySelector('#oaao-mm-settings-msg');
            await saveMmSettings(f, msgEl instanceof HTMLElement ? msgEl : null);
        },
    );
    try {
        ctx.JIT?.hydrate?.(wrap);
    } catch (hydrateErr) {
        console.warn('[oaao] mm-settings-panel: JIT hydrate failed', hydrateErr);
    }
}

/**
 * @param {HTMLFormElement} form
 * @param {HTMLElement|null} msgEl
 */
async function saveMmSettings(form, msgEl) {
    const body = readMmSettingsConfig(form);
    if (msgEl) msgEl.textContent = oaaoT('settings.mm.saving', 'Saving…');

    const { res, data } = await endpointsFetchJson(endpointsApiUrl('mm_settings_save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (msgEl) {
        if (!res.ok || !data?.success) {
            msgEl.textContent =
                typeof data?.message === 'string'
                    ? data.message
                    : oaaoT('settings.mm.save_failed', 'Save failed.');
            return;
        }
        msgEl.textContent = oaaoT('settings.mm.saved', 'Multimodal settings saved.');
    }
}

/** @param {HTMLElement} _host */
export function teardownSettingsPanel(_host) {}
