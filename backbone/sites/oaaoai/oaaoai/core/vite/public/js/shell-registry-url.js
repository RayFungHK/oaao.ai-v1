/**
 * Normalizes registry URLs ({@code shell_panel_url}, {@code panel_js_module}, …) for subdirectory installs.
 * PHP embeds {@code data-oaao-mount-prefix} from {@code RELATIVE_ROOT}; paths from the server are root-relative
 * (e.g. {@code /webassets/chat/default/js/chat-panel.js}) and must be prefixed when the app lives under {@code /backbone}.
 *
 * {@link backbone/.htaccess}: {@code /webassets/{dist}/{version}/X} → {@code sites/…/{dist}/{version}/webassets/X}.
 * The URL must **never** contain {@code /{version}/webassets/} — that duplicates the on-disk {@code webassets/} directory
 * (404 / wrong fetches). {@link normalizeOaaoWebassetsRewriteUrl} collapses that mistake for {@code core|chat|endpoints|vault}.
 *
 * Embedded previews (Cursor Simple Browser) often mishandle root-relative strings passed to dynamic {@code import()};
 * {@link resolveShellRegistryUrl} therefore prefers absolute {@code http(s):} URLs built from the **browser** origin only
 * (never PHP {@code getSiteURL()} internal hosts like {@code http://web}).
 */

/** @returns {string} e.g. {@code "/backbone"} or {@code ""} when mounted at site root */
export function getOaaoMountPrefixPath() {
    const raw = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    if (!raw || raw === '/') return '';
    const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
    return withSlash.replace(/\/{2,}/g, '/').replace(/\/$/, '');
}

/**
 * HTTP(S) origin from the active browsing context — **not** PHP {@code getSiteURL()} (Docker service hostname).
 * Embedded previews may expose opaque {@code blob:} frames where {@code location.origin} is useless; uses
 * {@code ancestorOrigins}, {@code document.baseURI}, then parent/top {@code Location}.
 *
 * @returns {string} e.g. {@code "http://localhost:8080"} or {@code ""}
 */
export function browserHttpOrigin() {
    if (typeof window === 'undefined') return '';

    try {
        const loc = /** @type {Location & { ancestorOrigins?: DOMStringList }} */ (window.location);
        if (loc.ancestorOrigins && loc.ancestorOrigins.length > 0) {
            const first = String(loc.ancestorOrigins[0] ?? '').trim();
            if (first && /^https?:\/\//i.test(first)) {
                return new URL(first).origin;
            }
        }
    } catch {
        //
    }

    if (window.location) {
        const o = window.location.origin;
        if (o && o !== 'null') return o;
        try {
            const u = new URL(window.location.href);
            if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
        } catch {
            //
        }
    }

    try {
        if (typeof document !== 'undefined' && document.baseURI) {
            const u = new URL(document.baseURI);
            if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
        }
    } catch {
        //
    }

    try {
        if (typeof document !== 'undefined' && document.URL) {
            const u = new URL(document.URL);
            if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
        }
    } catch {
        //
    }

    try {
        if (window.parent !== window) {
            const u = new URL(window.parent.location.href);
            if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
        }
    } catch {
        //
    }
    try {
        if (window.top !== window) {
            const u = new URL(window.top.location.href);
            if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
        }
    } catch {
        //
    }

    return '';
}

/**
 * Collapse erroneous {@code /webassets/{dist}/{version}/webassets/…} segments — Apache already maps {@code …/{version}/…}
 * onto the module's {@code webassets/} folder ({@see backbone/.htaccess}).
 *
 * @param {string} pathOrUrl pathname or full {@code http(s)} URL
 * @returns {string}
 */
