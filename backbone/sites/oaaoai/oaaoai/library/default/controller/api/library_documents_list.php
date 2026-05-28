<?php

declare(strict_types=1);

/**
 * GET /library/api/library_documents_list — CS-2-S1 list stub.
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'documents' => [],
            'message'   => 'Library editor shell — create flow ships in CS-2-S4.',
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
