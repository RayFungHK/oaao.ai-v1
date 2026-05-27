/**
 * Admin Settings — cloud providers (table + Dialog) + storage + migration.
 */

import { oaaoT } from '@oaao/core-js/oaao-i18n.js';
import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';
import { replaceChildrenParsed } from '@oaao/core-js/oaao-jit-dsl.js';

const DOMAINS = [
    'vault',
    'chat_attachments',
    'agent_materials',
    'slide_projects',
    'slide_templates',
    'live_meeting',
    'mine',
];

const CDN_PROVIDERS = ['none', 'generic', 'cloudfront', 'gcs', 'cloudflare'];
const CLOUD_BACKENDS = ['gcs', 's3', 'hf'];

let state = { config: null, tenantSlug: 'tenant' };

/** @param {string} code */
function backendLabel(code) {
    const key = `settings.storage.backend.${code}`;
    const label = oaaoT(key);
    return label === key ? code : label;
}

function providerBackendOptions(selected = 'gcs') {
    return CLOUD_BACKENDS.map((b) => {
        const sel = b === selected ? ' selected' : '';
        return `<option value="${escapeAttr(b)}"${sel}>${escapeHtml(backendLabel(b))}</option>`;
    }).join('');
}

/**
 * @param {HTMLFormElement} form
 * @param {{ isEdit?: boolean, hasCred?: boolean }} opts
 */
function syncProviderFormFields(form, opts = {}) {
    const { isEdit = false, hasCred = false } = opts;
    const backendEl = form.querySelector('[name="backend"]');
    const backend = backendEl instanceof HTMLSelectElement ? backendEl.value : 'gcs';

    form.querySelectorAll('[data-cred-for]').forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const allowed = (el.getAttribute('data-cred-for') || '').trim().split(/\s+/);
        el.hidden = !allowed.includes(backend);
    });

    const bucketLabel = form.querySelector('[data-provider-bucket-label]');
    if (bucketLabel instanceof HTMLElement) {
        bucketLabel.textContent =
            backend === 'hf' ? oaaoT('settings.storage.provider_hf_bucket') : oaaoT('settings.storage.bucket');
    }

    const tokenLabel = form.querySelector('[data-provider-token-label]');
    if (tokenLabel instanceof HTMLElement) {
        tokenLabel.textContent =
            backend === 'hf'
                ? oaaoT('settings.storage.provider_hf_token')
                : oaaoT('settings.storage.provider_gcs_token');
    }

    const tokenInput = form.querySelector('[name="token"]');
    if (tokenInput instanceof HTMLTextAreaElement) {
        tokenInput.placeholder =
            backend === 'hf' ? 'hf_xxxxxxxxxxxxxxxx' : '{"type":"service_account",...}';
        tokenInput.rows = backend === 'hf' ? 2 : 4;
    }

    form.querySelectorAll('[data-provider-cred-hint]').forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (isEdit && hasCred) {
            el.textContent = oaaoT('settings.storage.provider_cred_keep');
        } else if (backend === 'gcs') {
            el.textContent = oaaoT('settings.storage.provider_gcs_cred_hint');
        } else if (backend === 's3') {
            el.textContent = oaaoT('settings.storage.provider_s3_hint');
        } else {
            el.textContent = oaaoT('settings.storage.provider_hf_hint');
        }
    });
}

function storageApiUrl(action) {
    const root = document.documentElement.dataset.oaaoRootPath || '/';
    const prefix = root.endsWith('/') ? root : `${root}/`;
    return `${prefix}api/${action}`;
}

async function storageFetch(action, init = {}) {
    const res = await fetch(storageApiUrl(action), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        ...init,
    });
    let data = {};
    try {
        data = await res.json();
    } catch {
        data = {};
    }
    return { res, data };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
}

function suggestProviderId(label) {
    const base = String(label || 'provider')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'provider';
    return `prov_${base}`.slice(0, 48);
}

function providerMap(config) {
    const raw = config?.cloud_providers;
    return raw && typeof raw === 'object' ? /** @type {Record<string, Record<string, unknown>>} */ (raw) : {};
}

