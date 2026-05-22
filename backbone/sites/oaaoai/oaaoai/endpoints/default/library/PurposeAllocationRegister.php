<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Purpose-allocation slots for Admin Settings and **downstream config** (e.g. Python endpoint pipeline): grouping keys for {@code oaao_purpose}.
 *
 * Owned by the {@code oaaoai/endpoints} module — not core. Slots are seeded in {@see \\Module\\oaao\\endpoints} {@code __onInit}
 * and extended via {@code purpose_allocation.register} or {@code api('endpoints')->registerPurposeAllocationSlot()}.
 *
 * **Hook:** {@code $this->trigger('purpose_allocation.register')->resolve([ 'slot_id' => …, 'label' => …, … ])} from {@code oaaoai/chat}, {@code oaaoai/rag}, {@code oaaoai/user}, … —
 * {@see \\Module\\oaao\\endpoints} listens (namespaced events) and forwards to {@see PurposeAllocationRegister::add}.
 *
 * Matching rule: {@code purpose_key === purpose_key_prefix} or {@code purpose_key} starts with {@code "{$prefix}."}.
 * Optional {@code $extras}:
 * - {@code sort}: ordering hint (ascending).
 * - {@code purpose_key_prefix}: primary routing prefix for this slot.
 * - {@code allocation_mode}: optional tag for consumers (e.g. {@code chat_multi}); the Chat module owns chat-specific purpose routing UX.
 * - {@code fallback}: bucket for unmatched keys (one slot only).
 * - {@code module_code}: owning module id for diagnostics.
 * - {@code title_key}, {@code label_key}, {@code sub_key}: dotted keys for {@code oaao-i18n.js} ({@code oaaoT}; falls back to {@code label}/{@code title}/{@code sub}).
 */
final class PurposeAllocationRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $slots = [];

    /** @param array<string, mixed> $extras */
    public static function add(string $slot_id, string $label, string $title, string $sub = '', string $icon = '', array $extras = []): void
    {
        $slot_id = trim($slot_id);
        if ($slot_id === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $purpose_key_prefix = '';
        if (isset($extras['purpose_key_prefix']) && is_string($extras['purpose_key_prefix'])) {
            $purpose_key_prefix = trim($extras['purpose_key_prefix']);
        }

        $fallback = false;
        if (isset($extras['fallback'])) {
            $fallback = (bool) $extras['fallback'];
        }

        $module_code = '';
        if (isset($extras['module_code']) && is_string($extras['module_code'])) {
            $module_code = trim($extras['module_code']);
        }

        $row = [
            'slot_id' => $slot_id,
            'label'   => $label,
            'title'   => $title,
            'sub'     => $sub,
            'icon'    => $icon,
            'sort'    => $sort,
        ];

        if ($purpose_key_prefix !== '') {
            $row['purpose_key_prefix'] = $purpose_key_prefix;
        }

        if ($fallback) {
            $row['fallback'] = true;
        }

        if ($module_code !== '') {
            $row['module_code'] = $module_code;
        }

        if (isset($extras['allocation_mode']) && is_string($extras['allocation_mode'])) {
            $mode = trim($extras['allocation_mode']);
            if ($mode !== '') {
                $row['allocation_mode'] = $mode;
            }
        }

        foreach (['label_key', 'title_key', 'sub_key'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        self::$slots[$slot_id] = $row;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function allSorted(): array
    {
        $values = array_values(self::$slots);
        usort(
            $values,
            static function (array $a, array $b): int {
                $cmp = ($a['sort'] ?? 500) <=> ($b['sort'] ?? 500);

                return $cmp !== 0 ? $cmp : strcmp((string) ($a['slot_id'] ?? ''), (string) ($b['slot_id'] ?? ''));
            }
        );

        return $values;
    }
}
