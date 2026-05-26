/**
 * Workspace Settings dialog — administrator-global panels ({@see SettingsRegister} PHP). Personal options use the Preferences dialog ({@see preferences-dialog.js}).
 * Shell layout uses **atomic JIT classes** on each node so {@code Je()} always compiles rules (compound-only presets can fail silently in {@code kt()}).
 */

import { oaaoAppendShellEsmV, resolveShellRegistryUrl } from './shell-registry-url.js';
import { oaaoT } from './oaao-i18n.js';
import { oaaoLoadingLogoElement, oaaoMountLoadingLogo } from './oaao-loading-logo.js';

/** @param {unknown} v */
function escapeHtml(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Razy {@code Dialog} shell tokens — avoid arbitrary {@code min(a,b)} with commas here (JIT often skips them). Size uses {@link Dialog} {@code height} below. */
const SDLG_DIALOG_BOX_JIT = 'overflow-hidden bg-[var(--grid-panel-bright)] min-h-0';

/** Host for settings split view: stretch {@code .dialog-box} column and drop default body padding. */
const SDLG_DIALOG_BODY_JIT = 'flex flex-col flex-1 min-h-0 overflow-hidden [padding:0]';

/** Left rail (~¼ dialog) + right detail — matches legacy admin settings chrome. */
const SDLG_ROOT_JIT = [
    'flex',
    'flex-row',
    'items-stretch',
    'flex-1',
    'min-h-0',
    'min-w-0',
    'w-full',
    'h-full',
    'max-h-full',
    '[box-sizing:border-box]',
].join(' ');

const SDLG_NAV_JIT = [
    'flex',
    'flex-col',
    'shrink-0',
    'w-[240px]',
    'min-w-[180px]',
    '[border-right:1px_solid_var(--grid-line)]',
    'bg-[var(--grid-nav)]',
    'py-4',
    'overflow-y-auto',
    'overflow-x-hidden',
    '[overscroll-behavior-y:contain]',
    'gap-0.5',
].join(' ');

const SDLG_BODY_JIT = ['flex', 'flex-1', 'flex-col', 'min-w-0', 'min-h-0', 'bg-[var(--grid-panel-bright)]'].join(' ');

const SDLG_HEADER_JIT = [
    'shrink-0',
    'px-8',
    'pt-6',
    'pb-4',
    '[border-bottom:1px_solid_var(--grid-line)]',
].join(' ');

const SDLG_CONTENT_JIT = [
    'flex-1',
    'min-h-0',
    'overflow-y-auto',
    'overflow-x-hidden',
    '[overscroll-behavior-y:contain]',
    'px-8',
    'py-6',
].join(' ');

const SDLG_ITEM_JIT = [
    'flex',
    'items-center',
    'gap-3',
    'w-full',
    'px-4',
    'py-[0.45rem]',
    'mx-0',
    'box-border',
    'border-0',
    'bg-transparent',
    'text-[0.8125rem]',
    'fw-medium',
    'fg-[var(--grid-ink-muted)]',
    'cursor-pointer',
    'rounded-none',
    'text-left',
    'font-inherit',
    'transition-colors',
    'hover:bg-[rgba(55,53,47,0.04)]',
    'hover:fg-[var(--grid-ink)]',
].join(' ');

const SDLG_ITEM_ACTIVE_JIT = [
    'flex',
    'items-center',
    'gap-3',
    'w-full',
    'px-4',
    'py-[0.45rem]',
    'mx-0',
    'box-border',
    'border-0',
    'text-[0.8125rem]',
    'fw-semibold',
    'fg-[var(--grid-ink)]',
    'cursor-pointer',
    'rounded-none',
    'text-left',
    'font-inherit',
    'transition-colors',
    'bg-[rgba(55,53,47,0.06)]',
    'border-l-[3px]',
    'border-l-[var(--grid-accent)]',
    'hover:bg-[rgba(55,53,47,0.08)]',
].join(' ');

/**
 * @param {Element | null | undefined} el
 * @param {string} jitSpaceSeparated
 */
function applyJitTokens(el, jitSpaceSeparated) {
    if (!el || !jitSpaceSeparated) return;
    for (const token of jitSpaceSeparated.split(/\s+/).filter(Boolean)) {
        el.classList.add(token);
    }
}

export async function openWorkspaceSettingsDialog(razyui) {
    /**
     * Load the **unwrapped** Dialog class. {@link razyui.load} wraps some components in a subclass whose
     * {@code getControl()} delegates to the base — that breaks this bundle’s private-field implementation
     * ({@code TypeError: Cannot read from private field}).
     */
    const dialogHref = new URL('../razyui/component/Dialog.js', import.meta.url).href;
    const [DialogMod, JITModule] = await Promise.all([import(dialogHref), razyui.load('JIT')]);
    const Dialog = DialogMod?.default;
    if (typeof Dialog !== 'function') {
        console.error('[oaao] settings-dialog: Dialog default export missing', DialogMod);
        return;
    }
    const JIT = JITModule && typeof JITModule.hydrate === 'function' ? JITModule : null;

    /** @type {ReadonlyArray<Record<string, unknown>>} */
    const registry = Array.isArray(globalThis.OAAO_SETTINGS_REGISTRY) ? globalThis.OAAO_SETTINGS_REGISTRY : [];

    /**
     * @param {unknown} icon
     * @returns {string}
     */
    function iconClasses(icon) {
        const s = String(icon ?? '').trim();
        if (!s) return 'ri-menu-meatballs-1 rz-icon';
        if (s.includes(' ') || s.startsWith('ri-')) {
            return `${s}${s.includes('rz-icon') ? '' : ' rz-icon'}`;
        }
        return `ri-${s} rz-icon`;
    }

    /** @type {Array<{ section_id: string, label: string, title: string, sub: string, icon: string, sort: number, panel_html?: string, panel_url?: string, panel_js_module?: string }>} */
    const sections = [];
    for (const row of registry) {
        if (!row || typeof row !== 'object') continue;
        const section_id = typeof row.section_id === 'string' ? row.section_id.trim() : '';
        if (!section_id) continue;
        const label0 = typeof row.label === 'string' ? row.label : section_id;
        const title0 = typeof row.title === 'string' ? row.title : section_id;
        const sub0 = typeof row.sub === 'string' ? row.sub : '';
        const label_key = typeof row.label_key === 'string' ? row.label_key.trim() : '';
        const title_key = typeof row.title_key === 'string' ? row.title_key.trim() : '';
        const sub_key = typeof row.sub_key === 'string' ? row.sub_key.trim() : '';
        sections.push({
            section_id,
            label: label_key ? oaaoT(label_key, label0) : label0,
            title: title_key ? oaaoT(title_key, title0) : title0,
            sub: sub_key ? oaaoT(sub_key, sub0) : sub0,
            icon: typeof row.icon === 'string' ? row.icon : '',
            sort: typeof row.sort === 'number' && Number.isFinite(row.sort) ? row.sort : 500,
            panel_html: typeof row.panel_html === 'string' ? row.panel_html : undefined,
            panel_url: typeof row.panel_url === 'string' ? row.panel_url : undefined,
            panel_js_module: typeof row.panel_js_module === 'string' ? row.panel_js_module : undefined,
        });
    }

    if (sections.length === 0) {
        sections.push({
            section_id: 'empty',
            label: oaaoT('settings.dialog.empty_nav_label'),
            title: oaaoT('settings.dialog.empty_nav_label'),
            sub: oaaoT('settings.dialog.empty_nav_sub'),
            icon: 'menu-meatballs-1',
            sort: 0,
            panel_html: oaaoT('settings.dialog.empty_nav_body'),
        });
    }

    const root = document.createElement('div');
    root.className = SDLG_ROOT_JIT;

    const nav = document.createElement('nav');
    nav.className = SDLG_NAV_JIT;
    nav.setAttribute('aria-label', oaaoT('settings.dialog.nav_aria'));

    const scroll = document.createElement('div');
    scroll.className = SDLG_CONTENT_JIT;

    sections.forEach((sec, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = i === 0 ? SDLG_ITEM_ACTIVE_JIT : SDLG_ITEM_JIT;
        btn.dataset.settingsNav = sec.section_id;
        const ic = iconClasses(sec.icon);
        btn.innerHTML = `<i class="${ic} not-italic text-[16px]" aria-hidden="true"></i><span>${sec.label}</span>`;
        nav.appendChild(btn);

        const panel = document.createElement('div');
        panel.dataset.settingsPanel = sec.section_id;
        if (i !== 0) {
            panel.classList.add('hidden');
            panel.hidden = true;
        }
        if (sec.panel_html) {
            panel.innerHTML = sec.panel_html;
        } else {
            panel.append(oaaoLoadingLogoElement({ block: true, label: oaaoT('settings.dialog.loading_panel') }));
        }
        scroll.appendChild(panel);
    });

    root.appendChild(nav);

    const body = document.createElement('div');
    body.className = SDLG_BODY_JIT;

    const header = document.createElement('div');
    header.className = SDLG_HEADER_JIT;
    const first = sections[0];
    header.innerHTML = `<div class="text-[1.125rem] fw-bold fg-[var(--grid-ink)] mb-1" id="oaao-sdlg-title"></div>
        <div class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-relaxed max-w-[42rem]" id="oaao-sdlg-sub"></div>`;
    const titleInit = header.querySelector('#oaao-sdlg-title');
    const subInit = header.querySelector('#oaao-sdlg-sub');
    if (titleInit) titleInit.textContent = first.title;
    if (subInit) subInit.innerHTML = first.sub;
    body.appendChild(header);
    body.appendChild(scroll);
    root.appendChild(body);

    /** @type {Set<string>} */
    const hydrated = new Set();
    /** @type {Array<() => void>} */
    const panelTeardowns = [];

    /**
     * @param {typeof sections[number]} sec
     * @param {HTMLElement} host
     */
    async function ensurePanel(sec, host) {
        if (hydrated.has(sec.section_id)) return;

        try {
            if (sec.panel_html) {
                try {
                    JIT?.hydrate(host);
                } catch (e) {
                    console.warn('[oaao] settings-dialog: JIT hydrate(panel_html)', sec.section_id, e);
                }
                hydrated.add(sec.section_id);
                return;
            }

            if (sec.panel_url) {
                oaaoMountLoadingLogo(host, { block: true, label: oaaoT('settings.dialog.loading_panel') });
                const res = await fetch(resolveShellRegistryUrl(sec.panel_url), {
                    credentials: 'include',
                    redirect: 'manual',
                    headers: {
                        Accept: 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                });

                if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
                    const loc = res.headers.get('Location') || '';
                    const hint = loc ? ` ${loc}` : '';
                    host.innerHTML = `<p class="text-sm fg-[var(--grid-ink-muted)]">${oaaoT(
                        'settings.dialog.panel_load_failed',
                        '',
                        { status: `${res.status}${hint}` },
                    )}</p>`;
                    JIT?.hydrate(host);
                    hydrated.add(sec.section_id);
                    return;
                }

                const raw = await res.text();
                const ct = (res.headers.get('content-type') || '').toLowerCase();
                /** @type {unknown} */
                let payload = null;
                if (ct.includes('application/json')) {
                    try {
                        payload = JSON.parse(raw);
                    } catch {
                        payload = null;
                    }
                }
                if (payload && typeof payload === 'object' && payload !== null && 'success' in payload) {
                    const p = /** @type {{ success?: boolean, data?: { html?: string }, message?: string }} */ (payload);
                    if (p.success && typeof p.data?.html === 'string') {
                        host.innerHTML = p.data.html;
                    } else {
                        const msg =
                            typeof p.message === 'string' && p.message
                                ? p.message
                                : oaaoT('settings.dialog.panel_load_failed', '', { status: String(res.status) });
                        host.innerHTML = `<p class="text-sm fg-[var(--grid-ink-muted)]">${msg}</p>`;
                    }
                } else if (!res.ok) {
                    host.innerHTML = `<p class="text-sm fg-[var(--grid-ink-muted)]">${oaaoT(
                        'settings.dialog.panel_load_failed',
                        '',
                        { status: String(res.status) },
                    )}</p>`;
                } else {
                    host.innerHTML = raw;
                }
                JIT?.hydrate(host);
                hydrated.add(sec.section_id);
                return;
            }

            if (sec.panel_js_module) {
                host.textContent = '';
                const mod = await import(
                    /* webpackIgnore: true */ oaaoAppendShellEsmV(resolveShellRegistryUrl(sec.panel_js_module)),
                );
                if (typeof mod.mountSettingsPanel === 'function') {
                    await mod.mountSettingsPanel(host, { razyui, section: sec, Dialog, JIT, oaaoT });
                }
                if (typeof mod.teardownSettingsPanel === 'function') {
                    panelTeardowns.push(() => {
                        mod.teardownSettingsPanel();
                    });
                }
                JIT?.hydrate(host);
                hydrated.add(sec.section_id);
                return;
            }

            host.innerHTML =
                `<p class="text-sm fg-[var(--grid-ink-muted)]">${oaaoT('settings.dialog.panel_none')}</p>`;
            hydrated.add(sec.section_id);
        } catch (e) {
            console.warn('[oaao] settings-dialog: ensurePanel failed', sec.section_id, e);
            host.innerHTML = `<p class="text-sm fg-[var(--grid-ink-muted)]">${oaaoT('settings.dialog.panel_error')}</p>`;
        } finally {
            try {
                JIT?.hydrate(host);
            } catch {
                /* ignore */
            }
        }
    }

    /**
     * @param {string} targetId
     */
    async function activate(targetId) {
        const sec = sections.find((s) => s.section_id === targetId);
        if (!sec) return;

        nav.querySelectorAll('[data-settings-nav]').forEach((b) => {
            const el = /** @type {HTMLButtonElement} */ (b);
            el.className = el.dataset.settingsNav === targetId ? SDLG_ITEM_ACTIVE_JIT : SDLG_ITEM_JIT;
        });

        const titleEl = root.querySelector('#oaao-sdlg-title');
        const subEl = root.querySelector('#oaao-sdlg-sub');
        if (titleEl) titleEl.textContent = sec.title;
        if (subEl) subEl.innerHTML = sec.sub;

        scroll.querySelectorAll('[data-settings-panel]').forEach((panel) => {
            const id = panel.getAttribute('data-settings-panel');
            const show = id === targetId;
            panel.classList.toggle('hidden', !show);
            panel.toggleAttribute('hidden', !show);
        });

        const host = scroll.querySelector(`[data-settings-panel="${CSS.escape(targetId)}"]`);
        if (host instanceof HTMLElement) {
            await ensurePanel(sec, host);
        }
    }

    nav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-settings-nav]');
        if (!btn) return;
        const target = /** @type {HTMLButtonElement} */ (btn).dataset.settingsNav;
        if (target) void activate(target);
    });

    void activate(first.section_id);

    new Dialog({
        id: 'oaao-workspace-settings',
        title: oaaoT('settings.dialog.title'),
        content: root,
        size: 'xl',
        /** Sets {@code height} via Dialog runtime ({@code JIT.TOKEN.resolveSize}) — reliable vs comma-heavy JIT arbitrary classes on {@code .dialog-box}. */
        height: 'min(640px, calc(100vh - 3rem))',
        closable: true,
        buttons: [],
        onOpen(ctrl) {
            const overlay = ctrl.body?.closest('.dialog-overlay');
            const box = ctrl.dialog;
            const chromeHeader = box?.querySelector('.dialog-header');
            applyJitTokens(box, SDLG_DIALOG_BOX_JIT);
            applyJitTokens(ctrl.body, SDLG_DIALOG_BODY_JIT);
            chromeHeader?.classList.add('hidden');
            try {
                JIT?.hydrate(overlay ?? ctrl.body ?? root);
                /* Second pass: guarantee preset compounds / utilities on injected shell leaves compile */
                JIT?.hydrate(root);
            } catch {
                /* ignore */
            }
        },
        onClose() {
            while (panelTeardowns.length) {
                const fn = panelTeardowns.pop();
                try {
                    fn?.();
                } catch {
                    /* ignore */
                }
            }
        },
    });
}
