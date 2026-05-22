/**
 * Settings → Task planner ({@code oaao_purpose.meta_json} on {@code planning.*}).
 */

/** @returns {ReadonlyArray<{ id: string, labelKey: string }>} */
function readPlannerAgentCatalog() {
    const reg = globalThis.OAAO_PLANNER_AGENT_REGISTRY;
    if (Array.isArray(reg) && reg.length > 0) {
        /** @type {{ id: string, labelKey: string }[]} */
        const out = [];
        for (const row of reg) {
            if (!row || typeof row !== 'object') continue;
            const id = String(row.agent_kind ?? '').trim();
            if (!id) continue;
            const labelKey =
                typeof row.i18n_label_key === 'string' && row.i18n_label_key.trim()
                    ? row.i18n_label_key.trim()
                    : `settings.planner.agent.${id}`;
            out.push({ id, labelKey });
        }
        if (out.length) return out;
    }
    return PLANNER_AGENT_CATALOG_FALLBACK;
}

/** @type {ReadonlyArray<{ id: string, labelKey: string }>} */
const PLANNER_AGENT_CATALOG_FALLBACK = [
    { id: 'vault_rag', labelKey: 'settings.planner.agent.vault_rag' },
    { id: 'sandbox_code', labelKey: 'settings.planner.agent.sandbox_code' },
    { id: 'slide_designer', labelKey: 'settings.planner.agent.slide_designer' },
    { id: 'slides', labelKey: 'settings.planner.agent.slides' },
    { id: 'image_gen', labelKey: 'settings.planner.agent.image_gen' },
    { id: 'web_search', labelKey: 'settings.planner.agent.web_search' },
    { id: 'mcp_tool', labelKey: 'settings.planner.agent.mcp_tool' },
];

/** @type {ReadonlyArray<{ id: string, labelKey: string }>} */
export const PLANNER_AGENT_CATALOG = readPlannerAgentCatalog();

/** @param {unknown} metaJson */
function decodeMetaRoot(metaJson) {
    /** @type {Record<string, unknown>} */
    let root = {};
    if (typeof metaJson === 'string' && metaJson.trim()) {
        try {
            const dec = JSON.parse(metaJson.trim());
            if (dec && typeof dec === 'object') root = /** @type {Record<string, unknown>} */ (dec);
        } catch {
            root = {};
        }
    } else if (metaJson && typeof metaJson === 'object') {
        root = /** @type {Record<string, unknown>} */ (metaJson);
    }
    return root;
}

/** @param {unknown} metaJson */
export function readPlannerModeFromMeta(metaJson) {
    const root = decodeMetaRoot(metaJson);
    const nested =
        root.run_planner && typeof root.run_planner === 'object'
            ? /** @type {Record<string, unknown>} */ (root.run_planner)
            : root;
    const raw = String(nested.mode ?? nested.run_planner_mode ?? 'llm').trim().toLowerCase();
    return raw === 'stub' ? 'stub' : 'llm';
}

/** @param {unknown} metaJson @returns {Record<string, boolean>} */
export function readAllowedAgentsFromMeta(metaJson) {
    const root = decodeMetaRoot(metaJson);
    const raw = root.allowed_agents ?? root.chat_allowed_agents;
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const { id } of PLANNER_AGENT_CATALOG) {
        out[id] = true;
    }
    if (Array.isArray(raw)) {
        for (const { id } of PLANNER_AGENT_CATALOG) {
            out[id] = false;
        }
        for (const item of raw) {
            const k = String(item ?? '').trim();
            if (k && Object.prototype.hasOwnProperty.call(out, k)) {
                out[k] = true;
            }
        }
        return out;
    }
    if (raw && typeof raw === 'object') {
        const o = /** @type {Record<string, unknown>} */ (raw);
        for (const { id } of PLANNER_AGENT_CATALOG) {
            out[id] = Boolean(o[id]);
        }
    }
    return out;
}

/**
 * @param {(v: unknown) => string} escapeHtml
 * @param {(key: string, fallback?: string, vars?: Record<string, string>) => string} t
 */
