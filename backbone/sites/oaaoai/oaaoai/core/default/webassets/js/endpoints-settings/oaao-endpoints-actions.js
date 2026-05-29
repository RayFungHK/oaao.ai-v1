/**
 * Endpoints settings — actions, dialogs, delegation, lifecycle (panel entry re-exports mount/teardown).
 *
 * Relatives from {@code …/js/endpoints-settings/} — no import map (embedded browsers / dynamic {@code import()}).
 */

import { resolveShellRegistryUrl } from '../shell-registry-url.js';
import { oaaoCoreWebasset } from '@oaao/core-js/oaao-core-esm-url.js';
import {
    deletePurposesChatProfile,
    openPurposesChatProfileEditor,
    patchPurposesChatProfileDefault,
} from '../../../../chat/default/js/chat-settings-panel.js';
import { oaaoT } from '../oaao-i18n.js';
import { oaaoRazyToastFire } from '../oaao-razy-toast.js';
import { oaaoMountLoadingLogo } from '../oaao-loading-logo.js';
import { replaceChildrenParsed, ruiBuild } from '../oaao-jit-dsl.js';
import { endpointsApiUrl, chatApiUrl, endpointsFetchJson } from './api.js';
import { rt } from './runtime.js';
import { purposeKeyToEndpointFilterPrefix } from './purpose-key-prefix.js';
import {
    escapeHtml,
    endpointEditorFormHtml,
    endpointOptionHtml,
    readPanelMode,
    readPurposeAllocationSlots,
    render,
    writePanelMode,
} from './endpoints-settings-view.js';

const razyui = (await import(oaaoCoreWebasset('razyui/razyui.js'))).default;

async function ensureComboboxRegistered() {
    if (!rt.comboboxModulePromise) {
        const href = resolveShellRegistryUrl('/webassets/core/default/razyui/component/Combobox.js');
        rt.comboboxModulePromise = import(/* webpackIgnore: true */ href);
    }
    const mod = await rt.comboboxModulePromise;
    if (!rt.comboboxCustomElementRegistered && typeof mod.registerElement === 'function') {
        await mod.registerElement();
        rt.comboboxCustomElementRegistered = true;
    }
    return mod.default;
}

/** @param {HTMLFormElement} form */
function syncEndpointBaseUrlFieldForAsrLive(form) {
    const types = readEndpointTypesFromForm(form);
    const live = types.split(',').some((t) => t.trim() === 'asr.live');
    const label = form.querySelector('[data-oaao-ep-base-url-label]');
    const hint = form.querySelector('[data-oaao-ep-base-url-hint]');
    const input = form.elements.namedItem('base_url');
    if (label instanceof HTMLElement) {
        label.textContent = oaaoT(live ? 'settings.ep.form.ws_url' : 'settings.ep.form.base_url');
    }
    if (hint instanceof HTMLElement) {
        const hintText = live ? oaaoT('settings.ep.form.ws_url_asr_live_hint') : '';
        hint.textContent = hintText;
        hint.classList.toggle('hidden', !hintText);
    }
    if (input instanceof HTMLInputElement) {
        input.placeholder = live ? 'wss://funasr-nano-ws.example.com' : 'https://…';
    }
}

/**
 * @param {HTMLFormElement} form
 * @returns {string} comma-separated purpose prefixes (stable sort)
 */
function readEndpointTypesFromForm(form) {
    const el = form.elements.namedItem('endpoint_type');
    if (el instanceof HTMLSelectElement && el.multiple) {
        const s = Array.from(el.selectedOptions)
            .map((o) => String(o.value).trim())
            .filter(Boolean)
            .sort()
            .join(',');
        return s || 'chat';
    }
    if (el instanceof HTMLSelectElement) {
        const v = String(el.value || '').trim();
        return v || 'chat';
    }
    return 'chat';
}

/**
 * @param {HTMLSelectElement} sel
 * @returns {string[]}
 */
