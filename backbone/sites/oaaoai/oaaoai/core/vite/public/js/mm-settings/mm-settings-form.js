/**
 * Admin Settings → Multimodal Python module ({@code mm_modules.json}) — no Purpose allocation.
 */

import { oaaoT } from '../oaao-i18n.js';

/** @param {unknown} v */
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @type {Record<'understand'|'generate'|'edit', Array<{id: string, label: string}>>} */
const FALLBACK_TASKS_BY_AXIS = {
    understand: [
        { id: 'x2t_image', label: 'Image → text' },
        { id: 'x2t_video', label: 'Video → text' },
    ],
    generate: [
        { id: 't2i', label: 'Text → image' },
        { id: 't2v', label: 'Text → video' },
    ],
    edit: [
        { id: 'image_edit', label: 'Image edit' },
        { id: 'video_edit', label: 'Video edit' },
    ],
};

/**
 * @param {'understand'|'generate'|'edit'} axis
 * @param {Array<Record<string, unknown>>} [mediaCapabilities]
 */
function tasksForAxis(axis, mediaCapabilities) {
    const list = Array.isArray(mediaCapabilities) ? mediaCapabilities : [];
    const filtered = list.filter((row) => String(row.mm_axis ?? '') === axis);
    if (filtered.length > 0) {
        return filtered.map((row) => ({
            id: String(row.task_id ?? ''),
            label: String(row.label ?? row.task_id ?? ''),
        }));
    }
    return FALLBACK_TASKS_BY_AXIS[axis];
}

/**
 * @param {(s: string) => string} esc
 * @param {Array<Record<string, unknown>>} [modules]
 * @param {string} selected
 */
function pythonModuleOptionsHtml(esc, modules, selected) {
    const list =
        Array.isArray(modules) && modules.length > 0
            ? modules
            : [{ module_id: 'mm_lance', label: 'Lance' }];
    const sel = selected === 'lance' ? 'mm_lance' : selected;
    return list
        .map((row) => {
            const id = String(row.module_id ?? '');
            if (!id) return '';
            const labelKey = String(row.i18n_label_key ?? '');
            const label = labelKey ? oaaoT(labelKey, String(row.label ?? id)) : String(row.label ?? id);
            return `<option value="${esc(id)}"${id === sel ? ' selected' : ''}>${esc(label)}</option>`;
        })
        .join('');
}

/**
 * @param {string} moduleId
 * @param {Array<Record<string, unknown>>} [modules]
 */
function moduleRegistryRow(moduleId, modules) {
    const list = Array.isArray(modules) ? modules : [];
    const id = moduleId === 'lance' ? 'mm_lance' : moduleId;
    return list.find((row) => String(row.module_id ?? '') === id) ?? null;
}

/**
 * @param {HTMLFormElement} form
 * @returns {Record<string, string>}
 */
export function readModuleConfigFromForm(form) {
    const hidden = form.querySelector('input[name="module_config_json"]');
    if (!(hidden instanceof HTMLInputElement)) return {};
    try {
        const parsed = JSON.parse(hidden.value || '{}');
        if (!parsed || typeof parsed !== 'object') return {};
        /** @type {Record<string, string>} */
        const out = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string' && v.trim()) out[k] = v.trim();
        }
        return out;
    } catch {
        return {};
    }
}

/**
 * @param {HTMLFormElement} form
 * @param {Record<string, string>} moduleConfig
 */
export function writeModuleConfigToForm(form, moduleConfig) {
    const hidden = form.querySelector('input[name="module_config_json"]');
    if (!(hidden instanceof HTMLInputElement)) return;
    const clean = {};
    for (const [k, v] of Object.entries(moduleConfig)) {
        if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
    }
    hidden.value = JSON.stringify(clean);
    syncMmModuleConfigButton(form);
}

/**
 * @param {HTMLFormElement} form
 * @param {Array<Record<string, unknown>>} [modules]
 */
