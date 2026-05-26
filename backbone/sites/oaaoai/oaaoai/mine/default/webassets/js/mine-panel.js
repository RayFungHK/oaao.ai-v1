/**
 * Data Mining workspace panel — mine CRUD, run, DataTable detail.
 */

/** @type {import('../../../../../core/default/razyui/component/DataTable.js').default | null} */
let DataTableCtor = null;
/** @type {((opts?: Record<string, unknown>) => void) | null} */
let detailTableTeardown = null;

function mineMountPrefix() {
    return (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
}

function mineApiUrl(path) {
    const base = `${mineMountPrefix()}/mine/api`.replace(/\/{2,}/g, '/');
    const p = String(path || '').replace(/^\//, '');
    return p ? `${base}/${p}` : base;
}

function mineRowsUrl(params) {
    const q = new URLSearchParams(params);
    return `${mineApiUrl('rows')}?${q.toString()}`;
}

async function mineFetchJson(path, options = {}) {
    const res = await fetch(mineApiUrl(path), {
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

async function loadDataTableCtor() {
    if (DataTableCtor) return DataTableCtor;
    const prefix = mineMountPrefix();
    let path = '/webassets/core/default/razyui/component/DataTable.js';
    if (prefix && prefix !== '/') {
        path = `${prefix.replace(/\/+$/, '')}${path}`.replace(/\/{2,}/g, '/');
    }
    const mod = await import(/* webpackIgnore: true */ path);
    DataTableCtor = mod.default;
    return DataTableCtor;
}

/**
 * @param {Record<string, unknown>} source
 * @returns {string}
 */
function formatSourceLine(source) {
    const kind = String(source?.kind ?? 'http_json').toLowerCase();
    const fetchMode = String(source?.fetch_mode ?? 'http').toLowerCase();
    let cfg = source?.config_json;
    if (typeof cfg === 'string') {
        try {
            cfg = JSON.parse(cfg);
        } catch {
            cfg = {};
        }
    }
    if (!cfg || typeof cfg !== 'object') cfg = {};
    const url = String(/** @type {Record<string, unknown>} */ (cfg).url ?? '');
    if (!url) return '';

    const parts = [];
    if (kind === 'http_index') parts.push('index');
    else if (kind === 'http_csv') parts.push('csv');
    else if (kind === 'http_html_table') parts.push('html');
    else if (kind === 'static_url') parts.push('static');
    if (fetchMode === 'playwright') parts.push('pw');

    const prefix = parts.map((p) => `${p}:`).join('');
    const jsonPath = String(/** @type {Record<string, unknown>} */ (cfg).json_path ?? '').trim();
    const tableSelector = String(
        /** @type {Record<string, unknown>} */ (cfg).table_selector ?? '',
    ).trim();
    const tableIndex = /** @type {Record<string, unknown>} */ (cfg).table_index;
    let hint = '';
    if (kind === 'http_json' && jsonPath) hint = jsonPath;
    else if ((kind === 'http_html_table' || kind === 'static_url') && tableSelector) {
        hint = tableSelector;
    } else if ((kind === 'http_html_table' || kind === 'static_url') && tableIndex != null && Number(tableIndex) > 0) {
        hint = `table:${tableIndex}`;
    }
    return hint ? `${prefix}${url} | ${hint}` : `${prefix}${url}`;
}

/**
 * @param {string} line
 * @returns {{ kind: string, url: string, fetch_mode: string, json_path?: string, table_selector?: string, table_index?: number } | null}
 */
function parseSourceLine(line) {
    const t = line.trim();
    if (!t || t.startsWith('#')) return null;

    let rest = t;
    let kind = 'http_json';
    let fetchMode = 'http';

    while (true) {
        const m = rest.match(/^(csv|html|json|index|static|auto|pw):/i);
        if (!m) break;
        const tag = m[1].toLowerCase();
        if (tag === 'csv') kind = 'http_csv';
        else if (tag === 'html') kind = 'http_html_table';
        else if (tag === 'json') kind = 'http_json';
        else if (tag === 'index') kind = 'http_index';
        else if (tag === 'static') kind = 'static_url';
        else if (tag === 'auto') kind = 'auto';
        else if (tag === 'pw') fetchMode = 'playwright';
        rest = rest.slice(m[0].length);
    }

    const [urlPart, hintPart] = rest.split('|').map((x) => x.trim());
    let url = urlPart ?? '';
    if (!url) return null;

    if (kind === 'http_json' && /arxiv\.org\/list\//i.test(url)) {
        kind = 'http_index';
    }
    if (kind === 'http_json' && !hintPart) {
        kind = 'auto';
    }

    /** @type {{ kind: string, url: string, fetch_mode: string, json_path?: string, table_selector?: string, table_index?: number, source_mode?: string }} */
    const out = { kind, url, fetch_mode: fetchMode };
    if (kind === 'http_index') out.source_mode = 'index';
    else if (kind === 'static_url') out.source_mode = 'static';
    const hint = hintPart ?? '';
    if (kind === 'http_json' && hint) out.json_path = hint;
    else if (kind === 'http_html_table' && hint) {
        if (/^table:\d+$/i.test(hint)) {
            out.table_index = Number(hint.split(':')[1]);
        } else {
            out.table_selector = hint;
        }
    }
    return out;
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} data
 */
function renderMineDiscoverPreview(host, data) {
    host.replaceChildren();
    const mode = String(data.dataset_mode ?? '');
    const head = document.createElement('p');
    head.className = 'm-0 text-xs font-medium fg-[var(--grid-ink)]';
    head.textContent = `Dataset mode: ${mode || 'unknown'} · ${Number(data.row_count ?? 0)} sample row(s)`;
    host.append(head);

    const previews = Array.isArray(data.previews) ? data.previews : [];
    for (const p of previews) {
        const block = document.createElement('div');
        block.className = 'mt-2 text-xs fg-[var(--grid-ink)]';
        if (!p.ok) {
            block.textContent = `${String(p.url ?? '')}: ${String(p.error ?? 'failed')}`;
            host.append(block);
            continue;
        }
        block.textContent = `${String(p.url ?? '')} → ${String(p.page_type ?? p.resolved_kind ?? '?')} (${Math.round(Number(p.confidence ?? 0) * 100)}%)`;
        host.append(block);
    }

    const schema = data.suggested_schema;
    if (schema && typeof schema === 'object') {
        const pre = document.createElement('pre');
        pre.className =
            'mt-2 m-0 p-2 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] text-[0.65rem] overflow-x-auto max-h-28';
        pre.textContent = JSON.stringify(schema, null, 2);
        host.append(pre);
    }

    const rows = Array.isArray(data.sample_rows) ? data.sample_rows : [];
    if (rows.length) {
        const table = document.createElement('div');
        table.className = 'mt-2 max-h-32 overflow-auto text-[0.65rem] font-mono';
        table.textContent = rows
            .slice(0, 8)
            .map((r) => JSON.stringify(r))
            .join('\n');
        host.append(table);
    }
}

/** @type {typeof import('../../../../../core/default/razyui/component/Dialog.js').default | null} */
let DialogCtor = null;

/** @returns {Promise<typeof DialogCtor>} */
async function loadDialogCtor() {
    if (DialogCtor) return DialogCtor;
    try {
        const prefix = mineMountPrefix();
        let path = '/webassets/core/default/razyui/component/Dialog.js';
        if (prefix && prefix !== '/') {
            path = `${prefix.replace(/\/+$/, '')}${path}`.replace(/\/{2,}/g, '/');
        }
        const shellV = document.body?.dataset?.oaaoShellEsmV?.trim() ?? '';
        if (shellV) path += `${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(shellV)}`;
        const mod = await import(/* webpackIgnore: true */ path);
        const Dialog = mod.default;
        if (typeof Dialog !== 'function' || typeof Dialog.open !== 'function') {
            console.error('[mine] Dialog export invalid', mod);
            return null;
        }
        DialogCtor = Dialog;
        return DialogCtor;
    } catch (err) {
        console.error('[mine] Dialog load failed', err);
        return null;
    }
}

const MINE_INPUT_CLASS =
    'rounded border border-solid border-[var(--grid-line)] px-2 py-1.5 w-full box-border';
const MINE_TEXTAREA_CLASS = `${MINE_INPUT_CLASS} font-mono text-xs`;

/**
 * @param {string} labelText
 * @param {HTMLElement} field
 */
function mineFormField(labelText, field) {
    const label = document.createElement('label');
    label.className = 'grid gap-1 text-sm';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span, field);
    return label;
}

/**
 * @param {Record<string, unknown> | null | undefined} mine
 * @returns {string}
 */
function mineSchemaHint(mine) {
    if (!mine?.schema_json) return '';
    try {
        const raw = typeof mine.schema_json === 'string' ? JSON.parse(mine.schema_json) : mine.schema_json;
        return JSON.stringify(raw, null, 2);
    } catch {
        return '';
    }
}

/** @param {HTMLElement} host */
async function mountMinePanel(host) {
    const listEl = host.querySelector('[data-oaao-mine="list"]');
    const detailEl = host.querySelector('[data-oaao-mine="detail"]');
    const msgEl = host.querySelector('[data-oaao-mine="msg"]');
    const newBtn = host.querySelector('[data-oaao-mine="new"]');
    const backBtn = host.querySelector('[data-oaao-mine="back"]');
    if (!(listEl instanceof HTMLElement) || !(detailEl instanceof HTMLElement) || !(msgEl instanceof HTMLElement)) {
        return;
    }

    /** @type {Array<Record<string, unknown>>} */
    let mines = [];
    /** @type {number | null} */
    let activeMineId = null;

    function setMsg(text) {
        msgEl.textContent = text;
    }

    function showList() {
        activeMineId = null;
        detailEl.classList.add('hidden');
        listEl.classList.remove('hidden');
        backBtn?.classList.add('hidden');
        if (detailTableTeardown) {
            detailTableTeardown();
            detailTableTeardown = null;
        }
    }

    /**
     * @param {HTMLElement} formRoot
     * @param {number} mineId
     * @param {Record<string, unknown> | null} [discoverData]
     * @returns {{ payload: Record<string, unknown> | null, error?: string }}
     */
    function buildMinePayload(formRoot, mineId, discoverData = null) {
        const get = (name) => formRoot.querySelector(`[data-f="${name}"]`);
        const labelEl = get('label');
        const descEl = get('description');
        const intervalEl = get('interval_minutes');
        const sourcesEl = get('sources');
        const schemaEl = get('schema_json');
        const hintsEl = get('llm_hints_json');

        /** @type {Array<Record<string, unknown>>} */
        const sources = [];
        if (discoverData && Array.isArray(discoverData.previews)) {
            for (const p of discoverData.previews) {
                if (!p || p.ok === false) continue;
                /** @type {Record<string, unknown>} */
                const src = {
                    url: String(p.url ?? ''),
                    kind: String(p.resolved_kind ?? 'static_url'),
                    resolved_kind: String(p.resolved_kind ?? 'static_url'),
                    discovered_mode: String(p.page_type ?? '') === 'index' ? 'index' : 'static',
                    fetch_mode: 'http',
                };
                if (p.html_hash) src.html_hash = String(p.html_hash);
                sources.push(src);
            }
        } else if (sourcesEl instanceof HTMLTextAreaElement) {
            for (const line of sourcesEl.value.split(/\n/)) {
                const parsed = parseSourceLine(line);
                if (parsed) sources.push(parsed);
            }
        }

        let schemaJson = null;
        if (discoverData?.suggested_schema && typeof discoverData.suggested_schema === 'object') {
            schemaJson = discoverData.suggested_schema;
        } else if (schemaEl instanceof HTMLTextAreaElement && schemaEl.value.trim()) {
            try {
                schemaJson = JSON.parse(schemaEl.value);
            } catch {
                return { payload: null, error: 'Invalid schema JSON' };
            }
        }

        let llmHints = null;
        if (hintsEl instanceof HTMLTextAreaElement && hintsEl.value.trim()) {
            try {
                llmHints = JSON.parse(hintsEl.value);
            } catch {
                return { payload: null, error: 'Invalid LLM hints JSON' };
            }
        }

        return {
            payload: {
                mine_id: mineId > 0 ? mineId : undefined,
                label: labelEl instanceof HTMLInputElement ? labelEl.value.trim() : '',
                description: descEl instanceof HTMLInputElement ? descEl.value.trim() : '',
                interval_minutes: intervalEl instanceof HTMLInputElement ? Number(intervalEl.value) : 60,
                is_enabled: true,
                sources,
                schema_json: schemaJson,
                llm_hints_json: llmHints,
                notify_json: { in_app: true, min_new_rows: 1 },
                ...(mineId < 1 && discoverData ? { discover_confirmed: true } : {}),
            },
        };
    }

    /** @param {Record<string, unknown> | null} [mine] */
    async function openMineDialog(mine = null) {
        const DialogMod = await loadDialogCtor();
        if (!DialogMod) {
            setMsg('Dialog unavailable.');
            return;
        }

        const mineId = mine?.mine_id ? Number(mine.mine_id) : 0;
        const isEdit = mineId > 0;

        const wrap = document.createElement('div');
        wrap.className = 'grid gap-3 max-h-[min(70vh,calc(100vh-8rem))] overflow-y-auto pr-1';

        const errEl = document.createElement('p');
        errEl.className = 'hidden text-xs text-red-600 m-0';

        const labelInput = document.createElement('input');
        labelInput.dataset.f = 'label';
        labelInput.className = MINE_INPUT_CLASS;
        labelInput.value = mine ? String(mine.label ?? '') : '';

        const descInput = document.createElement('input');
        descInput.dataset.f = 'description';
        descInput.className = MINE_INPUT_CLASS;
        descInput.value = mine ? String(mine.description ?? '') : '';

        const intervalInput = document.createElement('input');
        intervalInput.dataset.f = 'interval_minutes';
        intervalInput.type = 'number';
        intervalInput.min = '0';
        intervalInput.className = MINE_INPUT_CLASS;
        intervalInput.value =
            mine && mine.interval_minutes != null ? String(mine.interval_minutes) : '60';

        const sourcesInput = document.createElement('textarea');
        sourcesInput.dataset.f = 'sources';
        sourcesInput.rows = 5;
        sourcesInput.className = MINE_TEXTAREA_CLASS;
        sourcesInput.placeholder =
            '# Paste URLs — Analyze to infer dataset schema before creating\nhttps://arxiv.org/list/cs.AI/recent\nhttps://example.com/page-a\nhttps://example.com/page-b\n# Or explicit:\nindex:https://arxiv.org/list/cs.AI/recent\nhtml:https://example.com/table | .data-table';
        const sources = Array.isArray(mine?.sources) ? mine.sources : [];
        sourcesInput.value = sources.map((s) => formatSourceLine(s)).filter(Boolean).join('\n');

        const schemaInput = document.createElement('textarea');
        schemaInput.dataset.f = 'schema_json';
        schemaInput.rows = 6;
        schemaInput.className = MINE_TEXTAREA_CLASS;
        schemaInput.placeholder =
            '{"table_name":"arxiv_cs_ai","columns":[{"name":"arxiv_id","sql_type":"TEXT"},{"name":"title","sql_type":"TEXT"}],"natural_key":["arxiv_id"]}';
        schemaInput.value = mineSchemaHint(mine);

        const hintsInput = document.createElement('textarea');
        hintsInput.dataset.f = 'llm_hints_json';
        hintsInput.rows = 3;
        hintsInput.className = MINE_TEXTAREA_CLASS;
        hintsInput.placeholder = '{"domain":"HK stock prices"}';
        hintsInput.value = mine?.llm_hints_json ? String(mine.llm_hints_json) : '';

        const pipelineNote = document.createElement('p');
        pipelineNote.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 leading-snug';
        pipelineNote.textContent = isEdit
            ? 'Index/list discovers rows each run; static re-fetches same URL. Edit sources/schema directly.'
            : 'Analyze multiple similar pages to infer columns — confirm dataset preview before creating.';

        const previewWrap = document.createElement('div');
        previewWrap.className =
            'hidden grid gap-2 rounded border border-dashed border-[var(--grid-line)] p-2 bg-[var(--grid-panel-bright)]';
        previewWrap.dataset.oaaoMine = 'discover-preview';

        /** @type {Record<string, unknown> | null} */
        let discoverResult = null;
        let discoverConfirmed = isEdit;

        wrap.append(
            mineFormField('Label', labelInput),
            mineFormField('Description', descInput),
            mineFormField('Interval (minutes, cron stub)', intervalInput),
            mineFormField('Sources — one per line', sourcesInput),
            pipelineNote,
            mineFormField('Dataset preview', previewWrap),
            mineFormField('Schema JSON (required for index/list sources)', schemaInput),
            mineFormField('LLM hints JSON (domain context when schema empty)', hintsInput),
            errEl,
        );

        /** @type {Array<Record<string, unknown>>} */
        const buttons = [
            {
                text: 'Cancel',
                color: 'muted',
                action: async () => true,
            },
        ];

        if (!isEdit) {
            buttons.push({
                text: 'Analyze dataset',
                color: 'primary',
                action: async () => {
                    errEl.classList.add('hidden');
                    discoverConfirmed = false;
                    discoverResult = null;
                    /** @type {Array<{url: string, kind: string}>} */
                    const srcs = [];
                    for (const line of sourcesInput.value.split(/\n/)) {
                        const parsed = parseSourceLine(line);
                        if (parsed) srcs.push({ url: parsed.url, kind: parsed.kind || 'auto' });
                    }
                    if (!srcs.length) {
                        errEl.textContent = 'Add at least one source URL.';
                        errEl.classList.remove('hidden');
                        return false;
                    }
                    let schemaJson = null;
                    if (schemaInput.value.trim()) {
                        try {
                            schemaJson = JSON.parse(schemaInput.value);
                        } catch {
                            errEl.textContent = 'Invalid schema JSON';
                            errEl.classList.remove('hidden');
                            return false;
                        }
                    }
                    setMsg('Analyzing dataset…');
                    const { res, data } = await fetchJson('source_discover', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sources: srcs, schema_json: schemaJson, use_llm: true }),
                    });
                    setMsg('');
                    if (!res.ok || !data?.success || !data?.data) {
                        errEl.textContent = typeof data?.message === 'string' ? data.message : 'Analyze failed';
                        errEl.classList.remove('hidden');
                        return false;
                    }
                    discoverResult = /** @type {Record<string, unknown>} */ (data.data);
                    previewWrap.classList.remove('hidden');
                    renderMineDiscoverPreview(previewWrap, discoverResult);
                    if (discoverResult.suggested_schema && typeof discoverResult.suggested_schema === 'object') {
                        schemaInput.value = JSON.stringify(discoverResult.suggested_schema, null, 2);
                    }
                    discoverConfirmed = true;
                    return false;
                },
            });
        }

        buttons.push({
            text: isEdit ? 'Save' : 'Confirm & create',
            color: 'accent',
            action: async () => {
                errEl.classList.add('hidden');
                if (!isEdit && !discoverConfirmed) {
                    errEl.textContent = 'Analyze sources and review the dataset preview first.';
                    errEl.classList.remove('hidden');
                    return false;
                }
                const built = buildMinePayload(wrap, mineId, isEdit ? null : discoverResult);
                if (!built.payload) {
                    errEl.textContent = built.error ?? 'Invalid form';
                    errEl.classList.remove('hidden');
                    return false;
                }
                setMsg('Saving…');
                const { res, data } = await fetchJson('mine_save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(built.payload),
                });
                if (!res.ok || !data?.success) {
                    errEl.textContent = typeof data?.message === 'string' ? data.message : 'Save failed';
                    errEl.classList.remove('hidden');
                    setMsg('');
                    return false;
                }
                setMsg('Saved.');
                await loadMines();
                return true;
            },
        });

        if (isEdit) {
            buttons.unshift({
                text: 'Delete',
                color: 'danger',
                action: async () => {
                    if (typeof DialogMod.confirm !== 'function') return false;
                    const ok = await DialogMod.confirm(
                        'Delete mine',
                        'Delete this mine and its SQLite file?',
                    );
                    if (!ok) return false;
                    setMsg('Deleting…');
                    const { res, data } = await fetchJson('mine_delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mine_id: mineId }),
                    });
                    if (!res.ok || !data?.success) {
                        errEl.textContent = typeof data?.message === 'string' ? data.message : 'Delete failed';
                        errEl.classList.remove('hidden');
                        setMsg('');
                        return false;
                    }
                    showList();
                    setMsg('Deleted.');
                    await loadMines();
                    return true;
                },
            });
        }

        DialogMod.open({
            title: isEdit ? 'Edit mine' : 'New mine',
            content: wrap,
            size: 'lg',
            buttons,
        });
    }

    async function runMine(mineId) {
        setMsg('Running…');
        const { res, data } = await fetchJson('run_now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mine_id: mineId }),
        });
        if (!res.ok || !data?.success) {
            setMsg(typeof data?.message === 'string' ? data.message : 'Run failed');
            return;
        }
        const stats = data.stats ?? {};
        setMsg(
            `Done — inserted: ${stats.rows_inserted ?? stats.new_rows ?? 0}, updated: ${stats.rows_updated ?? 0}, parsed: ${stats.rows_parsed ?? 0}`,
        );
        await loadMines();
    }

    async function openDetail(mine) {
        const mineId = Number(mine.mine_id ?? 0);
        if (mineId < 1) return;
        activeMineId = mineId;
        listEl.classList.add('hidden');
        detailEl.classList.remove('hidden');
        backBtn?.classList.remove('hidden');

        const lastStats = mine.last_stats ?? {};
        const runId = mine.last_run?.run_id;
        detailEl.innerHTML = `
<header class="flex flex-wrap items-center justify-between gap-2 mb-2">
<div><h2 class="text-base fw-semibold m-0">${String(mine.label ?? 'Mine')}</h2>
<p class="text-xs fg-[var(--grid-ink-muted)] m-0 mt-1">Last run: +${String(lastStats.rows_inserted ?? 0)} rows · table from schema</p></div>
<div class="flex gap-2">
<button type="button" data-act="run" class="text-xs px-2 py-1 rounded bg-[var(--grid-ink)] fg-[var(--grid-paper)] border-none cursor-pointer">Run now</button>
<button type="button" data-act="filter-run" class="text-xs px-2 py-1 rounded border border-solid border-[var(--grid-line)] cursor-pointer">This run only</button>
<button type="button" data-act="export-csv" class="text-xs px-2 py-1 rounded border border-solid border-[var(--grid-line)] cursor-pointer">Export CSV</button>
<button type="button" data-act="export-vault" class="text-xs px-2 py-1 rounded border border-solid border-[var(--grid-line)] cursor-pointer">Export to Vault</button>
</div></header>
<div data-oaao-mine="table-host" class="min-h-[240px] border border-solid border-[var(--grid-line)] rounded-lg overflow-hidden"></div>`;

        /** @type {number | null} */
        let filterRunId = runId != null ? Number(runId) : null;

        detailEl.querySelector('[data-act="run"]')?.addEventListener('click', () => void runMine(mineId));

        detailEl.querySelector('[data-act="export-csv"]')?.addEventListener('click', () => {
            const q = new URLSearchParams({ mine_id: String(mineId) });
            if (filterRunId != null) q.set('run_id', String(filterRunId));
            window.location.href = `${mineApiUrl('export_csv')}?${q.toString()}`;
        });

        detailEl.querySelector('[data-act="export-vault"]')?.addEventListener('click', () => void exportMineToVault(mineId));

        async function exportMineToVault(mid) {
            const vaultRaw = window.prompt('Vault ID to upload CSV into:', '');
            if (vaultRaw == null || vaultRaw.trim() === '') return;
            const vaultId = Number(vaultRaw.trim());
            if (!Number.isFinite(vaultId) || vaultId < 1) {
                setMsg('Invalid vault ID');
                return;
            }
            const containerRaw = window.prompt('Folder container ID (optional, leave blank for vault root):', '');
            /** @type {Record<string, unknown>} */
            const body = { mine_id: mid, vault_id: vaultId };
            if (containerRaw != null && containerRaw.trim() !== '') {
                const cid = Number(containerRaw.trim());
                if (Number.isFinite(cid) && cid > 0) body.container_id = cid;
            }
            if (filterRunId != null) body.run_id = filterRunId;
            setMsg('Uploading to Vault…');
            const { res, data } = await fetchJson('export_vault', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok || !data?.success) {
                setMsg(typeof data?.message === 'string' ? data.message : 'Vault export failed');
                return;
            }
            setMsg(
                `Vault export OK — ${String(data.row_count ?? 0)} rows${data.truncated ? ' (truncated)' : ''}${data.document_id != null ? ` · doc ${data.document_id}` : ''}`,
            );
        }

        const tableHost = detailEl.querySelector('[data-oaao-mine="table-host"]');
        if (!(tableHost instanceof HTMLElement)) return;

        /** @type {Record<string, string>} */
        let columns = {};
        try {
            const rawSchema =
                typeof mine.schema_json === 'string' ? JSON.parse(mine.schema_json) : mine.schema_json;
            if (rawSchema && Array.isArray(rawSchema.columns)) {
                for (const c of rawSchema.columns) {
                    if (c && typeof c.name === 'string' && !c.name.startsWith('_')) {
                        columns[c.name] = c.name;
                    }
                }
            }
        } catch {
            columns = {};
        }

        if (Object.keys(columns).length === 0) {
            const { data: meta } = await mineFetchJson(`rows?mine_id=${mineId}&page=1&pageSize=1`);
            if (meta && Array.isArray(meta.columns)) {
                for (const c of meta.columns) {
                    if (typeof c === 'string' && !c.startsWith('_')) columns[c] = c;
                }
            } else if (meta && Array.isArray(meta.data) && meta.data[0]) {
                for (const k of Object.keys(meta.data[0])) {
                    if (!k.startsWith('_')) columns[k] = k;
                }
            }
        }

        const DT = await loadDataTableCtor();
        detailEl.querySelector('[data-act="filter-run"]')?.addEventListener('click', () => {
            filterRunId = runId != null ? Number(runId) : null;
            dt.reload();
        });

        const dt = new DT(tableHost, {
            columns,
            pageSize: 50,
            striped: true,
            hover: true,
            ajax: {
                url: mineApiUrl('rows'),
                pageSize: 50,
                dataKey: 'data',
                totalKey: 'total',
                onBeforeRequest: ({ page, pageSize: ps }) => {
                    const p = { mine_id: String(mineId), page: String(page), pageSize: String(ps) };
                    if (filterRunId != null) p.run_id = String(filterRunId);
                    return p;
                },
            },
        });
        detailTableTeardown = () => dt.destroy();
    }

    function renderList() {
        listEl.innerHTML = '';
        if (!mines.length) {
            listEl.innerHTML = '<p class="text-sm fg-[var(--grid-ink-muted)] m-0">No mines yet — create one to fetch JSON, CSV, or HTML tables into SQLite.</p>';
            return;
        }
        for (const m of mines) {
            const card = document.createElement('div');
            card.className =
                'border border-solid border-[var(--grid-line)] rounded-lg p-3 grid gap-2 bg-[var(--grid-panel-bright)]';
            const srcCount = Array.isArray(m.sources) ? m.sources.length : 0;
            const stats = m.last_stats ?? {};
            card.innerHTML = `
<div class="flex flex-wrap items-center justify-between gap-2">
<strong class="text-sm">${String(m.label ?? 'Mine')}</strong>
<div class="flex gap-2">
<button type="button" data-act="view" class="text-xs px-2 py-1 rounded border border-solid border-[var(--grid-line)] cursor-pointer">DataTable</button>
<button type="button" data-act="edit" class="text-xs px-2 py-1 rounded border border-solid border-[var(--grid-line)] cursor-pointer">Edit</button>
<button type="button" data-act="run" class="text-xs px-2 py-1 rounded bg-[var(--grid-ink)] fg-[var(--grid-paper)] border-none cursor-pointer">Run</button>
</div></div>
<p class="text-xs fg-[var(--grid-ink-muted)] m-0">${srcCount} source(s) · every ${String(m.interval_minutes ?? '—')} min · last +${String(stats.rows_inserted ?? 0)} rows</p>`;
            card.querySelector('[data-act="view"]')?.addEventListener('click', () => void openDetail(m));
            card.querySelector('[data-act="edit"]')?.addEventListener('click', () => void openMineDialog(m));
            card.querySelector('[data-act="run"]')?.addEventListener('click', () => void runMine(Number(m.mine_id)));
            listEl.appendChild(card);
        }
    }

    async function loadMines() {
        const { res, data } = await fetchJson('mine_list');
        if (!res.ok || !data?.success) {
            setMsg('Could not load mines.');
            return;
        }
        mines = Array.isArray(data.mines) ? data.mines : [];
        if (activeMineId == null) renderList();
        setMsg('');
    }

    async function fetchJson(path, options) {
        return mineFetchJson(path, options);
    }

    newBtn?.addEventListener('click', () => void openMineDialog(null));
    backBtn?.addEventListener('click', () => showList());
    await loadMines();
}

/**
 * @param {HTMLElement} mount
 */
export async function mountShellPanel(mount) {
    teardownShellPanel();
    await mountMinePanel(mount);
}

/** @param {Record<string, unknown>} [_opts] */
export function teardownShellPanel(_opts = {}) {
    if (detailTableTeardown) {
        detailTableTeardown();
        detailTableTeardown = null;
    }
}

export default mountShellPanel;
