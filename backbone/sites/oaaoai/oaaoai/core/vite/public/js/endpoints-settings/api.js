/** JSON fetch helpers for endpoints / chat APIs from the settings panel. */

function endpointsApiBase() {
    const authBase = (typeof document !== 'undefined' && document.body?.dataset?.authBase || '').trim();
    if (authBase) {
        try {
            const u = new URL(authBase, window.location.href);
            let rootPath = u.pathname.replace(/\/?$/, '');
            rootPath = rootPath.replace(/\/auth$/i, '') || '/';
            if (!rootPath.endsWith('/')) rootPath += '/';

            return `${rootPath}endpoints/api/`;
        } catch {
            /* fall through */
        }
    }

    return '/endpoints/api/';
}

/** @param {string} action */
export function endpointsApiUrl(action) {
    const base = endpointsApiBase();
    return `${base}${action.replace(/^\/+/, '')}`;
}

/** @param {string} action */
export function chatApiUrl(action) {
    const authBase = (typeof document !== 'undefined' && document.body?.dataset?.authBase || '').trim();
    let base = '/chat/api/';
    if (authBase) {
        try {
            const u = new URL(authBase, window.location.href);
            let rootPath = u.pathname.replace(/\/?$/, '');
            rootPath = rootPath.replace(/\/auth$/i, '') || '/';
            if (!rootPath.endsWith('/')) rootPath += '/';
            base = `${rootPath}chat/api/`;
        } catch {
            /* fall through */
        }
    }
    return `${base}${action.replace(/^\/+/, '')}`;
}

/** @param {string} url @param {RequestInit} [options] */
export async function endpointsFetchJson(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(options.headers || {}),
        },
        ...options,
    });
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = {};
    }
    return { res, data };
}