export function syncMmModuleConfigButton(form, modules = []) {
    const modEl = form.querySelector('select[name="python_module"]');
    const btn = form.querySelector('#oaao-mm-module-config-btn');
    const status = form.querySelector('#oaao-mm-module-config-status');
    if (!(modEl instanceof HTMLSelectElement) || !(btn instanceof HTMLButtonElement)) return;

    const row = moduleRegistryRow(modEl.value, modules);
    const fields = Array.isArray(row?.config_fields) ? row.config_fields : [];
    const hasConfig = fields.length > 0;
    btn.hidden = !hasConfig;
    btn.disabled = !hasConfig;

    if (status instanceof HTMLElement) {
        const cfg = readModuleConfigFromForm(form);
        const bu = String(cfg.base_url ?? '').trim();
        if (bu) {
            status.textContent = oaaoT('settings.mm.config.configured', 'Worker URL set — applies on next chat (no restart).');
            status.classList.remove('fg-[var(--grid-ink-muted)]');
            status.classList.add('fg-[var(--grid-success,#15803d)]');
        } else {
            status.textContent = oaaoT(
                'settings.mm.config.not_configured',
                'No worker URL — set Config or rely on orchestrator env fallback.',
            );
            status.classList.remove('fg-[var(--grid-success,#15803d)]');
            status.classList.add('fg-[var(--grid-ink-muted)]');
        }
    }
}

/**
 * @param {(s: string) => string} esc
 * @param {'understand'|'generate'|'edit'} axis
 * @param {string} defaultTask
 * @param {Array<Record<string, unknown>>} [mediaCapabilities]
 */
function axisTaskFieldHtml(esc, axis, defaultTask, mediaCapabilities) {
    const tasks = tasksForAxis(axis, mediaCapabilities);
    const taskId = defaultTask || tasks[0]?.id || '';
    const taskOpts = tasks
        .map((t) => `<option value="${esc(t.id)}"${t.id === taskId ? ' selected' : ''}>${esc(t.label)}</option>`)
        .join('');
    const title = esc(oaaoT(`settings.mm.section_${axis}`, axis));
    return `
<fieldset class="grid gap-sm min-w-0 max-w-xl border border-[var(--grid-line)] rounded-lg p-md" data-mm-axis="${esc(axis)}">
  <legend class="text-[0.875rem] fw-semibold fg-[var(--grid-ink)] px-1">${title}</legend>
  <label class="flex flex-col gap-0.5 text-[0.8125rem]">
    <span class="fw-medium">${esc(oaaoT('settings.mm.default_task', 'Default task'))}</span>
    <select name="default_task" class="rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-paper)]">${taskOpts}</select>
  </label>
</fieldset>`;
}

/**
 * @param {(s: string) => string} esc
 * @param {{ modules?: Array<Record<string, unknown>>, mediaCapabilities?: Array<Record<string, unknown>> }} [registry]
 */
