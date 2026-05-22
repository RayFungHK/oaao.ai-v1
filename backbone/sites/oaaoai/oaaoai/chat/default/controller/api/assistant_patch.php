<?php

declare(strict_types=1);

/**
 * POST /chat/api/assistant_patch — persist streamed assistant body (ownership-checked).
 *
 * Body JSON: { "conversation_id": int, "assistant_message_id": int, "content": string, "meta"?: object }
 *
 * Uses {@see \Razy\Database} statement chains on adjunct split SQLite — same style as {@see \oaaoai\endpoints\CanonicalEndpointsRepository}.
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
    $mid = (int) ($input['assistant_message_id'] ?? 0);
    $content = (string) ($input['content'] ?? '');
    $metaJson = null;
    if (\array_key_exists('meta', $input) && \is_array($input['meta'])) {
        try {
            $metaJson = json_encode($input['meta'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid meta']);

            return;
        }
    }

    if ($cid < 1 || $mid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id and assistant_message_id required']);

        return;
    }

    if (strlen($content) > 128000) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Content too long']);

        return;
    }

    $syncWarnings = [];

    try {
        $authApi->upgradeSqliteLocalAdjunct($pdo);

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
            echo json_encode(['success' => false, 'message' => 'Message not found']);

            return;
        }

        $msg = $splitDb->prepare()
            ->select('id')
            ->from('message')
            ->where('id=?,conversation_id=?,role=?')
            ->assign(['id' => $mid, 'conversation_id' => $cid, 'role' => 'assistant'])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($msg) || ! isset($msg['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Message not found']);

            return;
        }

        $cols = ['content'];
        $assign = [
            'content'         => $content,
            'id'              => $mid,
            'conversation_id' => $cid,
        ];
        if ($metaJson !== null) {
            $cols[] = 'meta_json';
            $assign['meta_json'] = $metaJson;
        }
        $splitDb->update('message', $cols)
            ->where('id=?,conversation_id=?')
            ->assign($assign)
            ->query();

        $now = date('Y-m-d H:i:s');
        $splitDb->update('conversation', ['updated_at'])
            ->where('id=?')
            ->assign([
                'updated_at' => $now,
                'id'         => $cid,
            ])
            ->query();

        if (\is_array($input['meta'] ?? null)) {
            $metaForMaterials = $input['meta'];
            try {
                $slideApi = $this->api('slide_designer');
                if ($slideApi && \is_array($metaForMaterials['slide_project'] ?? null)) {
                    $metaForMaterials = $slideApi->enrichAndSyncAssistantSlideMeta(
                        $pdo,
                        $cid,
                        $mid,
                        $uid,
                        $wid,
                        $metaForMaterials,
                    );
                }
            } catch (\Throwable $e) {
                $syncWarnings[] = 'slide_project_sync';
                error_log('assistant_patch slide_project_sync: ' . $e->getMessage());
            }

            try {
                require_once dirname(__DIR__, 2) . '/library/ChatConversationMaterial.php';
                \oaaoai\chat\ChatConversationMaterial::syncFromMessageMeta(
                    $pdo,
                    $cid,
                    $mid,
                    $metaForMaterials,
                );
            } catch (\Throwable $e) {
                $syncWarnings[] = 'materials_sync';
                error_log('assistant_patch materials_sync: ' . $e->getMessage());
            }

            try {
                if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql') {
                    $tenantId = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
                    $coreApi = $this->api('core');
                    if ($tenantId < 1 && $coreApi) {
                        $tenantId = $coreApi->bootstrapTenantContext($pdo);
                    }
                    if ($tenantId > 0 && $coreApi) {
                        $coreApi->recordUsageChatCompletion($pdo, $tenantId, $input['meta']);
                    }
                }
            } catch (\Throwable $e) {
                $syncWarnings[] = 'usage_record';
                error_log('assistant_patch usage_record: ' . $e->getMessage());
            }
        }

        $out = ['success' => true];
        if ($syncWarnings !== []) {
            $out['sync_warnings'] = $syncWarnings;
        }
        echo json_encode($out);
    } catch (\Throwable $e) {
        error_log('assistant_patch failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Patch failed']);
    }
};
