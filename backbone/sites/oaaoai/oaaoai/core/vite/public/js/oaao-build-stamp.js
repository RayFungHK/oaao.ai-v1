/**
 * Build stamp helpers — append compact build id to user-visible messages for deploy compare.
 */

/** @returns {{ version: string, buildId: string, gitSha: string }} */
export function oaaoEmbeddedBuild() {
    const body = typeof document !== 'undefined' ? document.body : null;
    return {
        version: (body?.dataset?.oaaoVersion ?? '').trim() || '0.0.0',
        buildId: (body?.dataset?.oaaoBuildId ?? '').trim() || '',
        gitSha: (body?.dataset?.oaaoGitSha ?? '').trim() || '',
    };
}

/**
 * @param {unknown} build
 * @returns {string} e.g. {@code abc123de} or empty
 */
export function oaaoBuildTag(build) {
    if (!build || typeof build !== 'object') {
        const embedded = oaaoEmbeddedBuild();
        const fromPage = embedded.gitSha || embedded.buildId;
        return fromPage ? fromPage.slice(0, 12) : '';
    }
    const row = /** @type {Record<string, unknown>} */ (build);
    const sha = String(row.git_sha ?? row.gitSha ?? '').trim();
    if (sha) {
        return sha.slice(0, 12);
    }
    const bid = String(row.build_id ?? row.buildId ?? '').trim();
    return bid ? bid.slice(0, 12) : '';
}

/**
 * @param {string} message
 * @param {unknown} [build] API {@code build} object or page embedded fallback
 */
export function oaaoMessageWithBuild(message, build) {
    const base = String(message ?? '').trim();
    const tag = oaaoBuildTag(build);
    if (!tag) {
        return base;
    }
    return base ? `${base} · ${tag}` : tag;
}

/**
 * @param {unknown} data parsed JSON body
 */
export function oaaoBuildFromResponse(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    const build = /** @type {Record<string, unknown>} */ (data).build;
    return build && typeof build === 'object' ? build : null;
}

/**
 * Compact label for shell chrome (user menu / login footer).
 *
 * @param {{ version?: string, web?: unknown, orchestrator?: unknown }} [opts]
 */
export function oaaoFormatBuildLine(opts = {}) {
    const embedded = oaaoEmbeddedBuild();
    const version = String(opts.version ?? embedded.version ?? '0.0.0').trim() || '0.0.0';
    const webTag = oaaoBuildTag(
        opts.web ?? { build_id: embedded.buildId, git_sha: embedded.gitSha },
    );
    const orchTag = opts.orchestrator ? oaaoBuildTag(opts.orchestrator) : '';
    const parts = [`v${version}`];
    if (webTag) {
        parts.push(`web ${webTag}`);
    }
    if (orchTag && orchTag !== webTag) {
        parts.push(`orch ${orchTag}`);
    }
    return parts.join(' · ');
}

/**
 * @param {{ version?: string, web?: unknown, orchestrator?: unknown, page?: ReturnType<typeof oaaoEmbeddedBuild> }} [opts]
 */
export function oaaoBuildTooltip(opts = {}) {
    const embedded = opts.page ?? oaaoEmbeddedBuild();
    const lines = [];
    const web = opts.web && typeof opts.web === 'object' ? /** @type {Record<string, unknown>} */ (opts.web) : null;
    const orch =
        opts.orchestrator && typeof opts.orchestrator === 'object'
            ? /** @type {Record<string, unknown>} */ (opts.orchestrator)
            : null;
    if (web) {
        lines.push(
            `Web ${String(web.version ?? opts.version ?? embedded.version)} · build ${String(web.build_id ?? '?')} · git ${String(web.git_sha ?? '').slice(0, 12)}`,
        );
    } else {
        lines.push(`Web (page) v${embedded.version} · build ${embedded.buildId || '?'} · git ${embedded.gitSha.slice(0, 12)}`);
    }
    if (orch) {
        lines.push(
            `Orchestrator ${String(orch.version ?? '?')} · build ${String(orch.build_id ?? '?')} · git ${String(orch.git_sha ?? '').slice(0, 12)}`,
        );
    }
    return lines.join('\n');
}
