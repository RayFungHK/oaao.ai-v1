<?php

use oaaoai\endpoints\CanonicalEndpointsRepository;

/**
 * GET /endpoints/api/purposes_list — list {@code oaao_purpose} (PostgreSQL canonical only).
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    if (! $this->oaao_endpoints_canonical_is_pgsql($db)) {
        echo json_encode(
            [
                'success'                  => true,
                'purposes'                 => [],
                'purposes_postgresql_only' => true,
            ],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        );

        return;
    }

    $this->api('auth')->ensurePgCoreTables($db);

    try {
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $repo->ensureChatPrimaryPurposeRow();
        $repo->ensurePlanningPurposeRow();
        $repo->ensurePlanningIntentPurposeRow();
        $repo->ensureAsrLivePurposeRow();
        $rows = $repo->listPurposesWithDefaultEndpointName();
        $epApi = $this->api('endpoints');
        $mmModules = $epApi ? $epApi->getMmPythonModuleRegistry() : [];
        $mediaCapabilities = $epApi ? $epApi->getMediaCapabilityRegistry() : [];
        echo json_encode(
            [
                'success'                  => true,
                'purposes'                 => $rows ?: [],
                'purposes_postgresql_only' => false,
                'mm_python_modules'        => $mmModules,
                'media_capabilities'       => $mediaCapabilities,
            ],
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        );
    } catch (\Throwable $e) {
        error_log(sprintf('[purposes_list] %s in %s:%d', $e->getMessage(), $e->getFile(), $e->getLine()));
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load purposes']);
    }
};