/** @param {Record<string, unknown>} row */
function credStatusBadgeHtml(row) {
    const cred = row?.credentials;
    const ok = cred && typeof cred === 'object' && cred.configured !== false;
    const cls = ok ? 'oaao-storage-cred-badge is-ok' : 'oaao-storage-cred-badge is-miss';
    const label = ok ? oaaoT('settings.storage.provider_cred_badge_ok') : oaaoT('settings.storage.provider_cred_badge_miss');
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function providerSelectOptions(selected = '', includeEmpty = true) {
    const providers = providerMap(state.config);
    const parts = [];
    if (includeEmpty) {
        parts.push(`<option value="">${oaaoT('settings.storage.provider_none')}</option>`);
    }
    for (const [id, row] of Object.entries(providers)) {
        const label = String(row?.label || id);
        const backend = backendLabel(String(row?.backend || ''));
        const bucket = String(row?.bucket || '');
        const sel = id === selected ? ' selected' : '';
        parts.push(`<option value="${id}"${sel}>${label} (${backend} · ${bucket})</option>`);
    }
    return parts.join('');
}

/** @param {Record<string, unknown>} basic */
function resolveBasicStorageTarget(basic) {
    const pid = String(basic?.provider_id || '').trim();
    if (pid && providerMap(state.config)[pid]) return pid;
    const backend = String(basic?.backend || 'local').toLowerCase();
    return backend === 'local' ? 'local' : 'local';
}

/** @param {Record<string, unknown>} cfg */
function resolveDomainStorageTarget(cfg) {
    if (!cfg || typeof cfg !== 'object' || Object.keys(cfg).length === 0) return '';
    const pid = String(cfg.provider_id || '').trim();
    if (pid && providerMap(state.config)[pid]) return pid;
    const backend = String(cfg.backend || '').toLowerCase();
    if (backend === 'local') return 'local';
    if (backend === '') return '';
    return '';
}

function migrationEndpointOptions(selected = '') {
    const providers = providerMap(state.config);
    const parts = [];
    parts.push(`<option value="">${oaaoT('settings.storage.migration_use_active')}</option>`);
    parts.push(
        `<option value="local"${selected === 'local' ? ' selected' : ''}>${escapeHtml(oaaoT('settings.storage.backend_local'))}</option>`,
    );
    for (const [id, row] of Object.entries(providers)) {
        const label = String(row?.label || id);
        const backend = backendLabel(String(row?.backend || ''));
        const bucket = String(row?.bucket || '');
        const sel = id === selected ? ' selected' : '';
        parts.push(
            `<option value="${escapeAttr(id)}"${sel}>${escapeHtml(label)} (${escapeHtml(backend)} · ${escapeHtml(bucket)})</option>`,
        );
    }
    return parts.join('');
}

function storageTargetOptions(selected = 'local', includeEmpty = false) {
    const providers = providerMap(state.config);
    const parts = [];
    if (includeEmpty) {
        parts.push(`<option value="">${oaaoT('settings.storage.inherit_backend')}</option>`);
    }
    parts.push(`<option value="local"${selected === 'local' ? ' selected' : ''}>${oaaoT('settings.storage.backend_local')}</option>`);
    for (const [id, row] of Object.entries(providers)) {
        const label = String(row?.label || id);
        const backend = backendLabel(String(row?.backend || ''));
        const bucket = String(row?.bucket || '');
        const sel = id === selected ? ' selected' : '';
        parts.push(
            `<option value="${escapeAttr(id)}"${sel}>${escapeHtml(label)} (${escapeHtml(backend)} · ${escapeHtml(bucket)})</option>`,
        );
    }
    return parts.join('');
}

/** @param {string} target */
function rowFromStorageTarget(target) {
    if (!target || target === 'local') {
        return { backend: 'local' };
    }
    const prov = providerMap(state.config)[target];
    return {
        backend: String(prov?.backend || 'gcs'),
        provider_id: target,
    };
}

function providerDetailsLabel(row) {
    const backend = backendLabel(String(row?.backend || ''));
    const bucket = String(row?.bucket || '');
    const region = String(row?.region || '').trim();
    const parts = [backend, bucket];
    if (region) parts.push(region);
    return parts.filter(Boolean).join(' · ');
}

function ensureStorageTableStyles() {
    if (document.getElementById('oaao-storage-provider-table-styles')) return;
    const style = document.createElement('style');
    style.id = 'oaao-storage-provider-table-styles';
    style.textContent = `
        .oaao-storage-provider-table { width: 100%; min-width: 32rem; table-layout: fixed; border-collapse: collapse; }
        .oaao-storage-provider-table th,
        .oaao-storage-provider-table td {
            padding: 0.65rem 0.75rem;
            text-align: left;
            border-bottom: 1px solid var(--grid-line);
            vertical-align: middle;
            overflow: hidden;
        }
        .oaao-storage-provider-table thead th {
            font-weight: 600;
            color: var(--grid-caption);
            background: var(--grid-nav);
            white-space: nowrap;
            border-bottom: 1px solid var(--grid-line);
        }
        .oaao-storage-provider-table tbody tr:last-child td { border-bottom: 0; }
        .oaao-storage-provider-table .oaao-storage-col-name { width: 34%; white-space: normal; }
        .oaao-storage-provider-table .oaao-storage-col-details {
            width: 40%;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 0.8125rem;
        }
        .oaao-storage-provider-table .oaao-access-table-actions {
            width: 26%;
            min-width: 9.5rem;
            text-align: right;
            white-space: nowrap;
        }
        .oaao-storage-cred-badge {
            display: inline-block;
            margin-top: 0.2rem;
            padding: 0.1rem 0.4rem;
            border-radius: 999px;
            font-size: 0.625rem;
            font-weight: 600;
            line-height: 1.3;
            white-space: nowrap;
        }
        .oaao-storage-cred-badge.is-ok {
            color: var(--grid-accent);
            background: rgba(55, 53, 47, 0.06);
        }
        .oaao-storage-cred-badge.is-miss {
            color: var(--grid-danger);
            background: rgba(235, 87, 87, 0.08);
        }
        .oaao-storage-folder-table { width: 100%; border-collapse: collapse; }
        .oaao-storage-folder-table th,
        .oaao-storage-folder-table td {
            padding: 0.5rem 0.75rem;
            text-align: left;
            border-bottom: 1px solid var(--grid-line);
            vertical-align: middle;
        }
        .oaao-storage-folder-table thead th {
            font-weight: 600;
            font-size: 0.75rem;
            color: var(--grid-caption);
            background: var(--grid-nav);
        }
        .oaao-storage-folder-table tbody tr:last-child td { border-bottom: 0; }
        .oaao-storage-folder-table .oaao-storage-folder-path {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 0.75rem;
            word-break: break-all;
        }
        .oaao-storage-summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
            gap: 0.75rem 1rem;
            margin: 0;
        }
        .oaao-storage-summary-grid dt {
            margin: 0 0 0.15rem;
            font-size: 0.6875rem;
            font-weight: 600;
            color: var(--grid-caption);
            text-transform: uppercase;
            letter-spacing: 0.02em;
        }
        .oaao-storage-summary-grid dd {
            margin: 0;
            font-size: 0.8125rem;
            word-break: break-word;
        }
        .oaao-storage-provider-table .oaao-storage-actions-inner {
            display: inline-flex;
            flex-wrap: nowrap;
            align-items: center;
            justify-content: flex-end;
            gap: 0.125rem;
        }
        .oaao-storage-provider-table .oaao-storage-row-status {
            display: block;
            font-size: 0.6875rem;
            margin-top: 0.125rem;
            white-space: nowrap;
        }
    `;
    document.head.append(style);
}

function tableActionBtn(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className =
        'px-2 py-1 fw-medium fg-[var(--grid-accent)] hover:bg-[rgba(55,53,47,0.06)] bg-transparent border-0 cursor-pointer font-inherit leading-none whitespace-nowrap';
    return btn;
}

function buildCreateToolbar(label, onClick) {
    const toolbar = document.createElement('div');
    toolbar.className = 'flex flex-row justify-end mb-2';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
        'rounded-[8px] h-9 px-3 text-[0.8125rem] fw-medium fg-[var(--grid-on-accent,#fff)] bg-[var(--grid-accent)] border-0 cursor-pointer font-inherit hover:opacity-90';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    toolbar.append(btn);
    return toolbar;
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} ctx
 */
function renderProviderTable(host, ctx) {
    ensureStorageTableStyles();
    const mount = host.querySelector('[data-provider-table-mount]');
    if (!(mount instanceof HTMLElement)) return;
    mount.textContent = '';

    const toolbar = buildCreateToolbar(oaaoT('settings.storage.provider_create'), () => {
        void openProviderDialog(ctx, host, null);
    });
    mount.append(toolbar);

    const providers = providerMap(state.config);
    const ids = Object.keys(providers);
    if (ids.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-xs fg-[var(--grid-ink-muted)] m-0';
        empty.textContent = oaaoT('settings.storage.providers_empty');
        mount.append(empty);
        return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'overflow-x-auto rounded-[10px] border border-solid border-[var(--grid-line)]';
    const table = document.createElement('table');
    table.className = 'oaao-access-table oaao-storage-provider-table text-[0.8125rem] border-collapse';
    table.innerHTML = `
      <thead>
        <tr>
          <th class="oaao-storage-col-name">${escapeHtml(oaaoT('settings.storage.provider_col_name'))}</th>
          <th class="oaao-storage-col-details">${escapeHtml(oaaoT('settings.storage.provider_col_details'))}</th>
          <th class="oaao-access-table-actions"></th>
        </tr>
      </thead>
      <tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    if (!(tbody instanceof HTMLElement)) return;

    for (const id of ids) {
        const row = providers[id];
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="oaao-storage-col-name">
            <div class="fw-medium">${escapeHtml(String(row?.label || id))}</div>
            <code class="font-mono text-[0.6875rem] fg-[var(--grid-ink-muted)]">${escapeHtml(id)}</code>
            ${credStatusBadgeHtml(row)}
          </td>
          <td class="oaao-storage-col-details" title="${escapeAttr(providerDetailsLabel(row))}">${escapeHtml(providerDetailsLabel(row))}</td>
          <td class="oaao-access-table-actions"></td>`;
        const actions = tr.querySelector('.oaao-access-table-actions');
        if (actions instanceof HTMLElement) {
            const inner = document.createElement('div');
            inner.className = 'oaao-storage-actions-inner';
            const testBtn = tableActionBtn(oaaoT('settings.storage.test'));
            const status = document.createElement('span');
            status.className = 'oaao-storage-row-status hidden';
            status.dataset.rowTest = '1';
            testBtn.addEventListener('click', () => {
                void testSavedProvider(id, status);
            });
            const editBtn = tableActionBtn(oaaoT('settings.storage.provider_edit'));
            editBtn.addEventListener('click', () => {
                void openProviderDialog(ctx, host, id);
            });
            const removeBtn = tableActionBtn(oaaoT('settings.storage.provider_remove'));
            removeBtn.addEventListener('click', () => {
                void removeProvider(id, host, ctx);
            });
            inner.append(testBtn, editBtn, removeBtn);
            actions.append(inner, status);
        }
        tbody.append(tr);
    }
    wrap.append(table);
    mount.append(wrap);
}

async function testSavedProvider(providerId, statusEl) {
    if (!(statusEl instanceof HTMLElement)) return;
    statusEl.hidden = false;
    statusEl.textContent = oaaoT('settings.storage.testing');
    statusEl.className = 'oaao-storage-row-status fg-[var(--grid-ink-muted)]';

    const { res, data } = await storageFetch('storage_test', {
        method: 'POST',
        body: JSON.stringify({ domain: 'vault', domain_config: { provider_id: providerId } }),
    });
    const ok = res.ok && data?.success;
    statusEl.textContent = ok ? oaaoT('settings.storage.test_ok') : oaaoT('settings.storage.test_failed');
    statusEl.className = `oaao-storage-row-status ${ok ? 'fg-[var(--grid-accent)]' : 'fg-[var(--grid-danger)]'}`;
}

async function removeProvider(providerId, host, ctx) {
    const { res, data } = await storageFetch('storage_settings', {
        method: 'POST',
        body: JSON.stringify({ cloud_providers_remove: [providerId] }),
    });
    if (res.ok && data?.success) {
        state.config = data.data;
        fillForm(host, /** @type {Record<string, unknown>} */ (data.data));
        renderProviderTable(host, ctx);
        syncStorageTargetSelects(host);
        syncMigrationEndpointSelects(host);
    }
}

function readProviderForm(form) {
    const fd = new FormData(form);
    const label = String(fd.get('label') || '').trim();
    let id = String(fd.get('id') || '').trim();
    if (!id) id = suggestProviderId(label);
    const backend = String(fd.get('backend') || 'gcs');
    /** @type {Record<string, string>} */
    const credentials = {};
    if (backend === 'gcs' || backend === 'hf') {
        const token = String(fd.get('token') || '').trim();
        if (token && token !== '••••••') credentials.token = token;
    } else if (backend === 's3') {
        const accessKey = String(fd.get('access_key') || '').trim();
        const secretKey = String(fd.get('secret_key') || '').trim();
        const endpointUrl = String(fd.get('endpoint_url') || '').trim();
        if (accessKey && accessKey !== '••••••') credentials.access_key = accessKey;
        if (secretKey && secretKey !== '••••••') credentials.secret_key = secretKey;
        if (endpointUrl) credentials.endpoint_url = endpointUrl;
    }
    return {
        id,
        row: {
            id,
            label: label || id,
            backend,
            bucket: String(fd.get('bucket') || '').trim(),
            region: String(fd.get('region') || '').trim(),
            credentials,
        },
    };
}

function providerFormDomainConfig(row) {
    return {
        backend: row.backend,
        bucket: row.bucket,
        region: row.region,
        credentials: row.credentials,
    };
}

async function testProviderConfig(cfg, statusEl) {
    if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = oaaoT('settings.storage.testing');
        statusEl.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 mt-2';
    }
    const { res, data } = await storageFetch('storage_test', {
        method: 'POST',
        body: JSON.stringify({ domain: 'vault', domain_config: cfg }),
    });
    const ok = res.ok && data?.success;
    if (statusEl) {
        statusEl.textContent = ok ? oaaoT('settings.storage.test_ok') : oaaoT('settings.storage.test_failed');
        statusEl.className = `text-xs m-0 mt-2 ${ok ? 'fg-[var(--grid-accent)]' : 'fg-[var(--grid-danger)]'}`;
    }
    return ok;
}

