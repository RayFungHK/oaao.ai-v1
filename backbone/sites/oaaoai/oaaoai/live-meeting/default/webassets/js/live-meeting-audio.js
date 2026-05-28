/**
 * Microphone → 16 kHz mono PCM s16le → WebSocket uplink.
 */

const TARGET_SAMPLE_RATE = 16000;

/**
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function warmLiveMeetingMicPermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
        return { ok: false, reason: 'unsupported' };
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
            },
            video: false,
        });
        stream.getTracks().forEach((tr) => {
            try {
                tr.stop();
            } catch {
                /* ignore */
            }
        });
        return { ok: true };
    } catch (err) {
        const name = err && typeof err === 'object' ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            return { ok: false, reason: 'denied' };
        }
        return { ok: false, reason: 'error' };
    }
}

/** @param {MediaDeviceInfo[]} devices */
export function devicesNeedPermissionUnlock(devices) {
    if (!devices.length) return true;
    return devices.every((d) => !String(d.label || '').trim());
}

/**
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function listLiveMeetingAudioInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) {
        return [];
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(
        (d) =>
            d.kind === 'audioinput'
            && (String(d.deviceId || '').trim() !== '' || String(d.label || '').trim() !== ''),
    );
}

/**
 * @param {Float32Array} floats
 * @returns {ArrayBuffer}
 */
