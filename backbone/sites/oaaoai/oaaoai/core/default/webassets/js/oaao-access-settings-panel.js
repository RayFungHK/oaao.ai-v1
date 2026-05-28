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
            hint('Invite users by email (they set their own password). Edit existing accounts below.'),
        );
        host.append(
            buildCreateToolbar('Invite user', () => {
                void openInviteDialog(groups, ctx, () => mountUsersPanel(host, ctx, 1));
            }),
        );
        host.append(await buildPendingInvitationsBlock(ctx, () => mountUsersPanel(host, ctx, page)));

        if (users.length === 0) {
            host.append(hint('No users yet.', 'mt-md'));
            host.append(buildPaginationBar(pagination, (p) => mountUsersPanel(host, ctx, p)));
            return;
        }

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
                <th>${escapeHtml(oaaoT('settings.users.credits_col', 'Credits'))}</th>
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
        const creditsCell = user.credits_unlimited
            ? oaaoT('preferences.dashboard.unlimited', 'Unlimited')
            : String(Number(user.credit_balance ?? 0).toFixed(2));
        tr.innerHTML = `
            <td class="fw-medium"><button type="button" class="oaao-access-user-link">${escapeHtml(String(user.login_name || ''))}</button></td>
            <td>${escapeHtml(String(user.display_name || '—'))}</td>
            <td>${escapeHtml(String(user.role || 'user'))}</td>
            <td>${escapeHtml(String(user.permission_group_name || '—'))}</td>
            <td class="font-mono text-xs">${escapeHtml(creditsCell)}</td>
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
        <label class="text-xs">Email<input name="email" type="email" class="oaao-access-input" required autocomplete="email" /></label>
        <label class="text-xs">Role<select name="role" class="oaao-access-input">
            <option value="user" selected>user</option>
            <option value="admin">admin</option>
        </select></label>
        <label class="text-xs">Permission group<select name="permission_group_id" class="oaao-access-input">
            <option value="">— none —</option>
            ${groups.map((g) => `<option value="${Number(g.id)}">${escapeHtml(String(g.name || ''))}</option>`).join('')}
        </select></label>`;

    const status = document.createElement('p');
    status.className = 'text-xs fg-[var(--grid-ink-muted)] m-0';
    status.setAttribute('role', 'status');
    form.append(status);

    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        status.textContent = 'Sending…';
        const fd = new FormData(form);
        const body = {
            email: String(fd.get('email') || '').trim(),
            role: String(fd.get('role') || 'user'),
        };
        const gid = String(fd.get('permission_group_id') || '').trim();
        if (gid) body.permission_group_id = Number(gid);

        try {
            const res = await fetch('/user/api/users_invite', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!res.ok || !json?.success) {
                status.textContent = json?.message || `HTTP ${res.status}`;
                return;
            }
            if (json.register_url) {
                status.textContent = `Invitation created. Dev link: ${json.register_url}`;
            } else {
                status.textContent = json.mail_sent
                    ? 'Invitation email sent.'
                    : 'Invitation created (enable OAAO_MAIL_ENABLED to send email).';
            }
            await reload();
        } catch {
            status.textContent = 'Could not send invitation.';
        }
    });

    wrap.append(form);

    new Dialog({
        id: 'oaao-access-invite-user',
        title: 'Invite user',
        content: wrap,
        size: 'sm',
        closable: true,
        buttons: [
            { text: 'Cancel', color: 'muted', role: 'cancel' },
            {
                text: 'Send invitation',
                color: 'primary',
                role: 'confirm',
                onClick: () => form.requestSubmit(),
            },
        ],
        onOpen(ctrl) {
            ctx.JIT?.hydrate?.(/** @type {HTMLElement} */ (ctrl.body ?? wrap));
        },
    });
}

/**
 * @param {Record<string, unknown>} ctx
 * @param {() => void|Promise<void>} reload
 */
