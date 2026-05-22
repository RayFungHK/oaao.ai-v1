<?php

/**
 * GET /live-meeting/workspace-panel — SPA shell HTML for workspace/live-meeting.
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
        $this->oaao_live_json_exit(503, false, 'Authentication unavailable');
    }

    $user = $auth->getUser();
    if (! $user) {
        $this->oaao_live_json_exit(401, false, 'Not authenticated', [
            'sign_in_path' => $auth->signInPath(),
        ]);
    }

    $html = $this->loadTemplate('workspace_panel')->output();
    $this->oaao_live_json_exit(200, true, '', ['html' => $html]);
};
