<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Persist admin-configured OpenAPI tool servers (JSON on host bind mount).
 */
final class ToolServerStorage
{
    /** @var bool */
    private static bool $bootstrapped = false;

    public static function configPath(): string
    {
        $env = getenv('OAAO_TOOL_SERVERS_PATH');
        if ($env !== false && trim((string) $env) !== '') {
            return trim((string) $env);
        }

        $backbone = dirname(__DIR__, 6);

        return $backbone . '/config/oaaoai/tool_servers.json';
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
        $servers = $data['servers'] ?? $data;
        if (! \is_array($servers)) {
            return [];
        }
        $out = [];
        foreach ($servers as $row) {
            if (\is_array($row)) {
                $out[] = $row;
            }
        }

        return $out;
    }

    /**
     * @param list<array<string, mixed>> $servers
     */
    public static function savePersisted(array $servers): bool
    {
        $path = self::configPath();
        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            return false;
        }
        $payload = json_encode(['servers' => array_values($servers)], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            return false;
        }

        return file_put_contents($path, $payload . "\n", LOCK_EX) !== false;
    }

    public static function bootstrapPersisted(): void
    {
        if (self::$bootstrapped) {
            return;
        }
        self::$bootstrapped = true;
        foreach (self::loadPersisted() as $row) {
            $id = isset($row['id']) ? trim((string) $row['id']) : '';
            $base = isset($row['base_url']) ? trim((string) $row['base_url']) : '';
            if ($id === '' || $base === '') {
                continue;
            }
            $label = isset($row['label']) ? trim((string) $row['label']) : $id;
            /** @var array<string, mixed> $extras */
            $extras = $row;
            ToolServerRegister::add($id, $base, $label, $extras);
        }
    }

    public static function resetBootstrap(): void
    {
        self::$bootstrapped = false;
    }
}
