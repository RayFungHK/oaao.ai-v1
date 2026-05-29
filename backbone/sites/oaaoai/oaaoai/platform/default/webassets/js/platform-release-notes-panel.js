/**
 * PLAT-1-S2 — Platform CMS: release notes draft/publish, edit, preview, locale tabs.
 */
import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';

const API = '/platform/api/';
const LOCALES = [
    { id: 'en', label: 'English' },
    { id: 'zh-Hant', label: '繁體中文' },
];

/** @param {string} md */
function renderMarkdownPreview(md) {
    const lines = String(md ?? '').split('\n');
    const parts = [];
    let inPre = false;
    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            inPre = !inPre;
            if (inPre) parts.push('<pre class="rounded-[6px] bg-[var(--grid-paper)] px-2 py-1 text-[0.75rem] font-mono overflow-x-auto m-0 mb-2">');
            else parts.push('</pre>');
            continue;
        }
        if (inPre) {
            parts.push(esc(line) + '\n');
            continue;
        }
        let html = esc(line);
        if (/^###\s+/.test(line)) {
            html = `<h4 class="text-[0.9375rem] fw-semibold mt-2 mb-1 m-0">${esc(line.replace(/^###\s+/, ''))}</h4>`;
        } else if (/^##\s+/.test(line)) {
            html = `<h3 class="text-[1rem] fw-semibold mt-2 mb-1 m-0">${esc(line.replace(/^##\s+/, ''))}</h3>`;
        } else if (/^#\s+/.test(line)) {
            html = `<h2 class="text-[1.0625rem] fw-semibold mt-2 mb-1 m-0">${esc(line.replace(/^#\s+/, ''))}</h2>`;
        } else if (/^[-*]\s+/.test(line)) {
            html = `<li class="ml-4 list-disc text-[0.8125rem]">${inlineMd(line.replace(/^[-*]\s+/, ''))}</li>`;
        } else if (line.trim() === '') {
            html = '<div class="h-2"></div>';
        } else {
            html = `<p class="text-[0.8125rem] leading-relaxed m-0 mb-1">${inlineMd(line)}</p>`;
        }
        parts.push(html);
    }
    return parts.join('');
}