function readSelectedEndpointTypesFromSelect(sel) {
    if (!(sel instanceof HTMLSelectElement)) return ['chat'];
    if (sel.multiple) {
        const fromDom = Array.from(sel.selectedOptions)
            .map((o) => String(o.value).trim())
            .filter(Boolean);
        if (fromDom.length) return fromDom;
    } else {
        const v = String(sel.value || '').trim();
        if (v) return [v];
    }
    const fromDefault = String(sel.dataset.default ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return fromDefault.length ? fromDefault : ['chat'];
}

/**
 * @param {HTMLFormElement} form
 * @param {Record<string, unknown>|null|undefined} row
 */
function applyEndpointTypeToSelect(form, row) {
    const typeEl = form.elements.namedItem('endpoint_type');
    if (!(typeEl instanceof HTMLSelectElement)) return;

    const raw = String(row?.endpoint_type ?? 'chat');
    const parts = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const selected = parts.length > 0 ? parts : ['chat'];

    if (typeEl.multiple) {
        for (let i = 0; i < typeEl.options.length; i++) {
            typeEl.options[i].selected = selected.includes(typeEl.options[i].value);
        }
    } else {
        typeEl.value = selected[0] ?? 'chat';
    }
    typeEl.dataset.default = selected.join(',');
}

/**
 * @param {HTMLFormElement} form
 */
/**
 * Progressive-enhance the native multi-select once. Do **not** wrap with {@code <rui-combobox>} here — CE upgrade +
 * manual {@code new Combobox(host)} would insert two {@code .combobox-container} rows.
 *
 * @returns {Promise<{ setValue?: (v: string|string[]) => void, setChecked?: (m: Record<string, boolean>) => void }|null>}
 */
async function mountEndpointTypeCombobox(form) {
    const wrap = form.querySelector('[data-oaao-ep-endpoint-type]');
    const sel = form.querySelector('select[name="endpoint_type"]');
    if (!(wrap instanceof HTMLElement) || !(sel instanceof HTMLSelectElement) || !sel.multiple) return null;
    if (wrap.dataset.oaaoComboboxMounted === '1') return null;

    const initial = readSelectedEndpointTypesFromSelect(sel);
    sel.dataset.default = initial.join(',');

    try {
        const ComboboxCls = await ensureComboboxRegistered();
        if (typeof ComboboxCls !== 'function') return null;

        /** @type {{ setValue?: (v: string|string[]) => void, setChecked?: (m: Record<string, boolean>) => void } | null} */
        const instance = new ComboboxCls(sel, {
            placeholder: oaaoT('settings.endpoints.type_combobox_placeholder'),
            checkbox: true,
        });
        wrap.dataset.oaaoComboboxMounted = '1';

        for (let i = 0; i < sel.options.length; i++) {
            sel.options[i].selected = initial.includes(sel.options[i].value);
        }

        if (instance && typeof instance.setValue === 'function') {
            instance.setValue(initial);
        }
        if (instance && typeof instance.setChecked === 'function') {
            /** @type {Record<string, boolean>} */
            const checked = {};
            for (let i = 0; i < sel.options.length; i++) {
                const v = sel.options[i].value;
                checked[v] = initial.includes(v);
            }
            instance.setChecked(checked);
        }

        return instance ?? null;
    } catch (e) {
        console.warn('[oaao] endpoints: Combobox init failed', e);
        return null;
    }
}

function closeNestedDialogs() {
    while (rt.nestedDialogControls.length) {
        const c = rt.nestedDialogControls.pop();
        try {
            c.close();
        } catch {
            /* ignore */
        }
    }
}

/** @param {unknown} instance */
function trackDialog(instance) {
    const inst = /** @type {{ getControl?: () => { close?: () => void } }} */ (instance);
    const ctrl = typeof inst?.getControl === 'function' ? inst.getControl() : null;
    if (ctrl && typeof ctrl.close === 'function') rt.nestedDialogControls.push(ctrl);
}

function hasDialog() {
    return typeof rt.mountCtx?.Dialog === 'function';
}

/**
 * @param {string} title
 * @param {string} htmlBody trusted / escaped HTML fragment
 */
async function confirmDestructive(title, htmlBody) {
    const D = rt.mountCtx?.Dialog;
    if (D && typeof D.confirm === 'function') {
        return D.confirm(title, htmlBody);
    }
    const strip = htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return window.confirm(strip || title);
}

async function reload(host) {
    const mode = readPanelMode(host);
    if (mode === 'endpoints') {
        const [er, ur] = await Promise.all([
            endpointsFetchJson(endpointsApiUrl('endpoints_list')),
            endpointsFetchJson(endpointsApiUrl('endpoints_usage_stats')),
        ]);
        if (!er.res.ok || !er.data?.success) {
            throw new Error(typeof er.data?.message === 'string' ? er.data.message : oaaoT('settings.errors.load_endpoints'));
        }
        rt.state.endpoints = Array.isArray(er.data.endpoints) ? er.data.endpoints : [];
        rt.state.endpointUsageStats = {};
        if (ur.res.ok && ur.data?.success && ur.data.stats && typeof ur.data.stats === 'object') {
            rt.state.endpointUsageStats = /** @type {Record<string, unknown>} */ (ur.data.stats);
        }
    } else {
        const [er, pr, cr] = await Promise.all([
            endpointsFetchJson(endpointsApiUrl('endpoints_list')),
            endpointsFetchJson(endpointsApiUrl('purposes_list')),
            endpointsFetchJson(chatApiUrl('chat_endpoints_list')),
        ]);
        if (!er.res.ok || !er.data?.success) {
            throw new Error(typeof er.data?.message === 'string' ? er.data.message : oaaoT('settings.errors.load_endpoints'));
        }
        if (!pr.res.ok || !pr.data?.success) {
            throw new Error(typeof pr.data?.message === 'string' ? pr.data.message : oaaoT('settings.errors.load_purposes'));
        }
        rt.state.endpoints = Array.isArray(er.data.endpoints) ? er.data.endpoints : [];
        rt.state.purposes = Array.isArray(pr.data.purposes) ? pr.data.purposes : [];
        rt.state.purposesPostgresqlOnly = pr.data.purposes_postgresql_only === true;
        rt.state.chatProfiles =
            cr.res.ok && cr.data?.success && Array.isArray(cr.data.profiles) ? cr.data.profiles : [];
    }
    render(host);
    rt.mountCtx?.JIT?.hydrate?.(host);
}

/** @param {HTMLFormElement} form @param {Record<string, unknown>|null} row */
function fillEndpointForm(form, row) {
    const set = (name, v) => {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            el.value = v ?? '';
        }
    };
    const hid = form.querySelector('input[name="id"]');
    const cb = form.elements.namedItem('is_enabled');

    if (!row) {
        if (hid instanceof HTMLInputElement) hid.value = '';
        form.reset();
        if (cb instanceof HTMLInputElement) cb.checked = true;
        applyEndpointTypeToSelect(form, { endpoint_type: 'chat' });
        return;
    }

    if (hid instanceof HTMLInputElement) hid.value = String(row.id ?? '');
    set('name', String(row.name ?? ''));
    applyEndpointTypeToSelect(form, row);
    set('base_url', String(row.base_url ?? ''));
    set('model', String(row.model ?? ''));
    set('api_key_ref', String(row.api_key_ref ?? ''));
    if (cb instanceof HTMLInputElement) cb.checked = Number(row.is_enabled) === 1;
    set('config_json', String(row.config_json ?? ''));
}

