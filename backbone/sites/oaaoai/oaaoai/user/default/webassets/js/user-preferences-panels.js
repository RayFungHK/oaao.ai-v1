/**
 * Preferences panels — Dashboard (usage/credits) + Personal (profile, password, language).
 *
 * @module user-preferences-panels
 */

import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';
import { oaaoT } from '@oaao/core-js/oaao-i18n.js';

/** @param {unknown} v */
function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function userApiUrl(action) {
    const rawMount = (document.body?.dataset?.oaaoMountPrefix ?? '').trim();
    const prefix = rawMount && rawMount !== '/' ? (rawMount.startsWith('/') ? rawMount : `/${rawMount}`) : '';
    return `${prefix}/user/api/${String(action).replace(/^\/+/, '')}`;
}

/** @param {string} msg @param {string} [cls] */
function hint(msg, cls = 'text-sm fg-[var(--grid-ink-muted)] mb-md') {
    const p = document.createElement('p');
    p.className = cls;
    p.textContent = msg;
    return p;
}

/** @param {string} msg */
function errorLine(msg) {
    return hint(msg, 'text-sm fg-[var(--grid-caution,#b45309)] mb-md');
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
    host.append(hint(oaaoT('preferences.panel.unknown', 'Unknown preferences section.')));
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

        const grid = document.createElement('div');
        grid.className = 'grid gap-md max-w-[40rem]';

        const cards = document.createElement('div');
        cards.className = 'grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-sm';

        cards.append(statCard(oaaoT('preferences.dashboard.tokens_30d'), formatNum(tokens30)));
        cards.append(
            statCard(
                oaaoT('preferences.dashboard.credits_balance'),
                unlimited ? oaaoT('preferences.dashboard.unlimited') : formatNum(balance ?? 0, 2),
            ),
        );
        cards.append(statCard(oaaoT('preferences.dashboard.credits_used_30d'), formatNum(creditsUsed, 2)));

        grid.append(cards);
        grid.append(hint(oaaoT('preferences.dashboard.hint')));

        const usage = Array.isArray(d.usage_by_kind) ? d.usage_by_kind : [];
        if (usage.length) {
            const table = document.createElement('div');
            table.className = 'mt-lg';
            table.append(sectionTitle(oaaoT('preferences.dashboard.usage_breakdown')));
            const ul = document.createElement('ul');
            ul.className = 'list-none p-0 m-0 grid gap-xs text-sm';
            for (const row of usage) {
                const li = document.createElement('li');
                li.className = 'flex justify-between gap-md py-1 border-b border-[var(--grid-line)]';
                li.innerHTML = `<span class="font-mono text-xs">${esc(row.event_kind)}</span><span>${esc(formatNum(row.qty ?? 0))} ${esc(row.unit ?? '')}</span>`;
                ul.append(li);
            }
            table.append(ul);
            grid.append(table);
        }

        const ledger = Array.isArray(d.ledger_recent) ? d.ledger_recent : [];
        if (ledger.length) {
            const block = document.createElement('div');
            block.className = 'mt-lg';
            block.append(sectionTitle(oaaoT('preferences.dashboard.recent_credits')));
            const ul = document.createElement('ul');
            ul.className = 'list-none p-0 m-0 grid gap-xs text-sm';
            for (const row of ledger.slice(0, 8)) {
                const li = document.createElement('li');
                li.className = 'flex justify-between gap-md py-1 border-b border-[var(--grid-line)]';
                const delta = Number(row.delta_credits ?? 0);
                li.innerHTML = `<span>${esc(row.reason ?? '')}</span><span class="font-mono">${delta >= 0 ? '+' : ''}${esc(formatNum(delta, 3))}</span>`;
                ul.append(li);
            }
            block.append(ul);
            grid.append(block);
        }

        host.append(grid);
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
        host.append(sectionTitle(oaaoT('preferences.personal.profile_title')));
        host.append(hint(oaaoT('preferences.personal.profile_desc')));

        const profileForm = document.createElement('form');
        profileForm.className = 'grid gap-sm max-w-[24rem] mb-xl';
        profileForm.innerHTML = `
<label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('preferences.personal.display_name'))}</span>
<input name="display_name" required class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" value="${esc(p.display_name ?? '')}" /></label>
<label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('preferences.personal.email'))}</span>
<input name="email" type="email" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" value="${esc(p.email ?? '')}" /></label>
<p class="text-xs fg-[var(--grid-caption)] m-0">${esc(oaaoT('preferences.personal.login_name'))}: ${esc(p.login_name ?? '')}</p>
<button type="submit" class="mt-sm self-start rounded-[10px] px-4 py-2 text-sm fw-medium bg-[var(--grid-accent)] fg-white border-0 cursor-pointer">${esc(oaaoT('preferences.personal.save_profile'))}</button>
<p data-oaao-pref-profile-msg class="text-[0.8125rem] min-h-[1.25rem] m-0" role="status"></p>`;

        profileForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const msg = profileForm.querySelector('[data-oaao-pref-profile-msg]');
            const fd = new FormData(profileForm);
            if (msg instanceof HTMLElement) msg.textContent = oaaoT('preferences.personal.saving');
            try {
                const r = await fetch(userApiUrl('profile_save'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        display_name: String(fd.get('display_name') ?? '').trim(),
                        email: String(fd.get('email') ?? '').trim(),
                    }),
                });
                const j = await r.json();
                if (msg instanceof HTMLElement) {
                    msg.className = r.ok && j?.success
                        ? 'text-[0.8125rem] fg-[var(--grid-ink-muted)] min-h-[1.25rem] m-0'
                        : 'text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem] m-0';
                    msg.textContent =
                        r.ok && j?.success
                            ? oaaoT('preferences.personal.saved')
                            : j?.message || oaaoT('preferences.personal.save_failed');
                }
                if (r.ok && j?.success) {
                    const label = document.getElementById('workspace-user-label');
                    if (label) label.textContent = String(fd.get('display_name') ?? '').trim() || label.textContent;
                }
            } catch {
                if (msg instanceof HTMLElement) msg.textContent = oaaoT('preferences.personal.save_failed');
            }
        });

        host.append(profileForm);

        host.append(sectionTitle(oaaoT('preferences.personal.password_title')));
        const passForm = document.createElement('form');
        passForm.className = 'grid gap-sm max-w-[24rem] mb-xl';
        passForm.innerHTML = `
<label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('preferences.personal.current_password'))}</span>
<input name="current_password" type="password" required autocomplete="current-password" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" /></label>
<label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('preferences.personal.new_password'))}</span>
<input name="new_password" type="password" required minlength="8" autocomplete="new-password" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]" /></label>
<button type="submit" class="mt-sm self-start rounded-[10px] px-4 py-2 text-sm fw-medium bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)] border border-[var(--grid-line)] cursor-pointer">${esc(oaaoT('preferences.personal.change_password'))}</button>
<p data-oaao-pref-pass-msg class="text-[0.8125rem] min-h-[1.25rem] m-0" role="status"></p>`;

        passForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const msg = passForm.querySelector('[data-oaao-pref-pass-msg]');
            const fd = new FormData(passForm);
            if (msg instanceof HTMLElement) msg.textContent = oaaoT('preferences.personal.saving');
            try {
                const r = await fetch(userApiUrl('password_change'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        current_password: String(fd.get('current_password') ?? ''),
                        new_password: String(fd.get('new_password') ?? ''),
                    }),
                });
                const j = await r.json();
                if (msg instanceof HTMLElement) {
                    msg.className = r.ok && j?.success
                        ? 'text-[0.8125rem] fg-[var(--grid-ink-muted)] min-h-[1.25rem] m-0'
                        : 'text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem] m-0';
                    msg.textContent =
                        r.ok && j?.success
                            ? oaaoT('preferences.personal.password_changed')
                            : j?.message || oaaoT('preferences.personal.password_failed');
                }
                if (r.ok && j?.success) passForm.reset();
            } catch {
                if (msg instanceof HTMLElement) msg.textContent = oaaoT('preferences.personal.password_failed');
            }
        });

        host.append(passForm);

        host.append(sectionTitle(oaaoT('preferences.personal.language_title')));
        const langForm = document.createElement('form');
        langForm.className = 'grid gap-sm max-w-[24rem]';
        const locale = String(p.locale ?? 'en');
        langForm.innerHTML = `
<label class="flex flex-col gap-0.5 text-[0.8125rem]"><span class="fw-medium">${esc(oaaoT('preferences.personal.language'))}</span>
<select name="locale" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)]">
<option value="en"${locale === 'en' ? ' selected' : ''}>English</option>
<option value="zh-Hant"${locale === 'zh-Hant' ? ' selected' : ''}>繁體中文</option>
</select></label>
<button type="submit" class="mt-sm self-start rounded-[10px] px-4 py-2 text-sm fw-medium bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)] border border-[var(--grid-line)] cursor-pointer">${esc(oaaoT('preferences.personal.save_language'))}</button>
<p data-oaao-pref-lang-msg class="text-[0.8125rem] min-h-[1.25rem] m-0" role="status"></p>`;

        langForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const msg = langForm.querySelector('[data-oaao-pref-lang-msg]');
            const fd = new FormData(langForm);
            const loc = String(fd.get('locale') ?? 'en');
            if (msg instanceof HTMLElement) msg.textContent = oaaoT('preferences.personal.saving');
            try {
                const r = await fetch(userApiUrl('preferences_save'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ locale: loc }),
                });
                const j = await r.json();
                if (msg instanceof HTMLElement) {
                    msg.className = r.ok && j?.success
                        ? 'text-[0.8125rem] fg-[var(--grid-ink-muted)] min-h-[1.25rem] m-0'
                        : 'text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem] m-0';
                    msg.textContent =
                        r.ok && j?.success
                            ? oaaoT('preferences.personal.language_saved')
                            : j?.message || oaaoT('preferences.personal.save_failed');
                }
                if (r.ok && j?.success) {
                    document.documentElement.lang = loc;
                }
            } catch {
                if (msg instanceof HTMLElement) msg.textContent = oaaoT('preferences.personal.save_failed');
            }
        });

        host.append(langForm);
    } catch {
        host.replaceChildren();
        host.append(errorLine(oaaoT('preferences.personal.load_failed')));
    }
}

/** @param {string} title @param {string} value */
function statCard(title, value) {
    const el = document.createElement('div');
    el.className =
        'rounded-[12px] border border-[var(--grid-line)] bg-[var(--grid-paper)] px-4 py-3 flex flex-col gap-1 min-w-0';
    el.innerHTML = `<span class="text-[0.75rem] fg-[var(--grid-caption)] uppercase tracking-wide">${esc(title)}</span><span class="text-[1.25rem] fw-semibold fg-[var(--grid-ink)] tabular-nums">${esc(value)}</span>`;
    return el;
}

/** @param {string} t */
function sectionTitle(t) {
    const h = document.createElement('div');
    h.className = 'text-[1rem] fw-semibold fg-[var(--grid-ink)] mb-sm mt-0';
    h.textContent = t;
    return h;
}

/** @param {number} n @param {number} [frac] */
function formatNum(n, frac = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return frac > 0 ? v.toFixed(frac) : String(Math.round(v));
}

export default mountPreferencesPanel;
