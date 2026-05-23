/**
 * Preferences panels — Dashboard (usage/credits) + Personal (profile, password, language).
 *
 * @module user-preferences-panels
 */

import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';
import { oaaoT } from '@oaao/core-js/oaao-i18n.js';
import { mountDailyTokenHeatmap } from './dashboard-usage-heatmap.js';
import {
    settingsActionButton,
    settingsCard,
    settingsCardFooter,
    settingsCardInput,
    settingsCardRow,
    settingsCardSelect,
    settingsCardStatus,
    settingsPageStack,
    wrapSettingsSection,
} from './settings-section-cards.js';

/** @param {boolean} [isError] */
function settingsCardStatusClass(isError = false) {
    return [
        'text-[0.75rem] m-0',
        '[padding:0.625rem_1.25rem]',
        'border-t-[1px] border-solid border-[var(--grid-line)]',
        isError ? 'fg-[var(--grid-caution,#b45309)]' : 'fg-[var(--grid-ink-muted)]',
    ].join(' ');
}

function userApiUrl(action) {
    const rawMount = (document.body?.dataset?.oaaoMountPrefix ?? '').trim();
    const prefix = rawMount && rawMount !== '/' ? (rawMount.startsWith('/') ? rawMount : `/${rawMount}`) : '';
    return `${prefix}/user/api/${String(action).replace(/^\/+/, '')}`;
}

/** @param {string} msg */
function errorLine(msg) {
    const p = document.createElement('p');
    p.className = 'text-sm fg-[var(--grid-caution,#b45309)] m-0';
    p.textContent = msg;
    return p;
}

/**
 * @param {HTMLElement} host
 * @param {{ section?: { section_id?: string } }} [ctx]
 */
export async function mountPreferencesPanel(host, ctx = {}) {
    if (!(host instanceof HTMLElement)) return;
    const sectionId = String(ctx.section?.section_id ?? '');
    if (sectionId === 'pref-dashboard') {
        return mountDashboardPanel(host);
    }
    if (sectionId === 'pref-personal') {
        return mountPersonalPanel(host);
    }
    host.append(errorLine(oaaoT('preferences.panel.unknown', 'Unknown preferences section.')));
}

/**
 * @param {HTMLElement} host
 */
async function mountDashboardPanel(host) {
    host.replaceChildren();
    oaaoMountLoadingLogo(host, { fill: true, label: oaaoT('preferences.dashboard.loading') });

    try {
        const res = await fetch(userApiUrl('dashboard'), { credentials: 'same-origin' });
        const json = await res.json();
        host.replaceChildren();

        if (!res.ok || !json?.success) {
            host.append(errorLine(json?.message || oaaoT('preferences.dashboard.load_failed')));
            return;
        }

        const d = json.data ?? {};
        const unlimited = Boolean(d.credits_unlimited);
        const balance = d.credit_balance;
        const tokens30 = Number(d.tokens_30d ?? 0);
        const creditsUsed = Number(d.credits_used_30d ?? 0);

        const page = settingsPageStack();

        const dailyRows = Array.isArray(d.daily_tokens) ? d.daily_tokens : [];
        const heatCard = settingsCard();
        heatCard.append(mountDailyTokenHeatmap({ dailyRows, tokens365d: Number(d.tokens_365d ?? 0) }));
        page.append(wrapSettingsSection(oaaoT('preferences.dashboard.section_usage', 'Usage'), heatCard));

        const summaryCard = settingsCard();
        const summaryBody = document.createElement('div');
        summaryBody.className = 'flex flex-col min-w-0';
        summaryBody.append(
            settingsCardRow({ label: oaaoT('preferences.dashboard.tokens_30d'), valueText: formatNum(tokens30) }, false),
            settingsCardRow(
                {
                    label: oaaoT('preferences.dashboard.credits_balance'),
                    valueText: unlimited ? oaaoT('preferences.dashboard.unlimited') : formatNum(balance ?? 0, 2),
                },
                true,
            ),
            settingsCardRow(
                {
                    label: oaaoT('preferences.dashboard.credits_used_30d'),
                    valueText: formatNum(creditsUsed, 2),
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

        const usage = Array.isArray(d.usage_by_kind) ? d.usage_by_kind : [];
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
                            valueText: `${formatNum(row.qty ?? 0)} ${String(row.unit ?? '')}`.trim(),
                        },
                        i > 0,
                    ),
                );
            }
            usageCard.append(usageBody);
            page.append(wrapSettingsSection(oaaoT('preferences.dashboard.usage_breakdown'), usageCard));
        }

        const ledger = Array.isArray(d.ledger_recent) ? d.ledger_recent : [];
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
                            valueText: `${delta >= 0 ? '+' : ''}${formatNum(delta, 3)}`,
                        },
                        i > 0,
                    ),
                );
            }
            ledgerCard.append(ledgerBody);
            page.append(wrapSettingsSection(oaaoT('preferences.dashboard.recent_credits'), ledgerCard));
        }

        host.append(page);
    } catch {
        host.replaceChildren();
        host.append(errorLine(oaaoT('preferences.dashboard.load_failed')));
    }
}

