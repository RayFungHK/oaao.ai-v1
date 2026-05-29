/**
 * Admin Settings — Users + Permission groups ({@see settings-users}, {@see settings-permission-groups}).
 */

import { oaaoMountLoadingLogo } from './oaao-loading-logo.js';
import { oaaoT } from './oaao-i18n.js';
import { mountUserUsageOverview } from './user-usage-overview.js';

const FEATURE_KEYS = ['chat', 'vault', 'workspace', 'settings'];
const LIMIT_KEYS = ['workspace_max', 'vault_max', 'storage_bytes_max'];
const PAGE_SIZE = 10;

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} [ctx]
 */
export async function mountSettingsPanel(host, ctx = {}) {
    if (!(host instanceof HTMLElement)) return;
    const sectionId = String(ctx.section?.section_id || '');
    if (sectionId === 'settings-permission-groups') {
        return mountGroupsPanel(host, ctx);
    }
    return mountUsersPanel(host, ctx);
}

export default mountSettingsPanel;

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} ctx
 * @param {number} [page]
 */
async function mountUsersPanel(host, ctx, page = 1) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: 'Loading users…' });

    try {
        const url = `/user/api/users_list?page=${page}&page_size=${PAGE_SIZE}`;
        const res = await fetch(url, { credentials: 'same-origin' });
        const json = await res.json();
        host.textContent = '';

        if (!res.ok || !json?.success) {
            host.append(errorLine(json?.message || `HTTP ${res.status}`));
            return;
        }

        const users = Array.isArray(json.data?.users) ? json.data.users : [];
        const groups = Array.isArray(json.data?.groups) ? json.data.groups : [];
        const pagination = normalizePagination(json.data?.pagination, page);

        host.append(sectionTitle('User management'));
        host.append(
            hint('Invite users by email — they set their own password on registration. Direct password creation is disabled.'),
        );
        host.append(
            buildCreateToolbar('Send invitation', () => {
                void openInviteDialog(groups, ctx, () => mountUsersPanel(host, ctx, 1));
            }),
        );

        let invitations = [];
        try {
            const invRes = await fetch('/user/api/users_invitations_list', { credentials: 'same-origin' });
            const invJson = await invRes.json();
            if (invRes.ok && invJson?.success) {
                invitations = Array.isArray(invJson.data?.invitations) ? invJson.data.invitations : [];
            }
        } catch {
            invitations = [];
        }

        if (invitations.length > 0) {
            host.append(sectionTitle('Pending invitations', 'mt-md'));
            host.append(buildInvitationsTable(invitations, ctx, () => mountUsersPanel(host, ctx, pagination.page)));
        }

        if (users.length === 0) {
            host.append(hint('No active users yet.', 'mt-md'));
            host.append(buildPaginationBar(pagination, (p) => mountUsersPanel(host, ctx, p)));
            return;
        }

        host.append(sectionTitle('Active users', 'mt-md'));
        host.append(buildUsersTable(users, groups, ctx, pagination, host));
        host.append(buildPaginationBar(pagination, (p) => mountUsersPanel(host, ctx, p)));
    } catch {
        host.textContent = '';
        host.append(errorLine('Could not load users.'));
    }
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, unknown>} ctx
 * @param {number} [page]
 */
async function mountGroupsPanel(host, ctx, page = 1) {
    host.textContent = '';
    oaaoMountLoadingLogo(host, { label: 'Loading permission groups…' });

    try {
        const url = `/group/api/groups_list?page=${page}&page_size=${PAGE_SIZE}`;
        const res = await fetch(url, { credentials: 'same-origin' });
        const json = await res.json();
        host.textContent = '';

        if (!res.ok || !json?.success) {
            host.append(errorLine(json?.message || `HTTP ${res.status}`));
            return;
        }

        const groups = Array.isArray(json.data?.groups) ? json.data.groups : [];
        const pagination = normalizePagination(json.data?.pagination, page);

        host.append(sectionTitle('Permission groups'));
        host.append(
            hint('Feature access, workspace limits, and storage quotas per group.'),
        );
        host.append(
            buildCreateToolbar('Create permission group', () => {
                void openGroupDialog(null, ctx, () => mountGroupsPanel(host, ctx, 1));
            }),
        );

        if (groups.length === 0) {
            host.append(hint('No permission groups yet.', 'mt-md'));
            host.append(buildPaginationBar(pagination, (p) => mountGroupsPanel(host, ctx, p)));
            return;
        }

        host.append(buildGroupsTable(groups, ctx, pagination, host));
        host.append(buildPaginationBar(pagination, (p) => mountGroupsPanel(host, ctx, p)));
    } catch {
        host.textContent = '';
        host.append(errorLine('Could not load permission groups.'));
    }
}

