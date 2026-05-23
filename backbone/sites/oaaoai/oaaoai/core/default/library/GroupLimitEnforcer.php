<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * Resolve permission-group quotas for a user and enforce vault / workspace caps.
 *
 * Lives in core so chat/vault modules can enforce limits without peer {@code require_once} of {@code group/}.
 * Admin CRUD for groups remains in {@code oaaoai/group}; stored {@code limits_json} keys must stay aligned.
 */
final class GroupLimitEnforcer
{
    /** @return array<string, int|null> */
    public static function defaultLimits(): array
    {
        return [
            'workspace_max'      => null,
            'vault_max'          => null,
            'vault_files_max'    => null,
            'storage_bytes_max'  => null,
        ];
    }

    /** @return array<string, int|null> */
    public static function parseLimits(?string $json): array
    {
        $out = self::defaultLimits();
        if ($json === null || trim($json) === '') {
            return $out;
        }
        try {
            /** @var array<string, mixed> $dec */
            $dec = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $out;
        }
        foreach ($out as $k => $_) {
            if (! \array_key_exists($k, $dec)) {
                continue;
            }
            $v = $dec[$k];
            if ($v === null || $v === '') {
                $out[$k] = null;
                continue;
            }
            $out[$k] = max(0, (int) $v);
        }

        return $out;
    }

    /** @return array<string, int|null> */
    public static function limitsForUser(\PDO $pdo, int $userId): array
    {
        if ($userId < 1) {
            return self::defaultLimits();
        }

        try {
            $st = $pdo->prepare(
                'SELECT g.limits_json
                 FROM oaao_user u
                 LEFT JOIN oaao_group g ON g.id = u.permission_group_id AND g.disabled = 0
                 WHERE u.user_id = ?
                 LIMIT 1',
            );
            $st->execute([$userId]);
            $raw = $st->fetchColumn();

            return self::parseLimits(\is_string($raw) ? $raw : null);
        } catch (\Throwable) {
            return self::defaultLimits();
        }
    }

    /**
     * @param array<string, int|null> $limits
     */
    public static function denyIfOverLimit(array $limits, string $key, int $current, int $delta = 1): ?string
    {
        if (! \array_key_exists($key, $limits)) {
            return null;
        }
        $max = $limits[$key];
        if ($max === null) {
            return null;
        }
        if ($current + $delta > $max) {
            return match ($key) {
                'workspace_max'     => 'Workspace limit reached for your permission group.',
                'vault_max'         => 'Vault creation limit reached for your permission group.',
                'vault_files_max'   => 'Vault file count limit reached for your permission group.',
                'storage_bytes_max' => 'Vault storage limit reached for your permission group.',
                default             => 'Resource limit reached for your permission group.',
            };
        }

        return null;
    }

    public static function countOwnedWorkspaces(\PDO $pdo, int $userId): int
    {
        if ($userId < 1) {
            return 0;
        }
        try {
            $st = $pdo->prepare(
                'SELECT COUNT(*) FROM oaao_workspace_member WHERE user_id = ? AND role = \'owner\'',
            );
            $st->execute([$userId]);

            return max(0, (int) $st->fetchColumn());
        } catch (\Throwable) {
            return 0;
        }
    }

    public static function countOwnedVaults(\PDO $pdo, int $userId): int
    {
        if ($userId < 1) {
            return 0;
        }
        try {
            $st = $pdo->prepare(
                'SELECT COUNT(*) FROM oaao_vault WHERE owner_user_id = ?',
            );
            $st->execute([$userId]);

            return max(0, (int) $st->fetchColumn());
        } catch (\Throwable) {
            return 0;
        }
    }

    public static function countVaultDocuments(\PDO $pdo, int $userId): int
    {
        if ($userId < 1) {
            return 0;
        }
        try {
            $st = $pdo->prepare(
                'SELECT COUNT(*)
                 FROM oaao_vault_document d
                 INNER JOIN oaao_vault v ON v.vault_id = d.vault_id
                 WHERE v.owner_user_id = ?',
            );
            $st->execute([$userId]);

            return max(0, (int) $st->fetchColumn());
        } catch (\Throwable) {
            return 0;
        }
    }

    public static function sumVaultStorageBytes(\PDO $pdo, int $userId): int
    {
        if ($userId < 1) {
            return 0;
        }
        try {
            $st = $pdo->prepare(
                'SELECT COALESCE(SUM(COALESCE(d.byte_size, 0)), 0)::bigint
                 FROM oaao_vault_document d
                 INNER JOIN oaao_vault v ON v.vault_id = d.vault_id
                 WHERE v.owner_user_id = ?',
            );
            $st->execute([$userId]);

            return max(0, (int) $st->fetchColumn());
        } catch (\Throwable) {
            return 0;
        }
    }

    /**
     * @param array<string, int|null> $limits
     */
    public static function assertCanCreateWorkspace(\PDO $pdo, int $userId, array $limits): ?string
    {
        return self::denyIfOverLimit($limits, 'workspace_max', self::countOwnedWorkspaces($pdo, $userId));
    }

    /**
     * @param array<string, int|null> $limits
     */
    public static function assertCanCreateVault(\PDO $pdo, int $userId, array $limits): ?string
    {
        return self::denyIfOverLimit($limits, 'vault_max', self::countOwnedVaults($pdo, $userId));
    }

    /**
     * @param array<string, int|null> $limits
     */
    public static function assertCanUploadDocument(\PDO $pdo, int $userId, array $limits, int $uploadBytes): ?string
    {
        $filesMsg = self::denyIfOverLimit($limits, 'vault_files_max', self::countVaultDocuments($pdo, $userId));
        if ($filesMsg !== null) {
            return $filesMsg;
        }

        return self::denyIfOverLimit(
            $limits,
            'storage_bytes_max',
            self::sumVaultStorageBytes($pdo, $userId),
            max(0, $uploadBytes),
        );
    }
}
