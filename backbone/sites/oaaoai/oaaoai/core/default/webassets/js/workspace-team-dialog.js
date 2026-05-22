/**
 * Workspace team management dialog — rename, delete, members, invites (Open WebUI-style team panel).
 * {@see wireWorkspaceFolderPicker} opens via gear control next to each workspace row.
 */

/**
 * @param {string} token
 */
function buildWorkspaceInviteLandingUrl(token) {
    const u = new URL(window.location.href);
    u.searchParams.set('workspace_invite_token', token);

    return u.toString();
}

/**
 * @param {Element | null | undefined} el
 * @param {string} jitSpaceSeparated
 */
function applyJitTokens(el, jitSpaceSeparated) {
    if (!el || !jitSpaceSeparated) return;
    for (const token of jitSpaceSeparated.split(/\s+/).filter(Boolean)) {
        if (token) el.classList.add(token);
    }
}

/**
 * @param {(action: string) => string} api
 * @param {number} workspaceId
 */
async function fetchWorkspaceTeam(api, workspaceId) {
    const u = new URL(api('workspace_team'), window.location.href);
    u.searchParams.set('workspace_id', String(workspaceId));
    const res = await fetch(u.href, { credentials: 'include', headers: { Accept: 'application/json' } });

    return /** @type {{ success?: boolean, message?: string, my_role?: string, members?: unknown, invitations?: unknown, name?: string }} */ (
        await res.json().catch(() => ({}))
    );
}

/**
 * @param {*} razyui
 * @param {{
 *   workspaceId: number,
 *   workspaceName: string,
 *   myRole: string,
 *   api: (action: string) => string,
 *   onTeamChanged?: () => void,
 *   syncActiveWorkspaceRename?: (workspaceId: number, name: string) => void,
 *   clearActiveWorkspaceIfDeleted?: (workspaceId: number) => void,
 * }} opts
 */
