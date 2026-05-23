/**
 * Platform Settings panel — tenant registry (platform host + platform admin only).
 */
import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';

export async function mountSettingsPanel(host, ctx = {}) {
    return mountPlatformTenantsPanel(host, ctx);
}

export async function mountPlatformTenantsPanel(host, ctx = {}) {
    const { signal } = ctx;
    if (!(host instanceof HTMLElement)) return;

    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: 'Loading tenants…' });

    const base = '/platform/api/';
    try {
        const [listRes, usageRes] = await Promise.all([
            fetch(`${base}tenants_list`, { credentials: 'same-origin', signal }),
            fetch(`${base}usage_summary`, { credentials: 'same-origin', signal }),
        ]);
        const listJson = await listRes.json();
        const usageJson = await usageRes.json();

        host.textContent = '';
        if (!listRes.ok || !listJson?.success) {
            const err = document.createElement('p');
            err.className = 'text-sm fg-[var(--grid-danger)]';
            err.textContent = listJson?.message || `HTTP ${listRes.status}`;
            host.append(err);
            return;
        }

        const title = document.createElement('div');
        title.className = 'oaao-sdlg-section-title mb-sm';
        title.textContent = 'Tenant registry';
        host.append(title);

        const intro = document.createElement('p');
        intro.className = 'text-xs fg-[var(--grid-ink-muted)] mb-md';
        intro.textContent =
            'Bind hostnames to tenants, edit signup policy, and migrate legacy Qdrant collections (web_* → tenant slug).';
        host.append(intro);

        const reload = () => mountPlatformTenantsPanel(host, ctx);
        host.append(buildCreateTenantToolbar(base, signal, reload, ctx));

        const tenants = Array.isArray(listJson.data?.tenants) ? listJson.data.tenants : [];
        const usageMap = new Map();
        if (usageJson?.success && Array.isArray(usageJson.data?.tenants)) {
            for (const u of usageJson.data.tenants) {
                if (u && u.tenant_id != null) usageMap.set(Number(u.tenant_id), u);
            }
        }

        if (tenants.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'text-sm fg-[var(--grid-ink-muted)] mt-md';
            empty.textContent = 'No tenants yet.';
            host.append(empty);
            return;
        }

        const list = document.createElement('ul');
        list.className = 'flex flex-col gap-3 list-none p-0 m-0 mt-md';
        for (const t of tenants) {
            list.append(buildTenantCard(t, usageMap.get(Number(t.tenant_id ?? 0)), base, signal, reload));
        }
        host.append(list);
    } catch (e) {
        if (e?.name === 'AbortError') return;
        host.textContent = '';
        const err = document.createElement('p');
        err.className = 'text-sm fg-[var(--grid-danger)]';
        err.textContent = 'Could not load platform tenants.';
        host.append(err);
    }
}

/**
 * @param {Record<string, unknown>} tenant
 * @param {Record<string, unknown>|undefined} usage
 * @param {string} base
 * @param {AbortSignal|undefined} signal
 * @param {() => void|Promise<void>} onSaved
 */
function buildTenantCard(tenant, usage, base, signal, onSaved) {
    const li = document.createElement('li');
    li.className =
        'rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] p-3 bg-[var(--grid-paper)]';

    const tid = Number(tenant.tenant_id ?? 0);
    const kind = String(tenant.kind || '');
    const hosts = Array.isArray(tenant.hosts) ? tenant.hosts.map((h) => h.host).filter(Boolean) : [];
    const usageLines = formatUsageByKind(usage?.usage_by_kind);

    const head = document.createElement('div');
    head.innerHTML = `<div class="fw-semibold text-sm">${escapeHtml(String(tenant.display_name || tenant.slug || ''))}</div>
        <div class="text-xs fg-[var(--grid-caption)] mt-1">${escapeHtml(String(tenant.slug || ''))} · ${escapeHtml(kind)} · ${escapeHtml(String(tenant.status || ''))} · signup ${escapeHtml(String(tenant.signup_mode || ''))}</div>
        <div class="text-xs fg-[var(--grid-ink-muted)] mt-1">Hosts: ${escapeHtml(hosts.join(', ') || '—')}</div>
        <div class="text-xs fg-[var(--grid-ink-muted)] mt-1">Users: ${usage?.user_count ?? '—'} · Vaults: ${usage?.vault_count ?? '—'} · Events: ${usage?.usage_events ?? '—'}</div>
        ${usageLines ? `<div class="text-xs fg-[var(--grid-ink-muted)] mt-1">${usageLines}</div>` : ''}`;
    li.append(head);

    if (kind === 'platform') {
        return li;
    }

    li.append(buildTenantEditForm(tenant, hosts, base, signal, onSaved));
    li.append(buildAddHostsForm(tid, base, signal, onSaved));

    if (String(tenant.slug || '') === 'localhost') {
        li.append(buildQdrantMigrateRow(tid, base, signal, onSaved));
    }

    return li;
}

