/**
 * JIT hydrate for live-meeting panel fragments ({@see workspace.js} shell loader).
 */

function liveMeetingRazyUrl() {
    const prefix = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    return `${prefix}/webassets/core/default/razyui/razyui.js`.replace(/\/{2,}/g, '/');
}

/** @param {ParentNode | null | undefined} mount */
export async function hydrateLiveMeetingJit(mount) {
    if (!mount) return;
    try {
        const R = await import(/* webpackIgnore: true */ liveMeetingRazyUrl());
        const JIT = (R?.default ?? R)?.JIT;
        const root =
            mount instanceof HTMLElement && typeof mount.closest === 'function'
                ? mount.closest('.oaao-live-meeting-root')
                : null;
        if (JIT && typeof JIT.hydrate === 'function') {
            JIT.hydrate(root ?? mount);
        }
    } catch {
        /* optional */
    }
}
