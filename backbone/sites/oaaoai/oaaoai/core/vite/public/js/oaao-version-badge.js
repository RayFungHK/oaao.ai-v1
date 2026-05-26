/**
 * Version / build badge + stale-deploy banner (dev visibility).
 * Compares page-embedded build_id with live {@code GET /api/build_info}.
 */

/** @returns {string} */
function mountPrefix() {
    const raw = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    if (!raw || raw === '/') {
        return '';
    }
    return raw.startsWith('/') ? raw.replace(/\/+$/, '') : `/${raw.replace(/\/+$/, '')}`;
}

/** @returns {string} */
function buildInfoUrl() {
    return `${mountPrefix()}/api/build_info`;
}

/** @returns {{ version: string, buildId: string, gitSha: string }} */
function embeddedBuild() {
    const body = typeof document !== 'undefined' ? document.body : null;
    return {
        version: (body?.dataset?.oaaoVersion ?? '').trim() || '0.0.0',
        buildId: (body?.dataset?.oaaoBuildId ?? '').trim() || 'unknown',
        gitSha: (body?.dataset?.oaaoGitSha ?? '').trim() || '',
    };
}

/** @param {string} buildId @param {string} gitSha */
function formatLabel(buildId, gitSha) {
    const embedded = embeddedBuild();
    const ver = embedded.version;
    const short = (gitSha || buildId || '').slice(0, 12);
    return short ? `v${ver} · ${short}` : `v${ver}`;
}

function ensureBadge() {
    let el = document.getElementById('oaao-version-badge');
    if (el) {
        return el;
    }
    el = document.createElement('div');
    el.id = 'oaao-version-badge';
    el.className = 'oaao-version-badge';
    el.title = 'oaao.ai build';
    document.body.appendChild(el);
    return el;
}

function ensureBanner() {
    return document.getElementById('oaao-version-stale-banner');
}

/** @param {string} message */
function showStaleBanner(message) {
    const banner = ensureBanner();
    if (!(banner instanceof HTMLElement)) {
        return;
    }
    banner.textContent = message;
    banner.classList.remove('hidden');
}

/** @param {Record<string, unknown>} data */
function applyBuildInfo(data) {
    const embedded = embeddedBuild();
    const web = data.web && typeof data.web === 'object' ? /** @type {Record<string, unknown>} */ (data.web) : {};
    const liveBuildId = String(web.build_id ?? data.build_id ?? '');
    const liveSha = String(web.git_sha ?? data.git_sha ?? '');
    const badge = ensureBadge();
    badge.textContent = formatLabel(liveBuildId || embedded.buildId, liveSha || embedded.gitSha);

    const stackMismatch = data.stack_mismatch === true;
    const pageStale = liveBuildId !== '' && embedded.buildId !== '' && liveBuildId !== embedded.buildId;

    if (stackMismatch) {
        const orch =
            data.orchestrator && typeof data.orchestrator === 'object'
                ? /** @type {Record<string, unknown>} */ (data.orchestrator)
                : {};
        showStaleBanner(
            `Stack mismatch: web ${embedded.buildId} vs orchestrator ${String(orch.build_id ?? '?')} — refresh or rebuild containers.`,
        );
    } else if (pageStale) {
        showStaleBanner(
            `New build deployed (${liveBuildId}). Your page is still on ${embedded.buildId} — reload to pick up changes.`,
        );
    }
}

async function pollBuildInfo() {
    try {
        const res = await fetch(buildInfoUrl(), { credentials: 'include', headers: { Accept: 'application/json' } });
        if (!res.ok) {
            return;
        }
        const data = await res.json();
        if (data && typeof data === 'object') {
            applyBuildInfo(data);
        }
    } catch {
        /* offline / auth gate — badge stays on embedded values */
    }
}

/** Mount badge and start polling when shell is up. */
export function initOaaoVersionBadge() {
    if (typeof document === 'undefined') {
        return;
    }
    const embedded = embeddedBuild();
    const badge = ensureBadge();
    badge.textContent = formatLabel(embedded.buildId, embedded.gitSha);
    void pollBuildInfo();
    window.setInterval(() => {
        void pollBuildInfo();
    }, 45000);
}
