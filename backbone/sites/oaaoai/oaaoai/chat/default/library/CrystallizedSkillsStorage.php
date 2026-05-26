<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Admin overlay for crystallized skills (disabled IDs persisted on host).
 *
 * Canonical skill bodies live in orchestrator Arango/Qdrant; this file only
 * stores operator overrides (disable list).
 */
final class CrystallizedSkillsStorage
{
    public static function configPath(): string
    {
        $env = getenv('OAAO_CRYSTALLIZED_SKILLS_MANIFEST_PATH');
        if ($env !== false && trim((string) $env) !== '') {
            return trim((string) $env);
        }

        $backbone = dirname(__DIR__, 6);

        return $backbone . '/config/oaaoai/crystallized_skills_manifest.json';
    }

    /** @return list<string> */
    public static function loadDisabledIds(): array
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
        $ids = $data['disabled_ids'] ?? [];
        if (! \is_array($ids)) {
            return [];
        }
        $out = [];
        foreach ($ids as $id) {
            $s = trim((string) $id);
            if ($s !== '') {
                $out[] = $s;
            }
        }

        return array_values(array_unique($out));
    }

    /** @param list<string> $disabledIds */
    public static function saveDisabledIds(array $disabledIds): bool
    {
        $path = self::configPath();
        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            return false;
        }
        $clean = [];
        foreach ($disabledIds as $id) {
            $s = trim((string) $id);
            if ($s !== '') {
                $clean[] = $s;
            }
        }
        $payload = json_encode(
            ['disabled_ids' => array_values(array_unique($clean))],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE,
        );
        if ($payload === false) {
            return false;
        }

        return file_put_contents($path, $payload . "\n", LOCK_EX) !== false;
    }
}