export function plannerSettingsFormHtml(escapeHtml, t) {
    const legend = escapeHtml(t('settings.planner.mode_legend'));
    const intro = t('settings.planner.mode_intro');
    const llmLbl = escapeHtml(t('settings.planner.mode_llm'));
    const llmHint = t('settings.planner.mode_llm_hint');
    const stubLbl = escapeHtml(t('settings.planner.mode_stub'));
    const stubHint = t('settings.planner.mode_stub_hint');
    const agentsLegend = escapeHtml(t('settings.planner.agents_legend'));
    const agentsIntro = t('settings.planner.agents_intro');
    const saveLbl = escapeHtml(t('settings.planner.save'));

    let agentChecks = '';
    for (const { id, labelKey } of PLANNER_AGENT_CATALOG) {
        const lbl = escapeHtml(t(labelKey));
        agentChecks += `<label class="flex gap-2 items-center cursor-pointer select-none text-[0.875rem]">
  <input type="checkbox" name="allowed_agent" value="${escapeHtml(id)}" class="rounded border-[var(--grid-line)]" />
  <span class="fg-[var(--grid-ink)]">${lbl}</span>
</label>`;
    }

    return `<form id="oaao-planner-settings-form" class="grid gap-md max-w-[36rem]">
  <fieldset class="border-0 p-0 m-0 grid gap-sm">
    <legend class="text-[0.875rem] fw-semibold fg-[var(--grid-ink)] mb-0.5">${legend}</legend>
    <p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${intro}</p>
    <label class="flex gap-2 items-start cursor-pointer select-none text-[0.875rem]">
      <input type="radio" name="run_planner_mode" value="llm" class="mt-0.5 rounded-full border-[var(--grid-line)]" />
      <span class="min-w-0"><span class="fw-medium fg-[var(--grid-ink)]">${llmLbl}</span>
        <span class="block text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug mt-0.5">${llmHint}</span></span>
    </label>
    <label class="flex gap-2 items-start cursor-pointer select-none text-[0.875rem]">
      <input type="radio" name="run_planner_mode" value="stub" class="mt-0.5 rounded-full border-[var(--grid-line)]" />
      <span class="min-w-0"><span class="fw-medium fg-[var(--grid-ink)]">${stubLbl}</span>
        <span class="block text-[0.75rem] fg-[var(--grid-ink-muted)] leading-snug mt-0.5">${stubHint}</span></span>
    </label>
  </fieldset>
  <fieldset class="border-0 p-0 m-0 grid gap-sm mt-md">
    <legend class="text-[0.875rem] fw-semibold fg-[var(--grid-ink)] mb-0.5">${agentsLegend}</legend>
    <p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0">${agentsIntro}</p>
    <div class="grid gap-1.5">${agentChecks}</div>
  </fieldset>
  <div class="flex flex-wrap items-center gap-2">
    <button type="submit" class="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] fw-medium bg-[var(--grid-accent)] fg-white border-0 cursor-pointer hover:opacity-90">${saveLbl}</button>
    <p id="oaao-planner-settings-msg" class="text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem] m-0" role="status"></p>
  </div>
</form>`;
}

/**
 * @param {HTMLFormElement} form
 * @param {unknown} metaJson
 */
export function fillPlannerSettingsForm(form, metaJson) {
    const mode = readPlannerModeFromMeta(metaJson);
    const radios = form.querySelectorAll('input[name="run_planner_mode"]');
    for (const el of radios) {
        if (el instanceof HTMLInputElement) {
            el.checked = el.value === mode;
        }
    }
    const allowed = readAllowedAgentsFromMeta(metaJson);
    const boxes = form.querySelectorAll('input[name="allowed_agent"]');
    for (const el of boxes) {
        if (el instanceof HTMLInputElement) {
            el.checked = Boolean(allowed[el.value]);
        }
    }
}

/** @param {HTMLFormElement} form */
export function readAllowedAgentsMetaObject(form) {
    /** @type {Record<string, boolean>} */
    const map = {};
    for (const { id } of PLANNER_AGENT_CATALOG) {
        map[id] = false;
    }
    const boxes = form.querySelectorAll('input[name="allowed_agent"]:checked');
    for (const el of boxes) {
        if (el instanceof HTMLInputElement && el.value) {
            map[el.value] = true;
        }
    }
    return map;
}

/** @param {HTMLFormElement} form */
export function readPlannerSettingsMetaObject(form) {
    const picked = form.querySelector('input[name="run_planner_mode"]:checked');
    const mode =
        picked instanceof HTMLInputElement && picked.value === 'stub' ? 'stub' : 'llm';
    return {
        run_planner: { mode },
        allowed_agents: readAllowedAgentsMetaObject(form),
    };
}

/** @param {HTMLFormElement} form */
export function readPlannerSettingsMetaJson(form) {
    return JSON.stringify(readPlannerSettingsMetaObject(form));
}
