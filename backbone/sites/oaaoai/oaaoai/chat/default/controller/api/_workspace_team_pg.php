<?php

declare(strict_types=1);

/**
 * PostgreSQL ACL helpers for workspace team management (memberships + invitations).
 */

use Razy\Database;

function oaao_chat_workspace_normalize_email(string $email): string
{
    return strtolower(trim($email));
}

/**
 * @return string|null role {@code owner}|{@code member} or null when not a member
 */
function oaao_chat_workspace_member_role(Database $db, int $userId, int $workspaceId): ?string
{
    if ($userId < 1 || $workspaceId < 1) {
        return null;
    }

    try {
        /** @var array<string, mixed>|false $row */
        $row = $db->prepare()
            ->select('m.role')
            ->from('m.workspace_member-w.workspace[?w.workspace_id=m.workspace_id]')
            ->where('m.workspace_id=:wid, m.user_id=:uid, w.disabled=0')
            ->assign(['wid' => $workspaceId, 'uid' => $userId])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($row)) {
            return null;
        }
        $r = $row['role'] ?? null;

        return \is_string($r) && $r !== '' ? $r : null;
    } catch (\Throwable) {
        return null;
    }
}

function oaao_chat_workspace_is_owner(Database $db, int $userId, int $workspaceId): bool
{
    return oaao_chat_workspace_member_role($db, $userId, $workspaceId) === 'owner';
}
