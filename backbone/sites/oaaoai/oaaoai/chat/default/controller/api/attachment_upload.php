<?php

declare(strict_types=1);

use oaaoai\chat\ChatAttachmentManifest;
use oaaoai\chat\ChatAttachmentStorage;

/**
 * POST /chat/api/attachment_upload — ephemeral file for current conversation (multipart).
 *
 * Fields: optional {@code conversation_id}, optional {@code create_conversation=1} (legacy — prefer draft upload without it),
 * optional {@code workspace_id}, file field {@code file}.
 *
 * When {@code conversation_id} is omitted and {@code create_conversation} is not set, stores a per-user draft
 * ({@code conversation_id=0}) until {@code send} claims it — no sidebar conversation is created.
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
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $cid = isset($_POST['conversation_id']) ? (int) $_POST['conversation_id'] : 0;
    $createIfMissing = isset($_POST['create_conversation']) && in_array(strtolower((string) $_POST['create_conversation']), ['1', 'true', 'yes'], true);
    $wid = $this->oaao_chat_resolve_workspace_id($_POST);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    $this->ensureConversationAttachmentSchema($pdo);

    $draftUpload = false;
    if ($cid < 1 && $createIfMissing) {
        $nowConv = date('Y-m-d H:i:s');
        $splitDb->insert('conversation', ['user_id', 'workspace_id', 'title', 'created_at', 'updated_at'])
            ->assign([
                'user_id'      => $uid,
                'workspace_id' => $wid,
                'title'        => 'New chat',
                'created_at'   => $nowConv,
                'updated_at'   => $nowConv,
            ])
            ->query();
        $cid = (int) $splitDb->lastID();
    } elseif ($cid < 1) {
        $draftUpload = true;
        $cid = 0;
    }

    if (! $draftUpload) {
        $conv = $splitDb->prepare()
            ->select('id')
            ->from('conversation')
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid, 'workspace_id' => $wid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($conv)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }
    }

    if (! isset($_FILES['file']) || ! \is_array($_FILES['file'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'file required']);

        return;
    }

    $f = $_FILES['file'];
    $err = (int) ($f['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($err !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Upload error']);

        return;
    }

    $tmp = (string) ($f['tmp_name'] ?? '');
    if ($tmp === '' || ! is_uploaded_file($tmp)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid upload']);

        return;
    }

    $orig = basename((string) ($f['name'] ?? 'attachment'));
    $orig = preg_replace('/[^\p{L}\p{N}\.\-_\s]/u', '_', $orig) ?? 'attachment';
    $orig = substr(trim($orig), 0, 255);
    if ($orig === '') {
        $orig = 'attachment';
    }

    $maxBytes = 25 * 1024 * 1024;
    $size = (int) ($f['size'] ?? 0);
    if ($size < 1 || $size > $maxBytes) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'File size must be 1 byte – 25 MB']);

        return;
    }

    $mime = (string) ($f['type'] ?? 'application/octet-stream');
    $ext = pathinfo($orig, PATHINFO_EXTENSION);
    $safeExt = $ext !== '' ? ('.' . preg_replace('/[^a-zA-Z0-9]/', '', $ext)) : '';

    ChatAttachmentStorage::sweepExpired($splitDb);

    $stored = 'att_' . bin2hex(random_bytes(8)) . $safeExt;
    $relKey = ChatAttachmentStorage::relativeKey($cid, $uid, $stored, $draftUpload);
    $locatorJson = null;

    $canonPdo = $this->oaao_chat_canonical_pdo();
    $core = $this->api('core');
    $tenantId = ($canonPdo instanceof \PDO && $core) ? $core->bootstrapTenantContext($canonPdo) : 0;

    if ($tenantId > 0 && $canonPdo instanceof \PDO) {
        $blob = ChatAttachmentStorage::blobStorage($canonPdo, $tenantId);
        $locator = $blob->putUploadedFile($tmp, $relKey);
        $locatorJson = $locator->toJson();
        $dest = $blob->resolveAbsolutePath($locatorJson, $relKey, ChatAttachmentStorage::root());
    } else {
        $dir = $draftUpload ? ChatAttachmentStorage::ensureDraftDir($uid) : ChatAttachmentStorage::ensureConversationDir($cid);
        $dest = $dir . '/' . $stored;
        if (! move_uploaded_file($tmp, $dest)) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not store file']);

            return;
        }
    }

    $ttlDays = ChatAttachmentStorage::ttlDays();
    $expires = date('Y-m-d H:i:s', time() + $ttlDays * 86400);
    $now = date('Y-m-d H:i:s');
    $relPath = $stored;

    try {
        $splitDb->insert('conversation_attachment', [
            'conversation_id',
            'user_id',
            'file_name',
            'mime_type',
            'storage_path',
            'storage_locator_json',
            'byte_size',
            'extract_status',
            'created_at',
            'expires_at',
        ])->assign([
            'conversation_id'      => $cid,
            'user_id'              => $uid,
            'file_name'            => $orig,
            'mime_type'            => substr($mime, 0, 255),
            'storage_path'         => $relPath,
            'storage_locator_json' => $locatorJson,
            'byte_size'            => $size,
            'extract_status'       => 'pending',
            'created_at'           => $now,
            'expires_at'           => $expires,
        ])->query();

        $aid = $splitDb->lastID();
        $kind = ChatAttachmentManifest::classifyKind($mime, $orig);
        echo json_encode([
            'success' => true,
            'data'    => [
                'attachment_id'   => $aid,
                'conversation_id' => $cid,
                'file_name'       => $orig,
                'mime_type'       => $mime,
                'byte_size'       => $size,
                'kind'            => $kind,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        @unlink($dest);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not record attachment']);
    }
};
