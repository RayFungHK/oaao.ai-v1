<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * PLAT-1-S9 — build_id / version helpers for release notes filtering.
 */
final class ReleaseBuildCompare
{
    public static function normalizeBuildId(string $buildId): string
    {
        return trim($buildId);
    }

    public static function isSameBuild(string $a, string $b): bool
    {
        $na = self::normalizeBuildId($a);
        $nb = self::normalizeBuildId($b);

        return $na !== '' && $nb !== '' && $na === $nb;
    }

    /**
     * Whether a published post should appear in a "since build" What's New view.
     * Excludes posts tied to the viewer's current build; includes other builds and undated posts.
     */
    public static function postVisibleSinceBuild(string $postBuildId, string $sinceBuildId): bool
    {
        $post = self::normalizeBuildId($postBuildId);
        $since = self::normalizeBuildId($sinceBuildId);
        if ($since === '') {
            return true;
        }
        if ($post === '') {
            return true;
        }

        return ! self::isSameBuild($post, $since);
    }

    /**
     * @return int negative if a < b, positive if a > b, 0 if equal/unknown
     */
    public static function compareVersion(string $a, string $b): int
    {
        $na = trim($a);
        $nb = trim($b);
        if ($na === '' || $nb === '') {
            return 0;
        }

        return version_compare($na, $nb);
    }
}