/** @param {HTMLFormElement} form @param {Record<string, unknown>|null} row @param {string} [suggestedPurposeKey] */
function fillPurposeForm(form, row, suggestedPurposeKey) {
    const set = (name, v) => {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = v ?? '';
        if (el instanceof HTMLSelectElement) el.value = v ?? '';
    };
    const hid = form.querySelector('input[name="id"]');
    if (hid instanceof HTMLInputElement) hid.value = '';
    form.reset();
    const so = form.elements.namedItem('sort_order');
    if (so instanceof HTMLInputElement) so.value = '500';
    const cb = form.elements.namedItem('is_enabled');
    if (cb instanceof HTMLInputElement) cb.checked = true;
    if (!row) {
        const pk = form.elements.namedItem('purpose_key');
        if (pk instanceof HTMLInputElement && suggestedPurposeKey) {
            pk.value = suggestedPurposeKey;
        }
        return;
    }
    if (hid instanceof HTMLInputElement) hid.value = String(row.id ?? '');
    set('purpose_key', String(row.purpose_key ?? ''));
    set('label', String(row.label ?? ''));
    set('description', String(row.description ?? ''));
    const dep = row.default_endpoint_id != null && row.default_endpoint_id !== '' ? String(row.default_endpoint_id) : '';
    set('default_endpoint_id', dep);
    if (cb instanceof HTMLInputElement) cb.checked = Number(row.is_enabled) === 1;
    set('sort_order', String(row.sort_order ?? '500'));
    set('meta_json', String(row.meta_json ?? ''));
}

