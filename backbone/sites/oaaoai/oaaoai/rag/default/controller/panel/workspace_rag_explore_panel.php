<?php

declare(strict_types=1);

/**
 * GET /rag/workspace-panel — JSON loader for RAG Explore SPA shell.
 */
return function (): void {
    header('Cache-Control: no-store, no-cache, must-revalidate');

    $auth = $this->api('auth');
    $pdo = $auth?->getDB()?->getDBAdapter();
    if ($pdo instanceof \PDO) {
        $this->api('core')?->rejectCustomerProductApi($pdo);
    }

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

    $html = $this->loadTemplate('workspace_rag_explore_panel')->output();
    echo json_encode(['success' => true, 'data' => ['html' => $html]]);
};
