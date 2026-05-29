<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationScope;

/**
 * GET /chat/api/conversation?conversation_id= — owned thread metadata (ignores active workspace scope).
 */
return function (): void {
    [$authApi, $user] = $this->oaao_chat_require_authenticated_only();
    if (! $authApi || ! $user) {
        return;
    }

    $splitDb = $authApi->getDBSplit();
    if (! $splitDb || ! $splitDb->getDBAdapter() instanceof \PDO) {
        $authApi->ensureAdjunctSqliteLoaded();
        $splitDb = $authApi->getDBSplit();
    }
    if (! $splitDb instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Adjunct SQLite unavailable']);

        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $cid = (int) ($_GET['conversation_id'] ?? 0);
    if ($uid < 1 || $cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    try {
        $row = ChatConversationScope::findOwnedByUser($splitDb, $uid, $cid);
        if ($row === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        $mode = 'default';
        $plannerModeId = 'default';
        $inferenceMode = \oaaoai\chat\ChatInferenceControl::MODE_OFF;
        $paramsRaw = $row['params_json'] ?? null;
        if (\is_string($paramsRaw) && $paramsRaw !== '') {
            $decoded = json_decode($paramsRaw, true);
            if (\is_array($decoded)) {
                if (isset($decoded['mode']) && $decoded['mode'] === 'desk') {
                    $mode = 'desk';
                }
                $pm = strtolower(trim((string) ($decoded['planner_mode_id'] ?? '')));
                if (\in_array($pm, ['default', 'tot', 'ddtree'], true)) {
                    $plannerModeId = $pm;
                }
                $inferenceMode = \oaaoai\chat\ChatInferenceControl::modeFromConversation($decoded);
            }
        }
        unset($row['params_json']);
        $row['mode'] = $mode;
        $row['planner_mode_id'] = $plannerModeId;
        $row['inference_mode'] = $inferenceMode;

        echo json_encode([
            'success'      => true,
            'conversation' => $row,
        ]);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load conversation']);
    }
};
