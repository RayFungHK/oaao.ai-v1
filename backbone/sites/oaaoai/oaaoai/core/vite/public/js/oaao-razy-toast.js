/**
 * RazyUI {@code Toast} helper — dynamic import so chat shell scripts avoid brittle cross-package static URLs.
 */

import { resolveShellRegistryUrl } from './shell-registry-url.js';

/** @type {Promise<unknown> | null} */
let toastCtorPromise = null;

function loadToastCtor() {
    if (!toastCtorPromise) {
        const url = resolveShellRegistryUrl('/webassets/core/default/razyui/component/Toast.js');
        toastCtorPromise = import(/* webpackIgnore: true */ url).then((m) => m.default);
    }

    return toastCtorPromise;
}

/**
 * @param {string} message
 * @param {'success' | 'error' | 'info' | 'warning'} [kind]
 */
export async function oaaoRazyToast(message, kind = 'info') {
    try {
        const Toast = await loadToastCtor();
        const opts = /** @type {const} */ ({ duration: 2400, position: 'bottom-right' });
        const k = kind === 'error' ? 'error' : kind === 'success' ? 'success' : kind === 'warning' ? 'warning' : 'info';
        if (k === 'error') Toast.error(message, opts);
        else if (k === 'success') Toast.success(message, opts);
        else if (k === 'warning') Toast.warning(message, opts);
        else Toast.info(message, opts);
    } catch (err) {
        console.warn('[oaao] RazyUI toast failed', err);
    }
}

/**
 * @param {string} message
 * @param {'success' | 'error' | 'info' | 'warning'} [kind]
 */
export function oaaoRazyToastFire(message, kind = 'info') {
    void oaaoRazyToast(message, kind);
}
