/**
 * Admin Settings — Credit factors catalog (tokens/credit ratios + MM resolution tiers).
 */

import { oaaoT } from './oaao-i18n.js';
import { oaaoMountLoadingLogo } from './oaao-loading-logo.js';
import { endpointsApiUrl, endpointsFetchJson } from './endpoints-settings/api.js';

/** @param {unknown} v */
function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * @param {string} title
 * @param {Array<Record<string, unknown>>} rows
 * @param {Array<{ key: string, label: string }>} cols
 */
function renderTable(title, rows, cols) {
    const section = document.createElement('section');
    section.className = 'grid gap-sm min-w-0';
    const h = document.createElement('h4');
    h.className = 'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] m-0 uppercase tracking-wide';
    h.textContent = title;
    section.appendChild(h);

    if (!rows.length) {
        const p = document.createElement('p');
        p.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0';
        p.textContent = '—';
        section.appendChild(p);
        return section;
    }

    const table = document.createElement('table');
    table.className = 'w-full border-collapse text-[0.8125rem]';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr class="bg-[rgba(0,0,0,0.03)]">${cols.map((c) => `<th class="text-left p-2 border border-[var(--grid-line)]">${esc(c.label)}</th>`).join('')}</tr>`;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = cols
            .map((c) => `<td class="p-2 border border-[var(--grid-line)] font-mono text-xs">${esc(row[c.key])}</td>`)
            .join('');
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
}

/**
 * @param {Record<string, unknown>} mmFactors
 */
function renderMmFactors(mmFactors) {
    const wrap = document.createElement('section');
    wrap.className = 'grid gap-md min-w-0';
    const h = document.createElement('h4');
    h.className = 'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] m-0 uppercase tracking-wide';
    h.textContent = oaaoT('settings.credit.mm_title', 'Multimodal credits (per resolution tier)');
    wrap.appendChild(h);

    const hint = document.createElement('p');
    hint.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0 leading-snug';
    hint.textContent = oaaoT(
        'settings.credit.mm_hint',
        'Edit task factors under Settings → Multimodal. Generate/edit tasks bill by resolution (1k–8k).',
    );
    wrap.appendChild(hint);

    const tasks = mmFactors.tasks && typeof mmFactors.tasks === 'object' ? mmFactors.tasks : {};
    const tiers = Array.isArray(mmFactors.resolutions) ? mmFactors.resolutions : ['1k', '2k', '4k', '8k'];
    const cols = [{ key: 'task', label: 'Task' }, ...tiers.map((t) => ({ key: String(t), label: String(t) }))];
    /** @type {Array<Record<string, unknown>>} */
    const rows = Object.entries(tasks).map(([task, tierMap]) => {
        /** @type {Record<string, unknown>} */
        const row = { task };
        if (tierMap && typeof tierMap === 'object') {
            for (const tier of tiers) {
                const val = /** @type {Record<string, unknown>} */ (tierMap)[tier];
                row[String(tier)] = val ?? '—';
            }
        }
        return row;
    });
    wrap.appendChild(renderTable('', rows, cols));
    return wrap;
}

/** @param {HTMLElement} host @param {{ JIT?: { hydrate?: (el: HTMLElement) => void } }} [ctx] */
export async function mountSettingsPanel(host, ctx = {}) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: oaaoT('settings.credit.loading', 'Loading credit factors…') });

    const { res, data } = await endpointsFetchJson(endpointsApiUrl('credit_factors'));
    if (!res.ok || !data?.success) {
        host.textContent = '';
        const err = document.createElement('p');
        err.className = 'text-[0.8125rem] fg-[var(--grid-caution,#b45309)] m-0';
        err.textContent =
            typeof data?.message === 'string' && data.message
                ? data.message
                : oaaoT('settings.credit.load_failed', 'Failed to load credit catalog.');
        host.appendChild(err);
        return;
    }

    const payload = data.data && typeof data.data === 'object' ? data.data : {};
    const root = document.createElement('div');
    root.className = 'grid gap-lg min-w-0 max-w-[48rem]';

    const intro = document.createElement('p');
    intro.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0 leading-snug';
    intro.textContent = oaaoT(
        'settings.credit.intro',
        'All token→credit conversion ratios and multimodal billing factors in one place.',
    );
    root.appendChild(intro);

    const formula = payload.formula && typeof payload.formula === 'object' ? payload.formula : {};
    const formulaBox = document.createElement('pre');
    formulaBox.className = 'text-[0.75rem] font-mono fg-[var(--grid-ink)] bg-[rgba(0,0,0,0.03)] border border-[var(--grid-line)] rounded-lg p-3 m-0 whitespace-pre-wrap';
    formulaBox.textContent = [
        `Chat: ${formula.chat_completion ?? ''}`,
        `Multimodal: ${formula.multimodal ?? ''}`,
        `Default tokens/credit: ${payload.tokens_per_credit ?? payload.defaults?.tokens_per_credit ?? 1000}`,
    ].join('\n');
    root.appendChild(formulaBox);

    root.appendChild(
        renderTable(
            oaaoT('settings.credit.endpoints', 'LLM endpoints (tokens per credit)'),
            Array.isArray(payload.endpoints) ? payload.endpoints : [],
            [
                { key: 'endpoint_id', label: 'ID' },
                { key: 'label', label: 'Label' },
                { key: 'tokens_per_credit', label: 'Tokens / credit' },
            ],
        ),
    );

    root.appendChild(
        renderTable(
            oaaoT('settings.credit.purposes', 'Purpose multipliers'),
            Array.isArray(payload.purposes) ? payload.purposes : [],
            [
                { key: 'purpose_key', label: 'Purpose' },
                { key: 'label', label: 'Label' },
                { key: 'credit_multiplier', label: 'Multiplier' },
            ],
        ),
    );

    root.appendChild(
        renderTable(
            oaaoT('settings.credit.chat_endpoints', 'Chat endpoint multipliers'),
            Array.isArray(payload.chat_endpoints) ? payload.chat_endpoints : [],
            [
                { key: 'chat_endpoint_id', label: 'ID' },
                { key: 'label', label: 'Label' },
                { key: 'credit_multiplier', label: 'Multiplier' },
            ],
        ),
    );

    root.appendChild(renderMmFactors(payload.mm_credit_factors && typeof payload.mm_credit_factors === 'object' ? payload.mm_credit_factors : {}));

    const pathP = document.createElement('p');
    pathP.className = 'text-[0.75rem] font-mono fg-[var(--grid-ink-muted)] m-0';
    pathP.textContent = `mm_modules.json: ${String(payload.mm_config_path ?? '—')}`;
    root.appendChild(pathP);

    host.textContent = '';
    host.appendChild(root);
    ctx.JIT?.hydrate?.(root);
}

export function teardownSettingsPanel() {}
