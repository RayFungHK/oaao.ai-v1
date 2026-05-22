<?php

declare(strict_types=1);

use oaaoai\endpoints\AsrPurposeConfig;
use oaaoai\endpoints\CanonicalEndpointsRepository;

require_once __DIR__ . '/../../library/AsrPurposeConfig.php';
require_once __DIR__ . '/../../library/CanonicalEndpointsRepository.php';

/**
 * POST /endpoints/api/funasr_ensure — admin-only; start built-in FunASR + smoke test via orchestrator.
 *
 * Body JSON: { pull?: bool, funasr_env?: { FUNASR_ADAPTER_MODE?, FUNASR_SPK_MODEL? } }.
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }
    $pull = ! \array_key_exists('pull', $input) || (bool) $input['pull'];

    /** @var array<string, string> $funasrEnv */
    $funasrEnv = [];
    if (isset($input['funasr_env']) && \is_array($input['funasr_env'])) {
        $funasrEnv = AsrPurposeConfig::sanitizeFunasrContainerEnv($input['funasr_env']);
    }
    if ($funasrEnv === []) {
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $asrBind = $repo->resolveAsrBinding();
        $meta = \is_array($asrBind['purpose_meta'] ?? null) ? $asrBind['purpose_meta'] : [];
        $funasrEnv = AsrPurposeConfig::funasrContainerEnvFromMeta($meta);
    }

    $chat = $this->api('chat');
    if (! $chat || $chat->getOrchestratorInternalBase() === '') {
        http_response_code(503);
        echo json_encode([
            'success' => false,
            'message' => 'Orchestrator is not configured (OAAO_ORCHESTRATOR_INTERNAL_URL / OAAO_ORCH_SHARED_SECRET).',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $result = $chat->ensureOrchestratorFunasr($pull, $funasrEnv);
    if ($result === null) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => 'Could not reach orchestrator FunASR ensure endpoint.',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $ready = ! empty($result['ready']);
    echo json_encode([
        'success' => true,
        'ready'   => $ready,
        'base_url' => (string) ($result['base_url'] ?? AsrPurposeConfig::defaultFunasrBaseUrl()),
        'message' => (string) ($result['message'] ?? ($ready ? 'FunASR ready' : 'FunASR not ready')),
        'data'    => $result,
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
