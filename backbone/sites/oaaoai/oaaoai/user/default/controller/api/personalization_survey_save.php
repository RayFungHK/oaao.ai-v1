<?php

declare(strict_types=1);

use oaaoai\user\UserModelParams;
use oaaoai\user\UserPreferenceProfile;

/**
 * POST /user/api/personalization_survey_save — UX-1 Phase 2 pack or Phase 3 feedback stub.
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
    $user = $auth->getUser();
    if (! $user) {
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

    $db = $auth->getDB();
    $pdo = $db instanceof \Razy\Database ? $db->getDBAdapter() : null;
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
    $stmt->execute([$uid]);
    $raw = $stmt->fetchColumn();
    $prefs = [];
    if (\is_string($raw) && $raw !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $prefs = $decoded;
            }
        } catch (\JsonException) {
            $prefs = [];
        }
    }

    $packs = [
        'creative' => ['temperature' => 0.95, 'top_p' => 0.92],
        'scholar'  => ['temperature' => 0.35, 'top_p' => 0.85],
        'friendly' => ['temperature' => 0.65, 'top_p' => 0.9],
    ];

    $survey = \is_array($prefs['personalization_survey'] ?? null) ? $prefs['personalization_survey'] : [];
    if (isset($input['answers']) && \is_array($input['answers'])) {
        $survey['answers'] = $input['answers'];
    }
    if (isset($input['selected_pack']) && \is_string($input['selected_pack'])) {
        $packId = strtolower(trim($input['selected_pack']));
        $survey['selected_pack'] = $packId;
        if (isset($packs[$packId])) {
            $prefs = UserModelParams::mergeIntoPreferences($prefs, $packs[$packId]);
        }
    }
    if (! empty($input['completed'])) {
        $survey['completed'] = true;
    }
    if (isset($input['feedback_delta']) && \is_array($input['feedback_delta'])) {
        $survey['feedback_delta'] = $input['feedback_delta'];
        $delta = UserModelParams::normalize($input['feedback_delta']);
        $prefs = UserModelParams::mergeIntoPreferences($prefs, $delta);
    }
    if (isset($input['model_params']) && \is_array($input['model_params'])) {
        $prefs = UserModelParams::mergeIntoPreferences($prefs, $input['model_params']);
    }
    if (isset($input['wizard']) && \is_array($input['wizard'])) {
        $survey['wizard'] = $input['wizard'];
    }
    if (isset($input['preference_tags']) && \is_array($input['preference_tags'])) {
        $prefs = UserPreferenceProfile::mergeIntoPreferences($prefs, [
            'tags' => array_values(array_filter(array_map('strval', $input['preference_tags']))),
        ]);
    }
    if (isset($input['preference_profile']) && \is_array($input['preference_profile'])) {
        $pp = $input['preference_profile'];
        $prefs = UserPreferenceProfile::mergeIntoPreferences($prefs, [
            'tags'        => \is_array($pp['preference_tags'] ?? null) ? $pp['preference_tags'] : [],
            'summary'     => (string) ($pp['preference_tags_summary'] ?? ''),
            'instruction' => (string) ($pp['preference_system_instruction'] ?? ''),
        ]);
    }
    $guidedForProfile = $survey['wizard']['guided_answers'] ?? $survey['answers'] ?? null;
    if (
        \is_array($guidedForProfile)
        && $guidedForProfile !== []
        && empty($prefs['preference_tags'])
    ) {
        $locale = trim((string) ($input['locale'] ?? ''));
        $built = UserPreferenceProfile::fromGuidedAnswers($guidedForProfile, $locale !== '' ? $locale : 'en');
        $prefs = UserPreferenceProfile::mergeIntoPreferences($prefs, $built);
    }
    $prefs['personalization_survey'] = $survey;

    $json = json_encode($prefs, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $upd = $pdo->prepare(
        'UPDATE oaao_user SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
    );
    $upd->execute([$json, $uid]);

    echo json_encode([
        'success' => true,
        'data'    => [
            'personalization_survey' => $survey,
            'model_params'           => UserModelParams::fromPreferences($prefs),
            'preference_profile'     => UserPreferenceProfile::fromPreferences($prefs),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