/**
 * @param {Record<string, unknown>} tenant
 * @param {string[]} hosts
 */
function buildTenantEditForm(tenant, hosts, base, signal, onSaved) {
    const wrap = document.createElement('details');
    wrap.className = 'mt-2 text-xs';
    wrap.innerHTML = '<summary class="cursor-pointer fg-[var(--grid-caption)]">Edit tenant</summary>';

    const form = document.createElement('form');
    form.className = 'flex flex-col gap-2 mt-2';
    form.innerHTML = `
        <label class="flex flex-col gap-1">
            <span class="fg-[var(--grid-caption)]">Display name</span>
            <input name="display_name" class="rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]" value="${escapeAttr(String(tenant.display_name || ''))}" />
        </label>
        <label class="flex flex-col gap-1">
            <span class="fg-[var(--grid-caption)]">Slug</span>
            <input name="slug" required pattern="[a-z0-9][a-z0-9_-]{0,47}" class="rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]" value="${escapeAttr(String(tenant.slug || ''))}" />
        </label>
        <label class="flex flex-col gap-1">
            <span class="fg-[var(--grid-caption)]">Status</span>
            <select name="status" class="rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]">
                <option value="active"${tenant.status === 'active' ? ' selected' : ''}>active</option>
                <option value="suspended"${tenant.status === 'suspended' ? ' selected' : ''}>suspended</option>
            </select>
        </label>
        <label class="flex flex-col gap-1">
            <span class="fg-[var(--grid-caption)]">Signup mode</span>
            <select name="signup_mode" class="rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]">
                <option value="private"${tenant.signup_mode === 'private' ? ' selected' : ''}>private</option>
                <option value="public"${tenant.signup_mode === 'public' ? ' selected' : ''}>public</option>
            </select>
        </label>
        <label class="flex flex-col gap-1">
            <span class="fg-[var(--grid-caption)]">Hosts (replace all)</span>
            <textarea name="hosts" rows="4" class="rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]">${escapeHtml(hosts.join('\n'))}</textarea>
        </label>
    `;

    const status = document.createElement('p');
    status.className = 'text-xs m-0 hidden';
    status.setAttribute('role', 'status');

    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.className =
        'self-start rounded-[6px] border border-[var(--grid-line)] px-3 py-1 text-sm bg-[var(--grid-paper)] cursor-pointer';
    btn.textContent = 'Save changes';

    form.append(status, btn);
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const hostsRaw = String(fd.get('hosts') || '');
        const hostList = hostsRaw
            .split(/[\n,]+/)
            .map((h) => h.trim().toLowerCase())
            .filter(Boolean);

        status.classList.remove('hidden', 'fg-[var(--grid-danger)]');
        status.classList.add('fg-[var(--grid-ink-muted)]');
        status.textContent = 'Saving…';
        btn.disabled = true;

        try {
            const res = await fetch(`${base}tenants_save`, {
                method: 'POST',
                credentials: 'same-origin',
                signal,
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    tenant_id: Number(tenant.tenant_id ?? 0),
                    slug: String(fd.get('slug') || '').trim().toLowerCase(),
                    display_name: String(fd.get('display_name') || '').trim(),
                    signup_mode: String(fd.get('signup_mode') || 'private'),
                    status: String(fd.get('status') || 'active'),
                    hosts: hostList,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json?.success) {
                status.classList.remove('fg-[var(--grid-ink-muted)]');
                status.classList.add('fg-[var(--grid-danger)]');
                status.textContent = json?.message || `HTTP ${res.status}`;
                return;
            }
            await onSaved();
        } catch (e) {
            if (e?.name === 'AbortError') return;
            status.classList.remove('fg-[var(--grid-ink-muted)]');
            status.classList.add('fg-[var(--grid-danger)]');
            status.textContent = 'Save failed.';
        } finally {
            btn.disabled = false;
        }
    });

    wrap.append(form);
    return wrap;
}