async function buildPendingInvitationsBlock(ctx, reload) {
    const section = document.createElement('div');
    section.className = 'mt-md';
    section.append(sectionTitle('Pending invitations'));

    try {
        const res = await fetch('/user/api/users_invitations_list', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        const json = await res.json();
        const items = Array.isArray(json?.data?.invitations) ? json.data.invitations : [];
        if (!res.ok || !json?.success || items.length === 0) {
            section.append(hint('No pending invitations.'));
            return section;
        }

        const table = document.createElement('table');
        table.className = 'oaao-access-table w-full text-sm mt-2';
        table.innerHTML = `<thead><tr><th>Email</th><th>Role</th><th>Expires</th><th></th></tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        for (const inv of items) {
            const tr = document.createElement('tr');
            const email = escapeHtml(String(inv.email || ''));
            const role = escapeHtml(String(inv.role || 'user'));
            const exp = escapeHtml(String(inv.expires_at || ''));
            tr.innerHTML = `<td>${email}</td><td>${role}</td><td class="fg-[var(--grid-ink-muted)]">${exp}</td><td class="oaao-access-table-actions"></td>`;
            const actions = tr.querySelector('.oaao-access-table-actions');
            if (actions instanceof HTMLElement) {
                const revokeBtn = tableActionBtn('Revoke');
                revokeBtn.addEventListener('click', async () => {
                    await fetch('/user/api/users_invite_revoke', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ invitation_id: Number(inv.invitation_id) }),
                    });
                    await reload();
                });
                const resendBtn = tableActionBtn('Resend');
                resendBtn.addEventListener('click', async () => {
                    const r = await fetch('/user/api/users_invite_resend', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ invitation_id: Number(inv.invitation_id) }),
                    });
                    const j = await r.json();
                    if (j?.register_url) window.alert(j.register_url);
                    await reload();
                });
                actions.append(resendBtn, revokeBtn);
            }
            tbody?.append(tr);
        }
        section.append(table);
    } catch {
        section.append(hint('Could not load pending invitations.'));
    }

    return section;
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
        ${isEdit ? '<label class="text-xs">New password <span class="fg-[var(--grid-caption)]">(leave blank to keep)</span><input name="password" type="password" autocomplete="new-password" class="oaao-access-input" /></label>' : ''}
        <label class="text-xs">Role<select name="role" class="oaao-access-input">
            <option value="user"${isEdit && user.role === 'user' ? ' selected' : ''}${!isEdit ? ' selected' : ''}>user</option>
            <option value="admin"${isEdit && user.role === 'admin' ? ' selected' : ''}>admin</option>
        </select></label>
        <label class="text-xs flex items-center gap-2"><input name="disabled" type="checkbox"${isEdit && user.disabled ? ' checked' : ''} /> Disabled</label>
        <label class="text-xs">Permission group<select name="permission_group_id" class="oaao-access-input">
            <option value="">— none —</option>
            ${groups.map((g) => `<option value="${Number(g.id)}"${isEdit && Number(user.permission_group_id) === Number(g.id) ? ' selected' : ''}>${escapeHtml(String(g.name || ''))}</option>`).join('')}
        </select></label>
        ${isEdit ? `<label class="text-xs flex flex-col gap-0.5"><span>${escapeHtml(oaaoT('settings.users.credit_balance', 'Credit balance'))}</span><span class="fg-[var(--grid-caption)] font-normal">${escapeHtml(oaaoT('settings.users.credit_balance_hint', 'Leave empty for unlimited. 0 blocks new chat sends.'))}</span><input name="credit_balance" type="text" inputmode="decimal" autocomplete="off" class="oaao-access-input font-mono" placeholder="${escapeHtml(oaaoT('preferences.dashboard.unlimited', 'Unlimited'))}" value="${user.credits_unlimited ? '' : escapeAttr(String(user.credit_balance ?? ''))}" /></label>` : ''}`;

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
                        const creditRaw = String(fd.get('credit_balance') ?? '').trim();
                        body.credit_balance = creditRaw === '' ? null : creditRaw;
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

function sectionTitle(text) {
    const el = document.createElement('div');
    el.className = 'oaao-sdlg-section-title mb-sm';
    el.textContent = text;
    return el;
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
