<?php

declare(strict_types=1);

use oaaoai\user\UserDisplayPreferences;

/**
 * GET /user/api/profile — authenticated user fields + locale + credit balance.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    $user = $auth ? $auth->getUser() : null;

    if (! $user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);

        return;
    }

    $locale = 'en';
    $creditBalance = null;
    $prefs = [];

    $db = $auth->getDB();
    if ($db instanceof \Razy\Database) {
        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            $core = $this->api('core');
            $tid = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
            if ($tid < 1 && $core) {
                $tid = $core->bootstrapTenantContext($pdo);
            }
            if ($tid > 0) {
                require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_credit_schema.php';
                oaao_auth_ensure_credit_schema($pdo);
            }
            $stmt = $pdo->prepare(
                'SELECT preferences_json, credit_balance FROM oaao_user WHERE user_id = ? LIMIT 1',
            );
            $stmt->execute([(int) ($user->user_id ?? 0)]);
            $row = $stmt->fetch(\PDO::FETCH_ASSOC);
            if (\is_array($row)) {
                if ($row['credit_balance'] !== null && $row['credit_balance'] !== '') {
                    $creditBalance = (float) $row['credit_balance'];
                }
                $rawPrefs = $row['preferences_json'] ?? '';
                if (\is_string($rawPrefs) && trim($rawPrefs) !== '') {
                    try {
                        $decoded = json_decode($rawPrefs, true, 512, JSON_THROW_ON_ERROR);
                        if (\is_array($decoded)) {
                            $prefs = $decoded;
                        }
                    } catch (\JsonException) {
                        $prefs = [];
                    }
                }
            }
        }
    }

    if (isset($prefs['locale']) && \is_string($prefs['locale']) && trim($prefs['locale']) !== '') {
        $locale = trim($prefs['locale']);
    }

    $display = UserDisplayPreferences::fromPreferences($prefs);

    echo json_encode([
        'success' => true,
        'data'    => [
            'user_id'         => (int) ($user->user_id ?? 0),
            'login_name'      => $user->login_name ?? '',
            'email'           => $user->email ?? '',
            'display_name'    => $user->display_name ?? '',
            'role'            => $user->role ?? '',
            'locale'          => $display['locale'],
            'credit_balance'  => $creditBalance,
            'credits_unlimited' => $creditBalance === null,
            'preferences'     => $prefs,
        ],
    ]);
};
