/**
 * Admin Settings — Skills providers, OpenAPI tool servers, evolution cron triggers.
 */

import { oaaoMountLoadingLogo } from './oaao-loading-logo.js';

/** @type {Record<'en' | 'zh-Hant', Record<string, string>>} */
const LABELS = {
    en: {
        loading: 'Loading skills & tools…',
        load_failed: 'Could not load skills admin data.',
        intro: 'Manage OpenAPI tool servers (persisted JSON) and review micro-skill providers. Tool servers are merged into each chat run payload.',
        providers: 'Micro-skill providers',
        providers_empty: 'No providers registered.',
        skill_counts: 'Conversation micro skills',
        tool_servers: 'Tool servers',
        tool_servers_empty: 'No tool servers — add one below.',
        config_path: 'Persisted file',
        col_id: 'ID',
        col_base: 'Base URL',
        col_purposes: 'Purposes',
        col_provider: 'Provider',
        col_kind: 'Kind',
        add_server: 'Add tool server',
        save_servers: 'Save tool servers',
        save_ok: 'Tool servers saved.',
        save_fail: 'Save failed.',
        cron_daily: 'Run daily report now',
        cron_weekly: 'Run weekly auto-apply now',
        cron_ok: 'Cron job completed.',
        cron_fail: 'Cron job failed.',
        crystal_stats: 'Crystallized skills (in-memory)',
        crystal_count: 'Skills loaded',
        crystal_usage: 'Total recall usage',
        iqs_actions: 'IQS action distribution (recent runs)',
        iqs_actions_empty: 'No IQS action data yet.',
        evolution_patches: 'Evolution patches',
        patches_empty: 'No patches recorded.',
        patch_approve: 'Approve',
        patch_rollback: 'Rollback',
        patch_ok: 'Patch updated.',
        patch_fail: 'Patch action failed.',
        daily_reports: 'Recent daily reports',
        daily_reports_empty: 'No reports yet — run daily report or wait for cron.',
        report_samples: 'Samples',
        report_status: 'Status',
        systemd_hint: 'Schedule on the host with systemd timers — see scripts/systemd/README.md',
        field_id: 'Server ID',
        field_base: 'Base URL',
        field_openapi: 'OpenAPI path',
        field_purposes: 'Allowed purposes (comma-separated)',
    },
    'zh-Hant': {
        loading: '正在載入 Skills 與工具…',
        load_failed: '無法載入 Skills 管理資料。',
        intro: '管理 OpenAPI tool servers（JSON 持久化）並檢視 micro-skill providers。Tool servers 會合併進每次 chat run。',
        providers: 'Micro-skill providers',
        providers_empty: '尚未註冊 provider。',
        skill_counts: '對話 micro skills',
        tool_servers: 'Tool servers',
        tool_servers_empty: '尚無 tool server — 請在下方新增。',
        config_path: '持久化檔案',
        col_id: 'ID',
        col_base: 'Base URL',
        col_purposes: 'Purposes',
        col_provider: 'Provider',
        col_kind: 'Kind',
        add_server: '新增 tool server',
        save_servers: '儲存 tool servers',
        save_ok: 'Tool servers 已儲存。',
        save_fail: '儲存失敗。',
        cron_daily: '立即執行 daily report',
        cron_weekly: '立即執行 weekly auto-apply',
        cron_ok: 'Cron 工作已完成。',
        cron_fail: 'Cron 工作失敗。',
        crystal_stats: 'Crystallized skills（記憶體）',
        crystal_count: '已載入 skills',
        crystal_usage: 'Recall 使用次數',
        iqs_actions: 'IQS action 分布（近期 runs）',
        iqs_actions_empty: '尚無 IQS action 資料。',
        evolution_patches: 'Evolution patches',
        patches_empty: '尚無 patch 記錄。',
        patch_approve: '核准',
        patch_rollback: 'Rollback',
        patch_ok: 'Patch 已更新。',
        patch_fail: 'Patch 操作失敗。',
        daily_reports: 'Recent daily reports',
        daily_reports_empty: '尚無 report — 請執行 daily report 或等待 cron。',
        report_samples: '樣本數',
        report_status: '狀態',
        systemd_hint: '在 host 上用 systemd timer 排程 — 見 scripts/systemd/README.md',
        field_id: 'Server ID',
        field_base: 'Base URL',
        field_openapi: 'OpenAPI path',
        field_purposes: 'Allowed purposes（逗號分隔）',
    },
};

