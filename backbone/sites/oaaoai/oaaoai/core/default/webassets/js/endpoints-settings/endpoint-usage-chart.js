/**
 * Compact avg-tokens chart for admin endpoint cards.
 */

import { oaaoT } from '../oaao-i18n.js';

/**
 * @param {number} n
 */
function formatTok(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '0';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 10_000) return `${Math.round(v / 1000)}k`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;

    return String(Math.round(v));
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * @param {unknown} stats
 * @returns {string}
 */
export function endpointUsagePanelHtml(stats) {
    if (!stats || typeof stats !== 'object') {
        return `<p class="text-[0.75rem] fg-[var(--grid-caption)] m-0">${escapeHtml(oaaoT('settings.endpoints.usage_no_data'))}</p>`;
    }

    const row = /** @type {Record<string, unknown>} */ (stats);
    const calls = Number(row.calls_30d ?? 0);
    const avg = Number(row.avg_tokens_30d ?? 0);
    const overloaded = row.overloaded === true;
    const limit = row.max_tokens_limit != null ? Number(row.max_tokens_limit) : null;
    const daily = Array.isArray(row.daily) ? row.daily : [];

    const avgLabel = oaaoT('settings.endpoints.usage_avg_30d', 'Avg tokens / call (30d)');
    const callsLabel = oaaoT('settings.endpoints.usage_calls_30d', 'Calls (30d)');
    const chartLabel = oaaoT('settings.endpoints.usage_chart_label', 'Daily avg tokens (14d)');
    const warn = oaaoT(
        'settings.endpoints.usage_overloaded',
        'High average token load — consider raising max_tokens or routing to a larger model.',
    );

    const warnBadge = overloaded
        ? `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.625rem] fw-semibold uppercase tracking-wide bg-[color-mix(in_srgb,var(--grid-caution,#b45309)_14%,transparent)] fg-[var(--grid-caution,#b45309)] border border-[color-mix(in_srgb,var(--grid-caution,#b45309)_35%,transparent)]">${escapeHtml(oaaoT('settings.endpoints.usage_overloaded_badge', 'High load'))}</span>`
        : '';

    const limitHint =
        limit != null && Number.isFinite(limit) && limit > 0
            ? `<span class="text-[0.6875rem] fg-[var(--grid-caption)]">${escapeHtml(oaaoT('settings.endpoints.usage_limit', 'Limit'))}: ${formatTok(limit)}</span>`
            : '';

    return `<div class="oaao-ep-usage mt-2 border-t border-[var(--grid-line)] pt-2">
  <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
    <span class="text-[0.6875rem] fw-semibold uppercase tracking-wide fg-[var(--grid-caption)]">${escapeHtml(chartLabel)}</span>
    ${warnBadge}
  </div>
  ${endpointUsageSparklineSvg(daily, limit)}
  <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.75rem] fg-[var(--grid-ink-muted)]">
    <div><dt class="inline opacity-70">${escapeHtml(avgLabel)}:</dt> <dd class="inline font-mono tabular-nums fg-[var(--grid-ink)]">${escapeHtml(formatTok(avg))}</dd></div>
    <div><dt class="inline opacity-70">${escapeHtml(callsLabel)}:</dt> <dd class="inline font-mono tabular-nums fg-[var(--grid-ink)]">${escapeHtml(String(Math.max(0, Math.floor(calls))))}</dd></div>
  </dl>
  ${limitHint ? `<div class="mt-1">${limitHint}</div>` : ''}
  ${overloaded ? `<p class="mt-1.5 mb-0 text-[0.6875rem] leading-snug fg-[var(--grid-caution,#b45309)]">${escapeHtml(warn)}</p>` : ''}
</div>`;
}

/**
 * @param {unknown[]} dailyRows
 * @param {number | null} maxTokensLimit
 */
function endpointUsageSparklineSvg(dailyRows, maxTokensLimit) {
    const rows = dailyRows
        .map((raw) => (raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : null))
        .filter(Boolean);
    const w = 280;
    const h = 56;
    const padX = 4;
    const padY = 6;
    const innerW = w - padX * 2;
    const innerH = h - padY * 2;

    let maxY = 0;
    for (const r of rows) {
        const v = Number(r?.avg_tokens ?? 0);
        if (v > maxY) maxY = v;
    }
    if (maxTokensLimit != null && Number.isFinite(maxTokensLimit) && maxTokensLimit > maxY) {
        maxY = maxTokensLimit;
    }
    if (maxY <= 0) maxY = 1;

    const n = Math.max(rows.length, 1);
    const barGap = 2;
    const barW = Math.max(2, (innerW - barGap * (n - 1)) / n);

    /** @type {string[]} */
    const bars = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const avg = Number(r?.avg_tokens ?? 0);
        const barH = avg > 0 ? Math.max(2, (avg / maxY) * innerH) : 0;
        const x = padX + i * (barW + barGap);
        const y = padY + innerH - barH;
        const overloadedBar =
            maxTokensLimit != null && Number.isFinite(maxTokensLimit) && maxTokensLimit > 0 && avg >= maxTokensLimit * 0.85;
        const fill = overloadedBar ? 'var(--grid-caution,#b45309)' : 'var(--grid-accent,#2563eb)';
        bars.push(
            `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="1.5" fill="${fill}" opacity="${avg > 0 ? '0.82' : '0.15'}"><title>${escapeHtml(String(r?.date ?? ''))}: ${formatTok(avg)} avg</title></rect>`,
        );
    }

    let warnLine = '';
    if (maxTokensLimit != null && Number.isFinite(maxTokensLimit) && maxTokensLimit > 0) {
        const yWarn = padY + innerH - (maxTokensLimit / maxY) * innerH;
        if (yWarn >= padY && yWarn <= padY + innerH) {
            warnLine = `<line x1="${padX}" y1="${yWarn.toFixed(1)}" x2="${w - padX}" y2="${yWarn.toFixed(1)}" stroke="var(--grid-caution,#b45309)" stroke-width="1" stroke-dasharray="3 3" opacity="0.65"/>`;
        }
    }

    return `<svg class="oaao-ep-usage-chart w-full max-w-full h-[56px]" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">${warnLine}${bars.join('')}</svg>`;
}
