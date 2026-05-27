/**
 * Preferences panels — Dashboard (usage/credits) + Personal (profile, password, language).
 *
 * @module user-preferences-panels
 */

import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';
import { oaaoT } from '@oaao/core-js/oaao-i18n.js';
import { mountUserUsageOverview } from './user-usage-overview.js';
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
    if (sectionId === 'pref-personalization') {
        return mountPersonalizationPanel(host);
    }
    host.append(errorLine(oaaoT('preferences.panel.unknown', 'Unknown preferences section.')));
}

/**
 * @param {HTMLElement} host
 */
async function mountDashboardPanel(host) {
    await mountUserUsageOverview(host, userApiUrl('dashboard'));
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

/** @param {Record<string, string | number | boolean>} [attrs] */
function settingsCardTextarea(attrs = {}) {
    const ta = document.createElement('textarea');
    ta.className =
        'w-full rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] px-2.5 py-2 text-[0.8125rem] font-inherit bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)] box-border min-h-[5.5rem] resize-y leading-relaxed';
    if (attrs.name) ta.name = String(attrs.name);
    if (attrs.value != null) ta.value = String(attrs.value);
    if (attrs.placeholder) ta.placeholder = String(attrs.placeholder);
    if (attrs.rows) ta.rows = Number(attrs.rows);
    return ta;
}

/** @param {string} name @param {boolean} checked */
function settingsCardCheckbox(name, checked) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.checked = Boolean(checked);
    input.className = 'w-4 h-4 accent-[var(--grid-accent)]';
    return input;
}

/**
 * @param {HTMLElement} host
 */
