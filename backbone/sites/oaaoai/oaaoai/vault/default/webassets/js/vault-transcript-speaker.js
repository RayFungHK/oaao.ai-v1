/**
 * Vault Speaker Mode transcript viewer — segments, attendees, audio seek.
 *
 * Mounted from {@see vault-panel.js} inside a RazyUI Dialog for audio documents.
 */

/** @typedef {{ speaker_id: number, speaker_label?: string, begin_ms: number, end_ms: number, text: string }} SpeakerSegment */
/** @typedef {{ speaker_id: number, label?: string, display_name?: string, profile_id?: number|null, auto_matched?: boolean, match_confidence?: number|null, utterance_count?: number, total_ms?: number }} SpeakerSummary */
/** @typedef {{ template_id?: string, template_label?: string, template_emoji?: string, summary_language?: string, status?: string, text?: string, generated_at?: string|null, queued_at?: string|null, error?: string|null, embed_to_rag?: boolean, embed_queued_at?: string|null }} TranscriptSummary */
/** @typedef {{ document_id?: number, file_name?: string, mode?: string, source_text?: string, segments?: SpeakerSegment[], speakers?: SpeakerSummary[], duration_sec?: number|null, media_url?: string|null, pseudo_diarization?: boolean, timestamp_source?: string, voiceprint_dim?: number|null, speaker_profiles_matched?: number, summary?: TranscriptSummary|null, summary_configured?: boolean, summary_templates?: SummaryTemplate[], summary_languages?: SummaryLanguage[], default_template_id?: string }} TranscriptPayload */
/** @typedef {{ id: string, label: string, emoji: string, beta?: boolean, default?: boolean, sort?: number }} SummaryTemplate */
/** @typedef {{ id: string, label: string }} SummaryLanguage */
/** @typedef {{ apiBase: string, signal?: AbortSignal, documentId?: number, workspaceId?: number|null, initialBeginMs?: number, onRetranscribe?: () => void|Promise<void>, loadDialog?: () => Promise<unknown> }} TranscriptViewOptions */

/** @type {Record<string, Record<string, string>>} */
const UI = {
    dialog_title: { en: 'View Transcript', 'zh-Hant': '查看轉寫稿' },
    copy: { en: 'Copy', 'zh-Hant': '複製' },
    copied: { en: 'Copied', 'zh-Hant': '已複製' },
    download: { en: 'Download', 'zh-Hant': '下載' },
    download_txt: { en: 'Plain text (.txt)', 'zh-Hant': '純文字 (.txt)' },
    download_md: { en: 'Markdown (.md)', 'zh-Hant': 'Markdown (.md)' },
    export_summary_heading: { en: 'Summary', 'zh-Hant': '摘要' },
    export_transcript_heading: { en: 'Transcript', 'zh-Hant': '轉寫內容' },
    about_heading: { en: 'About the meeting', 'zh-Hant': '關於會議' },
    attendees: { en: 'Attendees', 'zh-Hant': '與會者' },
    transcript_heading: { en: 'Transcript', 'zh-Hant': '轉寫內容' },
    summary_heading: { en: 'Customize Summary', 'zh-Hant': '自訂摘要' },
    summary_hint: {
        en: 'Click Generate to pick a template and run summarisation.',
        'zh-Hant': '按「產生摘要」開啟模板選擇。',
    },
    summary_tpl_dialog_title: { en: 'Choose summary template', 'zh-Hant': '選擇摘要模板' },
    summary_tpl_badge: { en: 'Template', 'zh-Hant': '模板' },
    summary_dialog_cancel: { en: 'Cancel', 'zh-Hant': '取消' },
    summary_dialog_generate: { en: 'Generate', 'zh-Hant': '產生' },
    summary_lang_label: { en: 'Summary language', 'zh-Hant': '摘要語言' },
    summary_embed_rag: {
        en: 'Embed summary into RAG (re-index transcript + summary)',
        'zh-Hant': '將摘要嵌入 RAG（重新索引轉寫稿與摘要）',
    },
    summary_embed_queued: {
        en: 'Summary saved — embedding queued for RAG.',
        'zh-Hant': '摘要已儲存 — 已向量化排程。',
    },
    summary_embed_fail: {
        en: 'Summary saved but embedding could not be queued.',
        'zh-Hant': '摘要已儲存，但無法排程向量化。',
    },
    summary_generate: { en: 'Generate summary', 'zh-Hant': '產生摘要' },
    summary_regenerate: { en: 'Regenerate', 'zh-Hant': '重新產生' },
    summary_generating: { en: 'Generating…', 'zh-Hant': '產生中…' },
    summary_queued: { en: 'Summary queued — processing in background…', 'zh-Hant': '摘要已排程 — 背景處理中…' },
    summary_generating_status: { en: 'Generating summary…', 'zh-Hant': '正在產生摘要…' },
    summary_empty: { en: 'No summary yet — choose a template and generate.', 'zh-Hant': '尚無摘要 — 請選模板後產生。' },
    summary_fail: { en: 'Could not generate summary.', 'zh-Hant': '無法產生摘要。' },
    summary_unconfigured: {
        en: 'Configure ASR Summary in Settings → Purpose allocation to enable templates and generation.',
        'zh-Hant': '請至「設定 → 用途分配」設定 ASR Summary 後才能產生摘要。',
    },
    summary_templates_empty: {
        en: 'No summary templates found — check Docker mount or OAAO_TRANSCRIPT_SUMMARY_TEMPLATES_DIR.',
        'zh-Hant': '找不到摘要模板 — 請確認 Docker 掛載或 OAAO_TRANSCRIPT_SUMMARY_TEMPLATES_DIR。',
    },
    summary_templates_fail: {
        en: 'Could not load summary templates.',
        'zh-Hant': '無法載入摘要模板。',
    },
    summary_beta: { en: 'Beta', 'zh-Hant': 'Beta' },
    no_segments: { en: 'No speaker segments in transcript metadata.', 'zh-Hant': '轉寫資料中沒有說話者分段。' },
    retranscribe_hint_normal: {
        en: 'This file was transcribed in Normal mode — use Re-transcribe to apply Speaker labels.',
        'zh-Hant': '此檔以一般模式轉寫 — 請用「重新轉寫」以套用說話者標記。',
    },
    pseudo_timestamp_hint: {
        en: 'Timestamps are estimated (pseudo diarization) — click a segment to seek; real FunASR diarization improves alignment.',
        'zh-Hant': '時間軸為估算值（偽說話者分段）— 可點分段跳播；啟用真實 FunASR 說話者分離可改善對齊。',
    },
    rename_speaker: { en: 'Rename speaker', 'zh-Hant': '重新命名說話者' },
    rename_save: { en: 'Save', 'zh-Hant': '儲存' },
    rename_cancel: { en: 'Cancel', 'zh-Hant': '取消' },
    rename_fail: { en: 'Could not save speaker name.', 'zh-Hant': '無法儲存說話者名稱。' },
    remember_voice: { en: 'Remember voice in this vault', 'zh-Hant': '記住此 vault 聲紋' },
    auto_matched: { en: 'Auto', 'zh-Hant': '自動' },
    action_retranscribe: { en: 'Re-transcribe', 'zh-Hant': '重新轉寫' },
    plain_heading: { en: 'Transcript', 'zh-Hant': '轉寫內容' },
    play: { en: 'Play', 'zh-Hant': '播放' },
    pause: { en: 'Pause', 'zh-Hant': '暫停' },
    seek_aria: { en: 'Playback position', 'zh-Hant': '播放位置' },
};

/** @param {string} key */
function t(key) {
    const loc =
        (typeof document !== 'undefined' && document.documentElement.lang?.trim()) || 'en';
    const bucket = UI[key];
    if (!bucket) return key;
    return bucket[loc] ?? bucket.en ?? key;
}

/** @type {SummaryLanguage[]} */
const FALLBACK_SUMMARY_LANGUAGES = [
    { id: 'auto', label: 'Auto (match transcript)' },
    { id: 'en', label: 'English' },
    { id: 'zh-Hant', label: '繁體中文' },
    { id: 'zh-Hans', label: '简体中文' },
    { id: 'ja', label: '日本語' },
    { id: 'ko', label: '한국어' },
    { id: 'yue', label: '粵語' },
];

