/**
 * Ephemeral chat composer attachment upload — shared by file picker and clipboard paste.
 *
 * @param {File | Blob} file
 * @param {Record<string, unknown>} ctx
 */
export async function uploadChatComposerAttachment(file, ctx) {
    const getItems = typeof ctx.getAttachmentItems === 'function' ? ctx.getAttachmentItems : () => [];
    const getCid = typeof ctx.getConversationId === 'function' ? ctx.getConversationId : () => null;
    const chatApiUrl = ctx.chatApiUrl;
    const workspaceFields =
        typeof ctx.workspaceChatBodyFields === 'function' ? ctx.workspaceChatBodyFields : () => ({});
    const onChange = typeof ctx.onAttachmentsChange === 'function' ? ctx.onAttachmentsChange : () => {};
    const signal = ctx.signal instanceof AbortSignal ? ctx.signal : undefined;
    const toast = typeof ctx.toast === 'function' ? ctx.toast : () => {};

    const items = getItems();
    if (items.length >= 4) {
        toast('Maximum 4 attachments per message.');
        return;
    }

    const cid = getCid();
    const fd = new FormData();
    if (cid && cid > 0) {
        fd.append('conversation_id', String(cid));
    }
    const name =
        file instanceof File && file.name
            ? file.name
            : file.type.startsWith('image/')
              ? `pasted-image-${Date.now()}.png`
              : `pasted-file-${Date.now()}`;
    fd.append('file', file instanceof File ? file : new File([file], name, { type: file.type || 'application/octet-stream' }));
    const wf = workspaceFields();
    if (wf.workspace_id != null) fd.append('workspace_id', String(wf.workspace_id));

    const url = typeof chatApiUrl === 'function' ? chatApiUrl('attachment_upload') : '';
    if (!url) {
        toast('Upload unavailable.');
        return;
    }

    const res = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin', signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
        toast(typeof data.message === 'string' && data.message ? data.message : 'Upload failed');
        return;
    }

    const aid = Number(data.data?.attachment_id ?? 0);
    if (aid < 1) return;

    const next = items.slice();
    next.push({
        id: aid,
        file_name: String(data.data?.file_name ?? name),
        mime_type: String(data.data?.mime_type ?? file.type ?? ''),
        kind: String(data.data?.kind ?? 'other'),
        byte_size: Number(data.data?.byte_size ?? file.size ?? 0),
    });
    onChange(next);
}
