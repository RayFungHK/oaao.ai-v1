<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

/**
 * On-disk slide projects ({@code OAAO_SLIDE_PROJECT_ROOT}) — shared with orchestrator.
 */
final class SlideProjectStorage
{
    public static function root(): string
    {
        $env = getenv('OAAO_SLIDE_PROJECT_ROOT');
        if (\is_string($env) && trim($env) !== '') {
            return rtrim(trim($env), '/\\');
        }

        $data = getenv('OAAO_AUTH_SQLITE_PATH');
        if (\is_string($data) && trim($data) !== '') {
            return dirname(trim($data)) . '/slide-projects';
        }

        return dirname(__DIR__, 3) . '/auth/data/slide-projects';
    }

    public static function projectDir(string $projectId): string
    {
        $safe = preg_replace('/[^a-zA-Z0-9_-]/', '', $projectId) ?? '';

        return self::root() . '/' . $safe;
    }

    public static function manifestPath(string $projectId): string
    {
        return self::projectDir($projectId) . '/project.json';
    }

    public static function ensureProjectDir(string $projectId): string
    {
        $dir = self::projectDir($projectId);
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        return $dir;
    }

    /**
     * Relative API path (site root; client adds mount prefix).
     */
    public static function downloadPath(string $projectId, string $fileName): string
    {
        return '/slide-designer/api/download?'
            . http_build_query([
                'project_id' => $projectId,
                'file'       => $fileName,
            ]);
    }

    public static function slideHtmlPath(string $projectId, int $pageIndex, ?int $conversationId = null): string
    {
        $q = [
            'project_id' => $projectId,
            'page'       => max(1, $pageIndex),
        ];
        if ($conversationId !== null && $conversationId > 0) {
            $q['conversation_id'] = $conversationId;
        }

        return '/slide-designer/api/slide_html?' . http_build_query($q);
    }
}
