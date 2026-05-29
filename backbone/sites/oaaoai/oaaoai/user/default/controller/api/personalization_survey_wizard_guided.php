<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\user\UserDisplayPreferences;
use oaaoai\user\UserWizardLlm;

/**
 * POST /user/api/personalization_survey_wizard_guided — UX-1 guided step (5 questions, adaptive options).
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

    $llmCfg = UserWizardLlm::llmCfgForPayload(UserWizardLlm::resolveWizardLlm($this));
    if ($llmCfg === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Chat LLM is not configured for this workspace']);

        return;
    }

    $stepIndex = isset($input['step_index']) ? (int) $input['step_index'] : 0;
    if ($stepIndex < 0 || $stepIndex > 4) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'step_index must be 0–4']);

        return;
    }

    $locale = isset($input['locale']) ? trim((string) $input['locale']) : '';
    if ($locale === '') {
        $db = $auth->getDB();
        if ($db instanceof \Razy\Database) {
            $pdo = $db->getDBAdapter();
            if ($pdo instanceof \PDO) {
                $locale = UserDisplayPreferences::localeForUser($pdo, (int) ($auth->getUser()->user_id ?? 0));
            }
        }
    }
    if ($locale === '') {
        $locale = UserDisplayPreferences::DEFAULT_LOCALE;
    }

    $answers = $input['answers'] ?? $input['guided_answers'] ?? [];
    if (! \is_array($answers)) {
        $answers = [];
    }

    $payload = [
        'llm_cfg'    => $llmCfg,
        'locale'     => $locale,
        'step_index' => $stepIndex,
        'answers'    => $answers,
    ];
    if (isset($input['theme_id']) && \is_string($input['theme_id']) && $input['theme_id'] !== '') {
        $payload['theme_id'] = trim($input['theme_id']);
    }
    if (isset($input['scenario_prompt']) && \is_string($input['scenario_prompt']) && $input['scenario_prompt'] !== '') {
        $payload['scenario_prompt'] = trim($input['scenario_prompt']);
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/personalization/survey_guided', $payload, 90);
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($resp['error'] ?? 'guided_step_failed'),
            'detail'  => $resp,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'step_index'      => (int) ($resp['step_index'] ?? $stepIndex),
            'total_steps'     => (int) ($resp['total_steps'] ?? 5),
            'phase'           => (string) ($resp['phase'] ?? 'question'),
            'prompt'          => (string) ($resp['prompt'] ?? ''),
            'options'         => $resp['options'] ?? [],
            'option_count'    => (int) ($resp['option_count'] ?? 0),
            'narrowed'        => ! empty($resp['narrowed']),
            'source'          => (string) ($resp['source'] ?? 'llm'),
            'theme_id'        => (string) ($resp['theme_id'] ?? ''),
            'theme_label'     => (string) ($resp['theme_label'] ?? ''),
            'scenario_prompt' => (string) ($resp['scenario_prompt'] ?? ''),
            'cumulative_model_params' => $resp['cumulative_model_params'] ?? [],
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
