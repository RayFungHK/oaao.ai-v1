<?php

/**
 * GET /chat/api/resolve_share?slug=&workspace_id= — resolve share_slug for the signed-in owner; workspace_id must match the row.
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

    $slug = trim((string) ($_GET['slug'] ?? ''));
    $wid = $this->oaao_chat_resolve_workspace_id(null);

    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    if ($slug === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'slug required']);

        return;
    }

    try {
        $row = $splitDb->prepare()
            ->select('id, title, workspace_id')
            ->from('conversation')
            ->where('share_slug=?,user_id=?')
            ->assign(['share_slug' => $slug, 'user_id' => $uid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($row) || ! isset($row['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Link invalid or not yours']);

            return;
        }

        $rowWid = isset($row['workspace_id']) ? $row['workspace_id'] : null;
        $rowWid = ($rowWid === null || $rowWid === '') ? null : $rowWid;
        $actual = null;
        if ($rowWid !== null && is_numeric($rowWid)) {
            $ri = (int) $rowWid;
            $actual = $ri > 0 ? $ri : null;
        }
        $expect = $wid;
        if ($expect !== $actual) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Link invalid for this workspace scope']);

            return;
        }

        echo json_encode([
            'success'          => true,
            'conversation_id'  => (int) $row['id'],
            'title'            => (string) ($row['title'] ?? ''),
        ]);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Resolve failed']);
    }
};
