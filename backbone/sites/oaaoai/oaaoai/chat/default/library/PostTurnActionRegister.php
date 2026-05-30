<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Post-turn action hooks — finalize-stage async workers (Calendar, Todo, …).
 *
 * Modules extend via {@code post_turn_action.register}; {@see \\Module\\oaao\\endpoints} merges rows
 * into this registry before PHP send forwards {@code post_turn_actions[]} to the orchestrator.
 *
 * Each row drives one background classifier after {@code system/end} (same lifecycle as IQS/ACCS).
 * On completion the worker attaches JSON actions to assistant {@code meta_json} and may emit a
 * late SSE status when the stream session is still open.
 */
final class PostTurnActionRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $entries = [];

    /**
     * @param array<string, mixed> $extras sort, module_code, purpose_key_prefix, template_ref,
     *                                   sse_event, planner_hint, min_confidence, enabled
     */
    public static function add(string $action_id, string $label, array $extras = []): void
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
            'label'     => trim($label),
            'sort'      => $sort,
        ];

        foreach (
            [
                'module_code',
                'purpose_key_prefix',
                'template_ref',
                'sse_event',
                'planner_hint',
                'description',
                'i18n_label_key',
            ] as $ik
        ) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        if (isset($extras['min_confidence']) && is_numeric($extras['min_confidence'])) {
            $row['min_confidence'] = (float) $extras['min_confidence'];
        }

        if (array_key_exists('enabled', $extras)) {
            $row['enabled'] = ! empty($extras['enabled']);
        } else {
            $row['enabled'] = true;
        }

        self::$entries[$action_id] = $row;
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

    /**
     * Enabled rows only — forwarded on chat run bootstrap.
     *
     * @return list<array<string, mixed>>
     */
    public static function forOrchestrator(): array
    {
        return array_values(array_filter(
            self::all(),
            static fn (array $row): bool => ! empty($row['enabled']),
        ));
    }
}
