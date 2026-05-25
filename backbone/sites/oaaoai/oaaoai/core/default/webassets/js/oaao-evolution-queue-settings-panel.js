/**
 * Admin Settings — Evolution background queues (IQS/ACCS rescore + post-stream pools).
 * Lives under core webassets ({@see SettingsRegister}) — static imports only (import-map cache bust).
 * Layout uses inline {@code element.style} — no dependency on oaao.css / JIT.
 */

import { oaaoMountLoadingLogo } from './oaao-loading-logo.js';

/** @type {Record<'en' | 'zh-Hant', Record<string, string>>} */
const LABELS = {
    en: {
        loading: 'Loading queue status…',
        load_failed: 'Could not load queue status.',
        intro:
            'Live snapshot of background evolution jobs. IQS/ACCS history rescoring runs after you open a chat thread with stale scores.',
        iqs_version: 'IQS scorer',
        accs_version: 'ACCS scorer',
        evo_mode: 'Post-stream mode',
        evo_on: 'Inline asyncio worker (default)',
        evo_off: 'Legacy queue pool only',
        evo_unknown: 'Orchestrator unreachable',
        orch_unreachable: 'Orchestrator is not reachable — counts below may be stale or empty.',
        rescore_heading: 'IQS / ACCS rescore (in progress)',
        rescore_empty: 'No conversations are being rescored.',
        pools_heading: 'Post-stream queue pools',
        pools_empty: 'No queue pools configured (OAAO_QUEUE_POOLS_JSON).',
        col_conversation: 'Conversation',
        col_turns: 'Turns',
        col_started: 'Started',
        col_pool: 'Pool',
        col_depth: 'Queued',
        col_workers: 'Workers',
        col_plugins: 'Plugins',
        updated: 'Updated {{time}} · refreshes every 3s',
        persisted_heading: 'Persisted turn scores (database)',
        persisted_total: 'Total scored turns',
        persisted_with_iqs: 'With IQS',
        persisted_with_accs: 'With ACCS',
        persisted_latest: 'Latest scored',
        persisted_latest_none: 'No turn scores persisted yet.',
        persisted_latest_fmt: 'Conversation #{{cid}} · turn {{turn}} · {{time}}',
    },
    'zh-Hant': {
        loading: '正在載入佇列狀態…',
        load_failed: '無法載入佇列狀態。',
        intro: '背景 evolution 工作的即時快照。當你開啟分數過舊的對話時，IQS/ACCS 歷史重算會在背景執行。',
        iqs_version: 'IQS 評分器',
        accs_version: 'ACCS 評分器',
        evo_mode: 'Post-stream 模式',
        evo_on: 'Inline asyncio worker（預設）',
        evo_off: '僅 legacy queue pool',
        evo_unknown: '無法連線 orchestrator',
        orch_unreachable: 'Orchestrator 無法連線 — 下方數字可能過期或為空。',
        rescore_heading: 'IQS / ACCS 重算（進行中）',
        rescore_empty: '目前沒有對話正在重算。',
        pools_heading: 'Post-stream 佇列池',
        pools_empty: '未設定佇列池（OAAO_QUEUE_POOLS_JSON）。',
        col_conversation: '對話',
        col_turns: 'Turn 數',
        col_started: '開始時間',
        col_pool: 'Pool',
        col_depth: '排隊中',
        col_workers: 'Workers',
        col_plugins: 'Plugins',
        updated: '更新於 {{time}} · 每 3 秒刷新',
        persisted_heading: '已持久化的 turn 分數（資料庫）',
        persisted_total: '已評分 turn 總數',
        persisted_with_iqs: '含 IQS',
        persisted_with_accs: '含 ACCS',
        persisted_latest: '最近評分',
        persisted_latest_none: '尚未持久化任何 turn 分數。',
        persisted_latest_fmt: '對話 #{{cid}} · turn {{turn}} · {{time}}',
    },
};

/** @returns {'en' | 'zh-Hant'} */
function panelLang() {
    const raw = (typeof document !== 'undefined' && document.documentElement.lang) || navigator.language || 'en';
    return String(raw).toLowerCase().startsWith('zh') ? 'zh-Hant' : 'en';
}

/**
 * @param {string} name
 * @param {Record<string, string | number>} [vars]
 */
function label(name, vars = {}) {
    const lang = panelLang();
    let out = LABELS[lang][name] ?? LABELS.en[name] ?? name;
    for (const [vk, vv] of Object.entries(vars)) {
        out = out.split(`{{${vk}}}`).join(String(vv));
    }
    return out;
}

/** @param {number} ts */
function formatQueueTime(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '—';
    try {
        return new Date(n * 1000).toLocaleTimeString();
    } catch {
        return '—';
    }
}

/** @param {HTMLElement} el @param {Partial<CSSStyleDeclaration>|Record<string, string>} styles */
function sty(el, styles) {
    Object.assign(el.style, styles);
}

