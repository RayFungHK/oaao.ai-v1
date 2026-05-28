<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

use Oaaoai\Core\TenantRepository;
use Razy\Database;

/**
 * Auto-provision platform Knowledge vault + persist id on knowledge.platform purpose meta.
 */
final class KnowledgePlatformVaultProvisioner
{
    public const VAULT_NAME = 'OAAO Knowledge';

    public const VAULT_DESCRIPTION = 'EPIC-WS-1 platform evolution bucket (auto-provisioned)';

    /**
     * @return array{ok: bool, vault_id: int, created: bool, owner_user_id: int, platform_tenant_id: int, message?: string}
     */
    public static function ensure(Database $db, ?CanonicalEndpointsRepository $repo = null): array
    {
        $pdo = $db->getDBAdapter();
        if (! $pdo instanceof \PDO || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
            return [
                'ok'                  => false,
                'vault_id'            => 0,
                'created'             => false,
                'owner_user_id'       => 0,
                'platform_tenant_id'  => 0,
                'message'             => 'PostgreSQL canonical required',
            ];
        }

        require_once dirname(__DIR__, 3) . '/auth/default/controller/api/_ensure_pg_core_tables.php';
        oaao_auth_ensure_pg_core_tables($db);

        $platformTenant = self::resolvePlatformTenant($pdo);
        if ($platformTenant === null) {
            return [
                'ok'                  => false,
                'vault_id'            => 0,
                'created'             => false,
                'owner_user_id'       => 0,
                'platform_tenant_id'  => 0,
                'message'             => 'platform tenant row missing',
            ];
        }

        $platformTid = (int) ($platformTenant['tenant_id'] ?? 0);
        $ownerUid = self::resolveOwnerUserId($pdo, $platformTid, $repo);
        if ($ownerUid < 1) {
            return [
                'ok'                  => false,
                'vault_id'            => 0,
                'created'             => false,
                'owner_user_id'       => 0,
                'platform_tenant_id'  => $platformTid,
                'message'             => 'no service user — set refresh_user_id in Platform → Knowledge or OAAO_KNOWLEDGE_REFRESH_USER_ID',
            ];
        }

        $existing = self::findPlatformVault($db, $platformTid);
        $created = false;
        $vaultId = $existing;
        if ($vaultId < 1) {
            $vaultId = self::insertPlatformVault($db, $platformTid, $ownerUid);
            $created = $vaultId > 0;
        }

        if ($vaultId > 0 && $repo instanceof CanonicalEndpointsRepository) {
            self::persistVaultIdOnPurpose($db, $repo, $vaultId, $ownerUid);
        }

        return [
            'ok'                 => $vaultId > 0,
            'vault_id'           => $vaultId,
            'created'            => $created,
            'owner_user_id'      => $ownerUid,
            'platform_tenant_id' => $platformTid,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function resolvePlatformTenant(\PDO $pdo): ?array
    {
        $envId = (int) (getenv('OAAO_PLATFORM_TENANT_ID') ?: 0);
        if ($envId > 0) {
            return TenantRepository::resolveById($pdo, $envId);
        }

        try {
            $st = $pdo->query(
                "SELECT tenant_id, slug, display_name, kind, signup_mode, status
                 FROM oaao_tenant WHERE kind = 'platform' AND status = 'active'
                 ORDER BY tenant_id ASC LIMIT 1",
            );
            /** @var array<string, mixed>|false $row */
            $row = $st ? $st->fetch(\PDO::FETCH_ASSOC) : false;

            return $row !== false ? $row : null;
        } catch (\Throwable) {
            return null;
        }
    }

    private static function findPlatformVault(Database $db, int $platformTenantId): int
    {
        $row = $db->prepare()
            ->select('id')
            ->from('vault')
            ->where('tenant_id=?,workspace_id IS NULL,name=?')
            ->assign(['tenant_id' => $platformTenantId, 'name' => self::VAULT_NAME])
            ->order('+id')
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) && isset($row['id']) ? (int) $row['id'] : 0;
    }

    private static function insertPlatformVault(Database $db, int $platformTenantId, int $ownerUid): int
    {
        $ts = gmdate('Y-m-d H:i:s');
        $db->insert('vault', [
            'name',
            'scope',
            'workspace_id',
            'owner_user_id',
            'description',
            'tenant_id',
            'created_by',
            'created_at',
            'updated_at',
            'is_enabled',
        ])->assign([
            'name'           => self::VAULT_NAME,
            'scope'          => 'personal',
            'workspace_id'   => null,
            'owner_user_id'  => $ownerUid,
            'description'    => self::VAULT_DESCRIPTION,
            'tenant_id'      => $platformTenantId,
            'created_by'     => $ownerUid,
            'created_at'     => $ts,
            'updated_at'     => $ts,
            'is_enabled'     => 1,
        ])->query();

        return $db->lastID();
    }

    private static function resolveOwnerUserId(
        \PDO $pdo,
        int $platformTenantId,
        ?CanonicalEndpointsRepository $repo,
    ): int {
        if ($repo instanceof CanonicalEndpointsRepository) {
            $refresh = $repo->resolveKnowledgeRefreshConfig();
            $uid = KnowledgeRefreshPurposeConfig::resolveRefreshUserId($refresh);
            if ($uid > 0) {
                return $uid;
            }
        }

        $envUid = KnowledgeRefreshPurposeConfig::envRefreshUserId();
        if ($envUid > 0) {
            return $envUid;
        }

        try {
            $st = $pdo->prepare(
                "SELECT user_id FROM oaao_user
                 WHERE tenant_id = ? AND role = 'platform_admin' AND disabled = 0
                 ORDER BY user_id ASC LIMIT 1",
            );
            $st->execute([$platformTenantId]);
            $row = $st->fetch(\PDO::FETCH_ASSOC);
            if (\is_array($row) && isset($row['user_id'])) {
                return (int) $row['user_id'];
            }
        } catch (\Throwable) {
        }

        return 0;
    }

    public static function persistVaultIdOnPurpose(
        Database $db,
        CanonicalEndpointsRepository $repo,
        int $vaultId,
        int $ownerUserId,
    ): void {
        if ($vaultId < 1) {
            return;
        }
        $row = $repo->findKnowledgePlatformPurposeRowForSettings();
        if ($row === null) {
            return;
        }
        $purposeId = (int) ($row['id'] ?? 0);
        if ($purposeId < 1) {
            return;
        }

        $existing = KnowledgeRefreshPurposeConfig::decodePurposeMeta($row['meta_json'] ?? null);
        $refresh = KnowledgeRefreshPurposeConfig::refreshPayloadFromMeta($existing);
        if ((int) ($refresh['platform_vault_id'] ?? 0) === $vaultId
            && (int) ($refresh['refresh_user_id'] ?? 0) === $ownerUserId) {
            return;
        }

        $refresh['platform_vault_id'] = $vaultId;
        if ($ownerUserId > 0 && (int) ($refresh['refresh_user_id'] ?? 0) < 1) {
            $refresh['refresh_user_id'] = $ownerUserId;
        }
        $merged = KnowledgeRefreshPurposeConfig::mergeRefreshIntoMeta($existing, $refresh);

        try {
            $metaJson = json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return;
        }

        $db->update('purpose', ['meta_json', 'updated_at'])
            ->assign(['meta_json' => $metaJson, 'updated_at' => gmdate('Y-m-d H:i:s')])
            ->where('id=?')
            ->query(['id' => $purposeId]);
    }
}