/** @param {string} s */
function inlineMd(s) {
    let t = esc(s);
    t = t.replace(/`([^`]+)`/g, '<code class="font-mono text-[0.75rem] px-0.5 rounded bg-[var(--grid-paper)]">$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="fg-[var(--grid-accent)] underline" target="_blank" rel="noopener">$1</a>');
    return t;
}

/** @param {unknown} v */
function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export async function mountSettingsPanel(host, ctx = {}) {
    return mountPlatformReleaseNotesPanel(host, ctx);
}

export async function mountPlatformReleaseNotesPanel(host, ctx = {}) {
    const { signal } = ctx;
    if (!(host instanceof HTMLElement)) return;

    host.replaceChildren();
    oaaoMountLoadingLogo(host, { label: 'Loading release notes…' });

    try {
        const res = await fetch(`${API}release_posts_list`, { credentials: 'same-origin', signal });
        const data = await res.json();
        host.replaceChildren();
        if (!res.ok || !data?.success) {
            const err = document.createElement('p');
            err.className = 'text-sm fg-[var(--grid-danger)]';
            err.textContent = data?.message || `HTTP ${res.status}`;
            host.append(err);
            return;
        }

        const title = document.createElement('div');
        title.className = 'oaao-sdlg-section-title mb-sm';
        title.textContent = 'Release notes';
        host.append(title);

        const intro = document.createElement('p');
        intro.className = 'text-xs fg-[var(--grid-ink-muted)] mb-md';
        intro.textContent =
            'One release = one slug, two locale drafts (English + 繁體中文). Switch tabs to edit each language; save each tab at least once before publish.';
        host.append(intro);

        const posts = Array.isArray(data?.data?.posts) ? data.data.posts : [];
        const list = document.createElement('ul');
        list.className = 'flex flex-col gap-2 list-none p-0 m-0 mb-md';
        for (const p of posts) {
            list.append(buildPostRow(p, posts, signal, () => mountPlatformReleaseNotesPanel(host, ctx)));
        }
        host.append(list);

        host.append(buildEditorForm(posts, signal, () => mountPlatformReleaseNotesPanel(host, ctx)));
        ctx.JIT?.hydrate?.(host);
    } catch (e) {
        if (e?.name === 'AbortError') return;
        host.replaceChildren();
        const err = document.createElement('p');
        err.className = 'text-sm fg-[var(--grid-danger)]';
        err.textContent = 'Could not load release notes.';
        host.append(err);
    }
}

/**
 * @param {Record<string, unknown>} post
 * @param {Record<string, unknown>[]} allPosts
 * @param {AbortSignal} signal
 * @param {() => void} reload
 */
function buildPostRow(post, allPosts, signal, reload) {
    const li = document.createElement('li');
    li.className =
        'rounded-[10px] border border-solid border-[var(--grid-line)] px-3 py-2 flex flex-wrap items-center gap-2';

    const meta = document.createElement('span');
    meta.className = 'flex-1 min-w-0 text-[0.8125rem] fg-[var(--grid-ink)]';
    const loc = post.locale ? ` · ${post.locale}` : '';
    meta.textContent = `${post.title || 'Untitled'} · ${post.status || 'draft'}${loc} · ${post.version || ''}`;

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className =
        'text-[0.75rem] px-2 py-1 rounded border border-solid border-[var(--grid-line)] bg-transparent fg-[var(--grid-ink)] cursor-pointer font-inherit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener(
        'click',
        () => {
            document.dispatchEvent(
                new CustomEvent('oaao:release-post-edit', {
                    detail: { post },
                }),
            );
        },
        { signal },
    );

    const pubBtn = document.createElement('button');
    pubBtn.type = 'button';
    pubBtn.className =
        'text-[0.75rem] px-2 py-1 rounded border-none bg-[var(--grid-accent)] fg-white cursor-pointer font-inherit';
    pubBtn.textContent = 'Publish';
    pubBtn.disabled = post.status === 'published';
    pubBtn.addEventListener(
        'click',
        async () => {
            pubBtn.disabled = true;
            const res = await fetch(`${API}release_posts_publish`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                signal,
                body: JSON.stringify({ release_post_id: Number(post.release_post_id) }),
            });
            const out = await res.json();
            if (!res.ok || !out?.success) {
                pubBtn.disabled = false;
                return;
            }
            const postId = Number(post.release_post_id);
            let fanoutDone = Boolean(out?.data?.fanout?.done);
            while (!fanoutDone && !signal.aborted) {
                const tickRes = await fetch(`${API}release_posts_fanout_tick`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    signal,
                    body: JSON.stringify({ release_post_id: postId }),
                });
                const tickOut = await tickRes.json();
                fanoutDone = Boolean(tickOut?.data?.done);
                if (!fanoutDone) {
                    await new Promise((resolve) => window.setTimeout(resolve, 80));
                }
            }
            reload();
        },
        { signal },
    );

    li.append(meta, editBtn, pubBtn);
    return li;
}

/**
 * @param {Record<string, unknown>[]} posts
 * @param {AbortSignal} signal
 * @param {() => void} reload
 */
function buildEditorForm(posts, signal, reload) {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-3 max-w-3xl min-w-0';
    wrap.id = 'oaao-release-editor';

    const h = document.createElement('p');
    h.className = 'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] m-0';
    h.id = 'oaao-release-editor-heading';
    h.textContent = 'New draft';

    const localeTabs = document.createElement('div');
    localeTabs.className = 'inline-flex flex-wrap gap-1';
    localeTabs.setAttribute('role', 'tablist');

    let activeLocale = 'en';
    /** @type {number} */
    let editingId = 0;
    let editingSlug = '';

    /** In-memory drafts per locale before / between saves (key = locale id). */
    /** @type {Map<string, { title: string, body_md: string, release_post_id: number }>} */
    const localeDrafts = new Map();

    const titleInp = document.createElement('input');
    titleInp.type = 'text';
    titleInp.placeholder = 'Title';
    titleInp.className =
        'rounded-[8px] border border-solid border-[var(--grid-line)] px-2 py-1.5 text-[0.8125rem] font-inherit w-full';

    const split = document.createElement('div');
    split.className = 'grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0';

    const bodyInp = document.createElement('textarea');
    bodyInp.rows = 12;
    bodyInp.placeholder = 'Markdown body';
    bodyInp.className =
        'rounded-[8px] border border-solid border-[var(--grid-line)] px-2 py-1.5 text-[0.8125rem] font-inherit font-mono w-full min-h-[12rem] resize-y';

    const preview = document.createElement('div');
    preview.className =
        'rounded-[8px] border border-solid border-[var(--grid-line)] px-3 py-2 min-h-[12rem] overflow-y-auto bg-[var(--grid-paper)]';
    preview.setAttribute('aria-label', 'Markdown preview');

    const syncPreview = () => {
        preview.innerHTML = renderMarkdownPreview(bodyInp.value);
    };
    bodyInp.addEventListener('input', syncPreview, { signal });

    split.append(bodyInp, preview);

    const status = document.createElement('p');
    status.className = 'm-0 text-[0.75rem] fg-[var(--grid-caption)] min-h-[1rem]';

    const btnRow = document.createElement('div');
    btnRow.className = 'flex flex-wrap gap-2';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className =
        'text-[0.8125rem] px-3 py-1.5 rounded border-none bg-[var(--grid-accent)] fg-white cursor-pointer font-inherit';
    saveBtn.textContent = 'Save draft';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className =
        'text-[0.8125rem] px-3 py-1.5 rounded border border-solid border-[var(--grid-line)] bg-transparent fg-[var(--grid-ink)] cursor-pointer font-inherit';
    clearBtn.textContent = 'New draft';

    const syncLocaleTabUi = () => {
        for (const btn of localeTabs.querySelectorAll('[data-locale-tab]')) {
            if (!(btn instanceof HTMLButtonElement)) continue;
            const on = btn.dataset.localeTab === activeLocale;
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.classList.toggle('bg-[var(--grid-accent)]', on);
            btn.classList.toggle('fg-white', on);
            btn.classList.toggle('border-[var(--grid-accent)]', on);
        }
    };

    const stashActiveLocaleDraft = () => {
        localeDrafts.set(activeLocale, {
            title: titleInp.value,
            body_md: bodyInp.value,
            release_post_id: editingId,
        });
    };

    /** @param {string} slug */
    const hydrateLocaleDraftsFromPosts = (slug) => {
        localeDrafts.clear();
        if (!slug) return;
        for (const loc of LOCALES) {
            const row = posts.find(
                (p) => String(p.slug ?? '') === slug && String(p.locale ?? '') === loc.id,
            );
            if (!row) continue;
            localeDrafts.set(loc.id, {
                title: String(row.title ?? ''),
                body_md: String(row.body_md ?? ''),
                release_post_id: Number(row.release_post_id ?? 0),
            });
        }
    };

    /**
     * @param {string} locId
     */
    const switchLocale = (locId) => {
        if (locId === activeLocale) return;
        stashActiveLocaleDraft();
        activeLocale = locId;

        const cached = localeDrafts.get(locId);
        if (cached) {
            editingId = cached.release_post_id;
            titleInp.value = cached.title;
            bodyInp.value = cached.body_md;
        } else if (editingSlug) {
            const sibling = posts.find(
                (p) => String(p.slug ?? '') === editingSlug && String(p.locale ?? '') === locId,
            );
            if (sibling) {
                editingId = Number(sibling.release_post_id ?? 0);
                titleInp.value = String(sibling.title ?? '');
                bodyInp.value = String(sibling.body_md ?? '');
                localeDrafts.set(locId, {
                    title: titleInp.value,
                    body_md: bodyInp.value,
                    release_post_id: editingId,
                });
            } else {
                editingId = 0;
                titleInp.value = '';
                bodyInp.value = '';
            }
        } else {
            editingId = 0;
            titleInp.value = '';
            bodyInp.value = '';
        }

        syncLocaleTabUi();
        syncPreview();
        status.textContent =
            editingSlug && !cached && editingId < 1
                ? `New ${locId} draft — same slug after save`
                : '';
    };

    const loadIntoEditor = (/** @type {Record<string, unknown>|null} */ row) => {
        localeDrafts.clear();
        if (row && row.release_post_id) {
            editingSlug = String(row.slug ?? '');
            activeLocale = String(row.locale ?? 'en');
            hydrateLocaleDraftsFromPosts(editingSlug);
            const cached = localeDrafts.get(activeLocale);
            editingId = cached?.release_post_id ?? Number(row.release_post_id);
            h.textContent = editingSlug
                ? `Edit release · ${editingSlug}`
                : `Edit draft #${editingId}`;
            titleInp.value = cached?.title ?? String(row.title ?? '');
            bodyInp.value = cached?.body_md ?? String(row.body_md ?? '');
        } else {
            editingId = 0;
            editingSlug = '';
            activeLocale = 'en';
            h.textContent = 'New draft';
            titleInp.value = '';
            bodyInp.value = '';
        }
        syncLocaleTabUi();
        syncPreview();
        status.textContent = '';
    };

    for (const loc of LOCALES) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.dataset.localeTab = loc.id;
        tab.setAttribute('role', 'tab');
        tab.className =
            'text-[0.75rem] px-2.5 py-1 rounded-[6px] border border-solid border-[var(--grid-line)] bg-transparent fg-[var(--grid-ink)] cursor-pointer font-inherit';
        tab.textContent = loc.label;
        tab.addEventListener('click', () => switchLocale(loc.id), { signal });
        localeTabs.append(tab);
    }

    document.addEventListener(
        'oaao:release-post-edit',
        (ev) => {
            const detail = ev instanceof CustomEvent ? ev.detail : null;
            const post = detail?.post;
            if (post && typeof post === 'object') {
                loadIntoEditor(/** @type {Record<string, unknown>} */ (post));
                wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        },
        { signal },
    );

    saveBtn.addEventListener(
        'click',
        async () => {
            const title = titleInp.value.trim();
            if (!title) {
                status.textContent = 'Title required';
                return;
            }
            stashActiveLocaleDraft();
            status.textContent = 'Saving…';
            /** @type {Record<string, unknown>} */
            const payload = {
                release_post_id: editingId > 0 ? editingId : undefined,
                title,
                body_md: bodyInp.value,
                post_type: 'changelog',
                locale: activeLocale,
            };
            if (editingSlug) {
                payload.slug = editingSlug;
            }
            const res = await fetch(`${API}release_posts_save`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                signal,
                body: JSON.stringify(payload),
            });
            const out = await res.json();
            if (!res.ok || !out?.success) {
                status.textContent = out?.message || 'Save failed';
                return;
            }
            const newId = Number(out?.data?.release_post_id ?? 0);
            const newSlug = String(out?.data?.slug ?? '').trim();
            if (newSlug) editingSlug = newSlug;
            if (newId > 0) editingId = newId;
            localeDrafts.set(activeLocale, {
                title,
                body_md: bodyInp.value,
                release_post_id: editingId,
            });
            status.textContent = `Saved (${activeLocale})${editingSlug ? ` · ${editingSlug}` : ''}`;
            reload();
        },
        { signal },
    );

    clearBtn.addEventListener(
        'click',
        () => {
            loadIntoEditor(null);
            status.textContent = '';
        },
        { signal },
    );

    btnRow.append(saveBtn, clearBtn);
    wrap.append(h, localeTabs, titleInp, split, status, btnRow);
    loadIntoEditor(null);
    return wrap;
}
