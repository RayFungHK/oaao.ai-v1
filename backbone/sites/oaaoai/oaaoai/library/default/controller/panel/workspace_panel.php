<?php

declare(strict_types=1);

/**
 * GET /library/workspace-panel — SPA shell HTML for workspace/library.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');

    $auth = $this->api('auth');
    $core = $this->api('core');
    $pdo = $auth?->getDB()?->getDBAdapter();
    if ($pdo instanceof \PDO && $core) {
        $core->rejectCustomerProductApi($pdo);
    }

    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return;
    }

    $user = $auth->getUser();
    if (! $user) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Not authenticated',
            'data'    => ['sign_in_path' => $auth->signInPath()],
        ]);

        return;
    }

    $html = $this->loadTemplate('workspace_panel')->output();
    echo json_encode(['success' => true, 'data' => ['html' => $html]], JSON_UNESCAPED_UNICODE);
};
