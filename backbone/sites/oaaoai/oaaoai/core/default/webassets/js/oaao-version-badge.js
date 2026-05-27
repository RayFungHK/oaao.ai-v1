/**
 * Build/version line in shell chrome + stale-deploy banner.
 * Per-message stamps: {@see oaao-build-stamp.js} / {@see oaao-razy-toast.js}.
 */

import { oaaoBuildTooltip, oaaoEmbeddedBuild, oaaoFormatBuildLine, oaaoMessageWithBuild } from './oaao-build-stamp.js';

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

/** @param {Record<string, unknown>} [data] */
function renderBuildInfoLines(data) {
    const embedded = oaaoEmbeddedBuild();
    const web = data?.web && typeof data.web === 'object' ? /** @type {Record<string, unknown>} */ (data.web) : null;
    const orch =
        data?.orchestrator && typeof data.orchestrator === 'object'
            ? /** @type {Record<string, unknown>} */ (data.orchestrator)
            : null;
    const version = String(web?.version ?? embedded.version ?? '0.0.0');
    const label = oaaoFormatBuildLine({ version, web: web ?? undefined, orchestrator: orch ?? undefined });
    const tip = oaaoBuildTooltip({ version, web: web ?? undefined, orchestrator: orch ?? undefined, page: embedded });
    document.querySelectorAll('.oaao-build-info-line').forEach((el) => {
        if (!(el instanceof HTMLElement)) {
            return;
        }
        el.textContent = label;
        el.title = tip;
    });
}

/** @param {Record<string, unknown>} data */
function applyBuildInfo(data) {
    const embedded = oaaoEmbeddedBuild();
    renderBuildInfoLines(data);
    const web = data.web && typeof data.web === 'object' ? /** @type {Record<string, unknown>} */ (data.web) : {};
    const liveBuildId = String(web.build_id ?? data.build_id ?? '');

    const stackMismatch = data.stack_mismatch === true;
    const pageStale = liveBuildId !== '' && embedded.buildId !== '' && liveBuildId !== embedded.buildId;

    if (stackMismatch) {
        const orch =
            data.orchestrator && typeof data.orchestrator === 'object'
                ? /** @type {Record<string, unknown>} */ (data.orchestrator)
                : {};
        showStaleBanner(
            oaaoMessageWithBuild(
                `Stack mismatch: web ${embedded.buildId} vs orchestrator ${String(orch.build_id ?? '?')} — refresh or rebuild containers.`,
                web,
            ),
        );
    } else if (pageStale) {
        showStaleBanner(
            oaaoMessageWithBuild(
                `New build deployed (${liveBuildId}). Your page is still on ${embedded.buildId} — reload to pick up changes.`,
                web,
            ),
        );
    }
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

async function pollBuildInfo() {
    try {
        const res = await fetch(buildInfoUrl(), { credentials: 'include', headers: { Accept: 'application/json' } });
        if (!res.ok) {
            return;
        }
        const data = await res.json();
        if (data && typeof data === 'object') {
            applyBuildInfo(/** @type {Record<string, unknown>} */ (data));
        }
    } catch {
        /* offline — keep page-embedded label */
    }
}

/** Mount build line + stale-deploy polling. */
export function initOaaoVersionBadge() {
    if (typeof document === 'undefined') {
        return;
    }
    renderBuildInfoLines();
    void pollBuildInfo();
    window.setInterval(() => {
        void pollBuildInfo();
    }, 45000);
}
