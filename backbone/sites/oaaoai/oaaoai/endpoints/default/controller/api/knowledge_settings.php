<?php

declare(strict_types=1);

use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\KnowledgePlatformOps;
use oaaoai\endpoints\KnowledgeRefreshPurposeConfig;

/**
 * GET /endpoints/api/knowledge_settings — WS-1-S6 administrator: refresh + opt-out.
 */
return function (): void {
    $db = $this->oaao_endpoints_require_platform_knowledge_admin();
    if (! $db) {
        return;
    }

    $pdo = $db->getDBAdapter();
    if (! ($pdo instanceof \PDO)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql') {
        $this->api('auth')->ensurePgCoreTables($db);
    }

    $repo = new CanonicalEndpointsRepository($db, $this->api('core'));

    require_once __DIR__ . '/../../library/KnowledgePlatformOps.php';
    $bootstrap = KnowledgePlatformOps::run($db, $repo);

    $row = $repo->findKnowledgePlatformPurposeRowForSettings();
    $meta = KnowledgeRefreshPurposeConfig::decodePurposeMeta($row['meta_json'] ?? null);
    $refresh = KnowledgeRefreshPurposeConfig::refreshPayloadFromMeta($meta);
    $vaultResolved = KnowledgeRefreshPurposeConfig::resolveKnowledgeVaultIds($refresh);
    $refresh['tenant_vault_id'] = $vaultResolved['tenant_vault_id'];
    $refresh['platform_vault_id'] = $vaultResolved['platform_vault_id'];
    $refresh['refresh_user_id'] = KnowledgeRefreshPurposeConfig::resolveRefreshUserId($refresh);

    $endpointsApi = $this;
    $knowledgePayload = $endpointsApi->resolveOrchestratorKnowledgePayload();

    echo json_encode(
        [
            'success' => true,
            'data'    => [
                'purpose'  => $row,
                'refresh'  => $refresh,
                'sources'  => [
                    'vault_ids'     => 'Platform console → Knowledge (knowledge.platform.*); env is bootstrap fallback only',
                    'refresh_user'  => 'Service account user_id for Vault document_upload_text (ACL owner)',
                ],
                'env_bootstrap' => [
                    'tenant_vault_id'   => KnowledgeRefreshPurposeConfig::envTenantVaultId(),
                    'platform_vault_id' => KnowledgeRefreshPurposeConfig::envPlatformVaultId(),
                    'refresh_user_id'   => KnowledgeRefreshPurposeConfig::envRefreshUserId(),
                ],
                'knowledge_llm' => $knowledgePayload,
                'bootstrap'     => $bootstrap,
            ],
        ],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    );
};
