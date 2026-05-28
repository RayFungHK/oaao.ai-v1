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

/** @param {string} key @param {string} [fallback] @param {Record<string, string | number>} [vars] */
function t(key, fallback = '', vars = {}) {
    const fn = typeof globalThis.oaaoT === 'function' ? globalThis.oaaoT : null;
    if (fn) {
        return fn(key, fallback, vars);
    }
    let out = fallback || key;
    for (const [vk, vv] of Object.entries(vars)) {
        out = out.split(`{{${vk}}}`).join(String(vv));
    }
    return out;
}

/** @returns {string} */
function composerUiLocale() {
    const fn = typeof globalThis.oaaoResolveLang === 'function' ? globalThis.oaaoResolveLang : null;
    if (fn) {
        const resolved = String(fn()).trim();
        if (resolved) return resolved;
    }
    const htmlLang = String(document.documentElement.lang ?? '').trim();
    if (htmlLang) return htmlLang.startsWith('zh') ? 'zh-Hant' : htmlLang;
    return 'en';
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
    const setComposerToolbarHint =
        typeof ctx.setComposerToolbarHint === 'function' ? ctx.setComposerToolbarHint : () => {};
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
    let polishConfigured = false;
    let liveStreamConfigured = false;
    let batchAsrConfigured = false;
    let stopPhaseActive = false;
    let nextSegmentId = 0;
    /** Longest partial/final seen this session — streaming partials are often cumulative. */
    let liveTextBest = '';
    /** @type {string[]} Parallel live ASR memory (complete record for polish). */
    let liveMemoryChunks = [];
    /** @type {Map<string, string>} Parallel batch (~5 s) ASR memory keyed by segment. */
    const batchMemoryBySeg = new Map();
    /** @type {(() => void) | null} */
    let fullPolishRelease = null;
    let fullPolishReceived = false;
    /** @type {Blob | null} */
    let localRecordingBlob = null;
    let localRecordingSec = 0;
    /** @type {Record<string, unknown>} */
    let voiceStats = {};
    /** User/session polish locale from session_start (Preferences display locale). */
    let sessionLocale = '';
    /** @type {HTMLButtonElement | null} */
    let voiceStatsBtn = null;
    /** @type {HTMLDivElement | null} */
    let voiceStatsPopover = null;
    /** @type {HTMLElement | null} */
    let composerStatsHost = null;
    /** @type {HTMLElement | null} */
    let composerInputEl = null;
    /** @type {HTMLElement | null} */
    let composerInputShellEl = null;
    /** @type {HTMLDivElement | null} */
    let composerPolishOverlayEl = null;
    /** @type {Record<string, unknown> | null} */
    let quickPunctuateRules = null;

    /** Fallback when session_start rules are missing — keeps local polish working. */
    const DEFAULT_QUICK_PUNCTUATE_RULES = {
        punctuation_marks: '，。！？、；：,.!?',
        comma_before_words: ['同埋', '而且', '但是', '所以', '因為', '如果', '或者', '不過', '然後', '另外'],
        question_patterns: [
            { regex: '(系乜嘢|係乜嘢)(?=([^？?，。！]*?(系乜嘢|係乜嘢|同埋|权重|權重)))', replacement: '\\1？，' },
            { regex: '(系乜嘢|係乜嘢)(嚟嘅)?(?=乜嘢|同埋|$)', replacement: '\\1\\2？' },
            { regex: '(权重|權重)(?=系乜嘢|係乜嘢)', replacement: '，\\1' },
        ],
        default_terminal: '。',
    };

    /** @param {string} pattern */
    function escapeRegexLiteral(pattern) {
        return String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /** @param {string} marks */
    function negatedMarkLookbehind(marks) {
        return `(?<![${escapeRegexLiteral(String(marks || ''))}])`;
    }

    /** Python re.sub uses \\1 backrefs; JS String.replace needs $1. */
    function regexReplacementForJs(replacement) {
        return String(replacement).replace(/\\(\d)/g, (_, digit) => `$${digit}`);
    }

    /** @param {string} text */
    function normalizeTranscriptSpacing(text) {
        let s = String(text ?? '').trim();
        if (!s) return s;
        s = s.replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '');
        return s.replace(/\s+/g, ' ').trim();
    }

    /** @param {string} text @param {Record<string, unknown> | null} rules */
    function applyQuickPunctuateRules(text, rules) {
        let s = normalizeTranscriptSpacing(text);
        if (!s) return s;
        const cfg = rules && typeof rules === 'object' ? rules : DEFAULT_QUICK_PUNCTUATE_RULES;

        const marks = String(cfg.punctuation_marks ?? '');
        const lookbehind = marks ? negatedMarkLookbehind(marks) : '';

        for (const word of /** @type {unknown[]} */ (cfg.comma_before_words ?? [])) {
            const token = String(word ?? '').trim();
            if (!token) continue;
            const re = new RegExp(`${lookbehind}${escapeRegexLiteral(token)}`, 'g');
            s = s.replace(re, `，${token}`);
        }

        for (const row of /** @type {unknown[]} */ (cfg.question_patterns ?? [])) {
            if (!row || typeof row !== 'object') continue;
            const pattern = String(/** @type {Record<string, unknown>} */ (row).regex ?? '').trim();
            const replacement = String(/** @type {Record<string, unknown>} */ (row).replacement ?? '');
            if (!pattern) continue;
            try {
                s = s.replace(new RegExp(pattern, 'g'), regexReplacementForJs(replacement));
            } catch {
                /* invalid pattern in server rules */
            }
        }

        const terminal = String(cfg.default_terminal ?? '');
        if (terminal) {
            const endRe = marks
                ? new RegExp(`[${escapeRegexLiteral(marks)}]$`)
                : /[，。！？、；：,.!?]$/;
            if (!endRe.test(s)) s += terminal;
        }
        return s;
    }

    function quickPunctuateTranscript(text) {
        return applyQuickPunctuateRules(text, quickPunctuateRules ?? DEFAULT_QUICK_PUNCTUATE_RULES);
    }

    /** @param {string} text */
    function maybeQuickPolishDisplayText(text) {
        const s = String(text ?? '').trim();
        if (!s) return s;
        const cjkCount = (s.match(/[\u4e00-\u9fff]/g) || []).length;
        if (cjkCount < 2 && s.length < 4) return s;
        return quickPunctuateTranscript(s);
    }

    function bestAvailableRawText() {
        /** @type {string[]} */
        const candidates = [
            String(getComposerPlainText() ?? '').trim(),
            liveTextBest,
            currentLiveAsrTextForStop(),
        ].filter(Boolean);
        return candidates.reduce((best, cur) => (cur.length > best.length ? cur : best), '');
    }

    function resolveComposerMount() {
        const shell = host.closest('[data-oaao-chat="composer-shell"]');
        return shell instanceof HTMLElement ? shell : document;
    }

    function resolveComposerInputEl() {
        if (composerInputEl?.isConnected) return composerInputEl;
        const input = resolveComposerMount().querySelector('[data-oaao-chat="input"]');
        if (input instanceof HTMLElement) {
            composerInputEl = input;
            return input;
        }
        return null;
    }

    function resolveComposerInputShellEl() {
        if (composerInputShellEl?.isConnected) return composerInputShellEl;
        const shell = resolveComposerMount().querySelector('[data-oaao-chat="composer-input-shell"]');
        if (shell instanceof HTMLElement) {
            composerInputShellEl = shell;
            return shell;
        }
        return null;
    }

    function lockComposerForPolish() {
        const input = resolveComposerInputEl();
        const inputShell = resolveComposerInputShellEl();
        if (input instanceof HTMLElement) {
            if (!input.dataset.oaaoVoicePolishWasEditable) {
                input.dataset.oaaoVoicePolishWasEditable = input.isContentEditable ? '1' : '0';
            }
            input.contentEditable = 'false';
            input.setAttribute('aria-disabled', 'true');
        }
        if (!(inputShell instanceof HTMLElement)) return;
        inputShell.dataset.oaaoVoicePolishLock = '1';
        inputShell.setAttribute('aria-busy', 'true');
        ensurePolishOverlay();
        setPolishOverlayPhase(true);
        if (!composerPolishOverlayEl.isConnected) {
            inputShell.append(composerPolishOverlayEl);
        }
    }

    function ensurePolishOverlay() {
        if (composerPolishOverlayEl) return;
        composerPolishOverlayEl = document.createElement('div');
        composerPolishOverlayEl.className = 'oaao-composer-voice-polish-overlay';
        composerPolishOverlayEl.dataset.phase = 'polishing';
        composerPolishOverlayEl.setAttribute('aria-live', 'polite');
        const spinner = document.createElement('span');
        spinner.className = 'oaao-composer-voice-polish-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'oaao-composer-voice-polish-label';
        composerPolishOverlayEl.append(spinner, label);
    }

    /** @param {boolean} [polishing] */
    function setPolishOverlayPhase(polishing = true) {
        ensurePolishOverlay();
        composerPolishOverlayEl.dataset.phase = polishing ? 'polishing' : 'finishing';
        const labelEl = composerPolishOverlayEl.querySelector('.oaao-composer-voice-polish-label');
        if (labelEl instanceof HTMLElement) {
            labelEl.textContent = polishingLabel(polishing);
        }
    }

    function unlockComposerForPolish() {
        const input = resolveComposerInputEl();
        const inputShell = resolveComposerInputShellEl();
        if (input instanceof HTMLElement) {
            const was = input.dataset.oaaoVoicePolishWasEditable;
            delete input.dataset.oaaoVoicePolishWasEditable;
            input.contentEditable = was === '0' ? 'false' : 'true';
            input.removeAttribute('aria-disabled');
        }
        if (inputShell instanceof HTMLElement) {
            delete inputShell.dataset.oaaoVoicePolishLock;
            inputShell.removeAttribute('aria-busy');
        }
        if (composerPolishOverlayEl?.isConnected) {
            composerPolishOverlayEl.remove();
        }
    }

    function resolveComposerStatsHost() {
        if (composerStatsHost?.isConnected) return composerStatsHost;
        const shell = host.closest('[data-oaao-chat="composer-shell"]');
        if (shell instanceof HTMLElement) {
            const card = shell.querySelector('[data-oaao-chat="composer-card-wrap"]');
            if (card instanceof HTMLElement) {
                composerStatsHost = card;
                return card;
            }
        }
        const docCard = document.querySelector('[data-oaao-chat="composer-card-wrap"]');
        if (docCard instanceof HTMLElement) {
            composerStatsHost = docCard;
            return docCard;
        }
        return null;
    }

    /** @param {boolean} [polishing] */
    function polishingLabel(polishing = true) {
        if (polishing) {
            return t('live_meeting.status.polishing', 'Polishing transcript…');
        }
        return t('live_meeting.status.finishing', 'Finishing voice input…');
    }

    /** @param {boolean} [polishing] */
    function showStopPhaseUi(polishing = true) {
        const label = polishingLabel(polishing);
        btn.classList.add('is-polishing');
        btn.disabled = true;
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.dataset.oaaoVoicePhase = polishing ? 'polishing' : 'finishing';
        setComposerToolbarHint(label);
        setPolishOverlayPhase(polishing);
    }

    function clearStopPhaseUi() {
        const label = t('live_meeting.start_mic', 'Voice input');
        btn.classList.remove('is-polishing');
        btn.disabled = false;
        btn.title = label;
        btn.setAttribute('aria-label', label);
        delete btn.dataset.oaaoVoicePhase;
        setComposerToolbarHint('');
        unlockComposerForPolish();
    }

    function snapshotClientVoiceStats() {
        const liveChunks = currentLiveAsrChunksForStop();
        const batchChunks = batchMemoryChunksForStop();
        const liveChars = Math.max(
            liveTextBest.length,
            ...liveChunks.map((c) => c.length),
            0,
        );
        const batchJoined = batchChunks.join(' ').trim();
        voiceStats = {
            ...voiceStats,
            batch_chars: batchJoined.length,
            live_chars: liveChars,
            batch_chunk_count: batchChunks.length,
            live_chunk_count: liveChunks.length,
            audio_seconds: localRecordingSec || voiceStats.audio_seconds,
            locale: voiceStats.locale || composerUiLocale(),
        };
        refreshVoiceStatsPopover();
    }

    function refreshVoiceStatsPopover() {
        if (!voiceStatsPopover) return;
        const batchChars = Number(voiceStats.batch_chars ?? 0);
        const liveChars = Number(voiceStats.live_chars ?? 0);
        const rawChars = Number(voiceStats.raw_chars ?? 0) || Math.max(batchChars, liveChars);
        const polishChars = Number(voiceStats.polished_chars ?? 0);
        const quality = Number(voiceStats.polish_quality ?? 0);
        const batchChunks = Number(voiceStats.batch_chunk_count ?? 0);
        const liveChunks = Number(voiceStats.live_chunk_count ?? 0);
        const audioSec = Number(voiceStats.audio_seconds ?? localRecordingSec ?? 0);
        const polishErr = String(voiceStats.polish_error ?? '').trim();
        const phase = String(voiceStats.polish_phase ?? '');
        const locale = String(voiceStats.locale ?? sessionLocale ?? composerUiLocale());
        /** @type {Record<string, string>} */
        const phaseLines = {
            llm: t('live_meeting.voice_stats.phase_llm', 'Status: LLM polished'),
            quick: t('live_meeting.voice_stats.phase_quick', 'Status: Quick punctuation (local)'),
            raw: t('live_meeting.voice_stats.phase_raw', 'Status: Raw ASR (not polished)'),
            pending: t('live_meeting.voice_stats.phase_pending', 'Status: Polishing…'),
        };
        const showPolishMetrics = phase === 'llm' || phase === 'quick';
        const lines = [
            phaseLines[phase] || '',
            t('live_meeting.voice_stats.locale', 'Display language: {{locale}}', { locale }),
            t('live_meeting.voice_stats.batch', 'Batch ASR (5s): {{chars}} chars · {{chunks}} chunks', {
                chars: String(batchChars),
                chunks: String(batchChunks),
            }),
            t('live_meeting.voice_stats.live', 'Live ASR: {{chars}} chars · {{chunks}} chunks', {
                chars: String(liveChars),
                chunks: String(liveChunks),
            }),
            t('live_meeting.voice_stats.raw', 'Raw text: {{chars}} chars', { chars: String(rawChars) }),
            showPolishMetrics && polishChars
                ? phase === 'llm'
                    ? t('live_meeting.voice_stats.polish', 'Polished: {{chars}} chars · quality {{quality}}/100', {
                          chars: String(polishChars),
                          quality: String(quality),
                      })
                    : t(
                          'live_meeting.voice_stats.composer',
                          'Composer: {{chars}} chars · quality {{quality}}/100',
                          { chars: String(polishChars), quality: String(quality) },
                      )
                : phase === 'pending'
                  ? t('live_meeting.voice_stats.no_polish', 'Polished: (pending or unavailable)')
                  : '',
            audioSec > 0
                ? t('live_meeting.voice_stats.audio', 'Local recording: {{sec}}s', {
                      sec: audioSec.toFixed(1),
                  })
                : '',
            polishErr ? t('live_meeting.voice_stats.error', 'Polish note: {{err}}', { err: polishErr }) : '',
        ].filter(Boolean);
        voiceStatsPopover.textContent = '';
        for (const line of lines) {
            const row = document.createElement('div');
            row.textContent = line;
            voiceStatsPopover.append(row);
        }
        if (localRecordingBlob) {
            const dl = document.createElement('button');
            dl.type = 'button';
            dl.className = 'oaao-composer-voice-stats-download';
            dl.textContent = t('live_meeting.voice_stats.download', 'Download recording (WAV)');
            dl.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const url = URL.createObjectURL(localRecordingBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `oaao-voice-${Date.now()}.wav`;
                a.click();
                URL.revokeObjectURL(url);
            });
            voiceStatsPopover.append(dl);
        }
        if (!voiceStatsPopover.hidden) {
            requestAnimationFrame(() => positionVoiceStatsUi());
        }
    }

    function updateVoiceStatsBadge() {
        if (!voiceStatsBtn) return;
        const phase = String(voiceStats.polish_phase ?? 'none');
        voiceStatsBtn.dataset.polishPhase = phase;
        /** @type {Record<string, string>} */
        const labels = {
            llm: t('live_meeting.voice_stats.phase_llm', 'LLM polished'),
            quick: t('live_meeting.voice_stats.phase_quick', 'Quick punctuation'),
            raw: t('live_meeting.voice_stats.phase_raw', 'Raw ASR'),
            pending: t('live_meeting.voice_stats.phase_pending', 'Polishing…'),
        };
        const label = labels[phase] || t('live_meeting.voice_stats.title', 'Voice ASR details');
        voiceStatsBtn.title = label;
        voiceStatsBtn.setAttribute('aria-label', label);
    }

    /** @param {'raw'|'quick'|'llm'|'pending'} [polishPhase] */
    function publishVoiceSessionStats(polishPhase = 'raw') {
        ensureVoiceStatsUi();
        snapshotClientVoiceStats();
        const raw = liveTextBest || liveDisplayText() || '';
        const longestRaw = bestAvailableRawText() || raw;
        const polished = String(getComposerPlainText() ?? '').trim();
        voiceStats = {
            ...voiceStats,
            raw_chars: Math.max(Number(voiceStats.raw_chars ?? 0), raw.length, longestRaw.length),
            polished_chars: polished.length || Number(voiceStats.polished_chars ?? 0),
            polished_text: polished || voiceStats.polished_text,
            polish_phase: polishPhase,
            polish_quality:
                polishPhase === 'llm'
                    ? Number(voiceStats.polish_quality ?? 0) ||
                      Math.min(100, punctuationScore(polished) * 12)
                    : polishPhase === 'quick'
                      ? Math.min(100, punctuationScore(polished) * 12)
                      : 0,
            locale: sessionLocale || voiceStats.locale || composerUiLocale(),
        };
        refreshVoiceStatsPopover();
        updateVoiceStatsBadge();
        setVoiceStatsVisible(true);
    }

    function setVoiceStatsVisible(visible) {
        ensureVoiceStatsUi();
        if (voiceStatsBtn) voiceStatsBtn.hidden = !visible;
        if (voiceStatsLayer) voiceStatsLayer.hidden = !visible;
        if (!visible && voiceStatsPopover) voiceStatsPopover.hidden = true;
        if (visible) {
            attachVoiceStatsToComposer();
            requestAnimationFrame(() => positionVoiceStatsUi());
        } else {
            detachVoiceStatsFromComposer();
        }
    }

    function attachVoiceStatsToComposer() {
        const host = resolveComposerStatsHost();
        if (!(host instanceof HTMLElement) || !voiceStatsLayer) return;
        if (voiceStatsLayer.parentElement !== host) {
            host.append(voiceStatsLayer);
        }
        host.dataset.oaaoVoiceStatsActive = '1';
    }

    function detachVoiceStatsFromComposer() {
        if (composerStatsHost instanceof HTMLElement) {
            delete composerStatsHost.dataset.oaaoVoiceStatsActive;
        }
    }

    /** @type {HTMLDivElement | null} */
    let voiceStatsLayer = null;

    function positionVoiceStatsIcon() {
        /* Icon is anchored on composer-card-wrap via CSS (absolute top-right). */
    }

    function positionVoiceStatsUi() {
        positionVoiceStatsIcon();
        positionVoiceStatsPopover();
    }

    function positionVoiceStatsPopover() {
        if (!voiceStatsBtn || !voiceStatsPopover || voiceStatsPopover.hidden) return;
        const rect = voiceStatsBtn.getBoundingClientRect();
        const popW = voiceStatsPopover.offsetWidth || 224;
        const popH = voiceStatsPopover.offsetHeight || 180;
        let top = rect.bottom + 2;
        let left = rect.right - popW;
        left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
        if (top + popH > window.innerHeight - 8) {
            top = Math.max(8, rect.top - popH - 6);
        }
        voiceStatsPopover.style.top = `${top}px`;
        voiceStatsPopover.style.left = `${left}px`;
    }

    function ensureVoiceStatsUi() {
        if (voiceStatsBtn) return;

        voiceStatsLayer = document.createElement('div');
        voiceStatsLayer.className = 'oaao-composer-voice-stats-layer';
        voiceStatsLayer.hidden = true;

        voiceStatsBtn = document.createElement('button');
        voiceStatsBtn.type = 'button';
        voiceStatsBtn.hidden = true;
        voiceStatsBtn.className = 'oaao-composer-voice-stats-btn';
        voiceStatsBtn.title = t('live_meeting.voice_stats.title', 'Voice ASR details');
        voiceStatsBtn.setAttribute('aria-label', voiceStatsBtn.title);
        voiceStatsBtn.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v5M12 7h.01"/></svg>';

        voiceStatsPopover = document.createElement('div');
        voiceStatsPopover.className = 'oaao-composer-voice-stats-popover';
        voiceStatsPopover.hidden = true;

        let hidePopoverTimer = 0;
        let popoverPinned = false;

        /** @param {EventTarget | null} node */
        function isVoiceStatsHoverTarget(node) {
            if (!(node instanceof Node)) return false;
            return Boolean(
                voiceStatsBtn?.contains(node)
                || voiceStatsPopover?.contains(node)
                || voiceStatsLayer?.contains(node),
            );
        }

        const cancelHidePopover = () => {
            if (hidePopoverTimer) {
                window.clearTimeout(hidePopoverTimer);
                hidePopoverTimer = 0;
            }
        };

        const hidePopoverNow = () => {
            cancelHidePopover();
            popoverPinned = false;
            if (voiceStatsPopover) voiceStatsPopover.hidden = true;
        };

        const scheduleHidePopover = () => {
            if (popoverPinned) return;
            cancelHidePopover();
            hidePopoverTimer = window.setTimeout(() => {
                const overBtn = Boolean(voiceStatsBtn?.matches(':hover'));
                const overPop = Boolean(voiceStatsPopover?.matches(':hover'));
                if (!overBtn && !overPop) hidePopoverNow();
            }, 320);
        };

        const showPopover = () => {
            cancelHidePopover();
            refreshVoiceStatsPopover();
            voiceStatsPopover.hidden = false;
            requestAnimationFrame(() => positionVoiceStatsUi());
        };

        /** @param {MouseEvent} ev */
        const onStatsMouseLeave = (ev) => {
            if (isVoiceStatsHoverTarget(ev.relatedTarget)) return;
            scheduleHidePopover();
        };

        voiceStatsBtn.addEventListener('mouseenter', showPopover);
        voiceStatsBtn.addEventListener('focus', showPopover);
        voiceStatsBtn.addEventListener('mouseleave', onStatsMouseLeave);
        voiceStatsBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (voiceStatsPopover.hidden) {
                popoverPinned = true;
                showPopover();
                return;
            }
            popoverPinned = !popoverPinned;
            if (!popoverPinned) hidePopoverNow();
        });
        voiceStatsPopover.addEventListener('mouseenter', cancelHidePopover);
        voiceStatsPopover.addEventListener('mouseleave', onStatsMouseLeave);
        document.addEventListener(
            'mousedown',
            (ev) => {
                if (voiceStatsPopover.hidden) return;
                const target = ev.target;
                if (isVoiceStatsHoverTarget(target instanceof Node ? target : null)) return;
                hidePopoverNow();
            },
            true,
        );
        window.addEventListener('scroll', positionVoiceStatsUi, true);
        window.addEventListener('resize', positionVoiceStatsUi);

        voiceStatsLayer.append(voiceStatsBtn);
        document.body.append(voiceStatsPopover);
    }

    /** @param {string} text @param {boolean} [markFinal] */
    function applyPolishedComposerText(text, markFinal = true) {
        const cleaned = String(text ?? '').trim();
        if (!cleaned) return;
        asrSegments.clear();
        asrSegmentOrder = [];
        nextSegmentId = 0;
        const key = 'polish:final';
        asrSegmentOrder.push(key);
        asrSegments.set(key, cleaned);
        noteLiveTextBest(cleaned);
        rebuildComposerFromAsr(true);
        if (markFinal) fullPolishReceived = true;
    }

    /** @param {{ serverPhase?: unknown, polishedApplied?: boolean, finalText?: string, polishErr?: string }} opts */
    function inferPolishPhase(opts) {
        const sp = String(opts.serverPhase ?? '').trim();
        const quality = Number(opts.polishQuality ?? 0);
        if (sp === 'llm' && quality > 0 && quality < 50) {
            return 'quick';
        }
        if (sp === 'llm' || sp === 'quick' || sp === 'raw' || sp === 'pending') {
            return sp;
        }
        const finalText = String(opts.finalText ?? '').trim();
        const err = String(opts.polishErr ?? '').trim();
        if (opts.polishedApplied && !err) return 'llm';
        if (err || punctuationScore(finalText) >= 1) return 'quick';
        return 'raw';
    }

    /** @param {Record<string, unknown>} row */
    function applyStopTranscriptStats(row) {
        const stats = row?.transcript_stats;
        if (stats && typeof stats === 'object') {
            voiceStats = { ...voiceStats, .../** @type {Record<string, unknown>} */ (stats) };
        }
        if (!voiceStats.audio_seconds && localRecordingSec) {
            voiceStats.audio_seconds = localRecordingSec;
        }
        const current = String(getComposerPlainText() ?? '').trim();
        const baseline = bestAvailableRawText() || current;
        let polished = String(
            (stats && typeof stats === 'object' ? stats.polished_text : null)
                ?? voiceStats.polished_text
                ?? '',
        ).trim();
        let polishedApplied = false;
        const serverPhase = String(
            (stats && typeof stats === 'object' ? stats.polish_phase : null)
                ?? voiceStats.polish_phase
                ?? '',
        ).trim();
        const polishQuality = Number(
            (stats && typeof stats === 'object' ? stats.polish_quality : null)
                ?? voiceStats.polish_quality
                ?? 0,
        );
        const polishErr = String(voiceStats.polish_error ?? '').trim();
        const sameAsRaw = Boolean(
            polished && baseline && polished.replace(/\s+/g, '') === baseline.replace(/\s+/g, ''),
        );
        if (polished && sameAsRaw && (polishQuality < 50 || serverPhase !== 'llm')) {
            polished = '';
            polishedApplied = false;
        }
        if (polished) {
            applyPolishedComposerText(polished, true);
            polishedApplied = true;
            releaseFullPolishWait();
        }
        if (!polishedApplied && baseline) {
            const local = quickPunctuateTranscript(baseline);
            if (local && punctuationScore(local) > punctuationScore(current)) {
                applyPolishedComposerText(local, true);
                polishedApplied = true;
            }
        }
        const finalText = String(getComposerPlainText() ?? '').trim();
        const phase = inferPolishPhase({
            serverPhase: stats && typeof stats === 'object' ? stats.polish_phase : voiceStats.polish_phase,
            polishQuality,
            polishedApplied,
            finalText,
            polishErr,
        });
        publishVoiceSessionStats(phase);
    }

    /** @param {Record<string, unknown>} inner */
    function asrTrackFromPayload(inner) {
        return String(inner.asr_track ?? 'live').trim() || 'live';
    }

    /** @param {Record<string, unknown>} inner */
    function segmentKeyFromPayload(inner) {
        const track = asrTrackFromPayload(inner);
        const raw = inner.segment;
        if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
            return `${track}:seg:${String(raw)}`;
        }
        nextSegmentId += 1;
        return `${track}:auto:${nextSegmentId}`;
    }

    /** @param {string} track */
    function shouldDisplayTrack(track) {
        if (liveStreamConfigured) return track === 'live';
        if (batchAsrConfigured) return track === 'batch';
        return track === 'live';
    }

    /** @param {string[]} chunks @param {string} text */
    function pushDedupeChunk(chunks, text) {
        const cleaned = String(text ?? '').trim();
        if (!cleaned) return;
        if (!chunks.length) {
            chunks.push(cleaned);
            return;
        }
        const last = chunks[chunks.length - 1];
        if (last === cleaned) return;
        if (cleaned.startsWith(last)) {
            chunks[chunks.length - 1] = cleaned;
            return;
        }
        if (last.startsWith(cleaned)) return;
        chunks.push(cleaned);
    }

    /**
     * @param {string} track
     * @param {string} text
     * @param {string} [segKey]
     */
    function noteParallelMemory(track, text, segKey = '') {
        const cleaned = String(text ?? '').trim();
        if (!cleaned) return;
        if (track === 'batch') {
            if (segKey) batchMemoryBySeg.set(segKey, cleaned);
            return;
        }
        pushDedupeChunk(liveMemoryChunks, cleaned);
        noteLiveTextBest(cleaned);
    }

    function batchMemoryChunksForStop() {
        return Array.from(batchMemoryBySeg.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => text);
    }

    function flushLivePartialToSegment() {
        const partial = String(asrSegments.get('_live_partial') ?? '').trim();
        if (!partial || segmentTextAlreadyPresent(partial)) {
            asrSegments.delete('_live_partial');
            asrSegmentOrder = asrSegmentOrder.filter((k) => k !== '_live_partial');
            return;
        }
        nextSegmentId += 1;
        const key = `_flush:${nextSegmentId}`;
        asrSegments.set(key, partial);
        asrSegments.delete('_live_partial');
        asrSegmentOrder = asrSegmentOrder.filter((k) => k !== '_live_partial');
        asrSegmentOrder.push(key);
    }

    /**
     * @param {string} text
     * @param {Record<string, unknown>} inner
     * @param {string} existing
     */
    function resolveFinalTranscriptText(text, inner, existing) {
        const rawHint = String(inner.raw_text ?? '').trim();
        const baseline = rawHint || existing;
        const candidate = String(text ?? '').trim();
        if (inner.full_session_polish === true && candidate) {
            return candidate;
        }
        if (inner.polished === true && baseline && candidate) {
            if (
                baseline.length > candidate.length + 12
                && baseline.length > candidate.length * 1.28
                && (punctuationScore(candidate) < 2 || candidate.includes('\\1'))
            ) {
                return quickPunctuateTranscript(baseline);
            }
            if (punctuationScore(candidate) >= 2) {
                return candidate;
            }
            if (punctuationScore(candidate) < 2 && punctuationScore(baseline) >= punctuationScore(candidate)) {
                return quickPunctuateTranscript(baseline);
            }
        }
        if (candidate && punctuationScore(candidate) >= 2) {
            return candidate;
        }
        return quickPunctuateTranscript(candidate || baseline);
    }

    function releaseFullPolishWait() {
        if (fullPolishRelease) {
            const done = fullPolishRelease;
            fullPolishRelease = null;
            done();
        }
    }

    /** @param {number} [timeoutMs] */
    function waitForFullSessionPolish(timeoutMs = 12000) {
        if (!polishConfigured) return Promise.resolve();
        return new Promise((resolve) => {
            fullPolishRelease = resolve;
            setTimeout(() => {
                releaseFullPolishWait();
                resolve();
            }, timeoutMs);
        });
    }

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
        liveTextBest = '';
        liveMemoryChunks = [];
        batchMemoryBySeg.clear();
        fullPolishReceived = false;
        localRecordingBlob = null;
        localRecordingSec = 0;
        voiceStats = {};
        sessionLocale = '';
        quickPunctuateRules = null;
        setVoiceStatsVisible(false);
    }

    /** @param {string} text */
    function noteLiveTextBest(text) {
        const cleaned = String(text ?? '').trim();
        if (cleaned && cleaned.length >= liveTextBest.length) {
            liveTextBest = cleaned;
        }
    }

    function punctuationScore(text) {
        const hits = String(text ?? '').match(/[，。！？、；：,.!?]/g);
        return hits ? hits.length : 0;
    }

    /** @param {string} candidate @param {string} current */
    function shouldPreferPolishText(candidate, current) {
        const c = String(candidate ?? '').trim();
        const cur = String(current ?? '').trim();
        if (!c) return false;
        if (!cur) return true;
        const cP = punctuationScore(c);
        const curP = punctuationScore(cur);
        if (cP > curP) return true;
        if (cP < curP) return false;
        if (cP >= 2 && c.length >= Math.min(cur.length, 12)) return true;
        if (cur.length >= 24 && c.length < cur.length * 0.72) return false;
        if (normalizeAsrCompare(c) === normalizeAsrCompare(cur)) return false;
        return c.length >= cur.length * 0.85;
    }

    function normalizeAsrCompare(text) {
        return String(text ?? '')
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    function stripPunctForCompare(text) {
        return normalizeAsrCompare(String(text ?? '').replace(/[，。！？、；：,.!?]/g, ''));
    }

    /** @param {string} polished @param {string} baseline */
    function isSubstantiveServerPolish(polished, baseline) {
        const p = stripPunctForCompare(polished);
        const b = stripPunctForCompare(baseline);
        if (!p || p.length < 8) return false;
        return p !== b;
    }

    /** @param {string} a @param {string} b */
    function commonPrefixLen(a, b) {
        const x = normalizeAsrCompare(a);
        const y = normalizeAsrCompare(b);
        let n = 0;
        while (n < x.length && n < y.length && x[n] === y[n]) n += 1;
        return n;
    }

    /** @param {string} current @param {string} incoming */
    function resolveLiveRollingText(current, incoming) {
        const cur = String(current ?? '').trim();
        const inc = String(incoming ?? '').trim();
        if (!inc) return cur;
        if (!cur) return inc;
        if (cur === inc) return cur;
        if (inc.includes(cur)) return inc;
        if (cur.includes(inc)) return cur;
        const prefix = commonPrefixLen(cur, inc);
        const minLen = Math.min(normalizeAsrCompare(cur).length, normalizeAsrCompare(inc).length);
        if (prefix >= 6 || (minLen > 0 && prefix >= minLen * 0.45)) {
            return inc.length >= cur.length ? inc : cur;
        }
        if (/[。！？.!?]$/.test(cur)) {
            return `${cur} ${inc}`.trim();
        }
        return inc.length >= cur.length ? inc : cur;
    }

    function purgeLiveDisplaySegmentKeys() {
        for (const key of [...asrSegments.keys()]) {
            if (key === '_live_partial' || key === '_live_rolling') continue;
            if (!key.startsWith('live:')) continue;
            asrSegments.delete(key);
        }
        asrSegmentOrder = asrSegmentOrder.filter(
            (key) => key === '_live_partial' || key === '_live_rolling' || !key.startsWith('live:'),
        );
    }

    function liveDisplayText() {
        const rolling = String(asrSegments.get('_live_rolling') ?? '').trim();
        const partial = String(asrSegments.get('_live_partial') ?? '').trim();
        if (partial) return resolveLiveRollingText(rolling, partial);
        return rolling;
    }

    function mergeAsrSegmentTexts(parts) {
        /** @type {string[]} */
        const cleaned = parts.map((p) => String(p).trim()).filter(Boolean);
        if (!cleaned.length) return '';
        if (cleaned.length === 1) return cleaned[0];

        /** @type {string[]} */
        const unique = [];
        for (const part of cleaned) {
            if (unique.includes(part)) continue;
            unique.push(part);
        }

        if (unique.length > 1) {
            let sharedPrefix = Infinity;
            for (let i = 1; i < unique.length; i += 1) {
                sharedPrefix = Math.min(sharedPrefix, commonPrefixLen(unique[0], unique[i]));
            }
            if (sharedPrefix >= 6) {
                return unique.reduce((best, cur) => (cur.length >= best.length ? cur : best));
            }
        }

        let merged = unique[0];
        for (let i = 1; i < unique.length; i += 1) {
            const part = unique[i];
            if (!part || part === merged) continue;
            if (part.includes(merged)) {
                merged = part;
                continue;
            }
            if (merged.includes(part)) {
                continue;
            }
            merged = `${merged} ${part}`.trim();
        }

        const words = merged.split(/\s+/);
        if (words.length >= 8) {
            for (let splitAt = Math.floor(words.length / 2); splitAt >= 4; splitAt -= 1) {
                const left = words.slice(0, splitAt).join(' ');
                const right = words.slice(splitAt).join(' ');
                if (left === right) return left;
            }
        }

        return merged;
    }

    function mergedCommittedSegmentText() {
        return asrSegmentOrder
            .filter((key) => key !== '_live_partial')
            .map((key) => String(asrSegments.get(key) ?? '').trim())
            .filter(Boolean)
            .join(' ')
            .trim();
    }

    /** @param {string} text @param {boolean} [isPolished] */
    function segmentTextAlreadyPresent(text, isPolished = false) {
        const candidate = String(text ?? '').trim();
        if (!candidate) return true;
        if (isPolished) return false;
        for (const key of asrSegmentOrder) {
            if (key === '_live_partial') continue;
            const existing = String(asrSegments.get(key) ?? '').trim();
            if (!existing) continue;
            if (existing === candidate) return true;
        }
        return mergedCommittedSegmentText() === candidate;
    }

    /** @param {boolean} [allowDuringStop] */
    function rebuildComposerFromAsr(allowDuringStop = false) {
        if (stopPhaseActive && !allowDuringStop) return;
        let live;
        if (liveStreamConfigured) {
            live = liveDisplayText();
            if (!live) {
                const parts = asrSegmentOrder
                    .filter((key) => key !== '_live_partial' && key !== '_live_rolling')
                    .map((key) => asrSegments.get(key))
                    .filter(Boolean);
                live = mergeAsrSegmentTexts(parts);
            }
        } else {
            const parts = asrSegmentOrder.map((key) => asrSegments.get(key)).filter(Boolean);
            live = mergeAsrSegmentTexts(parts);
        }
        const merged = (asrBasePrefix + live).trim();
        const isFinalPolish =
            asrSegmentOrder.length === 1 && asrSegmentOrder[0] === 'polish:final';
        const display = isFinalPolish ? merged : maybeQuickPolishDisplayText(merged);
        setComposerPlainText(display);
        if (live && !isFinalPolish) noteLiveTextBest(live);
    }

    /** @param {Record<string, unknown>} payload */
    function handleLiveTranscript(payload) {
        const text = String(payload.text ?? '').trim();
        if (!text) return;
        const inner =
            payload.payload && typeof payload.payload === 'object'
                ? /** @type {Record<string, unknown>} */ (payload.payload)
                : {};
        if (stopPhaseActive) {
            const isFullSessionPolish =
                inner.full_session_polish === true && inner.polished === true;
            if (!isFullSessionPolish) return;
        }
        const track = asrTrackFromPayload(inner);
        const isFinal = inner.is_final !== false;
        const key = segmentKeyFromPayload(inner);
        const isPolished = inner.polished === true;
        const isFullSessionPolish = inner.full_session_polish === true;

        if (isFinal) {
            noteParallelMemory(track, text, key);
        } else if (track === 'live') {
            noteParallelMemory('live', text);
        }

        if (isFullSessionPolish && !isPolished) {
            return;
        }

        if (isFullSessionPolish) {
            const ts =
                inner.transcript_stats && typeof inner.transcript_stats === 'object'
                    ? /** @type {Record<string, unknown>} */ (inner.transcript_stats)
                    : null;
            const fullKey = segmentKeyFromPayload(inner);
            const baseline = liveTextBest || mergedCommittedSegmentText();
            const resolved = resolveFinalTranscriptText(text, inner, baseline);
            asrSegments.clear();
            asrSegmentOrder = [];
            nextSegmentId = 0;
            asrSegmentOrder.push(fullKey);
            asrSegments.set(fullKey, resolved);
            noteLiveTextBest(resolved);
            applyPolishedComposerText(resolved, true);
            fullPolishReceived = true;
            const serverPhase = String(ts?.polish_phase ?? '').trim();
            const serverQuality = Number(ts?.polish_quality ?? 0);
            const serverErr = String(ts?.polish_error ?? '').trim();
            voiceStats = {
                ...voiceStats,
                polished_chars: resolved.length,
                polished_text: resolved,
                raw_chars: Number(ts?.raw_chars ?? voiceStats.raw_chars ?? 0) || baseline.length,
                polish_quality: serverQuality || Number(voiceStats.polish_quality ?? 0),
                polish_error: serverErr || voiceStats.polish_error,
                polish_phase: serverPhase || voiceStats.polish_phase,
                locale: String(ts?.locale ?? voiceStats.locale ?? sessionLocale ?? composerUiLocale()),
            };
            const phase =
                serverPhase === 'llm' || serverPhase === 'quick' || serverPhase === 'raw'
                    ? /** @type {'llm'|'quick'|'raw'} */ (serverPhase)
                    : serverErr
                      ? 'quick'
                      : 'quick';
            publishVoiceSessionStats(phase);
            releaseFullPolishWait();
            return;
        }

        if (isPolished && polishConfigured) {
            return;
        }

        if (!shouldDisplayTrack(track)) {
            snapshotClientVoiceStats();
            return;
        }

        if (track === 'live' && liveStreamConfigured) {
            if (!isFinal) {
                const rolling = resolveLiveRollingText(asrSegments.get('_live_rolling'), text);
                purgeLiveDisplaySegmentKeys();
                asrSegments.set('_live_partial', rolling);
                if (!asrSegmentOrder.includes('_live_partial')) {
                    asrSegmentOrder.push('_live_partial');
                }
                noteLiveTextBest(rolling);
                rebuildComposerFromAsr();
                return;
            }

            const partialBeforeFinal = String(asrSegments.get('_live_partial') ?? '').trim();
            asrSegments.delete('_live_partial');
            asrSegmentOrder = asrSegmentOrder.filter((k) => k !== '_live_partial');

            let finalText = text;
            const priorRolling = String(asrSegments.get('_live_rolling') ?? '').trim();
            if (partialBeforeFinal.length > finalText.length + 12) {
                finalText = partialBeforeFinal;
            }
            const resolvedText = resolveFinalTranscriptText(finalText, inner, priorRolling);
            const rolling = resolveLiveRollingText(priorRolling, resolvedText);
            purgeLiveDisplaySegmentKeys();
            asrSegments.set('_live_rolling', rolling);
            if (!asrSegmentOrder.includes('_live_rolling')) {
                asrSegmentOrder.push('_live_rolling');
            }
            noteLiveTextBest(rolling);
            rebuildComposerFromAsr();
            snapshotClientVoiceStats();
            return;
        }

        if (!isFinal) {
            asrSegments.set('_live_partial', text);
            if (!asrSegmentOrder.includes('_live_partial')) {
                asrSegmentOrder.push('_live_partial');
            }
            rebuildComposerFromAsr();
            return;
        }

        const partialBeforeFinal = String(asrSegments.get('_live_partial') ?? '').trim();
        asrSegments.delete('_live_partial');
        asrSegmentOrder = asrSegmentOrder.filter((k) => k !== '_live_partial');

        let finalText = text;
        const priorMerged = mergedCommittedSegmentText();
        if (partialBeforeFinal.length > finalText.length + 12) {
            const partialAlreadyCovered =
                priorMerged.includes(partialBeforeFinal)
                || (priorMerged.length > 8 && partialBeforeFinal.includes(priorMerged));
            if (!partialAlreadyCovered && partialBeforeFinal.length > priorMerged.length + 8) {
                finalText = partialBeforeFinal;
            }
        }

        const existing = String(asrSegments.get(key) ?? '').trim();
        const resolvedText = resolveFinalTranscriptText(finalText, inner, existing);
        if (isPolished) {
            if (!asrSegments.has(key)) asrSegmentOrder.push(key);
            asrSegments.set(key, resolvedText);
            rebuildComposerFromAsr();
            return;
        }
        if (segmentTextAlreadyPresent(resolvedText, false) && !existing) {
            rebuildComposerFromAsr();
            return;
        }
        if (!asrSegments.has(key)) asrSegmentOrder.push(key);
        asrSegments.set(key, resolvedText);
        rebuildComposerFromAsr();
        snapshotClientVoiceStats();
    }

    /** @param {Record<string, unknown>} row */
    function handleLiveStatus(row) {
        const statusText = String(row.text ?? '').trim();
        if (statusText === 'live_polish_pending') {
            polishConfigured = true;
        }
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
                            } else if (row.kind === 'status') {
                                handleLiveStatus(row);
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

    function currentLiveAsrChunksForStop() {
        if (liveMemoryChunks.length) return [...liveMemoryChunks];
        /** @type {string[]} */
        const chunks = [];
        for (const key of asrSegmentOrder) {
            if (key === '_live_partial' || !key.startsWith('live:')) continue;
            const line = String(asrSegments.get(key) ?? '').trim();
            if (!line) continue;
            if (chunks.length && chunks[chunks.length - 1] === line) continue;
            chunks.push(line);
        }
        const partial = String(asrSegments.get('_live_partial') ?? '').trim();
        if (partial && (!chunks.length || chunks[chunks.length - 1] !== partial)) {
            chunks.push(partial);
        }
        if (liveTextBest) {
            const best = liveTextBest.trim();
            const covered = chunks.some(
                (c) => c === best || c.includes(best) || best.includes(c),
            );
            if (!covered) chunks.push(best);
        }
        return chunks;
    }

    function currentLiveAsrTextForStop() {
        const chunks = currentLiveAsrChunksForStop();
        /** @type {string[]} */
        const candidates = [liveTextBest, liveDisplayText(), ...chunks].filter(Boolean);
        return candidates.reduce((best, cur) => (cur.length > best.length ? cur : best), '');
    }

    async function stopSession() {
        if (!sessionId) return {};
        const sid = sessionId;
        const clientLiveText = currentLiveAsrTextForStop();
        const clientLiveChunks = currentLiveAsrChunksForStop();
        const clientBatchChunks = batchMemoryChunksForStop();
        sessionId = '';
        const { data } = await liveMeetingFetchJson('session_stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sid,
                keep_audio: false,
                ...(clientLiveText ? { client_live_text: clientLiveText } : {}),
                ...(clientLiveChunks.length ? { client_live_chunks: clientLiveChunks } : {}),
                ...(clientBatchChunks.length ? { client_batch_chunks: clientBatchChunks } : {}),
            }),
            signal,
        });
        const row = data?.data && typeof data.data === 'object' ? data.data : data;
        return row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    }

    function stopMicUplink() {
        if (uplink) {
            try {
                uplink.stop();
            } catch {
                /* ignore */
            }
            uplink = null;
        }
    }

    function stopUplink() {
        stopMicUplink();
        closeSse();
    }

    async function stopRecording() {
        if (!recording) return;
        recording = false;
        stopPhaseActive = true;
        lockComposerForPolish();
        btn.classList.remove('is-recording');
        dropup.arrowBtn.disabled = false;
        levelFill.style.height = '0%';

        const uplinkRef = uplink;
        stopMicUplink();
        if (uplinkRef) {
            try {
                localRecordingBlob =
                    typeof uplinkRef.getRecordingWavBlob === 'function' ? uplinkRef.getRecordingWavBlob() : null;
                localRecordingSec =
                    typeof uplinkRef.getRecordingSeconds === 'function' ? uplinkRef.getRecordingSeconds() : 0;
            } catch {
                /* ignore */
            }
        }
        uplink = null;
        snapshotClientVoiceStats();
        const rawForPolish = liveTextBest || liveDisplayText() || currentLiveAsrTextForStop();
        if (rawForPolish) {
            applyPolishedComposerText(quickPunctuateTranscript(rawForPolish), false);
            publishVoiceSessionStats(polishConfigured ? 'quick' : 'raw');
            showStopPhaseUi(Boolean(polishConfigured));
        } else {
            showStopPhaseUi(polishConfigured);
        }

        try {
            fullPolishReceived = false;
            const polishWait = waitForFullSessionPolish(15000);
            const stopResult = await stopSession();
            await polishWait;
            applyStopTranscriptStats(stopResult);
        } finally {
            releaseFullPolishWait();
            closeSse();
            clearStopPhaseUi();
            stopPhaseActive = false;
        }
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
        quickPunctuateRules =
            session.quick_punctuate_rules && typeof session.quick_punctuate_rules === 'object'
                ? /** @type {Record<string, unknown>} */ (session.quick_punctuate_rules)
                : null;
        polishConfigured = Boolean(session.polish_configured);
        sessionLocale = String(session.locale ?? '').trim() || composerUiLocale();
        voiceStats = { ...voiceStats, locale: sessionLocale };
        liveStreamConfigured = Boolean(session.live_stream_configured);
        batchAsrConfigured = Boolean(session.batch_asr_configured);
        if (!liveStreamConfigured && !batchAsrConfigured) {
            liveStreamConfigured = true;
        }
        nextSegmentId = 0;
        stopPhaseActive = false;
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
                recordLocal: true,
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
    ensureVoiceStatsUi();
}