export function mmSettingsFormHtml(esc, registry = {}) {
    const modules = registry.modules ?? [];
    return `<form id="oaao-mm-settings-form" class="grid gap-lg min-w-0">
  <p class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0 max-w-[40rem]">${esc(oaaoT('settings.mm.intro'))}</p>
  <div class="flex flex-col gap-1 max-w-xl min-w-0">
    <span class="text-[0.8125rem] fw-semibold fg-[var(--grid-ink)]">${esc(oaaoT('settings.mm.python_module', 'Python module'))}</span>
    <div class="flex flex-row flex-wrap items-center gap-2 min-w-0">
      <select name="python_module" class="flex-1 min-w-[12rem] rounded border border-[var(--grid-line)] px-2 py-1.5 text-[0.8125rem] font-inherit bg-[var(--grid-paper)]">${pythonModuleOptionsHtml(esc, modules, 'mm_lance')}</select>
      <button type="button" id="oaao-mm-module-config-btn" class="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-paper)] border border-[var(--grid-line)] cursor-pointer font-inherit shrink-0">${esc(oaaoT('settings.mm.config.button', 'Config'))}</button>
    </div>
    <input type="hidden" name="module_config_json" value="{}" />
    <p id="oaao-mm-module-config-status" class="text-[0.75rem] fg-[var(--grid-ink-muted)] m-0 min-h-[1rem]" role="status"></p>
    <span class="text-[0.75rem] fg-[var(--grid-ink-muted)]">${esc(oaaoT('settings.mm.module_hint', 'One module handles all multimodal tasks for now.'))}</span>
  </div>
  ${axisTaskFieldHtml(esc, 'understand', 'x2t_image', registry.mediaCapabilities)}
  ${axisTaskFieldHtml(esc, 'generate', 't2i', registry.mediaCapabilities)}
  ${axisTaskFieldHtml(esc, 'edit', 'image_edit', registry.mediaCapabilities)}
  <div class="flex flex-wrap items-center gap-2">
    <button type="submit" class="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] fw-semibold bg-[var(--grid-accent,#2563eb)] fg-white border-0 cursor-pointer font-inherit">${esc(oaaoT('settings.mm.save', 'Save'))}</button>
  </div>
  <p id="oaao-mm-settings-msg" class="text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem]" role="status"></p>
</form>`;
}

/**
 * @param {HTMLFormElement} form
 * @param {Record<string, unknown>} config
 * @param {{ modules?: Array<Record<string, unknown>>, mediaCapabilities?: Array<Record<string, unknown>> }} [registry]
 */
export function fillMmSettingsForm(form, config, registry = {}) {
    let moduleId = String(config.python_module ?? 'mm_lance');
    if (moduleId === 'lance') moduleId = 'mm_lance';
    const modEl = form.querySelector('select[name="python_module"]');
    if (modEl instanceof HTMLSelectElement) {
        if (![...modEl.options].some((o) => o.value === moduleId)) {
            const opt = document.createElement('option');
            opt.value = moduleId;
            opt.textContent = moduleId;
            modEl.append(opt);
        }
        modEl.value = moduleId;
    }

    const rawModuleConfig =
        config.module_config && typeof config.module_config === 'object'
            ? /** @type {Record<string, unknown>} */ (config.module_config)
            : {};
    /** @type {Record<string, string>} */
    const moduleConfig = {};
    const bu = String(rawModuleConfig.base_url ?? '').trim();
    if (bu) moduleConfig.base_url = bu;
    writeModuleConfigToForm(form, moduleConfig);

    const axes = config.axes && typeof config.axes === 'object' ? /** @type {Record<string, unknown>} */ (config.axes) : {};
    for (const axis of /** @type {const} */ (['understand', 'generate', 'edit'])) {
        const fieldset = form.querySelector(`fieldset[data-mm-axis="${axis}"]`);
        if (!(fieldset instanceof HTMLFieldSetElement)) continue;
        const axisRow = axes[axis];
        const task =
            axisRow && typeof axisRow === 'object'
                ? String(/** @type {Record<string, unknown>} */ (axisRow).default_task ?? '')
                : '';
        const tasks = tasksForAxis(axis, registry.mediaCapabilities);
        const taskId = task || tasks[0]?.id || '';
        const taskEl = fieldset.querySelector('select[name="default_task"]');
        if (taskEl instanceof HTMLSelectElement) {
            if (![...taskEl.options].some((o) => o.value === taskId) && taskId) {
                const opt = document.createElement('option');
                opt.value = taskId;
                opt.textContent = taskId;
                taskEl.append(opt);
            }
            taskEl.value = taskId;
        }
    }

    syncMmModuleConfigButton(form, registry.modules ?? []);
}

/**
 * @param {HTMLFormElement} form
 * @returns {{ python_module: string, module_config: Record<string, string>, axes: Record<'understand'|'generate'|'edit', { default_task: string }> }}
 */
