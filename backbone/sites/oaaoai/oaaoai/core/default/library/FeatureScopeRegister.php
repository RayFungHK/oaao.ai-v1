<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * Feature capability registry — which **isolation scopes** a logical feature supports.
 *
 * ## Platform model (routing / policy is implemented elsewhere)
 *
 * - **Tenant** resolves from host binding (apex domain or subdomain → tenant id). Tenant carries policy such as
 *   **public signup** vs **private (admin-provisioned accounts)**.
 * - **Workspace** is an isolated environment under a tenant (own conversations vault/RAG surface, invites, roles such as owner).
 * - **Personal** is user-global scope **without** an active workspace — personal pipelines still belong to the tenant’s identity
 *   partition but skip workspace-bound storage.
 *
 * Modules advertise scopes via {@code $this->api('core')->registerFeatureScope(...)} so shells and orchestrator pipelines can branch UI and routing
 * without hard-coding module lists.
 *
 * {@see SettingsRegister} remains **tenant-administrator** configuration panels; {@see PreferencesRegister} lists **user preference**
 * dialog panels. This registry is **capability metadata** (safe to embed for any signed-in shell — no secrets).
 *
 * Included from {@see core.php} when the core module controller loads (before passive listeners).
 */
final class FeatureScopeRegister
{
    public const LEVEL_TENANT = 'tenant';

    public const LEVEL_WORKSPACE = 'workspace';

    public const LEVEL_PERSONAL = 'personal';

    /** @var array<string, array<string, mixed>> keyed by {@code feature_id} */
    private static array $features = [];

    /** @return list<string> */
    private static function canonicalOrder(): array
    {
        return [self::LEVEL_TENANT, self::LEVEL_WORKSPACE, self::LEVEL_PERSONAL];
    }

    /**
     * @param list<mixed> $raw
     *
     * @return list<string>
     */
    private static function normalizeLevels(array $raw): array
    {
        $allowed = self::canonicalOrder();
        $flip = array_flip($allowed);
        $seen = [];
        foreach ($raw as $x) {
            if (! is_string($x)) {
                continue;
            }
            $v = strtolower(trim($x));
            if (isset($flip[$v])) {
                $seen[$v] = true;
            }
        }
        $out = [];
        foreach ($allowed as $v) {
            if (isset($seen[$v])) {
                $out[] = $v;
            }
        }

        return $out;
    }

    /**
     * Duplicate {@code feature_id}: union {@code levels}, keep minimum {@code sort}; prefer newest non-empty label/description fields.
     *
     * @param list<mixed> $levels
     */
    public static function add(string $feature_id, string $label, string $description = '', array $levels = [], int $sort = 500): void
    {
        $feature_id = trim($feature_id);
        if ($feature_id === '') {
            return;
        }

        $levels = self::normalizeLevels($levels);

        if (! isset(self::$features[$feature_id])) {
            self::$features[$feature_id] = [
                'feature_id'  => $feature_id,
                'label'       => $label !== '' ? $label : $feature_id,
                'description' => $description,
                'levels'      => $levels,
                'sort'        => $sort,
            ];

            return;
        }

        $existing = self::$features[$feature_id];
        /** @var list<string> $merged */
        $merged = self::normalizeLevels(array_merge($existing['levels'] ?? [], $levels));

        self::$features[$feature_id] = [
            'feature_id'  => $feature_id,
            'label'       => $label !== '' ? $label : (string) ($existing['label'] ?? $feature_id),
            'description' => $description !== '' ? $description : (string) ($existing['description'] ?? ''),
            'levels'      => $merged,
            'sort'        => min((int) ($existing['sort'] ?? 500), $sort),
        ];
    }

    /**
     * Stable ordering for JSON embedding + pipeline iteration.
     *
     * @return list<array{feature_id: string, label: string, description: string, levels: list<string>, sort: int}>
     */
    public static function allSorted(): array
    {
        $rows = array_values(self::$features);
        usort(
            $rows,
            static function (array $a, array $b): int {
                $sa = (int) ($a['sort'] ?? 500);
                $sb = (int) ($b['sort'] ?? 500);
                if ($sa !== $sb) {
                    return $sa <=> $sb;
                }

                return strcmp((string) ($a['feature_id'] ?? ''), (string) ($b['feature_id'] ?? ''));
            }
        );

        return $rows;
    }
}