function buildAddHostsForm(tenantId, base, signal, onSaved) {
    const wrap = document.createElement('div');
    wrap.className = 'mt-2 flex flex-col gap-1 text-xs';

    const label = document.createElement('span');
    label.className = 'fg-[var(--grid-caption)]';
    label.textContent = 'Add hosts';
    wrap.append(label);

    const row = document.createElement('div');
    row.className = 'flex flex-row gap-2 items-start';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'app.acme.com';
    input.className =
        'flex-1 rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
        'rounded-[6px] border border-[var(--grid-line)] px-3 py-1 text-sm bg-[var(--grid-paper)] cursor-pointer shrink-0';
    btn.textContent = 'Add';

    const status = document.createElement('p');
    status.className = 'text-xs m-0 hidden fg-[var(--grid-ink-muted)]';
    status.setAttribute('role', 'status');

    btn.addEventListener('click', async () => {
        const raw = input.value.trim().toLowerCase();
        if (!raw) return;
        const hosts = raw
            .split(/[\n,]+/)
            .map((h) => h.trim())
            .filter(Boolean);
        status.classList.remove('hidden', 'fg-[var(--grid-danger)]');
        status.classList.add('fg-[var(--grid-ink-muted)]');
        status.textContent = 'Adding…';
        btn.disabled = true;
        try {
            const res = await fetch(`${base}tenants_hosts_add`, {
                method: 'POST',
                credentials: 'same-origin',
                signal,
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ tenant_id: tenantId, hosts }),
            });
            const json = await res.json();
            if (!res.ok || !json?.success) {
                status.classList.remove('fg-[var(--grid-ink-muted)]');
                status.classList.add('fg-[var(--grid-danger)]');
                status.textContent = json?.message || `HTTP ${res.status}`;
                return;
            }
            input.value = '';
            await onSaved();
        } catch (e) {
            if (e?.name === 'AbortError') return;
            status.classList.add('fg-[var(--grid-danger)]');
            status.textContent = 'Add failed.';
        } finally {
            btn.disabled = false;
        }
    });

    row.append(input, btn);
    wrap.append(row, status);
    return wrap;
}

function buildQdrantMigrateRow(tenantId, base, signal, onSaved) {
    const wrap = document.createElement('div');
    wrap.className = 'mt-2 text-xs';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
        'rounded-[6px] border border-[var(--grid-line)] px-3 py-1 text-sm bg-[var(--grid-paper)] cursor-pointer';
    btn.textContent = 'Migrate Qdrant web_* → localhost_*';

    const status = document.createElement('p');
    status.className = 'text-xs m-0 mt-1 hidden fg-[var(--grid-ink-muted)]';
    status.setAttribute('role', 'status');

    btn.addEventListener('click', async () => {
        if (!confirm('Copy Qdrant collections from web_* to localhost_*? Source collections are kept unless you enable delete in API.')) {
            return;
        }
        status.classList.remove('hidden', 'fg-[var(--grid-danger)]');
        status.classList.add('fg-[var(--grid-ink-muted)]');
        status.textContent = 'Migrating…';
        btn.disabled = true;
        try {
            const res = await fetch(`${base}qdrant_migrate`, {
                method: 'POST',
                credentials: 'same-origin',
                signal,
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ tenant_id: tenantId, from_slug: 'web', delete_source: false }),
            });
            const json = await res.json();
            if (!res.ok || !json?.success) {
                status.classList.add('fg-[var(--grid-danger)]');
                status.textContent = json?.message || `HTTP ${res.status}`;
                return;
            }
            const pts = json.data?.points_migrated ?? 0;
            const cols = Array.isArray(json.data?.collections) ? json.data.collections.length : 0;
            status.textContent = `Done — ${cols} collection(s), ${pts} point(s) copied.`;
            await onSaved();
        } catch (e) {
            if (e?.name === 'AbortError') return;
            status.classList.add('fg-[var(--grid-danger)]');
            status.textContent = 'Migration failed.';
        } finally {
            btn.disabled = false;
        }
    });

    wrap.append(btn, status);
    return wrap;
}

/**
 * @param {string} base
 * @param {AbortSignal|undefined} signal
 * @param {() => void|Promise<void>} onSaved
 * @param {{ Dialog?: unknown, JIT?: { hydrate?: (root: Element | DocumentFragment) => void } }} ctx
 */
function buildCreateTenantToolbar(base, signal, onSaved, ctx) {
    const toolbar = document.createElement('div');
    toolbar.className = 'flex flex-row justify-end mb-md';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
        'rounded-[8px] h-9 px-3 text-[0.8125rem] fw-medium fg-[var(--grid-on-accent,#fff)] bg-[var(--grid-accent)] border-0 cursor-pointer font-inherit hover:opacity-90';
    btn.textContent = 'Create customer tenant';
    btn.addEventListener('click', () => {
        void openCreateTenantDialog(base, signal, onSaved, ctx);
    });
    toolbar.append(btn);
    return toolbar;
}

