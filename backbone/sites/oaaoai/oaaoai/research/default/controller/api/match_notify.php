<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

use oaaoai\research\ResearchRepository;

/**
 * POST /research/api/match_notify — internal: in-app notification when article matches watch criteria.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! oaao_research_internal_token_ok()) {
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
    $userId = isset($input['user_id']) ? (int) $input['user_id'] : 0;
    $runId = isset($input['run_id']) ? (int) $input['run_id'] : 0;
    $url = trim((string) ($input['canonical_url'] ?? ''));
    $title = trim((string) ($input['title'] ?? ''));
    $confidence = isset($input['confidence']) ? (float) $input['confidence'] : 0.0;
    $reason = trim((string) ($input['reason'] ?? ''));
    $documentId = isset($input['document_id']) ? (int) $input['document_id'] : 0;

    if ($watchId < 1 || $userId < 1 || $url === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'watch_id, user_id, canonical_url required']);

        return;
    }

    $auth = $this->api('auth');
    $db = $auth ? $auth->getDB() : null;
    $pdo = $db && $db->getDBAdapter() instanceof \PDO ? $db->getDBAdapter() : null;
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_pg_core_tables.php';
    oaao_auth_ensure_pg_core_tables($db);

    $repo = new ResearchRepository($db);
    $watch = $repo->getWatchById($watchId);
    if ($watch === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Watch not found']);

        return;
    }

    $cfg = oaao_research_decode_watch_config(
        isset($watch['config_json']) && \is_string($watch['config_json']) ? $watch['config_json'] : null,
    );
    if (empty($cfg['notify_in_app'])) {
        echo json_encode(['success' => true, 'skipped' => 'notify_disabled'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $minConf = isset($cfg['match_min_confidence']) ? (float) $cfg['match_min_confidence'] : 0.7;
    if ($confidence < $minConf) {
        echo json_encode(['success' => true, 'skipped' => 'below_threshold'], JSON_UNESCAPED_UNICODE);

        return;
    }

    require_once dirname(__DIR__, 4) . '/core/default/library/NotificationRepository.php';

    $label = trim((string) ($watch['label'] ?? 'Research'));
    $pct = (int) round($confidence * 100);
    $bodyTitle = $title !== '' ? $title : $url;
    $bodyReason = $reason !== '' ? $reason : 'Matched watch criteria';

    $notifRepo = new NotificationRepository($pdo);
    $notifRepo->create(
        $userId,
        'research_hit',
        "Article Research: {$label}",
        "{$bodyTitle} (confidence {$pct}%) — {$bodyReason}",
        [
            'watch_id'    => $watchId,
            'run_id'      => $runId > 0 ? $runId : null,
            'url'         => $url,
            'title'       => $title !== '' ? $title : null,
            'confidence'  => $confidence,
            'reason'      => $reason !== '' ? $reason : null,
            'document_id' => $documentId > 0 ? $documentId : null,
        ],
    );

    echo json_encode(['success' => true, 'notified' => true], JSON_UNESCAPED_UNICODE);
};
