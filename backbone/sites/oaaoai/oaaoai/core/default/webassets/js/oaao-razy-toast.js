/**
 * RazyUI {@code Toast} helper — {@code razyui.load('Toast')} so chunk graph resolves from the bundle base.
 */

import razyui from 'razyui';

/** @type {Promise<unknown> | null} */
let toastCtorPromise = null;

function loadToastCtor() {
    if (!toastCtorPromise) {
        toastCtorPromise = razyui
            .load('Toast')
            .then((Toast) => {
                if (typeof Toast !== 'function') throw new Error('Toast unavailable');

                return Toast;
            })
            .catch((err) => {
                toastCtorPromise = null;
                throw err;
            });
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
