/**
 * Admin Settings — Skills providers and OpenAPI tool servers.
 */

import { oaaoMountLoadingLogo } from './oaao-loading-logo.js';

/** @type {Record<'en' | 'zh-Hant', Record<string, string>>} */
const LABELS = {
    en: {
        loading: 'Loading skills & tools…',
        load_failed: 'Could not load skills admin data.',
        intro: 'Manage OpenAPI tool servers and hot-plug skills (persisted JSON). Both are merged into each chat run as LLM function tools — no orchestrator restart.',
        providers: 'Micro-skill providers',
        providers_empty: 'No providers registered.',
        skill_counts: 'Conversation micro skills',
        hot_plug_skills: 'Hot-plug skills',
        hot_plug_empty: 'No hot-plug skills — add one below.',
        hot_plug_hint: 'Saved skills appear on the next chat message. Use handler "instruction" for prompt templates ({{param}}) or "http" for POST webhooks.',
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
        add_skill: 'Add hot-plug skill',
        save_skills: 'Save hot-plug skills',
        save_skills_ok: 'Hot-plug skills saved.',
        field_skill_id: 'Skill ID',
        field_skill_desc: 'Description',
        field_handler: 'Handler (instruction | http)',
        field_instruction: 'Instruction template',
        field_handler_url: 'Handler URL (http only)',
        field_parameters: 'Parameters JSON',
        col_desc: 'Description',
        col_handler: 'Handler',
        field_id: 'Server ID',
        field_base: 'Base URL',
        field_openapi: 'OpenAPI path',
        field_purposes: 'Allowed purposes (comma-separated)',
    },
    'zh-Hant': {
        loading: '正在載入 Skills 與工具…',
        load_failed: '無法載入 Skills 管理資料。',
        intro: '管理 OpenAPI tool servers 與 hot-plug skills（JSON 持久化）。兩者都會合併進每次 chat run 的 LLM function tools，無需重啟 orchestrator。',
        providers: 'Micro-skill providers',
        providers_empty: '尚未註冊 provider。',
        skill_counts: '對話 micro skills',
        hot_plug_skills: 'Hot-plug skills',
        hot_plug_empty: '尚無 hot-plug skill — 請在下方新增。',
        hot_plug_hint: '儲存後下一次對話即生效。handler 用 instruction（{{param}} 模板）或 http（POST webhook）。',
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
        add_skill: '新增 hot-plug skill',
        save_skills: '儲存 hot-plug skills',
        save_skills_ok: 'Hot-plug skills 已儲存。',
        field_skill_id: 'Skill ID',
        field_skill_desc: 'Description',
        field_handler: 'Handler（instruction | http）',
        field_instruction: 'Instruction 模板',
        field_handler_url: 'Handler URL（僅 http）',
        field_parameters: 'Parameters JSON',
        col_desc: 'Description',
        col_handler: 'Handler',
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

/** @type {Array<Record<string, string>>} */
let editableHotPlugSkills = [];

/**
 * @param {Record<string, unknown>} data
 * @param {{ onSave: (persist: boolean) => void }} handlers
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

    const skillsPathP = document.createElement('p');
    sty(skillsPathP, { fontSize: '12px', fontFamily: 'monospace', color: UI.caption, margin: '0' });
    skillsPathP.textContent = `${label('config_path')}: ${String(data.skills_manifest_file ?? '—')}`;
    root.appendChild(skillsPathP);

    const hpHint = document.createElement('p');
    sty(hpHint, { fontSize: '12px', color: UI.muted, margin: '0', lineHeight: '1.45' });
    hpHint.textContent = label('hot_plug_hint');
    root.appendChild(hpHint);

    const hpHeading = document.createElement('h3');
    sty(hpHeading, { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: UI.caption, margin: '8px 0 0' });
    hpHeading.textContent = label('hot_plug_skills');
    root.appendChild(hpHeading);

    const hpWrap = document.createElement('div');
    sty(hpWrap, { border: `1px solid ${UI.line}`, borderRadius: '10px', overflow: 'hidden' });
    const hpTable = document.createElement('table');
    sty(hpTable, { width: '100%', borderCollapse: 'collapse', fontSize: '13px' });
    hpTable.innerHTML = `<thead><tr style="background:rgba(0,0,0,0.03)"><th style="padding:8px 12px;text-align:left">${label('col_id')}</th><th style="padding:8px 12px;text-align:left">${label('col_desc')}</th><th style="padding:8px 12px;text-align:left">${label('col_handler')}</th></tr></thead>`;
    const hpBody = document.createElement('tbody');
    if (editableHotPlugSkills.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        sty(td, { padding: '12px', color: UI.muted });
        td.textContent = label('hot_plug_empty');
        tr.appendChild(td);
        hpBody.appendChild(tr);
    } else {
        editableHotPlugSkills.forEach((row, idx) => {
            const tr = document.createElement('tr');
            if (idx > 0) tr.style.borderTop = `1px solid ${UI.line}`;
            tr.innerHTML = `<td style="padding:8px 12px;font-family:monospace">${row.id}</td><td style="padding:8px 12px">${row.description || row.label || ''}</td><td style="padding:8px 12px">${row.handler || 'instruction'}</td>`;
            hpBody.appendChild(tr);
        });
    }
    hpTable.appendChild(hpBody);
    hpWrap.appendChild(hpTable);
    root.appendChild(hpWrap);

    const hpForm = document.createElement('div');
    sty(hpForm, { display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr', marginTop: '8px' });
    const hpFields = [
        ['field_skill_id', 'id', 'summarize_text'],
        ['field_skill_desc', 'description', 'Summarize user text in bullets'],
        ['field_handler', 'handler', 'instruction'],
        ['field_instruction', 'instruction', 'Summarize: {{text}}'],
        ['field_handler_url', 'handler_url', ''],
        ['field_parameters', 'parameters_json', '{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}'],
    ];
    /** @type {Record<string, HTMLInputElement>} */
    const hpInputs = {};
    hpFields.forEach(([lbl, key, placeholder]) => {
        const wrap = document.createElement('label');
        sty(wrap, { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' });
        wrap.textContent = label(lbl);
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = placeholder;
        sty(inp, { padding: '8px', borderRadius: '6px', border: `1px solid ${UI.line}` });
        hpInputs[key] = inp;
        wrap.appendChild(inp);
        hpForm.appendChild(wrap);
    });
    root.appendChild(hpForm);

    const hpActions = document.createElement('div');
    sty(hpActions, { display: 'flex', gap: '8px', flexWrap: 'wrap' });
    const addSkillBtn = document.createElement('button');
    addSkillBtn.type = 'button';
    addSkillBtn.textContent = label('add_skill');
    sty(addSkillBtn, { fontSize: '13px', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${UI.line}`, background: UI.paper, cursor: 'pointer' });
    addSkillBtn.addEventListener('click', () => {
        const id = hpInputs.id.value.trim();
        if (!id) return;
        let parameters = {};
        const rawParams = hpInputs.parameters_json.value.trim();
        if (rawParams) {
            try { parameters = JSON.parse(rawParams); } catch { parameters = { type: 'object', properties: {} }; }
        }
        editableHotPlugSkills.push({
            id,
            label: id,
            description: hpInputs.description.value.trim() || id,
            handler: hpInputs.handler.value.trim() || 'instruction',
            instruction: hpInputs.instruction.value.trim(),
            handler_url: hpInputs.handler_url.value.trim(),
            parameters_json: rawParams,
            parameters,
            allowed_purposes: 'chat,planning',
            enabled: 'true',
        });
        handlers.onSaveSkills(false);
    });
    const saveSkillsBtn = document.createElement('button');
    saveSkillsBtn.type = 'button';
    saveSkillsBtn.textContent = label('save_skills');
    sty(saveSkillsBtn, { fontSize: '13px', padding: '8px 12px', borderRadius: '8px', border: 'none', background: UI.ink, color: '#fff', cursor: 'pointer' });
    saveSkillsBtn.addEventListener('click', () => handlers.onSaveSkills(true));
    hpActions.append(addSkillBtn, saveSkillsBtn);
    root.appendChild(hpActions);

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
        if (editableServers.length === 0) {
            editableServers = (Array.isArray(payload.tool_servers) ? payload.tool_servers : []).map((row) => ({
                id: String(row.id ?? ''),
                base_url: String(row.base_url ?? ''),
                openapi_url: String(row.openapi_url ?? '/openapi.json'),
                allowed_purposes: Array.isArray(row.allowed_purposes) ? row.allowed_purposes.join(',') : 'chat',
                label: String(row.label ?? row.id ?? ''),
            }));
        }
        if (editableHotPlugSkills.length === 0) {
            editableHotPlugSkills = (Array.isArray(payload.hot_plug_skills) ? payload.hot_plug_skills : []).map((row) => ({
                id: String(row.id ?? row.skill_id ?? ''),
                label: String(row.label ?? row.id ?? ''),
                description: String(row.description ?? ''),
                handler: String(row.handler ?? 'instruction'),
                instruction: String(row.instruction ?? ''),
                handler_url: String(row.handler_url ?? ''),
                parameters_json: row.parameters ? JSON.stringify(row.parameters) : '',
                parameters: row.parameters && typeof row.parameters === 'object' ? row.parameters : {},
                allowed_purposes: Array.isArray(row.allowed_purposes) ? row.allowed_purposes.join(',') : 'chat,planning',
                enabled: String(row.enabled !== false),
            }));
        }
        const body = document.createElement('div');
        body.dataset.oaaoSkillsBody = '1';
        body.appendChild(
            renderPanel(payload, {
                onSave: (persist) => void persistServers(statusEl, wrap, ctx, persist),
                onSaveSkills: (persist) => void persistHotPlugSkills(statusEl, wrap, ctx, persist),
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

    async function persistHotPlugSkills(statusEl, wrap, ctx, persist) {
        if (persist) {
            const skills = editableHotPlugSkills.map((row) => {
                let parameters = row.parameters;
                if (typeof row.parameters_json === 'string' && row.parameters_json.trim()) {
                    try { parameters = JSON.parse(row.parameters_json); } catch { /* keep */ }
                }
                return {
                    id: row.id,
                    label: row.label || row.id,
                    description: row.description || row.label || row.id,
                    handler: row.handler || 'instruction',
                    instruction: row.instruction || '',
                    handler_url: row.handler_url || '',
                    parameters,
                    allowed_purposes: String(row.allowed_purposes || 'chat,planning')
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    enabled: row.enabled !== 'false',
                };
            });
            const { res, data } = await fetchJson(chatApiUrl('skills_manifest_save'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skills }),
            });
            statusEl.style.color = res.ok && data.success === true ? UI.ink : UI.caution;
            statusEl.textContent = res.ok && data.success === true ? label('save_skills_ok') : label('save_fail');
        }
        editableHotPlugSkills = [];
        await reload();
    }

    await reload();
    host.textContent = '';
    host.appendChild(wrap);
    ctx.JIT?.hydrate?.(host);
}

export function teardownSettingsPanel() {}