/** @param {TranscriptPayload} data */
function resolveSummaryLanguages(data) {
    const embedded = Array.isArray(data.summary_languages) ? data.summary_languages : [];
    if (embedded.length) {
        return embedded
            .filter((row) => row && typeof row === 'object' && String(row.id ?? '').trim())
            .map((row) => ({ id: String(row.id).trim(), label: String(row.label ?? row.id).trim() }));
    }
    return FALLBACK_SUMMARY_LANGUAGES;
}

function defaultSummaryLanguageCode() {
    const loc = (typeof document !== 'undefined' && document.documentElement.lang?.trim()) || 'en';
    if (/^zh-hant/i.test(loc) || loc === 'zh-TW' || loc === 'zh-HK') return 'zh-Hant';
    if (/^zh/i.test(loc)) return 'zh-Hans';
    if (/^ja/i.test(loc)) return 'ja';
    if (/^ko/i.test(loc)) return 'ko';
    if (/^yue/i.test(loc)) return 'yue';
    return 'auto';
}

/** @param {TranscriptPayload} data @param {HTMLElement} section */
function resolveSelectedSummaryLanguage(data, section) {
    const fromSummary = String(data.summary?.summary_language ?? '').trim();
    if (fromSummary) return fromSummary;
    const fromDataset = String(section.dataset.summaryLanguage ?? '').trim();
    if (fromDataset) return fromDataset;
    return defaultSummaryLanguageCode();
}

/** @type {WeakMap<HTMLElement, ReturnType<typeof setTimeout>|undefined>} */
const summaryPollTimers = new WeakMap();

/** @param {string} status */
function summaryPendingLabel(status) {
    const st = String(status ?? '').trim().toLowerCase();
    if (st === 'generating') return t('summary_generating_status');
    if (st === 'queued') return t('summary_queued');
    return t('summary_generating');
}

/**
 * @param {HTMLElement} section
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 * @param {number|undefined} docId
 * @param {HTMLButtonElement} genBtn
 * @param {HTMLElement} out
 * @param {TranscriptSummary} summary
 */
function applySummaryState(section, data, options, docId, genBtn, out, summary) {
    data.summary = summary;
    syncSummaryTemplateBadge(section, data);

    const status = String(summary.status ?? '').trim().toLowerCase();
    const text = String(summary.text ?? '').trim();

    if (status === 'failed') {
        stopSummaryPoll(section);
        renderSummaryOutput(out, {
            error: String(summary.error ?? '').trim() || t('summary_fail'),
        });
        genBtn.disabled = false;
        genBtn.textContent = text ? t('summary_regenerate') : t('summary_generate');
        return;
    }

    if (status === 'queued' || status === 'generating') {
        renderSummaryOutput(out, { placeholder: summaryPendingLabel(status) });
        genBtn.disabled = true;
        genBtn.textContent = t('summary_generating');
        startSummaryPoll(section, data, options, docId, genBtn, out);
        return;
    }

    stopSummaryPoll(section);
    if (text) {
        renderSummaryOutput(out, { markdown: text, placeholder: t('summary_empty') });
        genBtn.disabled = false;
        genBtn.textContent = t('summary_regenerate');
        return;
    }

    renderSummaryOutput(out, { placeholder: t('summary_empty') });
    genBtn.disabled = false;
    genBtn.textContent = t('summary_generate');
}

/** @param {HTMLElement} section */
function stopSummaryPoll(section) {
    const prev = summaryPollTimers.get(section);
    if (prev) clearTimeout(prev);
    summaryPollTimers.delete(section);
}

/**
 * @param {HTMLElement} section
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 * @param {number|undefined} docId
 * @param {HTMLButtonElement} genBtn
 * @param {HTMLElement} out
 */
function startSummaryPoll(section, data, options, docId, genBtn, out) {
    stopSummaryPoll(section);
    const id = Math.floor(Number(docId));
    if (!Number.isFinite(id) || id < 1) return;

    let attempts = 0;
    const maxAttempts = 120;

    const tick = async () => {
        if (options.signal?.aborted) {
            stopSummaryPoll(section);
            return;
        }

        attempts += 1;
        const apiBase = resolveTranscriptApiBase(section, options);
        if (!apiBase) return;

        let url = `${apiBase}document_transcript?document_id=${encodeURIComponent(String(id))}`;
        if (options.workspaceId != null && options.workspaceId > 0) {
            url += `&workspace_id=${encodeURIComponent(String(options.workspaceId))}`;
        }

        try {
            const res = await fetch(url, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
                cache: 'no-store',
                signal: options.signal,
            });
            /** @type {{ success?: boolean, data?: TranscriptPayload }} */
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success !== true || !json.data?.summary) {
                if (attempts >= maxAttempts) {
                    stopSummaryPoll(section);
                    genBtn.disabled = false;
                } else {
                    summaryPollTimers.set(section, setTimeout(tick, 2000));
                }
                return;
            }

            const summary = json.data.summary;
            const status = String(summary.status ?? '').trim().toLowerCase();
            const text = String(summary.text ?? '').trim();

            if (status === 'queued' || status === 'generating') {
                renderSummaryOutput(out, { placeholder: summaryPendingLabel(status) });
                if (attempts < maxAttempts) {
                    summaryPollTimers.set(section, setTimeout(tick, 2000));
                } else {
                    stopSummaryPoll(section);
                    genBtn.disabled = false;
                }
                return;
            }

            applySummaryState(section, data, options, docId, genBtn, out, summary);
            if (status === 'completed' || text) {
                document.dispatchEvent(new CustomEvent('oaao:vault-tree-invalidate'));
            }
        } catch {
            if (attempts < maxAttempts) {
                summaryPollTimers.set(section, setTimeout(tick, 2000));
            } else {
                stopSummaryPoll(section);
                genBtn.disabled = false;
            }
        }
    };

    summaryPollTimers.set(section, setTimeout(tick, 1500));
}

/** @param {string} pathOnly */
function oaaoPrefixedSitePath(pathOnly) {
    const raw = (typeof document !== 'undefined' && document.body.dataset?.oaaoMountPrefix)?.trim() ?? '';
    const path = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
    if (!raw || raw === '/') return path;
    const prefix = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/{2,}/g, '/').replace(/\/$/, '');
    if (!prefix) return path;
    if (path === prefix || path.startsWith(`${prefix}/`)) return path;

    return `${prefix}${path}`;
}

/** @type {Promise<Record<string, unknown>> | null} */
let vaultSummaryMarkdownPromise = null;

/** @type {Record<string, Function> | null} */
let vaultSummaryMd = null;

const VAULT_SUMMARY_MD_OPTS = { preset: 'oaao-chat' };

function loadVaultSummaryMarkdownHelpers() {
    if (!vaultSummaryMarkdownPromise) {
        const url = oaaoPrefixedSitePath('/webassets/core/default/razyui/component/MarkdownHelpers.js');
        vaultSummaryMarkdownPromise = import(/* webpackIgnore: true */ url).then((mod) => {
            vaultSummaryMd = /** @type {Record<string, Function>} */ (mod);
            return mod;
        });
    }

    return vaultSummaryMarkdownPromise;
}

/** @param {string} md */
function vaultSummaryMarkdownToHtml(md) {
    if (!vaultSummaryMd || typeof vaultSummaryMd.parseSafe !== 'function') return '';
    return String(vaultSummaryMd.parseSafe(md, VAULT_SUMMARY_MD_OPTS));
}

/**
 * Plain-text fallback when {@link parseSafe} or math render fails (never JIT-hydrate model HTML).
 *
 * @param {HTMLElement} out
 * @param {string} markdown
 */
function renderSummaryPlainFallback(out, markdown) {
    out.classList.remove('oaao-md-bubble');
    out.innerHTML = '';
    out.textContent = markdown;
    out.style.whiteSpace = 'pre-wrap';
}

/**
 * @param {HTMLElement} out
 * @param {{ markdown?: string, placeholder?: string, error?: string }} opts
 */
