<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Registry for multimodal task kinds (Lance-style) — consumed by Settings and planner agents.
 */
final class MediaCapabilityRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $entries = [];

    /**
     * @param array<string, mixed> $extras sort, mm_axis, module_code, i18n_*_key, lance_task
     */
    public static function add(string $taskId, string $label, string $description, array $extras = []): void
    {
        $taskId = strtolower(trim($taskId));
        if ($taskId === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $row = [
            'task_id'     => $taskId,
            'label'       => trim($label),
            'description' => trim($description),
            'sort'        => $sort,
        ];

        foreach (['mm_axis', 'module_code', 'lance_task', 'i18n_label_key', 'i18n_desc_key'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        self::$entries[$taskId] = $row;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function allSorted(): array
    {
        $values = array_values(self::$entries);
        usort($values, static fn (array $a, array $b): int => ($a['sort'] ?? 500) <=> ($b['sort'] ?? 500));

        return $values;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function forAxis(string $axis): array
    {
        $axis = MmPurposeConfig::normalizeAxis($axis);

        return array_values(array_filter(
            self::allSorted(),
            static fn (array $row): bool => MmPurposeConfig::normalizeAxis((string) ($row['mm_axis'] ?? '')) === $axis,
        ));
    }
}