/**
 * @param {string} base
 * @param {AbortSignal|undefined} signal
 * @param {() => void|Promise<void>} onSaved
 * @param {{ Dialog?: unknown, JIT?: { hydrate?: (root: Element | DocumentFragment) => void } }} ctx
 */
async function openCreateTenantDialog(base, signal, onSaved, ctx = {}) {
    const Dialog = ctx.Dialog;
    if (typeof Dialog !== 'function') {
        window.alert('Dialog component unavailable.');
        return;
    }

    const wrap = document.createElement('div');
    wrap.className = '[padding:0]';

    const form = document.createElement('form');
    form.id = 'oaao-platform-tenant-create-form';
    form.className = 'flex flex-col gap-2';
    form.innerHTML = `
        <label class="flex flex-col gap-1 text-xs">
            <span class="fg-[var(--grid-caption)]">Slug</span>
            <input name="slug" required pattern="[a-z0-9][a-z0-9_-]{0,47}" class="rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]" placeholder="acme" />
        </label>
        <label class="flex flex-col gap-1 text-xs">
            <span class="fg-[var(--grid-caption)]">Display name</span>
            <input name="display_name" class="rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]" placeholder="Acme Corp" />
        </label>
        <label class="flex flex-col gap-1 text-xs">
            <span class="fg-[var(--grid-caption)]">Signup mode</span>
            <select name="signup_mode" class="rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]">
                <option value="private">private</option>
                <option value="public">public</option>
            </select>
        </label>
        <label class="flex flex-col gap-1 text-xs">
            <span class="fg-[var(--grid-caption)]">Hosts (one per line)</span>
            <textarea name="hosts" rows="3" class="rounded-[6px] border border-[var(--grid-line)] px-2 py-1 text-sm bg-[var(--grid-paper)]" placeholder="acme.localhost&#10;app.acme.com"></textarea>
        </label>
    `;

    const status = document.createElement('p');
    status.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 hidden';
    status.setAttribute('role', 'status');
    form.append(status);
    wrap.append(form);

    new Dialog({
        id: 'oaao-platform-create-tenant',
        title: 'Create customer tenant',
        content: wrap,
        size: 'md',
        closable: true,
        buttons: [
            { text: 'Cancel', color: 'muted', role: 'cancel' },
            {
                text: 'Create tenant',
                color: 'accent',
                action: async () => {
                    if (!form.reportValidity()) {
                        return false;
                    }
                    const fd = new FormData(form);
                    const slug = String(fd.get('slug') || '').trim().toLowerCase();
                    const displayName = String(fd.get('display_name') || '').trim();
                    const signupMode = String(fd.get('signup_mode') || 'private');
                    const hostsRaw = String(fd.get('hosts') || '');
                    const hosts = hostsRaw
                        .split(/[\n,]+/)
                        .map((h) => h.trim().toLowerCase())
                        .filter(Boolean);

                    status.classList.remove('hidden', 'fg-[var(--grid-danger)]');
                    status.classList.add('fg-[var(--grid-ink-muted)]');
                    status.textContent = 'Creating…';

                    try {
                        const res = await fetch(`${base}tenants_save`, {
                            method: 'POST',
                            credentials: 'same-origin',
                            signal,
                            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                            body: JSON.stringify({
                                slug,
                                display_name: displayName || slug,
                                signup_mode: signupMode,
                                status: 'active',
                                hosts,
                            }),
                        });
                        const json = await res.json();
                        if (!res.ok || !json?.success) {
                            status.classList.remove('fg-[var(--grid-ink-muted)]');
                            status.classList.add('fg-[var(--grid-danger)]');
                            status.textContent = json?.message || `HTTP ${res.status}`;
                            return false;
                        }
                        await onSaved();
                    } catch (e) {
                        if (e?.name === 'AbortError') return false;
                        status.classList.remove('fg-[var(--grid-ink-muted)]');
                        status.classList.add('fg-[var(--grid-danger)]');
                        status.textContent = 'Create failed.';
                        return false;
                    }
                },
            },
        ],
        onOpen(ctrl) {
            ctx.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
            const slugInput = form.querySelector('[name="slug"]');
            if (slugInput instanceof HTMLInputElement) {
                slugInput.focus();
            }
        },
    });
}

/** @param {unknown} rows */
function formatUsageByKind(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return '';
    return rows
        .map((r) => {
            if (!r || typeof r !== 'object') return '';
            const kind = String(r.event_kind || '');
            const cnt = r.event_count ?? '';
            const sum = r.quantity_sum ?? '';
            return `${escapeHtml(kind)}: ${cnt} (${sum})`;
        })
        .filter(Boolean)
        .join(' · ');
}

/** @param {string} s */
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** @param {string} s */
function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
}

export default mountSettingsPanel;
