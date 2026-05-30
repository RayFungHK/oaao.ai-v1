/**
 * Todo API URL helper — kept for conversation-todo-thread.js.
 *
 * @module conversation-todo-suggest
 */

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

/**
 * @param {string} path
 */
export function todoApiUrl(path) {
    const base = `${mountPrefix()}/todo/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

export default { todoApiUrl };
