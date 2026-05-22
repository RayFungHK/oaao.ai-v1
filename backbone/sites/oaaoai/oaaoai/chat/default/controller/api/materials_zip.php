<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationMaterial;

/**
 * GET /chat/api/materials_zip?conversation_id=&message_id= (optional)
 *
 * Zip downloadable task materials (slide-designer export files).
 */
return function (): void {
    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $cid = (int) ($_GET['conversation_id'] ?? 0);
    $mid = (int) ($_GET['message_id'] ?? 0);
    $wid = $this->oaao_chat_resolve_workspace_id(null);

    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    if ($uid < 1 || $cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    try {
        $own = $splitDb->prepare()
            ->select('id')
            ->from('conversation')
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid, 'workspace_id' => $wid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($own) || ! isset($own['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        if ($mid > 0) {
            $msg = $splitDb->prepare()
                ->select('id')
                ->from('message')
                ->where('id=?,conversation_id=?')
                ->assign(['id' => $mid, 'conversation_id' => $cid])
                ->limit(1)
                ->query()
                ->fetch();
            if (! \is_array($msg) || ! isset($msg['id'])) {
                http_response_code(404);
                echo json_encode(['success' => false, 'message' => 'Message not found']);

                return;
            }
        }

        require_once dirname(__DIR__, 2) . '/library/ChatConversationMaterial.php';
        $rows = ChatConversationMaterial::listForZipExport($pdo, $cid, $mid);

        if (! class_exists(\ZipArchive::class)) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Zip support unavailable']);

            return;
        }

        $zip = new \ZipArchive();
        $tmp = tempnam(sys_get_temp_dir(), 'oaao-mat-');
        if ($tmp === false) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not create archive']);

            return;
        }

        $zipPath = $tmp . '.zip';
        @unlink($tmp);
        if ($zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not create archive']);

            return;
        }

        $added = 0;
        /** @var array<string, true> $usedNames */
        $usedNames = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $uri = isset($row['uri']) && \is_string($row['uri']) ? trim($row['uri']) : '';
            if ($uri === '') {
                continue;
            }
            $resolved = ChatConversationMaterial::resolveDownloadablePath(
                $pdo,
                $uid,
                $cid,
                $uri,
                $this->api('slide_designer'),
            );
            if ($resolved === null) {
                continue;
            }
            $materialId = trim((string) ($row['material_id'] ?? 'file'));
            $entry = ChatConversationMaterial::zipEntryName($materialId, $resolved['name']);
            if (isset($usedNames[$entry])) {
                $entry = ChatConversationMaterial::zipEntryName($materialId . '-' . $added, $resolved['name']);
            }
            $usedNames[$entry] = true;
            if ($zip->addFile($resolved['path'], $entry)) {
                $added++;
            }
        }

        $zip->close();

        if ($added < 1) {
            @unlink($zipPath);
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'No downloadable files in this list']);

            return;
        }

        $label = $mid > 0 ? "task-{$cid}-{$mid}" : "conversation-{$cid}";
        $downloadName = 'oaao-materials-' . preg_replace('/[^a-zA-Z0-9_-]+/', '-', $label) . '.zip';

        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $downloadName) . '"');
        header('Content-Length: ' . (string) filesize($zipPath));
        header('Cache-Control: no-store');
        readfile($zipPath);
        @unlink($zipPath);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not build materials archive']);
    }
};