export async function openWorkspaceTeamDialog(razyui, opts) {
    const dialogHref = new URL('../razyui/component/Dialog.js', import.meta.url).href;
    const [DialogMod, JITModule] = await Promise.all([import(dialogHref), razyui.load('JIT')]);
    const Dialog = DialogMod?.default;
    const JIT = JITModule && typeof JITModule.hydrate === 'function' ? JITModule : null;

    if (typeof Dialog !== 'function') {
        console.error('[oaao] workspace-team-dialog: Dialog missing', DialogMod);

        return;
    }

    const {
        workspaceId,
        workspaceName,
        myRole,
        api,
        onTeamChanged,
        syncActiveWorkspaceRename,
        clearActiveWorkspaceIfDeleted,
    } = opts;
    const isOwner = String(myRole || '').toLowerCase() === 'owner';

    /** @type {{ close?: () => void }} */
    let dialogCtrl = {};

    const shell = document.createElement('div');
    shell.className =
        'flex flex-col gap-0 min-h-0 max-h-[min(72vh,560px)] overflow-hidden px-1 py-1';

    const scrollMain = document.createElement('div');
    scrollMain.className =
        'flex flex-col gap-md min-h-0 flex-1 overflow-y-auto overscroll-contain min-w-0';

    shell.append(scrollMain);

    const status = document.createElement('p');
    status.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0';
    scrollMain.append(status);

    function setStatus(msg, isErr = false) {
        status.textContent = msg;
        status.classList.toggle('fg-red-600', isErr);
        status.classList.toggle('fg-[var(--grid-caption)]', !isErr);
    }

    if (isOwner) {
        const hRename = document.createElement('div');
        hRename.className = 'text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold';
        hRename.textContent = 'Rename';
        scrollMain.append(hRename);

        const renameRow = document.createElement('div');
        renameRow.className = 'flex flex-wrap items-center gap-2 min-w-0';
        const renameIn = document.createElement('input');
        renameIn.type = 'text';
        renameIn.maxLength = 120;
        renameIn.value = workspaceName;
        renameIn.className =
            'flex-1 min-w-[12rem] rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] px-3 py-2 text-[0.875rem] fg-[var(--grid-ink)] bg-[var(--grid-paper)] font-inherit box-border';
        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.textContent = 'Save';
        renameBtn.className =
            'rounded-[10px] px-4 py-2 text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25';
        renameBtn.addEventListener('click', () => {
            void (async () => {
                const nm = renameIn.value.trim();
                if (!nm) return;
                renameBtn.disabled = true;
                try {
                    const res = await fetch(api('workspace_update'), {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({ workspace_id: workspaceId, name: nm }),
                    });
                    const data = /** @type {{ success?: boolean, message?: string }} */ (await res.json().catch(() => ({})));
                    if (!res.ok || !data.success) {
                        setStatus(data.message || 'Rename failed', true);

                        return;
                    }
                    setStatus('Workspace renamed.');
                    syncActiveWorkspaceRename?.(workspaceId, nm);
                    onTeamChanged?.();
                } finally {
                    renameBtn.disabled = false;
                }
            })();
        });
        renameRow.append(renameIn, renameBtn);
        scrollMain.append(renameRow);
    }

    const hMem = document.createElement('div');
    hMem.className =
        'text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold mt-md pt-md border-t-[1px] border-solid border-[var(--grid-line)]';
    hMem.textContent = 'Members';
    scrollMain.append(hMem);

    const memHost = document.createElement('div');
    memHost.className = 'flex flex-col gap-1 min-w-0';
    scrollMain.append(memHost);

    const hInv = document.createElement('div');
    hInv.className =
        'text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold mt-md pt-md border-t-[1px] border-solid border-[var(--grid-line)]';
    hInv.textContent = 'Pending invitations';
    scrollMain.append(hInv);

    const invHost = document.createElement('div');
    invHost.className = 'flex flex-col gap-2 min-w-0';
    scrollMain.append(invHost);

    if (isOwner) {
        const inviteRow = document.createElement('div');
        inviteRow.className = 'flex flex-wrap items-center gap-2 min-w-0 mt-sm';
        const emailIn = document.createElement('input');
        emailIn.type = 'email';
        emailIn.placeholder = 'colleague@company.com';
        emailIn.autocomplete = 'off';
        emailIn.className =
            'flex-1 min-w-[12rem] rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] px-3 py-2 text-[0.875rem] fg-[var(--grid-ink)] bg-[var(--grid-paper)] font-inherit box-border';
        const inviteBtn = document.createElement('button');
        inviteBtn.type = 'button';
        inviteBtn.textContent = 'Invite';
        inviteBtn.className =
            'rounded-[10px] px-4 py-2 text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-panel-bright)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25';

        const inviteLinkWrap = document.createElement('div');
        inviteLinkWrap.className = 'hidden flex flex-col gap-1 min-w-0';
        const inviteLink = document.createElement('code');
        inviteLink.className =
            'block text-[0.72rem] fg-[var(--grid-ink-muted)] whitespace-pre-wrap break-all bg-[var(--grid-panel)] rounded-[8px] px-2 py-2 border-[1px] border-solid border-[var(--grid-line)]';
        const inviteCopy = document.createElement('button');
        inviteCopy.type = 'button';
        inviteCopy.textContent = 'Copy invite link';
        inviteCopy.dataset.clipboard = '';
        inviteCopy.className =
            'self-start rounded-[8px] px-3 py-1.5 text-[0.75rem] fw-medium fg-[var(--grid-accent)] bg-transparent border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/20';
        inviteCopy.addEventListener('click', async () => {
            const t = inviteCopy.dataset.clipboard || '';
            if (!t) return;
            try {
                await navigator.clipboard.writeText(t);
                setStatus('Link copied.');
            } catch {
                setStatus('Could not copy — select the URL manually.', true);
            }
        });
        inviteLinkWrap.append(inviteLink, inviteCopy);

        inviteBtn.addEventListener('click', () => {
            void (async () => {
                const em = emailIn.value.trim();
                if (!em) return;
                inviteBtn.disabled = true;
                try {
                    const res = await fetch(api('workspace_member_invite'), {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({ workspace_id: workspaceId, email: em }),
                    });
                    const data = /** @type {{ success?: boolean, mode?: string, message?: string, token?: string }} */ (
                        await res.json().catch(() => ({}))
                    );
                    if (!res.ok || !data.success) {
                        setStatus(data.message || 'Invite failed', true);

                        return;
                    }
                    if (data.mode === 'invite_created' && typeof data.token === 'string' && data.token) {
                        const link = buildWorkspaceInviteLandingUrl(data.token);
                        setStatus(`Invitation created — share this link with ${em}`);
                        inviteLink.textContent = link;
                        inviteLinkWrap.classList.remove('hidden');
                        inviteCopy.dataset.clipboard = link;
                    } else {
                        inviteLinkWrap.classList.add('hidden');
                        setStatus(data.mode === 'already_member' ? 'Already a member.' : 'Member added.');
                    }
                    emailIn.value = '';
                    await renderTeam();
                    onTeamChanged?.();
                } finally {
                    inviteBtn.disabled = false;
                }
            })();
        });
        inviteRow.append(emailIn, inviteBtn);

        scrollMain.insertBefore(inviteRow, hInv);
        scrollMain.insertBefore(inviteLinkWrap, hInv);
    } else {
        hInv.classList.add('hidden');
        invHost.classList.add('hidden');
    }

    if (isOwner) {
        const dangerFooter = document.createElement('div');
        dangerFooter.className =
            'shrink-0 mt-2 pt-3 pb-1 border-t-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]';

        const hDanger = document.createElement('div');
        hDanger.className =
            'text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold mb-2';
        hDanger.textContent = 'Danger zone';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = 'Delete workspace…';
        delBtn.className =
            'rounded-[10px] px-4 py-2 text-[0.8125rem] fw-semibold fg-white bg-red-600 border-none cursor-pointer font-inherit hover:opacity-90 w-fit';
        delBtn.addEventListener('click', () => {
            void (async () => {
                const warn = document.createElement('div');
                warn.className = 'flex flex-col gap-2 text-[0.875rem]';
                const p = document.createElement('p');
                p.className = 'm-0 leading-snug fg-[var(--rui-text)]';
                const strong = document.createElement('strong');
                strong.textContent = workspaceName;
                p.append(
                    'This permanently deletes ',
                    strong,
                    ' and removes all chats bound to this workspace. This cannot be undone.',
                );
                warn.append(p);

                const ok = await Dialog.confirm('Delete workspace?', warn, {
                    size: 'sm',
                    overlayClose: false,
                    buttons: [
                        { text: 'Cancel', color: 'muted', role: 'cancel' },
                        { text: 'Delete workspace', color: 'danger', role: 'confirm' },
                    ],
                });
                if (!ok) return;

                delBtn.disabled = true;
                try {
                    const res = await fetch(api('workspace_delete'), {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({ workspace_id: workspaceId }),
                    });
                    const data = /** @type {{ success?: boolean, message?: string }} */ (await res.json().catch(() => ({})));
                    if (!res.ok || !data.success) {
                        setStatus(data.message || 'Delete failed', true);

                        return;
                    }
                    clearActiveWorkspaceIfDeleted?.(workspaceId);
                    onTeamChanged?.();
                    setStatus('Workspace deleted.');
                    window.setTimeout(() => {
                        dialogCtrl.close?.();
                    }, 320);
                } finally {
                    delBtn.disabled = false;
                }
            })();
        });

        dangerFooter.append(hDanger, delBtn);
        shell.append(dangerFooter);
    }

    async function renderTeam() {
        const team = await fetchWorkspaceTeam(api, workspaceId);
        if (!team.success) {
            setStatus(team.message || 'Could not load team', true);

            return;
        }

        memHost.textContent = '';
        /** @type {unknown[]} */
        const members = Array.isArray(team.members) ? team.members : [];
        for (const m of members) {
            if (!m || typeof m !== 'object') continue;
            const o = /** @type {Record<string, unknown>} */ (m);
            const uid = Number(o.user_id ?? 0);
            const mail = String(o.email ?? '').trim();
            const dn = String(o.display_name ?? '').trim();
            const role = String(o.role ?? '').trim();
            const line = document.createElement('div');
            line.className =
                'flex flex-wrap items-center justify-between gap-2 rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] px-3 py-2 bg-[var(--grid-paper)]';
            const left = document.createElement('div');
            left.className = 'min-w-0 flex flex-col gap-0.5';
            const t = document.createElement('span');
            t.className = 'text-[0.8125rem] fg-[var(--grid-ink)] truncate';
            t.textContent = dn || mail || `User #${uid}`;
            const sub = document.createElement('span');
            sub.className = 'text-[0.72rem] fg-[var(--grid-caption)] truncate';
            sub.textContent = [mail, role ? `· ${role}` : ''].filter(Boolean).join(' ');
            left.append(t, sub);
            line.append(left);

            if (isOwner && role !== 'owner' && uid > 0) {
                const rm = document.createElement('button');
                rm.type = 'button';
                rm.textContent = 'Remove';
                rm.className =
                    'shrink-0 rounded-[8px] px-2 py-1 text-[0.72rem] fg-red-600 bg-transparent border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/20';
                rm.addEventListener('click', () => {
                    if (!window.confirm(`Remove ${dn || mail || `#${uid}`} from this workspace?`)) return;
                    void (async () => {
                        rm.disabled = true;
                        try {
                            const res = await fetch(api('workspace_member_remove'), {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                body: JSON.stringify({ workspace_id: workspaceId, user_id: uid }),
                            });
                            const data = /** @type {{ success?: boolean, message?: string }} */ (
                                await res.json().catch(() => ({}))
                            );
                            if (!res.ok || !data.success) {
                                setStatus(data.message || 'Remove failed', true);

                                return;
                            }
                            setStatus('Member removed.');
                            await renderTeam();
                            onTeamChanged?.();
                        } finally {
                            rm.disabled = false;
                        }
                    })();
                });
                line.append(rm);
            }

            memHost.append(line);
        }

        invHost.textContent = '';
        /** @type {unknown[]} */
        const invites = Array.isArray(team.invitations) ? team.invitations : [];
        if (!isOwner || invites.length === 0) {
            invHost.classList.toggle('hidden', !isOwner || invites.length === 0);
            hInv.classList.toggle('hidden', !isOwner || invites.length === 0);

            return;
        }

        invHost.classList.remove('hidden');
        hInv.classList.remove('hidden');

        for (const inv of invites) {
            if (!inv || typeof inv !== 'object') continue;
            const o = /** @type {Record<string, unknown>} */ (inv);
            const iid = Number(o.invitation_id ?? 0);
            const em = String(o.invitee_email ?? '').trim();
            const exp = String(o.expires_at ?? '').trim();
            const wrap = document.createElement('div');
            wrap.className =
                'flex flex-wrap items-center justify-between gap-2 rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] px-3 py-2 bg-[var(--grid-panel)]';
            const lt = document.createElement('div');
            lt.className = 'min-w-0 flex flex-col gap-0.5';
            const emEl = document.createElement('span');
            emEl.className = 'text-[0.8125rem] fg-[var(--grid-ink)] truncate';
            emEl.textContent = em;
            const expEl = document.createElement('span');
            expEl.className = 'text-[0.72rem] fg-[var(--grid-caption)]';
            expEl.textContent = exp ? `Expires ${exp}` : '';
            lt.append(emEl, expEl);
            wrap.append(lt);
            const rv = document.createElement('button');
            rv.type = 'button';
            rv.textContent = 'Revoke';
            rv.className =
                'shrink-0 rounded-[8px] px-2 py-1 text-[0.72rem] fg-[var(--grid-ink)] bg-transparent border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/20';
            rv.addEventListener('click', () => {
                void (async () => {
                    rv.disabled = true;
                    try {
                        const res = await fetch(api('workspace_invitation_revoke'), {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                            body: JSON.stringify({ invitation_id: iid }),
                        });
                        const data = /** @type {{ success?: boolean, message?: string }} */ (
                            await res.json().catch(() => ({}))
                        );
                        if (!res.ok || !data.success) {
                            setStatus(data.message || 'Revoke failed', true);

                            return;
                        }
                        await renderTeam();
                        onTeamChanged?.();
                    } finally {
                        rv.disabled = false;
                    }
                })();
            });
            wrap.append(rv);
            invHost.append(wrap);
        }
    }

    new Dialog({
        id: 'oaao-workspace-team-dialog',
        title: `Manage · ${workspaceName}`,
        content: shell,
        size: 'lg',
        height: 'min(620px, calc(100vh - 4rem))',
        closable: true,
        buttons: [],
        onOpen(c) {
            dialogCtrl = c;
            const overlay = c.body?.closest('.dialog-overlay');
            const box = c.dialog;
            applyJitTokens(box, 'overflow-hidden bg-[var(--grid-panel-bright)] rounded-[12px]');
            applyJitTokens(c.body, 'flex flex-col flex-1 min-h-0 overflow-hidden [padding:12px]');
            try {
                JIT?.hydrate(overlay ?? c.body ?? shell);
                JIT?.hydrate(shell);
            } catch {
                /* ignore */
            }
            void renderTeam().then(() =>
                setStatus(
                    isOwner
                        ? 'Owners can rename, delete, invite, or revoke pending invites.'
                        : 'View members of this workspace.',
                ),
            );
        },
        onClose() {},
    });
}
