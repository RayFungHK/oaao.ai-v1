<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Frozen registry for Chat pipeline UI — block presenters, step rail templates, orchestrator hints.
 *
 * Modules extend via {@code chat_pipeline.register} (namespaced events); {@see \\Module\\oaao\\chat} listens and merges rows.
 * Embedded into {@code index.tpl} as JSON ({@see core.main.php}) for progressive enhancement / dynamic loaders.
 *
 * {@code kind}: {@code message_block}, {@code step_rail}, {@code composer_slot}, {@code activity_line_template}, … (product vocabulary).
 *
 * Composer slots ({@code kind: composer_slot}) accept optional {@code composer_zone} in {@code extras}:
 * {@code composer_left} (default), {@code composer_actions} (right cluster before attach/send), {@code composer_extra_toolbar}
 * (gray strip below the composer card — shell shows it only when at least one slot mounts into that zone).
 *
 * Message blocks ({@code kind: message_block}) accept optional {@code message_zone}: {@code before} (default, inside pipeline chrome) or {@code after} (below assistant bubble).
 */
final class ChatPipelineRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $entries = [];

    /** @param array<string, mixed> $extras sort, module_code, block_type, esm_url, description, i18n_label_key, composer_zone (composer_slot only), message_zone (message_block only: before | after) */
    public static function add(string $entry_id, string $kind, string $label = '', array $extras = []): void
    {
        $entry_id = trim($entry_id);
        if ($entry_id === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $row = [
            'entry_id' => $entry_id,
            'kind'     => trim($kind),
            'label'    => $label,
            'sort'     => $sort,
        ];

        foreach (['module_code', 'block_type', 'esm_url', 'description', 'i18n_label_key', 'composer_zone', 'message_zone'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        self::$entries[$entry_id] = $row;
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
}