/**
 * @param {HTMLElement} host
 */
async function mountPersonalPanel(host) {
    host.replaceChildren();
    oaaoMountLoadingLogo(host, { fill: true, label: oaaoT('preferences.personal.loading') });

    try {
        const res = await fetch(userApiUrl('profile'), { credentials: 'same-origin' });
        const json = await res.json();
        host.replaceChildren();

        if (!res.ok || !json?.success) {
            host.append(errorLine(json?.message || oaaoT('preferences.personal.load_failed')));
            return;
        }

        const p = json.data ?? {};
        const page = settingsPageStack();

        const profileCard = settingsCard();
        const profileForm = document.createElement('form');
        profileForm.className = 'flex flex-col min-w-0';

        const displayInput = settingsCardInput({ name: 'display_name', value: p.display_name ?? '', required: true });
        const emailInput = settingsCardInput({ name: 'email', type: 'email', value: p.email ?? '' });

        profileForm.append(
            settingsCardRow({ label: oaaoT('preferences.personal.display_name'), control: displayInput }, false),
            settingsCardRow({ label: oaaoT('preferences.personal.email'), control: emailInput }, true),
            settingsCardRow(
                {
                    label: oaaoT('preferences.personal.login_name'),
                    valueText: String(p.login_name ?? ''),
                },
                true,
            ),
        );

        const profileSave = settingsActionButton(oaaoT('preferences.personal.save_profile'), 'primary');
        profileSave.type = 'submit';
        profileForm.append(settingsCardFooter(profileSave));
        const profileStatus = settingsCardStatus('', false);
        profileStatus.classList.add('hidden');
        profileForm.append(profileStatus);

        profileForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            profileStatus.classList.remove('hidden');
            profileStatus.className = settingsCardStatusClass(false);
            profileStatus.textContent = oaaoT('preferences.personal.saving');
            try {
                const r = await fetch(userApiUrl('profile_save'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        display_name: displayInput.value.trim(),
                        email: emailInput.value.trim(),
                    }),
                });
                const j = await r.json();
                profileStatus.className = settingsCardStatusClass(!(r.ok && j?.success));
                profileStatus.textContent =
                    r.ok && j?.success
                        ? oaaoT('preferences.personal.saved')
                        : j?.message || oaaoT('preferences.personal.save_failed');
                if (r.ok && j?.success) {
                    const label = document.getElementById('workspace-user-label');
                    if (label) label.textContent = displayInput.value.trim() || label.textContent;
                }
            } catch {
                profileStatus.className = settingsCardStatusClass(true);
                profileStatus.textContent = oaaoT('preferences.personal.save_failed');
            }
        });

        profileCard.append(profileForm);
        page.append(wrapSettingsSection(oaaoT('preferences.personal.profile_title'), profileCard));

        const passCard = settingsCard();
        const passForm = document.createElement('form');
        passForm.className = 'flex flex-col min-w-0';
        const currentPw = settingsCardInput({
            name: 'current_password',
            type: 'password',
            required: true,
            autocomplete: 'current-password',
        });
        const newPw = settingsCardInput({
            name: 'new_password',
            type: 'password',
            required: true,
            minLength: 8,
            autocomplete: 'new-password',
        });
        passForm.append(
            settingsCardRow({ label: oaaoT('preferences.personal.current_password'), control: currentPw }, false),
            settingsCardRow({ label: oaaoT('preferences.personal.new_password'), control: newPw }, true),
        );
        const passSave = settingsActionButton(oaaoT('preferences.personal.change_password'));
        passSave.type = 'submit';
        passForm.append(settingsCardFooter(passSave));
        const passStatus = settingsCardStatus('', false);
        passStatus.classList.add('hidden');
        passForm.append(passStatus);

        passForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            passStatus.classList.remove('hidden');
            passStatus.textContent = oaaoT('preferences.personal.saving');
            try {
                const r = await fetch(userApiUrl('password_change'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ current_password: currentPw.value, new_password: newPw.value }),
                });
                const j = await r.json();
                passStatus.className = settingsCardStatusClass(!(r.ok && j?.success));
                passStatus.textContent =
                    r.ok && j?.success
                        ? oaaoT('preferences.personal.password_changed')
                        : j?.message || oaaoT('preferences.personal.password_failed');
                if (r.ok && j?.success) passForm.reset();
            } catch {
                passStatus.className = settingsCardStatusClass(true);
                passStatus.textContent = oaaoT('preferences.personal.password_failed');
            }
        });
        passCard.append(passForm);
        page.append(wrapSettingsSection(oaaoT('preferences.personal.password_title'), passCard));

        const langCard = settingsCard();
        const langForm = document.createElement('form');
        langForm.className = 'flex flex-col min-w-0';
        const locale = String(p.locale ?? 'en');
        const localeSel = settingsCardSelect('locale');
        for (const opt of [
            { value: 'en', label: 'English' },
            { value: 'zh-Hant', label: '繁體中文' },
        ]) {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            if (locale === opt.value) o.selected = true;
            localeSel.append(o);
        }
        langForm.append(
            settingsCardRow(
                {
                    label: oaaoT('preferences.personal.language'),
                    description: oaaoT('preferences.personal.language_desc', 'Interface language for menus and labels.'),
                    control: localeSel,
                },
                false,
            ),
        );
        const langSave = settingsActionButton(oaaoT('preferences.personal.save_language'));
        langSave.type = 'submit';
        langForm.append(settingsCardFooter(langSave));
        const langStatus = settingsCardStatus('', false);
        langStatus.classList.add('hidden');
        langForm.append(langStatus);

        langForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            langStatus.classList.remove('hidden');
            langStatus.textContent = oaaoT('preferences.personal.saving');
            try {
                const r = await fetch(userApiUrl('preferences_save'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ locale: localeSel.value }),
                });
                const j = await r.json();
                langStatus.className = settingsCardStatusClass(!(r.ok && j?.success));
                langStatus.textContent =
                    r.ok && j?.success
                        ? oaaoT('preferences.personal.language_saved')
                        : j?.message || oaaoT('preferences.personal.save_failed');
                if (r.ok && j?.success) {
                    document.documentElement.lang = localeSel.value;
                }
            } catch {
                langStatus.className = settingsCardStatusClass(true);
                langStatus.textContent = oaaoT('preferences.personal.save_failed');
            }
        });
        langCard.append(langForm);
        page.append(wrapSettingsSection(oaaoT('preferences.personal.language_title'), langCard));

        host.append(page);
    } catch {
        host.replaceChildren();
        host.append(errorLine(oaaoT('preferences.personal.load_failed')));
    }
}

/** @param {number} n @param {number} [frac] */
function formatNum(n, frac = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return frac > 0 ? v.toFixed(frac) : String(Math.round(v));
}

export default mountPreferencesPanel;
