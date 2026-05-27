/**
 * Shared usage overview UI — heatmap + credits + consumption lists (Preferences Dashboard parity).
 */

import { oaaoT } from '@oaao/core-js/oaao-i18n.js';
import { mountDailyTokenHeatmap } from './dashboard-usage-heatmap.js';
import {
    settingsCard,
    settingsCardRow,
    wrapSettingsSection,
} from './settings-section-cards.js';
import { oaaoMountLoadingLogo } from './oaao-loading-logo.js';

/** @param {number} n @param {number} [frac] */
export function formatUsageNum(n, frac = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return frac > 0 ? v.toFixed(frac) : String(Math.round(v));
}

/**
 * @param {Record<string, unknown>} data
 * @param {{ maxWidthClass?: string }} [options]
 * @returns {HTMLElement}
 */
export function buildUserUsageOverviewPage(data, options = {}) {
    const maxWidthClass = options.maxWidthClass ?? 'max-w-[42rem]';
    const unlimited = Boolean(data.credits_unlimited);
    const balance = data.credit_balance;
    const tokens30 = Number(data.tokens_30d ?? 0);
    const creditsUsed = Number(data.credits_used_30d ?? 0);

    const page = document.createElement('div');
    page.className = `flex flex-col gap-6 min-w-0 w-full ${maxWidthClass}`;

    const dailyRows = Array.isArray(data.daily_tokens) ? data.daily_tokens : [];
    const heatCard = settingsCard();
    heatCard.append(mountDailyTokenHeatmap({ dailyRows, tokens365d: Number(data.tokens_365d ?? 0) }));
    page.append(wrapSettingsSection(oaaoT('preferences.dashboard.section_usage', 'Usage'), heatCard));

    const summaryCard = settingsCard();
    const summaryBody = document.createElement('div');
    summaryBody.className = 'flex flex-col min-w-0';
    summaryBody.append(
        settingsCardRow({ label: oaaoT('preferences.dashboard.tokens_30d'), valueText: formatUsageNum(tokens30) }, false),
        settingsCardRow(
            {
                label: oaaoT('preferences.dashboard.credits_balance'),
                valueText: unlimited ? oaaoT('preferences.dashboard.unlimited') : formatUsageNum(balance ?? 0, 2),
            },
            true,
        ),
        settingsCardRow(
            {
                label: oaaoT('preferences.dashboard.credits_used_30d'),
                valueText: formatUsageNum(creditsUsed, 2),
            },
            true,
        ),
        settingsCardRow(
            {
                label: oaaoT('preferences.dashboard.credits_policy', 'Credit policy'),
                description: oaaoT('preferences.dashboard.hint'),
            },
            true,
        ),
    );
    summaryCard.append(summaryBody);
    page.append(wrapSettingsSection(oaaoT('preferences.dashboard.section_credits', 'Credits'), summaryCard));

    const usage = Array.isArray(data.usage_by_kind) ? data.usage_by_kind : [];
    if (usage.length) {
        const usageCard = settingsCard();
        const usageBody = document.createElement('div');
        usageBody.className = 'flex flex-col min-w-0';
        for (let i = 0; i < usage.length; i++) {
            const row = usage[i];
            usageBody.append(
                settingsCardRow(
                    {
                        label: String(row.event_kind ?? ''),
                        valueText: `${formatUsageNum(row.qty ?? 0)} ${String(row.unit ?? '')}`.trim(),
                    },
                    i > 0,
                ),
            );
        }
        usageCard.append(usageBody);
        page.append(wrapSettingsSection(oaaoT('preferences.dashboard.usage_breakdown'), usageCard));
    }

    const ledger = Array.isArray(data.ledger_recent) ? data.ledger_recent : [];
    if (ledger.length) {
        const ledgerCard = settingsCard();
        const ledgerBody = document.createElement('div');
        ledgerBody.className = 'flex flex-col min-w-0';
        for (let i = 0; i < Math.min(ledger.length, 8); i++) {
            const row = ledger[i];
            const delta = Number(row.delta_credits ?? 0);
            ledgerBody.append(
                settingsCardRow(
                    {
                        label: String(row.reason ?? ''),
                        valueText: `${delta >= 0 ? '+' : ''}${formatUsageNum(delta, 3)}`,
                    },
                    i > 0,
                ),
            );
        }
        ledgerCard.append(ledgerBody);
        page.append(wrapSettingsSection(oaaoT('preferences.dashboard.recent_credits'), ledgerCard));
    }

    return page;
}

/**
 * @param {HTMLElement} host
 * @param {string} url
 * @param {{ loadingLabel?: string, loadFailedLabel?: string, maxWidthClass?: string }} [options]
 */
export async function mountUserUsageOverview(host, url, options = {}) {
    if (!(host instanceof HTMLElement)) return;

    host.replaceChildren();
    oaaoMountLoadingLogo(host, {
        fill: true,
        label: options.loadingLabel ?? oaaoT('preferences.dashboard.loading'),
    });

    try {
        const res = await fetch(url, { credentials: 'same-origin' });
        const json = await res.json();
        host.replaceChildren();

        if (!res.ok || !json?.success) {
            const err = document.createElement('p');
            err.className = 'text-sm fg-[var(--grid-caution,#b45309)] m-0';
            err.textContent = json?.message || options.loadFailedLabel || oaaoT('preferences.dashboard.load_failed');
            host.append(err);
            return;
        }

        host.append(buildUserUsageOverviewPage(json.data ?? {}, { maxWidthClass: options.maxWidthClass }));
    } catch {
        host.replaceChildren();
        const err = document.createElement('p');
        err.className = 'text-sm fg-[var(--grid-caution,#b45309)] m-0';
        err.textContent = options.loadFailedLabel ?? oaaoT('preferences.dashboard.load_failed');
        host.append(err);
    }
}