export function readMmSettingsConfig(form) {
    const modEl = form.querySelector('select[name="python_module"]');
    const python_module = modEl instanceof HTMLSelectElement ? modEl.value : 'mm_lance';
    const module_config = readModuleConfigFromForm(form);
    /** @type {Record<'understand'|'generate'|'edit', { default_task: string }>} */
    const axes = { understand: { default_task: 'x2t_image' }, generate: { default_task: 't2i' }, edit: { default_task: 'image_edit' } };
    for (const axis of /** @type {const} */ (['understand', 'generate', 'edit'])) {
        const fieldset = form.querySelector(`fieldset[data-mm-axis="${axis}"]`);
        if (!(fieldset instanceof HTMLFieldSetElement)) continue;
        const taskEl = fieldset.querySelector('select[name="default_task"]');
        if (taskEl instanceof HTMLSelectElement) {
            axes[axis] = { default_task: taskEl.value };
        }
    }
    return { python_module, module_config, axes };
}

/**
 * @param {HTMLFormElement} form
 * @param {(form: HTMLFormElement, msgEl: HTMLElement|null) => void | Promise<void>} onSave
 */
export function wireMmSettingsForm(form, onSave) {
    form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const msgEl = form.querySelector('#oaao-mm-settings-msg');
        void onSave(form, msgEl instanceof HTMLElement ? msgEl : null);
    });
}

/**
 * @param {HTMLFormElement} form
 * @param {{ modules?: Array<Record<string, unknown>>, envHints?: Record<string, string>, Dialog?: new (opts: Record<string, unknown>) => unknown, JIT?: { hydrate?: (el: HTMLElement) => void } }} ctx
 * @param {(form: HTMLFormElement) => void | Promise<void>} [onConfigSaved]
 */
export function wireMmModuleConfigButton(form, ctx, onConfigSaved) {
    const modules = ctx.modules ?? [];
    const modEl = form.querySelector('select[name="python_module"]');
    if (modEl instanceof HTMLSelectElement) {
        modEl.addEventListener('change', () => syncMmModuleConfigButton(form, modules));
    }

    const btn = form.querySelector('#oaao-mm-module-config-btn');
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.addEventListener('click', () => {
        void openMmModuleConfigDialog(form, ctx, onConfigSaved);
    });
    syncMmModuleConfigButton(form, modules);
}

/**
 * @param {HTMLFormElement} form
 * @param {{ modules?: Array<Record<string, unknown>>, envHints?: Record<string, string>, Dialog?: new (opts: Record<string, unknown>) => unknown, JIT?: { hydrate?: (el: HTMLElement) => void } }} ctx
 * @param {(form: HTMLFormElement) => void | Promise<void>} [onConfigSaved]
 */
