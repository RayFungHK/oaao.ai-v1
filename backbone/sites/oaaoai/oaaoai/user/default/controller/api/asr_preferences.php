<?php

declare(strict_types=1);

use oaaoai\endpoints\AsrUserPreferenceRegister;
use oaaoai\user\AsrUserPreferences;

/**
 * GET/POST /user/api/asr_preferences — registry-driven ASR user preferences.
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
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $this->api('auth')->ensureCreditSchema($pdo);

    $endpoints = $this->api('endpoints');
    if ($endpoints) {
        $endpoints->ensureFeatureRegistries();
    }

    $uid = (int) ($user->user_id ?? 0);
    $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
    $stmt->execute([$uid]);
    $prefs = [];
    $raw = $stmt->fetchColumn();
    if (\is_string($raw) && trim($raw) !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $prefs = $decoded;
            }
        } catch (\JsonException) {
            $prefs = [];
        }
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $visible = AsrUserPreferences::visibleFields($endpoints);
        if ($visible === []) {
            http_response_code(422);
            echo json_encode(['success' => false, 'message' => 'No ASR preferences are available']);

            return;
        }

        foreach ($visible as $field) {
            $fieldId = trim((string) ($field['field_id'] ?? ''));
            $prefKey = trim((string) ($field['pref_key'] ?? $fieldId));
            if ($fieldId === '' || $prefKey === '') {
                continue;
            }
            if (! \array_key_exists($prefKey, $body)) {
                continue;
            }
            $rawValue = trim((string) $body[$prefKey]);
            $allowed = AsrUserPreferenceRegister::allowedValues($fieldId);
            if ($allowed !== [] && ! \in_array($rawValue, $allowed, true)) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Unsupported value for ' . $prefKey]);

                return;
            }
            $prefs[$prefKey] = AsrUserPreferenceRegister::normalizeValue($fieldId, $rawValue);
        }

        $json = json_encode($prefs, JSON_UNESCAPED_UNICODE);
        $pdo->prepare(
            'UPDATE oaao_user SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        )->execute([$json, $uid]);
    }

    $values = AsrUserPreferences::valuesFromPreferences($prefs, $endpoints);
    echo json_encode([
        'success' => true,
        'data'    => [
            'fields'   => AsrUserPreferences::visibleFields($endpoints),
            'values'   => $values,
            'registry' => AsrUserPreferenceRegister::allSorted(),
        ],
    ]);
};
