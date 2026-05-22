/**
 * Microphone → 16 kHz mono PCM s16le → WebSocket uplink.
 */

const TARGET_SAMPLE_RATE = 16000;

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
 * @param {string} wsUrl ws:// or wss:// orchestrator audio endpoint
 * @param {{ signal?: AbortSignal, onState?: (state: string) => void, onError?: (message: string) => void }} [opts]
 * @returns {Promise<{ stop: () => void, ws: WebSocket }>}
 */
export async function startLiveMeetingPcmUplink(wsUrl, opts = {}) {
    const { signal, onState, onError } = opts;
    const url = String(wsUrl || '').trim();
    if (!url) {
        throw new Error('ws_audio_url required');
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

    let media;
    try {
        media = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
            },
            video: false,
        });
    } catch (err) {
        const name = err && typeof err === 'object' ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            throw new Error('mic_denied');
        }
        throw err;
    }

    const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    const source = ctx.createMediaStreamSource(media);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (ev) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = ev.inputBuffer.getChannelData(0);
        ws.send(float32ToPcm16(input));
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    setState('mic_open');

    const pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 15_000);

    const stop = () => {
        clearInterval(pingTimer);
        processor.disconnect();
        source.disconnect();
        media.getTracks().forEach((tr) => tr.stop());
        void ctx.close();
        try {
            ws.close();
        } catch {
            /* ignore */
        }
        setState('stopped');
    };

    signal?.addEventListener('abort', stop, { once: true });

    return { stop, ws };
}
