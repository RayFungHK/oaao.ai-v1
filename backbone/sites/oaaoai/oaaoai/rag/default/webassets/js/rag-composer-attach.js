/**
 * Chat composer — ephemeral file attachments ({@code cp.rag.attachment}).
 */

import { uploadChatComposerAttachment } from './chat-composer-attach-upload.js';

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} ctx
 */
export function mountRagComposerAttach(host, ctx) {
    const signal = ctx.signal instanceof AbortSignal ? ctx.signal : undefined;

    const wrap = document.createElement('span');
    wrap.className = 'inline-flex shrink-0 items-center';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Attach file';
    btn.setAttribute('aria-label', 'Attach file');
    btn.className =
        'inline-flex items-center justify-center w-8 h-8 p-0 [border:1px_solid_var(--grid-line)] rounded-full bg-transparent fg-[var(--grid-ink-muted)] hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink)] cursor-pointer font-inherit shrink-0';
    btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    input.multiple = true;
    input.accept =
        'image/*,audio/*,application/pdf,text/*,application/json,.docx,.xlsx,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation';

    btn.addEventListener(
        'click',
        () => input.click(),
        signal ? { signal } : undefined,
    );
    input.addEventListener(
        'change',
        () => {
            const files = input.files ? [...input.files] : [];
            input.value = '';
            const getItems = typeof ctx.getAttachmentItems === 'function' ? ctx.getAttachmentItems : () => [];
            const room = Math.max(0, 4 - getItems().length);
            void Promise.all(files.slice(0, room).map((f) => uploadChatComposerAttachment(f, ctx)));
        },
        signal ? { signal } : undefined,
    );

    wrap.append(btn, input);
    host.append(wrap);
}

export { uploadChatComposerAttachment };
