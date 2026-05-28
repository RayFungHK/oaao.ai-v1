/**
 * Public password reset page (/user/reset-password?token=).
 */

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
        /* fallback without JIT */
    }
}

function setStatus(el, text, isErr = false) {
    if (!(el instanceof HTMLElement)) return;
    el.textContent = text;
    el.classList.toggle('fg-red-6', isErr);
    el.classList.toggle('fg-[var(--grid-ink-muted)]', !isErr);
}

(async function () {
    await hydratePublicPage(document.body);

    const statusEl = document.getElementById('oaao-reset-status');
    const form = document.getElementById('oaao-reset-form');
    const requestForm = document.getElementById('oaao-reset-request-form');
    const params = new URLSearchParams(window.location.search);
    const token = (params.get('token') || document.body.getAttribute('data-oaao-reset-token') || '').trim();
    const prefix = (document.body.dataset.oaaoMountPrefix || '').replace(/\/+$/, '');
    const api = (path) => `${prefix}/user/api/${path}`;

    if (token && /^[a-f0-9]{64}$/i.test(token)) {
        try {
            const res = await fetch(api(`password_reset_validate?token=${encodeURIComponent(token)}`), {
                credentials: 'same-origin',
            });
            const j = await res.json();
            if (!j?.success) {
                setStatus(statusEl, j?.message || 'Reset link expired or invalid.', true);
            } else {
                setStatus(statusEl, '');
                if (form) {
                    form.hidden = false;
                    form.classList.remove('hidden');
                    await hydratePublicPage(form);
                }
            }
        } catch {
            setStatus(statusEl, 'Could not verify reset link.', true);
        }

        form?.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const fd = new FormData(form);
            try {
                const res = await fetch(api('password_reset_complete'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        token,
                        password: String(fd.get('password') || ''),
                    }),
                });
                const j = await res.json();
                if (!res.ok || !j?.success) {
                    setStatus(statusEl, j?.message || 'Could not reset password.', true);
                    return;
                }
                setStatus(statusEl, 'Password updated. You can sign in.');
                if (form) form.hidden = true;
            } catch {
                setStatus(statusEl, 'Could not reset password.', true);
            }
        });
    } else {
        setStatus(statusEl, 'Enter your email below to request a reset link, or open the link from your email.');
        if (form) form.hidden = true;
    }

    requestForm?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(requestForm);
        try {
            const res = await fetch(api('password_reset_request'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ email: String(fd.get('email') || '').trim() }),
            });
            const j = await res.json();
            setStatus(statusEl, j?.message || 'If an account exists, a reset link has been sent.');
        } catch {
            setStatus(statusEl, 'Request failed.', true);
        }
    });
})();
