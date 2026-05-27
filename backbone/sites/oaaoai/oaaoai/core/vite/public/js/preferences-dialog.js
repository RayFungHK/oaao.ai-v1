/**
 * Workspace Preferences dialog — registry-driven left nav + panels ({@see PreferencesRegister} PHP).
 * Mirrors {@see settings-dialog.js} chrome; sections may declare {@code levels} (tenant / workspace / personal).
 */

import { oaaoAppendShellEsmV, resolveShellRegistryUrl } from './shell-registry-url.js';
import { oaaoT } from './oaao-i18n.js';
import { oaaoLoadingLogoElement, oaaoMountLoadingLogo } from './oaao-loading-logo.js';

/** Wide two-pane shell — Manus-style preferences modal ({@link Dialog} {@code width} / {@code height}). */
const PDLG_DIALOG_WIDTH = 'min(1024px, calc(100vw - 3rem))';
const PDLG_DIALOG_HEIGHT = 'min(720px, calc(100vh - 3rem))';

const PDLG_DIALOG_BOX_JIT = 'overflow-hidden bg-[var(--grid-panel-bright)] min-h-0';

const PDLG_DIALOG_BODY_JIT = 'flex flex-col flex-1 min-h-0 overflow-hidden [padding:0]';

const PDLG_ROOT_JIT = [
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

const PDLG_NAV_JIT = [
    'flex',
    'flex-col',
    'shrink-0',
    'w-[260px]',
    'min-w-[200px]',
    '[border-right:1px_solid_var(--grid-line)]',
    'bg-[var(--grid-nav)]',
    'py-4',
    'overflow-y-auto',
    'overflow-x-hidden',
    '[overscroll-behavior-y:contain]',
    'gap-0.5',
].join(' ');

const PDLG_BODY_JIT = ['flex', 'flex-1', 'flex-col', 'min-w-0', 'min-h-0', 'bg-[var(--grid-panel-bright)]'].join(' ');

const PDLG_HEADER_JIT = [
    'shrink-0',
    'px-8',
    'pt-6',
    'pb-4',
    '[border-bottom:1px_solid_var(--grid-line)]',
].join(' ');

const PDLG_CONTENT_JIT = [
    'flex-1',
    'min-h-0',
    'overflow-y-auto',
    'overflow-x-hidden',
    '[overscroll-behavior-y:contain]',
    'px-8',
    'py-6',
].join(' ');

const PDLG_ITEM_JIT = [
    'flex',
    'items-start',
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

const PDLG_ITEM_ACTIVE_JIT = [
    'flex',
    'items-start',
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

/** @type {Record<string, string>} */
const LEVEL_LABEL_KEY = {
    tenant: 'preferences.level.tenant',
    workspace: 'preferences.level.workspace',
    personal: 'preferences.level.personal',
};

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

/**
 * @param {ReadonlyArray<string>} levels
 */
function levelsCaption(levels) {
    return levels.map((l) => oaaoT(LEVEL_LABEL_KEY[l] ?? '', l)).join(' · ');
}

/**
 * @param {unknown} raw
 * @returns {ReadonlyArray<'tenant'|'workspace'|'personal'>}
 */
function normalizeLevels(raw) {
    const allowed = new Set(['tenant', 'workspace', 'personal']);
    const order = /** @type {const} */ (['tenant', 'workspace', 'personal']);
    if (!Array.isArray(raw)) {
        return ['personal'];
    }
    const seen = new Set();
    for (const x of raw) {
        if (typeof x !== 'string') continue;
        const v = x.trim().toLowerCase();
        if (allowed.has(v)) seen.add(v);
    }
    const out = order.filter((l) => seen.has(l));
    return out.length ? out : ['personal'];
}

/**
 * @param {ParentNode} host
 */
function syncPreferencesGreeting(host) {
    const el = host.querySelector('[data-oaao-pref-greeting]');
    if (!el) return;
    const raw = document.getElementById('workspace-user-label')?.textContent?.trim() ?? '';
    const name = raw.split(/\s*·\s*/)[0]?.trim() || raw || 'there';
    el.textContent = oaaoT('preferences.dialog.greeting', 'Welcome back, {{name}}', { name });
}

/**
 * @param {typeof import('../../razyui/razyui.js').default} razyui
 */
export async function openWorkspacePreferencesDialog(razyui) {
    const dialogHref = new URL('../razyui/component/Dialog.js', import.meta.url).href;
    const [DialogMod, JITModule] = await Promise.all([import(dialogHref), razyui.load('JIT')]);
    const Dialog = DialogMod?.default;
    if (typeof Dialog !== 'function') {
        console.error('[oaao] preferences-dialog: Dialog default export missing', DialogMod);
        return;
    }
    const JIT = JITModule && typeof JITModule.hydrate === 'function' ? JITModule : null;

    /** @type {ReadonlyArray<Record<string, unknown>>} */
    const registry = Array.isArray(globalThis.OAAO_PREFERENCES_REGISTRY) ? globalThis.OAAO_PREFERENCES_REGISTRY : [];

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

    /** @type {Array<{ section_id: string, label: string, title: string, sub: string, icon: string, sort: number, levels: ReadonlyArray<string>, panel_html?: string, panel_url?: string, panel_js_module?: string }>} */
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
            levels: normalizeLevels(row.levels),
            panel_html: typeof row.panel_html === 'string' ? row.panel_html : undefined,
            panel_url: typeof row.panel_url === 'string' ? row.panel_url : undefined,
            panel_js_module: typeof row.panel_js_module === 'string' ? row.panel_js_module : undefined,
        });
    }

    if (sections.length === 0) {
        sections.push({
            section_id: 'empty',
            label: oaaoT('preferences.nav.personal.label', 'Preferences'),
            title: oaaoT('preferences.nav.personal.title', 'Preferences'),
            sub: oaaoT('preferences.panel.unknown', 'No sections registered yet.'),
            icon: 'menu-meatballs-1',
            sort: 0,
            levels: ['personal'],
            panel_html:
                '<p class="text-sm fg-[var(--grid-ink-muted)]">Modules register user-facing panels via <code class="font-mono text-xs">preferences.register</code> (PHP). Use <code class="font-mono text-xs">extras.levels</code> for tenant / workspace / personal scope.</p>',
        });
    }

    const root = document.createElement('div');
    root.className = PDLG_ROOT_JIT;

    const nav = document.createElement('nav');
    nav.className = PDLG_NAV_JIT;
    nav.setAttribute('aria-label', oaaoT('preferences.dialog.nav_aria', 'Preferences sections'));

    const scroll = document.createElement('div');
    scroll.className = PDLG_CONTENT_JIT;

    sections.forEach((sec, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = i === 0 ? PDLG_ITEM_ACTIVE_JIT : PDLG_ITEM_JIT;
        btn.dataset.prefsNav = sec.section_id;

        const ic = document.createElement('i');
        ic.className = `${iconClasses(sec.icon)} not-italic text-[16px] shrink-0 mt-0.5`;
        ic.setAttribute('aria-hidden', 'true');

        const textWrap = document.createElement('span');
        textWrap.className = 'flex flex-col items-start min-w-0 gap-0.5 flex-1';

        const lab = document.createElement('span');
        lab.className = 'truncate w-full';
        lab.textContent = sec.label;

        const lv = document.createElement('span');
        lv.className = 'text-[0.68rem] fg-[var(--grid-caption)] leading-tight w-full';
        lv.textContent = levelsCaption(sec.levels);

        textWrap.append(lab, lv);
        btn.append(ic, textWrap);
        nav.appendChild(btn);

        const panel = document.createElement('div');
        panel.dataset.prefsPanel = sec.section_id;
        if (i !== 0) {
            panel.classList.add('hidden');
            panel.hidden = true;
        }
        if (sec.panel_html) {
            panel.innerHTML = sec.panel_html;
        } else {
            panel.append(oaaoLoadingLogoElement({ block: true, label: oaaoT('preferences.dialog.loading_panel', 'Loading…') }));
        }
        scroll.appendChild(panel);
    });

    syncPreferencesGreeting(scroll);

    root.appendChild(nav);

    const body = document.createElement('div');
    body.className = PDLG_BODY_JIT;

    const header = document.createElement('div');
    header.className = PDLG_HEADER_JIT;
    const first = sections[0];
    header.innerHTML = `<div class="text-[1.125rem] fw-bold fg-[var(--grid-ink)] mb-1" id="oaao-pdlg-title"></div>
        <div class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-relaxed max-w-[42rem] mt-1.5 px-0" id="oaao-pdlg-sub"></div>`;
    const titleInit = header.querySelector('#oaao-pdlg-title');
    const subInit = header.querySelector('#oaao-pdlg-sub');
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
     * @param {(typeof sections)[number]} sec
     * @param {HTMLElement} host
     */
    async function ensurePanel(sec, host) {
        if (hydrated.has(sec.section_id)) return;

        try {
            if (sec.panel_html) {
                try {
                    JIT?.hydrate(host);
                } catch (e) {
                    console.warn('[oaao] preferences-dialog: JIT hydrate(panel_html)', sec.section_id, e);
                }
                hydrated.add(sec.section_id);
                return;
            }

            if (sec.panel_url) {
                oaaoMountLoadingLogo(host, { block: true, label: 'Loading…' });
                const res = await fetch(resolveShellRegistryUrl(sec.panel_url), {
                    credentials: 'include',
                    headers: {
                        Accept: 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                });
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
                                : `Could not load panel (${res.status}).`;
                        host.innerHTML = `<p class="text-sm fg-[var(--grid-ink-muted)]">${msg}</p>`;
                    }
                } else if (!res.ok) {
                    host.innerHTML = `<p class="text-sm fg-[var(--grid-ink-muted)]">Could not load panel (${res.status}).</p>`;
                } else {
                    host.innerHTML = raw;
                }
                JIT?.hydrate(host);
                syncPreferencesGreeting(host);
                hydrated.add(sec.section_id);
                return;
            }

            if (sec.panel_js_module) {
                host.textContent = '';
                const mod = await import(
                    /* webpackIgnore: true */ oaaoAppendShellEsmV(resolveShellRegistryUrl(sec.panel_js_module)),
                );
                if (typeof mod.mountPreferencesPanel === 'function') {
                    await mod.mountPreferencesPanel(host, { razyui, section: sec });
                }
                if (typeof mod.teardownPreferencesPanel === 'function') {
                    panelTeardowns.push(() => {
                        mod.teardownPreferencesPanel();
                    });
                }
                JIT?.hydrate(host);
                syncPreferencesGreeting(host);
                hydrated.add(sec.section_id);
                return;
            }

            host.innerHTML =
                '<p class="text-sm fg-[var(--grid-ink-muted)]">No panel source registered for this section.</p>';
            hydrated.add(sec.section_id);
        } catch (e) {
            console.warn('[oaao] preferences-dialog: ensurePanel failed', sec.section_id, e);
            host.innerHTML = '<p class="text-sm fg-[var(--grid-ink-muted)]">Failed to load this panel.</p>';
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

        nav.querySelectorAll('[data-prefs-nav]').forEach((b) => {
            const el = /** @type {HTMLButtonElement} */ (b);
            el.className = el.dataset.prefsNav === targetId ? PDLG_ITEM_ACTIVE_JIT : PDLG_ITEM_JIT;
        });

        const titleEl = root.querySelector('#oaao-pdlg-title');
        const subEl = root.querySelector('#oaao-pdlg-sub');
        if (titleEl) titleEl.textContent = sec.title;
        if (subEl) subEl.innerHTML = sec.sub;

        scroll.querySelectorAll('[data-prefs-panel]').forEach((panel) => {
            const id = panel.getAttribute('data-prefs-panel');
            const show = id === targetId;
            panel.classList.toggle('hidden', !show);
            panel.toggleAttribute('hidden', !show);
        });

        const host = scroll.querySelector(`[data-prefs-panel="${CSS.escape(targetId)}"]`);
        if (host instanceof HTMLElement) {
            await ensurePanel(sec, host);
        }
    }

    nav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-prefs-nav]');
        if (!btn) return;
        const target = /** @type {HTMLButtonElement} */ (btn).dataset.prefsNav;
        if (target) void activate(target);
    });

    void activate(first.section_id);

    new Dialog({
        id: 'oaao-workspace-preferences',
        title: 'Preferences',
        content: root,
        size: 'xl',
        width: PDLG_DIALOG_WIDTH,
        height: PDLG_DIALOG_HEIGHT,
        closable: true,
        buttons: [],
        onOpen(ctrl) {
            const overlay = ctrl.body?.closest('.dialog-overlay');
            const box = ctrl.dialog;
            const chromeHeader = box?.querySelector('.dialog-header');
            applyJitTokens(box, PDLG_DIALOG_BOX_JIT);
            applyJitTokens(ctrl.body, PDLG_DIALOG_BODY_JIT);
            chromeHeader?.classList.add('hidden');
            try {
                JIT?.hydrate(overlay ?? ctrl.body ?? root);
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
