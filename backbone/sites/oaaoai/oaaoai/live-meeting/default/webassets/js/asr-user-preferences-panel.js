/**
 * User Preferences — ASR fields from {@see AsrUserPreferenceRegister} (cross-module registry).
 *
 * @module asr-user-preferences-panel
 */

import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';
import { oaaoT } from '@oaao/core-js/oaao-i18n.js';
import {
    settingsActionButton,
    settingsCard,
    settingsCardFooter,
    settingsCardRow,
    settingsCardSelect,
    settingsCardStatus,
    settingsPageStack,
    wrapSettingsSection,
} from '@oaao/core-js/settings-section-cards.js';

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
    void ctx;

    host.replaceChildren();
    oaaoMountLoadingLogo(host, { fill: true, label: oaaoT('preferences.asr.loading') });

    try {
        const res = await fetch(userApiUrl('asr_preferences'), { credentials: 'same-origin' });
        const json = await res.json();
        host.replaceChildren();

        if (!res.ok || !json?.success) {
            host.append(errorLine(json?.message || oaaoT('preferences.asr.load_failed')));
            return;
        }

        const data = json.data ?? {};
        /** @type {Array<Record<string, unknown>>} */
        const fields = Array.isArray(data.fields) ? data.fields : [];
        /** @type {Record<string, string>} */
        const values = data.values && typeof data.values === 'object' ? data.values : {};

        if (fields.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'text-sm fg-[var(--grid-ink-muted)] m-0 leading-relaxed';
            empty.textContent = oaaoT('preferences.asr.none_available');
            host.append(empty);
            return;
        }

        const page = settingsPageStack();
        const card = settingsCard();
        const form = document.createElement('form');
        form.className = 'flex flex-col min-w-0';

        /** @type {Record<string, HTMLSelectElement>} */
        const controls = {};

        for (const field of fields) {
            const prefKey = String(field.pref_key ?? field.field_id ?? '').trim();
            if (!prefKey) continue;
            const type = String(field.type ?? 'select');
            if (type !== 'select') continue;

            const sel = settingsCardSelect(prefKey);
            const options = Array.isArray(field.options) ? field.options : [];
            const current = String(values[prefKey] ?? field.default ?? '');
            for (const opt of options) {
                if (!opt || typeof opt !== 'object') continue;
                const value = String(/** @type {Record<string, unknown>} */ (opt).value ?? '');
                if (!value) continue;
                const labelKey = String(/** @type {Record<string, unknown>} */ (opt).label_key ?? '');
                const o = document.createElement('option');
                o.value = value;
                o.textContent = labelKey ? oaaoT(labelKey) : value;
                if (current === value) o.selected = true;
                sel.append(o);
            }

            const labelKey = String(field.label_key ?? prefKey);
            const descKey = String(field.desc_key ?? '');
            form.append(
                settingsCardRow(
                    {
                        label: oaaoT(labelKey),
                        description: descKey ? oaaoT(descKey) : '',
                        control: sel,
                    },
                    Object.keys(controls).length > 0,
                ),
            );
            controls[prefKey] = sel;
        }

        const saveBtn = settingsActionButton(oaaoT('preferences.asr.save'));
        saveBtn.type = 'submit';
        form.append(settingsCardFooter(saveBtn));
        const status = settingsCardStatus('', false);
        status.classList.add('hidden');
        form.append(status);

        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            status.classList.remove('hidden');
            status.textContent = oaaoT('preferences.asr.saving');
            /** @type {Record<string, string>} */
            const payload = {};
            for (const [key, sel] of Object.entries(controls)) {
                payload[key] = sel.value;
            }
            try {
                const r = await fetch(userApiUrl('asr_preferences'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const j = await r.json();
                status.className = settingsCardStatusClass(!(r.ok && j?.success));
                status.textContent =
                    r.ok && j?.success
                        ? oaaoT('preferences.asr.saved')
                        : j?.message || oaaoT('preferences.asr.save_failed');
            } catch {
                status.className = settingsCardStatusClass(true);
                status.textContent = oaaoT('preferences.asr.save_failed');
            }
        });

        card.append(form);
        page.append(wrapSettingsSection(oaaoT('preferences.asr.section_title'), card));
        host.append(page);
    } catch {
        host.replaceChildren();
        host.append(errorLine(oaaoT('preferences.asr.load_failed')));
    }
}