/**
 * @param {Record<string, unknown>} ctx
 * @param {HTMLElement} host
 * @param {string|null} providerId
 */
async function openProviderDialog(ctx, host, providerId) {
    const Dialog = ctx.Dialog;
    if (typeof Dialog !== 'function') {
        window.alert(oaaoT('settings.errors.dialog_unavailable'));
        return;
    }

    const isEdit = providerId != null && providerId !== '';
    const existing = isEdit ? providerMap(state.config)[providerId] : null;
    const existingBackend = String(existing?.backend || 'gcs');
    const cred = existing?.credentials;
    const hasCred = cred && typeof cred === 'object' && cred.configured !== false;
    const credOpts = { isEdit, hasCred };

    const wrap = document.createElement('div');
    wrap.className = '[padding:0]';
    const form = document.createElement('form');
    form.id = 'oaao-storage-provider-form';
    form.className = 'flex flex-col gap-2';
    form.innerHTML = `
      <label class="text-xs">${oaaoT('settings.storage.provider_label')}
        <input name="label" class="w-full text-sm border rounded px-2 py-1 mt-0.5" required value="${isEdit ? escapeAttr(String(existing?.label || '')) : ''}" />
      </label>
      <label class="text-xs">${oaaoT('settings.storage.provider_id')}
        <input name="id" class="w-full text-sm border rounded px-2 py-1 mt-0.5 font-mono" ${isEdit ? 'readonly' : ''} value="${isEdit ? escapeAttr(providerId) : ''}" placeholder="prov_gcp_prod" />
      </label>
      <label class="text-xs">${oaaoT('settings.storage.backend')}
        <select name="backend" class="w-full text-sm border rounded px-2 py-1 mt-0.5">
          ${providerBackendOptions(isEdit ? existingBackend : 'gcs')}
        </select>
      </label>
      <label class="text-xs"><span data-provider-bucket-label>${oaaoT('settings.storage.bucket')}</span>
        <input name="bucket" class="w-full text-sm border rounded px-2 py-1 mt-0.5" required value="${isEdit ? escapeAttr(String(existing?.bucket || '')) : ''}" />
      </label>
      <label class="text-xs" data-cred-for="gcs s3">${oaaoT('settings.storage.region')}
        <input name="region" class="w-full text-sm border rounded px-2 py-1 mt-0.5" value="${isEdit ? escapeAttr(String(existing?.region || '')) : ''}" />
      </label>
      <div data-cred-for="gcs hf">
        <label class="text-xs"><span data-provider-token-label>${oaaoT('settings.storage.provider_gcs_token')}</span>
          <textarea name="token" rows="4" class="w-full text-sm border rounded px-2 py-1 mt-0.5 font-mono"></textarea>
        </label>
        <p class="text-xs fg-[var(--grid-ink-muted)] m-0 mt-1" data-provider-cred-hint></p>
      </div>
      <div data-cred-for="s3" class="flex flex-col gap-2">
        <p class="text-xs fg-[var(--grid-ink-muted)] m-0" data-provider-cred-hint></p>
        <label class="text-xs">${oaaoT('settings.storage.provider_access_key')}
          <input name="access_key" type="text" autocomplete="off" class="w-full text-sm border rounded px-2 py-1 mt-0.5" placeholder="${isEdit && hasCred ? '••••••' : 'ACCESS_KEY'}" />
        </label>
        <label class="text-xs">${oaaoT('settings.storage.provider_secret_key')}
          <input name="secret_key" type="password" autocomplete="new-password" class="w-full text-sm border rounded px-2 py-1 mt-0.5" placeholder="${isEdit && hasCred ? '••••••' : 'SECRET_KEY'}" />
        </label>
        <label class="text-xs">${oaaoT('settings.storage.provider_endpoint_url')}
          <input name="endpoint_url" type="url" class="w-full text-sm border rounded px-2 py-1 mt-0.5" placeholder="https://…r2.cloudflarestorage.com" />
        </label>
      </div>`;

    const status = document.createElement('p');
    status.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 mt-2 hidden';
    status.setAttribute('role', 'status');
    form.append(status);
    wrap.append(form);

    form.querySelector('[name="backend"]')?.addEventListener('change', () => {
        syncProviderFormFields(form, credOpts);
    });
    syncProviderFormFields(form, credOpts);

    if (!isEdit) {
        const labelInput = form.querySelector('[name="label"]');
        const idInput = form.querySelector('[name="id"]');
        labelInput?.addEventListener('input', () => {
            if (idInput instanceof HTMLInputElement && !idInput.dataset.userEdited && labelInput instanceof HTMLInputElement) {
                idInput.value = suggestProviderId(labelInput.value);
            }
        });
        idInput?.addEventListener('input', () => {
            if (idInput instanceof HTMLInputElement) idInput.dataset.userEdited = '1';
        });
    }

    new Dialog({
        id: isEdit ? `oaao-storage-provider-${providerId}` : 'oaao-storage-provider-create',
        title: isEdit ? oaaoT('settings.storage.provider_edit') : oaaoT('settings.storage.provider_create'),
        content: wrap,
        size: 'md',
        closable: true,
        buttons: [
            { text: oaaoT('settings.storage.dialog_cancel'), color: 'muted', role: 'cancel' },
            {
                text: oaaoT('settings.storage.test'),
                color: 'default',
                action: async () => {
                    if (!form.reportValidity()) return false;
                    const { id, row } = readProviderForm(form);
                    if (Object.keys(row.credentials).length === 0 && isEdit) {
                        await testProviderConfig({ provider_id: id }, status);
                    } else {
                        await testProviderConfig(providerFormDomainConfig(row), status);
                    }
                    return false;
                },
            },
            {
                text: isEdit ? oaaoT('settings.storage.save') : oaaoT('settings.storage.provider_add'),
                color: 'accent',
                action: async () => {
                    if (!form.reportValidity()) return false;
                    const { id, row } = readProviderForm(form);
                    status.hidden = false;
                    status.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 mt-2';
                    status.textContent = oaaoT('settings.storage.saving');
                    const { res, data } = await storageFetch('storage_settings', {
                        method: 'POST',
                        body: JSON.stringify({ cloud_providers: { [id]: row } }),
                    });
                    if (!res.ok || !data?.success) {
                        status.className = 'text-xs fg-[var(--grid-danger)] m-0 mt-2';
                        status.textContent = typeof data?.message === 'string' ? data.message : oaaoT('settings.storage.save_failed');
                        return false;
                    }
                    state.config = data.data;
                    fillForm(host, /** @type {Record<string, unknown>} */ (data.data));
                    renderProviderTable(host, ctx);
                    syncStorageTargetSelects(host);
                    syncMigrationEndpointSelects(host);
                },
            },
        ],
        onOpen() {
            ctx.JIT?.hydrate?.(wrap);
            syncProviderFormFields(form, credOpts);
            const labelInput = form.querySelector('[name="label"]');
            if (labelInput instanceof HTMLInputElement) labelInput.focus();
        },
    });
}