const EVO = {
    line: 'rgba(0,0,0,0.1)',
    ink: '#111',
    muted: '#666',
    caption: '#888',
    paper: '#fafafa',
    caution: '#b45309',
};

/** @param {string} labelText @param {string} valueText @param {boolean} [withTopRule] */
function statusRowEl(labelText, valueText, withTopRule = false) {
    const row = document.createElement('div');
    sty(row, {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px 16px',
        minHeight: '44px',
        padding: '14px 20px',
        boxSizing: 'border-box',
        borderTop: withTopRule ? `1px solid ${EVO.line}` : '',
    });
    const lab = document.createElement('div');
    sty(lab, { fontSize: '13px', fontWeight: '500', color: EVO.ink, lineHeight: '1.4', minWidth: '0' });
    lab.textContent = labelText;
    const val = document.createElement('div');
    sty(val, {
        fontSize: '13px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        color: EVO.ink,
        flexShrink: '0',
        textAlign: 'right',
        lineHeight: '1.4',
    });
    val.textContent = valueText;
    row.append(lab, val);
    return row;
}

/** @param {string} iqsVer @param {string} accsVer @param {string} evoLabel */
function statusCardEl(iqsVer, accsVer, evoLabel) {
    const card = document.createElement('div');
    sty(card, {
        borderRadius: '10px',
        border: `1px solid ${EVO.line}`,
        background: EVO.paper,
        overflow: 'hidden',
        width: '100%',
        boxSizing: 'border-box',
    });
    card.append(
        statusRowEl(label('iqs_version'), iqsVer, false),
        statusRowEl(label('accs_version'), accsVer, true),
        statusRowEl(label('evo_mode'), evoLabel, true),
    );
    return card;
}

/**
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {string} emptyText
 */
