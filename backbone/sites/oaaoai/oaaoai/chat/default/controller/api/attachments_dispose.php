<?php

declare(strict_types=1);

use oaaoai\chat\ChatAttachmentStorage;

/**
 * POST /chat/api/attachments_dispose — orchestrator internal: delete ephemeral files after ATTACHMENTS task.
 *
 * Body: { conversation_id, user_id, attachment_ids: number[] }
 * Header: {@code X-OAAO-Internal-Token}
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
    $idsRaw = $input['attachment_ids'] ?? [];
    /** @var list<int> $ids */
    $ids = [];
    if (\is_array($idsRaw)) {
        foreach ($idsRaw as $v) {
            $aid = \is_int($v) ? $v : (int) $v;
            if ($aid > 0) {
                $ids[] = $aid;
            }
        }
    }
    $ids = array_values(array_unique($ids, SORT_NUMERIC));

    if ($uid < 1 || $cid < 1 || $ids === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'user_id, conversation_id, attachment_ids required']);

        return;
    }

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
    if ($pdo instanceof \PDO) {
        $this->ensureConversationAttachmentSchema($pdo);
    }

    $removed = ChatAttachmentStorage::disposeByIds($splitDb, $cid, $uid, $ids);
    echo json_encode(['success' => true, 'data' => ['removed' => $removed]], JSON_UNESCAPED_UNICODE);
};
