/**
 * Platform admin shell — left sidemenu + panel host (mirrors Settings dialog chrome).
 */

import { oaaoAppendShellEsmV, resolveShellRegistryUrl } from './shell-registry-url.js';
import { oaaoLoadingLogoElement } from './oaao-loading-logo.js';

const NAV_JIT =
    'flex flex-col shrink-0 w-[240px] min-w-[180px] [border-right:1px_solid_var(--grid-line)] bg-[var(--grid-nav)] py-4 overflow-y-auto overflow-x-hidden gap-0.5';
const BODY_JIT = 'flex flex-1 flex-col min-w-0 min-h-0 bg-[var(--grid-panel-bright)]';
const HEADER_JIT =
    'shrink-0 px-8 pt-6 pb-4 [border-bottom:1px_solid_var(--grid-line)]';
const CONTENT_JIT =
    'flex-1 min-h-0 overflow-y-auto overflow-x-hidden [overscroll-behavior-y:contain] px-8 py-6';
const ITEM_JIT =
    'flex items-center gap-3 w-full px-4 py-[0.45rem] mx-0 box-border border-0 bg-transparent text-[0.8125rem] fw-medium fg-[var(--grid-ink-muted)] cursor-pointer rounded-none text-left font-inherit transition-colors hover:bg-[rgba(55,53,47,0.04)] hover:fg-[var(--grid-ink)]';
const ITEM_ACTIVE_JIT =
    'flex items-center gap-3 w-full px-4 py-[0.45rem] mx-0 box-border border-0 text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] cursor-pointer rounded-none text-left font-inherit transition-colors bg-[rgba(55,53,47,0.06)] border-l-[3px] border-l-[var(--grid-accent)] hover:bg-[rgba(55,53,47,0.08)]';

/** @type {{ Dialog?: unknown, JIT?: { hydrate?: (root: Element | DocumentFragment) => void } } | null} */
let platformPanelCtx = null;

/**
 * @param {Record<string, unknown>} user
 * @param {string} authBaseRaw
 * @param {*} [razyui]
 */
export function initPlatformShell(user, authBaseRaw, razyui) {
    applyPlatformUi(user);
    wirePlatformLogout(authBaseRaw);
    void mountPlatformSideMenu(razyui);
}

function applyPlatformUi(user) {
    const label = document.getElementById('platform-user-label');
    const name = String(user.display_name || user.login_name || user.email || `User #${user.user_id}`);
    if (label) {
        label.textContent = `${name} · platform_admin`;
    }
}

function wirePlatformLogout(authBaseRaw) {
    const btn = document.getElementById('platform-logout');
    if (!btn || btn.dataset.oaaoLogoutBound === '1') return;
    btn.dataset.oaaoLogoutBound = '1';
    btn.addEventListener('click', async () => {
        const base = authBaseRaw.trim().replace(/\/?$/, '/');
        try {
            await fetch(`${base}logout`, { method: 'POST', credentials: 'include' });
        } catch {
            /* reload anyway */
        }
        window.location.reload();
    });
}

