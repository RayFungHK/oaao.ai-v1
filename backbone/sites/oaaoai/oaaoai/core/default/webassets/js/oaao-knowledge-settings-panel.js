/**
 * Platform console — Knowledge evolution (WS-1-S6/S10): not visible to tenant admins.
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
 * @param {Record<string, unknown>} refresh
 */
function renderForm(refresh) {
    const enabled = refresh.scheduled_enabled !== false;
    const interval = Number(refresh.interval_hours ?? 168);
    const classify = refresh.classify_after !== false;
    const mergeRecall = refresh.merge_recall !== false;
    const dns = Array.isArray(refresh.do_not_search) ? refresh.do_not_search.join('\n') : '';
    const platformVault = Number(refresh.platform_vault_id ?? refresh.tenant_vault_id ?? 0);
    const refreshUser = Number(refresh.refresh_user_id ?? 0);

    const root = document.createElement('form');
    root.className = 'grid gap-md min-w-0 max-w-[40rem]';
    root.innerHTML = `
<p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0 leading-snug">${esc(
        oaaoT(
            'settings.knowledge.intro',
            'oaao.ai platform self-evolution: auto web search is gated by cross-tenant topic importance and lifecycle (low yield, stale, time-bound). Tenants do not see this panel.',
        ),
    )}</p>
<section class="grid gap-2 p-3 rounded-md border border-solid border-[var(--grid-line)] bg-[var(--grid-panel)]/50">
  <h4 class="text-[0.75rem] fw-semibold uppercase tracking-wide fg-[var(--grid-ink-muted)] m-0">${esc(
        oaaoT('settings.knowledge.vault_section', 'Knowledge vault targets'),
    )}</h4>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]">
    <span class="fw-medium">${esc(oaaoT('settings.knowledge.platform_vault_id', 'Platform Knowledge vault ID'))}</span>
    <input type="number" name="platform_vault_id" min="0" step="1" value="${platformVault > 0 ? esc(String(platformVault)) : ''}"
      class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-[12rem]" />
  </label>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]">
    <span class="fw-medium">${esc(oaaoT('settings.knowledge.refresh_user_id', 'Service user ID (Vault ingest)'))}</span>
    <input type="number" name="refresh_user_id" min="0" step="1" value="${refreshUser > 0 ? esc(String(refreshUser)) : ''}"
      placeholder="${esc(oaaoT('settings.knowledge.refresh_user_ph', 'e.g. automation / admin user'))}"
      class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-[12rem]" />
  </label>
  <p class="text-[0.6875rem] fg-[var(--grid-ink-muted)] m-0 leading-snug">${esc(
        oaaoT(
            'settings.knowledge.vault_hint',
            'Platform-level Vault for distilled public-web RAG. Env vars are bootstrap-only until auto-provision (roadmap).',
        ),
    )}</p>
</section>
<label class="flex items-center gap-2 text-[0.8125rem] cursor-pointer">
  <input type="checkbox" name="scheduled_enabled" ${enabled ? 'checked' : ''} class="shrink-0" />
  <span>${esc(oaaoT('settings.knowledge.scheduled_enabled', 'Enable scheduled refresh'))}</span>
</label>
<label class="flex flex-col gap-0.5 text-[0.8125rem]">
  <span class="fw-medium">${esc(oaaoT('settings.knowledge.interval_hours', 'Refresh interval (hours)'))}</span>
  <input type="number" name="interval_hours" min="1" max="720" step="1" value="${esc(String(interval))}"
    class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] max-w-[8rem]" />
</label>
<label class="flex items-center gap-2 text-[0.8125rem] cursor-pointer">
  <input type="checkbox" name="classify_after" ${classify ? 'checked' : ''} class="shrink-0" />
  <span>${esc(oaaoT('settings.knowledge.classify_after', 'Classify & distill after capture'))}</span>
</label>
<label class="flex items-center gap-2 text-[0.8125rem] cursor-pointer">
  <input type="checkbox" name="merge_recall" ${mergeRecall ? 'checked' : ''} class="shrink-0" />
  <span>${esc(oaaoT('settings.knowledge.merge_recall', 'Merge Knowledge vault into RAG by default'))}</span>
</label>
<label class="flex flex-col gap-0.5 text-[0.8125rem]">
  <span class="fw-medium">${esc(oaaoT('settings.knowledge.do_not_search', 'Do not search (one topic per line)'))}</span>
  <textarea name="do_not_search" rows="4" placeholder="gambling&#10;personal health"
    class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-panel-bright)] font-mono text-xs w-full">${esc(dns)}</textarea>
</label>
<div class="flex flex-wrap gap-2 items-center">
  <button type="submit" class="rounded-md px-3 py-1.5 text-[0.8125rem] border border-solid border-[var(--grid-line)] bg-[var(--grid-ink)] fg-[#fff] cursor-pointer hover:opacity-90">${esc(
        oaaoT('settings.knowledge.save', 'Save'),
    )}</button>
  <button type="button" data-oaao-knowledge-run-now class="rounded-md px-3 py-1.5 text-[0.8125rem] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] cursor-pointer hover:bg-[var(--grid-line)]/30">${esc(
        oaaoT('settings.knowledge.run_now', 'Run refresh now'),
    )}</button>
</div>
<p data-oaao-knowledge-status class="text-[0.75rem] fg-[var(--grid-ink-muted)] m-0 min-h-[1rem]"></p>
<p class="text-[0.6875rem] fg-[var(--grid-ink-muted)] m-0 leading-snug">${esc(
        oaaoT(
            'settings.knowledge.cron_hint',
            'Orchestrator polls POST /endpoints/api/knowledge_cron_run when OAAO_VAULT_JOB_POLL_BASE_URL is set (see docker/env).',
        ),
    )}</p>`;
    return root;
}