export function renderSummaryOutput(out, opts) {
    const markdown = String(opts.markdown ?? '').trim();
    const placeholder = String(opts.placeholder ?? '').trim();
    const error = String(opts.error ?? '').trim();

    out.classList.remove('oaao-md-bubble', 'fg-[var(--grid-caption)]', 'italic');
    out.style.whiteSpace = '';

    if (error) {
        out.textContent = error;
        out.classList.add('fg-[var(--grid-caption)]');
        return;
    }

    if (!markdown) {
        out.textContent = placeholder;
        if (placeholder) out.classList.add('fg-[var(--grid-caption)]', 'italic');
        return;
    }

    void loadVaultSummaryMarkdownHelpers()
        .then(() => {
            let html = '';
            try {
                html = vaultSummaryMarkdownToHtml(markdown);
            } catch (err) {
                console.warn('[oaao vault] summary markdown parse failed', err);
                renderSummaryPlainFallback(out, markdown);
                return;
            }

            if (!html.trim()) {
                renderSummaryPlainFallback(out, markdown);
                return;
            }

            out.classList.add('oaao-md-bubble');
            out.style.whiteSpace = '';
            out.innerHTML = html;

            if (vaultSummaryMd && typeof vaultSummaryMd.renderMathInElement === 'function') {
                void vaultSummaryMd.renderMathInElement(out).catch((err) => {
                    console.warn('[oaao vault] summary math render failed', err);
                });
            }
        })
        .catch((err) => {
            console.warn('[oaao vault] summary markdown helpers failed', err);
            renderSummaryPlainFallback(out, markdown);
        });
}

/** @param {number} ms */
export function formatTimestampMs(ms) {
    const totalSec = Math.max(0, Math.floor(Number(ms) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** @param {number} sec */
export function formatDurationSec(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '00:00';
    return formatTimestampMs(sec * 1000).replace(/^00:/, '');
}

/** @param {number} speakerId */
export function speakerAvatarText(speakerId) {
    const n = Math.max(0, Math.floor(Number(speakerId) || 0)) + 1;
    return `S${n}`;
}

/** @param {number} speakerId */
function speakerAccentHue(speakerId) {
    const hues = [210, 160, 28, 280, 12, 190, 330, 95];
    return hues[Math.max(0, speakerId) % hues.length];
}

/** @param {string} name */
function sanitizeDownloadBasename(name) {
    const base = String(name ?? '')
        .trim()
        .replace(/\.[a-z0-9]{1,8}$/i, '')
        .replace(/[^\w\u4e00-\u9fff.\- ]+/gu, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    return (base || 'transcript').slice(0, 120);
}

/**
 * @param {TranscriptPayload} data
 * @param {number} speakerId
 * @param {string} fallback
 */
function resolveSpeakerExportLabel(data, speakerId, fallback) {
    const sid = Math.max(0, Math.floor(Number(speakerId) || 0));
    for (const sp of data.speakers ?? []) {
        if (Math.floor(Number(sp.speaker_id) || 0) !== sid) continue;
        const name = String(sp.display_name ?? sp.label ?? '').trim();
        if (name) return name;
    }
    return String(fallback ?? '').trim() || `Speaker ${sid + 1}`;
}

/** @param {TranscriptPayload} data */
function exportSummaryText(data) {
    const summary = data.summary;
    if (!summary || typeof summary !== 'object') return '';
    const status = String(summary.status ?? '').trim().toLowerCase();
    if (status === 'queued' || status === 'generating' || status === 'failed') return '';
    return String(summary.text ?? '').trim();
}

/**
 * @param {TranscriptPayload} data
 * @param {boolean} isSpeaker
 * @returns {Array<{ ts: string, who: string, text: string }>}
 */
function exportTranscriptRows(data, isSpeaker) {
    if (isSpeaker && Array.isArray(data.segments) && data.segments.length > 0) {
        return data.segments
            .map((seg) => {
                const sid = Math.max(0, Math.floor(Number(seg.speaker_id) || 0));
                const fallback = String(seg.speaker_label ?? `Speaker ${sid + 1}`).trim();
                return {
                    ts: formatTimestampMs(Math.max(0, Number(seg.begin_ms) || 0)),
                    who: resolveSpeakerExportLabel(data, sid, fallback),
                    text: String(seg.text ?? '').trim(),
                };
            })
            .filter((row) => row.text !== '');
    }
    const plain = String(data.source_text ?? '').trim();
    if (!plain) return [];
    return [{ ts: '', who: '', text: plain }];
}

/**
 * @param {TranscriptPayload} data
 * @param {'txt' | 'markdown'} format
 */
export function composeTranscriptExport(data, format) {
    const mode = String(data.mode ?? 'normal').trim().toLowerCase();
    const isSpeaker = mode === 'speaker' && Array.isArray(data.segments) && data.segments.length > 0;
    const fileName = String(data.file_name ?? '').trim() || `document-${data.document_id ?? ''}`;
    const summaryText = exportSummaryText(data);
    const rows = exportTranscriptRows(data, isSpeaker);
    const asMd = format === 'markdown';
    const parts = [];

    if (asMd) {
        parts.push(`# ${fileName}`, '');
        if (summaryText) {
            parts.push(`## ${t('export_summary_heading')}`, '', summaryText, '');
        }
        parts.push(`## ${t('export_transcript_heading')}`, '');
        if (isSpeaker) {
            for (const row of rows) {
                parts.push(`### [${row.ts}] ${row.who}`, '', row.text, '');
            }
        } else if (rows[0]) {
            parts.push(rows[0].text);
        }
    } else {
        const underline = '='.repeat(Math.min(Math.max(fileName.length, 8), 72));
        parts.push(fileName, underline, '');
        if (summaryText) {
            parts.push(`--- ${t('export_summary_heading')} ---`, '', summaryText, '');
        }
        parts.push(`--- ${t('export_transcript_heading')} ---`, '');
        if (isSpeaker) {
            for (const row of rows) {
                parts.push(`[${row.ts}] ${row.who}`, row.text, '');
            }
        } else if (rows[0]) {
            parts.push(rows[0].text);
        }
    }

    const body = parts.join('\n').trimEnd();
    return body ? `${body}\n` : '';
}

/**
 * @param {TranscriptPayload} data
 * @param {'txt' | 'markdown'} format
 */
export function downloadTranscriptExport(data, format) {
    const content = composeTranscriptExport(data, format);
    const ext = format === 'markdown' ? 'md' : 'txt';
    const mime =
        format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const filename = `${sanitizeDownloadBasename(data.file_name)}.${ext}`;
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

const DOWNLOAD_BTN_CLASS =
    'shrink-0 rounded-[8px] h-8 px-2.5 text-[0.72rem] fw-semibold border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] cursor-pointer font-inherit fg-[var(--grid-ink)] hover:bg-[var(--grid-line)]/20';

/** @param {TranscriptPayload} data */
function buildDownloadMenu(data) {
    const wrap = document.createElement('div');
    wrap.className = 'relative shrink-0';
    wrap.setAttribute('data-oaao-vault-transcript-download', '');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = DOWNLOAD_BTN_CLASS;
    trigger.textContent = t('download');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.hidden = true;
    menu.className =
        'absolute right-0 top-[calc(100%+4px)] z-[10050] min-w-[11rem] py-1 rounded-[8px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[var(--oaao-surface-shadow)] flex flex-col';
    menu.setAttribute('role', 'menu');

    const setOpen = (open) => {
        menu.hidden = !open;
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    /**
     * @param {string} label
     * @param {'txt' | 'markdown'} format
     */
    const addItem = (label, format) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.role = 'menuitem';
        btn.className =
            'w-full text-left px-3 py-2 text-[0.72rem] font-inherit fg-[var(--grid-ink)] bg-transparent border-0 cursor-pointer hover:bg-[var(--grid-line)]/25';
        btn.textContent = label;
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            downloadTranscriptExport(data, format);
            setOpen(false);
        });
        menu.append(btn);
    };

    addItem(t('download_txt'), 'txt');
    addItem(t('download_md'), 'markdown');

    trigger.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const willOpen = menu.hidden;
        setOpen(willOpen);
        if (willOpen) {
            const closeOnOutside = (outsideEv) => {
                if (!(outsideEv.target instanceof Node) || wrap.contains(outsideEv.target)) return;
                setOpen(false);
                document.removeEventListener('pointerdown', closeOnOutside, true);
            };
            document.addEventListener('pointerdown', closeOnOutside, true);
        }
    });

    wrap.append(trigger, menu);
    return wrap;
}

/**
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 * @returns {HTMLElement}
 */
export function buildTranscriptView(data, options) {
    const mode = String(data.mode ?? 'normal').trim().toLowerCase();
    const isSpeaker = mode === 'speaker' && Array.isArray(data.segments) && data.segments.length > 0;

    const root = document.createElement('div');
    root.className =
        'flex flex-col flex-1 min-h-0 h-full w-full min-w-0 text-[0.8125rem] fg-[var(--grid-ink)]';

    const shell = document.createElement('div');
    shell.className =
        'flex flex-col flex-1 min-h-0 min-w-0 w-full border border-solid border-[var(--grid-line)] rounded-[10px] overflow-hidden bg-[var(--grid-panel-bright)]';

    shell.append(buildFileInfoHeader(data, options, isSpeaker));

    const body = document.createElement('div');
    body.className = 'flex flex-1 min-h-0 min-w-0 w-full flex-row gap-0 overflow-hidden';

    const midCol = buildSummarySection(data, options);
    const rightCol = isSpeaker
        ? buildSpeakerTranscriptColumn(data, options)
        : buildPlainTranscriptColumn(data, options);

    body.append(midCol, rightCol);
    shell.append(body);
    root.append(shell);

    if (data.media_url) {
        root.append(buildAudioBar(data, options));
    }

    return root;
}

/**
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 */
function buildSummarySection(data, options) {
    const summaryConfigured = data.summary_configured === true;

    const section = document.createElement('section');
    section.className =
        'flex-[7] basis-[70%] min-w-[min(480px,70%)] max-w-[70%] flex flex-col gap-2 min-h-0 h-full p-3 border-r border-solid border-[var(--grid-line)] bg-[var(--grid-panel)] overflow-hidden';
    section.setAttribute('data-oaao-vault-summary-section', '');

    const head = document.createElement('div');
    head.className = 'flex flex-row items-center justify-between gap-2 shrink-0 min-w-0';

    const headLeft = document.createElement('div');
    headLeft.className = 'flex flex-row items-center gap-2 min-w-0 flex-1';

    const title = document.createElement('h3');
    title.className = 'text-[0.8125rem] fw-semibold m-0 shrink-0';
    title.textContent = t('summary_heading');
    headLeft.append(title);

    const tplBadge = document.createElement('span');
    tplBadge.className =
        'hidden text-[0.68rem] fg-[var(--grid-caption)] truncate min-w-0 max-w-[min(14rem,42%)]';
    tplBadge.setAttribute('data-oaao-vault-summary-template-badge', '');
    headLeft.append(tplBadge);

    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className =
        'shrink-0 rounded-[8px] h-8 px-2.5 text-[0.72rem] fw-semibold border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/20 disabled:opacity-50 disabled:cursor-not-allowed';
    genBtn.setAttribute('data-oaao-vault-summary-generate', '');
    genBtn.textContent = data.summary?.text ? t('summary_regenerate') : t('summary_generate');
    genBtn.disabled = !summaryConfigured;

    head.append(headLeft, genBtn);

    const outScroll = document.createElement('div');
    outScroll.className =
        'flex-1 min-h-[6rem] overflow-y-auto overscroll-contain rounded-[8px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] p-2.5';
    outScroll.setAttribute('data-oaao-vault-summary-output', '');

    const out = document.createElement('div');
    out.className = 'text-[0.8125rem] m-0 leading-relaxed break-words fg-[var(--grid-ink)]';

    const summaryText = String(data.summary?.text ?? '').trim();
    const summaryStatus = String(data.summary?.status ?? '').trim().toLowerCase();
    if (summaryStatus === 'queued' || summaryStatus === 'generating') {
        renderSummaryOutput(out, { placeholder: summaryPendingLabel(summaryStatus) });
        genBtn.disabled = true;
        genBtn.textContent = t('summary_generating');
    } else {
        renderSummaryOutput(out, {
            markdown: summaryText,
            placeholder: summaryConfigured ? t('summary_empty') : t('summary_unconfigured'),
        });
    }

    section.append(head, outScroll);
    outScroll.append(out);

    syncSummaryTemplateBadge(section, data);

    const docId = options.documentId ?? data.document_id;

    if (summaryStatus === 'queued' || summaryStatus === 'generating') {
        startSummaryPoll(section, data, options, docId, genBtn, out);
    }

    genBtn.addEventListener('click', () => {
        if (!summaryConfigured) return;
        void openSummaryTemplateDialog(section, data, options, docId, genBtn, out);
    });

    return section;
}

/**
 * @param {HTMLElement} section
 * @param {TranscriptPayload} data
 */
function syncSummaryTemplateBadge(section, data) {
    const badge = section.querySelector('[data-oaao-vault-summary-template-badge]');
    if (!(badge instanceof HTMLElement)) return;

    const tid = String(data.summary?.template_id ?? section.dataset.selectedTemplate ?? '').trim();
    const label = String(data.summary?.template_label ?? '').trim();
    const emoji = String(data.summary?.template_emoji ?? '').trim();

    if (!tid && !label) {
        badge.classList.add('hidden');
        badge.textContent = '';
        badge.removeAttribute('title');
        return;
    }

    const text = emoji && label ? `${emoji} ${label}` : label || tid;
    badge.textContent = text;
    const lang = String(data.summary?.summary_language ?? section.dataset.summaryLanguage ?? '').trim();
    const langNote = lang && lang !== 'auto' ? ` · ${lang}` : '';
    badge.title = `${t('summary_tpl_badge')}: ${text}${langNote}`;
    badge.classList.remove('hidden');
}

/**
 * @param {HTMLElement} section
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 * @returns {Promise<{ templates: SummaryTemplate[], defaultId: string }|null>}
 */
async function fetchSummaryTemplates(section, data, options) {
    const embedded = Array.isArray(data.summary_templates) ? data.summary_templates : [];
    const defaultId = String(data.default_template_id ?? 'general-meeting');
    if (embedded.length) {
        return { templates: embedded, defaultId };
    }

    const apiBase = resolveTranscriptApiBase(section, options);
    if (!apiBase) return null;

    let url = `${apiBase}transcript_summary_templates`;
    if (options.workspaceId != null && options.workspaceId > 0) {
        url += `?workspace_id=${encodeURIComponent(String(options.workspaceId))}`;
    }

    try {
        const res = await fetch(url, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal: options.signal,
        });
        /** @type {{ success?: boolean, data?: { templates?: SummaryTemplate[], default_template_id?: string } }} */
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success !== true || !json.data) return null;

        const templates = Array.isArray(json.data.templates) ? json.data.templates : [];
        if (!templates.length) return null;

        return {
            templates,
            defaultId: String(json.data.default_template_id ?? defaultId),
        };
    } catch {
        return null;
    }
}

