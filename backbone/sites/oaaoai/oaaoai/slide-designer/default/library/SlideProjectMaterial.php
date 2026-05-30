<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

/**
 * Slide project rows for chat materials / orchestrator — consumed via {@code api('slide_designer')} only.
 */
final class SlideProjectMaterial
{
    public static function slideMaterialId(string $projectId): string
    {
        return 'slide-' . trim($projectId);
    }

    /**
     * @param array<string, mixed> $proj
     *
     * @return array<string, mixed>|null
     */
    public static function plannerRow(array $proj): ?array
    {
        $projectId = trim((string) ($proj['project_id'] ?? ''));
        if ($projectId === '') {
            return null;
        }
        $title = trim((string) ($proj['title'] ?? 'Slide project'));
        $slideCount = (int) ($proj['slide_count'] ?? 0);
        $status = trim((string) ($proj['status'] ?? 'ready')) ?: 'ready';
        $pages = $proj['pages'] ?? null;
        $completed = \is_array($pages) ? \count($pages) : 0;

        return [
            'material_id' => self::slideMaterialId($projectId),
            'kind'        => 'slide_project',
            'category'    => 'slide',
            'title'       => $title !== '' ? $title : 'Slide project',
            'mime'        => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'size_bytes'  => null,
            'uri'         => null,
            'task_id'     => isset($proj['run_task_id']) && \is_string($proj['run_task_id'])
                ? trim($proj['run_task_id'])
                : null,
            'meta'        => [
                'project_id'       => $projectId,
                'slide_count'      => $slideCount,
                'completed_slides' => $completed,
                'status'           => $status,
            ],
            'created_at'  => date('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return array{project_id: string, material: array<string, mixed>}|null
     */
    public static function resolveByProjectId(
        \PDO $pdo,
        int $conversationId,
        int $userId,
        string $projectId,
    ): ?array {
        require_once dirname(__DIR__) . '/library/SlideProjectRegistry.php';

        $projectId = trim($projectId);
        if ($projectId === '') {
            return null;
        }

        $row = SlideProjectRegistry::resolveProjectAccess($pdo, $projectId, $userId, $conversationId);
        if ($row === null) {
            return null;
        }

        $manifest = SlideProjectRegistry::loadManifest($projectId);
        $material = self::plannerRow(\is_array($manifest) ? $manifest : ['project_id' => $projectId]);

        return $material !== null
            ? ['project_id' => $projectId, 'material' => $material]
            : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function listPlannerRowsForConversation(
        \PDO $pdo,
        int $conversationId,
        int $userId,
        int $limit = 12,
    ): array {

        $stmt = $pdo->prepare(
            'SELECT project_id, title, slide_count, status, meta_json, updated_at
             FROM oaao_slide_project
             WHERE conversation_id = ? AND user_id = ?
             ORDER BY updated_at DESC
             LIMIT ' . max(1, min($limit, 24)),
        );
        $stmt->execute([$conversationId, $userId]);
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $pid = trim((string) ($row['project_id'] ?? ''));
            if ($pid === '') {
                continue;
            }
            $manifest = null;
            $mj = $row['meta_json'] ?? null;
            if (\is_string($mj) && $mj !== '') {
                $decoded = json_decode($mj, true);
                if (\is_array($decoded)) {
                    $manifest = $decoded;
                }
            }
            if (! \is_array($manifest)) {
                $manifest = [
                    'project_id'  => $pid,
                    'title'       => $row['title'] ?? 'Slide project',
                    'slide_count' => (int) ($row['slide_count'] ?? 0),
                    'status'      => $row['status'] ?? 'ready',
                ];
            }
            $mat = self::plannerRow($manifest);
            if ($mat !== null) {
                $mat['updated_at'] = (string) ($row['updated_at'] ?? '');
                $out[] = $mat;
            }
        }

        return $out;
    }

    /**
     * @return array{path: string, name: string}|null
     */
    public static function resolveDownloadPath(
        \PDO $pdo,
        int $userId,
        int $conversationId,
        string $uri,
    ): ?array {
        $uri = trim($uri);
        if ($uri === '') {
            return null;
        }

        $pathPart = parse_url($uri, PHP_URL_PATH);
        if (! \is_string($pathPart) || ! str_contains($pathPart, '/slide-designer/api/download')) {
            return null;
        }

        $query = [];
        parse_str((string) parse_url($uri, PHP_URL_QUERY), $query);
        $projectId = trim((string) ($query['project_id'] ?? ''));
        $file = trim((string) ($query['file'] ?? ''));
        if ($projectId === '' || $file === '' || str_contains($file, '..') || str_contains($file, '/')) {
            return null;
        }

        $cid = (int) ($query['conversation_id'] ?? 0);
        if ($cid < 1) {
            $cid = $conversationId;
        }

        require_once dirname(__DIR__) . '/library/SlideProjectRegistry.php';
        require_once dirname(__DIR__) . '/library/SlideProjectStorage.php';

        if (SlideProjectRegistry::resolveProjectAccess($pdo, $projectId, $userId, $cid) === null) {
            return null;
        }

        $base = SlideProjectStorage::projectDir($projectId);
        $full = $base . '/' . $file;
        $real = realpath($full);
        $baseReal = realpath($base);
        if ($real === false || $baseReal === false || ! str_starts_with($real, $baseReal) || ! is_file($real)) {
            return null;
        }

        return [
            'path' => $real,
            'name' => basename($real),
        ];
    }

    public static function readProjectTextFile(string $projectId, string $fileName, int $maxChars): string
    {
        $projectId = trim($projectId);
        $fileName = trim($fileName);
        if ($projectId === '' || $fileName === '' || str_contains($fileName, '..') || str_contains($fileName, '/')) {
            return '';
        }

        require_once dirname(__DIR__) . '/library/SlideProjectStorage.php';
        $base = SlideProjectStorage::projectDir($projectId);
        $full = $base . '/' . $fileName;
        $real = realpath($full);
        $baseReal = realpath($base);
        if ($real === false || $baseReal === false || ! str_starts_with($real, $baseReal) || ! is_file($real)) {
            return '';
        }

        $raw = @file_get_contents($real);
        if (! \is_string($raw) || trim($raw) === '') {
            return '';
        }

        return mb_substr(trim($raw), 0, max(1, $maxChars), 'UTF-8');
    }

    /**
     * Merge slide_project materials into meta and sync SQLite index.
     *
     * @param array<string, mixed> $meta
     *
     * @return array<string, mixed>
     */
    public static function enrichAndSyncAssistantMeta(
        \PDO $pdo,
        int $conversationId,
        int $messageId,
        int $userId,
        ?int $workspaceId,
        array $meta,
    ): array {
        require_once dirname(__DIR__) . '/library/SlideProjectRegistry.php';
        $proj = $meta['slide_project'] ?? null;
        if (! \is_array($proj)) {
            return $meta;
        }
        $materials = SlideProjectRegistry::materialsFromManifest($proj);
        if ($materials !== []) {
            $existing = $meta['materials'] ?? [];
            $meta['materials'] = array_merge(
                \is_array($existing) ? $existing : [],
                $materials,
            );
        }
        SlideProjectRegistry::syncFromAssistantMeta(
            $pdo,
            $conversationId,
            $messageId,
            $userId,
            $workspaceId,
            $meta,
        );

        return $meta;
    }
}
