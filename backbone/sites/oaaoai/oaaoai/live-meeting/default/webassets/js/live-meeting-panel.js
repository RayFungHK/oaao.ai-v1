/**
 * Live meeting workspace panel — session_start, WS PCM uplink, SSE live_transcript.
 */
import { startLiveMeetingPcmUplink } from './live-meeting-audio.js';

const OAAO_LIVE_MEETING_CSS = '/webassets/live-meeting/default/css/live-meeting.css';
const OAAO_I18N_URL = '/webassets/core/default/js/oaao-i18n.js';

/** @type {((key: string, vars?: Record<string, string>) => string) | null} */
let liveT = null;

async function ensureLiveMeetingI18n() {
    if (liveT) return liveT;
    try {
        const prefix = document.documentElement?.dataset?.oaaoMountPrefix || '';
        const url = `${prefix}${OAAO_I18N_URL}`.replace(/\/{2,}/g, '/');
        const m = await import(/* webpackIgnore: true */ url);
        if (typeof m.oaaoT === 'function') {
            liveT = m.oaaoT;
            return liveT;
        }
    } catch {
        /* fallback below */
    }
    liveT = (key, vars = {}) => {
        let s = key;
        Object.entries(vars).forEach(([k, v]) => {
            s = s.split(`{{${k}}}`).join(String(v));
        });
        return s;
    };
    return liveT;
}

