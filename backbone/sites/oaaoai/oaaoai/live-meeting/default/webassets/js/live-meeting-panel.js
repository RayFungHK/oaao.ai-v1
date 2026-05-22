/**
 * Live meeting workspace panel — session_start, WS PCM uplink, SSE placeholder (Phase C transcript).
 */
import { startLiveMeetingPcmUplink } from './live-meeting-audio.js';

const OAAO_LIVE_MEETING_CSS = '/webassets/live-meeting/default/css/live-meeting.css';

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

export function mountLiveMeetingPanel(mount, { signal } = {}) {
    if (!(mount instanceof HTMLElement)) return;

    const statusEl = mount.querySelector('[data-oaao-live-meeting="status"]');
    const connEl = mount.querySelector('[data-oaao-live-meeting="connections"]');
    const transcriptEl = mount.querySelector('[data-oaao-live-meeting="transcript"]');
    const micBtn = mount.querySelector('[data-oaao-live-meeting="mic"]');

    let sessionId = '';
    let eventSource = null;
    /** @type {{ stop?: () => void } | null} */
    let uplink = null;

    const setStatus = (text) => {
        if (statusEl) statusEl.textContent = text;
    };
    const setConn = (text) => {
        if (connEl) connEl.textContent = text;
    };

    const stopAll = () => {
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
            micBtn.textContent = 'Start microphone';
        }
        setStatus('Idle');
        setConn('');
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
            setStatus('Error');
            setConn(data?.message || `HTTP ${res.status}`);
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
                if (!transcriptEl || !payload) return;
                if (payload.kind === 'live_transcript' && payload.text) {
                    const line = document.createElement('p');
                    const isFinal = payload.payload?.is_final !== false;
                    line.className = isFinal
                        ? 'm-0 mb-2 text-sm fg-[var(--grid-ink)]'
                        : 'm-0 mb-1 text-sm fg-[var(--grid-ink-muted)] italic';
                    line.textContent = payload.text;
                    line.dataset.oaaoLiveSegment = String(payload.payload?.segment ?? '');
                    transcriptEl.append(line);
                    transcriptEl.scrollTop = transcriptEl.scrollHeight;
                    return;
                }
                if (payload.phase === 'system' && payload.kind === 'status') {
                    setConn(payload.text || 'connected');
                    return;
                }
                if (payload.kind === 'error' && payload.text) {
                    const errLine = document.createElement('p');
                    errLine.className = 'm-0 mb-2 text-xs fg-[var(--grid-danger,#c00)]';
                    errLine.textContent = payload.text;
                    transcriptEl.append(errLine);
                }
            } catch {
                /* ignore */
            }
        });
        eventSource.onerror = () => setConn((c) => `${c} · SSE reconnecting…`.trim());
    };

    if (micBtn instanceof HTMLButtonElement) {
        micBtn.addEventListener(
            'click',
            async () => {
                if (micBtn.dataset.oaaoLiveRecording === '1') {
                    if (sessionId) {
                        await liveMeetingFetchJson('session_stop', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ session_id: sessionId, keep_audio: false }),
                            signal,
                        });
                    }
                    stopAll();
                    return;
                }
                setStatus('Starting…');
                const data = await startSession();
                if (!data) return;
                sessionId = String(data.session_id || '');
                setStatus('Recording');
                const wsUrl =
                    data.ws_audio_url_ws ||
                    (data.ws_audio_url
                        ? String(data.ws_audio_url).replace(/^http/i, 'ws')
                        : '');
                micBtn.dataset.oaaoLiveRecording = '1';
                micBtn.textContent = 'Stop';
                try {
                    uplink = await startLiveMeetingPcmUplink(wsUrl, {
                        signal,
                        onState: (s) => setConn(`WS: ${s}`),
                    });
                } catch (err) {
                    setStatus('Error');
                    setConn(err?.message || 'Microphone / WS failed');
                    delete micBtn.dataset.oaaoLiveRecording;
                    micBtn.textContent = 'Start microphone';
                    return;
                }
                if (data.stream_url) {
                    const u = new URL(data.stream_url, window.location.href);
                    if (data.stream_token) {
                        u.searchParams.set('token', data.stream_token);
                    }
                    openSse(u.href);
                    setConn((t) => `${t} · SSE connected`.trim());
                }
            },
            { signal },
        );
    }

    signal?.addEventListener('abort', () => {
        if (sessionId) {
            void liveMeetingFetchJson('session_stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId, keep_audio: false }),
            });
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
    mountLiveMeetingPanel(mount, opts);
}