/** @returns {'en' | 'zh-Hant'} */
function panelLang() {
    const raw = (typeof document !== 'undefined' && document.documentElement.lang) || navigator.language || 'en';
    return String(raw).toLowerCase().startsWith('zh') ? 'zh-Hant' : 'en';
}

/** @param {string} name @param {Record<string, string|number>} [vars] */
function label(name, vars = {}) {
    const lang = panelLang();
    let out = LABELS[lang][name] ?? LABELS.en[name] ?? name;
    for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(String(v));
    return out;
}

/** @param {HTMLElement} el @param {Partial<CSSStyleDeclaration>|Record<string, string>} styles */
function sty(el, styles) {
    Object.assign(el.style, styles);
}

const UI = { line: 'rgba(0,0,0,0.1)', ink: '#111', muted: '#666', caption: '#888', paper: '#fafafa', caution: '#b45309' };

/** @returns {string} */
function chatApiUrl(name) {
    const mount = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    const pref = mount && mount !== '/' ? (mount.startsWith('/') ? mount : `/${mount}`).replace(/\/+$/, '') : '';
    return `${pref}/chat/api/${name}`;
}

/** @param {string} url @param {RequestInit} [init] */
async function fetchJson(url, init) {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json', ...(init?.headers || {}) }, ...init });
    const raw = await res.text();
    /** @type {Record<string, unknown>} */
    let data = {};
    try { data = JSON.parse(raw); } catch { data = {}; }
    return { res, data };
}

/** @type {Array<Record<string, string>>} */
let editableServers = [];

/**
 * @param {Record<string, unknown>} data
 * @param {{ onSave: () => void, onCron: (job: string) => void, onPatch: (patchId: string, action: string) => void }} handlers
 */
