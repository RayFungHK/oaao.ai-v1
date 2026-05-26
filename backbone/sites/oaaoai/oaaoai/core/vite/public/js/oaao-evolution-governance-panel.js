/**
 * Evolution governance UI — cron triggers, daily reports, crystallization stats, IQS distribution, patches.
 * Mounted from {@see oaao-evolution-queue-settings-panel.js} (Governance tab).
 */

/** @type {Record<'en' | 'zh-Hant', Record<string, string>>} */
const LABELS = {
    en: {
        evolution_section: 'Evolution & crystallization',
        crystal_stats: 'Crystallized skills (in-memory)',
        crystal_count: 'Skills loaded',
        crystal_usage: 'Total recall usage',
        iqs_actions: 'IQS action distribution (recent runs)',
        iqs_actions_empty: 'No IQS action data yet.',
        evolution_patches: 'Evolution patches',
        patches_empty: 'No patches recorded.',
        patch_approve: 'Approve',
        patch_rollback: 'Rollback',
        cron_daily: 'Run daily report now',
        cron_weekly: 'Run weekly auto-apply now',
        daily_reports: 'Recent daily reports',
        daily_reports_empty: 'No reports yet — run daily report or wait for cron.',
        report_samples: 'Samples',
        report_status: 'Status',
        systemd_hint: 'Schedule on the host with systemd timers — see scripts/systemd/README.md',
    },
    'zh-Hant': {
        evolution_section: 'Evolution & crystallization',
        crystal_stats: '結晶化 skills（記憶體）',
        crystal_count: '已載入 skills',
        crystal_usage: 'Recall 使用次數',
        iqs_actions: 'IQS action 分布（近期 runs）',
        iqs_actions_empty: '尚無 IQS action 資料。',
        evolution_patches: 'Evolution patches',
        patches_empty: '尚無 patch 記錄。',
        patch_approve: '核准',
        patch_rollback: 'Rollback',
        cron_daily: '立即執行 daily report',
        cron_weekly: '立即執行 weekly auto-apply',
        daily_reports: 'Recent daily reports',
        daily_reports_empty: '尚無 report — 請執行 daily report 或等待 cron。',
        report_samples: '樣本數',
        report_status: '狀態',
        systemd_hint: '在 host 上用 systemd timer 排程 — 見 scripts/systemd/README.md',
    },
};

const UI = { line: 'rgba(0,0,0,0.1)', ink: '#111', muted: '#666', caption: '#888', paper: '#fafafa' };

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

/** @returns {string} */
export function evolutionGovernanceChatApiUrl(name) {
    const mount = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    const pref = mount && mount !== '/' ? (mount.startsWith('/') ? mount : `/${mount}`).replace(/\/+$/, '') : '';
    return `${pref}/chat/api/${name}`;
}

/** @param {string} url @param {RequestInit} [init] */
export async function evolutionGovernanceFetchJson(url, init) {
    const res = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json', ...(init?.headers || {}) },
        ...init,
    });
    const raw = await res.text();
    /** @type {Record<string, unknown>} */
    let data = {};
    try {
        data = JSON.parse(raw);
    } catch {
        data = {};
    }
    return { res, data };
}

/** @returns {Promise<Record<string, unknown>>} */
export async function fetchEvolutionGovernancePayload() {
    const { res, data } = await evolutionGovernanceFetchJson(evolutionGovernanceChatApiUrl('skills_admin'));
    if (!res.ok || data.success !== true) {
        throw new Error('skills_admin_failed');
    }
    const payload = data.data && typeof data.data === 'object' ? /** @type {Record<string, unknown>} */ (data.data) : {};
    try {
        const repRes = await evolutionGovernanceFetchJson(evolutionGovernanceChatApiUrl('evolution_reports'));
        if (repRes.res.ok && repRes.data.success === true && repRes.data.data && typeof repRes.data.data === 'object') {
            payload.evolution_reports = Array.isArray(repRes.data.data.reports) ? repRes.data.data.reports : [];
        } else {
            payload.evolution_reports = [];
        }
    } catch {
        payload.evolution_reports = [];
    }
    try {
        const patchRes = await evolutionGovernanceFetchJson(evolutionGovernanceChatApiUrl('evolution_patches'));
        if (patchRes.res.ok && patchRes.data.success === true && patchRes.data.data && typeof patchRes.data.data === 'object') {
            payload.evolution_patches = Array.isArray(patchRes.data.data.patches) ? patchRes.data.data.patches : [];
        } else {
            payload.evolution_patches = [];
        }
    } catch {
        payload.evolution_patches = [];
    }
    if (payload.crystallization_stats === undefined) payload.crystallization_stats = {};
    if (payload.iqs_action_distribution === undefined) payload.iqs_action_distribution = {};
    return payload;
}

