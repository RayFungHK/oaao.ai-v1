<?php

use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatHistorySettings;
use oaaoai\chat\ChatProductivityInlineParse;

/**
 * GET /chat/api/messages?conversation_id=&workspace_id=&limit=&before_id=
 *
 * Default: latest {@code limit} messages (chronological). With {@code before_id}: older page for lazy history.
 * {@code limit} is clamped to tenant chat config range ({@see ChatHistorySettings::MIN_PAGE_SIZE}–{@see ChatHistorySettings::MAX_PAGE_SIZE}).
 */
return function (): void {
    [$splitDb, $user] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $cid = (int) ($_GET['conversation_id'] ?? 0);
    $wid = $this->oaao_chat_resolve_workspace_id(null);
    $canonPdo = $this->oaao_chat_canonical_pdo();
    $defaultLimit = $canonPdo instanceof \PDO
        ? ChatHistorySettings::resolvePageSizeForUser($canonPdo, $uid)
        : ChatHistorySettings::DEFAULT_PAGE_SIZE;
    $limitRaw = $_GET['limit'] ?? null;
    $limit = ($limitRaw === null || $limitRaw === '')
        ? $defaultLimit
        : (int) $limitRaw;
    $limit = ChatHistorySettings::clampPageSize($limit);
    $beforeId = (int) ($_GET['before_id'] ?? 0);
    $includePromptDebug = filter_var($_GET['include_prompt_debug'] ?? false, FILTER_VALIDATE_BOOLEAN);

    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    if ($uid < 1 || $cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    try {
        $own = ChatConversationScope::findForUser($splitDb, $uid, $cid, $wid, 'id');
        if ($own === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        if ($beforeId > 0) {
            $raw = $splitDb->prepare()
                ->select('id, role, content, created_at, feedback, meta_json')
                ->from('message')
                ->where('conversation_id=?,id<?')
                ->assign(['conversation_id' => $cid, 'id' => $beforeId])
                ->order('-id')
                ->limit($limit)
                ->query()
                ->fetchAll();
        } else {
            $raw = $splitDb->prepare()
                ->select('id, role, content, created_at, feedback, meta_json')
                ->from('message')
                ->where('conversation_id=?')
                ->assign(['conversation_id' => $cid])
                ->order('-id')
                ->limit($limit)
                ->query()
                ->fetchAll();
        }

        /** @var list<array<string, mixed>> $rowsDesc */
        $rowsDesc = \is_array($raw) ? $raw : [];
        /** @var list<array<string, mixed>> $rows */
        $rows = \array_reverse($rowsDesc);

        $out = [];
        $minId = null;
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $mid = (int) ($row['id'] ?? 0);
            if ($mid > 0 && ($minId === null || $mid < $minId)) {
                $minId = $mid;
            }
            $mj = $row['meta_json'] ?? null;
            unset($row['meta_json']);
            $row['meta'] = null;
            if (\is_string($mj) && $mj !== '') {
                try {
                    $decoded = json_decode($mj, true, 512, JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    $decoded = null;
                }
                if (\is_array($decoded)) {
                    try {
                        $content = (string) ($row['content'] ?? '');
                        $row['meta'] = ChatProductivityInlineParse::enrichMetaFromContent(
                            $decoded,
                            $content,
                            $cid,
                        ) ?? $decoded;
                    } catch (\Throwable) {
                        $row['meta'] = $decoded;
                    }
                    if ($includePromptDebug
                        && ($row['role'] ?? '') === 'assistant'
                        && isset($decoded['orchestrator_prompt_debug'])
                        && \is_array($decoded['orchestrator_prompt_debug'])) {
                        $row['prompt_debug'] = $decoded['orchestrator_prompt_debug'];
                    }
                }
            }
            $out[] = $row;
        }

        $hasOlder = false;
        if ($minId !== null && $minId > 0) {
            $older = $splitDb->prepare()
                ->select('id')
                ->from('message')
                ->where('conversation_id=?,id<?')
                ->assign(['conversation_id' => $cid, 'id' => $minId])
                ->limit(1)
                ->query()
                ->fetch();
            $hasOlder = \is_array($older) && isset($older['id']);
        }

        $lastMessageId = null;
        if ($beforeId < 1) {
            $lastRow = $splitDb->prepare()
                ->select('id')
                ->from('message')
                ->where('conversation_id=?')
                ->assign(['conversation_id' => $cid])
                ->order('-id')
                ->limit(1)
                ->query()
                ->fetch();
            if (\is_array($lastRow)) {
                $lastId = (int) ($lastRow['id'] ?? 0);
                $lastMessageId = $lastId > 0 ? $lastId : null;
            }
        }

        $jsonFlags = JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE;
        if (\defined('JSON_PARTIAL_OUTPUT_ON_ERROR')) {
            $jsonFlags |= JSON_PARTIAL_OUTPUT_ON_ERROR;
        }
        $payload = json_encode([
            'success'            => true,
            'messages'           => $out,
            'has_older'          => $hasOlder,
            'oldest_message_id'  => $minId,
            'last_message_id'    => $lastMessageId,
            'limit'              => $limit,
        ], $jsonFlags);
        if ($payload === false) {
            throw new \RuntimeException('json_encode failed: ' . json_last_error_msg());
        }
        echo $payload;
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Failed to load messages']);
    }
};