async function openMmModuleConfigDialog(form, ctx, onConfigSaved) {
    const Dialog = ctx.Dialog;
    if (typeof Dialog !== 'function') {
        window.alert(oaaoT('settings.errors.dialog_unavailable', 'Dialog unavailable.'));
        return;
    }

    const modEl = form.querySelector('select[name="python_module"]');
    const moduleId = modEl instanceof HTMLSelectElement ? modEl.value : 'mm_lance';
    const row = moduleRegistryRow(moduleId, ctx.modules ?? []);
    const fields = Array.isArray(row?.config_fields) ? row.config_fields : [];
    if (fields.length === 0) return;

    const current = readModuleConfigFromForm(form);
    const envHints = ctx.envHints && typeof ctx.envHints === 'object' ? ctx.envHints : {};

    const wrap = document.createElement('div');
    wrap.className = 'grid gap-md min-w-0 max-w-full';
    const desc = document.createElement('p');
    desc.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0 leading-snug';
    const descKey = String(row?.i18n_desc_key ?? '');
    desc.textContent = descKey ? oaaoT(descKey, String(row?.description ?? '')) : String(row?.description ?? '');
    wrap.append(desc);

    const innerForm = document.createElement('form');
    innerForm.className = 'grid gap-sm min-w-0';
    innerForm.id = 'oaao-mm-module-config-dlg-form';
    innerForm.noValidate = true;

    for (const field of fields) {
        const key = String(field.key ?? '');
        if (!key) continue;
        const labelKey = String(field.label_key ?? '');
        const label = labelKey ? oaaoT(labelKey, key) : key;
        const placeholder = String(field.placeholder ?? '');
        const hintKey = String(field.hint_key ?? '');
        const envFallback = String(field.env_fallback ?? '');
        const envVal = envFallback ? String(envHints[envFallback] ?? '').trim() : '';

        const lab = document.createElement('label');
        lab.className = 'flex flex-col gap-0.5 text-[0.8125rem] min-w-0';
        const span = document.createElement('span');
        span.className = 'fw-medium';
        span.textContent = label;
        const input = document.createElement('input');
        input.name = key;
        input.type = key === 'base_url' ? 'url' : 'text';
        input.className =
            'rounded border border-[var(--grid-line)] px-2 py-1.5 font-inherit bg-[var(--grid-paper)] font-mono text-xs';
        input.placeholder = placeholder;
        input.value = String(current[key] ?? '');
        lab.append(span, input);
        if (hintKey) {
            const hint = document.createElement('span');
            hint.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)]';
            hint.textContent = oaaoT(hintKey, '');
            lab.append(hint);
        }
        if (envVal) {
            const envHint = document.createElement('span');
            envHint.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)] font-mono';
            envHint.textContent = oaaoT('settings.mm.config.env_fallback', 'Orchestrator env fallback: {{url}}', {
                url: envVal,
            });
            lab.append(envHint);
        }
        innerForm.append(lab);
    }

    const msg = document.createElement('p');
    msg.className = 'text-[0.8125rem] fg-[var(--grid-caution,#b45309)] min-h-[1.25rem] m-0';
    msg.setAttribute('role', 'status');
    innerForm.append(msg);
    wrap.append(innerForm);

    const labelKey = String(row?.i18n_label_key ?? '');
    const moduleLabel = labelKey ? oaaoT(labelKey, String(row?.label ?? moduleId)) : String(row?.label ?? moduleId);

    new Dialog({
        title: oaaoT('settings.mm.config.dialog_title', '{{module}} configuration', { module: moduleLabel }),
        content: wrap,
        size: 'md',
        closable: true,
        buttons: [
            { text: oaaoT('settings.mm.config.cancel', 'Cancel'), color: 'muted', role: 'cancel' },
            {
                text: oaaoT('settings.mm.config.save', 'Save & apply'),
                color: 'accent',
                action: async () => {
                    if (!innerForm.reportValidity()) return false;
                    const fd = new FormData(innerForm);
                    /** @type {Record<string, string>} */
                    const next = { ...current };
                    for (const field of fields) {
                        const key = String(field.key ?? '');
                        if (!key) continue;
                        const val = String(fd.get(key) ?? '').trim();
                        if (val) next[key] = val;
                        else delete next[key];
                    }
                    writeModuleConfigToForm(form, next);
                    syncMmModuleConfigButton(form, ctx.modules ?? []);
                    if (typeof onConfigSaved === 'function') {
                        msg.textContent = oaaoT('settings.mm.saving', 'Saving…');
                        try {
                            await onConfigSaved(form);
                            msg.textContent = '';
                        } catch (e) {
                            msg.textContent =
                                e instanceof Error ? e.message : oaaoT('settings.mm.save_failed', 'Save failed.');
                            return false;
                        }
                    }
                    return undefined;
                },
            },
        ],
        onOpen: (ctrl) => {
            try {
                ctx.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
            } catch {
                /* ignore */
            }
            const first = innerForm.querySelector('input');
            if (first instanceof HTMLInputElement) first.focus();
        },
    });
}

export { escapeHtml };
