<?php

/**
 * GET /vault/workspace-panel — JSON loader for SPA shell ({@see workspace_vault_panel.tpl} HTML fragment in {@code data.html}).
 */
return function (): void {
    header('Cache-Control: no-store, no-cache, must-revalidate');

    require_once dirname(__DIR__, 4) . '/core/default/library/PlatformProductGuard.php';
    $auth = $this->api('auth');
    $pdo = $auth?->getDB()?->getDBAdapter();
    if ($pdo instanceof \PDO) {
        \Oaaoai\Core\PlatformProductGuard::rejectCustomerProductApi($pdo);
    }

    if (! $auth) {
        $this->oaao_vault_panel_json_exit(503, false, 'Authentication unavailable');
    }

    $user = $auth->getUser();
    if (! $user) {
        $this->oaao_vault_panel_json_exit(401, false, 'Not authenticated', [
            'sign_in_path' => $auth->signInPath(),
        ]);
    }

    $html = $this->loadTemplate('workspace_vault_panel')->output();
    $this->oaao_vault_panel_json_exit(200, true, '', ['html' => $html]);
};
