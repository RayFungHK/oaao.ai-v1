<?php

declare(strict_types=1);

namespace oaaoai\vault;

use Razy\Database;

/**
 * Orchestrator vault connection metadata (env-bound secrets only).
 */
final class VaultRetrievalProfiles
{
    /**
     * Build profiles for vault row ids — caller must have already authorized access.
     *
     * @param list<int> $vaultIds
     *
     * @return list<array<string, mixed>>
     */
    public static function fromVaultIds(Database $db, array $vaultIds, callable $inferKeyEnv): array
    {
        /** @var list<int> $clean */
        $clean = [];
        foreach ($vaultIds as $v) {
            $n = \is_int($v) ? $v : (int) $v;
            if ($n > 0) {
                $clean[] = $n;
            }
            if (\count($clean) >= 24) {
                break;
            }
        }
        $clean = array_values(array_unique($clean, SORT_NUMERIC));
        if ($clean === []) {
            return [];
        }

        $rows = $db->prepare()
            ->select(
                'id, scope, workspace_id, owner_user_id, graph_mode, qdrant_url, qdrant_collection, qdrant_api_key_ref, arango_url, arango_database, arango_user_ref, arango_password_ref',
            )
            ->from('vault')
            ->where('id|=:ids')
            ->assign(['ids' => $clean])
            ->order('+id')
            ->query()
            ->fetchAll();

        if (! \is_array($rows)) {
            return [];
        }

        /** @var list<array<string, mixed>> $out */
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $vid = (int) ($row['id'] ?? 0);
            if ($vid < 1) {
                continue;
            }
            $arangoCfg = VaultArangoResolver::resolveEffectiveConfig($row);
            $aUserRef = $arangoCfg['user_ref'] ?? null;
            $aPassRef = $arangoCfg['password_ref'] ?? null;

            $out[] = [
                'vault_id'            => $vid,
                'graph_mode'          => (int) ($row['graph_mode'] ?? 0),
                'qdrant_url'          => self::trimOrNull($row['qdrant_url'] ?? null),
                'qdrant_collection'   => self::trimOrNull(VaultQdrantCollectionResolver::resolveEffectiveCollection($row)),
                'qdrant_api_key_env'  => self::inferOptionalKeyEnv(isset($row['qdrant_api_key_ref']) ? (string) $row['qdrant_api_key_ref'] : null, $inferKeyEnv),
                'arango_url'          => $arangoCfg['url'],
                'arango_database'     => $arangoCfg['database'],
                'arango_user_env'     => self::inferOptionalKeyEnv($aUserRef, $inferKeyEnv),
                'arango_password_env' => self::inferOptionalKeyEnv($aPassRef, $inferKeyEnv),
            ];
        }

        return $out;
    }

    private static function trimOrNull(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        $s = trim((string) $v);

        return $s !== '' ? $s : null;
    }

    private static function inferOptionalKeyEnv(?string $apiKeyRef, callable $inferKeyEnv): ?string
    {
        $t = trim((string) $apiKeyRef);
        if ($t === '') {
            return null;
        }

        return $inferKeyEnv($t);
    }
}
