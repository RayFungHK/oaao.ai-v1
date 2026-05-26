<?php

declare(strict_types=1);

/**
 * POST /chat/api/asr_transcribe — browser-safe proxy to orchestrator /v1/asr/transcribe.
 *
 * Body JSON: { audio_base64, mime_type?, polish?, workspace_id? }
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = $this->oaao_chat_resolve_workspace_id($body);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    $b64 = isset($body['audio_base64']) ? trim((string) $body['audio_base64']) : '';
    if ($b64 === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'audio_base64 required']);

        return;
    }

    $internalBase = '';
    $envInternal = getenv('OAAO_ORCHESTRATOR_INTERNAL_URL');
    if ($envInternal !== false && trim((string) $envInternal) !== '') {
        $internalBase = rtrim(trim((string) $envInternal), '/');
    } elseif (getenv('OAAO_DOCKER') === '1' || @is_readable('/.dockerenv')) {
        $internalBase = 'http://orchestrator:8103';
    } else {
        $port = getenv('OAAO_SIDECAR_PORT');
        if ($port !== false && (string) $port !== '') {
            $internalBase = 'http://127.0.0.1:' . max(1, min(65535, (int) $port));
        }
    }
    if ($internalBase === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator not configured']);

        return;
    }

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '') ? trim((string) $secret) : 'oaao_dev_shared_secret';

    $polishEnabled = true;
    if (isset($body['polish_enabled'])) {
        $pe = $body['polish_enabled'];
        $polishEnabled = $pe === true || $pe === 1 || $pe === '1';
    } elseif (isset($body['polish']) && (\is_bool($body['polish']) || \is_int($body['polish']) || \is_string($body['polish']))) {
        $pe = $body['polish'];
        $polishEnabled = $pe === true || $pe === 1 || $pe === '1';
    }
    $payload = [
        'audio_base64'   => $b64,
        'mime_type'      => isset($body['mime_type']) ? (string) $body['mime_type'] : 'audio/webm',
        'polish_enabled' => $polishEnabled,
    ];
    if ($wid !== null && $wid > 0) {
        $payload['workspace_id'] = $wid;
    }

    $authApi = $this->api('auth');
    $canonDb = $authApi ? $authApi->getDB() : null;
    $endpointsApi = $this->api('endpoints');
    if ($endpointsApi) {
        $asr = $endpointsApi->resolveOrchestratorLiveAsrPayload();
        if ($asr === null) {
            $asr = $endpointsApi->resolveOrchestratorAsrPayload();
        }
        if ($asr !== null) {
            $payload['asr'] = $asr;
        }
    }
    if ($canonDb instanceof \Razy\Database) {
        $embRepo = new \oaaoai\endpoints\CanonicalEndpointsRepository($canonDb);
        $polishBind = $embRepo->resolvePolishBinding();
        if ($polishBind !== null) {
            $pref = trim($polishBind['api_key_ref']);
            $payload['polish'] = [
                'purpose_key' => $polishBind['purpose_key'],
                'base_url'    => $polishBind['base_url'],
                'model'       => $polishBind['model'],
                'api_key_env' => ($pref !== ''
                    ? $this->inferOrchestratorApiKeyEnv($pref)
                    : null),
            ];
        }
    }
    if ($wid !== null && $wid > 0) {
        $vaultApi = $this->api('vault');
        if ($vaultApi) {
            $glossary = $vaultApi->getWorkspaceGlossary($wid);
            if ($glossary !== []) {
                $payload['glossary'] = $glossary;
            }
        }
    }

    $url = $internalBase . '/v1/asr/transcribe';
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

    if (\function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            http_response_code(502);
            echo json_encode(['success' => false, 'message' => 'Proxy failed']);

            return;
        }
        curl_setopt_array($ch, [
            \CURLOPT_POST           => true,
            \CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Accept: application/json',
                'X-OAAO-Internal-Token: ' . $secret,
            ],
            \CURLOPT_POSTFIELDS     => $json,
            \CURLOPT_RETURNTRANSFER => true,
            \CURLOPT_TIMEOUT        => 120,
        ]);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create([
            'http' => [
                'method'  => 'POST',
                'header'  => "Content-Type: application/json\r\nAccept: application/json\r\nX-OAAO-Internal-Token: {$secret}\r\n",
                'content' => $json,
                'timeout' => 120,
            ],
        ]);
        $raw = @file_get_contents($url, false, $ctx);
        $code = 502;
    }

    if ($raw === false || $code < 200 || $code >= 300) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Transcription failed']);

        return;
    }

    try {
        /** @var array<string, mixed> $dec */
        $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (\JsonException) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Invalid orchestrator response']);

        return;
    }

    if ($canonDb instanceof \Razy\Database) {
        $canonPdo = $canonDb->getDBAdapter();
        if ($canonPdo instanceof \PDO && $canonPdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql') {
            $tenantId = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
            if ($tenantId < 1) {
                $coreApi = $this->api('core');
                if ($coreApi) {
                    $tenantId = $coreApi->bootstrapTenantContext($canonPdo);
                }
            }
            if ($tenantId > 0) {
                $coreApi = $this->api('core');
                if ($coreApi) {
                    $uid = isset($user->user_id) ? (int) $user->user_id : 0;
                    $asrUsage = $dec;
                    $asrPurpose = 'asr';
                    if (isset($payload['asr']['purpose_key']) && trim((string) $payload['asr']['purpose_key']) !== '') {
                        $asrPurpose = trim((string) $payload['asr']['purpose_key']);
                    }
                    $asrUsage['purpose_key'] = $asrPurpose;
                    $coreApi->recordUsageChatAsr($canonPdo, $tenantId, $asrUsage, $uid > 0 ? $uid : null);
                }
            }
        }
    }

    echo json_encode(['success' => true, 'data' => $dec], JSON_UNESCAPED_UNICODE);
};
