<?php

declare(strict_types=1);

use Oaaoai\Core\ReleaseBuildCompare;
use PHPUnit\Framework\TestCase;

/**
 * PLAT-1-S9 / PLAT-1-S10 — build/version compare helpers.
 */
final class ReleaseBuildCompareTest extends TestCase
{
    public function test_is_same_build(): void
    {
        self::assertTrue(ReleaseBuildCompare::isSameBuild('abc123', 'abc123'));
        self::assertFalse(ReleaseBuildCompare::isSameBuild('abc123', 'def456'));
        self::assertFalse(ReleaseBuildCompare::isSameBuild('', 'abc'));
    }

    public function test_post_visible_since_build(): void
    {
        self::assertFalse(ReleaseBuildCompare::postVisibleSinceBuild('build-a', 'build-a'));
        self::assertTrue(ReleaseBuildCompare::postVisibleSinceBuild('build-b', 'build-a'));
        self::assertTrue(ReleaseBuildCompare::postVisibleSinceBuild('', 'build-a'));
        self::assertTrue(ReleaseBuildCompare::postVisibleSinceBuild('build-a', ''));
    }

    public function test_compare_version(): void
    {
        self::assertSame(1, ReleaseBuildCompare::compareVersion('1.2.0', '1.1.9'));
        self::assertSame(-1, ReleaseBuildCompare::compareVersion('1.0.0', '2.0.0'));
        self::assertSame(0, ReleaseBuildCompare::compareVersion('1.0.0', '1.0.0'));
    }
}