function syncMigrationEndpointSelects(host) {
    const migration = state.config?.migration && typeof state.config.migration === 'object' ? state.config.migration : {};
    host.querySelectorAll('[data-migration-endpoint]').forEach((el) => {
        if (!(el instanceof HTMLSelectElement)) return;
        const field = el.dataset.field || '';
        const selected =
            field === 'migration_source_provider_id'
                ? String(migration.source_provider_id || '')
                : field === 'migration_target_provider_id'
                  ? String(migration.target_provider_id || '')
                  : el.value;
        el.innerHTML = migrationEndpointOptions(selected);
        el.value = selected;
    });
}

function syncProviderSelects(host) {
    host.querySelectorAll('[data-provider-select]').forEach((el) => {
        if (!(el instanceof HTMLSelectElement)) return;
        const selected = el.value;
        el.innerHTML = providerSelectOptions(selected, true);
        el.value = selected;
    });
}

function syncStorageTargetSelects(host) {
    const basicTarget = host.querySelector('[data-basic-field="storage_target"]');
    if (basicTarget instanceof HTMLSelectElement) {
        const selected = basicTarget.value || resolveBasicStorageTarget(state.config?.basic || {});
        basicTarget.innerHTML = storageTargetOptions(selected);
        basicTarget.value = selected;
    }
    host.querySelectorAll('[data-field="storage_target"]').forEach((el) => {
        if (!(el instanceof HTMLSelectElement)) return;
        const card = el.closest('[data-domain]');
        const domain = card instanceof HTMLElement ? card.dataset.domain : '';
        const cfg = domain && state.config?.domains ? state.config.domains[domain] || {} : {};
        const selected = el.value || resolveDomainStorageTarget(cfg);
        el.innerHTML = storageTargetOptions(selected, true);
        el.value = selected;
    });
}

