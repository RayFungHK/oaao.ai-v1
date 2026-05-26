<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Registry for Python-side multimodal providers ({@code python_module} in {@code mm.*} purpose meta).
 *
 * Modules extend via {@code mm_python_module.register} (namespaced events); {@see \\Module\\oaao\\endpoints}
 * listens and merges rows before Settings / orchestrator payload consumers read {@see self::allSorted()}.
 */
final class MmPythonModuleRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $entries = [];

    /** @var array<string, string> alias => canonical module_id */
    protected static array $aliases = [];

    /**
     * @param array<string, mixed> $extras sort, module_code, base_url_env, supported_tasks, aliases, i18n_label_key, i18n_desc_key
     */
    public static function add(string $moduleId, string $label, string $description, array $extras = []): void
    {
        $moduleId = strtolower(trim($moduleId));
        if ($moduleId === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $row = [
            'module_id'   => $moduleId,
            'label'       => trim($label),
            'description' => trim($description),
            'sort'        => $sort,
        ];

        foreach (['module_code', 'base_url_env', 'i18n_label_key', 'i18n_desc_key'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        if (isset($extras['config_fields']) && is_array($extras['config_fields'])) {
            $fields = [];
            foreach ($extras['config_fields'] as $field) {
                if (! \is_array($field)) {
                    continue;
                }
                $key = trim((string) ($field['key'] ?? ''));
                if ($key === '') {
                    continue;
                }
                $entry = [
                    'key'  => $key,
                    'type' => trim((string) ($field['type'] ?? 'text')) ?: 'text',
                ];
                foreach (['label_key', 'placeholder', 'env_fallback', 'hint_key'] as $fk) {
                    if (isset($field[$fk]) && is_string($field[$fk]) && trim($field[$fk]) !== '') {
                        $entry[$fk] = trim($field[$fk]);
                    }
                }
                $fields[] = $entry;
            }
            if ($fields !== []) {
                $row['config_fields'] = $fields;
            }
        }

        if (isset($extras['supported_tasks']) && is_array($extras['supported_tasks'])) {
            $tasks = [];
            foreach ($extras['supported_tasks'] as $task) {
                $t = strtolower(trim((string) $task));
                if ($t !== '') {
                    $tasks[] = $t;
                }
            }
            if ($tasks !== []) {
                $row['supported_tasks'] = array_values(array_unique($tasks));
            }
        }

        self::$entries[$moduleId] = $row;

        if (isset($extras['aliases']) && is_array($extras['aliases'])) {
            foreach ($extras['aliases'] as $alias) {
                $a = strtolower(trim((string) $alias));
                if ($a !== '' && $a !== $moduleId) {
                    self::$aliases[$a] = $moduleId;
                }
            }
        }
    }

    public static function resolveModuleId(string $raw): string
    {
        $id = strtolower(trim($raw));
        if ($id === '') {
            return 'mm_lance';
        }
        if (isset(self::$entries[$id])) {
            return $id;
        }

        return self::$aliases[$id] ?? $id;
    }

    public static function has(string $moduleId): bool
    {
        $id = self::resolveModuleId($moduleId);

        return isset(self::$entries[$id]);
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