/**
 * @param {HTMLElement} section
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 * @param {number|undefined} docId
 * @param {HTMLButtonElement} genBtn
 * @param {HTMLElement} out
 */
async function openSummaryTemplateDialog(section, data, options, docId, genBtn, out) {
    const loadDialog = options.loadDialog;
    const pack = await fetchSummaryTemplates(section, data, options);
    if (!pack || !pack.templates.length) {
        return;
    }

    const DialogCtor = typeof loadDialog === 'function' ? await loadDialog() : null;
    if (!DialogCtor || typeof /** @type {{ open?: unknown }} */ (DialogCtor).open !== 'function') {
        return;
    }

    const { templates, defaultId } = pack;
    let selected =
        String(data.summary?.template_id ?? section.dataset.selectedTemplate ?? defaultId).trim() ||
        defaultId;
    let summaryLanguage = resolveSelectedSummaryLanguage(data, section);
    let embedToRag =
        section.dataset.summaryEmbedRag === '0'
            ? false
            : section.dataset.summaryEmbedRag === '1'
              ? true
              : data.summary?.embed_to_rag !== false;

    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-2 min-w-0 w-full max-h-[min(62vh,520px)]';

    const controls = document.createElement('div');
    controls.className = 'flex flex-col sm:flex-row sm:items-end gap-2 shrink-0 min-w-0';

    const langWrap = document.createElement('label');
    langWrap.className = 'flex flex-col gap-1 min-w-0 flex-1';
    const langLab = document.createElement('span');
    langLab.className = 'text-[0.68rem] fw-semibold fg-[var(--grid-caption)]';
    langLab.textContent = t('summary_lang_label');
    const langSel = document.createElement('select');
    langSel.className =
        'h-8 rounded-[8px] px-2 text-[0.72rem] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] font-inherit min-w-0 w-full';
    langSel.setAttribute('data-oaao-vault-summary-language', '');
    for (const lang of resolveSummaryLanguages(data)) {
        const opt = document.createElement('option');
        opt.value = lang.id;
        opt.textContent = lang.label;
        langSel.append(opt);
    }
    langSel.value = summaryLanguage;
    langSel.addEventListener('change', () => {
        summaryLanguage = String(langSel.value ?? 'auto').trim() || 'auto';
        section.dataset.summaryLanguage = summaryLanguage;
    });
    langWrap.append(langLab, langSel);

    const embedWrap = document.createElement('label');
    embedWrap.className =
        'flex flex-row items-center gap-2 min-w-0 sm:max-w-[min(18rem,48%)] cursor-pointer select-none pb-0.5';
    const embedChk = document.createElement('input');
    embedChk.type = 'checkbox';
    embedChk.className = 'shrink-0';
    embedChk.checked = embedToRag;
    embedChk.setAttribute('data-oaao-vault-summary-embed-rag', '');
    embedChk.addEventListener('change', () => {
        embedToRag = embedChk.checked;
        section.dataset.summaryEmbedRag = embedToRag ? '1' : '0';
    });
    const embedLab = document.createElement('span');
    embedLab.className = 'text-[0.68rem] leading-snug fg-[var(--grid-ink-muted)]';
    embedLab.textContent = t('summary_embed_rag');
    embedWrap.append(embedChk, embedLab);

    controls.append(langWrap, embedWrap);

    const grid = document.createElement('div');
    grid.className =
        'flex-1 min-h-[10rem] overflow-y-auto overscroll-contain grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-0.5 min-w-0';

    renderSummaryTemplateGrid(grid, section, data, templates, defaultId, (id) => {
        selected = id;
        section.dataset.selectedTemplate = id;
    });

    wrap.append(controls, grid);

    const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
    if (JIT && typeof JIT.hydrate === 'function') JIT.hydrate(wrap);

    /** @type {{ open: (o: Record<string, unknown>) => unknown }} */
    const Dialog = /** @type {{ open: (o: Record<string, unknown>) => unknown }} */ (DialogCtor);

    Dialog.open({
        title: t('summary_tpl_dialog_title'),
        content: wrap,
        size: 'md',
        closable: true,
        buttons: [
            {
                text: t('summary_dialog_cancel'),
                color: 'muted',
                action: async () => true,
            },
            {
                text: t('summary_dialog_generate'),
                color: 'accent',
                action: async () => {
                    const tid = String(section.dataset.selectedTemplate ?? selected).trim();
                    if (!tid) return false;
                    selected = tid;
                    summaryLanguage =
                        String(langSel.value ?? section.dataset.summaryLanguage ?? summaryLanguage).trim() ||
                        'auto';
                    section.dataset.summaryLanguage = summaryLanguage;
                    embedToRag = embedChk.checked;
                    section.dataset.summaryEmbedRag = embedToRag ? '1' : '0';
                    return runSummaryGeneration(
                        section,
                        data,
                        options,
                        docId,
                        tid,
                        summaryLanguage,
                        embedToRag,
                        genBtn,
                        out,
                    );
                },
            },
        ],
        onOpen(ctrl) {
            if (JIT && typeof JIT.hydrate === 'function') {
                JIT.hydrate(/** @type {HTMLElement} */ (ctrl?.body ?? wrap));
            }
        },
    });
}

