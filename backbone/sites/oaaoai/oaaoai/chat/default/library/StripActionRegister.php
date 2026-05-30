<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Strip confirm dispatch registry — modules register via {@code strip_action.register}.
 *
 * @see docs/design/strip-chip-shell.md
 */
final class StripActionRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $entries = [];

    /**
     * @param array<string, mixed> $extras agent_kind, confirmation_default, confirm_api, module_code, sort
     */
    public static function add(string $action_id, array $extras = []): void
    {
        $action_id = strtolower(trim($action_id));
        if ($action_id === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $row = [
            'action_id' => $action_id,
            'sort'      => $sort,
        ];

        foreach (['agent_kind', 'confirm_api', 'module_code'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        if (array_key_exists('confirmation_default', $extras)) {
            $row['confirmation_default'] = ! empty($extras['confirmation_default']);
        }

        self::$entries[$action_id] = $row;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function get(string $action_id): ?array
    {
        $action_id = strtolower(trim($action_id));

        return self::$entries[$action_id] ?? null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function all(): array
    {
        $rows = array_values(self::$entries);
        usort(
            $rows,
            static fn (array $a, array $b): int => ((int) ($a['sort'] ?? 500)) <=> ((int) ($b['sort'] ?? 500)),
        );

        return $rows;
    }
}
