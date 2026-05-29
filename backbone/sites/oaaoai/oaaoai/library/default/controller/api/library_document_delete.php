<?php

declare(strict_types=1);

/**
 * POST /library/api/library_document_delete — body { document_id }
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $docId = (int) ($input['document_id'] ?? 0);
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'document_id required']);

        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    $check = $ctx['pdo']->prepare(
        'SELECT document_id FROM oaao_library_document WHERE document_id = ? AND tenant_id = ? LIMIT 1',
    );
    $check->execute([$docId, $tenantId]);
    if ($check->fetch(\PDO::FETCH_ASSOC) === false) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    try {
        $del = $ctx['pdo']->prepare(
            'DELETE FROM oaao_library_document WHERE document_id = ? AND tenant_id = ?',
        );
        $del->execute([$docId, $tenantId]);
    } catch (\Throwable $e) {
        error_log('oaaoai/library library_document_delete: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not delete document']);

        return;
    }

    echo json_encode(['success' => true, 'data' => ['document_id' => $docId]], JSON_UNESCAPED_UNICODE);
};
