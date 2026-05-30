<?php

declare(strict_types=1);

use oaaoai\chat\FeedbackJudgeClient;
use oaaoai\user\UserFeedbackJudge;
use oaaoai\user\UserFeedbackModelTune;
use oaaoai\user\UserModelParams;

require_once dirname(__DIR__, 4) . '/chat/default/library/FeedbackJudgeClient.php';
require_once dirname(__DIR__, 4) . '/chat/default/library/OrchestratorInternalUrl.php';
require_once dirname(__DIR__, 4) . '/user/default/library/UserModelParams.php';
require_once dirname(__DIR__, 4) . '/user/default/library/UserFeedbackModelTune.php';
require_once dirname(__DIR__, 4) . '/user/default/library/UserFeedbackJudge.php';

/**
 * POST /chat/api/message_feedback — thumbs up/down on assistant message (owner via conversation).
 *
 * Body JSON: { "conversation_id": int, "message_id": int, "feedback": "up"|"down"|"like"|"dislike"|""|null }
 * Toggle: sending the same vote again clears feedback.
 * UX-1-S10: new downvote applies bounded {@code model_params} delta + audit in {@code preferences_json}.
 */
return function (): void {
    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    $cid = (int) ($input['conversation_id'] ?? 0);
    $mid = (int) ($input['message_id'] ?? 0);
    $fbRaw = $input['feedback'] ?? null;

    if ($cid < 1 || $mid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id and message_id required']);

        return;
    }

    $normalizeVote = static function (mixed $raw): string {
        if (! \is_string($raw)) {
            return '';
        }
        $v = strtolower(trim($raw));

        return match ($v) {
            'up', 'thumbs_up', 'like'       => 'up',
            'down', 'thumbs_down', 'dislike' => 'down',
            default                         => '',
        };
    };

    $requested = $normalizeVote($fbRaw);

    try {
        if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_install_sqlite_local_schema.php';
            oaao_auth_upgrade_sqlite_message_meta_json($pdo);
        }

        $conv = $splitDb->prepare()
            ->select('id')
            ->from('conversation')
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid, 'workspace_id' => $wid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($conv) || ! isset($conv['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        $msgRow = $splitDb->prepare()
            ->select('feedback')
            ->from('message')
            ->where('id=?,conversation_id=?')
            ->assign(['id' => $mid, 'conversation_id' => $cid])
            ->limit(1)
            ->query()
            ->fetch();
        $current = '';
        if (\is_array($msgRow)) {
            $current = $normalizeVote($msgRow['feedback'] ?? '');
        }

        $stored = '';
        if ($requested !== '') {
            $stored = ($requested === $current) ? '' : $requested;
        }

        $splitDb->update('message', ['feedback'])
            ->where('id=?,conversation_id=?')
            ->assign([
                'feedback'        => $stored,
                'id'              => $mid,
                'conversation_id' => $cid,
            ])
            ->query();

        $tuneApplied = null;
        $judgeSummary = null;
        if ($stored === 'down') {
            $canonical = $this->oaao_chat_canonical_pdo();
            if ($canonical instanceof \PDO) {
                try {
                    $tuneApplied = oaao_chat_apply_downvote_model_tune($canonical, $uid, $mid, $cid);
                } catch (\Throwable $e) {
                    error_log('[message_feedback] downvote_tune: ' . $e->getMessage());
                }
                try {
                    $judgeSummary = oaao_chat_apply_feedback_judge($canonical, $uid, $mid, $cid, $wid);
                } catch (\Throwable $e) {
                    error_log('[message_feedback] feedback_judge: ' . $e->getMessage());
                }
            }
        }

        $payload = [
            'success'    => true,
            'message_id' => $mid,
            'feedback'   => $stored === '' ? null : $stored,
        ];
        if ($tuneApplied !== null) {
            $payload['model_params_tune'] = $tuneApplied;
        }
        if ($judgeSummary !== null && $judgeSummary !== '') {
            $payload['feedback_judge_summary'] = $judgeSummary;
        }

        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log(sprintf('[message_feedback] %s in %s:%d', $e->getMessage(), $e->getFile(), $e->getLine()));
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Feedback failed']);
    }
};

/**
 * @return array{model_params: array<string, float|int>}|null
 */
function oaao_chat_apply_downvote_model_tune(\PDO $pdo, int $userId, int $messageId, int $conversationId): ?array
{
    if ($userId < 1) {
        return null;
    }

    $this->api('auth')->ensureCreditSchema($pdo);

    $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
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

    $before = UserModelParams::fromPreferences($prefs);
    $result = UserFeedbackModelTune::recordDownvote($prefs, $messageId, $conversationId, $before);
    $json = json_encode($result['preferences'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $upd = $pdo->prepare(
        'UPDATE oaao_user SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
    );
    $upd->execute([$json, $userId]);

    return [
        'model_params' => UserModelParams::activeOverrides($result['applied']),
    ];
}

function oaao_chat_apply_feedback_judge(
    \PDO $pdo,
    int $userId,
    int $messageId,
    int $conversationId,
    int $workspaceId,
): ?string {
    if ($userId < 1) {
        return null;
    }

    $locale = 'en';
    try {
        require_once dirname(__DIR__, 4) . '/user/default/library/UserDisplayPreferences.php';
        $locale = \oaaoai\user\UserDisplayPreferences::localeForUser($pdo, $userId);
    } catch (\Throwable) {
    }

    $judge = FeedbackJudgeClient::judge([
        'user_id'         => $userId,
        'conversation_id' => $conversationId,
        'message_id'      => $messageId,
        'workspace_id'    => $workspaceId,
        'locale'          => $locale,
    ]);
    if ($judge === null) {
        return null;
    }

    $this->api('auth')->ensureCreditSchema($pdo);

    $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
    $stmt->execute([$userId]);
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

    $prefs = UserFeedbackJudge::mergeJudgeResult($prefs, $messageId, $conversationId, $judge);
    $json = json_encode($prefs, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $upd = $pdo->prepare(
        'UPDATE oaao_user SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
    );
    $upd->execute([$json, $userId]);

    return trim((string) ($judge['summary'] ?? ''));
}
