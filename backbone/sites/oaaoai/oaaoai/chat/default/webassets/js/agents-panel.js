/**
 * Workspace Agents page — catalog of orchestrator agent capabilities.
 */

import { OAAO_TASK_AGENT_CATALOG } from './oaao-agent-catalog.js';

const OAAO_AGENTS_PAGE_CSS_REV = '20260519-agents-page';

/** @type {string[]} */
let oaaoAgentsPageAllowed = [];

/** @type {Promise<((key: string, fallback?: string) => string) | null> | null} */
let oaaoAgentsI18nPromise = null;

/** @returns {Promise<((key: string, fallback?: string) => string) | null>} */
function loadAgentsI18n() {
    if (!oaaoAgentsI18nPromise) {
        const base = document.body?.dataset?.oaaoMountPrefix ?? '';
        const url = `${base}/webassets/core/default/js/oaao-i18n.js`;
        oaaoAgentsI18nPromise = import(/* webpackIgnore: true */ url)
            .then((m) => (typeof m.oaaoT === 'function' ? m.oaaoT : null))
            .catch(() => null);
    }
    return oaaoAgentsI18nPromise;
}

function ensureAgentsPageCss() {
    if (typeof document === 'undefined') return;
    const href = `${document.body?.dataset?.oaaoMountPrefix ?? ''}/webassets/chat/default/css/oaao-agents-page.css?v=${encodeURIComponent(OAAO_AGENTS_PAGE_CSS_REV)}`;
    let link = document.querySelector('link[data-oaao-agents-page-css]');
    if (link instanceof HTMLLinkElement && link.href.includes(OAAO_AGENTS_PAGE_CSS_REV)) return;
    link?.remove();
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.oaaoAgentsPageCss = OAAO_AGENTS_PAGE_CSS_REV;
    document.head.append(link);
}

/**
 * @param {string} key
 * @param {string} fallback
 */
function agentsT(key, fallback) {
    return fallback;
}

/**
 * @param {HTMLElement} root
 */
function applyAgentsPageI18n(root) {
    void loadAgentsI18n().then((fn) => {
        if (typeof fn !== 'function') return;
        root.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            if (!key) return;
            const fb = el.textContent || '';
            el.textContent = fn(key, fb);
        });
        root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
            const spec = el.getAttribute('data-i18n-attr');
            if (!spec) return;
            for (const pair of spec.split(';')) {
                const [attr, key] = pair.split(':').map((s) => s.trim());
                if (!attr || !key) continue;
                const fb = el.getAttribute(attr) || '';
                el.setAttribute(attr, fn(key, fb));
            }
        });
        renderAgentsGrid(root.querySelector('[data-oaao-agents="grid"]'));
    });
}

/**
 * @param {HTMLElement | null} grid
 */
function renderAgentsGrid(grid) {
    if (!(grid instanceof HTMLElement)) return;

    const allowed = new Set(
        (oaaoAgentsPageAllowed.length ? oaaoAgentsPageAllowed : OAAO_TASK_AGENT_CATALOG.map((e) => e.id)).map((k) =>
            String(k).trim(),
        ),
    );

    grid.replaceChildren();
    const list = document.createElement('ul');
    list.className = 'oaao-agents-grid';

    for (const entry of OAAO_TASK_AGENT_CATALOG) {
        const enabled = allowed.has(entry.id);
        const li = document.createElement('li');
        li.className = 'oaao-agents-card' + (enabled ? ' oaao-agents-card--enabled' : ' oaao-agents-card--disabled');
        li.dataset.agentKind = entry.id;

        const icon = document.createElement('span');
        icon.className = 'oaao-agents-card-icon';
        icon.innerHTML = entry.icon;

        const copy = document.createElement('div');
        copy.className = 'oaao-agents-card-copy';

        const titleRow = document.createElement('div');
        titleRow.className = 'oaao-agents-card-title-row';

        const title = document.createElement('h2');
        title.className = 'oaao-agents-card-title';
        title.setAttribute('data-i18n', entry.labelKey);
        title.textContent = agentsT(entry.labelKey, entry.fallbackLabel);

        const badge = document.createElement('span');
        badge.className = 'oaao-agents-card-badge';
        badge.setAttribute('data-i18n', enabled ? 'workspace.agents.badge_enabled' : 'workspace.agents.badge_disabled');
        badge.textContent = agentsT(
            enabled ? 'workspace.agents.badge_enabled' : 'workspace.agents.badge_disabled',
            enabled ? 'Enabled' : 'Not enabled',
        );

        titleRow.append(title, badge);

        const desc = document.createElement('p');
        desc.className = 'oaao-agents-card-desc';
        desc.setAttribute('data-i18n', entry.descKey);
        desc.textContent = agentsT(entry.descKey, entry.fallbackDesc);

        copy.append(titleRow, desc);
        li.append(icon, copy);
        list.append(li);
    }

    grid.append(list);
}

/**
 * @param {CustomEvent<{ allowed?: string[] }>} ev
 */
function onAllowedAgentsChanged(ev) {
    const raw = ev.detail?.allowed;
    if (Array.isArray(raw)) {
        oaaoAgentsPageAllowed = raw.map((k) => String(k ?? '').trim()).filter(Boolean);
    }
    const grid = document.querySelector('[data-oaao-agents="grid"]');
    if (grid) renderAgentsGrid(grid);
}

/** @param {HTMLElement} mount */
function wireAgentsPage(mount) {
    const grid = mount.querySelector('[data-oaao-agents="grid"]');
    renderAgentsGrid(grid);
    applyAgentsPageI18n(mount);
    document.addEventListener('oaao:allowed-agents-changed', onAllowedAgentsChanged);
}

/** @param {HTMLElement} mount */
function teardownAgentsPage(mount) {
    document.removeEventListener('oaao:allowed-agents-changed', onAllowedAgentsChanged);
    mount.querySelector('[data-oaao-agents="grid"]')?.replaceChildren?.();
}

/**
 * @param {HTMLElement} mount
 */
export async function mountShellPanel(mount) {
    ensureAgentsPageCss();
    teardownAgentsPage(mount);
    wireAgentsPage(mount);

    return () => {
        teardownAgentsPage(mount);
    };
}
