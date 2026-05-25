/**
 * Chat composer — voice input via ASR proxy ({@code cp.rag.voice_input}).
 */
import { mountComposerDropupAbove, renderComposerDropupEmpty, renderComposerDropupOptions } from '../../../chat/default/js/composer-dropup.js';

const STORAGE_KEY = 'oaao_chat_composer_audio_input';

/** @param {string} key @param {string} [fallback] */
function t(key, fallback = '') {
    const fn = typeof globalThis.oaaoT === 'function' ? globalThis.oaaoT : null;
    if (fn) {
        const hit = fn(key);
        if (hit && hit !== key) return hit;
    }
    return fallback || key;
}

/** @returns {Promise<MediaDeviceInfo[]>} */
async function listAudioInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
}

/** @returns {string} */
function readStoredDeviceId() {
    try {
        return String(sessionStorage.getItem(STORAGE_KEY) || '').trim();
    } catch {
        return '';
    }
}

/**
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

    const btnClass =
        'inline-flex items-center justify-center w-8 h-8 p-0 [border:1px_solid_var(--grid-line)] rounded-full bg-transparent fg-[var(--grid-ink-muted)] hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink)] cursor-pointer font-inherit shrink-0';

    const root = document.createElement('div');
    root.className = 'shrink-0';
    root.dataset.oaaoComposerVoice = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = t('live_meeting.start_mic', 'Voice input');
    btn.setAttribute('aria-label', t('live_meeting.start_mic', 'Voice input'));
    btn.className = btnClass;
    btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    root.append(btn);
    host.append(root);

    const menuLabel = t('live_meeting.audio_input.label', 'Audio input');
    const dropup = mountComposerDropupAbove(root, btn, {
        signal,
        menuLabel,
        heading: menuLabel,
    });

    /** @type {MediaRecorder | null} */
    let recorder = null;
    /** @type {Blob[]} */
    let chunks = [];
    let recording = false;
    /** @type {{ deviceId: string, label: string }[]} */
    let deviceRows = [];
    let selectedDeviceId = readStoredDeviceId();
    let micPermissionDenied = false;

    function persistDeviceId(deviceId) {
        selectedDeviceId = String(deviceId || '').trim();
        try {
            if (selectedDeviceId) sessionStorage.setItem(STORAGE_KEY, selectedDeviceId);
            else sessionStorage.removeItem(STORAGE_KEY);
        } catch {
            /* ignore */
        }
        syncArrowTitle();
    }

    function selectedLabel() {
        if (!selectedDeviceId) return t('live_meeting.audio_input.default', 'System default');
        const hit = deviceRows.find((row) => row.deviceId === selectedDeviceId);
        return hit?.label || t('live_meeting.audio_input.unknown', 'Microphone', { n: '?' });
    }

    function syncArrowTitle() {
        const summary = `${menuLabel}: ${selectedLabel()}`;
        dropup.arrowBtn.title = summary;
        dropup.arrowBtn.setAttribute('aria-label', summary);
    }

    async function refreshDevices({ warmPermission = false } = {}) {
        micPermissionDenied = false;
        let devices = await listAudioInputs();
        if (warmPermission && devices.every((d) => !String(d.label || '').trim())) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach((track) => track.stop());
            } catch {
                micPermissionDenied = true;
                deviceRows = [];
                syncArrowTitle();
                return;
            }
            devices = await listAudioInputs();
        }
        deviceRows = devices
            .filter((device) => String(device.deviceId || '').trim() !== '')
            .map((device, index) => ({
                deviceId: device.deviceId,
                label:
                    String(device.label || '').trim()
                    || t('live_meeting.audio_input.unknown', 'Microphone {{n}}', { n: String(index + 1) }),
            }));
        const stored = readStoredDeviceId();
        if (selectedDeviceId && !deviceRows.some((row) => row.deviceId === selectedDeviceId)) {
            selectedDeviceId = stored && deviceRows.some((row) => row.deviceId === stored) ? stored : '';
        }
        syncArrowTitle();
    }

    function renderDevicePanel() {
        /** @type {Array<{ id: string, label: string }>} */
        const rows = [{ id: '', label: t('live_meeting.audio_input.default', 'System default') }, ...deviceRows];
        if (deviceRows.length === 0 && micPermissionDenied) {
            renderComposerDropupEmpty(
                dropup.list,
                t(
                    'live_meeting.audio_input.permission_denied',
                    'Microphone access denied — allow mic in browser settings.',
                ),
            );
            return;
        }
        renderComposerDropupOptions(
            dropup.list,
            rows,
            selectedDeviceId,
            (id) => {
                if (recording) return;
                persistDeviceId(id);
                dropup.close();
            },
            { disabled: recording },
        );
    }

    dropup.arrowBtn.addEventListener(
        'click',
        () => {
            if (recording) return;
            void refreshDevices({ warmPermission: true }).then(renderDevicePanel);
        },
        signal ? { signal } : undefined,
    );

    async function stopAndTranscribe() {
        if (!recorder) return;
        recording = false;
        btn.classList.remove('fg-[var(--grid-accent)]');
        dropup.arrowBtn.disabled = false;
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
        rec.stream.getTracks().forEach((track) => track.stop());
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
                /** @type {MediaTrackConstraints | boolean} */
                let audio = true;
                if (selectedDeviceId) {
                    audio = { deviceId: { exact: selectedDeviceId } };
                }
                const stream = await navigator.mediaDevices.getUserMedia({ audio });
                chunks = [];
                recorder = new MediaRecorder(stream);
                recorder.ondataavailable = (ev) => {
                    if (ev.data?.size) chunks.push(ev.data);
                };
                recorder.start();
                recording = true;
                dropup.arrowBtn.disabled = true;
                dropup.close();
                btn.classList.add('fg-[var(--grid-accent)]');
            } catch {
                if (typeof ctx.toast === 'function') ctx.toast('Microphone permission denied');
            }
        },
        signal ? { signal } : undefined,
    );

    if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
            void refreshDevices();
        });
    }

    void refreshDevices();
}
