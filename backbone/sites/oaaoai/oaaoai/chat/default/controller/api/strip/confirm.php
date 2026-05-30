<?php

declare(strict_types=1);

use oaaoai\chat\ChatBubbleConversation;
use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatProductivityFence;
use oaaoai\chat\ChatProductivityInlineParse;
use oaaoai\chat\ChatStripConfirm;
use oaaoai\chat\ChatStripHash;

/**
 * POST /chat/api/strip/confirm — execute signed strip action and clear assistant meta_json key.
 *
 * Registries ({@code strip_action.register}, …) must be collected on the **endpoints** emitter
 * ({@code oaaoai/endpoints:collect_feature_registries}) — same as {@see info_worker.php}.
 *
 * Body JSON: { "strip_hash": "v1.…", "workspace_id"?: int }
 *
 * @see docs/design/strip-chip-shell.md
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $stripHash = trim((string) ($input['strip_hash'] ?? ''));
    if ($stripHash === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'strip_hash required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $claims = ChatStripHash::verify($stripHash);
    if ($claims === null) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Invalid or expired strip_hash'], JSON_UNESCAPED_UNICODE);

        return;
    }

    if ((int) $claims['user_id'] !== $uid) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'strip_hash user mismatch'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $cid = (int) $claims['conversation_id'];
    $mid = (int) $claims['message_id'];
    $actionId = (string) $claims['action_id'];

    $this->api('endpoints')?->ensureFeatureRegistries();

    try {
        if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            require_once dirname(__DIR__, 5) . '/auth/default/controller/api/_install_sqlite_local_schema.php';
            oaao_auth_upgrade_sqlite_message_meta_json($pdo);
        }

        $conv = ChatConversationScope::findOwnedByUser($splitDb, $uid, $cid, 'id, workspace_id');
        if ($conv === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found'], JSON_UNESCAPED_UNICODE);

            return;
        }

        $convWid = ChatConversationScope::normalizeWorkspaceId($conv['workspace_id'] ?? null);
        $requestWid = $this->oaao_chat_resolve_workspace_id($input);
        if ($requestWid !== null && ! ChatConversationScope::matchesScope($convWid, $requestWid)) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Workspace scope mismatch'], JSON_UNESCAPED_UNICODE);

            return;
        }

        if (! $this->oaao_chat_gate_workspace_scope($uid, $convWid)) {
            return;
        }

        $msgRow = $splitDb->prepare()
            ->select('meta_json, content')
            ->from('message')
            ->where('id=?,conversation_id=?')
            ->assign(['id' => $mid, 'conversation_id' => $cid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($msgRow)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Message not found'], JSON_UNESCAPED_UNICODE);

            return;
        }

        $meta = [];
        $rawMeta = trim((string) ($msgRow['meta_json'] ?? ''));
        if ($rawMeta !== '') {
            try {
                $decoded = json_decode($rawMeta, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($decoded)) {
                    $meta = $decoded;
                }
            } catch (\JsonException) {
                $meta = [];
            }
        }

        $content = trim((string) ($msgRow['content'] ?? ''));
        if ($content !== '') {
            $meta = ChatProductivityInlineParse::enrichMetaFromContent($meta, $content, $cid) ?? $meta;
        }

        if (! \array_key_exists($actionId, $meta) || $meta[$actionId] === null) {
            if (ChatStripConfirm::isAlreadyResolved($meta, $actionId)) {
                ChatBubbleConversation::promoteToPersistent($splitDb, $cid, $uid);
                echo json_encode([
                    'success'    => true,
                    'action_id'  => $actionId,
                    'message_id' => $mid,
                    'idempotent' => true,
                ], JSON_UNESCAPED_UNICODE);

                return;
            }

            http_response_code(409);
            echo json_encode([
                'success' => false,
                'message' => 'Suggestion payload is no longer available',
            ], JSON_UNESCAPED_UNICODE);

            return;
        }

        $payload = ChatStripConfirm::payloadFromMeta($actionId, $meta[$actionId]);
        if (\is_array($payload) && str_starts_with(strtolower($actionId), 'todo_')) {
            $payload = ChatStripConfirm::enrichTodoPayloadFromMeta($payload, $meta);
        }
        if ($payload === null) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid suggestion payload'], JSON_UNESCAPED_UNICODE);

            return;
        }

        if (! ChatStripConfirm::verifyPayloadDigest($claims, $payload)) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'strip_hash payload mismatch'], JSON_UNESCAPED_UNICODE);

            return;
        }

        $result = ChatStripConfirm::execute($this, $uid, $convWid ?? 0, $claims, $payload);
        if (empty($result['success'])) {
            $http = (int) ($result['http'] ?? 500);
            http_response_code($http > 0 ? $http : 500);
            echo json_encode([
                'success' => false,
                'message' => (string) ($result['message'] ?? 'Confirm failed'),
            ], JSON_UNESCAPED_UNICODE);

            return;
        }

        ChatProductivityFence::archiveAction($meta, $actionId, 'confirmed', $cid, $content);
        ChatBubbleConversation::promoteToPersistent($splitDb, $cid, $uid);
        $splitDb->update('message', ['meta_json'])
            ->where('id=?,conversation_id=?')
            ->assign([
                'meta_json'       => json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'id'              => $mid,
                'conversation_id' => $cid,
            ])
            ->query();

        echo json_encode([
            'success'    => true,
            'action_id'  => $actionId,
            'message_id' => $mid,
            'data'       => $result['data'] ?? [],
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log(sprintf('[strip/confirm] %s in %s:%d', $e->getMessage(), $e->getFile(), $e->getLine()));
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Confirm failed'], JSON_UNESCAPED_UNICODE);
    }
};
