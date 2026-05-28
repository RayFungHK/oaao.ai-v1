<?php

declare(strict_types=1);

use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\KnowledgePlatformOps;

/**
 * POST /endpoints/api/knowledge_platform_bootstrap — vault provision + signal aggregate + orchestrator merge.
 *
 * Auth: platform operator, or {@code X-OAAO-Internal-Token}.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : null;
    $hdr = $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'] ?? '';
    $internal = \is_string($hdr) && $hdr !== '' && $secret !== null && hash_equals($secret, $hdr);

    if (! $internal) {
        $db = $this->oaao_endpoints_require_platform_knowledge_admin();
        if (! $db) {
            return;
        }
    } else {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db instanceof \Razy\Database) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable'], JSON_UNESCAPED_UNICODE);

            return;
        }
    }

    $pdo = $db->getDBAdapter();
    if ($pdo instanceof \PDO && $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql') {
        require_once __DIR__ . '/../../../../auth/default/controller/api/_ensure_pg_core_tables.php';
        oaao_auth_ensure_pg_core_tables($db);
    }

    require_once __DIR__ . '/../../library/KnowledgePlatformOps.php';
    require_once __DIR__ . '/../../library/CanonicalEndpointsRepository.php';

    $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
    $result = KnowledgePlatformOps::run($db, $repo);

    echo json_encode(
        [
            'success' => true,
            'data'    => $result,
        ],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    );
};
