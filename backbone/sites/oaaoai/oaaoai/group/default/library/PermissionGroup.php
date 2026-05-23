<?php

declare(strict_types=1);

namespace oaaoai\group;

/**
 * Permission group document — features + quotas stored on {@code oaao_group}.
 */
final class PermissionGroup
{
    /** @return array<string, bool> */
    public static function defaultFeatures(): array
    {
        return [
            'chat'      => true,
            'vault'     => true,
            'workspace' => true,
            'settings'  => false,
        ];
    }

    /** @return array<string, int|null> */
    public static function defaultLimits(): array
    {
        return [
            'workspace_max'      => null,
            'vault_max'          => null,
            'vault_files_max'    => null,
            'storage_bytes_max'  => null,
        ];
    }

    /** @return array{features: array<string, bool>, limits: array<string, int|null>} */
    public static function emptyDocument(): array
    {
        return [
            'features' => self::defaultFeatures(),
            'limits'   => self::defaultLimits(),
        ];
    }

    /**
     * @param array<string, mixed>|null $permissions
     * @param array<string, mixed>|null $limits
     *
     * @return array{features: array<string, bool>, limits: array<string, int|null>}
     */
    public static function mergeDocuments(?array $permissions, ?array $limits): array
    {
        $base = self::emptyDocument();
        if (\is_array($permissions) && isset($permissions['features']) && \is_array($permissions['features'])) {
            foreach ($permissions['features'] as $k => $v) {
                $key = trim((string) $k);
                if ($key === '') {
                    continue;
                }
                $base['features'][$key] = ($v === true || $v === 1 || $v === '1');
            }
        }
        if (\is_array($limits)) {
            foreach ($limits as $k => $v) {
                $key = trim((string) $k);
                if ($key === '') {
                    continue;
                }
                if ($v === null || $v === '') {
                    $base['limits'][$key] = null;
                    continue;
                }
                $base['limits'][$key] = max(0, (int) $v);
            }
        }

        return $base;
    }

    public static function encodePermissions(array $features): string
    {
        return json_encode(['features' => $features], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /** @return array<string, bool> */
    public static function parsePermissions(?string $json): array
    {
        $out = self::defaultFeatures();
        if ($json === null || trim($json) === '') {
            return $out;
        }
        try {
            /** @var array<string, mixed> $dec */
            $dec = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $out;
        }
        $feats = $dec['features'] ?? $dec;
        if (! \is_array($feats)) {
            return $out;
        }
        foreach ($feats as $k => $v) {
            $key = trim((string) $k);
            if ($key === '') {
                continue;
            }
            $out[$key] = ($v === true || $v === 1 || $v === '1');
        }

        return $out;
    }

    /** @return array<string, int|null> */
    public static function parseLimits(?string $json): array
    {
        $out = self::defaultLimits();
        if ($json === null || trim($json) === '') {
            return $out;
        }
        try {
            /** @var array<string, mixed> $dec */
            $dec = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $out;
        }
        foreach ($out as $k => $_) {
            if (! \array_key_exists($k, $dec)) {
                continue;
            }
            $v = $dec[$k];
            if ($v === null || $v === '') {
                $out[$k] = null;
                continue;
            }
            $out[$k] = max(0, (int) $v);
        }

        return $out;
    }

    public static function encodeLimits(array $limits): string
    {
        return json_encode($limits, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
