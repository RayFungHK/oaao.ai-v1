<?php

declare(strict_types=1);

use Razy\Database;

/**
 * PostgreSQL workspace membership — adjunct chat rows scope by {@code workspace_id}.
 */

function oaao_chat_user_has_workspace_access(Database $db, int $userId, int $workspaceId): bool
{
    if ($userId < 1 || $workspaceId < 1) {
        return false;
    }

    try {
        $r = $db->prepare()
            ->select('1 AS ok')
            ->from('w.workspace-m.workspace_member[?w.workspace_id=m.workspace_id AND m.user_id=:uid]')
            ->where('w.workspace_id=:wid, w.disabled=:dz')
            ->assign(['uid' => $userId, 'wid' => $workspaceId, 'dz' => 0])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($r) && isset($r['ok']);
    } catch (\Throwable) {
        return false;
    }
}
