/**
 * Chat composer — ephemeral file attachments ({@code cp.rag.attachment}).
 *
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} ctx
 */
export function mountRagComposerAttach(host, ctx) {
    const getCid = typeof ctx.getConversationId === 'function' ? ctx.getConversationId : () => null;
    const chatApiUrl = ctx.chatApiUrl;
    const workspaceFields =
        typeof ctx.workspaceChatBodyFields === 'function' ? ctx.workspaceChatBodyFields : () => ({});
    const onChange = typeof ctx.onAttachmentsChange === 'function' ? ctx.onAttachmentsChange : () => {};
    const signal = ctx.signal instanceof AbortSignal ? ctx.signal : undefined;

    /** @type {number[]} */
    let ids = [];
    /** @type {string[]} */
    let names = [];

    const wrap = document.createElement('span');
    wrap.className = 'inline-flex flex-col items-start min-w-0';

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

    const chips = document.createElement('div');
    chips.className = 'hidden flex flex-wrap gap-1 max-w-full min-w-0 mt-1';
    chips.dataset.oaaoChat = 'attachment-chips';

    function paintChips() {
        chips.replaceChildren();
        if (!names.length) {
            chips.classList.add('hidden');
            return;
        }
        chips.classList.remove('hidden');
        for (const nm of names) {
            const c = document.createElement('span');
            c.className =
                'inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] fg-[var(--grid-ink-muted)] bg-[var(--grid-line)]/30 truncate max-w-[160px]';
            c.textContent = nm;
            c.title = nm;
            chips.append(c);
        }
    }

    async function uploadFile(file) {
        const cid = getCid();
        if (!cid || cid < 1) {
            if (typeof ctx.toast === 'function') ctx.toast('Start or select a conversation first.');
            return;
        }
        if (ids.length >= 4) {
            if (typeof ctx.toast === 'function') ctx.toast('Maximum 4 attachments per message.');
            return;
        }
        const fd = new FormData();
        fd.append('conversation_id', String(cid));
        fd.append('file', file);
        const wf = workspaceFields();
        if (wf.workspace_id != null) fd.append('workspace_id', String(wf.workspace_id));

        const url = chatApiUrl('attachment_upload');
        const res = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin', signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            if (typeof ctx.toast === 'function') ctx.toast(data.message || 'Upload failed');
            return;
        }
        const aid = Number(data.data?.attachment_id ?? 0);
        const fn = String(data.data?.file_name ?? file.name);
        if (aid > 0) {
            ids.push(aid);
            names.push(fn);
            onChange(ids.slice(), fn);
            paintChips();
        }
    }

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
            void Promise.all(files.slice(0, 4 - ids.length).map((f) => uploadFile(f)));
        },
        signal ? { signal } : undefined,
    );

    wrap.append(btn, input, chips);
    host.append(wrap);
}
