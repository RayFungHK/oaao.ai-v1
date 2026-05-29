<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\user\UserWizardLlm;

/**
 * POST /user/api/personalization_survey_wizard_infer — UX-1 wizard step 2 (pick → inference params).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return;
    }
    $auth->restrict(true);
    if (! $auth->getUser()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);

        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $selectedId = trim((string) ($input['selected_id'] ?? ''));
    $samples = $input['samples'] ?? null;
    if ($selectedId === '' || ! \is_array($samples) || $samples === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'selected_id and samples required']);

        return;
    }

    $llmCfg = UserWizardLlm::llmCfgForPayload(UserWizardLlm::resolveWizardLlm($this));
    if ($llmCfg === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Chat LLM is not configured for this workspace']);

        return;
    }

    $payload = [
        'llm_cfg'          => $llmCfg,
        'selected_id'      => $selectedId,
        'samples'          => $samples,
        'scenario_prompt'  => isset($input['scenario_prompt']) ? (string) $input['scenario_prompt'] : '',
    ];

    $resp = ChatOrchestratorApi::postInternalJson('/v1/personalization/survey_infer', $payload, 60);
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($resp['error'] ?? 'infer_failed'),
            'detail'  => $resp,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'model_params' => $resp['model_params'] ?? [],
            'rationale'    => (string) ($resp['rationale'] ?? ''),
            'selected_id'  => (string) ($resp['selected_id'] ?? $selectedId),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
