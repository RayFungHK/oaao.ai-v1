/**
 * Chat composer — voice input via ASR Live (PCM uplink + SSE transcript).
 */
import { mountComposerDropupAbove, renderComposerDropupEmpty, renderComposerDropupOptions } from '../../../core/default/js/oaao-composer-dropup.js';

const STORAGE_KEY = 'oaao_chat_composer_audio_input';

/** @type {typeof import('../../../live-meeting/default/webassets/js/live-meeting-audio.js').startLiveMeetingPcmUplink | null} */
let startLiveMeetingPcmUplinkFn = null;

/** @returns {string} */
function liveMeetingAudioModuleUrl() {
    const mount = mountPrefix();
    const v = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
    const path = `${mount}/webassets/live-meeting/default/js/live-meeting-audio.js`.replace(/\/{2,}/g, '/');
    return v ? `${path}?v=${encodeURIComponent(v)}` : path;
}

/** @returns {Promise<typeof import('../../../live-meeting/default/webassets/js/live-meeting-audio.js').startLiveMeetingPcmUplink>} */
async function loadLiveMeetingPcmUplink() {
    if (startLiveMeetingPcmUplinkFn) return startLiveMeetingPcmUplinkFn;
    const mod = await import(/* webpackIgnore: true */ liveMeetingAudioModuleUrl());
    if (typeof mod.startLiveMeetingPcmUplink !== 'function') {
        throw new Error('live_meeting_audio_unavailable');
    }
    startLiveMeetingPcmUplinkFn = mod.startLiveMeetingPcmUplink;
    return startLiveMeetingPcmUplinkFn;
}

/** @param {string} key @param {string} [fallback] */
function t(key, fallback = '') {
    const fn = typeof globalThis.oaaoT === 'function' ? globalThis.oaaoT : null;
    if (fn) {
        const hit = fn(key);
        if (hit && hit !== key) return hit;
    }
    return fallback || key;
}

/** @returns {string} */
function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

