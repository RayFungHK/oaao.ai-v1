/**
 * PLAT-1-S6 — Workspace What's New dialog (published release notes).
 *
 * @module whats-new-dialog
 */

import razyui from 'razyui';

/** @returns {string} */
function mountPrefix() {
    const raw = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    if (!raw || raw === '/') {
        return '';
    }
    return raw.startsWith('/') ? raw.replace(/\/+$/, '') : `/${raw.replace(/\/+$/, '')}`;
}

/** @param {string} path */
function userApiUrl(path) {
    return `${mountPrefix()}/user/api/${String(path).replace(/^\//, '')}`;
}

/**
 * @param {{ sinceBuild?: string, locale?: string }} [opts]
 */
export async function openWhatsNewDialog(opts = {}) {
    const sinceBuild = (opts.sinceBuild ?? document.body?.dataset?.oaaoBuildId ?? '').trim();
    const locale = (opts.locale ?? document.documentElement.lang ?? 'en').trim() || 'en';
    const q = new URLSearchParams({ locale });
    if (sinceBuild) {
        q.set('since_build', sinceBuild);
    }

    let posts = [];
    try {
        const res = await fetch(`${userApiUrl('release_notes_list')}?${q}`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
        });
        const data = await res.json();
        if (res.ok && data?.success) {
            posts = Array.isArray(data?.data?.posts) ? data.data.posts : [];
        }
    } catch {
        /* empty list */
    }

    const Dialog = (await razyui.load('Dialog')).default ?? (await razyui.load('Dialog'));

    const body = document.createElement('div');
    body.className = 'flex flex-col gap-3 max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain p-1';

    if (posts.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'm-0 text-[0.875rem] fg-[var(--grid-caption)]';
        empty.textContent = sinceBuild
            ? 'No release notes since your current build yet.'
            : 'No published release notes yet.';
        body.append(empty);
    } else {
        for (const post of posts) {
            const card = document.createElement('article');
            card.className =
                'rounded-[10px] border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] px-3 py-2.5';
            const head = document.createElement('header');
            head.className = 'flex flex-wrap items-baseline gap-2 mb-1';
            const title = document.createElement('h3');
            title.className = 'm-0 text-[0.9375rem] fw-semibold fg-[var(--grid-ink)]';
            title.textContent = String(post.title || 'Release');
            const meta = document.createElement('span');
            meta.className = 'text-[0.6875rem] font-mono fg-[var(--grid-caption)]';
            const ver = String(post.version || '');
            const build = String(post.build_id || '');
            meta.textContent = [ver, build].filter(Boolean).join(' · ');
            head.append(title, meta);
            const md = document.createElement('div');
            md.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] whitespace-pre-wrap leading-relaxed';
            md.textContent = String(post.body_md || '').slice(0, 8000);
            card.append(head, md);
            body.append(card);
        }
    }

    const dlg = new Dialog({
        title: "What's New",
        body,
        width: 'min(32rem, calc(100vw - 2rem))',
    });
    dlg.open();
    globalThis.JIT?.hydrate?.(body);
}