async function mountPersonalizationPanel(host) {
    host.replaceChildren();
    oaaoMountLoadingLogo(host, { fill: true, label: oaaoT('preferences.personalization.loading') });

    try {
        const res = await fetch(userApiUrl('personalization'), { credentials: 'same-origin' });
        const json = await res.json();
        host.replaceChildren();

        if (!res.ok || !json?.success) {
            host.append(errorLine(json?.message || oaaoT('preferences.personalization.load_failed')));
            return;
        }

        const data = json.data ?? {};
        /** @type {Record<string, unknown>} */
        const p = { ...(data.personalization ?? {}) };
        const tzOptions = Array.isArray(data.timezone_options) ? data.timezone_options : ['UTC'];
        const displayName = String(data.display_name ?? '').trim();

        const page = document.createElement('div');
        page.className = 'flex flex-col gap-6 min-w-0 max-w-full w-full';

        const tabBar = document.createElement('div');
        tabBar.className = 'flex gap-6 border-b border-solid border-[var(--grid-line)] pb-0';
        const tabProfile = document.createElement('button');
        tabProfile.type = 'button';
        tabProfile.className =
            'border-0 bg-transparent cursor-pointer font-inherit text-[0.875rem] fw-semibold fg-[var(--grid-ink)] pb-3 border-b-2 border-solid border-[var(--grid-ink)] -mb-px';
        tabProfile.textContent = oaaoT('preferences.personalization.tab_profile');
        const tabKnowledge = document.createElement('button');
        tabKnowledge.type = 'button';
        tabKnowledge.className =
            'border-0 bg-transparent cursor-pointer font-inherit text-[0.875rem] fw-medium fg-[var(--grid-ink-muted)] pb-3 border-b-2 border-solid border-transparent -mb-px hover:fg-[var(--grid-ink)]';
        tabKnowledge.textContent = oaaoT('preferences.personalization.tab_knowledge');
        tabBar.append(tabProfile, tabKnowledge);

        const profilePane = document.createElement('div');
        profilePane.className = 'flex flex-col gap-6 min-w-0';
        const knowledgePane = document.createElement('div');
        knowledgePane.className = 'flex flex-col gap-6 min-w-0 hidden';

        const nicknameInput = settingsCardInput({
            name: 'nickname',
            value: String(p.nickname ?? displayName),
            placeholder: oaaoT('preferences.personalization.nickname_ph'),
        });
        const occupationInput = settingsCardInput({
            name: 'occupation',
            value: String(p.occupation ?? ''),
            placeholder: oaaoT('preferences.personalization.occupation_ph'),
        });
        const aboutInput = settingsCardTextarea({
            name: 'about_you',
            value: String(p.about_you ?? ''),
            placeholder: oaaoT('preferences.personalization.about_ph'),
            rows: 4,
        });
        const customInput = settingsCardTextarea({
            name: 'custom_instructions',
            value: String(p.custom_instructions ?? ''),
            placeholder: oaaoT('preferences.personalization.custom_ph'),
            rows: 3,
        });
        const knowledgeInput = settingsCardTextarea({
            name: 'knowledge',
            value: String(p.knowledge ?? ''),
            placeholder: oaaoT('preferences.personalization.knowledge_ph'),
            rows: 8,
        });
        const regionInput = settingsCardInput({
            name: 'region',
            value: String(p.region ?? ''),
            placeholder: oaaoT('preferences.personalization.region_ph'),
        });
        const tzSel = settingsCardSelect('timezone');
        const browserTz =
            typeof Intl !== 'undefined' && Intl.DateTimeFormat
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : 'UTC';
        const tzSet = new Set(tzOptions.map((z) => String(z)));
        if (browserTz && !tzSet.has(browserTz)) {
            tzOptions.unshift(browserTz);
        }
        const selectedTz = String(p.timezone ?? browserTz ?? 'UTC');
        for (const z of tzOptions) {
            const o = document.createElement('option');
            o.value = String(z);
            o.textContent = String(z);
            if (String(z) === selectedTz) o.selected = true;
            tzSel.append(o);
        }

        const useProfile = settingsCardCheckbox('use_profile_in_chat', p.use_profile_in_chat !== false);
        const useKnowledge = settingsCardCheckbox('use_knowledge_in_chat', p.use_knowledge_in_chat !== false);
        const useDatetime = settingsCardCheckbox('include_datetime_in_chat', p.include_datetime_in_chat !== false);

        const profileCard = settingsCard();
        const profileBody = document.createElement('div');
        profileBody.className = 'flex flex-col min-w-0';
        const duoRow = document.createElement('div');
        duoRow.className = 'grid grid-cols-1 sm:grid-cols-2 gap-0 min-w-0';
        const nickWrap = document.createElement('div');
        nickWrap.append(settingsCardRow({ label: oaaoT('preferences.personalization.nickname'), control: nicknameInput }, false));
        const occWrap = document.createElement('div');
        occWrap.append(settingsCardRow({ label: oaaoT('preferences.personalization.occupation'), control: occupationInput }, false));
        duoRow.append(nickWrap, occWrap);
        profileBody.append(duoRow);
        profileBody.append(
            settingsCardRow(
                {
                    label: oaaoT('preferences.personalization.about'),
                    description: oaaoT('preferences.personalization.about_desc'),
                    control: aboutInput,
                },
                true,
            ),
        );
        aboutInput.classList.remove('sm:w-auto', 'sm:min-w-[10rem]', 'sm:max-w-[20rem]');
        aboutInput.classList.add('w-full', 'max-w-none');
        profileBody.append(
            settingsCardRow(
                {
                    label: oaaoT('preferences.personalization.custom_instructions'),
                    description: oaaoT('preferences.personalization.custom_desc'),
                    control: customInput,
                },
                true,
            ),
        );
        customInput.classList.remove('sm:w-auto', 'sm:min-w-[10rem]', 'sm:max-w-[20rem]');
        customInput.classList.add('w-full', 'max-w-none');
        profileBody.append(
            settingsCardRow({ label: oaaoT('preferences.personalization.timezone'), control: tzSel }, true),
            settingsCardRow({ label: oaaoT('preferences.personalization.region'), control: regionInput }, true),
            settingsCardRow(
                {
                    label: oaaoT('preferences.personalization.use_profile'),
                    description: oaaoT('preferences.personalization.use_profile_desc'),
                    control: useProfile,
                },
                true,
            ),
            settingsCardRow(
                {
                    label: oaaoT('preferences.personalization.use_datetime'),
                    description: oaaoT('preferences.personalization.use_datetime_desc'),
                    control: useDatetime,
                },
                true,
            ),
        );
        profileCard.append(profileBody);

        const knowledgeCard = settingsCard();
        const knowledgeBody = document.createElement('div');
        knowledgeBody.className = 'flex flex-col min-w-0';
        knowledgeBody.append(
            settingsCardRow(
                {
                    label: oaaoT('preferences.personalization.knowledge'),
                    description: oaaoT('preferences.personalization.knowledge_desc'),
                    control: knowledgeInput,
                },
                false,
            ),
            settingsCardRow(
                {
                    label: oaaoT('preferences.personalization.use_knowledge'),
                    description: oaaoT('preferences.personalization.use_knowledge_desc'),
                    control: useKnowledge,
                },
                true,
            ),
        );
        knowledgeInput.classList.remove('sm:w-auto', 'sm:min-w-[10rem]', 'sm:max-w-[20rem]');
        knowledgeInput.classList.add('w-full', 'max-w-none');
        knowledgeCard.append(knowledgeBody);

        profilePane.append(wrapSettingsSection(oaaoT('preferences.personalization.section_profile'), profileCard));
        knowledgePane.append(wrapSettingsSection(oaaoT('preferences.personalization.section_knowledge'), knowledgeCard));

        const form = document.createElement('form');
        form.className = 'flex flex-col gap-6 min-w-0';
        form.append(tabBar, profilePane, knowledgePane);

        const saveBtn = settingsActionButton(oaaoT('preferences.personalization.save'), 'primary');
        saveBtn.type = 'submit';
        const footer = settingsCardFooter(saveBtn);
        footer.classList.add('border-t', 'border-solid', 'border-[var(--grid-line)]', 'mt-2');
        form.append(footer);

        const status = settingsCardStatus('', false);
        status.classList.add('hidden');
        form.append(status);

        /** @param {'profile' | 'knowledge'} tab */
        function activateTab(tab) {
            const profileActive = tab === 'profile';
            profilePane.classList.toggle('hidden', !profileActive);
            knowledgePane.classList.toggle('hidden', profileActive);
            tabProfile.className = profileActive
                ? 'border-0 bg-transparent cursor-pointer font-inherit text-[0.875rem] fw-semibold fg-[var(--grid-ink)] pb-3 border-b-2 border-solid border-[var(--grid-ink)] -mb-px'
                : 'border-0 bg-transparent cursor-pointer font-inherit text-[0.875rem] fw-medium fg-[var(--grid-ink-muted)] pb-3 border-b-2 border-solid border-transparent -mb-px hover:fg-[var(--grid-ink)]';
            tabKnowledge.className = !profileActive
                ? 'border-0 bg-transparent cursor-pointer font-inherit text-[0.875rem] fw-semibold fg-[var(--grid-ink)] pb-3 border-b-2 border-solid border-[var(--grid-ink)] -mb-px'
                : 'border-0 bg-transparent cursor-pointer font-inherit text-[0.875rem] fw-medium fg-[var(--grid-ink-muted)] pb-3 border-b-2 border-solid border-transparent -mb-px hover:fg-[var(--grid-ink)]';
        }
        tabProfile.addEventListener('click', () => activateTab('profile'));
        tabKnowledge.addEventListener('click', () => activateTab('knowledge'));

        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            status.classList.remove('hidden');
            status.className = settingsCardStatusClass(false);
            status.textContent = oaaoT('preferences.personalization.saving');
            try {
                const body = {
                    nickname: nicknameInput.value.trim(),
                    occupation: occupationInput.value.trim(),
                    about_you: aboutInput.value.trim(),
                    custom_instructions: customInput.value.trim(),
                    knowledge: knowledgeInput.value.trim(),
                    timezone: tzSel.value,
                    region: regionInput.value.trim(),
                    use_profile_in_chat: useProfile.checked,
                    use_knowledge_in_chat: useKnowledge.checked,
                    include_datetime_in_chat: useDatetime.checked,
                };
                const r = await fetch(userApiUrl('personalization_save'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const j = await r.json();
                status.className = settingsCardStatusClass(!(r.ok && j?.success));
                status.textContent =
                    r.ok && j?.success
                        ? oaaoT('preferences.personalization.saved')
                        : j?.message || oaaoT('preferences.personalization.save_failed');
            } catch {
                status.className = settingsCardStatusClass(true);
                status.textContent = oaaoT('preferences.personalization.save_failed');
            }
        });

        page.append(form);
        host.append(page);
    } catch {
        host.replaceChildren();
        host.append(errorLine(oaaoT('preferences.personalization.load_failed')));
    }
}

export default mountPreferencesPanel;
