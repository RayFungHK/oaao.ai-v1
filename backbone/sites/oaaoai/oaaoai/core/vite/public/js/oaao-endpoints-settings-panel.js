/**
 * Admin Settings — {@code oaao_endpoint} list; purpose allocation cards ({@code PurposeAllocationRegister}).
 * Lives under **core** {@code webassets} ({@see SettingsRegister}) so minimal dev servers need not map {@code /webassets/endpoints/*}.
 * Implementation: {@link ./endpoints-settings/endpoints-settings-view.js}, {@link ./endpoints-settings/oaao-endpoints-actions.js}.
 *
 * Actions load via cache-busted dynamic {@code import()} so nested modules (purpose editor / ASR form) reload with {@code data-oaao-shell-esm-v}.
 */

/** @returns {Promise<typeof import('./endpoints-settings/oaao-endpoints-actions.js')>} */
function loadActionsModule() {
    const url = new URL('./endpoints-settings/oaao-endpoints-actions.js', import.meta.url);
    const v = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
    if (v) url.searchParams.set('v', v);
    return import(/* webpackIgnore: true */ url.href);
}

/** @param {HTMLElement} host @param {Record<string, unknown>} ctx */
export async function mountSettingsPanel(host, ctx) {
    const mod = await loadActionsModule();
    return mod.mountSettingsPanel(host, ctx);
}

export async function teardownSettingsPanel() {
    const mod = await loadActionsModule();
    return mod.teardownSettingsPanel();
}
