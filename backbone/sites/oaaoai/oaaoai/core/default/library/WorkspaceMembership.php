<?php

declare(strict_types=1);

namespace Oaaoai\Core;

use Razy\Database;

/**
 * PostgreSQL workspace membership checks — shared by chat, vault, live-meeting, etc.
 *
 * Lives in core so modules can gate {@code workspace_id} scope without peer {@code require_once} of {@code chat/}.
 */
final class WorkspaceMembership
{
    public static function userHasAccess(Database $db, int $userId, int $workspaceId): bool
    {
        if ($userId < 1 || $workspaceId < 1) {
            return false;
        }

        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            try {
                $st = $pdo->prepare(
                    'SELECT 1
                     FROM oaao_workspace w
                     INNER JOIN oaao_workspace_member m ON m.workspace_id = w.workspace_id
                     WHERE w.workspace_id = ? AND m.user_id = ? AND w.disabled = 0
                     LIMIT 1',
                );
                $st->execute([$workspaceId, $userId]);

                return (bool) $st->fetchColumn();
            } catch (\Throwable) {
                return false;
            }
        }

        try {
            $r = $db->prepare()
                ->select('1 AS ok')
                ->from('w.workspace-m.workspace_member[?w.workspace_id=m.workspace_id, m.user_id=:uid]')
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
}