function syncCloudVisibility(scope, backend) {
    const isLocal = backend === 'local';
    scope.querySelectorAll('[data-basic-cloud]').forEach((el) => {
        if (el instanceof HTMLElement) el.hidden = isLocal;
    });
}

function syncDomainCloudVisibility(card, target) {
    const isLocal = !target || target === 'local';
    card.querySelectorAll('[data-cloud-field="cdn_block"]').forEach((el) => {
        if (el instanceof HTMLElement) el.hidden = isLocal;
    });
}

function readSettingsMode(host) {
    const el = host.querySelector('[data-field="settings_mode"]:checked');
    return el instanceof HTMLInputElement && el.value === 'advance' ? 'advance' : 'auto';
}

function syncModePanels(host, mode) {
    host.querySelector('[data-storage-auto]')?.toggleAttribute('hidden', mode !== 'auto');
    host.querySelector('[data-storage-advance]')?.toggleAttribute('hidden', mode !== 'advance');
}

function updateFolderMap(host) {
    const tbody = host.querySelector('[data-folder-map]');
    const titleEl = host.querySelector('[data-folder-map-title]');
    const prefixEl = host.querySelector('[data-field="default_prefix"]');
    const targetEl = host.querySelector('[data-basic-field="storage_target"]');
    if (!(tbody instanceof HTMLElement)) return;

    const isLocal = !(targetEl instanceof HTMLSelectElement) || targetEl.value === 'local' || targetEl.value === '';
    if (titleEl instanceof HTMLElement) {
        titleEl.textContent = isLocal
            ? oaaoT('settings.storage.folder_map_local')
            : oaaoT('settings.storage.folder_map_title');
    }

    let prefix = prefixEl instanceof HTMLInputElement ? prefixEl.value.trim() : '';
    if (!prefix) prefix = `tenant-${state.tenantSlug}/`;
    if (!prefix.endsWith('/')) prefix += '/';

    tbody.innerHTML = DOMAINS.map(
        (d) => `<tr>
          <td class="text-xs">${escapeHtml(oaaoT(`settings.storage.domain.${d}`))}</td>
          <td class="oaao-storage-folder-path">${escapeHtml(`${prefix}${d}/`)}</td>
        </tr>`,
    ).join('');
}

/** @param {HTMLElement} host */
function syncBasicProviderSummary(host) {
    const summary = host.querySelector('[data-basic-provider-summary]');
    const targetEl = host.querySelector('[data-basic-field="storage_target"]');
    if (!(summary instanceof HTMLElement) || !(targetEl instanceof HTMLSelectElement)) return;

    const target = targetEl.value.trim();
    if (target === '' || target === 'local') {
        summary.hidden = true;
        summary.textContent = '';
        return;
    }

    const prov = providerMap(state.config)[target];
    if (!prov) {
        summary.hidden = true;
        summary.textContent = '';
        return;
    }

    summary.hidden = false;
    const region = String(prov.region || '').trim();
    summary.innerHTML = `
      <dl class="oaao-storage-summary-grid">
        <div>
          <dt>${escapeHtml(oaaoT('settings.storage.backend'))}</dt>
          <dd>${escapeHtml(backendLabel(String(prov.backend || '')))}</dd>
        </div>
        <div>
          <dt>${escapeHtml(oaaoT('settings.storage.bucket'))}</dt>
          <dd><code class="font-mono text-xs">${escapeHtml(String(prov.bucket || '—'))}</code></dd>
        </div>
        <div${region ? '' : ' hidden'}>
          <dt>${escapeHtml(oaaoT('settings.storage.region'))}</dt>
          <dd>${escapeHtml(region || '—')}</dd>
        </div>
        <div>
          <dt>${escapeHtml(oaaoT('settings.storage.provider_col_credentials'))}</dt>
          <dd>${credStatusBadgeHtml(prov)}</dd>
        </div>
      </dl>`;
}

