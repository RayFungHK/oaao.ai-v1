<?php

declare(strict_types=1);

use oaaoai\chat\ChatContextUsage;
use oaaoai\chat\ChatConversationCompact;
use oaaoai\chat\ChatHistorySettings;
use oaaoai\chat\ChatOrchestratorBootstrap;
use oaaoai\chat\ChatTokenEstimator;

/**
 * POST /chat/api/conversation_compact — in-thread CIT/CMT; supersede older turns, keep tail.
 *
 * Body: { "conversation_id": int }
 */
return function (): void {
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

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $cid = (int) ($input['conversation_id'] ?? 0);
    if ($cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    try {
        $parent = $splitDb->prepare()
            ->select('id')
            ->from('conversation')
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid, 'workspace_id' => $wid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($parent)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        $result = ChatConversationCompact::apply($splitDb, $cid, $uid, $wid, $this);

        if (! empty($result['skipped'])) {
            echo json_encode([
                'success' => true,
                'skipped' => true,
                'message' => (string) ($result['message'] ?? ''),
            ], JSON_UNESCAPED_UNICODE);

            return;
        }

        if (empty($result['applied'])) {
            http_response_code(502);
            echo json_encode([
                'success' => false,
                'message' => (string) ($result['message'] ?? 'Compaction failed'),
            ], JSON_UNESCAPED_UNICODE);

            return;
        }

        $canonPdo = $this->oaao_chat_canonical_pdo();
        $promptLimit = $canonPdo instanceof \PDO
            ? ChatHistorySettings::resolvePromptMessageLimit($canonPdo)
            : ChatHistorySettings::promptMessageLimit();

        $contextLimit = ChatContextUsage::DEFAULT_CONTEXT_TOKENS;
        $tokenizerProfile = null;
        $chatEndpointId = (int) ($input['chat_endpoint_id'] ?? 0);
        if ($chatEndpointId > 0 && $canonPdo instanceof \PDO) {
            $canonDb = $this->api('auth')?->getDB();
            if ($canonDb instanceof \Razy\Database) {
                $binding = ChatOrchestratorBootstrap::resolveBindingForProfile($canonDb, $chatEndpointId);
                $contextLimit = ChatContextUsage::resolveContextLimitFromBinding($binding);
                $tokenizerProfile = ChatTokenEstimator::resolveProfileFromBinding($binding);
            }
        }

        $splitPdo = $splitDb->getDBAdapter();
        $overhead = ChatContextUsage::measureOverheadTokens(
            $this,
            $uid,
            $wid > 0 ? $wid : null,
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

        echo json_encode([
            'success'            => true,
            'handoff_message_id' => $result['handoff_message_id'] ?? null,
            'superseded_count'   => $result['superseded_count'] ?? 0,
            'tail_count'         => $result['tail_count'] ?? 0,
            'handoff_source'     => $result['handoff_source'] ?? 'heuristic',
            'usage'              => $usage,
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not compact conversation']);
    }
};