/** @param {HTMLFormElement} form */
function readRefreshFromForm(form) {
    const fd = new FormData(form);
    const dnsRaw = String(fd.get('do_not_search') || '');
    const doNot = dnsRaw
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 24);
    const parseVid = (name) => {
        const v = parseInt(String(fd.get(name) || '0'), 10);
        return Number.isFinite(v) && v > 0 ? v : 0;
    };
    return {
        scheduled_enabled: fd.get('scheduled_enabled') === 'on',
        interval_hours: Math.max(1, Math.min(720, Number(fd.get('interval_hours') || 168))),
        classify_after: fd.get('classify_after') === 'on',
        merge_recall: fd.get('merge_recall') === 'on',
        do_not_search: doNot,
        tenant_vault_id: 0,
        platform_vault_id: parseVid('platform_vault_id'),
        refresh_user_id: parseVid('refresh_user_id'),
    };
}

/** @param {HTMLElement} host @param {{ JIT?: { hydrate?: (el: HTMLElement) => void } }} [ctx] */
export async function mountSettingsPanel(host, ctx = {}) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: oaaoT('settings.knowledge.loading', 'Loading Knowledge settings…') });

    const { res, data } = await endpointsFetchJson(endpointsApiUrl('knowledge_settings'));
    if (!res.ok || !data?.success) {
        host.textContent = '';
        const err = document.createElement('p');
        err.className = 'text-[0.8125rem] fg-[var(--grid-caution,#b45309)] m-0';
        err.textContent =
            typeof data?.message === 'string' && data.message
                ? data.message
                : oaaoT('settings.knowledge.load_failed', 'Failed to load Knowledge settings.');
        host.appendChild(err);
        return;
    }

    const payload = data.data && typeof data.data === 'object' ? data.data : {};
    const refresh =
        payload.refresh && typeof payload.refresh === 'object' ? payload.refresh : {};
    const bootstrap =
        payload.bootstrap && typeof payload.bootstrap === 'object' ? payload.bootstrap : null;
    const vaultBoot =
        bootstrap?.vault && typeof bootstrap.vault === 'object' ? bootstrap.vault : null;

    host.textContent = '';
    const form = renderForm(/** @type {Record<string, unknown>} */ (refresh));
    if (vaultBoot?.vault_id) {
        const note = document.createElement('p');
        note.className = 'text-[0.6875rem] fg-[var(--grid-ink-muted)] m-0';
        note.textContent = vaultBoot.created
            ? `Platform vault provisioned (id ${vaultBoot.vault_id}).`
            : `Platform vault id ${vaultBoot.vault_id} (existing).`;
        form.prepend(note);
    }
    host.append(form);
    ctx.JIT?.hydrate?.(host);

    const statusEl = form.querySelector('[data-oaao-knowledge-status]');

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!(form instanceof HTMLFormElement)) return;
        if (statusEl instanceof HTMLElement) statusEl.textContent = oaaoT('settings.knowledge.saving', 'Saving…');
        const body = { refresh: readRefreshFromForm(form) };
        const { res: saveRes, data: saveData } = await endpointsFetchJson(
            endpointsApiUrl('knowledge_settings_save'),
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        );
        if (statusEl instanceof HTMLElement) {
            statusEl.textContent =
                saveRes.ok && saveData?.success
                    ? oaaoT('settings.knowledge.saved', 'Saved.')
                    : typeof saveData?.message === 'string'
                      ? saveData.message
                      : oaaoT('settings.knowledge.save_failed', 'Save failed.');
        }
    });

    const runBtn = form.querySelector('[data-oaao-knowledge-run-now]');
    if (runBtn instanceof HTMLButtonElement) {
        runBtn.addEventListener('click', async () => {
            if (statusEl instanceof HTMLElement) {
                statusEl.textContent = oaaoT('settings.knowledge.running', 'Running refresh…');
            }
            const { res: runRes, data: runData } = await endpointsFetchJson(
                endpointsApiUrl('knowledge_cron_run'),
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) },
            );
            if (statusEl instanceof HTMLElement) {
                if (runRes.ok && runData?.success) {
                    const orch = runData.orchestrator;
                    const n =
                        orch && typeof orch.refreshed === 'number' ? orch.refreshed : runData.skipped ? 0 : '—';
                    statusEl.textContent = oaaoT('settings.knowledge.run_done', 'Refresh finished.', { count: String(n) });
                } else {
                    statusEl.textContent =
                        typeof runData?.message === 'string'
                            ? runData.message
                            : oaaoT('settings.knowledge.run_failed', 'Refresh failed.');
                }
            }
        });
    }
}

export function teardownSettingsPanel() {}