/** @param {HTMLElement} host */
function syncBasicStoragePanel(host) {
    const targetEl = host.querySelector('[data-basic-field="storage_target"]');
    const autoPanel = host.querySelector('[data-storage-auto]');
    if (autoPanel instanceof HTMLElement && targetEl instanceof HTMLSelectElement) {
        syncCloudVisibility(autoPanel, targetEl.value === 'local' ? 'local' : 'cloud');
    }
    syncBasicProviderSummary(host);
    updateFolderMap(host);
}

function domainCardHtml(domain) {
    return `
<section class="border border-[var(--grid-line)] rounded-lg p-4 mb-4" data-domain="${domain}">
  <h3 class="text-sm font-semibold mb-3">${oaaoT(`settings.storage.domain.${domain}`)}</h3>
  <label class="block text-xs mb-1">${oaaoT('settings.storage.storage_target')}</label>
  <select data-field="storage_target" class="w-full mb-2 text-sm border rounded px-2 py-1"></select>
  <div data-cloud-field="cdn_block">
    <label class="block text-xs mb-1">${oaaoT('settings.storage.cdn_provider')}</label>
    <select data-field="cdn_provider" class="w-full mb-2 text-sm border rounded px-2 py-1">
      ${CDN_PROVIDERS.map((p) => `<option value="${p}">${oaaoT(`settings.storage.cdn.${p}`)}</option>`).join('')}
    </select>
    <label class="block text-xs mb-1">${oaaoT('settings.storage.cdn_base_url')}</label>
    <input data-field="cdn_base_url" class="w-full mb-2 text-sm border rounded px-2 py-1" />
    <label class="block text-xs mb-1">${oaaoT('settings.storage.cdn_signing_env')}</label>
    <input data-field="cdn_signing_env" class="w-full mb-2 text-sm border rounded px-2 py-1" />
  </div>
  <button type="button" data-test-domain="${domain}" class="text-xs underline">${oaaoT('settings.storage.test')}</button>
  <p data-test-result="${domain}" class="text-xs mt-1 fg-[var(--grid-ink-muted)]"></p>
</section>`;
}

function fillForm(host, config) {
    const mode = config.settings_mode === 'advance' ? 'advance' : 'auto';
    host.querySelectorAll('[data-field="settings_mode"]').forEach((el) => {
        if (el instanceof HTMLInputElement) el.checked = el.value === mode;
    });
    syncModePanels(host, mode);

    const def = config.default || {};
    const prefixEl = host.querySelector('[data-field="default_prefix"]');
    if (prefixEl instanceof HTMLInputElement) {
        prefixEl.value = String(def.prefix || '');
        if (!prefixEl.value.trim()) prefixEl.placeholder = `tenant-${config.tenant_slug || state.tenantSlug}/`;
    }

    const basic = config.basic || {};
    const basicTarget = host.querySelector('[data-basic-field="storage_target"]');
    if (basicTarget instanceof HTMLSelectElement) {
        const selected = resolveBasicStorageTarget(basic);
        basicTarget.innerHTML = storageTargetOptions(selected);
        basicTarget.value = selected;
    }
    for (const field of ['cdn_provider', 'cdn_base_url', 'cdn_signing_env']) {
        const el = host.querySelector(`[data-basic-field="${field}"]`);
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
            el.value = String(basic[field] ?? (field === 'cdn_provider' ? 'none' : ''));
        }
    }

    const migration = config.migration || {};
    const purgeEl = host.querySelector('[data-field="purge_source"]');
    if (purgeEl instanceof HTMLInputElement) purgeEl.checked = migration.purge_source !== false;
    const srcProv = host.querySelector('[data-field="migration_source_provider_id"]');
    const tgtProv = host.querySelector('[data-field="migration_target_provider_id"]');
    if (srcProv instanceof HTMLSelectElement) {
        const selected = String(migration.source_provider_id || '');
        srcProv.innerHTML = migrationEndpointOptions(selected);
        srcProv.value = selected;
    }
    if (tgtProv instanceof HTMLSelectElement) {
        const selected = String(migration.target_provider_id || '');
        tgtProv.innerHTML = migrationEndpointOptions(selected);
        tgtProv.value = selected;
    }

    const domains = config.domains || {};
    for (const domain of DOMAINS) {
        const card = host.querySelector(`[data-domain="${domain}"]`);
        if (!card) continue;
        const cfg = domains[domain] || {};
        const targetEl = card.querySelector('[data-field="storage_target"]');
        if (targetEl instanceof HTMLSelectElement) {
            const selected = resolveDomainStorageTarget(cfg);
            targetEl.innerHTML = storageTargetOptions(selected, true);
            targetEl.value = selected;
        }
        for (const field of ['cdn_provider', 'cdn_base_url', 'cdn_signing_env']) {
            const el = card.querySelector(`[data-field="${field}"]`);
            if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
                el.value = String(cfg[field] ?? (field === 'cdn_provider' ? 'none' : ''));
            }
        }
        syncDomainCloudVisibility(card, targetEl instanceof HTMLSelectElement ? targetEl.value : '');
    }

    syncProviderSelects(host);
    syncStorageTargetSelects(host);
    syncBasicStoragePanel(host);
}

