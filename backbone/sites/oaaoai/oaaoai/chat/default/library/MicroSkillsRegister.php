<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Micro skill providers — modules register via {@code micro_skill_provider.register}.
 *
 * Kinds (orchestrator {@see SkillKind}):
 * - {@code bound_template} — PPTX template; {@code bind_ref} = template_id (required)
 * - {@code conversation} — user/workspace saved skills (adjunct DB)
 * - future kinds via new providers
 */
final class MicroSkillsRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $providers = [];

    /**
     * @param array<string, mixed> $extras sort, module_code, description, i18n_*_key
     */
    public static function addProvider(
        string $providerId,
        string $kind,
        string $label,
        array $extras = [],
    ): void {
        $providerId = trim($providerId);
        $kind = trim($kind);
        if ($providerId === '' || $kind === '') {
            return;
        }
        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }
        self::$providers[$providerId] = [
            'provider_id' => $providerId,
            'kind'        => $kind,
            'label'       => trim($label),
            'description' => trim((string) ($extras['description'] ?? '')),
            'sort'        => $sort,
            'module_code' => trim((string) ($extras['module_code'] ?? '')),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function allSorted(): array
    {
        $values = array_values(self::$providers);
        usort($values, static fn (array $a, array $b): int => ($a['sort'] ?? 500) <=> ($b['sort'] ?? 500));

        return $values;
    }

    /**
     * @return list<string>
     */
    public static function kinds(): array
    {
        $k = [];
        foreach (self::$providers as $row) {
            $kind = trim((string) ($row['kind'] ?? ''));
            if ($kind !== '') {
                $k[$kind] = true;
            }
        }

        return array_keys($k);
    }
}