/**
 * @param {Record<string, unknown>} data
 * @param {{ onCron: (job: string) => void, onPatch: (patchId: string, action: string) => void }} handlers
 */
export function renderEvolutionGovernanceSection(data, handlers) {
    const evoSection = document.createElement('section');
    sty(evoSection, {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '14px 16px',
        borderRadius: '12px',
        border: `1px solid ${UI.line}`,
        background: 'rgba(0,0,0,0.02)',
    });
    const evoTitle = document.createElement('h2');
    sty(evoTitle, { fontSize: '14px', fontWeight: '600', margin: '0', color: UI.ink });
    evoTitle.textContent = label('evolution_section');
    evoSection.appendChild(evoTitle);

    const cronRow = document.createElement('div');
    sty(cronRow, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
    for (const [job, text] of [
        ['daily', 'cron_daily'],
        ['weekly', 'cron_weekly'],
    ]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label(text);
        sty(btn, {
            fontSize: '13px',
            padding: '8px 12px',
            borderRadius: '8px',
            border: `1px solid ${UI.line}`,
            background: '#fff',
            cursor: 'pointer',
        });
        btn.addEventListener('click', () => handlers.onCron(job));
        cronRow.appendChild(btn);
    }
    evoSection.appendChild(cronRow);

    const hint = document.createElement('p');
    sty(hint, { fontSize: '12px', color: UI.muted, margin: '0' });
    hint.textContent = label('systemd_hint');
    evoSection.appendChild(hint);

    const reportsHeading = document.createElement('h3');
    sty(reportsHeading, {
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: UI.caption,
        margin: '8px 0 0',
    });
    reportsHeading.textContent = label('daily_reports');
    evoSection.appendChild(reportsHeading);

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
                sub.textContent = JSON.stringify(
                    { top_iqs_killers: killers, top_accs_agent_kinds: rep.top_accs_agent_kinds ?? [] },
                    null,
                    2,
                );
                card.appendChild(sub);
            }
            reportsList.appendChild(card);
        });
    }
    evoSection.appendChild(reportsList);

    const crystal = data.crystallization_stats && typeof data.crystallization_stats === 'object' ? data.crystallization_stats : {};
    const crystalHeading = document.createElement('h3');
    sty(crystalHeading, {
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: UI.caption,
        margin: '8px 0 0',
    });
    crystalHeading.textContent = label('crystal_stats');
    evoSection.appendChild(crystalHeading);
    const crystalP = document.createElement('p');
    sty(crystalP, { fontSize: '13px', margin: '0' });
    crystalP.textContent = `${label('crystal_count')}: ${crystal.skill_count ?? 0} · ${label('crystal_usage')}: ${crystal.total_usage ?? 0}`;
    evoSection.appendChild(crystalP);

    const iqsHeading = document.createElement('h3');
    sty(iqsHeading, {
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: UI.caption,
        margin: '8px 0 0',
    });
    iqsHeading.textContent = label('iqs_actions');
    evoSection.appendChild(iqsHeading);
    const iqsDist = data.iqs_action_distribution && typeof data.iqs_action_distribution === 'object' ? data.iqs_action_distribution : {};
    const iqsP = document.createElement('p');
    sty(iqsP, { fontSize: '13px', margin: '0', fontFamily: 'monospace' });
    const iqsKeys = Object.keys(iqsDist);
    iqsP.textContent = iqsKeys.length ? iqsKeys.map((k) => `${k}: ${iqsDist[k]}`).join(' · ') : label('iqs_actions_empty');
    evoSection.appendChild(iqsP);

    const patchHeading = document.createElement('h3');
    sty(patchHeading, {
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: UI.caption,
        margin: '8px 0 0',
    });
    patchHeading.textContent = label('evolution_patches');
    evoSection.appendChild(patchHeading);
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
            for (const [act, text] of [
                ['approve', 'patch_approve'],
                ['rollback', 'patch_rollback'],
            ]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = label(text);
                sty(btn, {
                    fontSize: '12px',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: `1px solid ${UI.line}`,
                    background: '#fff',
                    cursor: 'pointer',
                });
                btn.addEventListener('click', () => handlers.onPatch(pid, act));
                actions.appendChild(btn);
            }
            card.appendChild(actions);
            patchList.appendChild(card);
        });
    }
    evoSection.appendChild(patchList);

    return evoSection;
}
