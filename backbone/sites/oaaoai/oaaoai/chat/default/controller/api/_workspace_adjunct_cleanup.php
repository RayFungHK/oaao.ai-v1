<?php

declare(strict_types=1);

/**
 * Purge adjunct SQLite chat threads scoped to a workspace_id (messages then conversations).
 */
function oaao_chat_adjunct_purge_workspace_threads(\PDO $adjunctPdo, int $workspaceId): void
{
    if ($workspaceId < 1) {
        return;
    }

    $adjunctPdo->beginTransaction();

    try {
        $delMsg = $adjunctPdo->prepare(
            'DELETE FROM oaao_message WHERE conversation_id IN (SELECT id FROM oaao_conversation WHERE workspace_id = ?)',
        );
        $delMsg->execute([$workspaceId]);
        $delConv = $adjunctPdo->prepare('DELETE FROM oaao_conversation WHERE workspace_id = ?');
        $delConv->execute([$workspaceId]);
        $adjunctPdo->commit();
    } catch (\Throwable $e) {
        if ($adjunctPdo->inTransaction()) {
            $adjunctPdo->rollBack();
        }
        throw $e;
    }
}
