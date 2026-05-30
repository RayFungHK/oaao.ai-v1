<?php

declare(strict_types=1);

use oaaoai\chat\AgentMaterialStorage;
use oaaoai\chat\ChatConversationMaterial;

/**
 * GET /chat/api/material_media — stream one agent-generated material blob.
 *
 * Query: {@code conversation_id}, {@code material_id}, optional {@code message_id}.
 */
return function (): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        http_response_code(405);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $cid = (int) ($_GET['conversation_id'] ?? 0);
    $materialId = trim((string) ($_GET['material_id'] ?? ''));
    $mid = (int) ($_GET['message_id'] ?? 0);
    $wid = $this->oaao_chat_resolve_workspace_id(null);

    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    if ($uid < 1 || $cid < 1 || $materialId === '') {
        http_response_code(400);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'conversation_id and material_id required']);

        return;
    }

    $canonPdo = $this->oaao_chat_canonical_pdo();
    $core = $this->api('core');
    $tenantId = ($canonPdo instanceof \PDO && $core) ? (int) $core->bootstrapTenantContext($canonPdo) : 0;
    if ($tenantId < 1 && isset($user->tenant_id)) {
        $tenantId = (int) $user->tenant_id;
    }
    if ($tenantId < 1 || ! $canonPdo instanceof \PDO) {
        http_response_code(503);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Tenant storage unavailable']);

        return;
    }

    $this->ensureConversationMaterialSchema($pdo);

    $own = $splitDb->prepare()
        ->select('id')
        ->from('conversation')
        ->where('id=?,user_id=?,workspace_id=?')
        ->assign(['id' => $cid, 'user_id' => $uid, 'workspace_id' => $wid])
        ->limit(1)
        ->query()
        ->fetch();
    if (! \is_array($own)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Conversation not found']);

        return;
    }

    $sql = 'SELECT title, mime, storage_locator_json, meta_json FROM oaao_conversation_material
            WHERE conversation_id = ? AND material_id = ?';
    $params = [$cid, $materialId];
    if ($mid > 0) {
        $sql .= ' AND message_id = ?';
        $params[] = $mid;
    }
    $sql .= ' ORDER BY id DESC LIMIT 1';

    $st = $pdo->prepare($sql);
    $st->execute($params);
    $row = $st->fetch(\PDO::FETCH_ASSOC);
    if (! \is_array($row)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Material not found']);

        return;
    }

    $locJson = AgentMaterialStorage::locatorJsonFromMaterialRow($row);
    if ($locJson === null) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Material has no stored blob']);

        return;
    }

    try {
        $resolved = AgentMaterialStorage::getStorage($canonPdo, $tenantId, $locJson);
    } catch (\Throwable) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'File not found']);

        return;
    }

    if (($resolved['mode'] ?? '') === 'redirect' && ! empty($resolved['url'])) {
        header('Location: ' . (string) $resolved['url'], true, 302);
        exit;
    }

    $absPath = (string) ($resolved['absolute_path'] ?? '');
    if ($absPath === '' || ! is_file($absPath) || ! is_readable($absPath)) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'File not readable']);

        return;
    }

    $fileName = trim((string) ($row['title'] ?? 'download'));
    $mime = isset($row['mime']) && \is_string($row['mime']) ? trim($row['mime']) : 'application/octet-stream';
    $size = filesize($absPath);

    header('Content-Type: ' . ($mime !== '' ? $mime : 'application/octet-stream'));
    header('Content-Disposition: inline; filename="' . str_replace('"', '', $fileName) . '"');
    if ($size !== false) {
        header('Content-Length: ' . (string) $size);
    }
    header('Cache-Control: private, max-age=3600');
    readfile($absPath);
    exit;
};
