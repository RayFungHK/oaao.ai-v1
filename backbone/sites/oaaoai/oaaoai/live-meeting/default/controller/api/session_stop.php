<?php

declare(strict_types=1);

use oaaoai\livemeeting\LiveMeetingOrchestrator;

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

/**
 * POST /live-meeting/api/session_stop
 */
return function (): void {
    [$auth, $user] = $this->oaao_live_require_authenticated_only();
    if (! $auth || ! $user) {
        return;
    }

    $chatApi = $this->api('chat');
    if (! $chatApi) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Chat orchestrator bridge unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $sessionId = trim((string) ($input['session_id'] ?? ''));
    $keepAudio = ! empty($input['keep_audio']);
    $clientLiveText = trim((string) ($input['client_live_text'] ?? ''));
    $clientLiveChunks = [];
    if (! empty($input['client_live_chunks']) && \is_array($input['client_live_chunks'])) {
        foreach ($input['client_live_chunks'] as $chunk) {
            $line = trim((string) $chunk);
            if ($line !== '') {
                $clientLiveChunks[] = $line;
            }
        }
    }
    $clientBatchChunks = [];
    if (! empty($input['client_batch_chunks']) && \is_array($input['client_batch_chunks'])) {
        foreach ($input['client_batch_chunks'] as $chunk) {
            $line = trim((string) $chunk);
            if ($line !== '') {
                $clientBatchChunks[] = $line;
            }
        }
    }

    if ($sessionId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'session_id required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $resp = LiveMeetingOrchestrator::sessionStop(
        $chatApi,
        $sessionId,
        $keepAudio,
        $clientLiveText,
        $clientLiveChunks !== [] ? $clientLiveChunks : null,
        $clientBatchChunks !== [] ? $clientBatchChunks : null,
    );
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator could not stop session'], JSON_UNESCAPED_UNICODE);

        return;
    }

    if ($keepAudio) {
        $canon = $auth->getDB()?->getDBAdapter();
        $core = $this->api('core');
        if ($canon instanceof \PDO && $core) {
            $tid = $core->bootstrapTenantContext($canon);
            if ($tid > 0) {
                require_once dirname(__DIR__, 2) . '/library/LiveMeetingBlobSync.php';
                \oaaoai\livemeeting\LiveMeetingBlobSync::flushSessionMeta($canon, $tid, $sessionId);
                \oaaoai\livemeeting\LiveMeetingBlobSync::flushSessionAudio($canon, $tid, $sessionId);
            }
        }
    }

    $this->oaao_live_json_exit(200, true, '', $resp['data'] ?? $resp);
};