function liveMeetingApiUrl(path) {
    const prefix = document.documentElement?.dataset?.oaaoMountPrefix || '';
    const base = `${prefix}/live-meeting/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

async function liveMeetingFetchJson(path, options = {}) {
    const res = await fetch(liveMeetingApiUrl(path), {
        credentials: 'include',
        headers: { Accept: 'application/json', ...(options.headers || {}) },
        ...options,
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    return { res, data };
}

function workspaceIdFromDom() {
    const raw = document.documentElement?.dataset?.oaaoWorkspaceId
        || document.querySelector('[data-oaao-workspace-id]')?.getAttribute('data-oaao-workspace-id');
    const n = Number(raw || 0);
    return n > 0 ? n : null;
}

/** Map orchestrator ASR error codes to i18n keys. */
function asrErrorMessage(code, t) {
    const c = String(code || '').trim();
    if (c === 'asr_not_configured') return t('live_meeting.error.asr_not_configured');
    return c;
}

export function mountLiveMeetingPanel(mount, { signal } = {}) {
    if (!(mount instanceof HTMLElement)) return;

    const statusEl = mount.querySelector('[data-oaao-live-meeting="status"]');
    const connEl = mount.querySelector('[data-oaao-live-meeting="connections"]');
    const transcriptEl = mount.querySelector('[data-oaao-live-meeting="transcript"]');
    const micBtn = mount.querySelector('[data-oaao-live-meeting="mic"]');
    const keepWrap = mount.querySelector('[data-oaao-live-meeting="keep-audio-wrap"]');
    const keepInput = mount.querySelector('[data-oaao-live-meeting="keep-audio"]');
    const emptyEl = transcriptEl?.querySelector('.oaao-live-transcript-empty');

    let sessionId = '';
    let eventSource = null;
    /** @type {{ stop?: () => void } | null} */
    let uplink = null;
    /** @type {((key: string, vars?: Record<string, string>) => string)} */
    let t = (k) => k;

    void ensureLiveMeetingI18n().then((fn) => {
        t = fn;
        if (statusEl && !sessionId) statusEl.textContent = t('live_meeting.status.idle');
        if (micBtn instanceof HTMLButtonElement && micBtn.dataset.oaaoLiveRecording !== '1') {
            const label = micBtn.querySelector('[data-i18n], span') || micBtn;
            if (label instanceof HTMLElement) label.textContent = t('live_meeting.start_mic');
        }
    });

    const setStatus = (key) => {
        if (statusEl) statusEl.textContent = t(key);
    };
    const setConn = (keyOrText, { raw = false } = {}) => {
        if (!connEl) return;
        connEl.textContent = raw ? String(keyOrText) : t(keyOrText);
    };

    const hideEmptyPlaceholder = () => {
        if (emptyEl) emptyEl.classList.add('is-hidden');
    };

    const showEmptyPlaceholder = () => {
        if (emptyEl) emptyEl.classList.remove('is-hidden');
    };

    const upsertTranscriptLine = (payload) => {
        if (!transcriptEl || !payload?.text) return;
        hideEmptyPlaceholder();
        const seg = String(payload.payload?.segment ?? '');
        const isFinal = payload.payload?.is_final !== false;
        let line = seg
            ? transcriptEl.querySelector(`[data-oaao-live-segment="${seg}"]`)
            : null;
        if (!line) {
            line = document.createElement('p');
            line.className = 'oaao-live-transcript-line m-0 mb-2 text-sm';
            if (seg) line.dataset.oaaoLiveSegment = seg;
            transcriptEl.append(line);
        }
        line.textContent = payload.text;
        line.classList.toggle('is-partial', !isFinal);
        line.classList.toggle('is-final', isFinal);
        line.classList.toggle('fg-[var(--grid-ink)]', isFinal);
        line.classList.toggle('fg-[var(--grid-ink-muted)]', !isFinal);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    };

    const appendErrorLine = (text) => {
        if (!transcriptEl) return;
        hideEmptyPlaceholder();
        const line = document.createElement('p');
        line.className = 'oaao-live-transcript-line is-error m-0 mb-2';
        line.textContent = text;
        transcriptEl.append(line);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    };

    const stopAll = ({ clearTranscript = false } = {}) => {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        if (uplink?.stop) {
            uplink.stop();
            uplink = null;
        }
        if (micBtn instanceof HTMLButtonElement) {
            delete micBtn.dataset.oaaoLiveRecording;
            const label = micBtn.querySelector('span') || micBtn;
            label.textContent = t('live_meeting.start_mic');
        }
        if (keepWrap instanceof HTMLElement) {
            keepWrap.classList.remove('is-visible');
            keepWrap.classList.add('hidden');
        }
        if (keepInput instanceof HTMLInputElement) {
            keepInput.checked = false;
        }
        setStatus('live_meeting.status.idle');
        setConn('', { raw: true });
        if (clearTranscript && transcriptEl) {
            transcriptEl.querySelectorAll('.oaao-live-transcript-line').forEach((n) => n.remove());
            showEmptyPlaceholder();
        }
        sessionId = '';
    };

    const stopSession = async (keepAudio) => {
        if (!sessionId) return;
        setStatus('live_meeting.status.stopping');
        await liveMeetingFetchJson('session_stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, keep_audio: !!keepAudio }),
            signal,
        });
    };

    const startSession = async () => {
        const { res, data } = await liveMeetingFetchJson('session_start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cadence: '1v1',
                workspace_id: workspaceIdFromDom(),
                retention_mode: 'disk_ttl',
            }),
            signal,
        });
        if (!res.ok || !data?.success || !data?.data?.session_id) {
            setStatus('live_meeting.status.error');
            setConn(t('live_meeting.error.session_start'), { raw: true });
            if (data?.message) appendErrorLine(String(data.message));
            return null;
        }
        return data.data;
    };

    const openSse = (streamUrl) => {
        if (!streamUrl) return;
        eventSource = new EventSource(streamUrl, { withCredentials: false });
        eventSource.addEventListener('oaao.stream', (ev) => {
            try {
                const payload = JSON.parse(ev.data || '{}');
                if (!payload) return;
                if (payload.kind === 'live_transcript') {
                    upsertTranscriptLine(payload);
                    return;
                }
                if (payload.phase === 'system' && payload.kind === 'status') {
                    if (payload.text === 'live_meeting_ready') {
                        setConn('live_meeting.conn.sse_connected');
                    }
                    return;
                }
                if (payload.kind === 'error' && payload.text) {
                    appendErrorLine(asrErrorMessage(payload.text, t));
                }
            } catch {
                /* ignore */
            }
        });
        eventSource.onerror = () => setConn('live_meeting.conn.sse_reconnecting');
    };

    if (micBtn instanceof HTMLButtonElement) {
        micBtn.addEventListener(
            'click',
            async () => {
                if (micBtn.dataset.oaaoLiveRecording === '1') {
                    const keepAudio = keepInput instanceof HTMLInputElement && keepInput.checked;
                    await stopSession(keepAudio);
                    stopAll();
                    return;
                }
                setStatus('live_meeting.status.starting');
                const data = await startSession();
                if (!data) return;
                sessionId = String(data.session_id || '');
                setStatus('live_meeting.status.recording');
                if (keepWrap instanceof HTMLElement) {
                    keepWrap.classList.remove('hidden');
                    keepWrap.classList.add('is-visible');
                }
                const wsUrl =
                    data.ws_audio_url_ws ||
                    (data.ws_audio_url
                        ? String(data.ws_audio_url).replace(/^http/i, 'ws')
                        : '');
                const label = micBtn.querySelector('span') || micBtn;
                micBtn.dataset.oaaoLiveRecording = '1';
                label.textContent = t('live_meeting.stop_mic');
                try {
                    uplink = await startLiveMeetingPcmUplink(wsUrl, {
                        signal,
                        onState: (s) => {
                            if (s === 'ws_open') setConn('live_meeting.conn.ws_open');
                            if (s === 'ws_closed') setConn('live_meeting.conn.ws_closed');
                        },
                        onError: (code) => {
                            if (code === 'ws_failed') setConn('live_meeting.conn.ws_failed');
                        },
                    });
                } catch (err) {
                    const msg = String(err?.message || '');
                    setStatus('live_meeting.status.error');
                    if (msg === 'mic_denied') {
                        setConn('live_meeting.error.mic_denied');
                    } else {
                        setConn('live_meeting.error.mic_ws');
                    }
                    await stopSession(false);
                    stopAll();
                    return;
                }
                if (data.stream_url) {
                    const u = new URL(data.stream_url, window.location.href);
                    if (data.stream_token) {
                        u.searchParams.set('token', data.stream_token);
                    }
                    openSse(u.href);
                }
            },
            { signal },
        );
    }

    signal?.addEventListener('abort', () => {
        if (sessionId) {
            void stopSession(false);
        }
        stopAll();
    });
}

export default function init(mount, opts) {
    if (!document.querySelector(`link[href="${OAAO_LIVE_MEETING_CSS}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = OAAO_LIVE_MEETING_CSS;
        document.head.append(link);
    }
    void ensureLiveMeetingI18n();
    mountLiveMeetingPanel(mount, opts);
}