function renderPanel(data, handlers) {
    const root = document.createElement('div');
    sty(root, { display: 'flex', flexDirection: 'column', gap: '20px', minWidth: '0', maxWidth: '48rem', width: '100%' });

    const intro = document.createElement('p');
    sty(intro, { fontSize: '13px', color: UI.muted, margin: '0', lineHeight: '1.45' });
    intro.textContent = label('intro');
    root.appendChild(intro);

    const counts = data.micro_skill_counts && typeof data.micro_skill_counts === 'object' ? data.micro_skill_counts : {};
    const countsP = document.createElement('p');
    sty(countsP, { fontSize: '13px', margin: '0' });
    countsP.textContent = `${label('skill_counts')}: total ${counts.total ?? 0}, published ${counts.published ?? 0}, draft ${counts.draft ?? 0}`;
    root.appendChild(countsP);

    const pathP = document.createElement('p');
    sty(pathP, { fontSize: '12px', fontFamily: 'monospace', color: UI.caption, margin: '0' });
    pathP.textContent = `${label('config_path')}: ${String(data.tool_servers_file ?? '—')}`;
    root.appendChild(pathP);

    const cronRow = document.createElement('div');
    sty(cronRow, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
    for (const [job, text] of [['daily', 'cron_daily'], ['weekly', 'cron_weekly']]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label(text);
        sty(btn, { fontSize: '13px', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${UI.line}`, background: '#fff', cursor: 'pointer' });
        btn.addEventListener('click', () => handlers.onCron(job));
        cronRow.appendChild(btn);
    }
    root.appendChild(cronRow);

    const hint = document.createElement('p');
    sty(hint, { fontSize: '12px', color: UI.muted, margin: '0' });
    hint.textContent = label('systemd_hint');
    root.appendChild(hint);

    const reportsHeading = document.createElement('h3');
    sty(reportsHeading, { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: UI.caption, margin: '8px 0 0' });
    reportsHeading.textContent = label('daily_reports');
    root.appendChild(reportsHeading);

    const reportsList = document.createElement('div');
    reportsList.dataset.oaaoEvolutionReports = '1';
    sty(reportsList, { display: 'flex', flexDirection: 'column', gap: '8px' });
    const reports = Array.isArray(data.evolution_reports) ? data.evolution_reports : [];
    if (reports.length === 0) {
        const empty = document.createElement('p');
        sty(empty, { fontSize: '13px', color: UI.muted, margin: '0' });
        empty.textContent = label('daily_reports_empty');
        reportsList.appendChild(empty);
    } else {
        reports.forEach((rep) => {
            if (!rep || typeof rep !== 'object') return;
            const card = document.createElement('div');
            sty(card, { border: `1px solid ${UI.line}`, borderRadius: '8px', padding: '10px 12px', fontSize: '12px' });
            const id = String(rep.report_id ?? '—');
            const samples = Number(rep.sample_count ?? 0);
            const status = String(rep.status ?? '—');
            card.innerHTML = `<strong>${id}</strong><br>${label('report_samples')}: ${samples} · ${label('report_status')}: ${status}`;
            const killers = rep.top_iqs_killers;
            if (Array.isArray(killers) && killers.length > 0) {
                const sub = document.createElement('pre');
                sty(sub, { margin: '6px 0 0', fontSize: '11px', whiteSpace: 'pre-wrap', color: UI.muted });
                sub.textContent = JSON.stringify({ top_iqs_killers: killers, top_accs_agent_kinds: rep.top_accs_agent_kinds ?? [] }, null, 2);
                card.appendChild(sub);
            }
            reportsList.appendChild(card);
        });
    }
    root.appendChild(reportsList);

    const crystal = data.crystallization_stats && typeof data.crystallization_stats === 'object' ? data.crystallization_stats : {};
    const crystalHeading = document.createElement('h3');
    sty(crystalHeading, { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: UI.caption, margin: '8px 0 0' });
    crystalHeading.textContent = label('crystal_stats');
    root.appendChild(crystalHeading);
    const crystalP = document.createElement('p');
    sty(crystalP, { fontSize: '13px', margin: '0' });
    crystalP.textContent = `${label('crystal_count')}: ${crystal.skill_count ?? 0} · ${label('crystal_usage')}: ${crystal.total_usage ?? 0}`;
    root.appendChild(crystalP);

    const iqsHeading = document.createElement('h3');
    sty(iqsHeading, { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: UI.caption, margin: '8px 0 0' });
    iqsHeading.textContent = label('iqs_actions');
    root.appendChild(iqsHeading);
    const iqsDist = data.iqs_action_distribution && typeof data.iqs_action_distribution === 'object' ? data.iqs_action_distribution : {};
    const iqsP = document.createElement('p');
    sty(iqsP, { fontSize: '13px', margin: '0', fontFamily: 'monospace' });
    const iqsKeys = Object.keys(iqsDist);
    iqsP.textContent = iqsKeys.length ? iqsKeys.map((k) => `${k}: ${iqsDist[k]}`).join(' · ') : label('iqs_actions_empty');
    root.appendChild(iqsP);

    const patchHeading = document.createElement('h3');
    sty(patchHeading, { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: UI.caption, margin: '8px 0 0' });
    patchHeading.textContent = label('evolution_patches');
    root.appendChild(patchHeading);
    const patchList = document.createElement('div');
    sty(patchList, { display: 'flex', flexDirection: 'column', gap: '8px' });
    const patches = Array.isArray(data.evolution_patches) ? data.evolution_patches : [];
    if (patches.length === 0) {
        const emptyP = document.createElement('p');
        sty(emptyP, { fontSize: '13px', color: UI.muted, margin: '0' });
        emptyP.textContent = label('patches_empty');
        patchList.appendChild(emptyP);
    } else {
        patches.forEach((patch) => {
            if (!patch || typeof patch !== 'object') return;
            const card = document.createElement('div');
            sty(card, { border: `1px solid ${UI.line}`, borderRadius: '8px', padding: '10px 12px', fontSize: '12px' });
            const pid = String(patch.patch_id ?? '—');
            const status = String(patch.status ?? '—');
            card.innerHTML = `<strong>${pid}</strong> · ${status}`;
            const actions = document.createElement('div');
            sty(actions, { display: 'flex', gap: '8px', marginTop: '8px' });
            for (const [act, text] of [['approve', 'patch_approve'], ['rollback', 'patch_rollback']]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = label(text);
                sty(btn, { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${UI.line}`, background: '#fff', cursor: 'pointer' });
                btn.addEventListener('click', () => handlers.onPatch(pid, act));
                actions.appendChild(btn);
            }
            card.appendChild(actions);
            patchList.appendChild(card);
        });
    }
    root.appendChild(patchList);

    const srvHeading = document.createElement('h3');
    sty(srvHeading, { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: UI.caption, margin: '8px 0 0' });
    srvHeading.textContent = label('tool_servers');
    root.appendChild(srvHeading);

    const tableWrap = document.createElement('div');
    sty(tableWrap, { border: `1px solid ${UI.line}`, borderRadius: '10px', overflow: 'hidden' });
    const table = document.createElement('table');
    sty(table, { width: '100%', borderCollapse: 'collapse', fontSize: '13px' });
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr style="background:rgba(0,0,0,0.03)"><th style="padding:8px 12px;text-align:left">${label('col_id')}</th><th style="padding:8px 12px;text-align:left">${label('col_base')}</th><th style="padding:8px 12px;text-align:left">${label('col_purposes')}</th></tr>`;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    tbody.dataset.oaaoToolServersBody = '1';
    if (editableServers.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        sty(td, { padding: '12px', color: UI.muted });
        td.textContent = label('tool_servers_empty');
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        editableServers.forEach((row, idx) => {
            const tr = document.createElement('tr');
            if (idx > 0) tr.style.borderTop = `1px solid ${UI.line}`;
            tr.innerHTML = `<td style="padding:8px 12px;font-family:monospace">${row.id}</td><td style="padding:8px 12px">${row.base_url}</td><td style="padding:8px 12px">${row.allowed_purposes || 'chat'}</td>`;
            tbody.appendChild(tr);
        });
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    root.appendChild(tableWrap);

    const form = document.createElement('div');
    sty(form, { display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr', marginTop: '8px' });
    const fields = [
        ['field_id', 'id', 'web_search'],
        ['field_base', 'base_url', 'http://searxng:8080'],
        ['field_openapi', 'openapi_url', '/openapi.json'],
        ['field_purposes', 'allowed_purposes', 'chat,planning'],
    ];
    /** @type {Record<string, HTMLInputElement>} */
    const inputs = {};
    fields.forEach(([lbl, key, placeholder]) => {
        const wrap = document.createElement('label');
        sty(wrap, { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' });
        wrap.textContent = label(lbl);
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = placeholder;
        sty(inp, { padding: '8px', borderRadius: '6px', border: `1px solid ${UI.line}` });
        inputs[key] = inp;
        wrap.appendChild(inp);
        form.appendChild(wrap);
    });
    root.appendChild(form);

    const actions = document.createElement('div');
    sty(actions, { display: 'flex', gap: '8px', flexWrap: 'wrap' });
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = label('add_server');
    sty(addBtn, { fontSize: '13px', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${UI.line}`, background: UI.paper, cursor: 'pointer' });
    addBtn.addEventListener('click', () => {
        const id = inputs.id.value.trim();
        const base = inputs.base_url.value.trim();
        if (!id || !base) return;
        editableServers.push({
            id,
            base_url: base,
            openapi_url: inputs.openapi_url.value.trim() || '/openapi.json',
            allowed_purposes: inputs.allowed_purposes.value.trim() || 'chat',
            label: id,
        });
        handlers.onSave(false);
    });
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = label('save_servers');
    sty(saveBtn, { fontSize: '13px', padding: '8px 12px', borderRadius: '8px', border: 'none', background: UI.ink, color: '#fff', cursor: 'pointer' });
    saveBtn.addEventListener('click', () => handlers.onSave(true));
    actions.append(addBtn, saveBtn);
    root.appendChild(actions);

    const provHeading = document.createElement('h3');
    sty(provHeading, { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: UI.caption, margin: '8px 0 0' });
    provHeading.textContent = label('providers');
    root.appendChild(provHeading);

    const providers = Array.isArray(data.providers) ? data.providers : [];
    const pList = document.createElement('ul');
    sty(pList, { margin: '0', paddingLeft: '20px', fontSize: '13px' });
    if (providers.length === 0) {
        const li = document.createElement('li');
        li.textContent = label('providers_empty');
        pList.appendChild(li);
    } else {
        providers.forEach((p) => {
            if (!p || typeof p !== 'object') return;
            const li = document.createElement('li');
            li.textContent = `${p.provider_id ?? p.id ?? '—'} (${p.kind ?? '—'}) — ${p.label ?? ''}`;
            pList.appendChild(li);
        });
    }
    root.appendChild(pList);

    return root;
}

