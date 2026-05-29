<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\user\UserDisplayPreferences;
use oaaoai\user\UserWizardLlm;

/**
 * POST /user/api/personalization_survey_wizard_samples — UX-1 wizard step 2 (random theme + 3 param options).
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

    $randomTheme = ! empty($input['random_theme']);
    $scenario = isset($input['scenario_prompt']) ? trim((string) $input['scenario_prompt']) : '';
    $themeId = isset($input['theme_id']) ? trim((string) $input['theme_id']) : '';

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
        'llm_cfg' => $llmCfg,
        'locale'  => $locale,
    ];
    if (! $randomTheme && $scenario !== '') {
        $payload['scenario_prompt'] = $scenario;
    }
    if ($themeId !== '' && \in_array($themeId, ['daily', 'corporate', 'research'], true)) {
        $payload['theme_id'] = $themeId;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/personalization/survey_samples', $payload, 90);
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($resp['error'] ?? 'samples_failed'),
            'detail'  => $resp,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $options = $resp['options'] ?? $resp['samples'] ?? [];

    echo json_encode([
        'success' => true,
        'data'    => [
            'theme_id'        => (string) ($resp['theme_id'] ?? ''),
            'theme_label'     => (string) ($resp['theme_label'] ?? ''),
            'scenario_prompt' => (string) ($resp['scenario_prompt'] ?? ''),
            'options'         => $options,
            'samples'         => $options,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
