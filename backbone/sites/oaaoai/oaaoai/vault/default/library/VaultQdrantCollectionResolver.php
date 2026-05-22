<?php

declare(strict_types=1);

namespace oaaoai\vault;

require_once dirname(__DIR__, 3) . '/core/default/library/TenantHostResolver.php';
require_once dirname(__DIR__, 3) . '/core/default/library/TenantContext.php';

use Oaaoai\Core\TenantContext;
use Oaaoai\Core\TenantHostResolver;

/**
 * Derives stable Qdrant collection names from tenant + vault scope buckets.
 *
 * Resolution order:
 * 1. Non-empty {@code oaao_vault.qdrant_collection} — per-vault override (legacy / ops).
 * 2. Tenant slug ({@see TenantHostResolver} — Razy {@code sites.inc.php} domain/alias, optional {@code OAAO_TENANT_SLUG}) + scope bucket:
 *    - {@code scope} {@code tenant}|{@code global} with no workspace → {@code {slug}_global}
 *    - Workspace vault ({@code workspace_id} &gt; 0) → {@code {slug}_ws_{workspace_id}}
 *    - Personal vault → {@code {slug}_personal_u_{owner_user_id}}
 * 3. Fallback → {@code {slug}_vault_{vault_id}} (still unique; payloads filter by {@code vault_id}).
 *
 * Multiple vault rows may share one collection within the same bucket; orchestrator payloads must
 * retain {@code vault_id} on points for retrieval filters.
 */
final class VaultQdrantCollectionResolver
{
    /**
     * @param array<string, mixed> $vaultRow Must include {@code id}; may include {@code scope}, {@code workspace_id}, {@code owner_user_id}, {@code qdrant_collection}.
     */
    public static function resolveEffectiveCollection(array $vaultRow): ?string
    {
        $explicit = isset($vaultRow['qdrant_collection']) ? trim((string) $vaultRow['qdrant_collection']) : '';
        if ($explicit !== '') {
            return self::sanitizeFullCollectionName($explicit);
        }

        $vaultId = isset($vaultRow['id']) ? (int) $vaultRow['id'] : 0;
        if ($vaultId < 1) {
            return null;
        }

        $tenant = self::tenantSlug();
        $scope = strtolower(trim((string) ($vaultRow['scope'] ?? '')));
        $wid = isset($vaultRow['workspace_id']) && $vaultRow['workspace_id'] !== null && $vaultRow['workspace_id'] !== ''
            ? (int) $vaultRow['workspace_id']
            : null;
        $owner = isset($vaultRow['owner_user_id']) && $vaultRow['owner_user_id'] !== null && $vaultRow['owner_user_id'] !== ''
            ? (int) $vaultRow['owner_user_id']
            : null;

        if (($scope === 'global' || $scope === 'tenant') && ($wid === null || $wid < 1)) {
            return self::sanitizeFullCollectionName($tenant . '_global');
        }

        if ($wid !== null && $wid > 0) {
            return self::sanitizeFullCollectionName($tenant . '_ws_' . $wid);
        }

        if (($wid === null || $wid < 1) && $owner !== null && $owner > 0) {
            return self::sanitizeFullCollectionName($tenant . '_personal_u_' . $owner);
        }

        return self::sanitizeFullCollectionName($tenant . '_vault_' . $vaultId);
    }

    public static function tenantSlug(): string
    {
        return TenantHostResolver::tenantSlug(null);
    }

    private static function sanitizeSegment(string $raw): string
    {
        $s = strtolower((string) preg_replace('/[^a-z0-9]+/', '_', $raw));
        $s = trim($s, '_');

        return $s !== '' ? substr($s, 0, 48) : 't';
    }

    private static function sanitizeFullCollectionName(string $name): string
    {
        $t = strtolower(trim($name));
        $t = (string) preg_replace('/[^a-z0-9_\-]/', '_', $t);
        $t = trim((string) preg_replace('/_+/', '_', $t), '_');

        return substr($t !== '' ? $t : 'oaao_vectors', 0, 200);
    }
}
