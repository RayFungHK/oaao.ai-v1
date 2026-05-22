<?php

declare(strict_types=1);

namespace oaaoai\vault;

/**
 * Transcript summary prompt templates — one {@code .md} file per template (YAML front matter + body prompt).
 *
 * Default directory (Docker bind mount): {@code /var/www/html/config/transcript-summary-templates}
 * Override: {@code OAAO_TRANSCRIPT_SUMMARY_TEMPLATES_DIR}
 */
final class VaultTranscriptSummaryTemplates
{
    public const DEFAULT_TEMPLATE_ID = 'general-meeting';

    /** @var list<array{id: string, label: string, emoji: string, beta: bool, default: bool, sort: int}>|null */
    private static ?array $cachedList = null;

    public static function templatesDir(): string
    {
        $env = getenv('OAAO_TRANSCRIPT_SUMMARY_TEMPLATES_DIR');
        if (\is_string($env) && trim($env) !== '') {
            return rtrim(trim($env), '/');
        }

        $docker = '/var/www/html/config/transcript-summary-templates';
        if (is_dir($docker)) {
            return $docker;
        }

        $dev = realpath(__DIR__ . '/../../../../../../../docker/transcript-summary-templates');
        if ($dev !== false && is_dir($dev)) {
            return $dev;
        }

        return $docker;
    }

    /**
     * @return list<array{id: string, label: string, emoji: string, beta: bool, default: bool, sort: int}>
     */
    public static function listTemplates(): array
    {
        if (self::$cachedList !== null) {
            return self::$cachedList;
        }

        $dir = self::templatesDir();
        if (! is_dir($dir)) {
            self::$cachedList = [];

            return self::$cachedList;
        }

        /** @var list<array{id: string, label: string, emoji: string, beta: bool, default: bool, sort: int}> $rows */
        $rows = [];
        $files = scandir($dir);
        if (! \is_array($files)) {
            self::$cachedList = [];

            return self::$cachedList;
        }

        foreach ($files as $file) {
            if (! \is_string($file) || ! str_ends_with(strtolower($file), '.md')) {
                continue;
            }
            if ($file === 'README.md') {
                continue;
            }
            $path = $dir . '/' . $file;
            if (! is_file($path)) {
                continue;
            }
            $parsed = self::parseTemplateFile($path);
            if ($parsed === null) {
                continue;
            }
            $rows[] = [
                'id'      => $parsed['id'],
                'label'   => $parsed['label'],
                'emoji'   => $parsed['emoji'],
                'beta'    => $parsed['beta'],
                'default' => $parsed['default'],
                'sort'    => $parsed['sort'],
            ];
        }

        usort(
            $rows,
            static fn (array $a, array $b): int => ($a['sort'] <=> $b['sort']) ?: strcmp($a['label'], $b['label']),
        );

        self::$cachedList = $rows;

        return self::$cachedList;
    }

    /**
     * @return list<array{id: string, label: string, emoji: string, beta: bool, default: bool, sort: int}>
     */
    public static function listTemplatesForApi(): array
    {
        /** @var list<array{id: string, label: string, emoji: string, beta: bool, default: bool, sort: int}> $templates */
        $templates = [];
        foreach (self::listTemplates() as $row) {
            $templates[] = [
                'id'      => $row['id'],
                'label'   => $row['label'],
                'emoji'   => $row['emoji'],
                'beta'    => ! empty($row['beta']),
                'default' => ! empty($row['default']),
                'sort'    => (int) $row['sort'],
            ];
        }

        return $templates;
    }

    /**
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null
     */
    public static function loadTemplate(string $templateId): ?array
    {
        $id = self::normalizeId($templateId);
        if ($id === '') {
            return null;
        }

        foreach (self::listTemplates() as $meta) {
            if ($meta['id'] !== $id) {
                continue;
            }
            $path = self::templatesDir() . '/' . $id . '.md';
            if (! is_file($path)) {
                return null;
            }

            return self::parseTemplateFile($path);
        }

        return null;
    }

    public static function defaultTemplateId(): string
    {
        foreach (self::listTemplates() as $row) {
            if (! empty($row['default'])) {
                return (string) $row['id'];
            }
        }

        return self::DEFAULT_TEMPLATE_ID;
    }

    public static function normalizeId(string $raw): string
    {
        $raw = strtolower(trim($raw));
        $raw = preg_replace('/[^a-z0-9\-]+/', '-', $raw) ?? '';
        $raw = trim($raw, '-');

        return $raw;
    }

    /**
     * @return array{id: string, label: string, emoji: string, beta: bool, default: bool, sort: int, prompt: string}|null
     */
    private static function parseTemplateFile(string $path): ?array
    {
        $raw = @file_get_contents($path);
        if (! \is_string($raw) || trim($raw) === '') {
            return null;
        }

        $front = [];
        $body = trim($raw);
        if (preg_match('/^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)$/s', $raw, $m)) {
            $body = trim($m[2]);
            foreach (preg_split('/\r?\n/', $m[1]) as $line) {
                if (! preg_match('/^([a-zA-Z0-9_\-]+)\s*:\s*(.+)$/', trim($line), $kv)) {
                    continue;
                }
                $front[strtolower($kv[1])] = trim($kv[2], " \t\"'");
            }
        }

        $id = self::normalizeId((string) ($front['id'] ?? basename($path, '.md')));
        if ($id === '') {
            return null;
        }

        $label = trim((string) ($front['label'] ?? ''));
        if ($label === '') {
            $label = ucwords(str_replace('-', ' ', $id));
        }

        $emoji = trim((string) ($front['emoji'] ?? '📝'));
        $beta = self::truthy($front['beta'] ?? false);
        $default = self::truthy($front['default'] ?? false);
        $sort = isset($front['sort']) && is_numeric($front['sort']) ? (int) $front['sort'] : 500;

        if ($body === '') {
            return null;
        }

        return [
            'id'      => $id,
            'label'   => $label,
            'emoji'   => $emoji,
            'beta'    => $beta,
            'default' => $default,
            'sort'    => $sort,
            'prompt'  => $body,
        ];
    }

    private static function truthy(mixed $v): bool
    {
        if (\is_bool($v)) {
            return $v;
        }
        if (\is_int($v) || \is_float($v)) {
            return (int) $v === 1;
        }

        return \in_array(strtolower(trim((string) $v)), ['1', 'true', 'yes', 'on'], true);
    }
}
