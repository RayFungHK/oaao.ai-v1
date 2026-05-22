<?php

declare(strict_types=1);

/**
 * POST /chat/api/attachment_upload — ephemeral file for current conversation (multipart).
 *
 * Fields: {@code conversation_id}, optional {@code workspace_id}, file field {@code file}.
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
    $wid = $this->oaao_chat_resolve_workspace_id($_POST);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    if ($cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

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

    $size = (int) ($f['size'] ?? 0);
    if ($size < 1 || $size > 48 * 1024 * 1024) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'File size must be 1 byte – 48 MB']);

        return;
    }

    $mime = (string) ($f['type'] ?? 'application/octet-stream');
    $ext = pathinfo($orig, PATHINFO_EXTENSION);
    $safeExt = $ext !== '' ? ('.' . preg_replace('/[^a-zA-Z0-9]/', '', $ext)) : '';

    require_once __DIR__ . '/../library/ChatAttachmentStorage.php';
    \oaaoai\chat\ChatAttachmentStorage::sweepExpired($splitDb);

    $dir = \oaaoai\chat\ChatAttachmentStorage::ensureConversationDir($cid);
    $stored = 'att_' . bin2hex(random_bytes(8)) . $safeExt;
    $dest = $dir . '/' . $stored;
    if (! move_uploaded_file($tmp, $dest)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not store file']);

        return;
    }

    $ttlDays = \oaaoai\chat\ChatAttachmentStorage::ttlDays();
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
            'byte_size',
            'extract_status',
            'created_at',
            'expires_at',
        ])->assign([
            'conversation_id' => $cid,
            'user_id'         => $uid,
            'file_name'       => $orig,
            'mime_type'       => substr($mime, 0, 255),
            'storage_path'    => $relPath,
            'byte_size'       => $size,
            'extract_status'  => 'pending',
            'created_at'      => $now,
            'expires_at'      => $expires,
        ])->query();

        $aid = $splitDb->lastID();
        echo json_encode([
            'success' => true,
            'data'    => [
                'attachment_id' => $aid,
                'conversation_id' => $cid,
                'file_name'     => $orig,
                'mime_type'     => $mime,
                'byte_size'     => $size,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable $e) {
        @unlink($dest);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not record attachment']);
    }
};
