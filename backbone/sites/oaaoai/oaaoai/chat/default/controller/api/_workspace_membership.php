<?php

declare(strict_types=1);

use Oaaoai\Core\WorkspaceMembership;
use Razy\Database;

/**
 * PostgreSQL workspace membership — adjunct chat rows scope by {@code workspace_id}.
 */

function oaao_chat_user_has_workspace_access(Database $db, int $userId, int $workspaceId): bool
{
    return WorkspaceMembership::userHasAccess($db, $userId, $workspaceId);
}