function float32ToPcm16(floats) {
    const buf = new ArrayBuffer(floats.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < floats.length; i += 1) {
        const s = Math.max(-1, Math.min(1, floats[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
}

/**
 * @param {ArrayBuffer[]} pcmChunks
 * @param {number} [sampleRate]
 * @returns {Blob}
 */
function pcm16ChunksToWavBlob(pcmChunks, sampleRate = TARGET_SAMPLE_RATE) {
    const parts = pcmChunks.filter((c) => c && c.byteLength > 0);
    const dataBytes = parts.reduce((n, c) => n + c.byteLength, 0);
    const buf = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buf);
    const writeStr = (offset, str) => {
        for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataBytes, true);
    const out = new Uint8Array(buf);
    let offset = 44;
    for (const chunk of parts) {
        out.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
    }
    return new Blob([buf], { type: 'audio/wav' });
}

/**
 * @param {string} wsUrl ws:// or wss:// orchestrator audio endpoint
 * @param {{ signal?: AbortSignal, deviceId?: string, onState?: (state: string) => void, onError?: (message: string) => void, onLevel?: (level: number) => void, onDevice?: (info: { deviceId: string, label: string }) => void, authToken?: string, recordLocal?: boolean }} [opts]
 * @returns {Promise<{ stop: () => void, ws: WebSocket, deviceId: string, deviceLabel: string, requestBubble: () => void, bubbleLookup: (opts: { text: string, bubble_id?: string }) => void, getRecordingWavBlob: () => Blob | null, getRecordingSeconds: () => number }>}
 */
export async function startLiveMeetingPcmUplink(wsUrl, opts = {}) {
    const { signal, deviceId, onState, onError, onLevel, onDevice, authToken, recordLocal = false } = opts;
    let url = String(wsUrl || '').trim();
    if (!url) {
        throw new Error('ws_audio_url required');
    }

    // W10-S3: if caller supplies an explicit authToken, strip ?token= from the
    // URL so the secret never appears in reverse-proxy access logs, and send
    // it as a first JSON frame after open. The orchestrator hub accepts both
    // modes; callers may upgrade incrementally.
    const firstFrameAuth = typeof authToken === 'string' && authToken.length > 0;
    if (firstFrameAuth) {
        try {
            const u = new URL(url);
            u.searchParams.delete('token');
            url = u.toString();
        } catch (_e) {
            // Non-absolute URL — best-effort regex strip.
            url = url.replace(/([?&])token=[^&]*&?/, (_m, p1) => (p1 === '?' ? '?' : '')).replace(/[?&]$/, '');
        }
    }

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    const setState = (s) => {
        if (typeof onState === 'function') onState(s);
    };
    const fail = (msg) => {
        if (typeof onError === 'function') onError(msg);
    };

    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('WebSocket connect timeout')), 12_000);
        ws.onopen = () => {
            clearTimeout(t);
            if (firstFrameAuth) {
                try {
                    ws.send(JSON.stringify({ type: 'auth', token: authToken }));
                } catch (_e) {
                    fail('ws_auth_send_failed');
                    reject(new Error('ws_auth_send_failed'));
                    return;
                }
            }
            setState('ws_open');
            resolve();
        };
        ws.onerror = () => {
            clearTimeout(t);
            fail('ws_failed');
            reject(new Error('WebSocket failed'));
        };
        ws.onclose = () => {
            setState('ws_closed');
        };
        signal?.addEventListener('abort', () => {
            clearTimeout(t);
            try {
                ws.close();
            } catch {
                /* ignore */
            }
        });
    });

    const audioConstraints = {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
    };
    const pickedDeviceId = String(deviceId || '').trim();
    if (pickedDeviceId) {
        audioConstraints.deviceId = { exact: pickedDeviceId };
    }

    let media;
    try {
        media = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false,
        });
    } catch (err) {
        const name = err && typeof err === 'object' ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            throw new Error('mic_denied');
        }
        if (pickedDeviceId && (name === 'NotFoundError' || name === 'OverconstrainedError')) {
            throw new Error('mic_device_unavailable');
        }
        throw err;
    }

    const audioTrack = media.getAudioTracks()[0];
    const trackSettings = audioTrack?.getSettings?.() || {};
    const activeDeviceId = String(trackSettings.deviceId || pickedDeviceId || '');
    const activeDeviceLabel = String(audioTrack?.label || '').trim();
    if (typeof onDevice === 'function') {
        onDevice({ deviceId: activeDeviceId, label: activeDeviceLabel });
    }

    /** @type {ArrayBuffer[]} */
    const localPcmChunks = [];
    let localPcmBytes = 0;

    const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    if (ctx.state === 'suspended') {
        await ctx.resume();
    }
    const source = ctx.createMediaStreamSource(media);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        const pcm = float32ToPcm16(input);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(pcm);
        }
        if (recordLocal) {
            localPcmChunks.push(pcm.slice(0));
            localPcmBytes += pcm.byteLength;
        }
        if (typeof onLevel === 'function') {
            let sum = 0;
            for (let i = 0; i < input.length; i += 1) {
                sum += input[i] * input[i];
            }
            const rms = Math.sqrt(sum / Math.max(1, input.length));
            onLevel(Math.min(1, rms * 10));
        }
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    setState('mic_open');

    const pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 15_000);

    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;

        clearInterval(pingTimer);
        processor.onaudioprocess = null;
        try {
            processor.disconnect();
        } catch {
            /* ignore */
        }
        try {
            source.disconnect();
        } catch {
            /* ignore */
        }
        media.getTracks().forEach((tr) => {
            try {
                tr.stop();
            } catch {
                /* ignore */
            }
        });
        if (ctx.state !== 'closed') {
            void ctx.close().catch(() => {});
        }
        try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        } catch {
            /* ignore */
        }
        setState('stopped');
    };

    signal?.addEventListener('abort', stop, { once: true });

    const requestBubble = () => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'bubble_request' }));
        }
    };

    const bubbleLookup = ({ text, bubble_id: bubbleId = '' }) => {
        const label = String(text || '').trim();
        if (!label || ws.readyState !== WebSocket.OPEN) return;
        ws.send(
            JSON.stringify({
                type: 'bubble_lookup',
                text: label,
                bubble_id: String(bubbleId || label).slice(0, 64),
            }),
        );
    };

    return {
        stop,
        ws,
        deviceId: activeDeviceId,
        deviceLabel: activeDeviceLabel,
        requestBubble,
        bubbleLookup,
        getRecordingWavBlob: () => (localPcmChunks.length ? pcm16ChunksToWavBlob(localPcmChunks) : null),
        getRecordingSeconds: () => localPcmBytes / (TARGET_SAMPLE_RATE * 2),
    };
}
