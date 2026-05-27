/**
 * RazyUI {@code Toast} helper — {@code razyui.load('Toast')} so chunk graph resolves from the bundle base.
 */

import razyui from 'razyui';
import { oaaoMessageWithBuild } from './oaao-build-stamp.js';

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
 * @param {unknown} [build] optional API {@code build} stamp (falls back to page embedded)
 */
export async function oaaoRazyToast(message, kind = 'info', build) {
    try {
        const Toast = await loadToastCtor();
        const stamped = oaaoMessageWithBuild(message, build);
        const opts = /** @type {const} */ ({ duration: 2400, position: 'bottom-right' });
        const k = kind === 'error' ? 'error' : kind === 'success' ? 'success' : kind === 'warning' ? 'warning' : 'info';
        if (k === 'error') Toast.error(stamped, opts);
        else if (k === 'success') Toast.success(stamped, opts);
        else if (k === 'warning') Toast.warning(stamped, opts);
        else Toast.info(stamped, opts);
    } catch (err) {
        console.warn('[oaao] RazyUI toast failed', err);
    }
}

/**
 * @param {string} message
 * @param {'success' | 'error' | 'info' | 'warning'} [kind]
 * @param {unknown} [build]
 */
export function oaaoRazyToastFire(message, kind = 'info', build) {
    void oaaoRazyToast(message, kind, build);
}
