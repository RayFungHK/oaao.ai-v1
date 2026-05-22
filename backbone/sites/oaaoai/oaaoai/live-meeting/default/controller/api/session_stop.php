<?php

declare(strict_types=1);

use oaaoai\livemeeting\LiveMeetingOrchestrator;

/**
 * POST /live-meeting/api/session_stop
 */
return function (): void {
    [$auth, $user] = $this->oaao_live_require_authenticated_only();
    if (! $auth || ! $user) {
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $sessionId = trim((string) ($input['session_id'] ?? ''));
    if ($sessionId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'session_id required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $keepAudio = ! empty($input['keep_audio']);
    $resp = LiveMeetingOrchestrator::sessionStop($sessionId, $keepAudio);
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => 'Orchestrator could not stop session',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $this->oaao_live_json_exit(200, true, '', [
        'session_id' => $sessionId,
        'keep_audio' => $keepAudio,
    ]);
};
