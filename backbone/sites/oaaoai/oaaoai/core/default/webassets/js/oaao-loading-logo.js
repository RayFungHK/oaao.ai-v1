/**
 * Animated brand loader ({@code images/logo_animated.svg}) for AJAX / JSON fetch states.
 */

import { oaaoAppendShellEsmV, resolveShellRegistryUrl } from './shell-registry-url.js';

let cachedLogoUrl = '';

/** @returns {string} */
export function oaaoLoadingLogoAssetUrl() {
    if (!cachedLogoUrl) {
        cachedLogoUrl = oaaoAppendShellEsmV(
            resolveShellRegistryUrl('/webassets/core/default/images/logo_animated_muted.svg'),
        );
    }

    return cachedLogoUrl;
}

/**
 * @param {{ size?: number, block?: boolean, fill?: boolean, inline?: boolean, label?: string, className?: string }} [opts]
 * @returns {HTMLDivElement}
 */
export function oaaoLoadingLogoElement(opts = {}) {
    const size = Math.max(12, Math.min(48, Math.floor(Number(opts.size) || 16)));
    const wrap = document.createElement('div');
    const modeClass = opts.fill
        ? 'oaao-loading-logo--fill'
        : opts.inline
          ? 'oaao-loading-logo--inline'
          : opts.block === false
            ? ''
            : 'oaao-loading-logo--block';
    wrap.className = ['oaao-loading-logo', modeClass, opts.className ?? ''].filter(Boolean).join(' ');
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    wrap.style.setProperty('--oaao-loading-logo-size', `${size}px`);

    const img = document.createElement('img');
    img.src = oaaoLoadingLogoAssetUrl();
    img.alt = '';
    img.width = size;
    img.height = size;
    img.decoding = 'async';
    img.className = 'oaao-loading-logo__img';
    img.setAttribute('aria-hidden', 'true');
    wrap.append(img);

    if (opts.label) {
        const sr = document.createElement('span');
        sr.className = 'sr-only';
        sr.textContent = opts.label;
        wrap.append(sr);
    }

    return wrap;
}

/**
 * Replace {@code host} contents with the animated logo loader.
 *
 * @param {HTMLElement | null | undefined} host
 * @param {{ size?: number, block?: boolean, fill?: boolean, inline?: boolean, label?: string, className?: string }} [opts]
 */
export function oaaoMountLoadingLogo(host, opts = {}) {
    if (!(host instanceof HTMLElement)) return;
    host.replaceChildren(oaaoLoadingLogoElement(opts));
    host.setAttribute('aria-busy', 'true');
}

/** @param {HTMLElement | null | undefined} host */
export function oaaoClearLoadingLogoBusy(host) {
    if (!(host instanceof HTMLElement)) return;
    host.removeAttribute('aria-busy');
}
