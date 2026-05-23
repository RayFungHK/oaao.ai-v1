/**
 * Live meeting workspace panel — session_start, WS PCM uplink, SSE live_transcript.
 *
 * Cross-module core imports use explicit {@code /webassets/core/default/js/…} URLs (not filesystem-relative
 * {@code …/webassets/js/…}) — Apache serves {@code /webassets/{dist}/{version}/js/} without a {@code webassets/}
 * segment in the URL ({@see backbone/.htaccess}, {@see shell-registry-url.js}).
 */
import { startLiveMeetingPcmUplink } from './live-meeting-audio.js';
import { wireLiveMeetingAudioInputPicker } from './live-meeting-audio-input-picker.js';
import { hydrateLiveMeetingJit } from './live-meeting-jit.js';
import { liveMeetingWorkspaceId, wireLiveMeetingWorkspacePicker } from './live-meeting-workspace-picker.js';

const OAAO_LIVE_MEETING_CSS_REV = '20260522-mic-split-fix3';
const OAAO_LIVE_MEETING_CSS = '/webassets/live-meeting/default/css/live-meeting.css';
const OAAO_I18N_URL = '/webassets/core/default/js/oaao-i18n.js';
const OAAO_LIVE_MEETING_LEVEL_SILENT = 0.015;

function liveMeetingMountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

/** @param {string} relUnderCoreDefault e.g. {@code js/oaao-sse.js} */
function oaaoLiveMeetingCoreImportHref(relUnderCoreDefault) {
    let pathOnly = `/webassets/core/default/${String(relUnderCoreDefault ?? '').replace(/^\/+/, '')}`.replace(
        /\/{2,}/g,
        '/',
    );

    const rawMount = liveMeetingMountPrefix();
    if (rawMount !== '' && rawMount !== '/') {
        const pref = (rawMount.startsWith('/') ? rawMount : `/${rawMount}`).replace(/\/+$/, '');
        if (pref !== '' && !(pathOnly === pref || pathOnly.startsWith(`${pref}/`))) {
            pathOnly = `${pref}${pathOnly}`.replace(/\/{2,}/g, '/');
        }
    }

    let s = pathOnly;
    const dup = /\/webassets\/(core|chat|endpoints|vault|live-meeting)\/([^/]+)\/webassets(?:\/|$)/;
    while (dup.test(s)) {
        s = s.replace(dup, '/webassets/$1/$2/');
    }
    pathOnly = s.replace(/\/{2,}/g, '/');

    const v = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
    const q = v ? `?v=${encodeURIComponent(v)}` : '';

    if (
        typeof window !== 'undefined' &&
        window.location &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ) {
        const o = window.location.origin;
        if (o && o !== 'null') {
            return `${o}${pathOnly}${q}`;
        }
    }

    return `${pathOnly}${q}`;
}

const [_mSse, _mShell] = await Promise.all([
    import(/* webpackIgnore: true */ oaaoLiveMeetingCoreImportHref('js/oaao-sse.js')),
    import(/* webpackIgnore: true */ oaaoLiveMeetingCoreImportHref('js/shell-registry-url.js')),
]);

const { readOaaoSseStream } = _mSse;
const { resolveOrchestratorPublicUrl } = _mShell;

function liveMeetingPrefixedPath(path) {
    const prefix = liveMeetingMountPrefix();
    const p = String(path ?? '').startsWith('/') ? path : `/${path}`;
    return `${prefix}${p}`.replace(/\/{2,}/g, '/');
}

/** @type {((key: string, vars?: Record<string, string>) => string) | null} */
let liveT = null;

