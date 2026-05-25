/**
 * Admin Settings — Chat → General (tenant-wide history page size + LLM context cap).
 *
 * @module oaao-chat-admin-general-panel
 */

/** @param {string} relUnderCoreDefault */
function oaaoChatAdminCoreImportHref(relUnderCoreDefault) {
    let pathOnly = `/webassets/core/default/${String(relUnderCoreDefault ?? '').replace(/^\/+/, '')}`.replace(
        /\/{2,}/g,
        '/',
    );
    const rawMount = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    if (rawMount !== '' && rawMount !== '/') {
        const pref = (rawMount.startsWith('/') ? rawMount : `/${rawMount}`).replace(/\/+$/, '');
        if (pref !== '' && !(pathOnly === pref || pathOnly.startsWith(`${pref}/`))) {
            pathOnly = `${pref}${pathOnly}`.replace(/\/{2,}/g, '/');
        }
    }
    if (
        typeof window !== 'undefined' &&
        window.location &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ) {
        const o = window.location.origin;
        if (o && o !== 'null') {
            return `${o}${pathOnly}`;
        }
    }
    return pathOnly;
}

const [_mI18n, _mCards, _mLoading] = await Promise.all([
    import(/* webpackIgnore: true */ oaaoChatAdminCoreImportHref('js/oaao-i18n.js')),
    import(/* webpackIgnore: true */ oaaoChatAdminCoreImportHref('js/settings-section-cards.js')),
    import(/* webpackIgnore: true */ oaaoChatAdminCoreImportHref('js/oaao-loading-logo.js')),
]);

const { oaaoT } = _mI18n;
const {
    settingsActionButton,
    settingsCard,
    settingsCardFooter,
    settingsCardRow,
    settingsCardSelect,
    settingsCardStatus,
    settingsPageStack,
    wrapSettingsSection,
} = _mCards;
const { oaaoMountLoadingLogo } = _mLoading;

/** @param {string} action */
function chatApiUrl(action) {
    const rawMount = (document.body?.dataset?.oaaoMountPrefix ?? '').trim();
    const prefix = rawMount && rawMount !== '/' ? (rawMount.startsWith('/') ? rawMount : `/${rawMount}`) : '';
    return `${prefix}/chat/api/${String(action).replace(/^\/+/, '')}`;
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
 * @param {{ section?: { section_id?: string }, oaaoT?: Function }} [ctx]
 */
export async function mountSettingsPanel(host, ctx = {}) {
    if (!(host instanceof HTMLElement)) return;
    if (String(ctx.section?.section_id ?? '') !== 'settings-chat-general') {
        host.append(errorLine(oaaoT('settings.chat_general.unknown_section', 'Unknown settings section.')));
        return;
    }

    const t = typeof ctx.oaaoT === 'function' ? ctx.oaaoT : oaaoT;

    host.replaceChildren();
    oaaoMountLoadingLogo(host, { fill: true, label: t('settings.chat_general.loading', 'Loading chat settings…') });

    try {
        const res = await fetch(chatApiUrl('chat_preferences'), { credentials: 'same-origin' });
        const json = await res.json();
        host.replaceChildren();

        if (!res.ok || !json?.success) {
            host.append(
                errorLine(json?.message || t('settings.chat_general.load_failed', 'Could not load chat settings.')),
            );
            return;
        }

        const d = json.data ?? {};
        const pageMin = Number(d.history_page_size_min ?? 3);
        const pageMax = Number(d.history_page_size_max ?? 10);
        const pageCurrent = Number(d.history_page_size ?? 5);
        const promptMin = Number(d.prompt_message_limit_min ?? 3);
        const promptMax = Number(d.prompt_message_limit_max ?? 120);
        const promptCurrent = Number(d.prompt_message_limit ?? 60);

        const page = settingsPageStack();
        const generalCard = settingsCard();

        const pageSelect = settingsCardSelect('history_page_size');
        for (let n = pageMin; n <= pageMax; n += 1) {
            const o = document.createElement('option');
            o.value = String(n);
            o.textContent = String(n);
            if (String(pageCurrent) === String(n)) o.selected = true;
            pageSelect.append(o);
        }

        const promptSelect = settingsCardSelect('prompt_message_limit');
        for (const n of [20, 30, 40, 50, 60, 80, 100, 120]) {
            if (n < promptMin || n > promptMax) continue;
            const o = document.createElement('option');
            o.value = String(n);
            o.textContent = String(n);
            if (String(promptCurrent) === String(n)) o.selected = true;
            promptSelect.append(o);
        }
        if (!promptSelect.querySelector('option[selected]')) {
            const o = document.createElement('option');
            o.value = String(promptCurrent);
            o.textContent = String(promptCurrent);
            o.selected = true;
            promptSelect.append(o);
        }

        const intro = document.createElement('p');
        intro.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0 mb-3';
        intro.textContent = t(
            'settings.chat_general.intro',
            'Tenant-wide defaults for every user on this host. End users cannot override these in Preferences.',
        );
        generalCard.append(intro);

        generalCard.append(
            settingsCardRow(
                {
                    label: t('settings.chat_general.history_page_size', 'Messages per load'),
                    description: t(
                        'settings.chat_general.history_page_size_desc',
                        'When anyone opens a thread or scrolls up, load this many messages at a time (3–10).',
                    ),
                    control: pageSelect,
                },
                false,
            ),
            settingsCardRow(
                {
                    label: t('settings.chat_general.prompt_context', 'LLM context cap'),
                    description: t(
                        'settings.chat_general.prompt_context_desc',
                        'Maximum prior messages injected from the server database on each send (not browser cache).',
                    ),
                    control: promptSelect,
                },
                false,
            ),
            settingsCardRow(
                {
                    label: t('settings.chat_general.prompt_source', 'Prompt source'),
                    description: t(
                        'settings.chat_general.prompt_source_desc',
                        'Orchestrator always rebuilds history from persisted message rows — never from client-supplied transcripts.',
                    ),
                },
                true,
            ),
        );

        const statusEl = settingsCardStatus('');
        const saveBtn = settingsActionButton(t('settings.chat_general.save', 'Save'), 'primary');
        generalCard.append(settingsCardFooter([saveBtn, statusEl]));

        saveBtn.addEventListener('click', () => {
            void (async () => {
                statusEl.textContent = t('settings.chat_general.saving', 'Saving…');
                try {
                    const r = await fetch(chatApiUrl('chat_preferences'), {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            history_page_size: parseInt(String(pageSelect.value ?? ''), 10),
                            prompt_message_limit: parseInt(String(promptSelect.value ?? ''), 10),
                        }),
                    });
                    const j = await r.json();
                    statusEl.textContent =
                        r.ok && j?.success
                            ? t('settings.chat_general.saved', 'Saved.')
                            : j?.message || t('settings.chat_general.save_failed', 'Save failed.');
                    if (r.ok && j?.success) {
                        window.dispatchEvent(
                            new CustomEvent('oaao:chat-history-settings-changed', {
                                detail: j.data ?? {},
                            }),
                        );
                    }
                } catch {
                    statusEl.textContent = t('settings.chat_general.save_failed', 'Save failed.');
                }
            })();
        });

        page.append(wrapSettingsSection(t('settings.chat_general.section_general', 'General'), generalCard));
        host.append(page);
    } catch {
        host.replaceChildren();
        host.append(errorLine(t('settings.chat_general.load_failed', 'Could not load chat settings.')));
    }
}

export default mountSettingsPanel;
