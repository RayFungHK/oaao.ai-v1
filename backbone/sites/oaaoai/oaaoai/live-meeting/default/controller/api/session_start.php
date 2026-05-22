<?php

declare(strict_types=1);

use oaaoai\livemeeting\LiveMeetingOrchestrator;
use oaaoai\livemeeting\LiveMeetingStorage;

/**
 * POST /live-meeting/api/session_start
 */
return function (): void {
    [$auth, $user] = $this->oaao_live_require_authenticated_only();
    if (! $auth || ! $user) {
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

    $authApi = $this->api('auth');
    $canonDb = $authApi ? $authApi->getDB() : null;
    if ($canonDb instanceof \Razy\Database) {
        require_once dirname(__DIR__, 4) . '/endpoints/default/library/AsrPurposeConfig.php';
        require_once dirname(__DIR__, 4) . '/chat/default/library/ChatOrchestratorBootstrap.php';
        $embRepo = new \oaaoai\endpoints\CanonicalEndpointsRepository($canonDb);
        $asrBind = $embRepo->resolveAsrBinding();
        if ($asrBind !== null) {
            $orchPayload['asr'] = \oaaoai\endpoints\AsrPurposeConfig::jobPayloadFromBinding(
                $asrBind,
                static fn (string $ref): ?string => \oaaoai\chat\ChatOrchestratorBootstrap::inferApiKeyEnv($ref),
            );
        }
        if ($wid > 0) {
            require_once dirname(__DIR__, 4) . '/vault/default/library/VaultGlossary.php';
            $canonPdo = $canonDb->getPDO();
            if ($canonPdo instanceof \PDO) {
                $glossary = \oaaoai\vault\VaultGlossary::loadWorkspaceGlossary($canonPdo, $wid);
                if ($glossary !== []) {
                    $orchPayload['glossary'] = $glossary;
                }
            }
        }
    }

    $orch = LiveMeetingOrchestrator::sessionStart($orchPayload);
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

    $this->oaao_live_json_exit(200, true, '', $orch);
};