async function ensureLiveMeetingI18n() {
    if (liveT) return liveT;
    try {
        const url = liveMeetingPrefixedPath(OAAO_I18N_URL);
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
    const base = liveMeetingPrefixedPath('/live-meeting/api');
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

/** Map orchestrator ASR error codes to i18n keys. */
function asrErrorMessage(code, t) {
    const c = String(code || '').trim();
    if (c === 'asr_not_configured') return t('live_meeting.error.asr_not_configured');
    return c;
}

export function mountLiveMeetingPanel(mount, { signal } = {}) {
    if (!(mount instanceof HTMLElement)) return;

    wireLiveMeetingWorkspacePicker(mount, { signal });

    const statusEl = mount.querySelector('[data-oaao-live-meeting="status"]');
    const connEl = mount.querySelector('[data-oaao-live-meeting="connections"]');
    const statsWrapEl = mount.querySelector('[data-oaao-live-meeting="stats-wrap"]');
    const statsEl = mount.querySelector('[data-oaao-live-meeting="stats"]');
    const transcriptEl = mount.querySelector('[data-oaao-live-meeting="transcript"]');
    const bubblesWrapEl = mount.querySelector('[data-oaao-live-meeting="bubbles-wrap"]');
    const bubblesEl = mount.querySelector('[data-oaao-live-meeting="bubbles"]');
    const materialsWrapEl = mount.querySelector('[data-oaao-live-meeting="materials-wrap"]');
    const materialsEl = mount.querySelector('[data-oaao-live-meeting="materials"]');
    const micBtn = mount.querySelector('[data-oaao-live-meeting="mic"]');
    const micGroupEl = mount.querySelector('[data-oaao-live-meeting="mic-group"]');
    const keepWrap = mount.querySelector('[data-oaao-live-meeting="keep-audio-wrap"]');
    const keepInput = mount.querySelector('[data-oaao-live-meeting="keep-audio"]');
    const audioMeterWrapEl = mount.querySelector('[data-oaao-live-meeting="audio-meter-wrap"]');
    const audioLevelFillEl = mount.querySelector('[data-oaao-live-meeting="audio-level-fill"]');
    const audioLevelTextEl = mount.querySelector('[data-oaao-live-meeting="audio-level-text"]');
    const audioDotEl = mount.querySelector('[data-oaao-live-meeting="audio-dot"]');
    const audioActiveLabelEl = mount.querySelector('[data-oaao-live-meeting="audio-active-label"]');
    const emptyEl = transcriptEl?.querySelector('.oaao-live-transcript-empty');

    let sessionId = '';
    /** @type {AbortController | null} */
    let sseAbort = null;
    /** @type {{ stop?: () => void } | null} */
    let uplink = null;
    let lastLevelPaintAt = 0;
    let meterSilentSince = 0;

    /** @type {((key: string, vars?: Record<string, string>) => string)} */
    let t = (k) => k;
    /** @type {((key: string, _fb?: string, vars?: Record<string, string>) => string)} */
    let tFn = (key, _fb = '', vars = {}) => {
        let s = key;
        Object.entries(vars).forEach(([k, v]) => {
            s = s.split(`{{${k}}}`).join(String(v));
        });
        return s;
    };

    const isRecording = () =>
        micBtn instanceof HTMLButtonElement && micBtn.dataset.oaaoLiveRecording === '1';

    /** @type {ReturnType<typeof wireLiveMeetingAudioInputPicker>} */
    let audioInputPicker = wireLiveMeetingAudioInputPicker(mount, {
        signal,
        t: (key, fb = '', vars = {}) => tFn(key, fb, vars),
        isRecording,
    });

    void ensureLiveMeetingI18n().then((fn) => {
        t = fn;
        tFn = (key, _fb = '', vars = {}) => fn(key, vars);
        if (statusEl && !sessionId) statusEl.textContent = t('live_meeting.status.idle');
        if (micBtn instanceof HTMLButtonElement && micBtn.dataset.oaaoLiveRecording !== '1') {
            const label = micBtn.querySelector('[data-i18n], span') || micBtn;
            if (label instanceof HTMLElement) label.textContent = t('live_meeting.start_mic');
        }
        void audioInputPicker?.refreshDevices({ preferStored: true });
    });

    const setStatus = (key) => {
        if (statusEl) statusEl.textContent = t(key);
    };
    const setConn = (keyOrText, { raw = false } = {}) => {
        if (!connEl) return;
        connEl.textContent = raw ? String(keyOrText) : t(keyOrText);
    };

    const setMicGroupRecording = (on) => {
        if (micGroupEl instanceof HTMLElement) {
            if (on) {
                micGroupEl.dataset.oaaoLiveRecording = '1';
            } else {
                delete micGroupEl.dataset.oaaoLiveRecording;
            }
        }
    };

    const setActiveAudioLabel = (label) => {
        if (!(audioActiveLabelEl instanceof HTMLElement)) return;
        const text = String(label || '').trim();
        if (!text) {
            audioActiveLabelEl.classList.add('hidden');
            audioActiveLabelEl.textContent = '';
            audioActiveLabelEl.title = '';
            return;
        }
        audioActiveLabelEl.textContent = t('live_meeting.audio_input.active', '', { device: text });
        audioActiveLabelEl.title = text;
        audioActiveLabelEl.classList.remove('hidden');
    };

    const resetAudioMeter = () => {
        lastLevelPaintAt = 0;
        meterSilentSince = 0;
        if (audioMeterWrapEl instanceof HTMLElement) {
            audioMeterWrapEl.classList.add('hidden');
            audioMeterWrapEl.classList.remove('flex');
        }
        if (audioLevelFillEl instanceof HTMLElement) {
            audioLevelFillEl.style.width = '0%';
            audioLevelFillEl.classList.remove('is-hot');
        }
        if (audioLevelTextEl instanceof HTMLElement) {
            audioLevelTextEl.textContent = '0';
        }
        if (audioDotEl instanceof HTMLElement) {
            audioDotEl.classList.remove('is-listening', 'is-open');
        }
        setActiveAudioLabel('');
    };

    const showAudioMeter = () => {
        if (audioMeterWrapEl instanceof HTMLElement) {
            audioMeterWrapEl.classList.remove('hidden');
            audioMeterWrapEl.classList.add('flex');
        }
        if (audioDotEl instanceof HTMLElement) {
            audioDotEl.classList.add('is-open');
        }
    };

    const paintAudioLevel = (level) => {
        const now = performance.now();
        if (now - lastLevelPaintAt < 50) return;
        lastLevelPaintAt = now;

        const pct = Math.max(0, Math.min(100, Math.round(level * 100)));
        if (audioLevelFillEl instanceof HTMLElement) {
            audioLevelFillEl.style.width = `${pct}%`;
            audioLevelFillEl.classList.toggle('is-hot', pct >= 72);
        }
        if (audioLevelTextEl instanceof HTMLElement) {
            audioLevelTextEl.textContent = String(pct);
        }
        if (audioDotEl instanceof HTMLElement) {
            const listening = level >= OAAO_LIVE_MEETING_LEVEL_SILENT;
            audioDotEl.classList.toggle('is-listening', listening);
            audioDotEl.classList.toggle('is-open', !listening);
        }
        if (level >= OAAO_LIVE_MEETING_LEVEL_SILENT) {
            if (meterSilentSince && connEl?.textContent === t('live_meeting.audio_level.silent')) {
                setConn(sessionId ? 'live_meeting.status.recording' : 'live_meeting.audio_level.listening');
            }
            meterSilentSince = 0;
            return;
        }
        if (!meterSilentSince) {
            meterSilentSince = now;
            return;
        }
        if (now - meterSilentSince > 2500 && connEl) {
            connEl.textContent = t('live_meeting.audio_level.silent');
        }
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
            line.className = 'oaao-live-transcript-line';
            if (seg) line.dataset.oaaoLiveSegment = seg;
            transcriptEl.append(line);
        }
        line.textContent = payload.text;
        line.classList.toggle('is-partial', !isFinal);
        line.classList.toggle('is-final', isFinal);
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
        void hydrateLiveMeetingJit(btn);
    };

    const clearBubbles = () => {
        seenBubbleIds.clear();
        if (bubblesEl) bubblesEl.textContent = '';
        if (bubblesWrapEl instanceof HTMLElement) {
            bubblesWrapEl.classList.add('hidden');
        }
    };

    const clearStats = () => {
        if (statsEl) statsEl.textContent = '';
        if (statsWrapEl instanceof HTMLElement) {
            statsWrapEl.classList.add('hidden');
        }
    };

    const renderStats = (payload) => {
        if (!statsEl) return;
        const total = Number(payload.payload?.evidence_total ?? 0);
        const passages = Number(payload.payload?.passage_count ?? 0);
        const delta = Number(payload.payload?.delta ?? 0);
        const lineKey = delta > 0 ? 'live_meeting.stats.line_delta' : 'live_meeting.stats.line';
        const vars = {
            sources: String(total),
            passages: String(passages),
            delta: String(delta),
        };
        statsEl.textContent = t(lineKey, '', vars);
        if (statsWrapEl instanceof HTMLElement) {
            statsWrapEl.classList.remove('hidden');
        }
    };

    const renderMaterials = (payload) => {
        if (!materialsEl) return;
        const rows = Array.isArray(payload?.payload?.materials) ? payload.payload.materials : [];
        materialsEl.textContent = '';
        if (materialsWrapEl instanceof HTMLElement) {
            materialsWrapEl.classList.remove('hidden');
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
        }
    };

    const appendErrorLine = (text) => {
        if (!transcriptEl) return;
        hideEmptyPlaceholder();
        const line = document.createElement('p');
        line.className = 'oaao-live-transcript-line is-error';
        line.textContent = text;
        transcriptEl.append(line);
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    };

    const stopAll = ({ clearTranscript = false } = {}) => {
        closeSse();
        if (uplink?.stop) {
            uplink.stop();
            uplink = null;
        }
        if (micBtn instanceof HTMLButtonElement) {
            delete micBtn.dataset.oaaoLiveRecording;
            const label = micBtn.querySelector('span') || micBtn;
            label.textContent = t('live_meeting.start_mic');
        }
        setMicGroupRecording(false);
        audioInputPicker?.setRecordingLock(false);
        audioInputPicker?.closePanel();
        if (keepWrap instanceof HTMLElement) {
            keepWrap.classList.add('hidden');
            keepWrap.classList.remove('inline-flex');
        }
        if (keepInput instanceof HTMLInputElement) {
            keepInput.checked = false;
        }
        void audioInputPicker?.refreshDevices({ preferStored: true });
        resetAudioMeter();
        setStatus('live_meeting.status.idle');
        setConn('', { raw: true });
        if (clearTranscript && transcriptEl) {
            transcriptEl.querySelectorAll('.oaao-live-transcript-line').forEach((n) => n.remove());
            showEmptyPlaceholder();
        }
        clearBubbles();
        clearStats();
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
                workspace_id: liveMeetingWorkspaceId(),
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

    const closeSse = () => {
        if (sseAbort) {
            sseAbort.abort();
            sseAbort = null;
        }
    };

    const handleStreamPayload = (payload) => {
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
            renderStats(payload);
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
    };

    const openSse = (streamUrl) => {
        closeSse();
        if (!streamUrl) return;
        const u = new URL(resolveOrchestratorPublicUrl(streamUrl), window.location.href);
        sseAbort = new AbortController();
        const { signal: sseSignal } = sseAbort;

        void (async () => {
            try {
                const res = await fetch(u.href, {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'omit',
                    signal: sseSignal,
                    headers: { Accept: 'text/event-stream' },
                });
                if (!res.ok || !res.body) {
                    setConn('live_meeting.conn.sse_reconnecting');
                    return;
                }
                const reader = res.body.getReader();
                await readOaaoSseStream(
                    reader,
                    ({ eventName, data }) => {
                        if (eventName === 'oaao.stream' && data && typeof data === 'object') {
                            handleStreamPayload(data);
                        }
                    },
                    sseSignal,
                );
            } catch (err) {
                if (err?.name === 'AbortError') return;
                setConn('live_meeting.conn.sse_reconnecting');
            }
        })();
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
                    keepWrap.classList.add('inline-flex');
                }
                const wsUrl = resolveOrchestratorPublicUrl(
                    data.ws_audio_url_ws ||
                        (data.ws_audio_url
                            ? String(data.ws_audio_url).replace(/^http/i, 'ws')
                            : ''),
                );
                const label = micBtn.querySelector('span') || micBtn;
                micBtn.dataset.oaaoLiveRecording = '1';
                setMicGroupRecording(true);
                label.textContent = t('live_meeting.stop_mic');
                audioInputPicker?.setRecordingLock(true);
                showAudioMeter();
                const pickedDeviceId = String(audioInputPicker?.getSelectedDeviceId() || '').trim();
                try {
                    uplink = await startLiveMeetingPcmUplink(wsUrl, {
                        signal,
                        deviceId: pickedDeviceId || undefined,
                        onState: (s) => {
                            if (s === 'ws_open') setConn('live_meeting.conn.ws_open');
                            if (s === 'mic_open') {
                                setConn('live_meeting.audio_level.listening');
                                void audioInputPicker?.refreshDevices({ preferStored: true });
                            }
                            if (s === 'ws_closed') setConn('live_meeting.conn.ws_closed');
                        },
                        onError: (code) => {
                            if (code === 'ws_failed') setConn('live_meeting.conn.ws_failed');
                        },
                        onLevel: paintAudioLevel,
                        onDevice: ({ deviceId, label: deviceLabel }) => {
                            if (deviceId) {
                                audioInputPicker?.setDeviceId(deviceId, String(deviceLabel || '').trim());
                            }
                            const shown =
                                String(deviceLabel || '').trim()
                                || audioInputPicker?.getSelectedLabel()
                                || '';
                            setActiveAudioLabel(shown);
                        },
                    });
                } catch (err) {
                    const msg = String(err?.message || '');
                    setStatus('live_meeting.status.error');
                    if (msg === 'mic_denied') {
                        setConn('live_meeting.error.mic_denied');
                    } else if (msg === 'mic_device_unavailable') {
                        setConn('live_meeting.error.mic_device_unavailable');
                    } else {
                        setConn('live_meeting.error.mic_ws');
                    }
                    await stopSession(false);
                    stopAll();
                    return;
                }
                if (data.stream_url) {
                    const u = new URL(resolveOrchestratorPublicUrl(data.stream_url), window.location.href);
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

    window.addEventListener(
        'oaao-workspace-scope-changed',
        () => {
            if (!sessionId && !(micBtn instanceof HTMLButtonElement && micBtn.dataset.oaaoLiveRecording === '1')) {
                return;
            }
            void (async () => {
                const keepAudio = keepInput instanceof HTMLInputElement && keepInput.checked;
                await stopSession(keepAudio);
                stopAll({ clearTranscript: true });
                appendErrorLine(t('live_meeting.error.workspace_scope_changed'));
            })();
        },
        { signal },
    );
}

/** @type {AbortController | null} */
let liveMeetingPanelAbort = null;

function ensureLiveMeetingCss() {
    if (typeof document === 'undefined') return;
    const href = liveMeetingPrefixedPath(
        `${OAAO_LIVE_MEETING_CSS}?v=${encodeURIComponent(OAAO_LIVE_MEETING_CSS_REV)}`,
    );
    let link = document.querySelector('link[data-oaao-live-meeting-css]');
    if (link instanceof HTMLLinkElement && link.href.includes(OAAO_LIVE_MEETING_CSS_REV)) return;
    link?.remove();
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.oaaoLiveMeetingCss = OAAO_LIVE_MEETING_CSS_REV;
    document.head.append(link);
}

/**
 * Workspace shell entry — must match {@code workspace.js} dynamic panel loader.
 * @param {HTMLElement} mount
 */
export async function mountShellPanel(mount) {
    teardownShellPanel();
    ensureLiveMeetingCss();
    await ensureLiveMeetingI18n();
    liveMeetingPanelAbort = new AbortController();
    mountLiveMeetingPanel(mount, { signal: liveMeetingPanelAbort.signal });
    await hydrateLiveMeetingJit(mount);
}

/** @param {Record<string, unknown>} [_opts] */
export function teardownShellPanel(_opts = {}) {
    liveMeetingPanelAbort?.abort();
    liveMeetingPanelAbort = null;
}

/** Legacy direct import (tests / manual mount). */
export default async function init(mount, opts = {}) {
    ensureLiveMeetingCss();
    await ensureLiveMeetingI18n();
    mountLiveMeetingPanel(mount, opts);
    await hydrateLiveMeetingJit(mount);
}
