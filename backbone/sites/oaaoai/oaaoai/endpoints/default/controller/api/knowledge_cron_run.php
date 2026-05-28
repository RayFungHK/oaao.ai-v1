<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\KnowledgePlatformOps;
use oaaoai\endpoints\KnowledgeRefreshPurposeConfig;

/**
 * POST /endpoints/api/knowledge_cron_run — WS-1-S5/S6 internal cron tick.
 *
 * Reads Settings → Knowledge, then POST orchestrator {@code /v1/knowledge/refresh}.
 * Auth: {@code X-OAAO-Internal-Token} = {@code OAAO_ORCH_SHARED_SECRET}.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : null;
    if ($secret === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'OAAO_ORCH_SHARED_SECRET unset'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $hdr = $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'] ?? '';
    $internal = \is_string($hdr) && $hdr !== '' && hash_equals($secret, $hdr);

    if (! $internal) {
        $adminDb = $this->oaao_endpoints_require_platform_knowledge_admin();
        if (! $adminDb) {
            return;
        }
    }

    $db = $this->oaao_endpoints_canonical_db();
    if (! $db instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $pdo = $db->getDBAdapter();
    if ($pdo instanceof \PDO) {
        $this->api('core')?->bootstrapTenantContext($pdo);
    }

    if ($pdo instanceof \PDO && $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql') {
        require_once __DIR__ . '/../../../../auth/default/controller/api/_ensure_pg_core_tables.php';
        oaao_auth_ensure_pg_core_tables($db);
    }

    $repo = new CanonicalEndpointsRepository($db, $this->api('core'));

    require_once __DIR__ . '/../../library/KnowledgePlatformOps.php';
    $bootstrap = KnowledgePlatformOps::run($db, $repo);

    $refresh = $repo->resolveKnowledgeRefreshConfig();

    if (! ($refresh['scheduled_enabled'] ?? true)) {
        echo json_encode(
            [
                'success' => true,
                'skipped' => true,
                'reason'  => 'scheduled_disabled',
                'refresh' => $refresh,
            ],
            JSON_UNESCAPED_UNICODE,
        );

        return;
    }

    $raw = file_get_contents('php://input');
    $input = \is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
    if (! \is_array($input)) {
        $input = [];
    }
    $force = ! empty($input['force']);

    $knowledge = $this->resolveOrchestratorKnowledgePayload() ?? [];
    $knowledge['refresh'] = $refresh;
    if (! ($refresh['merge_recall'] ?? true)) {
        $knowledge['merge_recall'] = false;
    }

    $knowledge['scope'] = 'platform';

    $cronUser = KnowledgeRefreshPurposeConfig::resolveRefreshUserId($refresh);
    $payload = [
        'force'           => $force,
        'scope'           => 'platform',
        'classify_after'  => (bool) ($refresh['classify_after'] ?? true),
        'knowledge'       => $knowledge,
    ];
    $refreshScopes = getenv('OAAO_KNOWLEDGE_REFRESH_SCOPES');
    if ($refreshScopes !== false && strtolower(trim((string) $refreshScopes)) === 'all') {
        $core = $this->api('core');
        $tenantId = 0;
        if ($core && method_exists($core, 'tenantContextId')) {
            $tenantId = (int) ($core->tenantContextId() ?? 0);
        }
        if ($tenantId > 0) {
            $payload['tenant_id'] = $tenantId;
            $knowledge['tenant_id'] = $tenantId;
        }
    }
    if ($cronUser > 0) {
        $payload['user_id'] = $cronUser;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/knowledge/refresh', $payload, 300);
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode(
            [
                'success' => false,
                'message' => 'orchestrator refresh failed',
                'detail'  => $resp,
                'refresh' => $refresh,
            ],
            JSON_UNESCAPED_UNICODE,
        );

        return;
    }

    echo json_encode(
        [
            'success'      => true,
            'refresh'      => $refresh,
            'bootstrap'    => $bootstrap,
            'orchestrator' => $resp,
        ],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    );
};