/** @param {string} path */
function liveMeetingApiUrl(path) {
    const base = `${mountPrefix()}/live-meeting/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

/** @param {string} path @param {RequestInit} [options] */
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

/** @type {((spec: string) => string) | null} */
let resolveOrchestratorPublicUrl = null;
/** @type {((reader: ReadableStreamDefaultReader<Uint8Array>, onEvent: (ev: { eventName: string, data: unknown }) => void, signal?: AbortSignal) => Promise<void>) | null} */
let readOaaoSseStream = null;

async function ensureAsrLiveDeps() {
    if (resolveOrchestratorPublicUrl && readOaaoSseStream) return;
    const v = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
    const q = v ? `?v=${encodeURIComponent(v)}` : '';
    const coreBase = `${mountPrefix()}/webassets/core/default/js`.replace(/\/{2,}/g, '/');
    const [shellMod, sseMod] = await Promise.all([
        import(/* webpackIgnore: true */ `${coreBase}/shell-registry-url.js${q}`),
        import(/* webpackIgnore: true */ `${coreBase}/oaao-sse.js${q}`),
    ]);
    resolveOrchestratorPublicUrl =
        typeof shellMod.resolveOrchestratorPublicUrl === 'function' ? shellMod.resolveOrchestratorPublicUrl : (s) => s;
    readOaaoSseStream = typeof sseMod.readOaaoSseStream === 'function' ? sseMod.readOaaoSseStream : null;
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} ctx
 */
export function mountRagComposerVoice(host, ctx) {
    const workspaceFields =
        typeof ctx.workspaceChatBodyFields === 'function' ? ctx.workspaceChatBodyFields : () => ({});
    const getComposerPlainText =
        typeof ctx.getComposerPlainText === 'function' ? ctx.getComposerPlainText : () => '';
    const setComposerPlainText =
        typeof ctx.setComposerPlainText === 'function' ? ctx.setComposerPlainText : () => {};
    const wireComposerIconHoverHint =
        typeof ctx.wireComposerIconHoverHint === 'function' ? ctx.wireComposerIconHoverHint : () => {};
    const signal = ctx.signal instanceof AbortSignal ? ctx.signal : undefined;

    const btnClass =
        'oaao-composer-voice-btn inline-flex items-center justify-center w-8 h-8 p-0 [border:1px_solid_var(--grid-line)] rounded-full bg-transparent fg-[var(--grid-ink-muted)] hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink)] cursor-pointer font-inherit shrink-0';

    const root = document.createElement('div');
    root.className = 'shrink-0';
    root.dataset.oaaoComposerVoice = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = t('live_meeting.start_mic', 'Voice input');
    btn.setAttribute('aria-label', t('live_meeting.start_mic', 'Voice input'));
    btn.className = btnClass;

    const levelFill = document.createElement('span');
    levelFill.className = 'oaao-composer-voice-level';
    levelFill.setAttribute('aria-hidden', 'true');

    const micSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    micSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    micSvg.setAttribute('class', 'rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none');
    micSvg.setAttribute('viewBox', '0 0 24 24');
    micSvg.setAttribute('fill', 'none');
    micSvg.setAttribute('stroke', 'currentColor');
    micSvg.setAttribute('stroke-width', '2');
    micSvg.setAttribute('aria-hidden', 'true');
    micSvg.innerHTML =
        '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke-linecap="round" stroke-linejoin="round"/>';
    btn.append(levelFill, micSvg);

    host.append(root);
    root.append(btn);

    const menuLabel = t('live_meeting.audio_input.label', 'Audio input');
    const dropup = mountComposerDropupAbove(root, btn, {
        signal,
        menuLabel,
        heading: menuLabel,
    });

    let recording = false;
    /** @type {{ deviceId: string, label: string }[]} */
    let deviceRows = [];
    let selectedDeviceId = readStoredDeviceId();
    let micPermissionDenied = false;

    /** @type {string} */
    let sessionId = '';
    /** @type {{ stop: () => void } | null} */
    let uplink = null;
    /** @type {AbortController | null} */
    let sseAbort = null;
    /** @type {string} */
    let asrBasePrefix = '';
    /** @type {Map<string, string>} */
    const asrSegments = new Map();
    /** @type {string[]} */
    let asrSegmentOrder = [];
    let lastLevelPaintAt = 0;

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

    wireComposerIconHoverHint(btn, () => `${menuLabel}: ${selectedLabel()}`);

    function paintAudioLevel(level) {
        const now = performance.now();
        if (now - lastLevelPaintAt < 50) return;
        lastLevelPaintAt = now;
        const pct = Math.max(0, Math.min(100, Math.round(level * 100)));
        levelFill.style.height = `${pct}%`;
    }

    function resetAsrBuffer() {
        const base = String(getComposerPlainText() ?? '').trim();
        asrBasePrefix = base ? `${base} ` : '';
        asrSegments.clear();
        asrSegmentOrder = [];
    }

    function rebuildComposerFromAsr() {
        const parts = asrSegmentOrder.map((key) => asrSegments.get(key)).filter(Boolean);
        const live = parts.join(' ').trim();
        const merged = (asrBasePrefix + live).trim();
        setComposerPlainText(merged);
    }

    /** @param {Record<string, unknown>} payload */
    function handleLiveTranscript(payload) {
        const text = String(payload.text ?? '').trim();
        if (!text) return;
        const seg = String(
            (payload.payload && typeof payload.payload === 'object' ? payload.payload.segment : '') ?? '',
        ).trim();
        const key = seg || `_seg_${asrSegmentOrder.length}`;
        if (!asrSegments.has(key)) asrSegmentOrder.push(key);
        asrSegments.set(key, text);
        rebuildComposerFromAsr();
    }

    function closeSse() {
        if (sseAbort) {
            sseAbort.abort();
            sseAbort = null;
        }
    }

    /** @param {string} streamUrl */
    function openSse(streamUrl) {
        closeSse();
        const url = String(streamUrl || '').trim();
        if (!url || !readOaaoSseStream) return;
        const resolved = resolveOrchestratorPublicUrl
            ? resolveOrchestratorPublicUrl(url)
            : url;
        const u = new URL(resolved, window.location.href);
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
                if (!res.ok || !res.body) return;
                const reader = res.body.getReader();
                await readOaaoSseStream(
                    reader,
                    ({ eventName, data }) => {
                        if (eventName === 'oaao.stream' && data && typeof data === 'object') {
                            const row = /** @type {Record<string, unknown>} */ (data);
                            if (row.kind === 'live_transcript') {
                                handleLiveTranscript(row);
                            } else if (row.kind === 'error') {
                                const errText = String(row.text ?? '').trim();
                                if (errText && typeof ctx.toast === 'function') {
                                    if (errText === 'asr_not_configured') {
                                        ctx.toast(t('live_meeting.error.asr_not_configured', 'Speech recognition is not configured'));
                                    } else if (errText.startsWith('funasr_nano_http_')) {
                                        ctx.toast(t('live_meeting.error.asr_remote_failed', 'Live ASR service error — retrying with batch ASR if configured.'));
                                    } else if (!errText.startsWith('transcribing_segment_')) {
                                        ctx.toast(errText.slice(0, 160));
                                    }
                                }
                            }
                        }
                    },
                    sseSignal,
                );
            } catch (err) {
                if (err?.name === 'AbortError') return;
            }
        })();
    }

    async function stopSession() {
        if (!sessionId) return;
        const sid = sessionId;
        sessionId = '';
        await liveMeetingFetchJson('session_stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sid, keep_audio: false }),
            signal,
        });
    }

    function stopUplink() {
        if (uplink) {
            try {
                uplink.stop();
            } catch {
                /* ignore */
            }
            uplink = null;
        }
        closeSse();
    }

    async function stopRecording() {
        if (!recording) return;
        recording = false;
        btn.classList.remove('is-recording');
        dropup.arrowBtn.disabled = false;
        levelFill.style.height = '0%';
        stopUplink();
        await stopSession();
    }

    async function startRecording() {
        if (!navigator.mediaDevices?.getUserMedia) {
            if (typeof ctx.toast === 'function') ctx.toast('Microphone not available');
            return;
        }
        await ensureAsrLiveDeps();

        const wsFields = workspaceFields();
        const wid = Number(wsFields.workspace_id ?? 0);
        const { res, data } = await liveMeetingFetchJson('session_start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cadence: '1v1',
                workspace_id: wid > 0 ? wid : undefined,
                retention_mode: 'disk_ttl',
            }),
            signal,
        });
        if (!res.ok || !data?.success || !data?.data?.session_id) {
            if (typeof ctx.toast === 'function') {
                ctx.toast(String(data?.message || t('live_meeting.error.asr_not_configured', 'Speech recognition failed')));
            }
            return;
        }

        const session = data.data;
        sessionId = String(session.session_id || '');
        resetAsrBuffer();

        const wsRaw =
            session.ws_audio_url_ws ||
            (session.ws_audio_url ? String(session.ws_audio_url).replace(/^https/i, 'wss').replace(/^http/i, 'ws') : '');
        const wsUrl = resolveOrchestratorPublicUrl ? resolveOrchestratorPublicUrl(wsRaw) : wsRaw;

        recording = true;
        dropup.arrowBtn.disabled = true;
        dropup.close();
        btn.classList.add('is-recording');

        try {
            const startLiveMeetingPcmUplink = await loadLiveMeetingPcmUplink();
            uplink = await startLiveMeetingPcmUplink(wsUrl, {
                signal,
                deviceId: selectedDeviceId || undefined,
                onLevel: paintAudioLevel,
            });
        } catch (err) {
            recording = false;
            btn.classList.remove('is-recording');
            dropup.arrowBtn.disabled = false;
            levelFill.style.height = '0%';
            await stopSession();
            const msg = String(err?.message || '');
            if (typeof ctx.toast === 'function') {
                if (msg === 'mic_denied') {
                    ctx.toast(t('live_meeting.error.mic_denied', 'Microphone permission denied'));
                } else if (msg === 'mic_device_unavailable') {
                    ctx.toast(t('live_meeting.error.mic_device_unavailable', 'Selected microphone is unavailable'));
                } else if (msg === 'WebSocket failed' || msg === 'WebSocket connect timeout' || msg === 'ws_audio_url required') {
                    ctx.toast(t('live_meeting.error.mic_ws', 'Microphone connection failed'));
                } else {
                    ctx.toast(t('live_meeting.error.mic_ws', 'Microphone connection failed'));
                }
            }
            return;
        }

        if (session.stream_url) {
            let streamUrl = resolveOrchestratorPublicUrl
                ? resolveOrchestratorPublicUrl(String(session.stream_url))
                : String(session.stream_url);
            if (session.stream_token) {
                const u = new URL(streamUrl, window.location.href);
                u.searchParams.set('token', String(session.stream_token));
                streamUrl = u.href;
            }
            openSse(streamUrl);
        }
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
        const rows = [
            { id: '', label: t('live_meeting.audio_input.default', 'System default') },
            ...deviceRows.map((row) => ({ id: row.deviceId, label: row.label })),
        ];
        if (deviceRows.length === 0 && micPermissionDenied) {
            renderComposerDropupEmpty(
                dropup.list,
                t(
                    'live_meeting.audio_input.permission_denied',
                    'Microphone access denied — allow mic in browser settings.',
                ),
            );
            dropup.reposition?.();
            return;
        }
        renderComposerDropupOptions(
            dropup.list,
            rows,
            selectedDeviceId,
            (id) => {
                if (recording) return;
                persistDeviceId(id);
                renderDevicePanel();
                dropup.close();
            },
            { disabled: recording },
        );
        dropup.reposition?.();
    }

    dropup.arrowBtn.addEventListener(
        'click',
        () => {
            if (recording) return;
            void refreshDevices({ warmPermission: true }).then(renderDevicePanel);
        },
        signal ? { signal } : undefined,
    );

    btn.addEventListener(
        'click',
        async () => {
            if (recording) {
                await stopRecording();
                return;
            }
            try {
                await startRecording();
            } catch {
                if (typeof ctx.toast === 'function') ctx.toast('Microphone permission denied');
            }
        },
        signal ? { signal } : undefined,
    );

    if (signal) {
        signal.addEventListener('abort', () => {
            void stopRecording();
        });
    }

    if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
            void refreshDevices();
        });
    }

    void refreshDevices();
}
