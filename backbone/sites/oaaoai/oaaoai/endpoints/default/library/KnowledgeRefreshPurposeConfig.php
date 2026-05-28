<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * WS-1-S6 — scheduled Knowledge bucket refresh + opt-out (Settings → Knowledge).
 *
 * Stored on {@code knowledge.platform.*} purpose {@code meta_json.knowledge_refresh}.
 *
 * Product rule: **platform admin only** (not tenant-facing); env vars are bootstrap / ops override only
 * ({@see resolveKnowledgeVaultIds}, {@see resolveRefreshUserId}).
 */
final class KnowledgeRefreshPurposeConfig
{
    public const DEFAULT_INTERVAL_HOURS = 168;

    /**
     * Env fallback for first boot before Settings → Knowledge is saved.
     */
    public static function envTenantVaultId(): int
    {
        foreach (['OAAO_KNOWLEDGE_TENANT_VAULT_ID', 'OAAO_KNOWLEDGE_WEB_VAULT_ID'] as $key) {
            $v = (int) (getenv($key) ?: 0);
            if ($v > 0) {
                return $v;
            }
        }

        return 0;
    }

    public static function envPlatformVaultId(): int
    {
        $v = (int) (getenv('OAAO_KNOWLEDGE_PLATFORM_VAULT_ID') ?: 0);

        return $v > 0 ? $v : 0;
    }

    public static function envRefreshUserId(): int
    {
        $v = (int) (getenv('OAAO_KNOWLEDGE_REFRESH_USER_ID') ?: 0);

        return $v > 0 ? $v : 0;
    }

    /**
     * @param array<string, mixed> $refresh From {@see refreshPayloadFromMeta}
     *
     * @return array{tenant_vault_id: int, platform_vault_id: int}
     */
    public static function resolveKnowledgeVaultIds(array $refresh): array
    {
        $tenant = (int) ($refresh['tenant_vault_id'] ?? 0);
        $platform = (int) ($refresh['platform_vault_id'] ?? 0);
        if ($tenant < 1) {
            $tenant = self::envTenantVaultId();
        }
        if ($platform < 1) {
            $platform = self::envPlatformVaultId();
        }

        return [
            'tenant_vault_id'   => $tenant,
            'platform_vault_id' => $platform,
        ];
    }

    public static function resolveRefreshUserId(array $refresh): int
    {
        $uid = (int) ($refresh['refresh_user_id'] ?? 0);

        return $uid > 0 ? $uid : self::envRefreshUserId();
    }

    /**
     * @return array<string, mixed>
     */
    public static function decodePurposeMeta(mixed $metaJson): array
    {
        if (\is_array($metaJson)) {
            return $metaJson;
        }
        if (! \is_string($metaJson) || trim($metaJson) === '') {
            return [];
        }
        try {
            $dec = json_decode(trim($metaJson), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }

        return \is_array($dec) ? $dec : [];
    }

    /**
     * Normalized settings for orchestrator + cron.
     *
     * @param array<string, mixed>|null $meta
     *
     * @return array{
     *   scheduled_enabled: bool,
     *   interval_hours: float,
     *   classify_after: bool,
     *   merge_recall: bool,
     *   do_not_search: list<string>,
     *   tenant_vault_id: int,
     *   platform_vault_id: int,
     *   refresh_user_id: int
     * }
     */
    public static function refreshPayloadFromMeta(?array $meta): array
    {
        $root = ($meta !== null && $meta !== []) ? $meta : [];
        $nested = \is_array($root['knowledge_refresh'] ?? null) ? $root['knowledge_refresh'] : $root;

        $interval = self::clampFloat(
            $nested['interval_hours'] ?? $nested['refresh_interval_hours'] ?? null,
            1.0,
            720.0,
            (float) self::DEFAULT_INTERVAL_HOURS,
        );

        /** @var list<string> $dns */
        $dns = [];
        $rawDns = $nested['do_not_search'] ?? [];
        if (\is_array($rawDns)) {
            foreach ($rawDns as $item) {
                $s = trim((string) $item);
                if ($s !== '' && ! \in_array($s, $dns, true)) {
                    $dns[] = $s;
                }
                if (\count($dns) >= 24) {
                    break;
                }
            }
        }

        $enabled = $nested['scheduled_enabled'] ?? $nested['refresh_enabled'] ?? true;
        if (\is_string($enabled)) {
            $enabled = ! \in_array(strtolower(trim($enabled)), ['0', 'false', 'no', 'off'], true);
        }

        $classify = $nested['classify_after'] ?? true;
        if (\is_string($classify)) {
            $classify = ! \in_array(strtolower(trim($classify)), ['0', 'false', 'no', 'off'], true);
        }

        $mergeRecall = $nested['merge_recall'] ?? true;
        if (\is_string($mergeRecall)) {
            $mergeRecall = ! \in_array(strtolower(trim($mergeRecall)), ['0', 'false', 'no', 'off'], true);
        }

        $tenantVault = self::clampPositiveInt($nested['tenant_vault_id'] ?? $nested['web_vault_id'] ?? null);
        $platformVault = self::clampPositiveInt($nested['platform_vault_id'] ?? null);
        $refreshUser = self::clampPositiveInt($nested['refresh_user_id'] ?? null);

        return [
            'scheduled_enabled' => (bool) $enabled,
            'interval_hours'    => $interval,
            'classify_after'    => (bool) $classify,
            'merge_recall'      => (bool) $mergeRecall,
            'do_not_search'     => $dns,
            'tenant_vault_id'   => $tenantVault > 0 ? $tenantVault : self::envTenantVaultId(),
            'platform_vault_id' => $platformVault > 0 ? $platformVault : self::envPlatformVaultId(),
            'refresh_user_id'   => $refreshUser > 0 ? $refreshUser : self::envRefreshUserId(),
        ];
    }

    /**
     * @return array{
     *   scheduled_enabled: bool,
     *   interval_hours: float,
     *   classify_after: bool,
     *   merge_recall: bool,
     *   do_not_search: list<string>,
     *   tenant_vault_id: int,
     *   platform_vault_id: int,
     *   refresh_user_id: int
     * }
     */
    public static function defaults(): array
    {
        return self::refreshPayloadFromMeta([]);
    }

    private static function clampPositiveInt(mixed $raw): int
    {
        if ($raw === null || $raw === '') {
            return 0;
        }
        if (! is_numeric($raw)) {
            return 0;
        }
        $v = (int) $raw;

        return $v > 0 ? $v : 0;
    }

    /**
     * @param array<string, mixed> $existing
     * @param array<string, mixed> $form
     *
     * @return array<string, mixed>
     */
    public static function mergeRefreshIntoMeta(array $existing, array $form): array
    {
        $existing['knowledge_refresh'] = self::refreshPayloadFromMeta($form);

        return $existing;
    }

    /**
     * @param array<string, mixed> $form
     *
     * @return array<string, mixed>
     */
    public static function metaJsonFromForm(array $form): array
    {
        return ['knowledge_refresh' => self::refreshPayloadFromMeta($form)];
    }

    private static function clampFloat(mixed $raw, float $min, float $max, float $default): float
    {
        if ($raw === null || $raw === '') {
            return $default;
        }
        if (! is_numeric($raw)) {
            return $default;
        }
        $v = (float) $raw;

        return max($min, min($max, $v));
    }
}