/** @param {HTMLElement} host @param {{ JIT?: { hydrate?: (el: HTMLElement) => void } }} [ctx] */
export async function mountSettingsPanel(host, ctx = {}) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: label('loading') });

    const wrap = document.createElement('div');
    wrap.className = 'min-w-0 w-full';

    const statusEl = document.createElement('p');
    sty(statusEl, { fontSize: '13px', margin: '0 0 8px' });
    wrap.appendChild(statusEl);

    const reload = async () => {
        const { res, data } = await fetchJson(chatApiUrl('skills_admin'));
        wrap.querySelector('[data-oaao-skills-body]')?.remove();
        if (!res.ok || data.success !== true) {
            statusEl.style.color = UI.caution;
            statusEl.textContent = label('load_failed');
            return;
        }
        const payload = data.data && typeof data.data === 'object' ? data.data : {};
        let evolutionReports = [];
        try {
            const repRes = await fetchJson(chatApiUrl('evolution_reports'));
            if (repRes.res.ok && repRes.data.success === true && repRes.data.data && typeof repRes.data.data === 'object') {
                evolutionReports = Array.isArray(repRes.data.data.reports) ? repRes.data.data.reports : [];
            }
        } catch {
            evolutionReports = [];
        }
        payload.evolution_reports = evolutionReports;
        try {
            const patchRes = await fetchJson(chatApiUrl('evolution_patches'));
            if (patchRes.res.ok && patchRes.data.success === true && patchRes.data.data && typeof patchRes.data.data === 'object') {
                payload.evolution_patches = Array.isArray(patchRes.data.data.patches) ? patchRes.data.data.patches : [];
            }
        } catch {
            payload.evolution_patches = [];
        }
        if (payload.crystallization_stats === undefined) payload.crystallization_stats = {};
        if (payload.iqs_action_distribution === undefined) payload.iqs_action_distribution = {};
        if (editableServers.length === 0) {
            editableServers = (Array.isArray(payload.tool_servers) ? payload.tool_servers : []).map((row) => ({
                id: String(row.id ?? ''),
                base_url: String(row.base_url ?? ''),
                openapi_url: String(row.openapi_url ?? '/openapi.json'),
                allowed_purposes: Array.isArray(row.allowed_purposes) ? row.allowed_purposes.join(',') : 'chat',
                label: String(row.label ?? row.id ?? ''),
            }));
        }
        const body = document.createElement('div');
        body.dataset.oaaoSkillsBody = '1';
        body.appendChild(
            renderPanel(payload, {
                onSave: (persist) => void persistServers(statusEl, wrap, ctx, persist),
                onCron: (job) => void runCron(statusEl, job),
                onPatch: (patchId, action) => void runPatchAction(statusEl, wrap, ctx, patchId, action),
            }),
        );
        wrap.querySelector('[data-oaao-skills-body]')?.remove();
        wrap.appendChild(body);
        ctx.JIT?.hydrate?.(body);
    };

    async function persistServers(statusEl, wrap, ctx, persist) {
        if (persist) {
            const servers = editableServers.map((row) => ({
                id: row.id,
                base_url: row.base_url,
                openapi_url: row.openapi_url || '/openapi.json',
                label: row.label || row.id,
                allowed_purposes: String(row.allowed_purposes || 'chat')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
            }));
            const { res, data } = await fetchJson(chatApiUrl('tool_servers_save'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ servers }),
            });
            statusEl.style.color = res.ok && data.success === true ? UI.ink : UI.caution;
            statusEl.textContent = res.ok && data.success === true ? label('save_ok') : label('save_fail');
            if (res.ok && data.success === true) editableServers = servers.map((s) => ({
                ...s,
                allowed_purposes: (s.allowed_purposes || []).join(','),
            }));
        }
        await reload();
    }

    async function runCron(statusEl, job) {
        const { res, data } = await fetchJson(chatApiUrl('evolution_cron_run'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job }),
        });
        statusEl.style.color = res.ok && data.success === true ? UI.ink : UI.caution;
        if (res.ok && data.success === true) {
            const result = data.data && typeof data.data === 'object' ? data.data.result : null;
            statusEl.textContent = result && typeof result === 'object'
                ? `${label('cron_ok')} ${String(result.report_id ?? '')} (${Number(result.sample_count ?? 0)} samples)`
                : label('cron_ok');
        } else {
            statusEl.textContent = label('cron_fail');
        }
        await reload();
    }

    async function runPatchAction(statusEl, wrap, ctx, patchId, action) {
        const { res, data } = await fetchJson(chatApiUrl('evolution_patches'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patch_id: patchId, action }),
        });
        statusEl.style.color = res.ok && data.success === true ? UI.ink : UI.caution;
        statusEl.textContent = res.ok && data.success === true ? label('patch_ok') : label('patch_fail');
        await reload();
    }

    await reload();
    host.textContent = '';
    host.appendChild(wrap);
    ctx.JIT?.hydrate?.(host);
}

export function teardownSettingsPanel() {}
