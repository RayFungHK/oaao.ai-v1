<?php

declare(strict_types=1);

namespace oaaoai\corpus;

use Razy\Database;

/**
 * Vault ACL checks for corpus source references (mirrors vault touch rules).
 */
final class CorpusVaultGuard
{
    public static function userCanTouchVault(
        Database $db,
        int $tenantId,
        int $vaultId,
        int $uid,
        ?int $workspaceId,
    ): bool {
        if ($vaultId < 1 || $uid < 1) {
            return false;
        }

        if ($workspaceId === null) {
            $where = 'id=:vid, workspace_id IS NULL, owner_user_id=:uid';
            $assign = ['vid' => $vaultId, 'uid' => $uid];
            if ($tenantId > 0) {
                $where .= ', tenant_id=:tid';
                $assign['tid'] = $tenantId;
            }
            $r = $db->prepare()
                ->select('1 AS ok')
                ->from('vault')
                ->where($where)
                ->assign($assign)
                ->limit(1)
                ->query()
                ->fetch();

            return \is_array($r);
        }

        $where = 'v.id=?, v.workspace_id=?';
        $assign = [$uid, $vaultId, $workspaceId];
        if ($tenantId > 0) {
            $where .= ', v.tenant_id=?';
            $assign[] = $tenantId;
        }

        $r = $db->prepare()
            ->select('1 AS ok')
            ->from('v.vault-m.workspace_member[?v.workspace_id=m.workspace_id, m.user_id=?]')
            ->where($where)
            ->assign($assign)
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($r);
    }

    public static function containerBelongsToVault(Database $db, int $containerId, int $vaultId): bool
    {
        if ($containerId < 1 || $vaultId < 1) {
            return false;
        }

        $r = $db->prepare()
            ->select('1 AS ok')
            ->from('vault_container')
            ->where('id=:cid, vault_id=:vid')
            ->assign(['cid' => $containerId, 'vid' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($r);
    }

    public static function documentBelongsToVault(Database $db, int $documentId, int $vaultId): bool
    {
        if ($documentId < 1 || $vaultId < 1) {
            return false;
        }

        $r = $db->prepare()
            ->select('1 AS ok')
            ->from('vault_document')
            ->where('id=:did, vault_id=:vid')
            ->assign(['did' => $documentId, 'vid' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($r);
    }

    /**
     * @return array{workspace_id: int|null, owner_user_id: int}|null
     */
    public static function vaultScope(Database $db, int $vaultId, int $tenantId): ?array
    {
        $where = 'id=:vid';
        $assign = ['vid' => $vaultId];
        if ($tenantId > 0) {
            $where .= ', tenant_id=:tid';
            $assign['tid'] = $tenantId;
        }

        $row = $db->prepare()
            ->select('workspace_id, owner_user_id')
            ->from('vault')
            ->where($where)
            ->assign($assign)
            ->limit(1)
            ->query()
            ->fetch();

        if (! \is_array($row)) {
            return null;
        }

        $wid = isset($row['workspace_id']) && $row['workspace_id'] !== null
            ? (int) $row['workspace_id']
            : null;

        return [
            'workspace_id'   => $wid !== null && $wid > 0 ? $wid : null,
            'owner_user_id'  => (int) ($row['owner_user_id'] ?? 0),
        ];
    }
}