function readPatch(host) {
    const mode = readSettingsMode(host);
    const prefixEl = host.querySelector('[data-field="default_prefix"]');
    const purgeEl = host.querySelector('[data-field="purge_source"]');
    /** @type {Record<string, unknown>} */
    const patch = {
        settings_mode: mode,
        default: { prefix: prefixEl instanceof HTMLInputElement ? prefixEl.value.trim() : '' },
        migration: {
            purge_source: purgeEl instanceof HTMLInputElement ? purgeEl.checked : true,
            source_provider_id:
                host.querySelector('[data-field="migration_source_provider_id"]') instanceof HTMLSelectElement
                    ? host.querySelector('[data-field="migration_source_provider_id"]').value.trim()
                    : '',
            target_provider_id:
                host.querySelector('[data-field="migration_target_provider_id"]') instanceof HTMLSelectElement
                    ? host.querySelector('[data-field="migration_target_provider_id"]').value.trim()
                    : '',
        },
    };

    if (mode === 'auto') {
        /** @type {Record<string, string>} */
        const basic = {};
        const targetEl = host.querySelector('[data-basic-field="storage_target"]');
        const target = targetEl instanceof HTMLSelectElement ? targetEl.value.trim() : 'local';
        Object.assign(basic, rowFromStorageTarget(target));
        for (const field of ['cdn_provider', 'cdn_base_url', 'cdn_signing_env']) {
            const el = host.querySelector(`[data-basic-field="${field}"]`);
            if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
                const v = el.value.trim();
                if (v) basic[field] = v;
            }
        }
        patch.basic = basic;
        patch.domains = {};
    } else {
        /** @type {Record<string, Record<string, string>>} */
        const domains = {};
        for (const domain of DOMAINS) {
            const card = host.querySelector(`[data-domain="${domain}"]`);
            if (!card) continue;
            /** @type {Record<string, string>} */
            const cfg = {};
            const targetEl = card.querySelector('[data-field="storage_target"]');
            const target = targetEl instanceof HTMLSelectElement ? targetEl.value.trim() : '';
            if (target !== '') {
                Object.assign(cfg, rowFromStorageTarget(target));
            }
            for (const field of ['cdn_provider', 'cdn_base_url', 'cdn_signing_env']) {
                const el = card.querySelector(`[data-field="${field}"]`);
                if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
                    const v = el.value.trim();
                    if (v) cfg[field] = v;
                }
            }
            if (Object.keys(cfg).length) domains[domain] = cfg;
        }
        patch.domains = domains;
    }
    return patch;
}

function wirePanel(host, ctx) {
    host.querySelectorAll('[data-field="settings_mode"]').forEach((el) => {
        el.addEventListener('change', () => syncModePanels(host, readSettingsMode(host)));
    });
    host.querySelector('[data-field="default_prefix"]')?.addEventListener('input', () => updateFolderMap(host));
    host.querySelector('[data-basic-field="storage_target"]')?.addEventListener('change', () => {
        syncBasicStoragePanel(host);
    });
    host.querySelectorAll('[data-field="storage_target"]').forEach((el) => {
        el.addEventListener('change', () => {
            const card = el.closest('[data-domain]');
            if (card instanceof HTMLElement && el instanceof HTMLSelectElement) {
                syncDomainCloudVisibility(card, el.value);
            }
        });
    });
}

