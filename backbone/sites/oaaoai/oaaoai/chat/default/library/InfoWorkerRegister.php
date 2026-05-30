<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Post-message [info] workers — turn scores, calendar/todo classifiers, future metrics.
 *
 * Modules extend via {@code info_worker.register}; {@see \\Module\\oaao\\endpoints} merges rows
 * before {@link ChatInfoWorker} builds one aggregated payload for the thread UI.
 */
final class InfoWorkerRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $entries = [];

    /**
     * @param array<string, mixed> $extras pill_kind, post_turn_action_ids, meta_keys, module_code, sort, enabled, only_last
     */
    public static function add(string $worker_id, string $label, array $extras = []): void
    {
        $worker_id = strtolower(trim($worker_id));
        if ($worker_id === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $row = [
            'worker_id' => $worker_id,
            'label'     => trim($label),
            'sort'      => $sort,
        ];

        foreach (['pill_kind', 'module_code', 'description'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        if (isset($extras['meta_keys']) && \is_array($extras['meta_keys'])) {
            $keys = [];
            foreach ($extras['meta_keys'] as $k) {
                if (\is_string($k) && trim($k) !== '') {
                    $keys[] = trim($k);
                }
            }
            if ($keys !== []) {
                $row['meta_keys'] = $keys;
            }
        }

        if (isset($extras['post_turn_action_ids']) && \is_array($extras['post_turn_action_ids'])) {
            $ids = [];
            foreach ($extras['post_turn_action_ids'] as $id) {
                if (\is_string($id) && trim($id) !== '') {
                    $ids[] = trim($id);
                }
            }
            if ($ids !== []) {
                $row['post_turn_action_ids'] = $ids;
            }
        }

        if (array_key_exists('enabled', $extras)) {
            $row['enabled'] = ! empty($extras['enabled']);
        } else {
            $row['enabled'] = true;
        }

        if (array_key_exists('only_last', $extras)) {
            $row['only_last'] = ! empty($extras['only_last']);
        }

        self::$entries[$worker_id] = $row;
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
     * @return list<array<string, mixed>>
     */
    public static function enabled(): array
    {
        return array_values(array_filter(
            self::all(),
            static fn (array $row): bool => ! empty($row['enabled']),
        ));
    }
}
