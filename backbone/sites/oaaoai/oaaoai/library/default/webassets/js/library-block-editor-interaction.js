/**
 * Library BlockEditor — Notion-like handle: click = menu, drag = reorder.
 * Arms pointer capture early so pointermove reaches document listeners inside scroll parents.
 *
 * @param {HTMLElement} editorMount — `.oaao-library-block-editor-mount`
 */
export function installLibraryBlockEditorInteraction(editorMount) {
    if (!(editorMount instanceof HTMLElement)) return;

    const content = editorMount.querySelector('.block-editor-content');
    if (!(content instanceof HTMLElement)) return;

    content.addEventListener(
        'pointerdown',
        (ev) => {
            const handle = ev.target instanceof Element ? ev.target.closest('.block-handle') : null;
            if (!(handle instanceof HTMLElement)) return;
            if (ev.button !== 0) return;

            try {
                handle.setPointerCapture(ev.pointerId);
            } catch {
                /* ignore */
            }

            handle.classList.add('is-handle-active');
            const onUp = () => {
                handle.classList.remove('is-handle-active');
                try {
                    if (handle.hasPointerCapture(ev.pointerId)) {
                        handle.releasePointerCapture(ev.pointerId);
                    }
                } catch {
                    /* ignore */
                }
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        },
        true,
    );
}
