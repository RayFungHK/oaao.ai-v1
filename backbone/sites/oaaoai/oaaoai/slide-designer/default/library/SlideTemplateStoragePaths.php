<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

/** Path / URL helpers for custom slide templates (W9-S2 split from SlideTemplateStorage). */
final class SlideTemplateStoragePaths
{
    public static function distributorDataDir(): string
    {
        return dirname(__DIR__, 3) . '/data';
    }

    public static function defaultRoot(): string
    {
        return self::distributorDataDir() . '/slide-templates/custom';
    }

    /** @deprecated Legacy path before templates moved under {@code data/}. */
    public static function legacyRoot(): string
    {
        return dirname(__DIR__, 3) . '/auth/data/slide-templates/custom';
    }

    public static function root(): string
    {
        $env = getenv('OAAO_SLIDE_TEMPLATE_CUSTOM_ROOT');
        if (is_string($env) && trim($env) !== '') {
            return rtrim(trim($env), '/\\');
        }

        $preferred = self::defaultRoot();
        $legacy = self::legacyRoot();
        if (is_dir($preferred) || ! is_dir($legacy)) {
            return $preferred;
        }

        return $legacy;
    }

    public static function incomingDir(): string
    {
        $dir = self::root() . '/incoming';
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        return $dir;
    }

    /**
     * @return array{scope: string, tenant_id: int|null, owner_user_id: int|null}
     */
    public static function partitionFromScope(array $ctx, string $scope): array
    {
        $scope = SlideTemplateScope::normalizeScope($scope);
        if ($scope === SlideTemplateScope::GLOBAL) {
            return ['scope' => $scope, 'tenant_id' => null, 'owner_user_id' => null];
        }
        if ($scope === SlideTemplateScope::TENANT) {
            $tid = isset($ctx['tenant_id']) ? (int) $ctx['tenant_id'] : 0;

            return ['scope' => $scope, 'tenant_id' => $tid > 0 ? $tid : null, 'owner_user_id' => null];
        }

        $uid = (int) ($ctx['user_id'] ?? 0);

        return [
            'scope'           => SlideTemplateScope::PERSONAL,
            'tenant_id'       => isset($ctx['tenant_id']) ? (int) $ctx['tenant_id'] : null,
            'owner_user_id'   => $uid > 0 ? $uid : null,
        ];
    }

    /**
     * @param array{scope: string, tenant_id: int|null, owner_user_id: int|null} $part
     */
    public static function scopeBase(array $part): string
    {
        $scope = SlideTemplateScope::normalizeScope($part['scope'] ?? null);
        if ($scope === SlideTemplateScope::GLOBAL) {
            return self::root() . '/global';
        }
        if ($scope === SlideTemplateScope::TENANT) {
            $tid = (int) ($part['tenant_id'] ?? 0);

            return self::root() . '/tenant/' . max(1, $tid);
        }
        $uid = (int) ($part['owner_user_id'] ?? 0);

        return self::root() . '/personal/' . max(1, $uid);
    }

    /**
     * @param array{scope: string, tenant_id: int|null, owner_user_id: int|null} $part
     */
    public static function templateJsonPath(string $templateId, array $part): string
    {
        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));

        return self::scopeBase($part) . '/' . $safe . '.json';
    }

    public static function previewHtmlUrl(string $templateId, int $page): string
    {
        return '/slide-designer/api/template_preview_html?' . http_build_query([
            'template_id' => trim($templateId),
            'page'        => max(1, $page),
        ]);
    }

    public static function masterHtmlUrl(string $templateId, int $page): string
    {
        return '/slide-designer/api/template_master_html?' . http_build_query([
            'template_id' => trim($templateId),
            'page'        => max(1, $page),
        ]);
    }

    public static function thumbnailApiUrl(string $templateId): string
    {
        return '/slide-designer/api/template_thumbnail?' . http_build_query([
            'template_id' => trim($templateId),
        ]);
    }

    public static function renderSlideApiUrl(string $templateId, int $page): string
    {
        return '/slide-designer/api/template_render?' . http_build_query([
            'template_id' => trim($templateId),
            'page'        => max(1, $page),
        ]);
    }

    public static function templateAssetDir(string $templateId, array $part): string
    {
        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));

        return self::scopeBase($part) . '/' . $safe;
    }
}
