<?php

declare(strict_types=1);

/**
 * GET /calendar/workspace-panel — SPA shell HTML for workspace/calendar.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return;
    }

    $user = $auth->getUser();
    if (! $user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);

        return;
    }

    $html = $this->loadTemplate('workspace_panel')->output();
    echo json_encode(['success' => true, 'data' => ['html' => $html]], JSON_UNESCAPED_UNICODE);
};
