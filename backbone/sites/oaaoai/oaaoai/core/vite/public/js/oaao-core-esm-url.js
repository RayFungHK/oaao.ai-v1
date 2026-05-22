/**
 * Absolute same-origin URLs for core distributor webassets.
 *
 * Apache maps {@code /webassets/core/{version}/X} → disk {@code …/core/{version}/webassets/X}; {@code X} is already relative to
 * that folder — callers pass paths like {@code js/foo.js}. If someone mistakenly prefixes {@code webassets/js/…} (duplicate vs rewrite),
 * only that shallow prefix is stripped ({@see stripRedundantWebassetsChildPrefix}).
 *
 * Uses {@link oaaoAbsoluteUrlFromPath} ({@see shell-registry-url.js}) so values match {@link resolveShellRegistryUrl} —
 * embedded previews mishandle bare root-relative strings in dynamic {@code import()}.
 */

import {
    getOaaoMountPrefixPath,
    normalizeOaaoWebassetsRewriteUrl,
    oaaoAbsoluteUrlFromPath,
} from './shell-registry-url.js';

/** @returns {string} pathname without trailing slash, or {@code ''} if unset */
function readCoreWebassetsRootPathnameFromDom() {
    const raw =
        (typeof document !== 'undefined' && document.body?.dataset?.oaaoCoreWebassetsRoot)?.trim() ?? '';
    if (!raw.startsWith('/')) return '';

    return sanitizeCoreWebassetsRootPathname(raw.replace(/\/$/, ''));
}

/**
 * Same conceptual root as {@code data-oaao-core-webassets-root}; embedded previews may omit or desync —
 * derive from {@code @oaao/core-js/} prefix in {@code <script type="importmap">} when parseable ({@see core.main.php}).
 *
 * @returns {string} pathname without trailing slash, or {@code ''}
 */
function readCoreWebassetsRootPathnameFromImportMap() {
    if (typeof document === 'undefined') return '';
    try {
        const el = document.querySelector('script[type="importmap"]');
        const rawJson = el?.textContent?.trim() ?? '';
        if (!rawJson) return '';

        /** @type {{ imports?: Record<string, string> }} */
        const map = JSON.parse(rawJson);
        let pre = map?.imports?.['@oaao/core-js/'];
        if (typeof pre !== 'string' || pre.trim() === '') return '';

        pre = pre.trim().replace(/\/{2,}/g, '/');
        if (/^https?:\/\//i.test(pre)) {
            pre = new URL(pre).pathname;
        }
        if (!pre.startsWith('/')) return '';

        let pathOnly = pre.replace(/\/+$/, '');
        /** Prefix MUST end with {@code …/js} — dirname is distributor webassets root. */
        pathOnly = pathOnly.replace(/\/js$/i, '');

        return sanitizeCoreWebassetsRootPathname(pathOnly);
    } catch {
        return '';
    }
}

/** Mistaken {@code webassets/js/…} under {@link oaaoCoreWebasset}; never strip {@code webassets/core/…} (would corrupt paths). */
function stripRedundantWebassetsChildPrefix(relTrimmed) {
    let t = relTrimmed;
    if (/^webassets\/(js|css|razyui|fonts|images)\//.test(t)) {
        t = t.slice('webassets/'.length);
    }

    return t;
}

/**
 * Collapse trailing duplicate {@code …/{version}/webassets} on roots emitted into {@code data-oaao-core-webassets-root}.
 *
 * @param {string} pathname Must begin with {@code /}
 */
function sanitizeCoreWebassetsRootPathname(pathname) {
    const merged = pathname.replace(/\/{2,}/g, '/');
    const probe = merged.endsWith('/') ? merged : `${merged}/`;

    /** Must match PHP {@code dirname(@oaao/core-js/)} — never …/core/{tag}/js ({@see oaaoCoreWebasset} + {@code razyui/} sibling). */
    let out = normalizeOaaoWebassetsRewriteUrl(probe).replace(/\/$/, '');
    out = out.replace(/(\/webassets\/core\/[^/]+)\/js$/i, '$1');

    return out;
}

/**
 * @param {string} rel path under core module {@code webassets/} without leading slash (e.g. {@code js/oaao-i18n.js})
 * @returns {string} absolute URL (browser) or {@code import.meta} layout URL (worker fallback)
 */
export function oaaoCoreWebasset(rel) {
    let trimmed = stripRedundantWebassetsChildPrefix(String(rel ?? '').replace(/^\/+/, ''));

    const mapRoot = readCoreWebassetsRootPathnameFromImportMap();
    const domRoot = readCoreWebassetsRootPathnameFromDom();
    const prefix = getOaaoMountPrefixPath().replace(/\/$/, '');
    const fallbackRoot = prefix === '' ? '/webassets/core/default' : `${prefix}/webassets/core/default`;
    const normalizedRoot = sanitizeCoreWebassetsRootPathname(
        mapRoot !== '' ? mapRoot : domRoot !== '' ? domRoot : fallbackRoot,
    );
    let pathname = normalizeOaaoWebassetsRewriteUrl(`${normalizedRoot}/${trimmed}`.replace(/\/{2,}/g, '/'));
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;

    if (typeof window !== 'undefined') {
        return oaaoAbsoluteUrlFromPath(pathname);
    }

    const jsDir = new URL('.', import.meta.url);
    const webassetsRoot = new URL('../', jsDir);

    return normalizeOaaoWebassetsRewriteUrl(new URL(trimmed, webassetsRoot).href);
}
