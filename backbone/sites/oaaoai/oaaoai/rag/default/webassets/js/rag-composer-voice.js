/**
 * Chat composer — voice input via ASR proxy ({@code cp.rag.voice_input}).
 *
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} ctx
 */
export function mountRagComposerVoice(host, ctx) {
    const chatFetchJson = ctx.chatFetchJson;
    const chatApiUrl = ctx.chatApiUrl;
    const onText = typeof ctx.onTranscribed === 'function' ? ctx.onTranscribed : () => {};
    const workspaceFields =
        typeof ctx.workspaceChatBodyFields === 'function' ? ctx.workspaceChatBodyFields : () => ({});
    const signal = ctx.signal instanceof AbortSignal ? ctx.signal : undefined;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Voice input';
    btn.setAttribute('aria-label', 'Voice input');
    btn.className =
        'inline-flex items-center justify-center w-8 h-8 p-0 [border:1px_solid_var(--grid-line)] rounded-full bg-transparent fg-[var(--grid-ink-muted)] hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink)] cursor-pointer font-inherit shrink-0';
    btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    /** @type {MediaRecorder | null} */
    let recorder = null;
    /** @type {Blob[]} */
    let chunks = [];
    let recording = false;

    async function stopAndTranscribe() {
        if (!recorder) return;
        recording = false;
        btn.classList.remove('fg-[var(--grid-accent)]');
        const rec = recorder;
        recorder = null;
        await new Promise((resolve) => {
            rec.onstop = () => resolve(undefined);
            try {
                rec.stop();
            } catch {
                resolve(undefined);
            }
        });
        rec.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        chunks = [];
        if (blob.size < 1) return;

        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const b64 = btoa(binary);
        btn.disabled = true;
        try {
            const { res, data } = await chatFetchJson(chatApiUrl('asr_transcribe'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio_base64: b64,
                    mime_type: 'audio/webm',
                    polish_enabled: true,
                    ...workspaceFields(),
                }),
                signal,
            });
            if (!res.ok || !data.success) {
                if (typeof ctx.toast === 'function') ctx.toast(data.message || 'Transcription failed');
                return;
            }
            const text = String(data.data?.text ?? '').trim();
            if (text) onText(text);
        } finally {
            btn.disabled = false;
        }
    }

    btn.addEventListener(
        'click',
        async () => {
            if (recording) {
                await stopAndTranscribe();
                return;
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                if (typeof ctx.toast === 'function') ctx.toast('Microphone not available');
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                chunks = [];
                recorder = new MediaRecorder(stream);
                recorder.ondataavailable = (ev) => {
                    if (ev.data?.size) chunks.push(ev.data);
                };
                recorder.start();
                recording = true;
                btn.classList.add('fg-[var(--grid-accent)]');
            } catch {
                if (typeof ctx.toast === 'function') ctx.toast('Microphone permission denied');
            }
        },
        signal ? { signal } : undefined,
    );

    host.append(btn);
}
