<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Personal vs workspace chat threads — {@code workspace_id IS NULL} for personal scope.
 */
final class ChatConversationScope
{
    public static function normalizeWorkspaceId(mixed $raw): ?int
    {
        if ($raw === null || $raw === '' || $raw === false) {
            return null;
        }
        if (! is_numeric($raw)) {
            return null;
        }
        $n = (int) $raw;

        return $n > 0 ? $n : null;
    }

    public static function matchesScope(?int $conversationWorkspaceId, ?int $scopeWorkspaceId): bool
    {
        $convWid = self::normalizeWorkspaceId($conversationWorkspaceId);
        $scopeWid = self::normalizeWorkspaceId($scopeWorkspaceId);
        if ($scopeWid === null) {
            return $convWid === null;
        }

        return $convWid === $scopeWid;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function findForUser(
        \Razy\Database $splitDb,
        int $uid,
        int $cid,
        ?int $scopeWorkspaceId,
        string $select = 'id',
    ): ?array {
        if ($uid < 1 || $cid < 1) {
            return null;
        }
        $row = $splitDb->prepare()
            ->select($select)
            ->from('conversation')
            ->where('id=?,user_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($row)) {
            return null;
        }
        if (! self::matchesScope(self::normalizeWorkspaceId($row['workspace_id'] ?? null), $scopeWorkspaceId)) {
            return null;
        }

        return $row;
    }

    /**
     * Lookup by id for the signed-in user — ignores active workspace scope (URL restore / deep links).
     *
     * @return array<string, mixed>|null
     */
    public static function findOwnedByUser(
        \Razy\Database $splitDb,
        int $uid,
        int $cid,
        string $select = 'id, title, workspace_id, created_at, updated_at, archived, params_json',
    ): ?array {
        if ($uid < 1 || $cid < 1) {
            return null;
        }
        $row = $splitDb->prepare()
            ->select($select)
            ->from('conversation')
            ->where('id=?,user_id=?')
            ->assign(['id' => $cid, 'user_id' => $uid])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function listForUser(
        \Razy\Database $splitDb,
        int $uid,
        ?int $scopeWorkspaceId,
        bool $includeArchived,
        int $limit = 200,
    ): array {
        if ($uid < 1) {
            return [];
        }
        $prep = $splitDb->prepare()
            ->select('id, title, workspace_id, created_at, updated_at, archived, params_json')
            ->from('conversation');
        $scopeWid = self::normalizeWorkspaceId($scopeWorkspaceId);
        if ($scopeWid === null) {
            if ($includeArchived) {
                $prep->where('user_id=?,workspace_id IS NULL')
                    ->assign(['user_id' => $uid]);
            } else {
                $prep->where('user_id=?,workspace_id IS NULL,archived=?')
                    ->assign(['user_id' => $uid, 'archived' => 0]);
            }
        } elseif ($includeArchived) {
            $prep->where('user_id=?,workspace_id=?')
                ->assign(['user_id' => $uid, 'workspace_id' => $scopeWid]);
        } else {
            $prep->where('user_id=?,workspace_id=?,archived=?')
                ->assign(['user_id' => $uid, 'workspace_id' => $scopeWid, 'archived' => 0]);
        }
        $raw = $prep->order('>updated_at,>created_at')->limit($limit)->query()->fetchAll();

        return \is_array($raw) ? $raw : [];
    }
}