/**
 * @param {HTMLElement} section
 * @param {TranscriptViewOptions} options
 */
function resolveTranscriptApiBase(section, options) {
    const root = section.closest('[data-oaao-vault-transcript-root]');
    const raw = String(root?.getAttribute('data-api-base') ?? options.apiBase ?? '').trim();
    if (!raw) return '';
    return raw.endsWith('/') ? raw : `${raw}/`;
}

/**
 * @param {HTMLElement} tplHost
 * @param {HTMLElement} section
 * @param {TranscriptPayload} data
 * @param {SummaryTemplate[]} templates
 * @param {string} defaultId
 * @param {(id: string) => void} onSelect
 */
function renderSummaryTemplateGrid(tplHost, section, data, templates, defaultId, onSelect) {
    if (!templates.length) {
        tplHost.textContent = t('summary_templates_empty');
        return;
    }

    let selected =
        String(data.summary?.template_id ?? '').trim() ||
        String(section.dataset.selectedTemplate ?? '').trim() ||
        defaultId;

    tplHost.replaceChildren();
    for (const tpl of templates) {
        if (!tpl || typeof tpl !== 'object') continue;
        const id = String(tpl.id ?? '').trim();
        if (!id) continue;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'flex flex-row items-center gap-1 min-w-0 text-left rounded-[8px] px-2 py-1.5 text-[0.72rem] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] cursor-pointer font-inherit hover:border-[var(--grid-accent)]/50';
        btn.setAttribute('data-template-id', id);
        btn.title = String(tpl.label ?? id);

        const em = document.createElement('span');
        em.className = 'shrink-0';
        em.textContent = String(tpl.emoji ?? '📝');
        em.setAttribute('aria-hidden', 'true');

        const lab = document.createElement('span');
        lab.className = 'truncate flex-1 min-w-0';
        lab.textContent = String(tpl.label ?? id);

        btn.append(em, lab);

        if (tpl.beta) {
            const b = document.createElement('span');
            b.className =
                'shrink-0 text-[0.58rem] uppercase tracking-wide px-0.5 rounded fg-[var(--grid-caption)]';
            b.textContent = t('summary_beta');
            btn.append(b);
        }

        const markSelected = () => {
            tplHost.querySelectorAll('[data-template-id]').forEach((node) => {
                if (!(node instanceof HTMLButtonElement)) return;
                const on = node.getAttribute('data-template-id') === selected;
                node.classList.toggle('border-[var(--grid-accent)]', on);
                node.classList.toggle('ring-1', on);
                node.classList.toggle('ring-[var(--grid-accent)]', on);
                node.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        };

        btn.addEventListener('click', () => {
            selected = id;
            onSelect(id);
            markSelected();
        });

        tplHost.append(btn);
    }

    if (!tplHost.querySelector(`[data-template-id="${selected}"]`) && templates[0]) {
        selected = String(templates[0].id ?? defaultId);
        onSelect(selected);
    } else {
        onSelect(selected);
    }

    tplHost.querySelectorAll('[data-template-id]').forEach((node) => {
        if (!(node instanceof HTMLButtonElement)) return;
        const on = node.getAttribute('data-template-id') === selected;
        node.classList.toggle('border-[var(--grid-accent)]', on);
        node.classList.toggle('ring-1', on);
        node.classList.toggle('ring-[var(--grid-accent)]', on);
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

/**
 * @param {HTMLElement} section
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 * @param {number|undefined} docId
 * @param {string} templateId
 * @param {string} summaryLanguage
 * @param {boolean} embedToRag
 * @param {HTMLButtonElement} genBtn
 * @param {HTMLElement} out
 * @returns {Promise<boolean>}
 */
async function runSummaryGeneration(
    section,
    data,
    options,
    docId,
    templateId,
    summaryLanguage,
    embedToRag,
    genBtn,
    out,
) {
    const id = Math.floor(Number(docId));
    if (!Number.isFinite(id) || id < 1 || !templateId) return false;

    const apiBase = resolveTranscriptApiBase(section, options);
    if (!apiBase) {
        renderSummaryOutput(out, { error: t('summary_fail') });
        return false;
    }

    const idle = data.summary?.text ? t('summary_regenerate') : t('summary_generate');

    /** @type {Record<string, unknown>} */
    const body = {
        document_id: id,
        template_id: templateId,
        summary_language: summaryLanguage,
        embed_to_rag: embedToRag,
        regenerate: true,
    };
    if (options.workspaceId != null && options.workspaceId > 0) {
        body.workspace_id = options.workspaceId;
    }

    try {
        const res = await fetch(`${apiBase}document_transcript_summary`, {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: options.signal,
        });
        /** @type {{ success?: boolean, message?: string, data?: { summary?: TranscriptSummary, queued?: boolean, cached?: boolean } }} */
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success !== true || !json.data?.summary) {
            renderSummaryOutput(out, {
                error:
                    typeof json.message === 'string' && json.message.trim()
                        ? json.message.trim()
                        : t('summary_fail'),
            });
            return false;
        }

        if (json.data.cached) {
            applySummaryState(section, data, options, docId, genBtn, out, json.data.summary);
            return true;
        }

        applySummaryState(section, data, options, docId, genBtn, out, json.data.summary);
        document.dispatchEvent(new CustomEvent('oaao:vault-tree-invalidate'));
        return true;
    } catch {
        renderSummaryOutput(out, { error: t('summary_fail') });
        genBtn.disabled = false;
        genBtn.textContent = idle;
        return false;
    }
}

/**
 * Top bar — file name + duration on one line; speaker mode adds a single horizontal chip row.
 *
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 * @param {boolean} isSpeaker
 */
function buildFileInfoHeader(data, options, isSpeaker) {
    const header = document.createElement('header');
    header.className =
        'shrink-0 flex flex-col gap-2 min-w-0 w-full px-3 py-2.5 border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel)]';

    const metaRow = document.createElement('div');
    metaRow.className = 'flex flex-row items-center gap-2 min-w-0 w-full';

    const file = document.createElement('span');
    file.className = 'text-[0.8125rem] fw-semibold truncate min-w-0 flex-1';
    file.title = String(data.file_name ?? '').trim() || `#${data.document_id ?? ''}`;
    file.textContent = file.title;
    metaRow.append(file);

    if (data.duration_sec != null && Number.isFinite(Number(data.duration_sec))) {
        const sep = document.createElement('span');
        sep.className = 'shrink-0 fg-[var(--grid-caption)]';
        sep.textContent = '·';
        sep.setAttribute('aria-hidden', 'true');

        const dur = document.createElement('span');
        dur.className = 'shrink-0 text-[0.72rem] fg-[var(--grid-caption)] font-mono tabular-nums';
        dur.textContent = formatDurationSec(Number(data.duration_sec));
        metaRow.append(sep, dur);
    }

    const actions = document.createElement('div');
    actions.className = 'shrink-0 flex flex-row items-center gap-1.5 ml-auto';
    actions.append(buildDownloadMenu(data));
    metaRow.append(actions);

    header.append(metaRow);

    if (!isSpeaker) {
        return header;
    }

    const speakers =
        Array.isArray(data.speakers) && data.speakers.length
            ? data.speakers
            : inferSpeakersFromSegments(data.segments ?? []);

    if (!speakers.length) {
        return header;
    }

    const list = document.createElement('ul');
    list.className =
        'list-none m-0 p-0 flex flex-row flex-nowrap items-stretch gap-1.5 min-w-0 w-full overflow-x-auto overscroll-contain';
    list.setAttribute('data-oaao-vault-speaker-list', '');

    for (const sp of speakers) {
        list.append(buildSpeakerChip(sp, data, options));
    }

    header.append(list);
    return header;
}

/** @deprecated use buildFileInfoHeader */
function buildFileInfoColumn(data, options, isSpeaker) {
    return buildFileInfoHeader(data, options, isSpeaker);
}

/** @deprecated use buildFileInfoColumn — kept for grep stability */
function buildSpeakerSidebar(data, options) {
    return buildFileInfoColumn(data, options, true);
}

/**
 * Compact horizontal speaker chip for the top bar.
 *
 * @param {SpeakerSummary} sp
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 */
function buildSpeakerChip(sp, data, options) {
    const li = document.createElement('li');
    li.className = 'shrink-0 min-w-0 max-w-[11rem]';

    const sid = Math.max(0, Math.floor(Number(sp.speaker_id) || 0));
    li.setAttribute('data-speaker-id', String(sid));

    const card = document.createElement('div');
    card.className =
        'flex flex-row items-center gap-1.5 min-w-0 h-full rounded-[8px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-2 py-1';

    const av = document.createElement('span');
    av.className =
        'inline-flex items-center justify-center shrink-0 w-6 h-6 rounded-full text-[0.58rem] fw-bold text-white';
    av.style.backgroundColor = `hsl(${speakerAccentHue(sid)} 55% 42%)`;
    av.textContent = speakerAvatarText(sid);
    av.setAttribute('aria-hidden', 'true');

    const labWrap = document.createElement('div');
    labWrap.className = 'min-w-0 flex-1 flex flex-row items-center gap-0.5';

    const lab = document.createElement('button');
    lab.type = 'button';
    lab.className =
        'truncate text-[0.72rem] text-left bg-transparent border-0 p-0 cursor-pointer font-inherit fg-[var(--grid-ink)] hover:underline min-w-0 flex-1';
    lab.title = t('rename_speaker');
    lab.setAttribute('data-oaao-vault-speaker-label', '');
    lab.textContent = String(sp.display_name ?? sp.label ?? `Speaker ${sid + 1}`);

    lab.addEventListener('click', () => {
        void openSpeakerRename(sp, data, options, labWrap);
    });

    labWrap.append(lab);

    if (sp.auto_matched) {
        const badge = document.createElement('span');
        badge.className =
            'shrink-0 text-[0.55rem] uppercase tracking-wide px-0.5 rounded fg-[var(--grid-accent)] fw-semibold';
        badge.title =
            sp.match_confidence != null && Number.isFinite(Number(sp.match_confidence))
                ? `${t('auto_matched')} (${Math.round(Number(sp.match_confidence) * 100)}%)`
                : t('auto_matched');
        badge.textContent = '✓';
        labWrap.append(badge);
    }

    card.append(av, labWrap);

    li.append(card);
    return li;
}

/**
 * @param {SpeakerSummary} sp
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 */
function buildSpeakerListItem(sp, data, options) {
    return buildSpeakerChip(sp, data, options);
}

/**
 * @param {SpeakerSummary} sp
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 * @param {HTMLElement} labWrap
 */
async function openSpeakerRename(sp, data, options, labWrap) {
    const docId = options.documentId ?? data.document_id;
    if (!docId || docId < 1) return;

    const sid = Math.max(0, Math.floor(Number(sp.speaker_id) || 0));
    const current = String(sp.display_name ?? sp.label ?? `Speaker ${sid + 1}`);

    const labBtn = labWrap.querySelector('[data-oaao-vault-speaker-label]');
    if (!(labBtn instanceof HTMLButtonElement)) return;

    const editor = document.createElement('div');
    editor.className = 'flex flex-col gap-1 min-w-0 flex-1';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 80;
    input.value = current;
    input.className =
        'w-full min-w-0 h-6 px-1 text-[0.72rem] rounded-[6px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] font-inherit fg-[var(--grid-ink)]';

    const rememberRow = document.createElement('label');
    rememberRow.className = 'flex flex-row items-center gap-1.5 text-[0.72rem] fg-[var(--grid-caption)] cursor-pointer select-none';
    const rememberCb = document.createElement('input');
    rememberCb.type = 'checkbox';
    rememberCb.checked = false;
    rememberCb.className = 'accent-[var(--grid-accent)]';
    rememberRow.append(rememberCb, document.createTextNode(t('remember_voice')));
    const pseudoDiar = Boolean(data.pseudo_diarization || data.timestamp_source === 'pseudo');
    const canRemember = !pseudoDiar && (Boolean(data.voiceprint_dim) || Boolean(sp.profile_id));
    if (!canRemember) {
        rememberRow.hidden = true;
        rememberCb.checked = false;
    }

    const actions = document.createElement('div');
    actions.className = 'flex flex-row gap-1';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className =
        'h-7 px-2 text-[0.72rem] rounded-[6px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] cursor-pointer font-inherit fw-semibold';
    saveBtn.textContent = t('rename_save');
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className =
        'h-7 px-2 text-[0.72rem] rounded-[6px] border-0 bg-transparent cursor-pointer font-inherit fg-[var(--grid-caption)]';
    cancelBtn.textContent = t('rename_cancel');
    actions.append(saveBtn, cancelBtn);

    editor.append(input, rememberRow, actions);

    const prevChildren = [...labWrap.childNodes];
    labWrap.replaceChildren(editor);
    input.focus();
    input.select();

    const cleanup = () => {
        labWrap.replaceChildren(...prevChildren);
    };

    const save = async () => {
        const next = input.value.trim();
        if (next === '') {
            cleanup();
            return;
        }

        input.disabled = true;
        saveBtn.disabled = true;
        const ok = await persistSpeakerRename(docId, sid, next, options, data, rememberCb.checked);
        input.disabled = false;
        saveBtn.disabled = false;
        if (!ok) {
            window.alert(t('rename_fail'));
            return;
        }

        sp.label = next;
        sp.display_name = next;
        sp.auto_matched = false;
        if (rememberCb.checked) sp.profile_id = sp.profile_id ?? 1;
        labBtn.textContent = next;
        applySpeakerLabelToDom(sid, next, data);
        cleanup();
    };

    saveBtn.addEventListener('click', () => {
        void save();
    });
    cancelBtn.addEventListener('click', cleanup);
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            void save();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            cleanup();
        }
    });
}

/**
 * @param {number} docId
 * @param {number} speakerId
 * @param {string} displayName
 * @param {TranscriptViewOptions} options
 * @param {TranscriptPayload} data
 */
async function persistSpeakerRename(docId, speakerId, displayName, options, data, rememberProfile = false) {
    /** @type {Record<string, unknown>} */
    const body = {
        document_id: docId,
        speaker_id: speakerId,
        display_name: displayName,
        remember_profile: rememberProfile,
    };
    if (options.workspaceId != null && options.workspaceId > 0) {
        body.workspace_id = options.workspaceId;
    }

    try {
        const res = await fetch(`${options.apiBase}document_transcript_speakers`, {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: options.signal,
        });
        /** @type {{ success?: boolean, data?: TranscriptPayload }} */
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success !== true || !json.data) return false;

        if (Array.isArray(json.data.segments)) data.segments = json.data.segments;
        if (Array.isArray(json.data.speakers)) data.speakers = json.data.speakers;
        if (typeof json.data.source_text === 'string') data.source_text = json.data.source_text;
        if (typeof json.data.profile_id === 'number') {
            for (const sp of data.speakers ?? []) {
                if (Math.floor(Number(sp.speaker_id) || 0) === speakerId) {
                    sp.profile_id = json.data.profile_id;
                    sp.auto_matched = false;
                }
            }
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {number} speakerId
 * @param {string} label
 * @param {TranscriptPayload} data
 */
function applySpeakerLabelToDom(speakerId, label, data) {
    const root = document.querySelector('[data-oaao-vault-transcript-root]');
    if (!root) return;

    root.querySelectorAll(`[data-speaker-id="${speakerId}"] [data-oaao-vault-speaker-label]`).forEach((node) => {
        if (node instanceof HTMLElement) node.textContent = label;
    });

    root.querySelectorAll(`article[data-speaker-id="${speakerId}"] [data-oaao-vault-segment-speaker]`).forEach((node) => {
        if (node instanceof HTMLElement) node.textContent = label;
    });

    for (const seg of data.segments ?? []) {
        if (Math.floor(Number(seg.speaker_id) || 0) === speakerId) {
            seg.speaker_label = label;
        }
    }

    const copyBtn = root.querySelector('[data-oaao-vault-transcript-copy]');
    if (copyBtn instanceof HTMLButtonElement) {
        copyBtn.dataset.copyText = String(data.source_text ?? '');
    }
}

/** @param {SpeakerSegment[]|undefined} segments */
function inferSpeakersFromSegments(segments) {
    /** @type {Map<number, SpeakerSummary>} */
    const map = new Map();
    for (const seg of segments ?? []) {
        const sid = Math.max(0, Math.floor(Number(seg.speaker_id) || 0));
        const prev = map.get(sid) ?? { speaker_id: sid, label: seg.speaker_label ?? `Speaker ${sid + 1}`, utterance_count: 0, total_ms: 0 };
        prev.utterance_count = (prev.utterance_count ?? 0) + 1;
        prev.total_ms = (prev.total_ms ?? 0) + Math.max(0, Number(seg.end_ms) - Number(seg.begin_ms));
        map.set(sid, prev);
    }
    return [...map.values()].sort((a, b) => a.speaker_id - b.speaker_id);
}

/**
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 */
function buildSpeakerTranscriptColumn(data, options) {
    const col = document.createElement('section');
    col.className = 'flex flex-col flex-[3] basis-[30%] min-w-[200px] max-w-[30%] min-h-0 w-full';

    const head = document.createElement('div');
    head.className =
        'shrink-0 flex flex-row items-center justify-between gap-2 px-3 py-2 border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]';

    const h = document.createElement('h3');
    h.className = 'text-[0.8125rem] fw-semibold m-0';
    h.textContent = t('transcript_heading');
    head.append(h);

    const headActions = document.createElement('div');
    headActions.className = 'shrink-0 flex flex-row items-center gap-1.5';
    headActions.append(buildDownloadMenu(data));
    const copyBtn = buildCopyButton(String(data.source_text ?? ''));
    copyBtn.setAttribute('data-oaao-vault-transcript-copy', '');
    headActions.append(copyBtn);
    head.append(h, headActions);
    col.append(head);

    if (data.pseudo_diarization || data.timestamp_source === 'pseudo') {
        const hint = document.createElement('p');
        hint.className =
            'shrink-0 m-0 px-3 py-2 text-[0.72rem] fg-[var(--grid-caption)] border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel)]';
        hint.textContent = t('pseudo_timestamp_hint');
        col.append(hint);
    }

    const scroll = document.createElement('div');
    scroll.className = 'flex-1 min-h-0 min-w-0 w-full max-w-full overflow-y-auto overscroll-contain p-3 flex flex-col gap-2';
    scroll.setAttribute('data-oaao-vault-transcript-scroll', '');

    const segments = /** @type {SpeakerSegment[]} */ (data.segments ?? []);
    if (!segments.length) {
        const empty = document.createElement('p');
        empty.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0';
        empty.textContent = t('no_segments');
        scroll.append(empty);
    }

    for (const seg of segments) {
        const sid = Math.max(0, Math.floor(Number(seg.speaker_id) || 0));
        const beginMs = Math.max(0, Number(seg.begin_ms) || 0);
        const endMs = Math.max(beginMs + 1, Number(seg.end_ms) || beginMs + 500);

        const card = document.createElement('article');
        card.className =
            'rounded-[10px] border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] p-2.5 cursor-pointer hover:border-[var(--grid-accent)]/40 focus-within:ring-2 focus-within:ring-[var(--grid-accent)]';
        card.tabIndex = 0;
        card.setAttribute('data-begin-ms', String(beginMs));
        card.setAttribute('data-end-ms', String(endMs));
        card.setAttribute('data-speaker-id', String(sid));

        const row = document.createElement('div');
        row.className = 'flex flex-row items-center gap-2 mb-1.5 min-w-0';

        const av = document.createElement('span');
        av.className =
            'inline-flex items-center justify-center shrink-0 w-6 h-6 rounded-full text-[0.62rem] fw-bold text-white';
        av.style.backgroundColor = `hsl(${speakerAccentHue(sid)} 55% 42%)`;
        av.textContent = speakerAvatarText(sid);
        av.setAttribute('aria-hidden', 'true');

        const who = document.createElement('span');
        who.className = 'text-[0.8125rem] fw-semibold truncate';
        who.setAttribute('data-oaao-vault-segment-speaker', '');
        who.textContent = String(seg.speaker_label ?? `Speaker ${sid + 1}`);

        const ts = document.createElement('time');
        ts.className = 'text-[0.72rem] fg-[var(--grid-caption)] shrink-0 ml-auto font-mono tabular-nums';
        ts.dateTime = formatTimestampMs(beginMs);
        ts.textContent = formatTimestampMs(beginMs);

        row.append(av, who, ts);

        const txt = document.createElement('p');
        txt.className = 'text-[0.8125rem] m-0 leading-relaxed whitespace-pre-wrap break-words fg-[var(--grid-ink)]';
        txt.textContent = String(seg.text ?? '');

        card.append(row, txt);

        const seek = () => {
            const host = col.closest('[data-oaao-vault-transcript-root]');
            const audio = host?.querySelector('audio[data-oaao-vault-transcript-audio]');
            if (!(audio instanceof HTMLAudioElement)) return;
            audio.currentTime = beginMs / 1000;
            void audio.play().catch(() => {});
            highlightActiveSegment(scroll, beginMs);
        };

        card.addEventListener('click', seek);
        card.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                seek();
            }
        });

        scroll.append(card);
    }

    col.append(scroll);

    col.addEventListener('oaao:transcript-audio-time', (ev) => {
        const ms = /** @type {CustomEvent<{ ms: number }>} */ (ev).detail?.ms;
        if (Number.isFinite(ms)) highlightActiveSegment(scroll, ms);
    });

    return col;
}

