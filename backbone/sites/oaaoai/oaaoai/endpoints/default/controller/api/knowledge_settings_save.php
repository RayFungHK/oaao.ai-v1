<?php

declare(strict_types=1);

use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\KnowledgeRefreshPurposeConfig;

/**
 * POST /endpoints/api/knowledge_settings_save — WS-1-S6 persist refresh settings.
 *
 * Body: { refresh: { scheduled_enabled, interval_hours, classify_after, merge_recall, do_not_search[] } }
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
        require_once __DIR__ . '/../../../../auth/default/controller/api/_ensure_pg_core_tables.php';
        oaao_auth_ensure_pg_core_tables($db);
    }

    $raw = file_get_contents('php://input');
    $input = \is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
    if (! \is_array($input)) {
        $input = [];
    }

    $form = $input['refresh'] ?? $input;
    if (! \is_array($form)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'refresh object required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
    $row = $repo->findKnowledgePlatformPurposeRowForSettings();
    if ($row === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'knowledge.platform purpose missing'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $purposeId = (int) ($row['id'] ?? 0);
    if ($purposeId < 1) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'invalid purpose row'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $existing = KnowledgeRefreshPurposeConfig::decodePurposeMeta($row['meta_json'] ?? null);
    $merged = KnowledgeRefreshPurposeConfig::mergeRefreshIntoMeta($existing, $form);

    try {
        $metaJson = json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\JsonException $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'meta_json encode failed'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $now = gmdate('Y-m-d H:i:s');
    $db->update('purpose', ['meta_json', 'updated_at'])
        ->assign(['meta_json' => $metaJson, 'updated_at' => $now])
        ->where('id=?')
        ->query(['id' => $purposeId]);

    $refresh = KnowledgeRefreshPurposeConfig::refreshPayloadFromMeta($merged);

    echo json_encode(
        [
            'success' => true,
            'data'    => ['refresh' => $refresh],
        ],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    );
};
