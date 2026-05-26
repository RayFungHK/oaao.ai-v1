<?php

declare(strict_types=1);

use oaaoai\livemeeting\LiveMeetingOrchestrator;
use oaaoai\livemeeting\LiveMeetingStorage;

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

/**
 * POST /live-meeting/api/session_start
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
    $cadence = trim((string) ($input['cadence'] ?? '1v1'));
    if ($cadence === '') {
        $cadence = '1v1';
    }
    $retention = trim((string) ($input['retention_mode'] ?? 'disk_ttl'));
    if ($retention === '') {
        $retention = 'disk_ttl';
    }
    $wid = isset($input['workspace_id']) ? (int) $input['workspace_id'] : 0;
    $uid = (int) ($user->user_id ?? 0);

    $orchPayload = [
        'cadence'         => $cadence,
        'retention_mode'  => $retention,
        'workspace_id'    => $wid > 0 ? $wid : null,
        'user_id'         => $uid,
    ];

    $orchPayload = array_merge($orchPayload, $chatApi->buildLiveMeetingOrchestratorExtras($uid, $wid));

    if ($wid > 0 && ! $chatApi->userHasWorkspaceAccess($uid, $wid)) {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'message' => 'You do not have access to this workspace.',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    if (empty($orchPayload['asr']) || ! \is_array($orchPayload['asr'])) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Configure ASR-Live (streaming) and/or ASR (batch) with enabled endpoints in Settings → Purpose allocation.',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $orch = LiveMeetingOrchestrator::sessionStart($chatApi, $orchPayload);
    if ($orch === null || empty($orch['session_id'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => 'Orchestrator could not start live meeting session',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    try {
        LiveMeetingStorage::ensureSessionTree((string) $orch['session_id']);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not prepare session storage',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $publicBase = LiveMeetingOrchestrator::publicStreamBase();
    if ($publicBase !== '') {
        if (! empty($orch['stream_url']) && str_starts_with((string) $orch['stream_url'], '/')) {
            $orch['stream_url'] = $publicBase . (string) $orch['stream_url'];
        }
        if (! empty($orch['ws_audio_url']) && str_starts_with((string) $orch['ws_audio_url'], '/')) {
            $ws = (string) $orch['ws_audio_url'];
            $orch['ws_audio_url'] = $publicBase . $ws;
            $orch['ws_audio_url_ws'] = preg_replace('#^http#', 'ws', $publicBase) . $ws;
        }
    }

    if (! class_exists(\oaaoai\chat\OrchestratorPublicBase::class)) {
        require_once dirname(__DIR__, 3) . '/chat/default/library/OrchestratorPublicBase.php';
    }
    if (! empty($orch['stream_url'])) {
        $orch['stream_url'] = \oaaoai\chat\OrchestratorPublicBase::rewriteOrchestratorUrlForClient((string) $orch['stream_url']);
    }
    if (! empty($orch['ws_audio_url'])) {
        $orch['ws_audio_url'] = \oaaoai\chat\OrchestratorPublicBase::rewriteOrchestratorUrlForClient((string) $orch['ws_audio_url']);
    }
    if (! empty($orch['ws_audio_url_ws'])) {
        $orch['ws_audio_url_ws'] = \oaaoai\chat\OrchestratorPublicBase::rewriteOrchestratorWsUrlForClient((string) $orch['ws_audio_url_ws']);
    } elseif (! empty($orch['ws_audio_url'])) {
        $orch['ws_audio_url_ws'] = \oaaoai\chat\OrchestratorPublicBase::rewriteOrchestratorWsUrlForClient((string) $orch['ws_audio_url']);
    }

    $this->oaao_live_json_exit(200, true, '', $orch);
};
