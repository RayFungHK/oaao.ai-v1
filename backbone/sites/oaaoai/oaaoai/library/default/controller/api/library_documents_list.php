<?php

declare(strict_types=1);

/**
 * GET /library/api/library_documents_list?workspace_id=
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    if ($tenantId < 1) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Tenant context required']);

        return;
    }

    $widRaw = $_GET['workspace_id'] ?? null;
    $workspaceId = null;
    if ($widRaw !== null && $widRaw !== '' && (int) $widRaw > 0) {
        $workspaceId = (int) $widRaw;
    }

    $sql = 'SELECT document_id, title, status, updated_at
            FROM oaao_library_document
            WHERE tenant_id = ?';
    $params = [$tenantId];
    if ($workspaceId !== null) {
        $sql .= ' AND workspace_id = ?';
        $params[] = $workspaceId;
    } else {
        $sql .= ' AND workspace_id IS NULL';
    }
    $sql .= ' ORDER BY updated_at DESC, document_id DESC LIMIT 200';

    $st = $ctx['pdo']->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(\PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data'    => [
            'documents' => \is_array($rows) ? $rows : [],
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