/**
 * @param {Array<Record<string, unknown>>} users
 * @param {Array<Record<string, unknown>>} groups
 * @param {Record<string, unknown>} ctx
 * @param {{ page: number, page_size: number, total: number, total_pages: number }} pagination
 * @param {HTMLElement} host
 */
function buildUsersTable(users, groups, ctx, pagination, host) {
    const wrap = document.createElement('div');
    wrap.className = 'mt-md overflow-x-auto rounded-[10px] border-[1px] border-solid border-[var(--grid-line)]';

    const table = document.createElement('table');
    table.className = 'oaao-access-table w-full text-[0.8125rem] border-collapse';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Login</th>
                <th>Display name</th>
                <th>Role</th>
                <th>Group</th>
                <th>Status</th>
                <th class="oaao-access-table-actions"></th>
            </tr>
        </thead>
        <tbody></tbody>`;

    const tbody = table.querySelector('tbody');
    if (!(tbody instanceof HTMLElement)) return wrap;

    for (const user of users) {
        const tr = document.createElement('tr');
        const status = user.disabled ? 'disabled' : 'active';
        tr.innerHTML = `
            <td class="fw-medium"><button type="button" class="oaao-access-user-link">${escapeHtml(String(user.login_name || ''))}</button></td>
            <td>${escapeHtml(String(user.display_name || '—'))}</td>
            <td>${escapeHtml(String(user.role || 'user'))}</td>
            <td>${escapeHtml(String(user.permission_group_name || '—'))}</td>
            <td>${escapeHtml(status)}</td>
            <td class="oaao-access-table-actions"></td>`;
        const actions = tr.querySelector('.oaao-access-table-actions');
        if (actions instanceof HTMLElement) {
            const usageBtn = tableActionBtn(oaaoT('settings.users.usage_btn', 'Usage'));
            usageBtn.addEventListener('click', () => {
                void openUserUsageDialog(user, ctx);
            });
            const editBtn = tableActionBtn(oaaoT('settings.users.edit_btn', 'Edit'));
            editBtn.addEventListener('click', () => {
                void openUserDialog(user, groups, ctx, () => mountUsersPanel(host, ctx, pagination.page));
            });
            actions.append(usageBtn, editBtn);
        }
        const loginLink = tr.querySelector('.oaao-access-user-link');
        if (loginLink instanceof HTMLButtonElement) {
            loginLink.addEventListener('click', () => {
                void openUserUsageDialog(user, ctx);
            });
        }
        tbody.append(tr);
    }

    wrap.append(table);
    return wrap;
}

/**
 * @param {Array<Record<string, unknown>>} groups
 * @param {Record<string, unknown>} ctx
 * @param {{ page: number, page_size: number, total: number, total_pages: number }} pagination
 * @param {HTMLElement} host
 */
function buildGroupsTable(groups, ctx, pagination, host) {
    const wrap = document.createElement('div');
    wrap.className = 'mt-md overflow-x-auto rounded-[10px] border-[1px] border-solid border-[var(--grid-line)]';

    const table = document.createElement('table');
    table.className = 'oaao-access-table w-full text-[0.8125rem] border-collapse';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Name</th>
                <th>Members</th>
                <th>Status</th>
                <th>Features</th>
                <th class="oaao-access-table-actions"></th>
            </tr>
        </thead>
        <tbody></tbody>`;

    const tbody = table.querySelector('tbody');
    if (!(tbody instanceof HTMLElement)) return wrap;

    for (const group of groups) {
        const features = group.features && typeof group.features === 'object' ? group.features : {};
        const enabledFeatures = FEATURE_KEYS.filter((k) => features[k]).join(', ') || '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="fw-medium">${escapeHtml(String(group.name || ''))}</td>
            <td>${Number(group.member_count ?? 0)}</td>
            <td>${group.disabled ? 'disabled' : 'active'}</td>
            <td class="fg-[var(--grid-ink-muted)]">${escapeHtml(enabledFeatures)}</td>
            <td class="oaao-access-table-actions"></td>`;
        const actions = tr.querySelector('.oaao-access-table-actions');
        if (actions instanceof HTMLElement) {
            const editBtn = tableActionBtn('Edit');
            editBtn.addEventListener('click', () => {
                void openGroupDialog(group, ctx, () => mountGroupsPanel(host, ctx, pagination.page));
            });
            actions.append(editBtn);
        }
        tbody.append(tr);
    }

    wrap.append(table);
    return wrap;
}

/**
 * @param {Record<string, unknown>} user
 * @param {Record<string, unknown>} ctx
 */
async function openUserUsageDialog(user, ctx) {
    const Dialog = ctx.Dialog;
    if (typeof Dialog !== 'function') {
        window.alert('Dialog component unavailable.');
        return;
    }

    const uid = Number(user.user_id ?? 0);
    if (!Number.isFinite(uid) || uid < 1) return;

    const login = String(user.login_name ?? '').trim();
    const display = String(user.display_name ?? '').trim();
    const titleName = display || login || oaaoT('settings.users.usage_title', 'Usage overview');
    const title = oaaoT('settings.users.usage_title_named', '{name} — usage').replace('{name}', titleName);

    const wrap = document.createElement('div');
    wrap.className = 'min-w-0 max-h-[min(70vh,36rem)] overflow-y-auto overflow-x-hidden [padding:0.25rem_0.125rem]';

    new Dialog({
        id: `oaao-user-usage-${uid}`,
        title,
        content: wrap,
        size: 'lg',
        closable: true,
        buttons: [{ text: oaaoT('settings.users.usage_close', 'Close'), color: 'muted', role: 'cancel' }],
        onOpen(ctrl) {
            ctx.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
            void mountUserUsageOverview(wrap, `/user/api/users_dashboard?user_id=${uid}`, {
                loadingLabel: oaaoT('settings.users.usage_loading', 'Loading usage…'),
                loadFailedLabel: oaaoT('settings.users.usage_load_failed', 'Could not load usage for this user.'),
                maxWidthClass: 'max-w-full',
            });
        },
    });
}

/**
 * @param {Record<string, unknown>|null} user
 * @param {Array<Record<string, unknown>>} groups
 * @param {Record<string, unknown>} ctx
 * @param {() => void|Promise<void>} reload
 */
async function openUserDialog(user, groups, ctx, reload) {
    const Dialog = ctx.Dialog;
    if (typeof Dialog !== 'function') {
        window.alert('Dialog component unavailable.');
        return;
    }

    const isEdit = user != null;
    const wrap = document.createElement('div');
    wrap.className = '[padding:0]';

    const form = document.createElement('form');
    form.id = 'oaao-access-user-form';
    form.className = 'flex flex-col gap-2';
    form.innerHTML = `
        <label class="text-xs">Login name<input name="login_name" class="oaao-access-input" required value="${isEdit ? escapeAttr(String(user.login_name || '')) : ''}" /></label>
        <label class="text-xs">Display name<input name="display_name" class="oaao-access-input" value="${isEdit ? escapeAttr(String(user.display_name || '')) : ''}" /></label>
        <label class="text-xs">Email<input name="email" type="email" class="oaao-access-input" value="${isEdit ? escapeAttr(String(user.email || '')) : ''}" /></label>
        <label class="text-xs">${isEdit ? 'New password <span class="fg-[var(--grid-caption)]">(leave blank to keep)</span>' : 'Password'}<input name="password" type="password" autocomplete="new-password" class="oaao-access-input"${isEdit ? '' : ' required'} /></label>
        <label class="text-xs">Role<select name="role" class="oaao-access-input">
            <option value="user"${isEdit && user.role === 'user' ? ' selected' : ''}${!isEdit ? ' selected' : ''}>user</option>
            <option value="admin"${isEdit && user.role === 'admin' ? ' selected' : ''}>admin</option>
        </select></label>
        <label class="text-xs flex items-center gap-2"><input name="disabled" type="checkbox"${isEdit && user.disabled ? ' checked' : ''} /> Disabled</label>
        <label class="text-xs">Permission group<select name="permission_group_id" class="oaao-access-input">
            <option value="">— none —</option>
            ${groups.map((g) => `<option value="${Number(g.id)}"${isEdit && Number(user.permission_group_id) === Number(g.id) ? ' selected' : ''}>${escapeHtml(String(g.name || ''))}</option>`).join('')}
        </select></label>`;

    const status = document.createElement('p');
    status.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 hidden';
    status.setAttribute('role', 'status');
    form.append(status);

    if (isEdit) {
        const usageRow = document.createElement('div');
        usageRow.className = 'flex justify-end pt-1';
        const usageLink = document.createElement('button');
        usageLink.type = 'button';
        usageLink.className =
            'border-0 bg-transparent p-0 font-inherit text-xs fw-medium fg-[var(--grid-accent)] cursor-pointer hover:underline';
        usageLink.textContent = oaaoT('settings.users.usage_view_link', 'View usage overview');
        usageLink.addEventListener('click', () => {
            void openUserUsageDialog(user, ctx);
        });
        usageRow.append(usageLink);
        form.append(usageRow);
    }

    wrap.append(form);

    new Dialog({
        id: isEdit ? `oaao-access-user-${Number(user.user_id ?? 0)}` : 'oaao-access-user-create',
        title: isEdit ? 'Edit user' : 'Create user',
        content: wrap,
        size: 'md',
        closable: true,
        buttons: [
            { text: 'Cancel', color: 'muted', role: 'cancel' },
            {
                text: isEdit ? 'Save changes' : 'Create user',
                color: 'accent',
                action: async () => {
                    if (!form.reportValidity()) return false;
                    const fd = new FormData(form);
                    /** @type {Record<string, unknown>} */
                    const body = {
                        login_name: String(fd.get('login_name') || '').trim(),
                        display_name: String(fd.get('display_name') || '').trim(),
                        email: String(fd.get('email') || '').trim(),
                        password: String(fd.get('password') || ''),
                        role: String(fd.get('role') || 'user'),
                        disabled: fd.get('disabled') === 'on',
                        permission_group_id: fd.get('permission_group_id')
                            ? Number(fd.get('permission_group_id'))
                            : null,
                    };
                    if (isEdit) {
                        body.user_id = Number(user.user_id ?? 0);
                    }

                    status.classList.remove('hidden', 'fg-[var(--grid-danger)]');
                    status.classList.add('fg-[var(--grid-ink-muted)]');
                    status.textContent = isEdit ? 'Saving…' : 'Creating…';

                    try {
                        const res = await fetch('/user/api/users_save', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        const json = await res.json();
                        if (!res.ok || !json?.success) {
                            status.classList.remove('fg-[var(--grid-ink-muted)]');
                            status.classList.add('fg-[var(--grid-danger)]');
                            status.textContent = json?.message || `Save failed (${res.status})`;
                            return false;
                        }
                        await reload();
                    } catch {
                        status.classList.remove('fg-[var(--grid-ink-muted)]');
                        status.classList.add('fg-[var(--grid-danger)]');
                        status.textContent = 'Save failed.';
                        return false;
                    }
                },
            },
        ],
        onOpen(ctrl) {
            ctx.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
            const loginInput = form.querySelector('[name="login_name"]');
            if (loginInput instanceof HTMLInputElement) loginInput.focus();
        },
    });
}

/**
 * @param {Record<string, unknown>|null} group
 * @param {Record<string, unknown>} ctx
 * @param {() => void|Promise<void>} reload
 */
async function openGroupDialog(group, ctx, reload) {
    const Dialog = ctx.Dialog;
    if (typeof Dialog !== 'function') {
        window.alert('Dialog component unavailable.');
        return;
    }

    const isEdit = group != null;
    const features = isEdit && group.features && typeof group.features === 'object' ? group.features : {};
    const limits = isEdit && group.limits && typeof group.limits === 'object' ? group.limits : {};

    const wrap = document.createElement('div');
    wrap.className = '[padding:0]';

    const form = document.createElement('form');
    form.id = 'oaao-access-group-form';
    form.className = 'flex flex-col gap-2';
    form.innerHTML = `
        <label class="text-xs">Name<input name="name" class="oaao-access-input" required value="${isEdit ? escapeAttr(String(group.name || '')) : ''}" /></label>
        <label class="text-xs">Description<textarea name="description" class="oaao-access-input min-h-[4rem]">${isEdit ? escapeHtml(String(group.description || '')) : ''}</textarea></label>
        <fieldset class="border-0 p-0 m-0"><legend class="text-xs fw-medium mb-1">Features</legend>
            ${FEATURE_KEYS.map((k) => {
                const checked =
                    isEdit
                        ? Boolean(features[k])
                        : k === 'chat' || k === 'vault' || k === 'workspace';
                return `<label class="text-xs flex items-center gap-2 mr-3 inline-flex"><input type="checkbox" name="feature_${k}"${checked ? ' checked' : ''} /> ${k}</label>`;
            }).join('')}
        </fieldset>
        ${isEdit ? `<fieldset class="border-0 p-0 m-0"><legend class="text-xs fw-medium mb-1">Limits (empty = unlimited)</legend>
            ${LIMIT_KEYS.map((k) => `<label class="text-xs block mb-1">${k}<input name="limit_${k}" type="number" min="0" class="oaao-access-input" value="${limits[k] != null && limits[k] !== '' ? escapeAttr(String(limits[k])) : ''}" /></label>`).join('')}
        </fieldset>` : ''}
        ${isEdit ? `<label class="text-xs flex items-center gap-2"><input name="disabled" type="checkbox"${group.disabled ? ' checked' : ''} /> Disabled</label>` : ''}`;

    const status = document.createElement('p');
    status.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 hidden';
    status.setAttribute('role', 'status');
    form.append(status);
    wrap.append(form);

    /** @type {Array<Record<string, unknown>>} */
    const leftButtons = [];
    if (isEdit) {
        leftButtons.push({
            text: 'Delete',
            color: 'danger',
            action: async () => {
                const name = String(group.name || 'this group');
                const ok =
                    typeof Dialog.confirm === 'function'
                        ? await Dialog.confirm('Delete permission group', `<p>Delete <strong>${escapeHtml(name)}</strong>? Users in this group will lose the assignment.</p>`)
                        : window.confirm(`Delete group "${name}"?`);
                if (!ok) return false;

                try {
                    const res = await fetch('/group/api/groups_delete', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: Number(group.id ?? 0) }),
                    });
                    const json = await res.json();
                    if (!res.ok || !json?.success) {
                        status.classList.remove('hidden', 'fg-[var(--grid-ink-muted)]');
                        status.classList.add('fg-[var(--grid-danger)]');
                        status.textContent = json?.message || `Delete failed (${res.status})`;
                        return false;
                    }
                    await reload();
                } catch {
                    status.classList.remove('hidden', 'fg-[var(--grid-ink-muted)]');
                    status.classList.add('fg-[var(--grid-danger)]');
                    status.textContent = 'Delete failed.';
                    return false;
                }
            },
        });
    }

    new Dialog({
        id: isEdit ? `oaao-access-group-${Number(group.id ?? 0)}` : 'oaao-access-group-create',
        title: isEdit ? 'Edit permission group' : 'Create permission group',
        content: wrap,
        size: 'lg',
        closable: true,
        leftButtons,
        buttons: [
            { text: 'Cancel', color: 'muted', role: 'cancel' },
            {
                text: isEdit ? 'Save changes' : 'Create group',
                color: 'accent',
                action: async () => {
                    if (!form.reportValidity()) return false;
                    const fd = new FormData(form);
                    const body = readGroupForm(fd, isEdit ? Number(group.id ?? 0) : 0);

                    status.classList.remove('hidden', 'fg-[var(--grid-danger)]');
                    status.classList.add('fg-[var(--grid-ink-muted)]');
                    status.textContent = isEdit ? 'Saving…' : 'Creating…';

                    try {
                        const res = await fetch('/group/api/groups_save', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        const json = await res.json();
                        if (!res.ok || !json?.success) {
                            status.classList.remove('fg-[var(--grid-ink-muted)]');
                            status.classList.add('fg-[var(--grid-danger)]');
                            status.textContent = json?.message || `Save failed (${res.status})`;
                            return false;
                        }
                        await reload();
                    } catch {
                        status.classList.remove('fg-[var(--grid-ink-muted)]');
                        status.classList.add('fg-[var(--grid-danger)]');
                        status.textContent = 'Save failed.';
                        return false;
                    }
                },
            },
        ],
        onOpen(ctrl) {
            ctx.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
            const nameInput = form.querySelector('[name="name"]');
            if (nameInput instanceof HTMLInputElement) nameInput.focus();
        },
    });
}

/** @param {string} label @param {() => void} onClick */
function buildCreateToolbar(label, onClick) {
    const toolbar = document.createElement('div');
    toolbar.className = 'flex flex-row justify-end mb-md';
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
 * @param {unknown} raw
 * @param {number} fallbackPage
 */
function normalizePagination(raw, fallbackPage) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const page = Math.max(1, Number(p.page ?? fallbackPage) || fallbackPage);
    const pageSize = Math.max(1, Number(p.page_size ?? PAGE_SIZE) || PAGE_SIZE);
    const total = Math.max(0, Number(p.total ?? 0) || 0);
    const totalPages = Math.max(1, Number(p.total_pages ?? 1) || 1);
    return { page, page_size: pageSize, total, total_pages: totalPages };
}

/**
 * @param {{ page: number, page_size: number, total: number, total_pages: number }} pagination
 * @param {(page: number) => void|Promise<void>} onPage
 */
function buildPaginationBar(pagination, onPage) {
    const bar = document.createElement('div');
    bar.className =
        'mt-md flex flex-wrap items-center justify-between gap-2 text-xs fg-[var(--grid-ink-muted)]';

    const start = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
    const end = Math.min(pagination.page * pagination.page_size, pagination.total);

    const summary = document.createElement('span');
    summary.textContent =
        pagination.total === 0
            ? 'No rows'
            : `Showing ${start}–${end} of ${pagination.total}`;

    const controls = document.createElement('div');
    controls.className = 'flex items-center gap-2';

    const prev = paginationBtn('Previous', pagination.page <= 1);
    prev.addEventListener('click', () => {
        if (pagination.page > 1) void onPage(pagination.page - 1);
    });

    const label = document.createElement('span');
    label.textContent = `Page ${pagination.page} of ${pagination.total_pages}`;

    const next = paginationBtn('Next', pagination.page >= pagination.total_pages);
    next.addEventListener('click', () => {
        if (pagination.page < pagination.total_pages) void onPage(pagination.page + 1);
    });

    controls.append(prev, label, next);
    bar.append(summary, controls);
    return bar;
}

/** @param {string} label @param {boolean} disabled */
function paginationBtn(label, disabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.disabled = disabled;
    btn.textContent = label;
    btn.className =
        'rounded-[6px] h-8 px-2.5 text-xs fw-medium fg-[var(--grid-ink)] bg-transparent border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[rgba(55,53,47,0.04)] disabled:opacity-40 disabled:cursor-default';
    return btn;
}

/** @param {string} label */
function tableActionBtn(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className =
        'px-2 py-1 fw-medium fg-[var(--grid-accent)] hover:bg-[rgba(55,53,47,0.06)] bg-transparent border-0 cursor-pointer font-inherit leading-none whitespace-nowrap';
    return btn;
}

/** @param {FormData} fd @param {number} id */
function readGroupForm(fd, id) {
    /** @type {Record<string, boolean>} */
    const features = {};
    for (const k of FEATURE_KEYS) {
        features[k] = fd.get(`feature_${k}`) === 'on';
    }
    /** @type {Record<string, number|null>} */
    const limits = {};
    for (const k of LIMIT_KEYS) {
        const raw = String(fd.get(`limit_${k}`) ?? '').trim();
        limits[k] = raw === '' ? null : Math.max(0, Number(raw));
    }
    return {
        id: id > 0 ? id : undefined,
        name: String(fd.get('name') || '').trim(),
        description: String(fd.get('description') || '').trim(),
        disabled: fd.get('disabled') === 'on',
        features,
        limits,
    };
}

function sectionTitle(text, extra = '') {
    const el = document.createElement('div');
    el.className = `oaao-sdlg-section-title mb-sm ${extra}`.trim();
    el.textContent = text;
    return el;
}

/**
 * @param {Array<Record<string, unknown>>} invitations
 * @param {Record<string, unknown>} ctx
 * @param {() => void|Promise<void>} reload
 */
function buildInvitationsTable(invitations, ctx, reload) {
    const wrap = document.createElement('div');
    wrap.className =
        'mb-md overflow-x-auto rounded-[10px] border-[1px] border-solid border-[var(--grid-line)]';

    const table = document.createElement('table');
    table.className = 'oaao-access-table w-full text-[0.8125rem] border-collapse';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th class="oaao-access-table-actions"></th>
            </tr>
        </thead>
        <tbody></tbody>`;

    const tbody = table.querySelector('tbody');
    if (!(tbody instanceof HTMLElement)) return wrap;

    for (const inv of invitations) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(String(inv.email || ''))}</td>
            <td>${escapeHtml(String(inv.role || 'user'))}</td>
            <td>${escapeHtml(String(inv.expires_at || '—'))}</td>
            <td class="oaao-access-table-actions"></td>`;
        const actions = tr.querySelector('.oaao-access-table-actions');
        const iid = Number(inv.invitation_id ?? 0);
        if (actions instanceof HTMLElement && iid > 0) {
            const resendBtn = tableActionBtn('Resend');
            resendBtn.addEventListener('click', () => {
                void (async () => {
                    try {
                        const res = await fetch('/user/api/users_invite_resend', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ invitation_id: iid }),
                        });
                        const json = await res.json().catch(() => ({}));
                        if (json?.success && !json?.mail_sent && json?.register_url) {
                            openInviteRegisterLinkDialog(String(json.register_url), String(inv.email || ''));
                        }
                    } finally {
                        await reload();
                    }
                })();
            });
            const revokeBtn = tableActionBtn('Revoke');
            revokeBtn.addEventListener('click', () => {
                void fetch('/user/api/users_invite_revoke', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ invitation_id: iid }),
                }).then(() => reload());
            });
            actions.append(resendBtn, revokeBtn);
        }
        tbody.append(tr);
    }

    wrap.append(table);
    return wrap;
}

/**
 * @param {Array<Record<string, unknown>>} groups
 * @param {Record<string, unknown>} ctx
 * @param {() => void|Promise<void>} reload
 */
async function openInviteDialog(groups, ctx, reload) {
    const Dialog = ctx.Dialog;
    if (typeof Dialog !== 'function') {
        window.alert('Dialog component unavailable.');
        return;
    }

    const wrap = document.createElement('div');
    wrap.className = '[padding:0]';
    const form = document.createElement('form');
    form.className = 'flex flex-col gap-2';
    form.innerHTML = `
        <label class="text-xs">Email<input name="email" type="email" class="oaao-access-input" required /></label>
        <label class="text-xs">Role<select name="role" class="oaao-access-input">
            <option value="user" selected>user</option>
            <option value="admin">admin</option>
        </select></label>
        <label class="text-xs">Permission group<select name="permission_group_id" class="oaao-access-input">
            <option value="">— none —</option>
            ${groups.map((g) => `<option value="${Number(g.id)}">${escapeHtml(String(g.name || ''))}</option>`).join('')}
        </select></label>`;

    const status = document.createElement('p');
    status.className = 'text-xs fg-[var(--grid-ink-muted)] m-0 hidden';
    status.setAttribute('role', 'status');
    form.append(status);
    wrap.append(form);

    new Dialog({
        id: 'oaao-access-user-invite',
        title: 'Send invitation',
        content: wrap,
        size: 'md',
        closable: true,
        buttons: [
            { text: 'Cancel', color: 'muted', role: 'cancel' },
            {
                text: 'Send invitation',
                color: 'accent',
                action: async () => {
                    if (!form.reportValidity()) return false;
                    const fd = new FormData(form);
                    const body = {
                        email: String(fd.get('email') || '').trim(),
                        role: String(fd.get('role') || 'user'),
                        permission_group_id: fd.get('permission_group_id')
                            ? Number(fd.get('permission_group_id'))
                            : null,
                    };
                    status.classList.remove('hidden', 'fg-[var(--grid-danger)]');
                    status.classList.add('fg-[var(--grid-ink-muted)]');
                    status.textContent = 'Sending…';
                    try {
                        const res = await fetch('/user/api/users_invite', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        const json = await res.json();
                        if (!res.ok || !json?.success) {
                            status.classList.remove('fg-[var(--grid-ink-muted)]');
                            status.classList.add('fg-[var(--grid-danger)]');
                            status.textContent = json?.message || `Invite failed (${res.status})`;
                            return false;
                        }
                        if (!json?.mail_sent && json?.register_url) {
                            openInviteRegisterLinkDialog(String(json.register_url), String(body.email || ''));
                        }
                        await reload();
                        return true;
                    } catch {
                        status.classList.remove('fg-[var(--grid-ink-muted)]');
                        status.classList.add('fg-[var(--grid-danger)]');
                        status.textContent = 'Invite failed.';
                        return false;
                    }
                },
            },
        ],
        onOpen(ctrl) {
            ctx.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
            const emailInput = form.querySelector('[name="email"]');
            if (emailInput instanceof HTMLInputElement) emailInput.focus();
        },
    });
}

/**
 * Dev / no-SMTP: API returns register_url when OAAO_MAIL_ENABLED is off.
 *
 * @param {string} registerUrl
 * @param {string} [email]
 */
function openInviteRegisterLinkDialog(registerUrl, email = '') {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-3 min-w-0';
    const hintEl = document.createElement('p');
    hintEl.className = 'text-sm fg-[var(--grid-ink-muted)] m-0';
    hintEl.textContent = oaaoT(
        'access.invite.no_mail_hint',
        'Email delivery is off. Copy this registration link and send it to the invitee.',
    );
    if (email) {
        const em = document.createElement('p');
        em.className = 'text-sm fg-[var(--grid-ink)] m-0';
        em.textContent = email;
        wrap.append(em);
    }
    wrap.append(hintEl);
    const code = document.createElement('code');
    code.className =
        'block text-[0.72rem] fg-[var(--grid-ink-muted)] whitespace-pre-wrap break-all bg-[var(--grid-panel)] rounded-[8px] px-2 py-2 border-[1px] border-solid border-[var(--grid-line)]';
    code.textContent = registerUrl;
    wrap.append(code);

    new Dialog({
        id: 'oaao-access-invite-link',
        title: oaaoT('access.invite.link_dialog_title', 'Share invitation link'),
        content: wrap,
        size: 'md',
        closable: true,
        buttons: [
            {
                text: oaaoT('access.invite.copy_link', 'Copy invite link'),
                color: 'accent',
                action: async () => {
                    try {
                        await navigator.clipboard.writeText(registerUrl);
                        hintEl.textContent = oaaoT('access.invite.link_copied', 'Link copied.');
                    } catch {
                        hintEl.textContent = oaaoT(
                            'access.invite.copy_failed',
                            'Could not copy — select the URL manually.',
                        );
                    }
                    return false;
                },
            },
            { text: 'Close', color: 'muted', role: 'cancel' },
        ],
    });
}

function hint(text, extra = '') {
    const el = document.createElement('p');
    el.className = `text-xs fg-[var(--grid-ink-muted)] mb-md ${extra}`.trim();
    el.textContent = text;
    return el;
}

function errorLine(text) {
    const el = document.createElement('p');
    el.className = 'text-sm fg-[var(--grid-danger)]';
    el.textContent = text;
    return el;
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

if (typeof document !== 'undefined' && !document.getElementById('oaao-access-panel-style')) {
    const style = document.createElement('style');
    style.id = 'oaao-access-panel-style';
    style.textContent = `
        .oaao-access-input {
            display: block;
            width: 100%;
            max-width: 28rem;
            margin-top: 0.25rem;
            border-radius: 8px;
            height: 2.25rem;
            padding: 0 0.65rem;
            font-size: 0.8125rem;
            font-family: inherit;
            color: var(--grid-ink);
            background: var(--grid-paper);
            border: 1px solid var(--grid-line);
            box-sizing: border-box;
        }
        textarea.oaao-access-input { height: auto; padding: 0.5rem 0.65rem; }
        .oaao-access-table th,
        .oaao-access-table td {
            padding: 0.65rem 0.75rem;
            text-align: left;
            border-bottom: 1px solid var(--grid-line);
            vertical-align: middle;
        }
        .oaao-access-table thead th {
            font-weight: 600;
            color: var(--grid-caption);
            background: var(--grid-nav);
        }
        .oaao-access-table tbody tr:last-child td { border-bottom: 0; }
        .oaao-access-table-actions { width: 8.5rem; text-align: right; white-space: nowrap; }
        .oaao-access-user-link {
            border: 0;
            background: transparent;
            padding: 0;
            font: inherit;
            font-weight: 500;
            color: var(--grid-ink);
            cursor: pointer;
            text-align: left;
        }
        .oaao-access-user-link:hover { color: var(--grid-accent); text-decoration: underline; }
    `;
    document.head.append(style);
}