export function normalizeOaaoWebassetsRewriteUrl(pathOrUrl) {
    const normalizePath = (value) => {
        let s = String(value ?? '').replace(/\/{2,}/g, '/');
        const dup = /\/webassets\/(core|chat|endpoints|vault)\/([^/]+)\/webassets(?:\/|$)/;
        while (dup.test(s)) {
            s = s.replace(dup, '/webassets/$1/$2/');
        }

        /** When import maps fail ({@code razyui} bare specifier resolves under {@code js/}); on-disk bundle is sibling {@code …/razyui/}. */
        s = s.replace(/(\/webassets\/core\/[^/]+)\/js\/razyui\//gi, '$1/razyui/');

        return s.replace(/\/{2,}/g, '/');
    };

    const raw = String(pathOrUrl ?? '');
    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw);
            u.pathname = normalizePath(u.pathname);

            return u.href;
        } catch {
            // Fall through to path-only normalization.
        }
    }

    let s = normalizePath(raw);
    return s;
}

/**
 * Turn a root-relative pathname ({@code /webassets/…}) into an absolute same-origin URL using {@link browserHttpOrigin}.
 *
 * @param {string} pathQueryHash pathname + optional search/hash (starts with {@code /})
 * @returns {string}
 */
export function oaaoAbsoluteUrlFromPath(pathQueryHash) {
    const pq = String(pathQueryHash ?? '').trim();
    if (!pq) return pq;
    if (/^https?:\/\//i.test(pq)) {
        return normalizeOaaoWebassetsRewriteUrl(pq);
    }

    let out = pq;
    const origin = browserHttpOrigin();
    if (origin && pq.startsWith('/')) {
        try {
            out = new URL(pq, origin).href;
        } catch {
            out = pq;
        }
    } else if (typeof document !== 'undefined' && document.baseURI && pq.startsWith('/')) {
        try {
            const abs = new URL(pq, document.baseURI).href;
            if (/^https?:\/\//i.test(abs)) out = abs;
        } catch {
            //
        }
    }

    return normalizeOaaoWebassetsRewriteUrl(out);
}

/**
 * @param {string} pathOnly absolute path beginning with {@code /}
 * @returns {string}
 */
export function applyOaaoMountPrefix(pathOnly) {
    const prefix = getOaaoMountPrefixPath();
    if (!prefix || !pathOnly.startsWith('/')) return pathOnly;
    if (pathOnly === prefix || pathOnly.startsWith(`${prefix}/`)) return pathOnly;
    return `${prefix}${pathOnly}`;
}

/**
 * Absolute same-origin URL suitable for {@code fetch()} / dynamic {@code import()} (embedded previews included).
 *
 * @param {string} spec
 * @returns {string}
 */
export function resolveShellRegistryUrl(spec) {
    const s = String(spec ?? '').trim();
    if (!s) return '';

    if (/^(?:https?:)?\/\//i.test(s)) {
        try {
            const u = new URL(s, window.location.href);
            const page = new URL(window.location.href);
            if (u.origin !== page.origin) {
                return u.href;
            }

            const pathQueryHash = `${u.pathname}${u.search}${u.hash}`;

            return oaaoAbsoluteUrlFromPath(pathQueryHash);
        } catch {
            return s;
        }
    }

    const candidate = s.startsWith('/') ? s : `/${s}`;
    const pathPrefixed = applyOaaoMountPrefix(candidate);

    try {
        const u = new URL(pathPrefixed, window.location.href);
        const pathQueryHash = `${u.pathname}${u.search}${u.hash}`;

        return oaaoAbsoluteUrlFromPath(pathQueryHash);
    } catch {
        return oaaoAbsoluteUrlFromPath(pathPrefixed);
    }
}

/**
 * Append shell ESM cache-bust ({@code data-oaao-shell-esm-v}) so embedded previews reload dynamic {@code import()} graphs after edits.
 *
 * @param {string} url from {@link resolveShellRegistryUrl}
 * @returns {string}
 */
export function oaaoAppendShellEsmV(url) {
    const u = String(url ?? '').trim();
    const v = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
    if (!u || !v) return u;
    const join = u.includes('?') ? '&' : '?';

    return normalizeOaaoWebassetsRewriteUrl(`${u}${join}v=${encodeURIComponent(v)}`);
}
