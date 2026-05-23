/**
 * GitHub-style daily token usage heatmap for Preferences → Dashboard.
 */

import { oaaoT } from '@oaao/core-js/oaao-i18n.js';

/** GitHub contribution palette (0 → max). */
const HEAT_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];

/**
 * @param {Date} d
 */
function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${y}-${m}-${day}`;
}

/**
 * @param {string} iso YYYY-MM-DD
 */
function parseIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);

    return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * @param {Array<{ date?: string, tokens?: number, chat_tokens?: number }>} rows
 * @param {'all' | 'chat'} filter
 */
function tokenForFilter(row, filter) {
    if (filter === 'chat') {
        return Number(row.chat_tokens ?? 0);
    }

    return Number(row.tokens ?? 0);
}

/**
 * @param {Array<{ date?: string, tokens?: number, chat_tokens?: number }>} rows
 * @param {'all' | 'chat'} filter
 */
function buildDayMap(rows, filter) {
    /** @type {Map<string, number>} */
    const map = new Map();
    for (const row of rows) {
        const key = String(row.date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
        map.set(key, tokenForFilter(row, filter));
    }

    return map;
}

/**
 * @param {Map<string, number>} dayMap
 */
function maxDailyTokens(dayMap) {
    let max = 0;
    for (const v of dayMap.values()) {
        if (v > max) max = v;
    }

    return max;
}

/**
 * @param {number} tokens
 * @param {number} max
 */
function heatLevel(tokens, max) {
    if (tokens <= 0 || max <= 0) return 0;
    const ratio = tokens / max;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;

    return 4;
}

/**
 * @param {Map<string, number>} dayMap
 */
function computeHeatmapStats(dayMap) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    /** @type {Map<string, number>} */
    const monthTotals = new Map();
    let total = 0;
    let bestDay = '';
    let bestDayTokens = 0;

    /** @type {string[]} */
    const activeDays = [];
    for (const [date, tokens] of dayMap.entries()) {
        total += tokens;
        if (tokens > bestDayTokens) {
            bestDayTokens = tokens;
            bestDay = date;
        }
        if (tokens > 0) {
            activeDays.push(date);
            const monthKey = date.slice(0, 7);
            monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + tokens);
        }
    }
    activeDays.sort();

    let bestMonthKey = '';
    let bestMonthTotal = 0;
    for (const [mk, sum] of monthTotals.entries()) {
        if (sum > bestMonthTotal) {
            bestMonthTotal = sum;
            bestMonthKey = mk;
        }
    }

    let longest = 0;
    let run = 0;
    let prev = null;
    for (const d of activeDays) {
        if (prev) {
            const diff = (parseIso(d).getTime() - parseIso(prev).getTime()) / 86400000;
            run = diff === 1 ? run + 1 : 1;
        } else {
            run = 1;
        }
        if (run > longest) longest = run;
        prev = d;
    }

    let current = 0;
    let cursor = new Date(today);
    while (true) {
        const key = isoDate(cursor);
        if ((dayMap.get(key) ?? 0) <= 0) break;
        current += 1;
        cursor.setDate(cursor.getDate() - 1);
    }

    const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
    const dayFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

    return {
        total,
        mostActiveMonth: bestMonthKey ? monthFmt.format(parseIso(`${bestMonthKey}-01`)) : '—',
        mostActiveDay: bestDay && bestDayTokens > 0 ? dayFmt.format(parseIso(bestDay)) : '—',
        longestStreak: longest > 0 ? `${longest}d` : '0d',
        currentStreak: `${current}d`,
    };
}

/**
 * @param {Map<string, number>} dayMap
 * @param {number} max
 */
function buildWeekGrid(dayMap, max) {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 364);
    while (start.getDay() !== 0) {
        start.setDate(start.getDate() - 1);
    }

    /** @type {Array<Array<{ date: string, tokens: number, level: number, future: boolean }>>} */
    const weeks = [];
    const cursor = new Date(start);
    while (cursor <= end || cursor.getDay() !== 0) {
        /** @type {Array<{ date: string, tokens: number, level: number, future: boolean }>} */
        const week = [];
        for (let i = 0; i < 7; i += 1) {
            const future = cursor > end;
            const key = isoDate(cursor);
            const tokens = future ? 0 : (dayMap.get(key) ?? 0);
            week.push({
                date: key,
                tokens,
                level: future ? 0 : heatLevel(tokens, max),
                future,
            });
            cursor.setDate(cursor.getDate() + 1);
        }
        weeks.push(week);
        if (cursor > end && weeks.length > 53) break;
    }

    return weeks.slice(-53);
}

/**
 * @param {Array<Array<{ date: string }>>} weeks
 */
function monthLabelsForWeeks(weeks) {
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
    /** @type {string[]} */
    const labels = [];
    let lastMonth = -1;
    for (const week of weeks) {
        const mid = week[3] ?? week[0];
        const d = parseIso(mid.date);
        const m = d.getMonth();
        if (m !== lastMonth) {
            labels.push(fmt.format(d));
            lastMonth = m;
        } else {
            labels.push('');
        }
    }

    return labels;
}

/**
 * @param {{
 *   dailyRows: Array<{ date?: string, tokens?: number, chat_tokens?: number }>,
 *   tokens365d?: number,
 * }} opts
 */
export function mountDailyTokenHeatmap(opts) {
    const shell = document.createElement('div');
    shell.className = 'flex flex-col gap-3 min-w-0 p-4';

    const header = document.createElement('div');
    header.className = 'flex flex-wrap items-start justify-between gap-3 min-w-0';

    const titleBlock = document.createElement('div');
    titleBlock.className = 'flex flex-col gap-0.5 min-w-0';
    const title = document.createElement('div');
    title.className = 'text-[0.9375rem] fw-semibold fg-[var(--grid-ink)]';
    title.textContent = oaaoT('preferences.dashboard.daily_tokens_title', 'Daily usage (tokens)');
    const totalEl = document.createElement('div');
    totalEl.className = 'text-[1.75rem] fw-semibold fg-[var(--grid-ink)] tabular-nums leading-tight';
    titleBlock.append(title, totalEl);

    const filters = document.createElement('div');
    filters.className =
        'inline-flex items-center rounded-[8px] border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] p-0.5 gap-0.5 shrink-0';
    /** @type {'all' | 'chat'} */
    let activeFilter = 'all';

    const heatHost = document.createElement('div');
    heatHost.className = 'min-w-0 overflow-x-auto pb-1';

    const statsRow = document.createElement('div');
    statsRow.className =
        'grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-md pt-2 border-t border-[var(--grid-line)] text-[0.75rem]';

    const legend = document.createElement('div');
    legend.className = 'flex items-center gap-1.5 text-[0.6875rem] fg-[var(--grid-caption)] pt-1';

    shell.append(header, heatHost, statsRow, legend);
    header.append(titleBlock, filters);

    /** @param {'all' | 'chat'} filter */
    function renderFilter(filter) {
        activeFilter = filter;
        const dayMap = buildDayMap(opts.dailyRows, filter);
        const max = maxDailyTokens(dayMap);
        const stats = computeHeatmapStats(dayMap);
        const weeks = buildWeekGrid(dayMap, max);
        const monthLabels = monthLabelsForWeeks(weeks);

        totalEl.textContent = formatCompact(stats.total || Number(opts.tokens365d ?? 0));

        for (const btn of filters.querySelectorAll('button')) {
            const f = btn.getAttribute('data-filter');
            btn.className =
                f === filter
                    ? 'rounded-[6px] px-2.5 py-1 text-[0.75rem] fw-medium bg-[var(--grid-line)]/50 fg-[var(--grid-ink)] border-0 cursor-pointer font-inherit'
                    : 'rounded-[6px] px-2.5 py-1 text-[0.75rem] fw-medium bg-transparent fg-[var(--grid-caption)] border-0 cursor-pointer font-inherit hover:fg-[var(--grid-ink)]';
        }

        heatHost.textContent = '';
        const wrap = document.createElement('div');
        wrap.className = 'inline-flex flex-col gap-1 min-w-0';

        const monthRow = document.createElement('div');
        monthRow.className = 'flex gap-[3px] pl-[14px] text-[0.625rem] fg-[var(--grid-caption)] uppercase tracking-wide';
        for (const lbl of monthLabels) {
            const cell = document.createElement('span');
            cell.className = 'w-[11px] shrink-0 overflow-visible whitespace-nowrap';
            cell.textContent = lbl;
            monthRow.append(cell);
        }
        wrap.append(monthRow);

        const gridRow = document.createElement('div');
        gridRow.className = 'flex gap-[3px]';
        const dayLabels = document.createElement('div');
        dayLabels.className =
            'flex flex-col gap-[3px] text-[0.5625rem] fg-[var(--grid-caption)] pr-1 pt-[2px] select-none';
        for (const lbl of ['', 'M', '', 'W', '', 'F', '']) {
            const s = document.createElement('span');
            s.className = 'h-[11px] leading-[11px]';
            s.textContent = lbl;
            dayLabels.append(s);
        }
        gridRow.append(dayLabels);

        const weeksEl = document.createElement('div');
        weeksEl.className = 'flex gap-[3px]';
        for (const week of weeks) {
            const col = document.createElement('div');
            col.className = 'flex flex-col gap-[3px]';
            for (const cell of week) {
                const sq = document.createElement('span');
                sq.className = 'block w-[11px] h-[11px] rounded-[2px] shrink-0';
                sq.style.backgroundColor = HEAT_COLORS[cell.level] ?? HEAT_COLORS[0];
                if (!cell.future && cell.tokens > 0) {
                    sq.title = `${cell.date}: ${formatCompact(cell.tokens)} tokens`;
                } else {
                    sq.title = cell.date;
                }
                col.append(sq);
            }
            weeksEl.append(col);
        }
        gridRow.append(weeksEl);
        wrap.append(gridRow);
        heatHost.append(wrap);

        statsRow.textContent = '';
        statsRow.append(
            statCell(oaaoT('preferences.dashboard.most_active_month', 'Most active month'), stats.mostActiveMonth),
            statCell(oaaoT('preferences.dashboard.most_active_day', 'Most active day'), stats.mostActiveDay),
            statCell(oaaoT('preferences.dashboard.longest_streak', 'Longest streak'), stats.longestStreak),
            statCell(oaaoT('preferences.dashboard.current_streak', 'Current streak'), stats.currentStreak),
        );

        legend.textContent = '';
        legend.append(document.createTextNode(oaaoT('preferences.dashboard.fewer', 'Fewer')));
        for (const c of HEAT_COLORS) {
            const sq = document.createElement('span');
            sq.className = 'inline-block w-[11px] h-[11px] rounded-[2px]';
            sq.style.backgroundColor = c;
            legend.append(sq);
        }
        legend.append(document.createTextNode(oaaoT('preferences.dashboard.more', 'More')));
    }

    for (const spec of [
        { id: 'all', label: oaaoT('preferences.dashboard.filter_all', 'All') },
        { id: 'chat', label: oaaoT('preferences.dashboard.filter_chat', 'Chat') },
    ]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.filter = spec.id;
        btn.textContent = spec.label;
        btn.addEventListener('click', () => renderFilter(/** @type {'all' | 'chat'} */ (spec.id)));
        filters.append(btn);
    }

    renderFilter('all');

    return shell;
}

/** @param {string} label @param {string} value */
function statCell(label, value) {
    const el = document.createElement('div');
    el.className = 'flex flex-col gap-0.5 min-w-0';
    const l = document.createElement('span');
    l.className = 'fg-[var(--grid-caption)]';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'fw-medium fg-[var(--grid-ink)] truncate';
    v.textContent = value;
    el.append(l, v);

    return el;
}

/** @param {number} n */
function formatCompact(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 10_000) return `${Math.round(v / 1000)}k`;
    if (v >= 1_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;

    return String(Math.round(v));
}
