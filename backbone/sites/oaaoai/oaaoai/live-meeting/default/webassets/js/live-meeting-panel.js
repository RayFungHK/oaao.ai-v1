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
    const bubblesWrapEl = mount.querySelector('[data-oaao-live-meeting="bubbles-wrap"]');
    const bubblesEl = mount.querySelector('[data-oaao-live-meeting="bubbles"]');
    const materialsWrapEl = mount.querySelector('[data-oaao-live-meeting="materials-wrap"]');
    const materialsEl = mount.querySelector('[data-oaao-live-meeting="materials"]');
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

    /** @type {Set<string>} */
    const seenBubbleIds = new Set();

    const addBubbleChip = (payload) => {
        if (!bubblesEl || !payload?.text) return;
        const bubbleId = String(payload.payload?.bubble_id || payload.text || '').trim();
        if (bubbleId && seenBubbleIds.has(bubbleId)) return;
        if (bubbleId) seenBubbleIds.add(bubbleId);
        if (bubblesWrapEl instanceof HTMLElement) {
            bubblesWrapEl.classList.remove('hidden');
            bubblesWrapEl.classList.add('flex');
        }
        const type = String(payload.payload?.bubble_type || 'keyword');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'oaao-live-bubble-chip inline-flex max-w-full items-center rounded-full border border-[var(--grid-line)] bg-[var(--grid-panel)] px-3 py-1 text-xs fg-[var(--grid-ink)] cursor-pointer hover:bg-[var(--grid-panel-bright)]';
        btn.dataset.oaaoLiveBubbleType = type;
        if (bubbleId) btn.dataset.oaaoLiveBubbleId = bubbleId;
        btn.textContent = String(payload.text);
        btn.title =
            type === 'question' ? t('live_meeting.bubble.question_hint') : t('live_meeting.bubble.keyword_hint');
        btn.addEventListener(
            'click',
            () => {
                setStatus('live_meeting.status.rag_lookup');
                if (uplink?.bubbleLookup) {
                    uplink.bubbleLookup({
                        text: String(payload.text || btn.textContent || ''),
                        bubble_id: bubbleId,
                    });
                }
            },
            { signal },
        );
        bubblesEl.append(btn);
    };

    const clearBubbles = () => {
        seenBubbleIds.clear();
        if (bubblesEl) bubblesEl.textContent = '';
        if (bubblesWrapEl instanceof HTMLElement) {
            bubblesWrapEl.classList.add('hidden');
            bubblesWrapEl.classList.remove('flex');
        }
    };

    const renderMaterials = (payload) => {
        if (!materialsEl) return;
        const rows = Array.isArray(payload?.payload?.materials) ? payload.payload.materials : [];
        materialsEl.textContent = '';
        if (materialsWrapEl instanceof HTMLElement) {
            materialsWrapEl.classList.remove('hidden');
            materialsWrapEl.classList.add('flex');
        }
        if (rows.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'm-0 fg-[var(--grid-ink-muted)]';
            empty.textContent = t('live_meeting.materials.empty');
            materialsEl.append(empty);
            return;
        }
        rows.forEach((row) => {
            if (!row || typeof row !== 'object') return;
            const card = document.createElement('article');
            card.className =
                'rounded-md border border-[var(--grid-line)] bg-[var(--grid-panel)] p-2 fg-[var(--grid-ink)]';
            const title = document.createElement('div');
            title.className = 'font-medium text-[0.72rem] mb-1 truncate';
            const name = String(row.file_name || row.path || row.vault_name || 'Source');
            title.textContent = name;
            const excerpt = document.createElement('p');
            excerpt.className = 'm-0 text-[0.68rem] leading-snug fg-[var(--grid-ink-muted)] whitespace-pre-wrap';
            excerpt.textContent = String(row.excerpt || '').trim() || t('live_meeting.materials.no_excerpt');
            card.append(title, excerpt);
            materialsEl.append(card);
        });
    };

    const clearMaterials = () => {
        if (materialsEl) materialsEl.textContent = '';
        if (materialsWrapEl instanceof HTMLElement) {
            materialsWrapEl.classList.add('hidden');
            materialsWrapEl.classList.remove('flex');
        }
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
        clearBubbles();
        clearMaterials();
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
                if (payload.kind === 'live_bubble') {
                    addBubbleChip(payload);
                    return;
                }
                if (payload.kind === 'live_phase' && payload.payload?.live_phase === 'thinking') {
                    setStatus('live_meeting.status.analyzing');
                    return;
                }
                if (payload.kind === 'live_phase' && payload.payload?.live_phase === 'rag') {
                    setStatus('live_meeting.status.rag_lookup');
                    return;
                }
                if (payload.kind === 'live_stats') {
                    const total = Number(payload.payload?.evidence_total ?? 0);
                    const passages = Number(payload.payload?.passage_count ?? 0);
                    setConn(
                        t('live_meeting.stats.line', '', {
                            sources: String(total),
                            passages: String(passages),
                        }),
                        { raw: true },
                    );
                    return;
                }
                if (payload.kind === 'live_materials') {
                    renderMaterials(payload);
                    setStatus('live_meeting.status.materials_ready');
                    return;
                }
                if (payload.kind === 'live_phase' && payload.payload?.live_phase === 'idle') {
                    if (sessionId) setStatus('live_meeting.status.recording');
                    return;
                }
                if (payload.kind === 'error' && payload.text === 'vault_rag_not_configured') {
                    appendErrorLine(t('live_meeting.error.vault_rag_not_configured'));
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