/** @param {HTMLElement} scroll @param {number} ms */
function highlightActiveSegment(scroll, ms) {
    const cards = scroll.querySelectorAll('article[data-begin-ms]');
    /** @type {HTMLElement|null} */
    let active = null;
    cards.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const begin = Number(node.getAttribute('data-begin-ms') || 0);
        const end = Number(node.getAttribute('data-end-ms') || begin + 1);
        node.classList.remove('ring-2', 'ring-[var(--grid-accent)]', 'border-[var(--grid-accent)]');
        if (begin <= ms && ms < end) {
            active = node;
        }
    });
    if (!active) {
        cards.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            const begin = Number(node.getAttribute('data-begin-ms') || 0);
            if (begin <= ms) active = node;
        });
    }
    if (active) {
        active.classList.add('ring-2', 'ring-[var(--grid-accent)]', 'border-[var(--grid-accent)]');
        active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

/** @param {TranscriptPayload} data @param {TranscriptViewOptions} options */
function buildPlainTranscriptColumn(data, options) {
    const col = document.createElement('section');
    col.className = 'flex flex-col flex-[3] basis-[30%] min-w-[200px] max-w-[30%] min-h-0 w-full';

    const head = document.createElement('div');
    head.className =
        'shrink-0 flex flex-row items-center justify-between gap-2 px-3 py-2 border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]';

    const h = document.createElement('h3');
    h.className = 'text-[0.8125rem] fw-semibold m-0';
    h.textContent = t('plain_heading');
    const headActions = document.createElement('div');
    headActions.className = 'shrink-0 flex flex-row items-center gap-1.5';
    headActions.append(buildDownloadMenu(data), buildCopyButton(String(data.source_text ?? '')));
    head.append(h, headActions);
    col.append(head);

    if (String(data.source_text ?? '').trim()) {
        const hintRow = document.createElement('div');
        hintRow.className =
            'shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2 border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel)] w-full max-w-full';

        const hint = document.createElement('p');
        hint.className = 'text-[0.75rem] fg-[var(--grid-caption)] m-0 flex-1 min-w-0';
        hint.textContent = t('retranscribe_hint_normal');
        hintRow.append(hint);

        if (typeof options.onRetranscribe === 'function') {
            const rtBtn = document.createElement('button');
            rtBtn.type = 'button';
            rtBtn.className =
                'shrink-0 rounded-[8px] h-8 px-2.5 text-[0.72rem] fw-semibold border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/20';
            rtBtn.textContent = t('action_retranscribe');
            rtBtn.addEventListener('click', () => {
                void options.onRetranscribe?.();
            });
            hintRow.append(rtBtn);
        }

        col.append(hintRow);
    }

    const scroll = document.createElement('div');
    scroll.className = 'flex-1 min-h-0 min-w-0 w-full max-w-full overflow-y-auto overscroll-contain p-3';

    const txt = document.createElement('p');
    txt.className =
        'text-[0.8125rem] m-0 leading-relaxed whitespace-pre-wrap break-words fg-[var(--grid-ink)] w-full max-w-full';
    txt.textContent = String(data.source_text ?? '');
    scroll.append(txt);
    col.append(scroll);

    return col;
}

/** @param {string} text */
function buildCopyButton(text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = DOWNLOAD_BTN_CLASS;
    btn.textContent = t('copy');
    btn.dataset.copyText = text;
    btn.addEventListener('click', async () => {
        const payload = btn.dataset.copyText ?? text;
        try {
            await navigator.clipboard.writeText(payload);
            btn.textContent = t('copied');
            window.setTimeout(() => {
                btn.textContent = t('copy');
            }, 1400);
        } catch {
            /* noop */
        }
    });
    return btn;
}

/**
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 */
function buildAudioBar(data, options) {
    const bar = document.createElement('div');
    bar.className =
        'shrink-0 flex flex-row items-center gap-2 px-2 py-2 mt-2 rounded-[10px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel)]';

    const mediaPath = String(data.media_url ?? '').trim();
    const src = mediaPath.startsWith('http') ? mediaPath : `${options.apiBase}${mediaPath.replace(/^\//, '')}`;

    const audio = document.createElement('audio');
    audio.className = 'sr-only';
    audio.preload = 'metadata';
    audio.src = src;
    audio.setAttribute('data-oaao-vault-transcript-audio', '');
    if (options.signal) {
        options.signal.addEventListener('abort', () => {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        });
    }

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className =
        'shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-full border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] cursor-pointer';
    playBtn.setAttribute('aria-label', t('play'));
    playBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '1000';
    range.value = '0';
    range.className = 'flex-1 min-w-0 h-2 accent-[var(--grid-accent)] cursor-pointer';
    range.setAttribute('aria-label', t('seek_aria'));

    const timeEl = document.createElement('span');
    timeEl.className = 'shrink-0 text-[0.72rem] font-mono tabular-nums fg-[var(--grid-caption)] min-w-[5.5rem] text-right';

    const syncTime = () => {
        const cur = audio.currentTime || 0;
        const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(data.duration_sec) || 0;
        timeEl.textContent = `${formatDurationSec(cur)} / ${formatDurationSec(dur)}`;
        if (dur > 0) range.value = String(Math.round((cur / dur) * 1000));
        const root = bar.closest('[data-oaao-vault-transcript-root]');
        root?.dispatchEvent(new CustomEvent('oaao:transcript-audio-time', { detail: { ms: cur * 1000 }, bubbles: true }));
    };

    playBtn.addEventListener('click', () => {
        if (audio.paused) {
            void audio.play().catch(() => {});
        } else {
            audio.pause();
        }
    });

    audio.addEventListener('play', () => {
        playBtn.setAttribute('aria-label', t('pause'));
        playBtn.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
    });
    audio.addEventListener('pause', () => {
        playBtn.setAttribute('aria-label', t('play'));
        playBtn.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    });
    audio.addEventListener('timeupdate', syncTime);
    audio.addEventListener('loadedmetadata', syncTime);

    range.addEventListener('input', () => {
        const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(data.duration_sec) || 0;
        if (dur <= 0) return;
        audio.currentTime = (Number(range.value) / 1000) * dur;
        syncTime();
    });

    bar.append(playBtn, range, timeEl, audio);
    syncTime();

    return bar;
}

/**
 * Seek audio + highlight the nearest segment card.
 *
 * @param {HTMLElement} root {@code data-oaao-vault-transcript-root}
 * @param {number} beginMs
 */
export function seekTranscriptToMs(root, beginMs) {
    const ms = Math.max(0, Math.floor(Number(beginMs) || 0));
    const audio = root.querySelector('audio[data-oaao-vault-transcript-audio]');
    if (audio instanceof HTMLAudioElement) {
        audio.currentTime = ms / 1000;
        void audio.play().catch(() => {});
    }
    const scroll = root.querySelector('[data-oaao-vault-transcript-scroll]');
    if (!(scroll instanceof HTMLElement)) return;
    root.dispatchEvent(new CustomEvent('oaao:transcript-audio-time', { detail: { ms }, bubbles: true }));
    let best = /** @type {HTMLElement | null} */ (null);
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const card of scroll.querySelectorAll('[data-begin-ms]')) {
        if (!(card instanceof HTMLElement)) continue;
        const b = Math.max(0, Number(card.dataset.beginMs) || 0);
        const delta = Math.abs(b - ms);
        if (delta < bestDelta) {
            bestDelta = delta;
            best = card;
        }
    }
    if (best) {
        best.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        best.focus({ preventScroll: true });
    }
}

/**
 * @param {TranscriptPayload} data
 * @param {TranscriptViewOptions} options
 * @returns {HTMLElement}
 */
export function mountTranscriptView(data, options) {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-oaao-vault-transcript-root', '');
    wrap.setAttribute('data-api-base', options.apiBase);
    wrap.className =
        'flex flex-col w-full min-w-0 max-w-full h-[min(74vh,720px)] max-h-[min(86vh,920px)] min-h-[min(52vh,480px)]';
    const view = buildTranscriptView(data, options);
    wrap.append(view);
    hydrateTranscriptView(wrap);
    const initialMs = Math.max(0, Math.floor(Number(options.initialBeginMs) || 0));
    if (initialMs > 0) {
        requestAnimationFrame(() => seekTranscriptToMs(wrap, initialMs));
    }
    return wrap;
}

/** @param {HTMLElement} root */
function hydrateTranscriptView(root) {
    const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
    if (JIT && typeof JIT.hydrate === 'function') {
        JIT.hydrate(root);
    }
}

export default {
    buildTranscriptView,
    mountTranscriptView,
    seekTranscriptToMs,
    composeTranscriptExport,
    downloadTranscriptExport,
    formatTimestampMs,
    formatDurationSec,
    speakerAvatarText,
};
