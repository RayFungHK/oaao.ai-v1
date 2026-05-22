<?php

/**
 * GET /chat/workspace-panel — JSON loader for the SPA shell ({@code data.html} is {@see workspace_panel} template output).
 *
 * Unauthenticated responses match {@see api/me} / {@see restrict} JSON shape ({@code success}, {@code message}, {@code data.sign_in_path}).
 * The browser builds hint markup from JSON — no ad-hoc HTML strings in PHP for auth errors.
 *
 * Lives under {@code controller/panel/} so the closure path contains {@code /} and avoids the controller-root
 * `{className}.{name}.php` prefix rule (naming collision guard).
 */
return function (): void {
    header('Cache-Control: no-store, no-cache, must-revalidate');

    $auth = $this->api('auth');
    $core = $this->api('core');
    $pdo = $auth?->getDB()?->getDBAdapter();
    if ($pdo instanceof \PDO && $core) {
        $core->rejectCustomerProductApi($pdo);
    }

    if (! $auth) {
        $this->oaao_workspace_panel_json_exit(503, false, 'Authentication unavailable');
    }

    $user = $auth->getUser();
    if (! $user) {
        $this->oaao_workspace_panel_json_exit(401, false, 'Not authenticated', [
            'sign_in_path' => $auth->signInPath(),
        ]);
    }

    $html = $this->loadTemplate('workspace_panel')->output();
    $this->oaao_workspace_panel_json_exit(200, true, '', ['html' => $html]);
};
