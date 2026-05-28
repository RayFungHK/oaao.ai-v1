<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * User Preferences — ASR-related fields registered by feature modules.
 *
 * Modules extend via {@code asr_user_preference.register} (namespaced events); {@see \\Module\\oaao\\endpoints}
 * listens and merges rows before Settings / user preference panels read {@see self::allSorted()}.
 */
final class AsrUserPreferenceRegister
{
    /** @var array<string, array<string, mixed>> keyed by field_id */
    protected static array $fields = [];

    /**
     * @param array<string, mixed> $extras
     *                                    pref_key, type, label_key, desc_key, default, options[], visible_when, sort, module_code
     */
    public static function addField(string $fieldId, array $extras = []): void
    {
        $fieldId = trim($fieldId);
        if ($fieldId === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $prefKey = trim((string) ($extras['pref_key'] ?? $fieldId));
        if ($prefKey === '') {
            $prefKey = $fieldId;
        }

        $row = [
            'field_id' => $fieldId,
            'pref_key' => $prefKey,
            'type'     => trim((string) ($extras['type'] ?? 'select')) ?: 'select',
            'sort'     => $sort,
            'default'  => trim((string) ($extras['default'] ?? '')),
        ];

        foreach (['label_key', 'desc_key', 'visible_when', 'module_code'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        if (isset($extras['options']) && is_array($extras['options'])) {
            $options = [];
            foreach ($extras['options'] as $opt) {
                if (! \is_array($opt)) {
                    continue;
                }
                $value = trim((string) ($opt['value'] ?? ''));
                if ($value === '') {
                    continue;
                }
                $entry = ['value' => $value];
                if (isset($opt['label_key']) && is_string($opt['label_key']) && trim($opt['label_key']) !== '') {
                    $entry['label_key'] = trim($opt['label_key']);
                }
                $options[] = $entry;
            }
            if ($options !== []) {
                $row['options'] = $options;
            }
        }

        self::$fields[$fieldId] = $row;
    }

    public static function has(string $fieldId): bool
    {
        return isset(self::$fields[trim($fieldId)]);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function get(string $fieldId): ?array
    {
        $id = trim($fieldId);

        return self::$fields[$id] ?? null;
    }

    /**
     * @return list<string>
     */
    public static function allowedValues(string $fieldId): array
    {
        $field = self::get($fieldId);
        if ($field === null) {
            return [];
        }
        $options = $field['options'] ?? [];
        if (! \is_array($options)) {
            return [];
        }
        $out = [];
        foreach ($options as $opt) {
            if (! \is_array($opt)) {
                continue;
            }
            $value = trim((string) ($opt['value'] ?? ''));
            if ($value !== '') {
                $out[] = $value;
            }
        }

        return $out;
    }

    public static function normalizeValue(string $fieldId, ?string $raw): string
    {
        $field = self::get($fieldId);
        if ($field === null) {
            return trim((string) ($raw ?? ''));
        }
        $value = trim((string) ($raw ?? ''));
        $allowed = self::allowedValues($fieldId);
        if ($allowed !== [] && \in_array($value, $allowed, true)) {
            return $value;
        }
        $default = trim((string) ($field['default'] ?? ''));
        if ($default !== '' && ($allowed === [] || \in_array($default, $allowed, true))) {
            return $default;
        }
        if ($allowed !== []) {
            return $allowed[0];
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $prefs
     *
     * @return array<string, string>
     */
    public static function valuesFromPreferences(array $prefs): array
    {
        $out = [];
        foreach (self::allSorted() as $field) {
            $fieldId = (string) ($field['field_id'] ?? '');
            $prefKey = (string) ($field['pref_key'] ?? $fieldId);
            if ($fieldId === '' || $prefKey === '') {
                continue;
            }
            $raw = isset($prefs[$prefKey]) && \is_string($prefs[$prefKey]) ? $prefs[$prefKey] : null;
            $out[$prefKey] = self::normalizeValue($fieldId, $raw);
        }

        return $out;
    }

    /**
     * @param callable(string): bool $isConfigured visible_when resolver
     *
     * @return list<array<string, mixed>>
     */
    public static function visibleFields(callable $isConfigured): array
    {
        $out = [];
        foreach (self::allSorted() as $field) {
            $when = trim((string) ($field['visible_when'] ?? ''));
            if ($when !== '' && ! $isConfigured($when)) {
                continue;
            }
            $out[] = $field;
        }

        return $out;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function allSorted(): array
    {
        $values = array_values(self::$fields);
        usort($values, static fn (array $a, array $b): int => ($a['sort'] ?? 500) <=> ($b['sort'] ?? 500));

        return $values;
    }
}
