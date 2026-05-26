<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/item_upsert — internal token: record dedupe index after vault upload.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '') ? trim((string) $secret) : 'oaao_dev_shared_secret';
    $hdr = isset($_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN']) ? trim((string) $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN']) : '';
    if ($hdr === '' || ! hash_equals($secret, $hdr)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $watchId = isset($input['watch_id']) ? (int) $input['watch_id'] : 0;
    $url = trim((string) ($input['canonical_url'] ?? ''));
    if ($watchId < 1 || $url === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'watch_id and canonical_url required']);

        return;
    }

    $auth = $this->api('auth');
    $db = $auth ? $auth->getDB() : null;
    if (! $db) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_pg_core_tables.php';
    oaao_auth_ensure_pg_core_tables($db);

    $repo = new ResearchRepository($db);
    $fields = [];
    if (isset($input['content_hash'])) {
        $fields['content_hash'] = (string) $input['content_hash'];
    }
    if (isset($input['title'])) {
        $fields['title'] = (string) $input['title'];
    }
    if (isset($input['document_id'])) {
        $fields['document_id'] = (int) $input['document_id'];
    }
    if (isset($input['summary_document_id'])) {
        $fields['summary_document_id'] = (int) $input['summary_document_id'];
    }
    if (isset($input['match_confidence'])) {
        $fields['match_confidence'] = (float) $input['match_confidence'];
    }
    if (isset($input['match_reason'])) {
        $fields['match_reason'] = (string) $input['match_reason'];
    }
    if (isset($input['match_hit'])) {
        $fields['match_hit'] = ! empty($input['match_hit']) ? 1 : 0;
    }
    $repo->upsertItem($watchId, $url, $fields);

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
};
