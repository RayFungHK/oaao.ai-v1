<?php

declare(strict_types=1);

use Razy\Database;

/**
 * PostgreSQL workspace membership — adjunct chat rows scope by {@code workspace_id}.
 */

require_once dirname(__DIR__, 4) . '/core/default/library/WorkspaceMembership.php';

function oaao_chat_user_has_workspace_access(Database $db, int $userId, int $workspaceId): bool
{
    return \Oaaoai\Core\WorkspaceMembership::userHasAccess($db, $userId, $workspaceId);
}
