<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * Read oaao.ai-v1 VERSION + build_info.json (same contract as Python {@see build_info.py}).
 */
final class OaaoBuildInfo
{
    /** @var array<string, mixed>|null */
    private static ?array $cache = null;

    public static function configPath(): string
    {
        $env = getenv('OAAO_BUILD_INFO_PATH');
        if ($env !== false && trim((string) $env) !== '') {
            return trim((string) $env);
        }

        $backbone = dirname(__DIR__, 6);

        return $backbone . '/config/oaaoai/build_info.json';
    }

    public static function versionPath(): string
    {
        $env = getenv('OAAO_VERSION_FILE');
        if ($env !== false && trim((string) $env) !== '') {
            return trim((string) $env);
        }

        $repo = dirname(__DIR__, 7);

        return $repo . '/VERSION';
    }

    /** @return array<string, mixed> */
    public static function load(): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }

        $defaults = [
            'version'    => '0.0.0',
            'build_id'   => 'unknown',
            'built_at'   => '',
            'git_sha'    => '',
            'git_branch' => '',
            'dirty'      => false,
            'component'  => 'oaaoai-v1',
        ];

        $data = $defaults;
        $path = self::configPath();
        if (is_readable($path)) {
            $raw = file_get_contents($path);
            if ($raw !== false && trim($raw) !== '') {
                // PowerShell Set-Content -Encoding utf8 may write a BOM; json_decode fails silently.
                if (str_starts_with($raw, "\xEF\xBB\xBF")) {
                    $raw = substr($raw, 3);
                }
                $decoded = json_decode($raw, true);
                if (\is_array($decoded)) {
                    $data = array_merge($data, $decoded);
                }
            }
        }

        $verEnv = getenv('OAAO_VERSION');
        if ($verEnv !== false && trim((string) $verEnv) !== '') {
            $data['version'] = trim((string) $verEnv);
        } else {
            $verFile = self::versionPath();
            if (is_readable($verFile)) {
                $line = trim((string) file_get_contents($verFile));
                if ($line !== '') {
                    $data['version'] = $line;
                }
            }
        }

        $buildEnv = getenv('OAAO_BUILD_ID');
        if ($buildEnv !== false && trim((string) $buildEnv) !== '') {
            $data['build_id'] = trim((string) $buildEnv);
        }

        $gitEnv = getenv('OAAO_GIT_SHA');
        if ($gitEnv !== false && trim((string) $gitEnv) !== '') {
            $data['git_sha'] = trim((string) $gitEnv);
        }

        self::$cache = $data;

        return $data;
    }

    /** @return array<string, mixed> */
    public static function payloadForWeb(): array
    {
        $info = self::load();

        return [
            'ok'         => true,
            'service'    => 'oaao_web',
            'version'    => (string) ($info['version'] ?? '0.0.0'),
            'build_id'   => (string) ($info['build_id'] ?? 'unknown'),
            'built_at'   => (string) ($info['built_at'] ?? ''),
            'git_sha'    => (string) ($info['git_sha'] ?? ''),
            'git_branch' => (string) ($info['git_branch'] ?? ''),
            'dirty'      => (bool) ($info['dirty'] ?? false),
            'component'  => (string) ($info['component'] ?? 'oaaoai-v1'),
        ];
    }
}
