/**
 * Public invitation registration page (/user/register?token=).
 */

import { oaaoT } from '../../../core/default/js/oaao-i18n.js';

/** @param {string} key @param {string} fallback */
function rt(key, fallback) {
    return oaaoT(key, fallback);
}

function applyRegisterPageI18n(root) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        const text = rt(key, el.textContent?.trim() || '');
        if (text) el.textContent = text;
    });
}

async function hydratePublicPage(root) {
    const prefix = (document.body.dataset.oaaoMountPrefix || '').replace(/\/+$/, '');
    const base = prefix || '';
    try {
        const mod = await import(/* webpackIgnore: true */ `${base}/webassets/core/default/razyui/razyui.js`);
        const razyui = mod.default ?? mod;
        const JIT = await razyui.load('JIT');
        if (JIT?.hydrate) {
            JIT.hydrate(root instanceof HTMLElement ? root : document.body);
        }
    } catch {
        /* oaao.css + native inputs remain usable without JIT */
    }
}

function setStatus(el, text, isErr = false) {
    if (!(el instanceof HTMLElement)) return;
    el.textContent = text;
    el.classList.toggle('fg-red-6', isErr);
    el.classList.toggle('fg-[var(--grid-ink-muted)]', !isErr);
}

(async function () {
    applyRegisterPageI18n(document.body);
    await hydratePublicPage(document.body);

    const statusEl = document.getElementById('oaao-reg-status');
    const form = document.getElementById('oaao-reg-form');
    const emailEl = document.getElementById('oaao-reg-email');
    const params = new URLSearchParams(window.location.search);
    const tokenFromQuery = (params.get('token') || '').trim();
    const token = (document.body.getAttribute('data-oaao-invite-token') || tokenFromQuery).trim();
    const prefix = (document.body.dataset.oaaoMountPrefix || '').replace(/\/+$/, '');
    const api = (path) => `${prefix}/user/api/${path}`;

    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
        setStatus(statusEl, rt('auth.register.invalid_link', 'Invalid or missing invitation link.'), true);
        return;
    }

    try {
        const res = await fetch(api(`register_validate?token=${encodeURIComponent(token)}`), {
            credentials: 'same-origin',
        });
        const j = await res.json();
        if (!j?.success) {
            setStatus(statusEl, j?.message || rt('auth.register.expired', 'Invitation expired or invalid.'), true);
            return;
        }
        setStatus(statusEl, '');
        if (emailEl) {
            const label = rt('auth.register.email_label', 'Email');
            emailEl.textContent = `${label}: ${j.data?.email || ''}`;
        }
        if (form) {
            form.hidden = false;
            form.classList.remove('hidden');
            await hydratePublicPage(form);
        }
    } catch {
        setStatus(statusEl, rt('auth.register.verify_failed', 'Could not verify invitation.'), true);
    }

    form?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        try {
            const res = await fetch(api('register_complete'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    token,
                    display_name: String(fd.get('display_name') || '').trim(),
                    password: String(fd.get('password') || ''),
                }),
            });
            const j = await res.json();
            if (!res.ok || !j?.success) {
                setStatus(statusEl, j?.message || rt('auth.register.failed', 'Registration failed.'), true);
                return;
            }
            setStatus(statusEl, rt('auth.register.success', 'Account created. You can sign in now.'));
            form.hidden = true;
            form.classList.add('hidden');
        } catch {
            setStatus(statusEl, rt('auth.register.failed', 'Registration failed.'), true);
        }
    });
})();
