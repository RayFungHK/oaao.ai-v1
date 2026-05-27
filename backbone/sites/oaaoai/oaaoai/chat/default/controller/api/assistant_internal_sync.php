<?php

declare(strict_types=1);

use oaaoai\chat\AgentMaterialStorage;
use oaaoai\chat\ChatConversationMaterial;
use oaaoai\chat\ChatConversationTitle;
use oaaoai\chat\ChatRunPrincipal;

/**
 * POST /chat/api/assistant_internal_sync — orchestrator adjunct sync (materials / slide registry).
 *
 * Requires {@code X-OAAO-Internal-Token}. Does not rewrite message content (orchestrator already persisted).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    $hdr = $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'] ?? '';
    if (! \is_string($hdr) || $hdr === '' || ! hash_equals($secret, $hdr)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $uid = (int) ($input['user_id'] ?? 0);
    $cid = (int) ($input['conversation_id'] ?? 0);
    $mid = (int) ($input['assistant_message_id'] ?? 0);
    $wid = isset($input['workspace_id']) ? (int) $input['workspace_id'] : null;
    if ($wid !== null && $wid < 1) {
        $wid = null;
    }

    if ($uid < 1 || $cid < 1 || $mid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'user_id, conversation_id, assistant_message_id required']);

        return;
    }

    $token = isset($input['run_principal']) && \is_string($input['run_principal']) ? trim($input['run_principal']) : '';
    if ($token !== '') {
        $principal = ChatRunPrincipal::verify($token);
        if ($principal === null
            || (int) $principal['user_id'] !== $uid
            || (int) $principal['conversation_id'] !== $cid
            || (int) $principal['assistant_message_id'] !== $mid) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Invalid run_principal']);

            return;
        }
    }

    if (! \is_array($input['meta'] ?? null)) {
        echo json_encode(['success' => true, 'skipped' => 'no_meta']);

        return;
    }

    /** @var array<string, mixed> $meta */
    $meta = $input['meta'];

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return;
    }
    if (method_exists($auth, 'ensureAdjunctSqliteLoaded')) {
        $auth->ensureAdjunctSqliteLoaded();
    }
    $splitDb = $auth->getDBSplit();
    if (! $splitDb instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Split database unavailable']);

        return;
    }

    $pdo = $splitDb->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Split PDO unavailable']);

        return;
    }

    $syncWarnings = [];

    try {
        $auth->upgradeSqliteLocalAdjunct($pdo);

        $conv = $splitDb->prepare()
            ->select('id')
            ->from('conversation')
            ->where('id=?,user_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($conv)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        if ($wid !== null) {
            $convW = $splitDb->prepare()
                ->select('id')
                ->from('conversation')
                ->where('id=?,user_id=?,workspace_id=?')
                ->assign(['id' => $cid, 'user_id' => $uid, 'workspace_id' => $wid])
                ->limit(1)
                ->query()
                ->fetch();
            if (! \is_array($convW)) {
                http_response_code(404);
                echo json_encode(['success' => false, 'message' => 'Workspace scope mismatch']);

                return;
            }
        }

        $metaForMaterials = $meta;
        try {
            $canonPdo = $auth->getDB()?->getDBAdapter();
            $tenantId = isset($input['tenant_id']) ? (int) $input['tenant_id'] : 0;
            if ($tenantId < 1 && $canonPdo instanceof \PDO) {
                $core = $this->api('core');
                if ($core) {
                    $tenantId = (int) $core->bootstrapTenantContext($canonPdo);
                }
            }
            if ($tenantId < 1 && $canonPdo instanceof \PDO) {
                $st = $canonPdo->prepare('SELECT tenant_id FROM oaao_user WHERE user_id = ? LIMIT 1');
                $st->execute([$uid]);
                $tenantId = (int) ($st->fetchColumn() ?: 0);
            }
            if ($canonPdo instanceof \PDO && $tenantId > 0) {
                AgentMaterialStorage::persistMetaArtifacts($canonPdo, $tenantId, $cid, $metaForMaterials);
            }
        } catch (\Throwable $e) {
            $syncWarnings[] = 'material_blob_persist';
            error_log('assistant_internal_sync material_blob_persist: ' . $e->getMessage());
        }

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
            error_log('assistant_internal_sync slide_project_sync: ' . $e->getMessage());
        }

        try {
            ChatConversationMaterial::syncFromMessageMeta(
                $pdo,
                $cid,
                $mid,
                $metaForMaterials,
            );
        } catch (\Throwable $e) {
            $syncWarnings[] = 'materials_sync';
            error_log('assistant_internal_sync materials_sync: ' . $e->getMessage());
        }

        try {
            ChatConversationTitle::maybeUpdateFromMeta($splitDb, $cid, $uid, $meta);
        } catch (\Throwable $e) {
            $syncWarnings[] = 'conversation_title';
            error_log('assistant_internal_sync conversation_title: ' . $e->getMessage());
        }

        $out = ['success' => true];
        if ($syncWarnings !== []) {
            $out['sync_warnings'] = $syncWarnings;
        }
        echo json_encode($out);
    } catch (\Throwable $e) {
        error_log('assistant_internal_sync failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Sync failed']);
    }
};
