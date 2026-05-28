<?php

declare(strict_types=1);

/**
 * GET /library/api/library_documents_search?q=&workspace_id=&limit=
 *
 * Title typeahead for composer @library (CS-2-S10) — not vector search.
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

    $q = trim((string) ($_GET['q'] ?? $_GET['query'] ?? ''));
    $widRaw = $_GET['workspace_id'] ?? null;
    $workspaceId = null;
    if ($widRaw !== null && $widRaw !== '' && (int) $widRaw > 0) {
        $workspaceId = (int) $widRaw;
    }

    $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 24;
    $limit = max(1, min(50, $limit));

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

    if ($q !== '') {
        $sql .= ' AND title ILIKE ?';
        $params[] = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q) . '%';
    }

    $sql .= ' ORDER BY updated_at DESC, document_id DESC LIMIT ' . $limit;

    $st = $ctx['pdo']->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(\PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'data'    => [
            'documents' => \is_array($rows) ? $rows : [],
            'query'     => $q,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
