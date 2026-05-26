<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Persist admin-configured hot-plug skills (JSON manifest on host bind mount).
 *
 * Orchestrator reads the same file via {@code OAAO_SKILLS_MANIFEST_PATH} and/or
 * per-request {@code hot_plug_skills} from {@code send.php}.
 */
final class SkillsManifestStorage
{
    public static function configPath(): string
    {
        $env = getenv('OAAO_SKILLS_MANIFEST_PATH');
        if ($env !== false && trim((string) $env) !== '') {
            return trim((string) $env);
        }

        $backbone = dirname(__DIR__, 6);

        return $backbone . '/config/oaaoai/skills_manifest.json';
    }

    /** @return list<array<string, mixed>> */
    public static function loadPersisted(): array
    {
        $path = self::configPath();
        if (! is_readable($path)) {
            return [];
        }
        $raw = file_get_contents($path);
        if ($raw === false || trim($raw) === '') {
            return [];
        }
        $data = json_decode($raw, true);
        if (! \is_array($data)) {
            return [];
        }
        $skills = $data['skills'] ?? $data;
        if (! \is_array($skills)) {
            return [];
        }
        $out = [];
        foreach ($skills as $row) {
            if (\is_array($row)) {
                $out[] = $row;
            }
        }

        return $out;
    }

    /**
     * Enabled skills for orchestrator (published + purpose filter optional).
     *
     * @return list<array<string, mixed>>
     */
    public static function enabledForPurpose(?string $purposeId = null): array
    {
        $pid = $purposeId !== null ? strtolower(trim($purposeId)) : '';
        $out = [];
        foreach (self::loadPersisted() as $row) {
            if (($row['enabled'] ?? true) === false) {
                continue;
            }
            $id = trim((string) ($row['id'] ?? $row['skill_id'] ?? ''));
            if ($id === '') {
                continue;
            }
            if ($pid !== '') {
                $purposes = $row['allowed_purposes'] ?? ['chat', 'planning'];
                if (\is_string($purposes)) {
                    $purposes = array_map('trim', explode(',', $purposes));
                }
                if (\is_array($purposes) && $purposes !== []) {
                    $allowed = array_map(static fn ($p): string => strtolower(trim((string) $p)), $purposes);
                    if (! \in_array($pid, $allowed, true)) {
                        continue;
                    }
                }
            }
            $out[] = self::normalizeRow($row);
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    public static function normalizeRow(array $row): array
    {
        $id = trim((string) ($row['id'] ?? $row['skill_id'] ?? ''));
        $label = trim((string) ($row['label'] ?? $row['title'] ?? $id));
        $desc = trim((string) ($row['description'] ?? $row['summary'] ?? $label));
        $params = $row['parameters'] ?? null;
        if (! \is_array($params)) {
            $params = self::parametersFromProperties($row['properties'] ?? null);
        }
        $purposes = $row['allowed_purposes'] ?? ['chat', 'planning'];
        if (\is_string($purposes)) {
            $purposes = array_values(array_filter(array_map('trim', explode(',', $purposes))));
        }
        if (! \is_array($purposes) || $purposes === []) {
            $purposes = ['chat', 'planning'];
        }
        $handler = trim((string) ($row['handler'] ?? 'instruction'));
        if ($handler === '') {
            $handler = 'instruction';
        }

        $normalized = [
            'id'                => $id,
            'label'             => $label,
            'description'       => $desc,
            'parameters'        => $params,
            'handler'           => $handler,
            'allowed_purposes'  => array_values(array_map('strval', $purposes)),
            'enabled'           => ($row['enabled'] ?? true) !== false,
        ];
        if (isset($row['instruction']) && \is_string($row['instruction'])) {
            $normalized['instruction'] = $row['instruction'];
        }
        if (isset($row['handler_url']) && \is_string($row['handler_url'])) {
            $normalized['handler_url'] = trim($row['handler_url']);
        }

        return $normalized;
    }

    /**
     * Build OpenAI parameters schema from simple property rows.
     *
     * @param mixed $properties
     *
     * @return array<string, mixed>
     */
    public static function parametersFromProperties(mixed $properties): array
    {
        if (! \is_array($properties) || $properties === []) {
            return ['type' => 'object', 'properties' => new \stdClass()];
        }
        $props = [];
        $required = [];
        foreach ($properties as $prop) {
            if (! \is_array($prop)) {
                continue;
            }
            $name = trim((string) ($prop['name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $type = trim((string) ($prop['type'] ?? 'string'));
            if ($type === '') {
                $type = 'string';
            }
            $entry = ['type' => $type];
            $pdesc = trim((string) ($prop['description'] ?? ''));
            if ($pdesc !== '') {
                $entry['description'] = $pdesc;
            }
            $props[$name] = $entry;
            if (! empty($prop['required'])) {
                $required[] = $name;
            }
        }
        $schema = ['type' => 'object', 'properties' => $props !== [] ? $props : new \stdClass()];
        if ($required !== []) {
            $schema['required'] = $required;
        }

        return $schema;
    }

    /**
     * @param list<array<string, mixed>> $skills
     */
    public static function savePersisted(array $skills): bool
    {
        $path = self::configPath();
        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            return false;
        }
        $normalized = [];
        foreach ($skills as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $id = trim((string) ($row['id'] ?? $row['skill_id'] ?? ''));
            if ($id === '') {
                continue;
            }
            $normalized[] = self::normalizeRow($row);
        }
        $payload = json_encode(['skills' => array_values($normalized)], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            return false;
        }

        return file_put_contents($path, $payload . "\n", LOCK_EX) !== false;
    }
}
