<?php

declare(strict_types=1);

use oaaoai\chat\ChatContextUsage;
use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatHistorySettings;
use oaaoai\chat\ChatOrchestratorBootstrap;
use oaaoai\chat\ChatTokenEstimator;

require_once __DIR__ . '/../../library/ChatContextUsage.php';
require_once __DIR__ . '/../../library/ChatConversationScope.php';
require_once __DIR__ . '/../../library/ChatHistorySettings.php';
require_once __DIR__ . '/../../library/ChatOrchestratorBootstrap.php';
require_once __DIR__ . '/../../library/ChatTokenEstimator.php';

/**
 * GET /chat/api/context_usage?conversation_id=
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    [$splitDb, $user] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $cid = (int) ($_GET['conversation_id'] ?? 0);
    if ($cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    $wid = $this->oaao_chat_resolve_workspace_id($_GET);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    try {
        $row = ChatConversationScope::findOwnedByUser($splitDb, $uid, $cid, 'id, workspace_id');
        if ($row === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        if ($wid === null) {
            $wid = ChatConversationScope::normalizeWorkspaceId($row['workspace_id'] ?? null);
        }

        $canonPdo = $this->oaao_chat_canonical_pdo();
        $promptLimit = $canonPdo instanceof \PDO
            ? ChatHistorySettings::resolvePromptMessageLimit($canonPdo)
            : ChatHistorySettings::promptMessageLimit();

        $contextLimit = ChatContextUsage::DEFAULT_CONTEXT_TOKENS;
        $chatEndpointId = (int) ($_GET['chat_endpoint_id'] ?? 0);
        $binding = null;
        $tokenizerProfile = null;
        if ($chatEndpointId > 0 && $canonPdo instanceof \PDO) {
            $authDb = $this->api('auth')?->getDB();
            if ($authDb instanceof \Razy\Database) {
                $binding = ChatOrchestratorBootstrap::resolveBindingForProfile($authDb, $chatEndpointId);
                $contextLimit = ChatContextUsage::resolveContextLimitFromBinding($binding);
                $tokenizerProfile = ChatTokenEstimator::resolveProfileFromBinding($binding);
            }
        }

        $splitPdo = $splitDb->getDBAdapter();
        $overhead = ChatContextUsage::measureOverheadTokens(
            $this,
            $uid,
            is_int($wid) && $wid > 0 ? $wid : null,
            $splitPdo instanceof \PDO ? $splitPdo : null,
            $canonPdo instanceof \PDO ? $canonPdo : null,
            'default',
            $tokenizerProfile,
        );

        $usage = ChatContextUsage::usageReport(
            $splitDb,
            $cid,
            $contextLimit,
            $promptLimit,
            $overhead,
            $canonPdo instanceof \PDO ? $canonPdo : null,
            $tokenizerProfile,
        );

        if ($binding !== null) {
            $usage['output_reserve_tokens'] = ChatContextUsage::outputReserveTokens($binding, $contextLimit);
        }

        echo json_encode(['success' => true, 'data' => $usage], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log('[oaao context_usage] ' . $e->getMessage());
        http_response_code(500);
        $detail = getenv('OAAO_DEBUG') === '1' || getenv('APP_ENV') === 'development'
            ? $e->getMessage()
            : null;
        echo json_encode([
            'success' => false,
            'message' => 'Could not estimate context usage',
            'detail'  => $detail,
        ], JSON_UNESCAPED_UNICODE);
    }
};