/** @returns {Promise<typeof import('./purpose-editor-form.js')>} */
async function loadPurposeEditorFormModule() {
    const v = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
    const url = new URL('./purpose-editor-form.js', import.meta.url);
    if (v) url.searchParams.set('v', v);
    return import(/* webpackIgnore: true */ url.href);
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>|null} row
 */
async function openEndpointEditor(host, row) {
    if (!hasDialog()) {
        window.alert(oaaoT('settings.errors.dialog_unavailable'));
        return;
    }
    const Dialog = /** @type {new (o: Record<string, unknown>) => { getControl: () => { close: () => void } }} */ (rt.mountCtx.Dialog);
    const wrap = document.createElement('div');
    wrap.className = '[padding:0]';
    replaceChildrenParsed(wrap, endpointEditorFormHtml(row ? String(row.endpoint_type ?? 'chat') : 'chat'));
    const form = wrap.querySelector('#oaao-ep-dlg-form');
    const msgEl = wrap.querySelector('#oaao-ep-dlg-msg');
    if (!(form instanceof HTMLFormElement)) return;
    fillEndpointForm(form, row);
    await mountEndpointTypeCombobox(form);
    syncEndpointBaseUrlFieldForAsrLive(form);
    const typeSel = form.querySelector('select[name="endpoint_type"]');
    if (typeSel instanceof HTMLSelectElement) {
        typeSel.addEventListener('change', () => syncEndpointBaseUrlFieldForAsrLive(form));
    }

    const dlg = new Dialog({
        title: row ? oaaoT('settings.endpoints.dialog.edit_title') : oaaoT('settings.endpoints.dialog.add_title'),
        content: wrap,
        size: 'lg',
        closable: true,
        buttons: [
            { text: oaaoT('settings.endpoints.dialog.cancel'), color: 'muted', role: 'cancel' },
            {
                text: oaaoT('settings.endpoints.dialog.save'),
                color: 'accent',
                action: async () => {
                    const fd = new FormData(form);
                    const idStr = String(fd.get('id') || '').trim();
                    const payload = {
                        ...(idStr ? { id: parseInt(idStr, 10) } : {}),
                        name: String(fd.get('name') || '').trim(),
                        endpoint_type: readEndpointTypesFromForm(form),
                        base_url: String(fd.get('base_url') || '').trim(),
                        model: String(fd.get('model') || '').trim(),
                        api_key_ref: String(fd.get('api_key_ref') || '').trim(),
                        is_enabled: fd.get('is_enabled') === 'on',
                        config_json: String(fd.get('config_json') || '').trim(),
                    };
                    if (msgEl) msgEl.textContent = oaaoT('settings.endpoints.dialog.saving');
                    const { res, data } = await endpointsFetchJson(endpointsApiUrl('endpoints_save'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!res.ok || !data?.success) {
                        if (msgEl) {
                            msgEl.textContent =
                                typeof data?.message === 'string'
                                    ? data.message
                                    : oaaoT('settings.endpoints.dialog.save_failed', '', { status: String(res.status) });
                        }
                        return false;
                    }
                    try {
                        await reload(host);
                    } catch (e) {
                        if (msgEl) msgEl.textContent = e instanceof Error ? e.message : oaaoT('settings.endpoints.dialog.reload_failed');
                        return false;
                    }
                    return undefined;
                },
            },
        ],
        onOpen: (ctrl) => {
            rt.mountCtx?.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
        },
    });
    trackDialog(dlg);
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>|null} row
 * @param {{ suggestedPurposeKey?: string }} [opts]
 */
function openPurposeEditor(host, row, opts) {
    if (rt.state.purposesPostgresqlOnly) return;
    if (!hasDialog()) {
        window.alert(oaaoT('settings.errors.dialog_unavailable'));
        return;
    }
    void openPurposeEditorAsync(host, row, opts);
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>|null} row
 * @param {{ suggestedPurposeKey?: string }} [opts]
 */
async function openPurposeEditorAsync(host, row, opts) {
    const suggestedPurposeKey =
        opts && typeof opts.suggestedPurposeKey === 'string' ? opts.suggestedPurposeKey : '';
    const pk = row ? String(row.purpose_key || '').trim() : '';
    const filterPfx =
        purposeKeyToEndpointFilterPrefix(pk) || purposeKeyToEndpointFilterPrefix(suggestedPurposeKey);
    const formMod = await loadPurposeEditorFormModule();
    const hideMetaJson =
        filterPfx === 'asr' ||
        formMod.isAsrRoutingPurposeKey(pk || suggestedPurposeKey);
    const forceEpIdRaw = row?.default_endpoint_id;
    const forceEpId =
        forceEpIdRaw != null && forceEpIdRaw !== '' ? Number(forceEpIdRaw) : Number.NaN;
    const Dialog = /** @type {new (o: Record<string, unknown>) => { getControl: () => { close: () => void } }} */ (rt.mountCtx.Dialog);
    const epOpts = endpointOptionHtml(filterPfx, forceEpId);
    const wrap = document.createElement('div');
    wrap.className = '[padding:0]';
    replaceChildrenParsed(wrap, formMod.purposeEditorFormHtml(epOpts, { hideMetaJson }, escapeHtml));
    const form = wrap.querySelector('#oaao-pu-dlg-form');
    const msgEl = wrap.querySelector('#oaao-pu-dlg-msg');
    if (!(form instanceof HTMLFormElement)) return;
    fillPurposeForm(form, row, suggestedPurposeKey);

    const dlg = new Dialog({
        title: row ? oaaoT('settings.purpose.dialog.edit_title') : oaaoT('settings.purpose.dialog.add_title'),
        content: wrap,
        size: 'lg',
        closable: true,
        buttons: [
            { text: oaaoT('settings.purpose.dialog.cancel'), color: 'muted', role: 'cancel' },
            {
                text: oaaoT('settings.purpose.dialog.save'),
                color: 'accent',
                action: async () => {
                    const fd = new FormData(form);
                    const idStr = String(fd.get('id') || '').trim();
                    const dep = String(fd.get('default_endpoint_id') || '').trim();
                    const purposeKey = String(fd.get('purpose_key') || '').trim();
                    let metaJson = String(fd.get('meta_json') || '').trim();
                    if (formMod.isAsrRoutingPurposeKey(purposeKey)) {
                        const ex = rt.state.purposes.find((r) => String(r.purpose_key ?? '') === purposeKey);
                        metaJson = String(ex?.meta_json ?? metaJson);
                    }
                    const payload = {
                        ...(idStr ? { id: parseInt(idStr, 10) } : {}),
                        purpose_key: purposeKey,
                        label: String(fd.get('label') || '').trim(),
                        description: String(fd.get('description') || '').trim(),
                        ...(dep ? { default_endpoint_id: parseInt(dep, 10) } : { default_endpoint_id: null }),
                        is_enabled: fd.get('is_enabled') === 'on',
                        sort_order: parseInt(String(fd.get('sort_order') || '500'), 10),
                        meta_json: metaJson,
                    };
                    if (msgEl) msgEl.textContent = oaaoT('settings.purpose.dialog.saving');
                    const { res, data } = await endpointsFetchJson(endpointsApiUrl('purposes_save'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!res.ok || !data?.success) {
                        if (msgEl) {
                            msgEl.textContent =
                                typeof data?.message === 'string'
                                    ? data.message
                                    : oaaoT('settings.purpose.dialog.save_failed', '', { status: String(res.status) });
                        }
                        return false;
                    }
                    try {
                        await reload(host);
                    } catch (e) {
                        if (msgEl) msgEl.textContent = e instanceof Error ? e.message : oaaoT('settings.purpose.dialog.reload_failed');
                        return false;
                    }
                    oaaoRazyToastFire(oaaoT('settings.purpose.saved'), 'success');
                    return undefined;
                },
            },
        ],
        onOpen: (ctrl) => {
            rt.mountCtx?.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
        },
    });
    trackDialog(dlg);
}

/** One delegated listener per panel host — survives {@code render()} DOM swaps via parsed mounts. */
/** @param {HTMLElement} host */
function bindPanelDelegation(host) {
    if (host.dataset.oaaoEndpointsDelegated === '1') return;
    host.dataset.oaaoEndpointsDelegated = '1';
    const $host = razyui(host);
    $host.on(
        'click',
        function () {
            const btn = this;
            const act = btn.getAttribute('data-act');
            if (!act) return;

        if (act === 'ep-add') {
            void openEndpointEditor(host, null);
            return;
        }
        if (act === 'ep-edit') {
            const card = btn.closest('[data-oaao-ep-card][data-eid]');
            const eid = card?.getAttribute('data-eid');
            const row = rt.state.endpoints.find((r) => String(r.id) === String(eid));
            void openEndpointEditor(host, row ?? null);
            return;
        }
        if (act === 'ep-del') {
            void (async () => {
                const card = btn.closest('[data-oaao-ep-card][data-eid]');
                const eid = parseInt(String(card?.getAttribute('data-eid') || '0'), 10);
                if (!Number.isFinite(eid) || eid < 1) return;
                const ok = await confirmDestructive(
                    oaaoT('settings.endpoints.delete_confirm_title'),
                    `<p class="text-[0.8125rem] m-0">${oaaoT('settings.endpoints.delete_confirm_body', '', { id: escapeHtml(String(eid)) })}</p>`
                );
                if (!ok) return;
                const { res, data } = await endpointsFetchJson(endpointsApiUrl('endpoints_delete'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: eid }),
                });
                if (!res.ok || !data?.success) {
                    window.alert(
                        typeof data?.message === 'string'
                            ? data.message
                            : oaaoT('settings.endpoints.delete_failed', '', { status: String(res.status) }),
                    );
                    return;
                }
                try {
                    await reload(host);
                } catch (e) {
                    window.alert(e instanceof Error ? e.message : oaaoT('settings.endpoints.dialog.reload_failed'));
                }
            })();
            return;
        }

        if (act === 'ch-ep-add') {
            if (readPanelMode(host) !== 'purposes') return;
            void openPurposesChatProfileEditor(host, null, rt.mountCtx, rt.state.endpoints, async () => {
                await reload(host);
            });
            return;
        }
        if (act === 'ch-ep-edit') {
            if (readPanelMode(host) !== 'purposes') return;
            const card = btn.closest('[data-chat-eid]');
            const eid = card?.getAttribute('data-chat-eid');
            const row = rt.state.chatProfiles.find((p) => String(p.id) === String(eid));
            if (row) {
                void openPurposesChatProfileEditor(host, row, rt.mountCtx, rt.state.endpoints, async () => {
                    await reload(host);
                });
            }
            return;
        }
        if (act === 'ch-ep-del') {
            if (readPanelMode(host) !== 'purposes') return;
            const card = btn.closest('[data-chat-eid]');
            const eid = parseInt(String(card?.getAttribute('data-chat-eid') || '0'), 10);
            void deletePurposesChatProfile(rt.mountCtx, eid, async () => {
                await reload(host);
            });
            return;
        }

        if (act === 'pu-primary-save') {
            if (rt.state.purposesPostgresqlOnly) return;
            void (async () => {
                const card = btn.closest('[data-oaao-pa-slot]');
                const sid = card?.getAttribute('data-slot-id');
                if (!card || !sid) return;
                const slot = readPurposeAllocationSlots().find((s) => s.slot_id === sid);
                const pfx = typeof slot?.purpose_key_prefix === 'string' ? slot.purpose_key_prefix.trim() : '';
                if (!slot || !pfx) return;
                const pidStr = card.getAttribute('data-pid');
                const existing =
                    pidStr && /^\d+$/.test(pidStr) && Number(pidStr) > 0
                        ? rt.state.purposes.find((r) => String(r.id) === pidStr)
                        : undefined;
                const sel = card.querySelector('[data-oaao-pa-default-ep]');
                const enCb = card.querySelector('[data-oaao-pa-enabled]');
                const dep = sel instanceof HTMLSelectElement ? sel.value.trim() : '';
                const isEn = enCb instanceof HTMLInputElement ? enCb.checked : true;
                const sortFallback = Number(btn.getAttribute('data-slot-sort') || slot.sort || 500);
                /** @type {Record<string, unknown>} */
                const payload = {
                    ...(existing ? { id: Number(existing.id) } : {}),
                    purpose_key: pfx,
                    label: String(existing?.label ?? slot.label ?? pfx),
                    description: String(existing?.description ?? slot.sub ?? ''),
                    ...(dep ? { default_endpoint_id: parseInt(dep, 10) } : { default_endpoint_id: null }),
                    is_enabled: isEn,
                    sort_order: Number(existing?.sort_order ?? sortFallback),
                };
                const mj = String(existing?.meta_json ?? '').trim();
                if (mj) payload.meta_json = mj;
                const { res, data } = await endpointsFetchJson(endpointsApiUrl('purposes_save'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok || !data?.success) {
                    window.alert(
                        typeof data?.message === 'string'
                            ? data.message
                            : oaaoT('settings.purpose.dialog.save_failed', '', { status: String(res.status) }),
                    );
                    return;
                }
                try {
                    await reload(host);
                } catch (e) {
                    window.alert(e instanceof Error ? e.message : oaaoT('settings.purpose.dialog.reload_failed'));
                    return;
                }
                oaaoRazyToastFire(oaaoT('settings.purpose.saved'), 'success');
            })();
            return;
        }

        if (act === 'pu-edit-primary') {
            if (rt.state.purposesPostgresqlOnly) return;
            const pid = btn.getAttribute('data-pid');
            const row = pid ? rt.state.purposes.find((r) => String(r.id) === String(pid)) : undefined;
            openPurposeEditor(host, row ?? null);
            return;
        }

        if (act === 'pu-edit') {
            const rowEl = btn.closest('[data-oaao-pu-row]');
            const pid = rowEl?.getAttribute('data-pid');
            const row = pid ? rt.state.purposes.find((r) => String(r.id) === String(pid)) : undefined;
            openPurposeEditor(host, row ?? null);
            return;
        }
        if (act === 'pu-del') {
            void (async () => {
                const rowEl = btn.closest('[data-oaao-pu-row]');
                const pid = parseInt(String(rowEl?.getAttribute('data-pid') || '0'), 10);
                if (!Number.isFinite(pid) || pid < 1) return;
                const ok = await confirmDestructive(
                    oaaoT('settings.purpose.delete_confirm_title'),
                    `<p class="text-[0.8125rem] m-0">${oaaoT('settings.purpose.delete_confirm_body', '', { id: escapeHtml(String(pid)) })}</p>`
                );
                if (!ok) return;
                const { res, data } = await endpointsFetchJson(endpointsApiUrl('purposes_delete'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: pid }),
                });
                if (!res.ok || !data?.success) {
                    window.alert(
                        typeof data?.message === 'string'
                            ? data.message
                            : oaaoT('settings.purpose.delete_failed', '', { status: String(res.status) }),
                    );
                    return;
                }
                try {
                    await reload(host);
                } catch (e) {
                    window.alert(e instanceof Error ? e.message : oaaoT('settings.purpose.dialog.reload_failed'));
                }
            })();
            return;
        }
        },
        '[data-act]',
    );

    $host.on(
        'change',
        function () {
            const t = /** @type {HTMLInputElement} */ (this);
            if (readPanelMode(host) !== 'purposes') return;
            const card = t.closest('[data-chat-eid]');
            const eid = card?.getAttribute('data-chat-eid');
            const row = rt.state.chatProfiles.find((p) => String(p.id) === String(eid));
            if (!row) return;
            void patchPurposesChatProfileDefault(host, row, t.checked, rt.mountCtx, async () => {
                await reload(host);
            });
        },
        'input[data-act="ch-ep-default"]',
    );
}

/**
 * @param {HTMLElement} host
 * @param {{ razyui?: unknown, section?: Record<string, unknown>, Dialog?: unknown, JIT?: unknown }} [ctx]
 */
export async function mountSettingsPanel(host, ctx) {
    rt.mountCtx = ctx && typeof ctx === 'object' ? ctx : null;
    const sec = ctx && typeof ctx.section === 'object' && ctx.section ? ctx.section : {};
    const sid = typeof sec.section_id === 'string' ? sec.section_id.trim() : '';
    writePanelMode(host, sid === 'settings-purposes' ? 'purposes' : 'endpoints');

    bindPanelDelegation(host);
    oaaoMountLoadingLogo(host, { label: oaaoT('settings.dialog.loading_panel') });
    try {
        await reload(host);
    } catch (e) {
        host.replaceChildren();
        host.appendChild(
            ruiBuild({
                t: 'p',
                j: 'text-sm fg-[var(--grid-ink-muted)]',
                txt: e instanceof Error ? e.message : oaaoT('settings.errors.load_generic'),
            }),
        );
    }
}

export function teardownSettingsPanel() {
    closeNestedDialogs();
    rt.mountCtx = null;
}
