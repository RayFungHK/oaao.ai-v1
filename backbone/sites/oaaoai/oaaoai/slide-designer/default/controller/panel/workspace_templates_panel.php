<?php

declare(strict_types=1);

/**
 * GET /slide-designer/workspace-templates-panel — SPA shell HTML for template gallery (Gallery layout).
 */
return function (): void {
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $auth->restrict(true);
    $user = $auth->getUser();
    if (! $user) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Not authenticated',
            'data'    => ['sign_in_path' => $auth->signInPath()],
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $html = $this->loadTemplate('workspace_templates_panel')->output();
    echo json_encode(['success' => true, 'data' => ['html' => $html]], JSON_UNESCAPED_UNICODE);
};
