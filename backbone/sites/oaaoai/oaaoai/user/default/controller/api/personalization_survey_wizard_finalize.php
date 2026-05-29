<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\user\UserDisplayPreferences;
use oaaoai\user\UserWizardLlm;

/**
 * POST /user/api/personalization_survey_wizard_finalize — all options + pick (+ slider edits) → model_params.
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
    $guidedAnswers = $input['guided_answers'] ?? $input['answers'] ?? null;
    $guidedMode = \is_array($guidedAnswers) && \count($guidedAnswers) >= 5;
    $options = $input['options'] ?? $input['samples'] ?? null;
    if ($guidedMode) {
        if ($selectedId === '' && \is_array($guidedAnswers)) {
            $last = $guidedAnswers[\count($guidedAnswers) - 1];
            if (\is_array($last)) {
                $selectedId = trim((string) ($last['id'] ?? ''));
            }
        }
    } elseif ($selectedId === '' || ! \is_array($options) || $options === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'selected_id and options required']);

        return;
    }

    $llmCfg = UserWizardLlm::llmCfgForPayload(UserWizardLlm::resolveWizardLlm($this));
    if ($llmCfg === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Chat LLM is not configured for this workspace']);

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

    $payload = [
        'llm_cfg'     => $llmCfg,
        'selected_id' => $selectedId,
        'locale'      => $locale,
    ];
    if ($guidedMode) {
        $payload['guided_answers'] = $guidedAnswers;
    } else {
        $payload['options'] = $options;
        $payload['samples'] = $options;
        $payload['scenario_prompt'] = isset($input['scenario_prompt']) ? (string) $input['scenario_prompt'] : '';
        $payload['theme_id'] = isset($input['theme_id']) ? (string) $input['theme_id'] : '';
        $payload['theme_label'] = isset($input['theme_label']) ? (string) $input['theme_label'] : '';
    }
    if (isset($input['user_model_params']) && \is_array($input['user_model_params'])) {
        $payload['user_model_params'] = $input['user_model_params'];
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/personalization/survey_finalize', $payload, 60);
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($resp['error'] ?? 'finalize_failed'),
            'detail'  => $resp,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'model_params'                  => $resp['model_params'] ?? [],
            'rationale'                     => (string) ($resp['rationale'] ?? ''),
            'selected_id'                   => (string) ($resp['selected_id'] ?? $selectedId),
            'source'                        => (string) ($resp['source'] ?? 'llm'),
            'preference_tags'               => $resp['preference_tags'] ?? [],
            'preference_tags_summary'       => (string) ($resp['preference_tags_summary'] ?? ''),
            'preference_system_instruction' => (string) ($resp['preference_system_instruction'] ?? ''),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
