/**
 * Mutable runtime for the endpoints settings panel — single module-level scope per graph load.
 */

/** @type {{ endpoints: Array<Record<string, unknown>>, purposes: Array<Record<string, unknown>>, purposesPostgresqlOnly: boolean, chatProfiles: Array<Record<string, unknown>> }} */
export const rt = {
    state: { endpoints: [], purposes: [], purposesPostgresqlOnly: false, chatProfiles: [], endpointUsageStats: {} },
    /** @type {{ Dialog?: unknown, JIT?: { hydrate?: (root: Element | DocumentFragment) => void }, razyui?: unknown } | null} */
    mountCtx: null,
    /** @type {Array<{ close: () => void }>} */
    nestedDialogControls: [],
    /** @type {Promise<{ default: new (host: Element, config?: Record<string, unknown>) => unknown; registerElement?: () => Promise<void> }> | null} */
    comboboxModulePromise: null,
    comboboxCustomElementRegistered: false,
};