function tableSectionEl(headers, rows, emptyText) {
    const wrap = document.createElement('div');
    sty(wrap, {
        overflowX: 'auto',
        borderRadius: '10px',
        border: `1px solid ${EVO.line}`,
        background: EVO.paper,
    });
    const table = document.createElement('table');
    sty(table, { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' });
    const thead = document.createElement('thead');
    const headTr = document.createElement('tr');
    sty(headTr, { borderBottom: `1px solid ${EVO.line}`, background: 'rgba(0,0,0,0.03)' });
    for (const h of headers) {
        const th = document.createElement('th');
        sty(th, {
            padding: '8px 12px',
            fontSize: '11px',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: EVO.caption,
        });
        th.textContent = h;
        headTr.appendChild(th);
    }
    thead.appendChild(headTr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = headers.length;
        sty(td, { padding: '12px', fontSize: '12px', color: EVO.muted });
        td.textContent = emptyText;
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        rows.forEach((cells, rowIdx) => {
            const tr = document.createElement('tr');
            if (rowIdx > 0) sty(tr, { borderTop: `1px solid ${EVO.line}` });
            cells.forEach((text, idx) => {
                const td = document.createElement('td');
                sty(td, { padding: '8px 12px', verticalAlign: 'top' });
                if (idx === 0) sty(td, { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '12px' });
                else if (headers.length === 3 && idx === 2) sty(td, { color: EVO.muted, fontSize: '12px' });
                else if (headers.length === 4 && (idx === 1 || idx === 2)) td.style.fontVariantNumeric = 'tabular-nums';
                td.textContent = text;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

/** @param {string} title @param {HTMLElement} body */
function sectionEl(title, body) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    sty(heading, {
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: EVO.caption,
        fontWeight: '600',
        margin: '0 0 8px',
    });
    heading.textContent = title;
    section.append(heading, body);
    return section;
}

/** @param {Record<string, unknown>} data */
function renderQueuePanelEl(data) {
    const root = document.createElement('div');
    sty(root, {
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        minWidth: '0',
        maxWidth: '42rem',
        width: '100%',
    });

    const versions =
        data.scorer_versions && typeof data.scorer_versions === 'object'
            ? /** @type {Record<string, string>} */ (data.scorer_versions)
            : {};
    const iqsVer = String(versions.iqs ?? '—');
    const accsVer = String(versions.accs ?? '—');
    const evoOn = data.evolution_post_stream_enabled;
    const evoLabel =
        evoOn === true ? label('evo_on') : evoOn === false ? label('evo_off') : label('evo_unknown');
    const orchOk = data.orchestrator_ok !== false;

    if (!orchOk) {
        const warn = document.createElement('p');
        sty(warn, { fontSize: '13px', color: EVO.caution, margin: '0 0 4px' });
        warn.textContent = label('orch_unreachable');
        root.appendChild(warn);
    }

    const intro = document.createElement('p');
    sty(intro, { fontSize: '13px', color: EVO.muted, lineHeight: '1.45', margin: '0' });
    intro.textContent = label('intro');
    root.appendChild(intro);

    root.appendChild(statusCardEl(iqsVer, accsVer, evoLabel));

    const persisted =
        data.persisted_turn_scores && typeof data.persisted_turn_scores === 'object'
            ? /** @type {Record<string, unknown>} */ (data.persisted_turn_scores)
            : {};
    const total = Number(persisted.turn_scores_total ?? 0);
    const withIqs = Number(persisted.turn_scores_with_iqs ?? 0);
    const withAccs = Number(persisted.turn_scores_with_accs ?? 0);
    const latestCid = Number(persisted.latest_conversation_id ?? 0);
    const latestTurn = Number(persisted.latest_turn_index ?? 0);
    const latestAt = Number(persisted.latest_scored_at ?? 0);
    const latestLabel =
        latestCid > 0 && latestAt > 0
            ? label('persisted_latest_fmt', {
                  cid: latestCid,
                  turn: latestTurn > 0 ? latestTurn : '—',
                  time: formatQueueTime(latestAt),
              })
            : label('persisted_latest_none');
    root.appendChild(
        sectionEl(
            label('persisted_heading'),
            tableSectionEl(
                [label('persisted_total'), label('persisted_with_iqs'), label('persisted_with_accs'), label('persisted_latest')],
                [[String(total), String(withIqs), String(withAccs), latestLabel]],
                label('persisted_latest_none'),
            ),
        ),
    );

    const rescore =
        data.turn_score_rescore && typeof data.turn_score_rescore === 'object'
            ? /** @type {Record<string, unknown>} */ (data.turn_score_rescore)
            : {};
    const active = Array.isArray(rescore.active) ? rescore.active : [];
    const rescoreRows = active
        .filter((row) => row && typeof row === 'object')
        .map((row) => [
            String(row.conversation_id ?? '—'),
            String(row.turn_count ?? '—'),
            formatQueueTime(Number(row.started_at)),
        ]);
    root.appendChild(
        sectionEl(
            `${label('rescore_heading')} (${active.length})`,
            tableSectionEl(
                [label('col_conversation'), label('col_turns'), label('col_started')],
                rescoreRows,
                label('rescore_empty'),
            ),
        ),
    );

    const pools = Array.isArray(data.post_stream_pools) ? data.post_stream_pools : [];
    const poolRows = pools
        .filter((row) => row && typeof row === 'object')
        .map((row) => [
            String(row.pool_id ?? '—'),
            String(row.queue_depth ?? '—'),
            String(row.worker_count ?? '—'),
            Array.isArray(row.plugins) ? row.plugins.join(', ') : '',
        ]);
    root.appendChild(
        sectionEl(
            label('pools_heading'),
            tableSectionEl(
                [label('col_pool'), label('col_depth'), label('col_workers'), label('col_plugins')],
                poolRows,
                label('pools_empty'),
            ),
        ),
    );

    const updated = document.createElement('p');
    updated.dataset.oaaoEvolutionQueue = 'updated';
    sty(updated, {
        fontSize: '11px',
        color: EVO.caption,
        margin: '0',
        paddingTop: '4px',
        borderTop: `1px solid ${EVO.line}`,
    });
    updated.textContent = label('updated', { time: formatQueueTime(Number(data.generated_at)) });
    root.appendChild(updated);

    return root;
}

/** @returns {string} */
function chatApiUrl(name) {
    const mount = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    const pref = mount && mount !== '/' ? (mount.startsWith('/') ? mount : `/${mount}`).replace(/\/+$/, '') : '';
    return `${pref}/chat/api/${name}`;
}

/** @param {string} url */
async function fetchQueueStatus(url) {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
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

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;

/**
 * @param {HTMLElement} host
 * @param {{ JIT?: { hydrate?: (el: HTMLElement) => void } }} [ctx]
 */
export async function mountSettingsPanel(host, ctx = {}) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: label('loading') });

    const wrap = document.createElement('div');
    wrap.className = 'min-w-0 w-full';
    wrap.dataset.oaaoEvolutionQueuePanel = '1';

    const refresh = async () => {
        const { res, data } = await fetchQueueStatus(chatApiUrl('evolution_queue_status'));
        wrap.replaceChildren();
        if (!res.ok || data.success !== true) {
            const err = document.createElement('p');
            sty(err, { fontSize: '13px', color: EVO.caution, margin: '0' });
            err.textContent = label('load_failed');
            wrap.appendChild(err);
            return;
        }
        wrap.appendChild(renderQueuePanelEl(/** @type {Record<string, unknown>} */ (data)));
        ctx.JIT?.hydrate?.(wrap);
    };

    await refresh();
    host.textContent = '';
    host.appendChild(wrap);
    ctx.JIT?.hydrate?.(host);

    if (pollTimer) {
        clearInterval(pollTimer);
    }
    pollTimer = setInterval(() => {
        if (!host.isConnected) {
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = null;
            return;
        }
        void refresh();
    }, 3000);
}

export function teardownSettingsPanel() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
