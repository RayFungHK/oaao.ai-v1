<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * PLAT-1 — idempotent seed: first workspace "news" post (2026-05-27 → now) + notification fan-out.
 */
final class ReleasePostFirstNewsSeed
{
    public const SEED_SLUG = 'whats-new-2026-05-late';

    public static function ensureOnce(\PDO $pdo): void
    {
        if (trim((string) (getenv('OAAO_SKIP_RELEASE_NEWS_SEED') ?: '')) === '1') {
            return;
        }

        if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
            return;
        }

        $chk = $pdo->prepare('SELECT 1 FROM oaao_release_post WHERE slug = ? LIMIT 1');
        $chk->execute([self::SEED_SLUG]);
        if ($chk->fetchColumn()) {
            return;
        }

        $build = OaaoBuildInfo::load();
        $version = (string) ($build['version'] ?? '0.0.0');
        $buildId = (string) ($build['build_id'] ?? '');

        $fanout = new ReleasePostFanout($pdo);
        $fanout->ensureSchema();

        $locales = [
            'en'      => [
                'title' => 'What\'s new — late May 2026',
                'file'  => '2026-05-29-roadmap-en.md',
            ],
            'zh-Hant' => [
                'title' => '產品更新 — 2026 年 5 月下旬',
                'file'  => '2026-05-29-roadmap-zh-Hant.md',
            ],
        ];

        $docsRoot = dirname(__DIR__, 8) . '/docs/release-notes';
        $primaryPostId = 0;

        foreach ($locales as $locale => $meta) {
            $body = self::loadBodyMd($docsRoot . '/' . $meta['file']);
            $ins = $pdo->prepare(
                'INSERT INTO oaao_release_post (slug, post_type, locale, version, build_id, title, body_md, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 RETURNING release_post_id',
            );
            $ins->execute([
                self::SEED_SLUG,
                'news',
                $locale,
                $version,
                $buildId,
                $meta['title'],
                $body,
                'draft',
            ]);
            $postId = (int) $ins->fetchColumn();
            if ($locale === 'en') {
                $primaryPostId = $postId;
            } else {
                self::publishWithoutFanout($pdo, $fanout, $postId, $version, $buildId);
            }
        }

        if ($primaryPostId < 1) {
            return;
        }

        $row = $fanout->loadPost($primaryPostId);
        if ($row === null) {
            return;
        }

        $fanout->markPublished($primaryPostId, $row);
        $guard = 0;
        do {
            $batch = $fanout->processBatch($primaryPostId);
            ++$guard;
        } while (! ($batch['done'] ?? true) && $guard < 500);
    }

    private static function publishWithoutFanout(
        \PDO $pdo,
        ReleasePostFanout $fanout,
        int $postId,
        string $version,
        string $buildId,
    ): void {
        $pdo->prepare(
            'UPDATE oaao_release_post SET status = ?, published_at = CURRENT_TIMESTAMP, version = ?, build_id = ?,
                fanout_status = ?, updated_at = CURRENT_TIMESTAMP WHERE release_post_id = ?',
        )->execute(['published', $version, $buildId, 'skipped_locale', $postId]);
    }

    private static function loadBodyMd(string $path): string
    {
        if (\is_readable($path)) {
            $raw = (string) file_get_contents($path);
            if ($raw !== '') {
                return $raw;
            }
        }

        return "# What's new\n\nSee [release notes](docs/release-notes/) in the repository.\n";
    }
}