export async function mountSettingsPanel(host, ctx = {}) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: oaaoT('settings.storage.loading') });

    const { res, data } = await storageFetch('storage_settings');
    if (!res.ok || !data?.success) {
        host.textContent = oaaoT('settings.storage.load_failed');
        return;
    }

    state.config = data.data || {};
    state.tenantSlug = typeof state.config.tenant_slug === 'string' ? state.config.tenant_slug.trim() : 'tenant';
    host.textContent = '';

    const html = `
<div class="flex flex-col gap-4 max-w-3xl">
  <section>
    <h3 class="text-sm font-semibold mb-1">${oaaoT('settings.storage.providers_title')}</h3>
    <p class="text-xs fg-[var(--grid-ink-muted)] mb-3">${oaaoT('settings.storage.providers_hint')}</p>
    <div data-provider-table-mount></div>
  </section>

  <section class="border border-[var(--grid-line)] rounded-lg p-4">
    <h3 class="text-sm font-semibold mb-3">${oaaoT('settings.storage.mode_title')}</h3>
    <label class="flex items-center gap-2 text-sm cursor-pointer mb-1">
      <input type="radio" name="storage_mode" value="auto" data-field="settings_mode" class="rounded" checked />
      <span>${oaaoT('settings.storage.mode_auto')}</span>
    </label>
    <label class="flex items-center gap-2 text-sm cursor-pointer mb-3">
      <input type="radio" name="storage_mode" value="advance" data-field="settings_mode" class="rounded" />
      <span>${oaaoT('settings.storage.mode_advance')}</span>
    </label>
    <label class="block text-xs mb-1">${oaaoT('settings.storage.prefix')}</label>
    <input data-field="default_prefix" class="w-full text-sm border rounded px-2 py-1" />
  </section>

  <section data-storage-auto>
    <h3 class="text-sm font-semibold mb-1">${oaaoT('settings.storage.basic_title')}</h3>
    <p class="text-xs fg-[var(--grid-ink-muted)] mb-4">${oaaoT('settings.storage.basic_hint')}</p>
    <label class="block text-xs mb-1 fw-medium">${oaaoT('settings.storage.storage_target')}</label>
    <select data-basic-field="storage_target" class="w-full max-w-md mb-3 text-sm border rounded px-2 py-1"></select>
    <div data-basic-provider-summary hidden class="mb-4 rounded-[10px] border border-solid border-[var(--grid-line)] bg-[var(--grid-nav)] p-3"></div>
    <div data-basic-cloud class="mb-4">
      <h4 class="text-xs font-semibold mb-2">${oaaoT('settings.storage.cdn_section_title')}</h4>
      <label class="block text-xs mb-1">${oaaoT('settings.storage.cdn_provider')}</label>
      <select data-basic-field="cdn_provider" class="w-full max-w-md mb-2 text-sm border rounded px-2 py-1">
        ${CDN_PROVIDERS.map((p) => `<option value="${p}">${oaaoT(`settings.storage.cdn.${p}`)}</option>`).join('')}
      </select>
      <label class="block text-xs mb-1">${oaaoT('settings.storage.cdn_base_url')}</label>
      <input data-basic-field="cdn_base_url" class="w-full max-w-md mb-2 text-sm border rounded px-2 py-1" />
      <label class="block text-xs mb-1">${oaaoT('settings.storage.cdn_signing_env')}</label>
      <input data-basic-field="cdn_signing_env" class="w-full max-w-md mb-2 text-sm border rounded px-2 py-1" />
    </div>
    <h4 class="text-xs font-semibold mb-2" data-folder-map-title>${oaaoT('settings.storage.folder_map_title')}</h4>
    <div class="overflow-x-auto rounded-[10px] border border-solid border-[var(--grid-line)] mb-3">
      <table class="oaao-storage-folder-table text-[0.8125rem]">
        <thead>
          <tr>
            <th>${escapeHtml(oaaoT('settings.storage.folder_map_col_domain'))}</th>
            <th>${escapeHtml(oaaoT('settings.storage.folder_map_col_prefix'))}</th>
          </tr>
        </thead>
        <tbody data-folder-map></tbody>
      </table>
    </div>
    <div class="flex flex-row items-center gap-2 flex-wrap">
      <button type="button" data-test-basic class="text-xs underline">${oaaoT('settings.storage.test')}</button>
      <p data-test-result="basic" class="text-xs m-0 fg-[var(--grid-ink-muted)]"></p>
    </div>
  </section>

  <div data-storage-advance hidden>${DOMAINS.map((d) => domainCardHtml(d)).join('')}</div>

  <section class="border border-[var(--grid-line)] rounded-lg p-4">
    <h3 class="text-sm font-semibold mb-2">${oaaoT('settings.storage.migration_title')}</h3>
    <p class="text-xs fg-[var(--grid-ink-muted)] mb-2">${oaaoT('settings.storage.migration_providers_hint')}</p>
    <label class="block text-xs mb-1">${oaaoT('settings.storage.migration_source_provider')}</label>
    <select data-field="migration_source_provider_id" data-migration-endpoint class="w-full mb-2 text-sm border rounded px-2 py-1"></select>
    <label class="block text-xs mb-1">${oaaoT('settings.storage.migration_target_provider')}</label>
    <select data-field="migration_target_provider_id" data-migration-endpoint class="w-full mb-2 text-sm border rounded px-2 py-1"></select>
    <label class="flex items-center gap-2 text-sm mb-2 cursor-pointer">
      <input type="checkbox" data-field="purge_source" class="rounded" checked />
      <span>${oaaoT('settings.storage.purge_source')}</span>
    </label>
    <p data-migration-status class="text-xs fg-[var(--grid-ink-muted)] mb-2"></p>
    <label class="block text-xs mb-1">${oaaoT('settings.storage.migrate_domain')}</label>
    <select data-field="migrate_domain" class="w-full mb-2 text-sm border rounded px-2 py-1">
      ${DOMAINS.map((d) => `<option value="${d}">${oaaoT(`settings.storage.domain.${d}`)}</option>`).join('')}
    </select>
    <button type="button" data-migrate class="text-sm px-3 py-1 border rounded">${oaaoT('settings.storage.migrate_run')}</button>
  </section>
  <button type="button" data-save class="text-sm px-3 py-1 border rounded bg-[var(--grid-accent-soft)] w-fit">${oaaoT('settings.storage.save')}</button>
  <p data-status class="text-xs fg-[var(--grid-ink-muted)]"></p>
</div>`;

    replaceChildrenParsed(host, html);
    ensureStorageTableStyles();
    ctx.JIT?.hydrate?.(host);
    fillForm(host, state.config);
    wirePanel(host, ctx);
    renderProviderTable(host, ctx);

    host.querySelector('[data-save]')?.addEventListener('click', async () => {
        const status = host.querySelector('[data-status]');
        const { res, data: sData } = await storageFetch('storage_settings', {
            method: 'POST',
            body: JSON.stringify(readPatch(host)),
        });
        if (status) status.textContent = res.ok && sData?.success ? oaaoT('settings.storage.saved') : oaaoT('settings.storage.save_failed');
        if (res.ok && sData?.success) {
            state.config = sData.data;
            fillForm(host, sData.data);
            renderProviderTable(host, ctx);
            syncStorageTargetSelects(host);
            syncMigrationEndpointSelects(host);
        }
    });

    host.querySelector('[data-test-basic]')?.addEventListener('click', async () => {
        const patch = readPatch(host);
        const basic = patch.basic || {};
        const out = host.querySelector('[data-test-result="basic"]');
        const { res, data: tData } = await storageFetch('storage_test', {
            method: 'POST',
            body: JSON.stringify({ domain: 'vault', domain_config: basic }),
        });
        if (out) out.textContent = res.ok && tData?.success ? oaaoT('settings.storage.test_ok') : oaaoT('settings.storage.test_failed');
    });

    for (const domain of DOMAINS) {
        host.querySelector(`[data-test-domain="${domain}"]`)?.addEventListener('click', async () => {
            const patch = readPatch(host);
            const domains = patch.domains || {};
            const out = host.querySelector(`[data-test-result="${domain}"]`);
            const { res, data: tData } = await storageFetch('storage_test', {
                method: 'POST',
                body: JSON.stringify({ domain, domain_config: domains[domain] || {} }),
            });
            if (out) out.textContent = res.ok && tData?.success ? oaaoT('settings.storage.test_ok') : oaaoT('settings.storage.test_failed');
        });
    }

    host.querySelector('[data-migrate]')?.addEventListener('click', async () => {
        const patch = readPatch(host);
        const migration = patch.migration || {};
        const domainEl = host.querySelector('[data-field="migrate_domain"]');
        const domain = domainEl instanceof HTMLSelectElement ? domainEl.value : 'vault';
        await storageFetch('storage_migrate', {
            method: 'POST',
            body: JSON.stringify({
                domain,
                purge_source: migration.purge_source !== false,
                source_provider_id: migration.source_provider_id || '',
                target_provider_id: migration.target_provider_id || '',
            }),
        });
        const { data: mData } = await storageFetch('storage_migrate_status');
        const mig = mData?.data?.migration;
        const el = host.querySelector('[data-migration-status]');
        if (el && mig) {
            const prog = mig.progress || {};
            el.textContent = `${oaaoT('settings.storage.migration_status')}: ${mig.status || 'idle'} — ${prog.done ?? 0}/${prog.total ?? 0}`;
        }
    });

    const { data: mData } = await storageFetch('storage_migrate_status');
    const mig = mData?.data?.migration;
    const el = host.querySelector('[data-migration-status]');
    if (el && mig) {
        const prog = mig.progress || {};
        el.textContent = `${oaaoT('settings.storage.migration_status')}: ${mig.status || 'idle'} — ${prog.done ?? 0}/${prog.total ?? 0}`;
    }
}
