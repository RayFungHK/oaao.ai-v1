<?php

declare(strict_types=1);

use oaaoai\user\UserModelParams;

/**
 * GET /user/api/personalization_survey — UX-1 Phase 2/3 survey state + personality packs.
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

    $db = $auth->getDB();
    $pdo = $db instanceof \Razy\Database ? $db->getDBAdapter() : null;
    $prefs = [];
    if ($pdo instanceof \PDO) {
        $uid = (int) ($user->user_id ?? 0);
        $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
        $stmt->execute([$uid]);
        $raw = $stmt->fetchColumn();
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
    }

    $survey = \is_array($prefs['personalization_survey'] ?? null) ? $prefs['personalization_survey'] : [];

    echo json_encode([
        'success' => true,
        'data'    => [
            'phase'              => 2,
            'completed'          => (bool) ($survey['completed'] ?? false),
            'answers'            => $survey['answers'] ?? [],
            'personality_packs'  => [
                ['id' => 'creative', 'label' => 'Creative explorer', 'temperature' => 0.95, 'top_p' => 0.92],
                ['id' => 'scholar', 'label' => 'Rigorous scholar', 'temperature' => 0.35, 'top_p' => 0.85],
                ['id' => 'friendly', 'label' => 'Friendly assistant', 'temperature' => 0.65, 'top_p' => 0.9],
            ],
            'selected_pack'      => $survey['selected_pack'] ?? null,
            'model_params'       => UserModelParams::fromPreferences($prefs),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