function readPlatformNavRegistry() {
    const el = document.getElementById('oaao-settings-registry');
    const raw = el?.textContent?.trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function mountPlatformSideMenu(razyui) {
    const mount = document.getElementById('platform-shell-root');
    if (!(mount instanceof HTMLElement)) return;

    await ensurePlatformPanelCtx(razyui);

    /** @type {Array<Record<string, unknown>>} */
    const registry = readPlatformNavRegistry();
    /** @type {Array<{ section_id: string, label: string, title: string, sub: string, icon: string, panel_js_module?: string }>} */
    const sections = [];
    for (const row of registry) {
        if (!row || typeof row !== 'object') continue;
        const section_id = typeof row.section_id === 'string' ? row.section_id.trim() : '';
        if (!section_id) continue;
        sections.push({
            section_id,
            label: typeof row.label === 'string' ? row.label : section_id,
            title: typeof row.title === 'string' ? row.title : section_id,
            sub: typeof row.sub === 'string' ? row.sub : '',
            icon: typeof row.icon === 'string' ? row.icon : 'menu',
            panel_js_module: typeof row.panel_js_module === 'string' ? row.panel_js_module : undefined,
        });
    }

    if (sections.length === 0) {
        mount.textContent = '';
        mount.append(errorText('Platform navigation is not configured.'));
        return;
    }

    mount.textContent = '';
    const nav = document.createElement('nav');
    nav.className = `${NAV_JIT} platform-shell-nav`;
    nav.setAttribute('aria-label', 'Platform sections');

    const body = document.createElement('div');
    body.className = `${BODY_JIT} platform-shell-body`;

    const header = document.createElement('div');
    header.className = `${HEADER_JIT} platform-shell-header`;
    header.innerHTML =
        '<div class="text-[1.125rem] fw-bold fg-[var(--grid-ink)] mb-1" id="platform-panel-title"></div>' +
        '<div class="text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-relaxed max-w-[42rem]" id="platform-panel-sub"></div>';
    body.append(header);

    const scroll = document.createElement('div');
    scroll.className = `${CONTENT_JIT} platform-shell-scroll`;

    const titleEl = () => document.getElementById('platform-panel-title');
    const subEl = () => document.getElementById('platform-panel-sub');

    /** @type {Map<string, HTMLElement>} */
    const panelHosts = new Map();
    /** @type {Map<string, Promise<void>>} */
    const panelLoaded = new Map();

    sections.forEach((sec, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = i === 0 ? ITEM_ACTIVE_JIT : ITEM_JIT;
        btn.dataset.platformNav = sec.section_id;
        const ic = iconClasses(sec.icon);
        btn.innerHTML = `<i class="${ic} not-italic text-[16px]" aria-hidden="true"></i><span>${sec.label}</span>`;
        nav.append(btn);

        const panelWrap = document.createElement('div');
        panelWrap.dataset.platformPanel = sec.section_id;
        panelWrap.className = 'min-h-0';
        if (i !== 0) {
            panelWrap.hidden = true;
        }
        const panelHost = document.createElement('div');
        panelHost.className = 'platform-panel-host';
        panelWrap.append(panelHost);
        scroll.append(panelWrap);
        panelHosts.set(sec.section_id, panelHost);

        btn.addEventListener('click', () => {
            for (const b of nav.querySelectorAll('[data-platform-nav]')) {
                b.className = b === btn ? ITEM_ACTIVE_JIT : ITEM_JIT;
            }
            for (const p of scroll.querySelectorAll('[data-platform-panel]')) {
                const on = p.dataset.platformPanel === sec.section_id;
                p.hidden = !on;
            }
            if (titleEl()) titleEl().textContent = sec.title;
            if (subEl()) subEl().textContent = sec.sub;
            void ensurePanel(sec);
        });
    });

    body.append(scroll);
    mount.append(nav, body);

    const first = sections[0];
    if (titleEl()) titleEl().textContent = first.title;
    if (subEl()) subEl().textContent = first.sub;
    await ensurePanel(first);

    async function ensurePanel(sec) {
        const host = panelHosts.get(sec.section_id);
        if (!(host instanceof HTMLElement) || !sec.panel_js_module) return;
        if (panelLoaded.has(sec.section_id)) {
            return panelLoaded.get(sec.section_id);
        }
        const job = (async () => {
            host.textContent = '';
            host.append(loadingNote());
            try {
                const url = oaaoAppendShellEsmV(resolveShellRegistryUrl(sec.panel_js_module));
                const mod = await import(url);
                host.textContent = '';
                if (typeof mod.mountSettingsPanel === 'function') {
                    await mod.mountSettingsPanel(host, { section: sec, ...platformPanelCtx });
                } else {
                    host.append(errorText('Panel module missing mountSettingsPanel.'));
                }
            } catch (e) {
                host.textContent = '';
                host.append(errorText('Could not load this panel.'));
                console.warn('[oaao] platform-shell: panel failed', sec.section_id, e);
            }
        })();
        panelLoaded.set(sec.section_id, job);
        return job;
    }
}

async function ensurePlatformPanelCtx(razyui) {
    if (platformPanelCtx) return platformPanelCtx;

    const dialogHref = new URL('../razyui/component/Dialog.js', import.meta.url).href;
    const loads = [import(dialogHref)];
    if (razyui && typeof razyui.load === 'function') {
        loads.push(razyui.load('JIT'));
    }
    const [DialogMod, JITModule] = await Promise.all(loads);
    const Dialog = DialogMod?.default;
    const JIT =
        JITModule && typeof JITModule.hydrate === 'function'
            ? JITModule
            : JITModule?.default && typeof JITModule.default.hydrate === 'function'
              ? JITModule.default
              : null;

    platformPanelCtx = { Dialog, JIT };
    return platformPanelCtx;
}

function iconClasses(icon) {
    const s = String(icon ?? '').trim();
    if (!s) return 'ri-menu-meatballs-1 rz-icon';
    if (s.includes(' ') || s.startsWith('ri-')) {
        return `${s}${s.includes('rz-icon') ? '' : ' rz-icon'}`;
    }
    return `ri-${s} rz-icon`;
}

function loadingNote() {
    return oaaoLoadingLogoElement({ label: 'Loading…' });
}

function errorText(text) {
    const p = document.createElement('p');
    p.className = 'text-sm fg-[var(--grid-danger)]';
    p.textContent = text;
    return p;
}
