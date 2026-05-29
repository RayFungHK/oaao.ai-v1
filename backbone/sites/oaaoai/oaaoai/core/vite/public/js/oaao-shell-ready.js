/**
 * Dismiss the full-screen session boot overlay ({@see index.tpl} {@code #oaao-app-boot}).
 */

export function dismissOaaoBootOverlay() {
    document.body.classList.add('oaao-shell-ready');
    const root = document.getElementById('workspace-view');
    if (root instanceof HTMLElement) {
        root.hidden = false;
        root.setAttribute('razyui-cloak', 'ready');
        root.querySelectorAll('[razyui-cloak]:not([razyui-cloak="ready"])').forEach((el) => {
            el.setAttribute('razyui-cloak', 'ready');
        });
    }
    document.dispatchEvent(new CustomEvent('oaao:shell-ready'));
}
