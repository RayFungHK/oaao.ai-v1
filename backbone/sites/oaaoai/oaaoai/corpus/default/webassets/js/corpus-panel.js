/**
 * Corpus Studio workspace panel (CS-1-S1–S8).
 */

/** @type {number} */
let mountGeneration = 0;

function mountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

function corpusApiUrl(path) {
    const base = `${mountPrefix()}/corpus/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

/**
 * @param {HTMLElement} root
 * @returns {number|null}
 */
function activeWorkspaceId(root) {
    const host = root.closest('[data-oaao-active-workspace-id]') ?? root;
    const ds =
        typeof host?.dataset?.oaaoActiveWorkspaceId === 'string'
            ? host.dataset.oaaoActiveWorkspaceId.trim()
            : '';
    if (!ds) return null;
    const n = Number(ds);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * @param {Record<string, unknown>} extra
 */
function scopeQuery(extra = {}) {
    const q = new URLSearchParams();
    const wid = extra.workspace_id;
    if (wid != null && Number(wid) > 0) {
        q.set('workspace_id', String(wid));
    }
    return q.toString();
}

async function corpusFetchJson(path, options = {}) {
    const res = await fetch(corpusApiUrl(path), {
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

async function loadRazyui() {
    const mod = await import(/* webpackIgnore: true */ 'razyui');
    return mod.default ?? mod;
}

async function hydrateCorpusMount(root) {
    try {
        const razyui = await loadRazyui();
        const JIT = await razyui.load('JIT');
        if (JIT?.hydrate && root instanceof HTMLElement) {
            JIT.hydrate(root);
        }
    } catch {
        /* panel markup uses standard utilities */
    }
}

/** @type {typeof import('../../../../../core/default/razyui/component/Dialog.js').default | null} */
let DialogCtor = null;

/** @type {typeof import('../../../../../core/default/razyui/component/Dropdown.js').default | null} */
let DropdownCtor = null;

/** @type {Map<number, () => void>} */
const corpusCardMenuDestroy = new Map();

const CORPUS_ICON_UPLOAD =
    '<svg xmlns="http://www.w3.org/2000/svg" class="pointer-events-none block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>';

const CORPUS_UPLOAD_ACCEPT =
    '.pdf,.doc,.docx,.txt,.md,.html,.htm,.json,.csv,application/pdf,text/plain,text/markdown';

/** Multipart fields for RazyUI Uploader — rebuilt before each upload. */
const corpusUploadMultipartFields = { corpus_id: '', label: '' };

/** @type {{ getControl?: () => { destroy: () => void, clear: () => void, addFiles?: (files: FileList) => void } } | null} */
let corpusPanelUploader = null;

/** @type {{ getControl?: () => { destroy: () => void, clear: () => void } } | null} */
let corpusSourcesDialogUploader = null;

/** Active profile for hidden-host card/menu uploads. */
let corpusUploadTargetId = 0;

const CORPUS_ICON_MORE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';

const CORPUS_ICON_REMOVE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

const CORPUS_ICON_FILE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>';

const CORPUS_ICON_VAULT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>';

const CORPUS_ICON_WARN =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

/**
 * @param {unknown} v
 * @returns {number|null}
 */
function structureSimilarityPct(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

function destroyAllCardMenus() {
    for (const destroy of corpusCardMenuDestroy.values()) {
        try {
            destroy();
        } catch {
            /* ignore */
        }
    }
    corpusCardMenuDestroy.clear();
}

/** @type {ReturnType<typeof setInterval> | null} */
let analyzePollTimer = null;

/** @type {number | null} */
let analyzePollCorpusId = null;

/** @type {Record<string, string>} */
/** CS-1 segment taxonomy — Razy Template–like block tree */
const CORPUS_SEGMENT_KIND = {
    document_segment: { label: 'Document', badge: 'fg-[var(--grid-ink-muted)] border-[var(--grid-line)] bg-[var(--grid-paper)]' },
    template_block: {
        label: 'Block',
        badge: 'fg-[var(--grid-ink)] border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--grid-line)_35%,var(--grid-panel))]',
    },
    structured_data: {
        label: 'Structured data',
        badge: 'fg-[var(--grid-accent)] border-[var(--grid-accent)]/35 bg-[color-mix(in_srgb,var(--grid-accent)_8%,var(--grid-panel))]',
    },
};

const CORPUS_BLOCK_NAME_LABEL = {
    table_row: 'Table row',
    member_record: 'Member record',
    record: 'Record',
};

/**
 * @param {Record<string, unknown> | null} classify
 * @returns {{ kind: string, meta: (typeof CORPUS_SEGMENT_KIND)[keyof typeof CORPUS_SEGMENT_KIND] }}
 */
function resolveCorpusSegmentKind(classify) {
    let kind = typeof classify?.segment_kind === 'string' ? classify.segment_kind : '';
    if (!kind && Array.isArray(classify?.fields) && classify.fields.length > 0) {
        kind = 'structured_data';
    }
    if (!kind || !CORPUS_SEGMENT_KIND[kind]) {
        kind = 'document_segment';
    }
    return { kind, meta: CORPUS_SEGMENT_KIND[kind] };
}

/**
 * @param {Record<string, unknown> | null} classify
 * @returns {HTMLElement}
 */
function corpusSegmentKindBadge(classify) {
    const { kind, meta } = resolveCorpusSegmentKind(classify);
    const badge = document.createElement('span');
    badge.className = [
        'self-start text-[0.625rem] fw-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-solid',
        meta.badge,
    ].join(' ');
    if (kind === 'template_block' && classify?.block && typeof classify.block === 'object') {
        const block = /** @type {Record<string, unknown>} */ (classify.block);
        const bname = typeof block.name === 'string' ? block.name : '';
        const bid = typeof block.id === 'string' && block.id ? block.id : '';
        const human = CORPUS_BLOCK_NAME_LABEL[bname] ?? (bname || meta.label);
        badge.textContent = bid ? `${human} · ${bid}` : human;
    } else if (kind === 'structured_data') {
        const n = Number(classify?.field_count ?? classify?.fields?.length ?? 0);
        badge.textContent = n > 0 ? `${meta.label} · ${n} fields` : meta.label;
    } else {
        badge.textContent = meta.label;
    }
    return badge;
}

/**
 * @param {Record<string, unknown>} classify
 * @param {HTMLElement} host
 */
function appendCorpusNestedBlocks(classify, host) {
    const block = classify?.block;
    if (!block || typeof block !== 'object') return;
    const children = Array.isArray(block.children) ? block.children : [];
    if (!children.length) return;
    const nest = document.createElement('ul');
    nest.className =
        'm-0 mt-1 p-0 pl-3 list-none flex flex-col gap-1 text-[0.65rem] fg-[var(--grid-ink-muted)] border-l border-solid border-[var(--grid-line)]';
    for (const ch of children.slice(0, 8)) {
        if (!ch || typeof ch !== 'object') continue;
        const row = document.createElement('li');
        const cname = typeof ch.name === 'string' ? ch.name : 'nested';
        const label = CORPUS_BLOCK_NAME_LABEL[cname] ?? cname;
        if (Array.isArray(ch.fields) && ch.fields.length > 0) {
            const f0 = ch.fields[0];
            const preview =
                f0 && typeof f0 === 'object' && f0.label
                    ? `${f0.label}：${String(f0.value ?? '').slice(0, 48)}`
                    : '';
            row.textContent = preview ? `${label} — ${preview}` : label;
        } else if (Array.isArray(ch.lines) && ch.lines.length > 0) {
            row.textContent = `${label} — ${String(ch.lines[0]).slice(0, 64)}`;
        } else {
            row.textContent = label;
        }
        nest.append(row);
    }
    if (children.length > 8) {
        const more = document.createElement('li');
        more.className = 'fg-[var(--grid-caption)]';
        more.textContent = `… +${children.length - 8} nested`;
        nest.append(more);
    }
    host.append(nest);
}

const CORPUS_STATUS_LABEL = {
    draft: 'Draft',
    learning: 'Analyzing',
    ready: 'Ready',
    error: 'Error',
};

/** @type {Record<string, { badge: string, border: string }>} */
const CORPUS_STATUS_STYLE = {
    draft: {
        badge: 'bg-[var(--grid-line)]/35 fg-[var(--grid-ink-muted)] border-[var(--grid-line)]',
        border: 'border-[var(--grid-line)]',
    },
    learning: {
        badge: 'bg-[var(--grid-accent)]/12 fg-[var(--grid-accent)] border-[var(--grid-accent)]/35',
        border: 'border-[var(--grid-accent)]/45',
    },
    ready: {
        badge: 'bg-emerald-500/10 fg-emerald-800 border-emerald-500/30',
        border: 'border-emerald-500/25',
    },
    error: {
        badge: 'bg-red-50 fg-red-800 border-red-200',
        border: 'border-red-300',
    },
};

/** Per-card activity until server status catches up. @type {Map<number, string>} */
const cardStatusOverride = new Map();

/** @type {Map<number, { text: string, tone: 'info' | 'success' | 'error' }>} */
const cardActivityByCorpusId = new Map();

/** Last analyze outcome — survives list refresh until the next analyze run. */
/** @type {Map<number, { text: string, tone: 'success' | 'error' }>} */
const cardAnalyzeOutcomeByCorpusId = new Map();

/** Corpus IDs with an analyze request in flight (for clearer terminal messages). */
/** @type {Set<number>} */
const analyzeRunByCorpusId = new Set();

/**
 * @param {string} raw
 */
function formatAnalyzeErrorMessage(raw) {
    const msg = String(raw ?? '').trim();
    if (!msg) return 'Analysis failed';
    if (msg === 'no_extractable_text' || msg.includes('no_extractable_text')) {
        const base =
            'Sources have no readable text. Use PDF, Markdown, TXT, or Vault items with extracted text.';
        const detail = msg.includes(':') ? msg.split(':').slice(1).join(':').trim() : '';
        if (detail.includes('file not found')) {
            return `${base} Analysis could not read uploaded files (storage not shared with orchestrator). Restart Docker after updating compose, then re-analyze. (${detail})`;
        }
        return detail ? `${base} (${detail})` : base;
    }
    if (msg === 'sources_required' || msg.includes('sources_required')) {
        return 'No sources were sent to the analyzer. Add uploads or Vault references first.';
    }
    if (msg.includes('Orchestrator unreachable')) {
        return 'Analysis service unreachable. Ensure the orchestrator container is running.';
    }
    return msg;
}

/** Last list payload — instant repaint without waiting on network. @type {Array<Record<string, unknown>>} */
let lastProfiles = [];

/**
 * @param {number} corpusId
 * @param {Record<string, unknown>} patch
 * @param {HTMLElement} [scopeRoot]
 */
function applyCorpusPatchToCache(corpusId, patch, scopeRoot = null) {
    const idx = lastProfiles.findIndex((row) => Number(row?.corpus_id) === corpusId);
    if (idx >= 0) {
        lastProfiles[idx] = { ...lastProfiles[idx], ...patch };
        return true;
    }
    const scope = scopeRoot instanceof HTMLElement ? scopeRoot : document;
    const card = scope.querySelector(`[data-corpus-card="${corpusId}"]`);
    if (card instanceof HTMLElement) {
        const title = card.querySelector('h2')?.textContent?.trim() || 'Corpus';
        lastProfiles.push({ corpus_id: corpusId, name: title, source_count: 0, ...patch });
        return true;
    }
    return false;
}

/**
 * @param {HTMLElement} root
 */
function repaintProfilesFromCache(root) {
    const listEl = root.querySelector('[data-oaao-corpus="list"]');
    if (!(listEl instanceof HTMLElement) || !lastProfiles.length) return;
    renderProfileList(listEl, lastProfiles, root, pageAlertSetter(root));
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {string} message
 * @param {string} [jobId]
 */
function beginCardAnalyzeUi(root, corpusId, message, jobId = '') {
    cardAnalyzeOutcomeByCorpusId.delete(corpusId);
    setCardStatusOverride(corpusId, 'learning');
    setCardActivity(corpusId, message, 'info');
    /** @type {Record<string, unknown>} */
    const patch = { status: 'learning' };
    if (jobId) patch.analyze_job_id = jobId;
    applyCorpusPatchToCache(corpusId, patch, root);
    repaintProfilesFromCache(root);
}

/**
 * @param {number} corpusId
 * @param {string} text
 * @param {'info' | 'success' | 'error'} [tone]
 */
function setCardActivity(corpusId, text, tone = 'info') {
    const t = String(text ?? '').trim();
    if (!t) cardActivityByCorpusId.delete(corpusId);
    else cardActivityByCorpusId.set(corpusId, { text: t, tone });
}

/**
 * @param {number} corpusId
 * @param {string} status
 */
function setCardStatusOverride(corpusId, status) {
    if (status) cardStatusOverride.set(corpusId, status);
    else cardStatusOverride.delete(corpusId);
}

/**
 * @param {Record<string, unknown>} profile
 */
function resolveCardStatus(profile) {
    const cid = Number(profile.corpus_id ?? 0);
    const server = String(profile.status ?? 'draft');
    const override = cid > 0 ? cardStatusOverride.get(cid) : undefined;
    if (override && (server === 'draft' || server === override)) return override;
    if (override && server !== 'draft') cardStatusOverride.delete(cid);
    return server;
}

/**
 * @param {Record<string, unknown>} profile
 * @returns {{ text: string, tone: 'info' | 'success' | 'error' } | undefined}
 */
function resolveCardActivity(profile) {
    const cid = Number(profile.corpus_id ?? 0);
    const status = resolveCardStatus(profile);
    const live = cid > 0 ? cardActivityByCorpusId.get(cid) : undefined;
    if (live?.text) return live;

    const outcome = cid > 0 ? cardAnalyzeOutcomeByCorpusId.get(cid) : undefined;
    if (outcome?.text) return outcome;

    if (status === 'ready') {
        const segCount = Number(profile.segment_count ?? 0);
        return {
            tone: 'success',
            text:
                segCount > 0
                    ? `Analysis complete — ${segCount} segment${segCount === 1 ? '' : 's'}. Open Details from the menu (⋮).`
                    : 'Analysis complete — open Details from the menu (⋮) to review style.',
        };
    }
    if (status === 'error') {
        const err = typeof profile.error_message === 'string' ? profile.error_message.trim() : '';
        if (err) return { tone: 'error', text: err };
    }
    if (status === 'learning') {
        const jobId = typeof profile.analyze_job_id === 'string' ? profile.analyze_job_id : '';
        return {
            tone: 'info',
            text: jobId
                ? `Analyzing style segments · ${jobId}`
                : 'Extracting style segments from your sources…',
        };
    }
    return undefined;
}

/**
 * @param {number} corpusId
 * @param {string} text
 * @param {'success' | 'error'} tone
 */
function rememberAnalyzeOutcome(corpusId, text, tone) {
    const t = String(text ?? '').trim();
    if (!t) return;
    cardAnalyzeOutcomeByCorpusId.set(corpusId, { text: t, tone });
    setCardActivity(corpusId, t, tone);
}

/**
 * @param {number} corpusId
 * @param {Record<string, unknown>} patch
 */
function mergeProfileIntoCache(corpusId, patch) {
    applyCorpusPatchToCache(corpusId, patch);
    const idx = lastProfiles.findIndex((row) => Number(row?.corpus_id) === corpusId);
    if (idx >= 0) {
        lastProfiles[idx] = { ...lastProfiles[idx], ...patch };
    }
}

/**
 * @param {Record<string, unknown>} source
 */
function sourceDisplayTitle(source) {
    const label = typeof source.label === 'string' ? source.label.trim() : '';
    if (label) return label;
    return typeof source.kind_label === 'string' ? source.kind_label : 'Source';
}

/**
 * @param {Record<string, unknown>} source
 * @param {boolean} isLearning
 * @returns {HTMLElement}
 */
function buildCorpusSourceRow(source, isLearning) {
    const sourceId = Number(source.source_id ?? 0);
    const kind = String(source.kind ?? '');
    const row = document.createElement('div');
    row.className =
        'flex items-center gap-2 min-w-0 rounded-lg border border-solid border-[var(--grid-line)]/80 bg-[var(--grid-paper)] px-2 py-1.5';
    row.dataset.corpusSourceRow = String(sourceId);

    const icon = document.createElement('span');
    icon.className = 'shrink-0 fg-[var(--grid-ink-muted)] inline-flex';
    icon.innerHTML = kind.startsWith('vault') ? CORPUS_ICON_VAULT : CORPUS_ICON_FILE;

    const meta = document.createElement('div');
    meta.className = 'min-w-0 flex-1 flex flex-col gap-0.5';
    const title = document.createElement('p');
    title.className = 'm-0 text-xs fw-medium fg-[var(--grid-ink)] truncate';
    title.textContent = sourceDisplayTitle(source);
    title.title = title.textContent;
    const sub = document.createElement('p');
    sub.className = 'm-0 text-[0.65rem] fg-[var(--grid-ink-muted)] truncate';
    const kindLabel = typeof source.kind_label === 'string' ? source.kind_label : kind;
    const summary = typeof source.summary === 'string' ? source.summary : '';
    let subLine = summary ? `${kindLabel} · ${summary}` : kindLabel;
    const structPct = structureSimilarityPct(source.structure_similarity);
    if (structPct != null) {
        subLine += source.structure_outlier === true
            ? ` · vs other sources ${structPct}% (possible wrong file)`
            : ` · vs other sources ${structPct}%`;
    }
    sub.textContent = subLine;
    sub.title = sub.textContent;
    meta.append(title, sub);

    if (source.structure_outlier === true) {
        const warn = document.createElement('span');
        warn.className = 'shrink-0 inline-flex fg-amber-700';
        const warnMsg =
            typeof source.structure_warning === 'string' && source.structure_warning.trim()
                ? source.structure_warning.trim()
                : 'Structure does not match this profile — check if the wrong file was uploaded.';
        warn.title = warnMsg;
        warn.setAttribute('aria-label', warnMsg);
        warn.innerHTML = CORPUS_ICON_WARN;
        row.append(warn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className =
        'shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md border-0 bg-transparent fg-[var(--grid-ink-muted)] hover:bg-red-50 hover:fg-red-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
    removeBtn.dataset.corpusSourceRemove = String(sourceId);
    removeBtn.innerHTML = CORPUS_ICON_REMOVE;
    removeBtn.title = isLearning ? 'Wait until analysis finishes' : 'Remove source';
    removeBtn.setAttribute('aria-label', removeBtn.title);
    removeBtn.disabled = isLearning;

    row.append(icon, meta, removeBtn);
    return row;
}

/**
 * @param {HTMLElement} card
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} profile
 * @param {(msg: string) => void} setPageAlert
 */
async function wireCorpusCardMenu(card, root, profile, setPageAlert) {
    const host = card.querySelector('[data-corpus-menu-host]');
    if (!(host instanceof HTMLElement)) return;

    const corpusId = Number(profile.corpus_id ?? 0);
    if (corpusId < 1) return;

    const prev = corpusCardMenuDestroy.get(corpusId);
    if (prev) {
        prev();
        corpusCardMenuDestroy.delete(corpusId);
    }

    const Dropdown = await loadDropdownCtor();
    if (!Dropdown) return;

    const status = resolveCardStatus(profile);
    const isLearning = status === 'learning';

    const dd = new Dropdown(host, {
        trigger: host.querySelector('button'),
        items: [
            {
                label: isLearning ? 'Upload file (analyzing…)' : 'Upload file',
                disabled: isLearning,
                onClick: () => {
                    triggerCorpusUploadPick(root, corpusId);
                },
            },
            {
                label: 'Vault reference',
                onClick: () => {
                    void promptVaultRef(root, corpusId, setPageAlert);
                },
            },
            {
                label: isLearning ? 'Analyzing…' : 'Analyze',
                disabled: isLearning,
                onClick: () => {
                    if (isLearning) return;
                    void enqueueAnalyze(root, corpusId, setPageAlert);
                },
            },
            {
                label: 'Details',
                onClick: () => {
                    void openCorpusDetail(root, corpusId);
                },
            },
            { divider: true },
            {
                label: 'Delete profile',
                onClick: () => {
                    void confirmDeleteProfile(root, corpusId, setPageAlert);
                },
            },
        ],
    });

    const ctrl = typeof dd.getControl === 'function' ? dd.getControl() : dd;
    if (ctrl && typeof ctrl.destroy === 'function') {
        corpusCardMenuDestroy.set(corpusId, () => ctrl.destroy());
    }
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {number} sourceId
 * @param {(msg: string) => void} setPageAlert
 */
async function removeCorpusSource(root, corpusId, sourceId, setPageAlert) {
    if (!window.confirm('Remove this source from the corpus profile?')) return;

    const wid = activeWorkspaceId(root);
    /** @type {Record<string, unknown>} */
    const payload = { corpus_id: corpusId, source_id: sourceId };
    if (wid != null) payload.workspace_id = wid;

    const { res, data } = await corpusFetchJson('corpus_source_delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok || !data?.success) {
        setCardActivity(
            corpusId,
            typeof data?.message === 'string' ? data.message : 'Could not remove source',
            'error',
        );
        repaintProfilesFromCache(root);
        return;
    }
    setCardActivity(corpusId, 'Source removed.', 'success');
    await refreshProfiles(root, setPageAlert, { resumeAnalyzePoll: false });
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {(msg: string) => void} setPageAlert
 */
async function confirmDeleteProfile(root, corpusId, setPageAlert) {
    if (!window.confirm('Delete this corpus profile and its sources?')) return;

    const wid = activeWorkspaceId(root);
    /** @type {Record<string, unknown>} */
    const payload = { corpus_id: corpusId };
    if (wid != null) payload.workspace_id = wid;
    const { res, data } = await corpusFetchJson('corpus_profile_delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok || !data?.success) {
        setCardActivity(corpusId, typeof data?.message === 'string' ? data.message : 'Delete failed', 'error');
        await refreshProfiles(root, setPageAlert, { resumeAnalyzePoll: false });
        return;
    }
    corpusCardMenuDestroy.get(corpusId)?.();
    corpusCardMenuDestroy.delete(corpusId);
    setCardActivity(corpusId, '');
    await refreshProfiles(root, setPageAlert);
}

/**
 * @param {Record<string, unknown>} profile
 * @param {HTMLElement} root
 * @param {(msg: string) => void} setPageAlert
 * @returns {HTMLElement}
 */
function buildCorpusProfileCard(profile, root, setPageAlert) {
    const corpusId = Number(profile.corpus_id ?? 0);
    const status = resolveCardStatus(profile);
    const isLearning = status === 'learning';
    const srcCount = Number(profile.source_count ?? 0);
    const segCount = Number(profile.segment_count ?? 0);
    const statusLabel = CORPUS_STATUS_LABEL[status] ?? status;
    const style = CORPUS_STATUS_STYLE[status] ?? CORPUS_STATUS_STYLE.draft;
    const activity = resolveCardActivity(profile);

    const card = document.createElement('article');
    card.className = [
        'oaao-corpus-profile-card flex flex-col gap-3 p-4 rounded-xl border border-solid bg-[var(--grid-panel-bright)] shadow-[0_1px_0_rgba(0,0,0,0.04)] min-w-0 max-w-full overflow-hidden',
        style.border,
    ].join(' ');
    card.dataset.corpusCard = String(corpusId);

    const head = document.createElement('div');
    head.className = 'flex items-center justify-between gap-2 min-w-0';
    const title = document.createElement('h2');
    title.className = 'm-0 text-base font-semibold fg-[var(--grid-ink)] truncate min-w-0 flex-1';
    title.textContent = String(profile.name ?? 'Corpus');
    const badge = document.createElement('span');
    badge.className = [
        'inline-flex items-center shrink-0 text-[0.6875rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border border-solid leading-none',
        style.badge,
    ].join(' ');
    badge.textContent = statusLabel;
    const menuHost = document.createElement('div');
    menuHost.className = 'shrink-0 flex items-center';
    menuHost.dataset.corpusMenuHost = '1';
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className =
        'inline-flex items-center justify-center w-8 h-8 rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] hover:bg-[var(--grid-line)]/25 cursor-pointer fg-[var(--grid-ink-muted)]';
    menuBtn.innerHTML = CORPUS_ICON_MORE;
    menuBtn.title = 'Profile actions';
    menuBtn.setAttribute('aria-label', 'Profile actions');
    menuHost.append(menuBtn);

    const headActions = document.createElement('div');
    headActions.className = 'oaao-corpus-card-head-actions flex items-center gap-1.5 shrink-0';
    if (status === 'learning') {
        const spinner = document.createElement('span');
        spinner.className = 'oaao-corpus-spinner shrink-0';
        spinner.setAttribute('aria-hidden', 'true');
        headActions.append(spinner, badge, menuHost);
    } else {
        headActions.append(badge, menuHost);
    }
    head.append(title, headActions);
    card.dataset.analyzing = isLearning ? '1' : '0';

    const toolbar = document.createElement('div');
    toolbar.className = 'oaao-corpus-card-toolbar flex flex-wrap items-center gap-2 min-w-0';
    const segChip = document.createElement('span');
    segChip.className =
        'oaao-corpus-toolbar-chip inline-flex items-center shrink-0 rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-2.5 text-xs fg-[var(--grid-ink-muted)]';
    segChip.textContent =
        status === 'ready' && segCount > 0
            ? `${segCount} segment${segCount === 1 ? '' : 's'}`
            : status === 'learning'
              ? 'Segments pending…'
              : 'No segments yet';
    const sourcesOpenBtn = document.createElement('button');
    sourcesOpenBtn.type = 'button';
    sourcesOpenBtn.dataset.corpusSourcesOpen = String(corpusId);
    sourcesOpenBtn.dataset.corpusSourcesName = String(profile.name ?? 'Corpus');
    sourcesOpenBtn.className =
        'oaao-corpus-toolbar-btn oaao-corpus-toolbar-btn-grow text-xs px-2.5 rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] hover:bg-[var(--grid-line)]/20 font-inherit cursor-pointer fg-[var(--grid-ink)] fw-medium min-w-0 truncate';
    sourcesOpenBtn.textContent =
        srcCount > 0 ? `Sources (${srcCount})` : 'Sources (0)';
    sourcesOpenBtn.title = 'View and manage sources';
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className =
        'oaao-corpus-toolbar-btn oaao-corpus-toolbar-icon inline-flex items-center justify-center shrink-0 rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] hover:bg-[var(--grid-accent)]/10 hover:border-[var(--grid-accent)]/35 cursor-pointer fg-[var(--grid-accent)] disabled:opacity-40 disabled:cursor-not-allowed';
    uploadBtn.innerHTML = CORPUS_ICON_UPLOAD;
    uploadBtn.title = isLearning ? 'Wait until analysis finishes' : 'Upload file';
    uploadBtn.setAttribute('aria-label', uploadBtn.title);
    uploadBtn.disabled = isLearning;
    uploadBtn.addEventListener('click', () => {
        if (isLearning) return;
        triggerCorpusUploadPick(root, corpusId);
    });
    toolbar.append(segChip, sourcesOpenBtn, uploadBtn);

    const cardParts = [head, toolbar];

    if (activity?.text || status === 'learning' || status === 'ready' || status === 'error') {
        const activityBox = document.createElement('div');
        activityBox.className = [
            'oaao-corpus-card-activity rounded-lg border border-solid px-3 py-2 flex flex-col gap-2 text-xs leading-snug min-w-0 max-w-full overflow-hidden shrink-0',
            activity?.tone === 'error' || status === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : activity?.tone === 'success' || status === 'ready'
                  ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-900'
                  : 'border-[var(--grid-accent)]/30 bg-[var(--grid-accent)]/8 fg-[var(--grid-accent)]',
        ].join(' ');

        const activityText =
            activity?.text ||
            (status === 'learning'
                ? 'Extracting style segments from your sources…'
                : typeof profile.error_message === 'string'
                  ? profile.error_message
                  : '');
        if (activityText) {
            const p = document.createElement('p');
            p.className = 'oaao-corpus-card-activity-text m-0 min-w-0';
            p.textContent = activityText;
            p.title = activityText;
            activityBox.append(p);
        }

        if (status === 'learning') {
            const bar = document.createElement('div');
            bar.className = 'oaao-corpus-progress-track h-1.5 w-full rounded-full bg-[var(--grid-line)] overflow-hidden';
            bar.setAttribute('role', 'progressbar');
            bar.setAttribute('aria-valuetext', 'Analyzing');
            const fill = document.createElement('div');
            fill.className = 'oaao-corpus-progress-fill';
            bar.append(fill);
            activityBox.append(bar);
        }

        cardParts.push(activityBox);
    }

    card.append(...cardParts);
    return card;
}

async function loadDropdownCtor() {
    if (DropdownCtor) return DropdownCtor;
    try {
        const prefix = mountPrefix();
        let path = '/webassets/core/default/razyui/component/Dropdown.js';
        if (prefix && prefix !== '/') {
            path = `${prefix.replace(/\/+$/, '')}${path}`.replace(/\/{2,}/g, '/');
        }
        const shellV = document.body?.dataset?.oaaoShellEsmV?.trim() ?? '';
        if (shellV) path += `${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(shellV)}`;
        const mod = await import(/* webpackIgnore: true */ path);
        const Dropdown = mod.default;
        if (typeof Dropdown !== 'function') {
            console.error('[corpus] Dropdown export invalid', mod);
            return null;
        }
        DropdownCtor = Dropdown;
        return DropdownCtor;
    } catch (err) {
        console.error('[corpus] Dropdown load failed', err);
        return null;
    }
}

async function loadDialogCtor() {
    if (DialogCtor) return DialogCtor;
    try {
        const prefix = mountPrefix();
        let path = '/webassets/core/default/razyui/component/Dialog.js';
        if (prefix && prefix !== '/') {
            path = `${prefix.replace(/\/+$/, '')}${path}`.replace(/\/{2,}/g, '/');
        }
        const shellV = document.body?.dataset?.oaaoShellEsmV?.trim() ?? '';
        if (shellV) path += `${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(shellV)}`;
        const mod = await import(/* webpackIgnore: true */ path);
        const Dialog = mod.default;
        if (typeof Dialog !== 'function' || typeof Dialog.open !== 'function') {
            console.error('[corpus] Dialog export invalid', mod);
            return null;
        }
        DialogCtor = Dialog;
        return DialogCtor;
    } catch (err) {
        console.error('[corpus] Dialog load failed', err);
        return null;
    }
}

/**
 * @param {HTMLElement} listEl
 * @param {Array<Record<string, unknown>>} profiles
 */
function renderProfileList(listEl, profiles, root, setPageAlert) {
    destroyAllCardMenus();
    listEl.replaceChildren();
    if (!profiles.length) {
        const empty = document.createElement('div');
        empty.className =
            'oaao-corpus-profile-grid-empty text-sm fg-[var(--grid-ink-muted)] py-10 px-4 text-center border border-dashed border-[var(--grid-line)] rounded-xl flex flex-col gap-2 items-center';
        const t = document.createElement('p');
        t.className = 'm-0 fw-medium fg-[var(--grid-ink)]';
        t.textContent = 'No corpus profiles yet';
        const s = document.createElement('p');
        s.className = 'm-0 text-xs';
        s.textContent = 'Create a profile, add uploads or Vault references, then run Analyze.';
        empty.append(t, s);
        listEl.append(empty);
        return;
    }

    for (const p of profiles) {
        const card = buildCorpusProfileCard(p, root, setPageAlert);
        listEl.append(card);
        if (root instanceof HTMLElement && typeof setPageAlert === 'function') {
            void wireCorpusCardMenu(card, root, p, setPageAlert);
        }
    }
}

/**
 * @param {HTMLElement} root
 * @param {(msg: string) => void} setPageAlert
 * @param {{ resumeAnalyzePoll?: boolean }} [opts]
 */
async function refreshProfiles(root, setPageAlert, opts = {}) {
    const listEl = root.querySelector('[data-oaao-corpus="list"]');
    if (!(listEl instanceof HTMLElement)) return;
    const wid = activeWorkspaceId(root);
    const qs = scopeQuery(wid != null ? { workspace_id: wid } : {});
    const path = qs ? `corpus_profiles_list?${qs}` : 'corpus_profiles_list';
    const { res, data } = await corpusFetchJson(path);
    if (!res.ok || !data?.success) {
        setPageAlert(typeof data?.message === 'string' ? data.message : 'Could not load profiles');
        return;
    }
    setPageAlert('');
    const profiles = Array.isArray(data?.data?.profiles) ? data.data.profiles : [];
    lastProfiles = profiles;
    renderProfileList(listEl, profiles, root, setPageAlert);

    if (opts.resumeAnalyzePoll !== false) {
        const learning = profiles.find((row) => {
            const st = resolveCardStatus(row);
            return st === 'learning';
        });
        const cid = learning ? Number(learning.corpus_id) : 0;
        if (cid > 0 && analyzePollCorpusId !== cid) {
            startAnalyzePolling(root, cid);
        }
    }
}

/**
 * @param {HTMLElement} root
 * @param {(msg: string) => void} setPageAlert
 */
async function openNewCorpusDialog(root, setPageAlert) {
    const Dialog = await loadDialogCtor();
    if (!Dialog?.open) {
        setPageAlert('Dialog unavailable');
        return;
    }
    const body = document.createElement('div');
    body.className = 'flex flex-col gap-3 p-1';
    const errEl = document.createElement('p');
    errEl.className = 'hidden text-xs text-red-600 m-0';
    const label = document.createElement('label');
    label.className = 'text-sm fg-[var(--grid-ink)] flex flex-col gap-1.5';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'Profile name';
    const input = document.createElement('input');
    input.type = 'text';
    input.className =
        'w-full text-sm px-2 py-1.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)]';
    input.maxLength = 200;
    input.autocomplete = 'off';
    label.append(labelSpan, input);
    body.append(label, errEl);

    Dialog.open({
        title: 'New corpus profile',
        content: body,
        size: 'md',
        closable: true,
        buttons: [
            { text: 'Cancel', color: 'muted', action: async () => true },
            {
                text: 'Create',
                color: 'accent',
                action: async () => {
                    const name = input.value.trim();
                    if (!name) {
                        errEl.textContent = 'Name required';
                        errEl.classList.remove('hidden');
                        return false;
                    }
                    const wid = activeWorkspaceId(root);
                    /** @type {Record<string, unknown>} */
                    const payload = { name };
                    if (wid != null) payload.workspace_id = wid;

                    const { res, data } = await corpusFetchJson('corpus_profile_save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!res.ok || !data?.success) {
                        errEl.textContent =
                            typeof data?.message === 'string' ? data.message : 'Could not create profile';
                        errEl.classList.remove('hidden');
                        return false;
                    }
                    setPageAlert('');
                    await refreshProfiles(root, setPageAlert);
                    return true;
                },
            },
        ],
        onOpen(ctrl) {
            const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
            const host = ctrl?.body instanceof HTMLElement ? ctrl.body : body;
            if (JIT?.hydrate && host instanceof HTMLElement) JIT.hydrate(host);
            input.focus();
        },
    });
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 */
function rebuildCorpusUploadFields(root, corpusId) {
    corpusUploadMultipartFields.corpus_id = String(corpusId);
    if (activeWorkspaceId(root) != null) {
        corpusUploadMultipartFields.workspace_id = String(activeWorkspaceId(root));
    } else {
        delete corpusUploadMultipartFields.workspace_id;
    }
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 */
function triggerCorpusUploadPick(root, corpusId) {
    if (corpusId < 1) return;
    corpusUploadTargetId = corpusId;
    const pick = root.querySelector('[data-oaao-corpus-file-pick]');
    if (pick instanceof HTMLInputElement) pick.click();
}

function destroyCorpusPanelUploader() {
    if (!corpusPanelUploader || typeof corpusPanelUploader.getControl !== 'function') {
        corpusPanelUploader = null;
        return;
    }
    try {
        corpusPanelUploader.getControl().destroy();
    } catch {
        /* noop */
    }
    corpusPanelUploader = null;
}

function destroyCorpusSourcesDialogUploader() {
    if (!corpusSourcesDialogUploader || typeof corpusSourcesDialogUploader.getControl !== 'function') {
        corpusSourcesDialogUploader = null;
        return;
    }
    try {
        corpusSourcesDialogUploader.getControl().destroy();
    } catch {
        /* noop */
    }
    corpusSourcesDialogUploader = null;
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {(msg: string) => void} setPageAlert
 * @param {() => void | Promise<void>} [onSuccess]
 */
function handleCorpusUploadResponse(root, corpusId, setPageAlert, response, onSuccess) {
    void (async () => {
        /** @type {{ success?: boolean, message?: string }} */
        const j =
            typeof response === 'object' && response !== null
                ? /** @type {{ success?: boolean, message?: string }} */ (response)
                : {};
        if (j.success) {
            setCardActivity(corpusId, 'Source uploaded.', 'success');
            setPageAlert('');
            corpusPanelUploader?.getControl?.()?.clear?.();
            corpusSourcesDialogUploader?.getControl?.()?.clear?.();
            await refreshProfiles(root, setPageAlert, { resumeAnalyzePoll: false });
            if (typeof onSuccess === 'function') await onSuccess();
            return;
        }
        const msg = typeof j.message === 'string' && j.message.trim() ? j.message.trim() : 'Upload failed';
        setCardActivity(corpusId, msg, 'error');
        setPageAlert(msg);
    })();
}

/**
 * @param {HTMLElement} root
 * @param {(msg: string) => void} setPageAlert
 */
async function wireCorpusPanelUploader(root, setPageAlert) {
    const host = root.querySelector('[data-oaao-corpus-uploader-host]');
    if (!(host instanceof HTMLElement)) return;

    destroyCorpusPanelUploader();
    host.replaceChildren('');

    const razyui = await loadRazyui();
    const UploaderCtor = await razyui.load('Uploader');
    if (typeof UploaderCtor !== 'function') return;

    corpusPanelUploader = new UploaderCtor(host, {
        url: corpusApiUrl('corpus_source_upload'),
        method: 'POST',
        name: 'file',
        accept: CORPUS_UPLOAD_ACCEPT,
        multiple: true,
        auto: true,
        dropZone: false,
        data: corpusUploadMultipartFields,
        /** @param {File} file */
        onUpload(file) {
            const cid = corpusUploadTargetId;
            if (cid < 1) return;
            rebuildCorpusUploadFields(root, cid);
            corpusUploadMultipartFields.label = file.name;
        },
        /** @param {File} _file @param {unknown} response */
        onComplete(_file, response) {
            const cid = corpusUploadTargetId;
            if (cid < 1) return;
            handleCorpusUploadResponse(root, cid, setPageAlert, response);
        },
        /** @param {File} _file @param {string} [message] */
        onError(_file, message) {
            const cid = corpusUploadTargetId;
            if (cid < 1) return;
            const msg = typeof message === 'string' && message.trim() ? message.trim() : 'Upload failed';
            setCardActivity(cid, msg, 'error');
            setPageAlert(msg);
        },
    });
}

/**
 * @param {HTMLElement} root
 */
function wireCorpusCardUploadPick(root) {
    let pick = root.querySelector('[data-oaao-corpus-file-pick]');
    if (!(pick instanceof HTMLInputElement)) {
        pick = document.createElement('input');
        pick.type = 'file';
        pick.hidden = true;
        pick.multiple = true;
        pick.accept = CORPUS_UPLOAD_ACCEPT;
        pick.dataset.oaaoCorpusFilePick = '1';
        root.append(pick);
        pick.addEventListener('change', () => {
            const files = pick.files;
            if (!files?.length || corpusUploadTargetId < 1) return;
            rebuildCorpusUploadFields(root, corpusUploadTargetId);
            corpusPanelUploader?.getControl?.()?.addFiles?.(files);
            pick.value = '';
        });
    }
}

/**
 * @param {HTMLElement} host
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {(msg: string) => void} setPageAlert
 * @param {() => void | Promise<void>} onListRefresh
 */
async function wireCorpusSourcesDialogUploader(host, root, corpusId, setPageAlert, onListRefresh) {
    destroyCorpusSourcesDialogUploader();
    host.replaceChildren('');

    const razyui = await loadRazyui();
    const UploaderCtor = await razyui.load('Uploader');
    if (typeof UploaderCtor !== 'function') {
        host.textContent = 'Uploader unavailable';
        return;
    }

    rebuildCorpusUploadFields(root, corpusId);

    corpusSourcesDialogUploader = new UploaderCtor(host, {
        url: corpusApiUrl('corpus_source_upload'),
        method: 'POST',
        name: 'file',
        accept: CORPUS_UPLOAD_ACCEPT,
        multiple: false,
        maxFiles: 1,
        auto: true,
        dropZone: true,
        placeholder: 'Drop PDF or document here, or click to browse',
        data: corpusUploadMultipartFields,
        /** @param {File} file */
        onUpload(file) {
            rebuildCorpusUploadFields(root, corpusId);
            corpusUploadMultipartFields.label = file.name;
        },
        /** @param {File} _file @param {unknown} response */
        onComplete(_file, response) {
            handleCorpusUploadResponse(root, corpusId, setPageAlert, response, onListRefresh);
        },
        /** @param {File} _file @param {string} [message] */
        onError(_file, message) {
            const msg = typeof message === 'string' && message.trim() ? message.trim() : 'Upload failed';
            setCardActivity(corpusId, msg, 'error');
            setPageAlert(msg);
        },
    });
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {(msg: string) => void} setPageAlert
 */
async function loadVaultPickerModule() {
    const prefix = mountPrefix();
    let path = '/webassets/core/default/js/oaao-vault-source-picker.js';
    if (prefix && prefix !== '/') {
        path = `${prefix.replace(/\/+$/, '')}${path}`.replace(/\/{2,}/g, '/');
    }
    return import(/* webpackIgnore: true */ path);
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {(msg: string) => void} setPageAlert
 */
async function promptVaultRef(root, corpusId, setPageAlert) {
    const Dialog = await loadDialogCtor();
    if (!Dialog?.open) {
        setPageAlert('Dialog unavailable');
        return;
    }
    const picker = await loadVaultPickerModule();
    const wid = activeWorkspaceId(root);
    let tree = [];
    try {
        tree = await picker.fetchOaaoVaultTreeForPicker(mountPrefix(), wid ?? 'all');
    } catch {
        setPageAlert('Could not load vault tree');
        return;
    }
    const picked = await picker.openOaaoVaultSourcePickerDialog(Dialog, tree, {
        title: 'Add Vault source',
        hint: 'Select a folder (all files inside) or a single file.',
        confirmLabel: 'Add reference',
        allowVault: false,
        allowFolder: true,
        allowDocument: true,
        documentsEmbeddedOnly: false,
    });
    if (!picked) return;

    /** @type {Record<string, unknown>} */
    const payload = {
        corpus_id: corpusId,
        vault_id: picked.vault_id,
        label: picked.name,
    };
    if (picked.kind === 'document') {
        payload.kind = 'vault_document';
        payload.document_id = picked.document_id;
    } else if (picked.kind === 'folder') {
        payload.kind = 'vault_container';
        payload.container_id = picked.container_id;
    } else {
        setCardActivity(corpusId, 'Select a folder or file, not a whole vault', 'error');
        await refreshProfiles(root, setPageAlert, { resumeAnalyzePoll: false });
        return;
    }
    if (wid != null) payload.workspace_id = wid;

    const { res, data } = await corpusFetchJson('corpus_source_vault_ref', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok || !data?.success) {
        setCardActivity(corpusId, typeof data?.message === 'string' ? data.message : 'Vault reference failed', 'error');
        await refreshProfiles(root, setPageAlert, { resumeAnalyzePoll: false });
        return;
    }
    setCardActivity(corpusId, 'Vault reference added.', 'success');
    await refreshProfiles(root, setPageAlert, { resumeAnalyzePoll: false });
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {(msg: string) => void} setPageAlert
 */
async function enqueueAnalyze(root, corpusId, setPageAlert) {
    if (analyzePollTimer) {
        clearInterval(analyzePollTimer);
        analyzePollTimer = null;
        analyzePollCorpusId = null;
    }

    beginCardAnalyzeUi(root, corpusId, 'Sending analyze request…');

    const wid = activeWorkspaceId(root);
    /** @type {Record<string, unknown>} */
    const payload = { corpus_id: corpusId };
    if (wid != null) payload.workspace_id = wid;

    const { res, data } = await corpusFetchJson('corpus_profile_analyze_enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok || !data?.success) {
        analyzeRunByCorpusId.delete(corpusId);
        cardStatusOverride.delete(corpusId);
        const err = typeof data?.message === 'string' ? data.message : 'Could not start analysis';
        rememberAnalyzeOutcome(corpusId, formatAnalyzeErrorMessage(err), 'error');
        mergeProfileIntoCache(corpusId, { status: 'draft' });
        repaintProfilesFromCache(root);
        await refreshProfiles(root, setPageAlert, { resumeAnalyzePoll: false });
        return;
    }
    analyzeRunByCorpusId.add(corpusId);

    const jobId = typeof data?.data?.job_id === 'string' ? data.data.job_id : '';
    const serverStatus = String(data?.data?.status ?? 'learning');
    mergeProfileIntoCache(corpusId, {
        status: serverStatus === 'ready' || serverStatus === 'done' ? 'ready' : serverStatus === 'error' ? 'error' : 'learning',
        analyze_job_id: jobId || null,
        segment_count: Number(data?.data?.segment_count ?? 0),
    });
    beginCardAnalyzeUi(
        root,
        corpusId,
        jobId ? `Analysis running · ${jobId}` : 'Analysis running — waiting for orchestrator…',
        jobId,
    );

    const terminal = await pollAnalyzeOnce(root, corpusId);
    if (terminal === 'learning') {
        startAnalyzePolling(root, corpusId);
        return;
    }
    analyzeRunByCorpusId.delete(corpusId);
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 */
function startAnalyzePolling(root, corpusId) {
    if (analyzePollTimer) clearInterval(analyzePollTimer);
    analyzePollCorpusId = corpusId;
    analyzePollTimer = setInterval(() => {
        void pollAnalyzeOnce(root, corpusId);
    }, 3000);
    void pollAnalyzeOnce(root, corpusId);
}

/**
 * @param {HTMLElement} root
 * @returns {(text: string) => void}
 */
function pageAlertSetter(root) {
    const el = root.querySelector('[data-oaao-corpus="page-alert"]');
    return (text) => {
        if (!(el instanceof HTMLElement)) return;
        const t = String(text ?? '').trim();
        el.textContent = t;
        el.classList.toggle('hidden', t === '');
    };
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 */
/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @returns {Promise<'learning' | 'ready' | 'error' | 'draft' | ''>}
 */
async function pollAnalyzeOnce(root, corpusId) {
    const setPageAlert = pageAlertSetter(root);
    const wid = activeWorkspaceId(root);
    const q = new URLSearchParams();
    q.set('corpus_id', String(corpusId));
    if (wid != null) q.set('workspace_id', String(wid));
    const { res, data } = await corpusFetchJson(`corpus_profile_status?${q.toString()}`);
    if (!res.ok || !data?.success) return '';

    const status = String(data?.data?.status ?? '');
    const segCount = Number(data?.data?.segment_count ?? 0);
    const jobId = typeof data?.data?.job_id === 'string' ? data.data.job_id : '';
    const prof = data?.data?.profile;
    /** @type {Record<string, unknown>} */
    const patch = {
        status,
        segment_count: segCount,
        analyze_job_id: jobId || null,
    };
    if (prof && typeof prof === 'object' && typeof prof.error_message === 'string') {
        patch.error_message = prof.error_message;
    }
    mergeProfileIntoCache(corpusId, patch);

    if (status === 'learning') {
        setCardStatusOverride(corpusId, 'learning');
        setCardActivity(
            corpusId,
            jobId ? `Analyzing style segments · ${jobId}` : 'Analyzing style segments from sources…',
            'info',
        );
        repaintProfilesFromCache(root);
        return 'learning';
    }

    if (analyzePollTimer && analyzePollCorpusId === corpusId) {
        clearInterval(analyzePollTimer);
        analyzePollTimer = null;
        analyzePollCorpusId = null;
    }
    cardStatusOverride.delete(corpusId);

    const hadAnalyzeRun = analyzeRunByCorpusId.has(corpusId);

    if (status === 'ready') {
        rememberAnalyzeOutcome(
            corpusId,
            segCount > 0
                ? `Analysis complete — ${segCount} segment${segCount === 1 ? '' : 's'}. Open Details from the menu (⋮).`
                : 'Analysis complete — open Details from the menu (⋮) to review style.',
            'success',
        );
    } else if (status === 'error') {
        const err =
            prof && typeof prof === 'object' && typeof prof.error_message === 'string'
                ? prof.error_message
                : 'Analysis failed';
        rememberAnalyzeOutcome(corpusId, formatAnalyzeErrorMessage(err), 'error');
    } else if (status === 'draft' && hadAnalyzeRun) {
        const pendingJob =
            (typeof jobId === 'string' && jobId !== '') ||
            (prof && typeof prof === 'object' && typeof prof.analyze_job_id === 'string' && prof.analyze_job_id);
        if (pendingJob || cardStatusOverride.get(corpusId) === 'learning') {
            setCardStatusOverride(corpusId, 'learning');
            setCardActivity(corpusId, 'Starting analysis…', 'info');
            repaintProfilesFromCache(root);
            return 'learning';
        }
        rememberAnalyzeOutcome(
            corpusId,
            'Analysis did not start (status stayed Draft). Retry Analyze or check server logs.',
            'error',
        );
    } else if (hadAnalyzeRun) {
        rememberAnalyzeOutcome(
            corpusId,
            formatAnalyzeErrorMessage(`Unexpected status: ${status || 'unknown'}`),
            'error',
        );
    } else {
        cardActivityByCorpusId.delete(corpusId);
    }

    analyzeRunByCorpusId.delete(corpusId);

    repaintProfilesFromCache(root);
    await refreshProfiles(root, setPageAlert, { resumeAnalyzePoll: false });
    return /** @type {'ready' | 'error' | 'draft' | 'learning' | ''} */ (status || '');
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {string} profileName
 * @param {(msg: string) => void} setPageAlert
 */
async function openCorpusSourcesDialog(root, corpusId, profileName, setPageAlert) {
    const Dialog = await loadDialogCtor();
    if (!Dialog?.open) {
        setPageAlert('Dialog unavailable');
        return;
    }

    const wid = activeWorkspaceId(root);
    const limit = 50;
    let offset = 0;
    let total = 0;
    let loading = false;

    const body = document.createElement('div');
    body.className = 'flex flex-col gap-3 min-h-0';

    const toolbar = document.createElement('div');
    toolbar.className = 'flex flex-wrap items-center justify-between gap-2 shrink-0';
    const summary = document.createElement('p');
    summary.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
    summary.textContent = 'Loading…';

    const uploaderHost = document.createElement('div');
    uploaderHost.className = 'oaao-corpus-sources-uploader-host';

    const listHost = document.createElement('div');
    listHost.className = 'flex flex-col gap-1 min-h-0 max-h-[min(420px,55vh)] overflow-y-auto';

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className =
        'text-xs px-2.5 py-1.5 rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] hover:bg-[var(--grid-line)]/20 font-inherit cursor-pointer disabled:opacity-40';
    moreBtn.textContent = 'Load more';
    moreBtn.hidden = true;

    body.append(toolbar, uploaderHost, listHost, moreBtn);

    async function fetchStatusLearning() {
        const q = new URLSearchParams();
        q.set('corpus_id', String(corpusId));
        if (wid != null) q.set('workspace_id', String(wid));
        const { res, data } = await corpusFetchJson(`corpus_profile_status?${q.toString()}`);
        if (!res.ok || !data?.success) return false;
        return String(data?.data?.status ?? '') === 'learning';
    }

    async function loadPage(append) {
        if (loading) return;
        loading = true;
        moreBtn.disabled = true;
        const q = new URLSearchParams();
        q.set('corpus_id', String(corpusId));
        q.set('limit', String(limit));
        q.set('offset', String(append ? offset : 0));
        if (wid != null) q.set('workspace_id', String(wid));
        if (!append) {
            offset = 0;
            listHost.replaceChildren();
        }
        const { res, data } = await corpusFetchJson(`corpus_sources_list?${q.toString()}`);
        loading = false;
        if (!res.ok || !data?.success) {
            summary.textContent =
                typeof data?.message === 'string' ? data.message : 'Could not load sources';
            return;
        }
        total = Number(data?.data?.total ?? 0);
        const rows = Array.isArray(data?.data?.sources) ? data.data.sources : [];
        const isLearning = await fetchStatusLearning();
        uploaderHost.classList.toggle('opacity-40', isLearning);
        uploaderHost.classList.toggle('pointer-events-none', isLearning);
        summary.textContent = `${total} source${total === 1 ? '' : 's'} bound to this profile`;
        if (!rows.length && offset === 0) {
            const empty = document.createElement('p');
            empty.className =
                'm-0 text-xs fg-[var(--grid-ink-muted)] rounded-lg border border-dashed border-[var(--grid-line)] px-3 py-2';
            empty.textContent = 'No sources yet. Upload or add a Vault reference from the card menu (⋮).';
            listHost.append(empty);
        } else {
            for (const src of rows) {
                if (src && typeof src === 'object') {
                    listHost.append(
                        buildCorpusSourceRow(/** @type {Record<string, unknown>} */ (src), isLearning),
                    );
                }
            }
            offset += rows.length;
        }
        moreBtn.hidden = offset >= total;
        moreBtn.disabled = offset >= total;
    }

    listHost.addEventListener('click', async (ev) => {
        const t = ev.target;
        if (!(t instanceof HTMLElement)) return;
        const removeBtn = t.closest('[data-corpus-source-remove]');
        if (!(removeBtn instanceof HTMLButtonElement) || removeBtn.disabled) return;
        const sourceId = Number(removeBtn.dataset.corpusSourceRemove);
        if (!Number.isFinite(sourceId) || sourceId < 1) return;
        await removeCorpusSource(root, corpusId, sourceId, setPageAlert);
        await loadPage(false);
    });

    toolbar.append(summary);

    moreBtn.addEventListener('click', () => {
        void loadPage(true);
    });

    Dialog.open({
        title: `Sources — ${profileName}`,
        content: body,
        size: 'md',
        buttons: [{ text: 'Close', color: 'muted', action: async () => true }],
        onClose: () => {
            destroyCorpusSourcesDialogUploader();
        },
        onOpen(ctrl) {
            const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
            const host = ctrl?.body instanceof HTMLElement ? ctrl.body : body;
            if (JIT?.hydrate && host instanceof HTMLElement) JIT.hydrate(host);
            void wireCorpusSourcesDialogUploader(uploaderHost, root, corpusId, setPageAlert, () =>
                loadPage(false),
            );
            void loadPage(false);
        },
    });
}

/**
 * @param {unknown} style
 */
function corpusStyleConfidence(style) {
    if (!style || typeof style !== 'object') return 0;
    const meta = /** @type {Record<string, unknown>} */ (style).meta;
    if (meta && typeof meta === 'object' && meta.style_confidence != null) {
        const n = Number(meta.style_confidence);
        if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
    }
    return 0.75;
}

/**
 * @param {string} status
 * @param {number} segCount
 * @param {unknown} style
 */
function corpusCanGeneratePreview(status, segCount, style) {
    if (status !== 'ready' || segCount < 1 || !style || typeof style !== 'object') return false;
    const conf = corpusStyleConfidence(style);
    return conf >= 0.55 || segCount >= 3;
}

/**
 * @param {Record<string, unknown>} style
 */
function corpusHasHtmlTemplate(style) {
    const meta = style?.meta;
    return (
        meta != null &&
        typeof meta === 'object' &&
        meta.html_template != null &&
        typeof meta.html_template === 'object'
    );
}

/**
 * @param {string} jobId
 * @param {(msg: string) => void} onProgress
 * @param {{ label?: string, maxAttempts?: number }} [opts]
 * @returns {Promise<Record<string, unknown>>}
 */
async function pollCorpusOrchestratorJob(jobId, onProgress, opts = {}) {
    const maxAttempts = opts.maxAttempts ?? 75;
    const label = opts.label ?? 'Job';
    const started = Date.now();
    for (let i = 0; i < maxAttempts; i++) {
        const q = new URLSearchParams();
        q.set('job_id', jobId);
        const { res, data } = await corpusFetchJson(`corpus_job_poll?${q.toString()}`);
        if (res.status === 404 || data?.data?.status === 'lost') {
            throw new Error(
                typeof data?.message === 'string'
                    ? data.message
                    : `${label} lost — orchestrator restarted. Try again.`,
            );
        }
        if (!res.ok || !data?.success) {
            throw new Error(typeof data?.message === 'string' ? data.message : `${label} poll failed`);
        }
        const st = String(data?.data?.status ?? '');
        if (st === 'running') {
            const sec = Math.max(1, Math.round((Date.now() - started) / 1000));
            onProgress(`${label}… ${sec}s`);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
        }
        if (st === 'done' && data?.data && typeof data.data === 'object') {
            return /** @type {Record<string, unknown>} */ (data.data);
        }
        throw new Error(typeof data?.message === 'string' ? data.message : `${label} failed`);
    }
    throw new Error(`${label} timed out — try again or check orchestrator logs.`);
}

/** @param {string} jobId @param {(msg: string) => void} onProgress */
async function pollCorpusGenerateJob(jobId, onProgress) {
    return pollCorpusOrchestratorJob(jobId, onProgress, {
        label: 'Generating preview',
        maxAttempts: 75,
    });
}

/**
 * @param {Record<string, unknown>} data
 * @param {HTMLPreElement} outPre
 * @param {HTMLElement} out
 * @param {HTMLParagraphElement} simBanner
 */
function renderCorpusGenerateResult(data, outPre, out, simBanner) {
    const md = typeof data.markdown === 'string' ? data.markdown : '';
    outPre.textContent = md || '(empty)';
    out.classList.remove('hidden');
    out.classList.add('flex');
    const sim = data.similarity && typeof data.similarity === 'object'
        ? /** @type {Record<string, unknown>} */ (data.similarity)
        : null;
    if (sim) {
        const scorePct = structureSimilarityPct(sim.score);
        const meets = sim.meets_target === true;
        const structPct = structureSimilarityPct(sim.structure_similarity);
        const layoutPct = structureSimilarityPct(sim.layout_match);
        simBanner.classList.remove('hidden');
        simBanner.className = [
            'm-0 text-xs rounded-lg border border-solid px-3 py-2',
            meets
                ? 'border-emerald-500/40 bg-emerald-500/10 fg-emerald-800'
                : 'border-amber-500/40 bg-amber-500/10 fg-amber-900',
        ].join(' ');
        const parts = [];
        if (scorePct != null) {
            parts.push(
                meets
                    ? `Structure match ${scorePct}% (meets target)`
                    : `Structure match ${scorePct}% — below target; re-run with a clearer brief or Re-analyze`,
            );
        }
        if (structPct != null || layoutPct != null) {
            const detail = [];
            if (structPct != null) detail.push(`structure ${structPct}%`);
            if (layoutPct != null) detail.push(`blueprint ${layoutPct}%`);
            if (detail.length) parts.push(detail.join(', '));
        }
        simBanner.textContent = parts.join(' · ') || 'Similarity scored';
    } else {
        simBanner.classList.add('hidden');
    }
    const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
    if (JIT?.hydrate) JIT.hydrate(out);
    if (JIT?.hydrate) JIT.hydrate(simBanner);
}

/**
 * @param {Record<string, unknown>} data
 * @param {HTMLElement} out
 * @param {HTMLParagraphElement} simBanner
 */
function renderCorpusPrintResult(data, out, simBanner) {
    const err = typeof data.error === 'string' ? data.error : '';
    const html = typeof data.html === 'string' ? data.html : '';
    const pdfB64 = typeof data.pdf_bytes_b64 === 'string' ? data.pdf_bytes_b64 : '';
    out.replaceChildren();
    out.classList.remove('hidden');
    out.classList.add('flex');
    const fmt = String(data.format || '');
    if (err === 'pdf_renderer_not_configured' || (fmt === 'pdf' && !pdfB64 && err)) {
        simBanner.classList.remove('hidden');
        simBanner.className =
            'm-0 text-xs rounded-lg border border-solid border-amber-500/40 bg-amber-500/10 px-3 py-2 fg-amber-900';
        simBanner.textContent =
            typeof data.detail === 'string' && data.detail
                ? data.detail
                : 'PDF engine not available. Rebuild orchestrator image with weasyprint.';
    } else if (err && !html) {
        simBanner.classList.remove('hidden');
        simBanner.className =
            'm-0 text-xs rounded-lg border border-solid border-red-500/40 bg-red-500/10 px-3 py-2';
        simBanner.textContent = typeof data.detail === 'string' ? data.detail : err;
    } else {
        simBanner.classList.add('hidden');
    }
    if (pdfB64) {
        const row = document.createElement('div');
        row.className = 'flex flex-row gap-2 items-center';
        const dl = document.createElement('a');
        dl.className =
            'text-xs px-2.5 py-1 rounded border border-solid border-[var(--grid-accent)] fg-[var(--grid-accent)] no-underline';
        dl.textContent = 'Download PDF';
        dl.href = '#';
        dl.addEventListener('click', (ev) => {
            ev.preventDefault();
            try {
                const bin = atob(pdfB64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const blob = new Blob([bytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'corpus-document.pdf';
                a.click();
                URL.revokeObjectURL(url);
            } catch {
                /* ignore */
            }
        });
        row.append(dl);
        out.append(row);
    }
    if (html) {
        const frame = document.createElement('iframe');
        frame.className = 'w-full min-h-[320px] border-0 rounded bg-white';
        frame.setAttribute('sandbox', 'allow-same-origin');
        frame.srcdoc = html;
        out.append(frame);
    } else if (!pdfB64) {
        const pre = document.createElement('pre');
        pre.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
        pre.textContent = '(no HTML returned)';
        out.append(pre);
    }
    const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
    if (JIT?.hydrate) JIT.hydrate(out);
    if (JIT?.hydrate) JIT.hydrate(simBanner);
}

/**
 * @param {Record<string, unknown>} style
 * @param {HTMLElement} host
 */
function buildCorpusTemplateParamFields(style, host) {
    host.replaceChildren();
    const meta = style?.meta;
    const tpl = meta && typeof meta === 'object' ? meta.html_template : null;
    if (tpl && typeof tpl === 'object' && tpl.layout_type === 'table') {
        const n = typeof tpl.table_row_count === 'number' ? tpl.table_row_count : 0;
        const p = document.createElement('p');
        p.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
        p.textContent =
            n > 0
                ? `此 Corpus 為「表格通告」版型（樣本約 ${n} 列）。上方可改本函檔號、日期、致辭與引言；brief 用於產生或替換表格列。`
                : '表格版型 — Re-analyze 以從 PDF 抽出 table_row 與函首段落。';
        host.append(p);
        const nh =
            tpl.notice_header && typeof tpl.notice_header === 'object' ? tpl.notice_header : null;
        const defaults =
            nh && nh.defaults && typeof nh.defaults === 'object' ? nh.defaults : {};
        const seenLabels = new Set();
        for (const raw of (Array.isArray(tpl.parameters) ? tpl.parameters : []).slice(0, 48)) {
            if (!raw || typeof raw !== 'object') continue;
            const key = typeof raw.key === 'string' ? raw.key : '';
            if (!key || key === 'brief') continue;
            const lab = typeof raw.label === 'string' ? raw.label : key;
            if (seenLabels.has(lab)) continue;
            seenLabels.add(lab);
            const row = document.createElement('label');
            row.className = 'flex flex-col gap-0.5 text-xs';
            const span = document.createElement('span');
            span.className = 'fg-[var(--grid-ink-muted)]';
            span.textContent = lab;
            const inp = document.createElement('input');
            inp.type = raw.type === 'text' ? 'text' : 'text';
            inp.dataset.paramKey = key;
            const defVal = typeof defaults[key] === 'string' ? defaults[key] : '';
            if (defVal) inp.value = defVal;
            inp.className =
                'text-sm px-2 py-1 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] font-inherit';
            row.append(span, inp);
            host.append(row);
        }
        return;
    }
    const params =
        tpl && typeof tpl === 'object' && Array.isArray(tpl.parameters) ? tpl.parameters : [];
    if (!params.length) {
        const p = document.createElement('p');
        p.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
        p.textContent = 'No template parameters — Re-analyze to build print layout.';
        host.append(p);
        return;
    }
    const collapsed =
        tpl && typeof tpl.collapsed_duplicate_blocks === 'number' && tpl.collapsed_duplicate_blocks > 0;
    if (collapsed) {
        const note = document.createElement('p');
        note.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
        note.textContent = `多份相同結構已合併為一組欄位（來源約 ${tpl.template_block_count ?? '?'} 筆記錄）。`;
        host.append(note);
    }
    const seenLabels = new Set();
    for (const raw of params.slice(0, 48)) {
        if (!raw || typeof raw !== 'object') continue;
        const key = typeof raw.key === 'string' ? raw.key : '';
        if (!key) continue;
        const lab = typeof raw.label === 'string' ? raw.label : key;
        if (seenLabels.has(lab)) continue;
        seenLabels.add(lab);
        const row = document.createElement('label');
        row.className = 'flex flex-col gap-0.5 text-xs';
        const span = document.createElement('span');
        span.className = 'fg-[var(--grid-ink-muted)]';
        span.textContent = lab;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.dataset.paramKey = key;
        inp.className =
            'text-sm px-2 py-1 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] font-inherit';
        row.append(span, inp);
        host.append(row);
    }
}

/**
 * @param {HTMLElement} host
 * @returns {Record<string, string>}
 */
function readCorpusTemplateParamFields(host) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const inp of host.querySelectorAll('input[data-param-key]')) {
        if (!(inp instanceof HTMLInputElement)) continue;
        const k = inp.dataset.paramKey || '';
        if (!k) continue;
        out[k] = inp.value.trim();
    }
    return out;
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 * @param {string} profileName
 * @param {Record<string, unknown>} style
 */
async function openCorpusGeneratePreview(root, corpusId, profileName, style) {
    const Dialog = await loadDialogCtor();
    if (!Dialog?.open) return;

    const hasPrint = corpusHasHtmlTemplate(style);
    /** @type {'markdown' | 'print'} */
    let mode = 'markdown';

    const body = document.createElement('div');
    body.className = 'flex flex-col gap-3';

    const modeRow = document.createElement('div');
    modeRow.className = 'flex flex-row flex-wrap gap-2';
    const mkModeBtn = (id, label) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.mode = id;
        b.className =
            'text-xs px-2.5 py-1 rounded-full border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
        b.textContent = label;
        return b;
    };
    const btnMd = mkModeBtn('markdown', 'Markdown');
    const btnPrint = hasPrint ? mkModeBtn('print', 'Print layout (HTML)') : null;

    const syncModeUi = () => {
        for (const el of modeRow.querySelectorAll('button[data-mode]')) {
            const on = el instanceof HTMLButtonElement && el.dataset.mode === mode;
            el.classList.toggle('border-[var(--grid-accent)]', on);
            el.classList.toggle('fg-[var(--grid-accent)]', on);
        }
        hint.classList.toggle('hidden', mode !== 'markdown');
        briefInput.classList.toggle('hidden', mode !== 'print');
        hintPrint.classList.toggle('hidden', mode !== 'print');
        paramFields.classList.toggle('hidden', mode !== 'print');
        formatRow.classList.toggle('hidden', mode !== 'print');
    };

    btnMd.addEventListener('click', () => {
        mode = 'markdown';
        syncModeUi();
    });
    if (btnPrint) {
        btnPrint.addEventListener('click', () => {
            mode = 'print';
            syncModeUi();
        });
        modeRow.append(btnMd, btnPrint);
    } else {
        modeRow.append(btnMd);
    }

    const hint = document.createElement('p');
    hint.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
    hint.textContent =
        'Write a brief. Generate follows the analyzed structure blueprint (segment order and block types), applies style_json, then scores similarity vs your corpus (preview only).';

    const hintPrint = document.createElement('p');
    hintPrint.className = 'm-0 text-xs fg-[var(--grid-ink-muted)] hidden';
    hintPrint.textContent =
        'Optional brief fills empty fields via LLM. Edit parameters below, then preview HTML or export PDF.';

    const paramFields = document.createElement('div');
    paramFields.className = 'hidden flex flex-col gap-2 max-h-[200px] overflow-y-auto';
    buildCorpusTemplateParamFields(style, paramFields);

    const briefInput = document.createElement('textarea');
    briefInput.className =
        'w-full min-h-[88px] text-sm px-2 py-1.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] font-inherit resize-y';
    briefInput.placeholder =
        'Brief for markdown generate, or to auto-fill print template fields when empty…';
    const formatRow = document.createElement('div');
    formatRow.className = 'hidden flex flex-row gap-2 items-center';
    formatRow.dataset.oaaoCorpusRenderFormatRow = '1';
    const formatLab = document.createElement('span');
    formatLab.className = 'text-xs fg-[var(--grid-ink-muted)]';
    formatLab.textContent = 'Export';
    const formatSel = document.createElement('select');
    formatSel.dataset.oaaoCorpusRenderFormat = '1';
    formatSel.className =
        'text-xs px-2 py-1 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)]';
    for (const opt of [
        ['html', 'HTML preview'],
        ['pdf', 'PDF'],
    ]) {
        const o = document.createElement('option');
        o.value = opt[0];
        o.textContent = opt[1];
        formatSel.append(o);
    }
    formatRow.append(formatLab, formatSel);
    const out = document.createElement('div');
    out.className =
        'hidden flex-col gap-2 rounded-lg border border-solid border-[var(--grid-line)] bg-[var(--grid-panel)] p-3 max-h-[360px] overflow-y-auto';
    const simBanner = document.createElement('p');
    simBanner.className = 'hidden m-0 text-xs rounded-lg border border-solid px-3 py-2';
    const outPre = document.createElement('pre');
    outPre.className = 'm-0 text-xs whitespace-pre-wrap break-words fg-[var(--grid-ink)] font-inherit';
    out.append(outPre);
    body.append(modeRow, hint, hintPrint, formatRow, briefInput, paramFields, simBanner, out);
    syncModeUi();

    Dialog.open({
        title: `Generate — ${profileName}`,
        content: body,
        size: 'md',
        buttons: [
            { text: 'Close', color: 'muted', action: async () => true },
            {
                text: 'Run',
                color: 'accent',
                action: async () => {
                    const setPageAlert = pageAlertSetter(root);
                    const wid = activeWorkspaceId(root);
                    simBanner.classList.remove('hidden');
                    simBanner.className =
                        'm-0 text-xs rounded-lg border border-solid border-[var(--grid-accent)]/30 bg-[var(--grid-accent)]/8 px-3 py-2 fg-[var(--grid-accent)]';

                    if (mode === 'print') {
                        const printBrief = briefInput.value.trim();
                        const renderFmt =
                            /** @type {HTMLSelectElement | null} */ (
                                body.querySelector('[data-oaao-corpus-render-format]')
                            )?.value === 'pdf'
                                ? 'pdf'
                                : 'html';
                        simBanner.textContent = `Starting ${renderFmt} render…`;
                        const payload = {
                            corpus_id: corpusId,
                            format: renderFmt,
                            parameters: readCorpusTemplateParamFields(paramFields),
                        };
                        if (printBrief) payload.brief = printBrief;
                        if (wid != null) payload.workspace_id = wid;

                        void (async () => {
                            try {
                                outPre.classList.add('hidden');
                                const { res, data } = await corpusFetchJson('corpus_profile_render', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(payload),
                                });
                                if (!res.ok || !data?.success) {
                                    setPageAlert(
                                        typeof data?.message === 'string' ? data.message : 'Render failed',
                                    );
                                    simBanner.classList.add('hidden');
                                    return;
                                }
                                const jobId =
                                    typeof data?.data?.job_id === 'string' ? data.data.job_id : '';
                                const st = String(data?.data?.status ?? '');
                                let result =
                                    st === 'done' && data?.data && typeof data.data === 'object'
                                        ? /** @type {Record<string, unknown>} */ ({ ...data.data })
                                        : null;
                                if (!result && jobId) {
                                    result = await pollCorpusOrchestratorJob(jobId, (msg) => {
                                        simBanner.textContent = msg;
                                    }, { label: `Rendering ${renderFmt}`, maxAttempts: 40 });
                                }
                                if (!result) {
                                    setPageAlert('Render did not return a job id');
                                    simBanner.classList.add('hidden');
                                    return;
                                }
                                if (result.parameters && typeof result.parameters === 'object') {
                                    for (const inp of paramFields.querySelectorAll('input[data-param-key]')) {
                                        if (!(inp instanceof HTMLInputElement)) continue;
                                        const k = inp.dataset.paramKey || '';
                                        const v = /** @type {Record<string, unknown>} */ (
                                            result.parameters
                                        )[k];
                                        if (typeof v === 'string' && v && !inp.value) inp.value = v;
                                    }
                                }
                                renderCorpusPrintResult(result, out, simBanner);
                                setPageAlert('');
                            } catch (err) {
                                const msg = err instanceof Error ? err.message : 'Render failed';
                                setPageAlert(msg);
                                simBanner.classList.add('hidden');
                            }
                        })();
                        return false;
                    }

                    const brief = briefInput.value.trim();
                    if (!brief) return false;
                    const payload = { corpus_id: corpusId, brief };
                    if (wid != null) payload.workspace_id = wid;
                    simBanner.textContent = 'Starting generate job…';
                    outPre.classList.remove('hidden');

                    void (async () => {
                        try {
                            const { res, data } = await corpusFetchJson('corpus_profile_generate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload),
                            });
                            if (!res.ok || !data?.success) {
                                setPageAlert(
                                    typeof data?.message === 'string' ? data.message : 'Generate failed',
                                );
                                simBanner.classList.add('hidden');
                                return;
                            }
                            const jobId = typeof data?.data?.job_id === 'string' ? data.data.job_id : '';
                            const st = String(data?.data?.status ?? '');
                            let result =
                                st === 'done' && data?.data && typeof data.data === 'object'
                                    ? /** @type {Record<string, unknown>} */ ({ ...data.data })
                                    : null;
                            if (!result && jobId) {
                                result = await pollCorpusGenerateJob(jobId, (msg) => {
                                    simBanner.textContent = msg;
                                });
                            }
                            if (!result) {
                                setPageAlert('Generate did not return a job id');
                                simBanner.classList.add('hidden');
                                return;
                            }
                            out.replaceChildren();
                            out.append(outPre);
                            renderCorpusGenerateResult(result, outPre, out, simBanner);
                            setPageAlert('');
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : 'Generate failed';
                            setPageAlert(msg);
                            simBanner.classList.add('hidden');
                        }
                    })();

                    return false;
                },
            },
        ],
        onOpen(ctrl) {
            const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
            const host = ctrl?.body instanceof HTMLElement ? ctrl.body : body;
            if (JIT?.hydrate && host instanceof HTMLElement) JIT.hydrate(host);
        },
    });
}

/**
 * @param {HTMLElement} root
 * @param {number} corpusId
 */
async function openCorpusDetail(root, corpusId) {
    const Dialog = await loadDialogCtor();
    if (!Dialog?.open) return;

    const wid = activeWorkspaceId(root);
    const q = new URLSearchParams();
    q.set('corpus_id', String(corpusId));
    if (wid != null) q.set('workspace_id', String(wid));
    const { res, data } = await corpusFetchJson(`corpus_profile_status?${q.toString()}`);
    if (!res.ok || !data?.success) return;

    const prof = data?.data?.profile ?? {};
    const detailStatus = String(data?.data?.status ?? prof?.status ?? 'draft');
    const detailLabel = CORPUS_STATUS_LABEL[detailStatus] ?? detailStatus;
    const styleDef = CORPUS_STATUS_STYLE[detailStatus] ?? CORPUS_STATUS_STYLE.draft;
    const segCount = Number(data?.data?.segment_count ?? 0);
    const srcCount = Number(prof?.source_count ?? 0);

    const body = document.createElement('div');
    body.className = 'flex flex-col gap-4 min-h-0 max-h-[min(520px,calc(100vh-8rem))] overflow-y-auto';

    const head = document.createElement('div');
    head.className = 'flex items-start justify-between gap-2';
    const name = document.createElement('p');
    name.className = 'm-0 text-base fw-semibold fg-[var(--grid-ink)]';
    name.textContent = typeof prof?.name === 'string' ? prof.name : 'Corpus';
    const badge = document.createElement('span');
    badge.className = [
        'shrink-0 text-[0.6875rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border border-solid',
        styleDef.badge,
    ].join(' ');
    badge.textContent = detailLabel;
    head.append(name, badge);
    body.append(head);

    const metrics = document.createElement('div');
    metrics.className = 'grid grid-cols-2 gap-2 text-xs';
    for (const [label, value] of [
        ['Sources', String(srcCount)],
        ['Segments', String(segCount)],
    ]) {
        const cell = document.createElement('div');
        cell.className =
            'rounded-lg border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-3 py-2';
        const l = document.createElement('p');
        l.className = 'm-0 text-[0.65rem] uppercase tracking-wide fg-[var(--grid-ink-muted)]';
        l.textContent = label;
        const v = document.createElement('p');
        v.className = 'm-0 mt-1 text-sm fw-semibold fg-[var(--grid-ink)]';
        v.textContent = value;
        cell.append(l, v);
        metrics.append(cell);
    }
    body.append(metrics);

    const structWarnings = Array.isArray(data?.data?.source_structure_warnings)
        ? data.data.source_structure_warnings
        : [];
    if (structWarnings.length) {
        const warnSec = document.createElement('section');
        warnSec.className =
            'flex flex-col gap-2 rounded-lg border border-solid border-amber-500/40 bg-amber-500/8 px-3 py-2';
        const warnH = document.createElement('h3');
        warnH.className = 'm-0 text-xs fw-semibold fg-amber-900';
        warnH.textContent = 'Possible mis-uploaded sources';
        const warnList = document.createElement('ul');
        warnList.className = 'm-0 p-0 list-none flex flex-col gap-1 text-xs fg-amber-950';
        for (const w of structWarnings) {
            if (!w || typeof w !== 'object') continue;
            const li = document.createElement('li');
            const label =
                typeof w.label === 'string' && w.label.trim() ? w.label.trim() : `Source ${w.source_id ?? ''}`;
            const reason = typeof w.reason === 'string' ? w.reason.trim() : '';
            const simPct = structureSimilarityPct(w.similarity);
            li.textContent =
                reason || (simPct != null ? `${label}: structure ${simPct}%` : label);
            warnList.append(li);
        }
        warnSec.append(warnH, warnList);
        body.append(warnSec);
    }

    const srcCountDetail = Number(prof?.source_count ?? 0);
    const srcLink = document.createElement('button');
    srcLink.type = 'button';
    srcLink.className =
        'text-xs self-start px-2 py-1 rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] hover:bg-[var(--grid-line)]/20 cursor-pointer font-inherit';
    srcLink.textContent = `View sources (${srcCountDetail})`;
    srcLink.addEventListener('click', () => {
        const name = typeof prof?.name === 'string' ? prof.name : 'Corpus';
        void openCorpusSourcesDialog(root, corpusId, name, pageAlertSetter(root));
    });
    body.append(srcLink);

    if (typeof data?.data?.job_id === 'string' && data.data.job_id) {
        const job = document.createElement('p');
        job.className = 'm-0 text-[0.65rem] font-mono fg-[var(--grid-ink-muted)] break-all';
        job.textContent = `Job ${data.data.job_id}`;
        body.append(job);
    }

    if (detailStatus === 'learning') {
        const wait = document.createElement('div');
        wait.className =
            'rounded-lg border border-solid border-[var(--grid-accent)]/30 bg-[var(--grid-accent)]/8 px-3 py-2 text-xs fg-[var(--grid-accent)]';
        wait.textContent = 'Analysis in progress — close this dialog and watch the card on the gallery.';
        body.append(wait);
    }

    let styleObj =
        data?.data?.style_json && typeof data.data.style_json === 'object'
            ? /** @type {Record<string, unknown>} */ ({ ...data.data.style_json })
            : null;
    const profileName = typeof prof?.name === 'string' ? prof.name : 'Corpus';
    const canGenerate = corpusCanGeneratePreview(detailStatus, segCount, styleObj);

    if (styleObj) {
        const sec = document.createElement('section');
        sec.className = 'flex flex-col gap-2';
        const h = document.createElement('h3');
        h.className = 'm-0 text-xs fw-semibold uppercase tracking-wide fg-[var(--grid-ink-muted)]';
        const confPct = Math.round(corpusStyleConfidence(styleObj) * 100);
        h.textContent = `Style profile · confidence ${confPct}%`;
        const toneInput = document.createElement('input');
        toneInput.type = 'text';
        toneInput.className =
            'w-full text-sm px-2 py-1.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] font-inherit';
        toneInput.value = typeof styleObj.tone === 'string' ? styleObj.tone : '';
        const toneLbl = document.createElement('label');
        toneLbl.className = 'text-[0.65rem] fg-[var(--grid-ink-muted)]';
        toneLbl.textContent = 'Tone';
        const jsonArea = document.createElement('textarea');
        jsonArea.className =
            'w-full min-h-[120px] text-[0.65rem] font-mono px-2 py-1.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] font-inherit resize-y';
        jsonArea.value = JSON.stringify(styleObj, null, 2);
        const jsonLbl = document.createElement('label');
        jsonLbl.className = 'text-[0.65rem] fg-[var(--grid-ink-muted)]';
        jsonLbl.textContent = 'Advanced (style_json)';
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className =
            'self-start text-xs px-2 py-1 rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] hover:bg-[var(--grid-line)]/20 cursor-pointer font-inherit';
        saveBtn.textContent = 'Save style';
        saveBtn.addEventListener('click', async () => {
            let parsed = styleObj;
            try {
                parsed = /** @type {Record<string, unknown>} */ (JSON.parse(jsonArea.value));
            } catch {
                pageAlertSetter(root)('Invalid JSON');
                return;
            }
            if (toneInput.value.trim()) parsed.tone = toneInput.value.trim();
            const wid = activeWorkspaceId(root);
            const payload = {
                corpus_id: corpusId,
                name: profileName,
                style_json: parsed,
            };
            if (wid != null) payload.workspace_id = wid;
            const { res, data } = await corpusFetchJson('corpus_profile_save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok || !data?.success) {
                pageAlertSetter(root)(
                    typeof data?.message === 'string' ? data.message : 'Could not save style',
                );
                return;
            }
            styleObj = parsed;
            jsonArea.value = JSON.stringify(parsed, null, 2);
            pageAlertSetter(root)('Style saved');
        });
        sec.append(h, toneLbl, toneInput, jsonLbl, jsonArea, saveBtn);
        body.append(sec);
    }

    const styleMeta =
        styleObj?.meta && typeof styleObj.meta === 'object'
            ? /** @type {Record<string, unknown>} */ (styleObj.meta)
            : null;
    const docType = typeof styleMeta?.document_type === 'string' ? styleMeta.document_type : '';
    if (docType) {
        const dt = document.createElement('p');
        dt.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
        const lab =
            typeof styleMeta?.document_type_label === 'string' ? styleMeta.document_type_label : docType;
        const conf =
            typeof styleMeta?.document_type_confidence === 'number'
                ? Math.round(styleMeta.document_type_confidence * 100)
                : null;
        const method = typeof styleMeta?.document_type_method === 'string' ? styleMeta.document_type_method : '';
        dt.textContent =
            conf != null
                ? `Document type: ${lab} (${docType}, ${conf}%${method ? `, ${method}` : ''})`
                : `Document type: ${lab} (${docType})`;
        body.append(dt);
    }

    const segs = Array.isArray(data?.data?.segments_preview) ? data.data.segments_preview : [];
    const kindSummary =
        data?.data?.segment_kind_summary && typeof data.data.segment_kind_summary === 'object'
            ? /** @type {Record<string, number>} */ (data.data.segment_kind_summary)
            : null;
    if (segs.length) {
        const sec = document.createElement('section');
        sec.className = 'flex flex-col gap-2';
        const h = document.createElement('h3');
        h.className = 'm-0 text-xs fw-semibold uppercase tracking-wide fg-[var(--grid-ink-muted)]';
        h.textContent = 'Segment preview';
        if (kindSummary) {
            const sumRow = document.createElement('div');
            sumRow.className = 'flex flex-wrap gap-1.5';
            for (const key of ['document_segment', 'template_block', 'structured_data']) {
                const n = Number(kindSummary[key] ?? 0);
                if (!Number.isFinite(n) || n < 1) continue;
                const chip = document.createElement('span');
                const meta = CORPUS_SEGMENT_KIND[key] ?? CORPUS_SEGMENT_KIND.document_segment;
                chip.className = [
                    'text-[0.625rem] fw-semibold px-1.5 py-0.5 rounded border border-solid',
                    meta.badge,
                ].join(' ');
                chip.textContent = `${meta.label} ${n}`;
                sumRow.append(chip);
            }
            sec.append(h, sumRow);
        } else {
            sec.append(h);
        }
        const list = document.createElement('ul');
        list.className = 'm-0 p-0 list-none flex flex-col gap-2';
        for (const s of segs) {
            const li = document.createElement('li');
            li.className =
                'text-xs leading-snug rounded-lg border border-solid border-[var(--grid-line)] bg-[var(--grid-panel)] px-3 py-2 fg-[var(--grid-ink)] flex flex-col gap-1';
            let classify = null;
            if (s?.classify_json && typeof s.classify_json === 'object') {
                classify = /** @type {Record<string, unknown>} */ (s.classify_json);
            } else if (typeof s?.classify_json === 'string' && s.classify_json.trim()) {
                try {
                    classify = /** @type {Record<string, unknown>} */ (JSON.parse(s.classify_json));
                } catch {
                    classify = null;
                }
            }
            li.append(corpusSegmentKindBadge(classify));
            const { kind } = resolveCorpusSegmentKind(classify);
            if (kind === 'template_block') {
                appendCorpusNestedBlocks(classify, li);
            }
            if (kind === 'structured_data' && Array.isArray(classify?.fields) && classify.fields.length > 0) {
                const fieldList = document.createElement('ul');
                fieldList.className =
                    'm-0 mt-1 p-0 list-none flex flex-col gap-0.5 text-[0.65rem] fg-[var(--grid-ink-muted)] font-mono';
                const fields = /** @type {Array<{ label?: string, value?: string }>} */ (classify.fields).slice(
                    0,
                    6,
                );
                for (const f of fields) {
                    const row = document.createElement('li');
                    row.className = 'truncate';
                    row.textContent = `${f?.label ?? ''}：${f?.value ?? ''}`;
                    fieldList.append(row);
                }
                if (classify.fields.length > 6) {
                    const more = document.createElement('li');
                    more.className = 'fg-[var(--grid-caption)]';
                    more.textContent = `… +${classify.fields.length - 6} fields`;
                    fieldList.append(more);
                }
                li.append(fieldList);
            }
            const textSpan = document.createElement('span');
            textSpan.className = 'min-w-0 whitespace-pre-wrap break-words';
            textSpan.textContent = typeof s?.text === 'string' ? s.text : '';
            li.append(textSpan);
            list.append(li);
        }
        sec.append(list);
        body.append(sec);
    } else if (detailStatus === 'ready') {
        const empty = document.createElement('p');
        empty.className = 'm-0 text-xs fg-[var(--grid-ink-muted)]';
        empty.textContent = 'No segments stored yet.';
        body.append(empty);
    }

    const dialogButtons = [{ text: 'Close', color: 'muted', action: async () => true }];
    if (srcCount > 0 && detailStatus !== 'learning') {
        dialogButtons.unshift({
            text: 'Re-analyze',
            color: 'muted',
            action: async () => {
                await enqueueAnalyze(root, corpusId, pageAlertSetter(root));
                return false;
            },
        });
    }
    if (canGenerate && styleObj) {
        dialogButtons.unshift({
            text: 'Generate preview',
            color: 'accent',
            action: async () => {
                await openCorpusGeneratePreview(root, corpusId, profileName, styleObj);
                return false;
            },
        });
    }

    Dialog.open({
        title: 'Corpus profile',
        content: body,
        size: 'lg',
        buttons: dialogButtons,
        onOpen(ctrl) {
            const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
            const host = ctrl?.body instanceof HTMLElement ? ctrl.body : body;
            if (JIT?.hydrate && host instanceof HTMLElement) JIT.hydrate(host);
        },
    });
}

/**
 * @param {HTMLElement} host
 */
async function mountCorpusPanel(host) {
    if (!(host instanceof HTMLElement)) return;
    const gen = ++mountGeneration;
    const root = host.querySelector('[data-module="oaao-corpus"]') || host;
    await hydrateCorpusMount(root);

    const setPageAlert = pageAlertSetter(root);
    const newBtn = root.querySelector('[data-oaao-corpus="new"]');
    const listEl = root.querySelector('[data-oaao-corpus="list"]');
    const subtitle = root.querySelector('[data-oaao-corpus="subtitle"]');

    if (subtitle instanceof HTMLElement) {
        subtitle.textContent =
            'Add sources per profile (upload or Vault), remove bindings anytime, then Analyze from the menu.';
    }

    if (newBtn instanceof HTMLButtonElement) {
        newBtn.disabled = false;
        newBtn.removeAttribute('title');
        newBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        if (newBtn.dataset.oaaoCorpusNewBound !== '1') {
            newBtn.dataset.oaaoCorpusNewBound = '1';
            newBtn.addEventListener('click', () => {
                void openNewCorpusDialog(root, setPageAlert).catch((err) => {
                    console.error('[corpus] New corpus dialog failed', err);
                    setPageAlert('Could not open dialog');
                });
            });
        }
    }

    if (listEl instanceof HTMLElement && listEl.dataset.oaaoCorpusListBound !== '1') {
        listEl.dataset.oaaoCorpusListBound = '1';
        listEl.classList.add('flex', 'flex-col', 'gap-3');
        listEl.addEventListener('click', async (ev) => {
            const t = ev.target;
            if (!(t instanceof HTMLElement)) return;

            const sourcesOpenBtn = t.closest('[data-corpus-sources-open]');
            if (sourcesOpenBtn instanceof HTMLButtonElement) {
                const id = Number(sourcesOpenBtn.dataset.corpusSourcesOpen);
                const name = sourcesOpenBtn.dataset.corpusSourcesName || 'Corpus';
                if (Number.isFinite(id) && id > 0) {
                    void openCorpusSourcesDialog(root, id, name, setPageAlert);
                }
                return;
            }

            const removeBtn = t.closest('[data-corpus-source-remove]');
            if (removeBtn instanceof HTMLButtonElement) {
                if (removeBtn.disabled) return;
                const sourceId = Number(removeBtn.dataset.corpusSourceRemove);
                const card = removeBtn.closest('[data-corpus-card]');
                const corpusId = Number(card?.dataset?.corpusCard ?? 0);
                if (Number.isFinite(corpusId) && corpusId > 0 && Number.isFinite(sourceId) && sourceId > 0) {
                    void removeCorpusSource(root, corpusId, sourceId, setPageAlert);
                }
                return;
            }
        });
    }

    wireCorpusCardUploadPick(root);
    await wireCorpusPanelUploader(root, setPageAlert);

    await refreshProfiles(root, setPageAlert);
    if (gen !== mountGeneration) return;
}

/**
 * @param {HTMLElement} mount
 */
export async function mountShellPanel(mount) {
    teardownShellPanel();
    await mountCorpusPanel(mount);
}

/** @param {Record<string, unknown>} [_opts] */
export function teardownShellPanel(_opts = {}) {
    destroyAllCardMenus();
    destroyCorpusPanelUploader();
    destroyCorpusSourcesDialogUploader();
    if (analyzePollTimer) {
        clearInterval(analyzePollTimer);
        analyzePollTimer = null;
    }
    analyzePollCorpusId = null;
}

export default mountShellPanel;
