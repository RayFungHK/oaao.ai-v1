/**
 * In-app notification bell — news, invitations, job updates.
 */

import { oaaoBuildFromResponse, oaaoMessageWithBuild } from './oaao-build-stamp.js';

/** @param {string} action */
function notificationApiUrl(action) {
    const rawMount = (document.body?.dataset?.oaaoMountPrefix ?? '').trim();
    const prefix = rawMount && rawMount !== '/' ? (rawMount.startsWith('/') ? rawMount : `/${rawMount}`) : '';

    return `${prefix}/user/api/${String(action).replace(/^\/+/, '')}`;
}

function sessionActive() {
    return document.body?.classList.contains('oaao-session-active') === true;
}

/**
 * @param {HTMLElement | null} badge
 * @param {number} count
 */
function setBadgeCount(badge, count) {
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.remove('hidden');
    } else {
        badge.textContent = '';
        badge.classList.add('hidden');
    }
}

/**
 * @param {HTMLElement} panel
 * @param {HTMLElement | null} badge
 * @param {Array<{ notification_id?: number, kind?: string, title?: string, body?: string, read?: boolean, payload?: Record<string, unknown> | null }>} rows
 */
function renderNotificationList(panel, badge, rows) {
    panel.textContent = '';
    if (!Array.isArray(rows) || rows.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'px-3 py-3 text-[0.8125rem] fg-[var(--grid-ink-muted)] m-0';
        empty.textContent = 'No notifications yet.';
        panel.append(empty);

        return;
    }

    for (const row of rows) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className =
            'w-full text-left px-3 py-2.5 border-none font-inherit cursor-pointer bg-transparent hover:bg-[var(--grid-line)]/35 border-b-[1px] border-solid border-[var(--grid-line)] last:border-b-0';
        const title = document.createElement('div');
        title.className = `text-[0.8125rem] fw-medium truncate ${row.read ? 'fg-[var(--grid-ink-muted)]' : 'fg-[var(--grid-ink)]'}`;
        title.textContent = String(row.title || 'Notification');
        item.append(title);
        if (row.body) {
            const body = document.createElement('div');
            body.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)] mt-1 line-clamp-2';
            body.textContent = String(row.body);
            item.append(body);
        }
        const meta = document.createElement('div');
        meta.className = 'text-[0.6875rem] fg-[var(--grid-caption)] mt-0.5 truncate';
        meta.textContent = String(row.kind || 'system');
        item.append(meta);
        const nid = Number(row.notification_id ?? 0);
        const kind = String(row.kind || 'system');
        item.addEventListener('click', () => {
            const mark = Number.isFinite(nid) && nid > 0 && !row.read
                ? markNotificationsRead([nid]).then(() => refreshNotifications(panel, badge))
                : Promise.resolve();
            void mark.then(async () => {
                if (kind === 'release') {
                    try {
                        const mod = await import('./whats-new-dialog.js');
                        const since = (document.body?.dataset?.oaaoBuildId ?? '').trim();
                        const payload =
                            row.payload && typeof row.payload === 'object'
                                ? /** @type {Record<string, unknown>} */ (row.payload)
                                : {};
                        const focusId = Number(payload.release_post_id ?? 0);
                        await mod.openWhatsNewDialog({
                            sinceBuild: since,
                            highlightBuildId: since,
                            focusReleasePostId: Number.isFinite(focusId) && focusId > 0 ? focusId : undefined,
                        });
                    } catch (err) {
                        console.error('[oaao] release whats-new failed', err);
                    }
                }
            });
        });
        panel.append(item);
    }
}

/**
 * @param {number[]} ids
 */
async function markNotificationsRead(ids) {
    await fetch(notificationApiUrl('notifications_mark_read'), {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ ids }),
    });
}

/** @type {number | null} */
let pollTimer = null;

function stopNotificationPolling() {
    if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
    }
}

/**
 * @param {HTMLElement} panel
 * @param {HTMLElement | null} badge
 */
async function refreshNotifications(panel, badge) {
    if (!sessionActive()) {
        setBadgeCount(badge, 0);
        panel.textContent = '';
        stopNotificationPolling();

        return;
    }

    try {
        const res = await fetch(notificationApiUrl('notifications_list'), {
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
        });
        const data = /** @type {{ success?: boolean, notifications?: unknown, unread_count?: number, message?: string, build?: unknown }} */ (
            await res.json().catch(() => ({}))
        );
        if (res.status === 401) {
            setBadgeCount(badge, 0);
            panel.textContent = '';
            stopNotificationPolling();

            return;
        }
        if (!res.ok || data.success === false) {
            panel.textContent = '';
            const err = document.createElement('p');
            err.className = 'px-3 py-3 text-[0.8125rem] fg-[var(--grid-danger)] m-0';
            const msg =
                typeof data.message === 'string' && data.message
                    ? data.message
                    : 'Could not load notifications.';
            err.textContent = oaaoMessageWithBuild(msg, oaaoBuildFromResponse(data));
            panel.append(err);

            return;
        }
        const rows = Array.isArray(data.notifications) ? data.notifications : [];
        setBadgeCount(badge, Number(data.unread_count ?? 0));
        renderNotificationList(panel, badge, rows);
    } catch {
        panel.textContent = '';
        const err = document.createElement('p');
        err.className = 'px-3 py-3 text-[0.8125rem] fg-[var(--grid-danger)] m-0';
        err.textContent = oaaoMessageWithBuild('Could not load notifications.');
        panel.append(err);
    }
}

/** Wire notification bell in workspace header. */
export function wireWorkspaceNotifications() {
    const trigger = document.getElementById('workspace-notifications-trigger');
    const anchor = document.getElementById('workspace-notifications-anchor');
    const panel = document.getElementById('workspace-notifications-panel');
    const badge = document.getElementById('workspace-notifications-badge');
    if (!trigger || !panel || !anchor || trigger.dataset.oaaoNotifBound === '1') return;
    if (!sessionActive()) return;
    trigger.dataset.oaaoNotifBound = '1';

    let open = false;

    const close = () => {
        open = false;
        anchor.classList.add('hidden');
        anchor.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    };

    const openPanel = () => {
        open = true;
        anchor.classList.remove('hidden');
        anchor.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        void refreshNotifications(panel, badge);
    };

    trigger.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (open) close();
        else openPanel();
    });

    document.addEventListener(
        'click',
        (ev) => {
            if (!open) return;
            if (!(ev.target instanceof Node)) return;
            if (trigger.contains(ev.target) || anchor.contains(ev.target)) return;
            close();
        },
        true,
    );

    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') close();
    });

    void refreshNotifications(panel, badge);
    stopNotificationPolling();
    pollTimer = window.setInterval(() => {
        if (!open && sessionActive()) {
            void refreshNotifications(panel, badge);
        }
    }, 120_000);
}
