<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

/**
 * Index + access control for on-disk slide projects (SD-3).
 */
final class SlideProjectRegistry
{
    /**
     * @return array<string, mixed> manifest
     */
    public static function createProject(
        \PDO $pdo,
        int $userId,
        int $conversationId,
        ?int $workspaceId,
        string $title = 'Slide project',
        int $slideCount = 10,
        ?string $templateId = null,
    ): array {
        require_once dirname(__DIR__) . '/controller/api/_ensure_slide_project_schema.php';
        oaao_slide_designer_ensure_schema($pdo);

        $projectId = 'sp-' . bin2hex(random_bytes(6));
        $deckTitle = trim($title) !== '' ? trim($title) : 'Slide project';
        $count = max(3, min($slideCount, 20));
        SlideProjectStorage::ensureProjectDir($projectId);

        $manifest = [
            'project_id'      => $projectId,
            'title'           => $deckTitle,
            'slide_count'     => $count,
            'status'          => 'draft',
            'conversation_id' => $conversationId,
            'assistant_message_id' => null,
            'user_id'         => $userId,
            'workspace_id'    => $workspaceId,
            'pages'           => [],
            'files'           => [],
        ];
        $tid = is_string($templateId) ? trim($templateId) : '';
        if ($tid !== '') {
            $manifest['template_id'] = $tid;
        }
        $manifestPath = SlideProjectStorage::manifestPath($projectId);
        file_put_contents(
            $manifestPath,
            json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        );

        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare(
            'INSERT INTO oaao_slide_project (
                project_id, conversation_id, message_id, user_id, workspace_id,
                title, slide_count, status, root_path, meta_json, created_at, updated_at
            ) VALUES (
                :project_id, :conversation_id, NULL, :user_id, :workspace_id,
                :title, :slide_count, :status, :root_path, :meta_json, :created_at, :updated_at
            )',
        );
        $metaJson = json_encode($manifest, JSON_UNESCAPED_UNICODE);
        $stmt->execute([
            'project_id'      => $projectId,
            'conversation_id' => $conversationId,
            'user_id'         => $userId,
            'workspace_id'    => $workspaceId,
            'title'           => $deckTitle,
            'slide_count'     => $count,
            'status'          => 'draft',
            'root_path'       => SlideProjectStorage::projectDir($projectId),
            'meta_json'       => $metaJson !== false ? $metaJson : null,
            'created_at'      => $now,
            'updated_at'      => $now,
        ]);

        return $manifest;
    }

    /**
     * @return array{manifest: array<string, mixed>, row: array<string, mixed>}|null
     */
    public static function resumeProject(
        \PDO $pdo,
        string $projectId,
        int $userId,
        int $conversationId,
    ): ?array {
        $row = self::resolveProjectAccess($pdo, $projectId, $userId, $conversationId, true);
        if ($row === null) {
            return null;
        }
        $manifest = self::loadManifest($projectId);

        return [
            'manifest' => $manifest ?? ['project_id' => $projectId],
            'row'      => $row,
        ];
    }

    public static function latestProjectIdForConversation(
        \PDO $pdo,
        int $conversationId,
        int $userId,
    ): ?string {
        require_once dirname(__DIR__) . '/controller/api/_ensure_slide_project_schema.php';
        oaao_slide_designer_ensure_schema($pdo);

        $stmt = $pdo->prepare(
            'SELECT project_id FROM oaao_slide_project
             WHERE conversation_id = ? AND user_id = ?
             ORDER BY updated_at DESC LIMIT 1',
        );
        $stmt->execute([$conversationId, $userId]);
        $pid = $stmt->fetchColumn();

        return \is_string($pid) && $pid !== '' ? $pid : null;
    }

    public static function countSlidesWithHtml(string $projectId): int
    {
        $slidesDir = SlideProjectStorage::projectDir($projectId) . '/slides';
        if (! is_dir($slidesDir)) {
            return 0;
        }
        $count = 0;
        $paths = glob($slidesDir . '/*/slide.html');
        if (! \is_array($paths)) {
            return 0;
        }
        foreach ($paths as $path) {
            if (\is_string($path) && is_file($path)) {
                $count++;
            }
        }

        return $count;
    }

    public static function expectedSlideCount(string $projectId): int
    {
        $manifest = self::loadManifest($projectId);

        return max(0, (int) ($manifest['slide_count'] ?? 0));
    }

    /**
     * True when the deck on disk is not fully built yet (retry / restart should continue, not restart).
     */
    public static function shouldContinueProject(string $projectId, ?string $dbStatus = null): bool
    {
        $status = trim((string) ($dbStatus ?? ''));
        if ($status !== '' && $status !== 'ready') {
            return true;
        }
        $expected = self::expectedSlideCount($projectId);
        if ($expected < 1) {
            return false;
        }

        return self::countSlidesWithHtml($projectId) < $expected;
    }

    /**
     * @param array<string, mixed> $meta assistant_patch meta
     */
    public static function syncFromAssistantMeta(
        \PDO $pdo,
        int $conversationId,
        int $messageId,
        int $userId,
        ?int $workspaceId,
        array $meta,
    ): void {
        require_once dirname(__DIR__) . '/controller/api/_ensure_slide_project_schema.php';
        oaao_slide_designer_ensure_schema($pdo);

        $proj = $meta['slide_project'] ?? null;
        if (! \is_array($proj)) {
            return;
        }

        $projectId = trim((string) ($proj['project_id'] ?? ''));
        if ($projectId === '') {
            return;
        }

        $title = trim((string) ($proj['title'] ?? 'Slide project'));
        $slideCount = (int) ($proj['slide_count'] ?? 0);
        $status = trim((string) ($proj['status'] ?? 'ready')) ?: 'ready';
        $rootPath = SlideProjectStorage::projectDir($projectId);

        $metaJson = null;
        try {
            $metaJson = json_encode($proj, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $metaJson = null;
        }

        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare(
            'INSERT INTO oaao_slide_project (
                project_id, conversation_id, message_id, user_id, workspace_id,
                title, slide_count, status, root_path, meta_json, created_at, updated_at
            ) VALUES (
                :project_id, :conversation_id, :message_id, :user_id, :workspace_id,
                :title, :slide_count, :status, :root_path, :meta_json, :created_at, :updated_at
            )
            ON CONFLICT(project_id) DO UPDATE SET
                message_id = excluded.message_id,
                title = excluded.title,
                slide_count = excluded.slide_count,
                status = excluded.status,
                root_path = excluded.root_path,
                meta_json = excluded.meta_json,
                updated_at = excluded.updated_at',
        );
        $stmt->execute([
            'project_id'      => $projectId,
            'conversation_id' => $conversationId,
            'message_id'      => $messageId > 0 ? $messageId : null,
            'user_id'         => $userId,
            'workspace_id'    => $workspaceId,
            'title'           => $title,
            'slide_count'     => max(0, $slideCount),
            'status'          => $status,
            'root_path'       => $rootPath,
            'meta_json'       => $metaJson,
            'created_at'      => $now,
            'updated_at'      => $now,
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function loadManifest(string $projectId): ?array
    {
        $path = SlideProjectStorage::manifestPath($projectId);
        if (! is_readable($path)) {
            return null;
        }
        $raw = file_get_contents($path);
        if ($raw === false || $raw === '') {
            return null;
        }
        $decoded = json_decode($raw, true);

        return \is_array($decoded) ? $decoded : null;
    }

    /**
     * @return array{project_id: string, conversation_id: int, user_id: int}|null
     */
    public static function fetchAccessRow(\PDO $pdo, string $projectId): ?array
    {
        require_once dirname(__DIR__) . '/controller/api/_ensure_slide_project_schema.php';
        oaao_slide_designer_ensure_schema($pdo);

        $stmt = $pdo->prepare(
            'SELECT project_id, conversation_id, user_id FROM oaao_slide_project WHERE project_id = ? LIMIT 1',
        );
        $stmt->execute([$projectId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        return \is_array($row) ? $row : null;
    }

    /**
     * Resolve access for slide_html / download — orchestrator may write project.json before SQLite index sync.
     *
     * @return array{project_id: string, conversation_id: int, user_id: int}|null
     */
    public static function resolveProjectAccess(
        \PDO $pdo,
        string $projectId,
        int $userId,
        int $conversationId,
        bool $syncIndex = true,
    ): ?array {
        $projectId = trim($projectId);
        if ($projectId === '') {
            return null;
        }

        $row = self::fetchAccessRow($pdo, $projectId);
        if ($row !== null && self::userMayAccess($row, $userId, $conversationId)) {
            return $row;
        }

        $manifest = self::loadManifest($projectId);
        if ($manifest === null) {
            return null;
        }

        $manifestUserId = (int) ($manifest['user_id'] ?? 0);
        $manifestCid = (int) ($manifest['conversation_id'] ?? 0);
        $diskRow = [
            'project_id'      => $projectId,
            'conversation_id' => $manifestCid > 0 ? $manifestCid : $conversationId,
            'user_id'         => $manifestUserId > 0 ? $manifestUserId : $userId,
        ];
        if (! self::userMayAccess($diskRow, $userId, $conversationId)) {
            return null;
        }

        if ($syncIndex) {
            if ($manifestUserId < 1 && $userId > 0) {
                $manifest['user_id'] = $userId;
            }
            if ($manifestCid < 1 && $conversationId > 0) {
                $manifest['conversation_id'] = $conversationId;
            }
            self::upsertIndexFromManifest($pdo, $manifest);
        }

        return $diskRow;
    }

    /**
     * @param array<string, mixed> $manifest on-disk project.json
     */
    public static function upsertIndexFromManifest(\PDO $pdo, array $manifest): void
    {
        require_once dirname(__DIR__) . '/controller/api/_ensure_slide_project_schema.php';
        oaao_slide_designer_ensure_schema($pdo);

        $projectId = trim((string) ($manifest['project_id'] ?? ''));
        if ($projectId === '') {
            return;
        }

        $title = trim((string) ($manifest['title'] ?? 'Slide project'));
        $slideCount = (int) ($manifest['slide_count'] ?? 0);
        $status = trim((string) ($manifest['status'] ?? 'ready')) ?: 'ready';
        $conversationId = (int) ($manifest['conversation_id'] ?? 0);
        $userId = (int) ($manifest['user_id'] ?? 0);
        $messageId = (int) ($manifest['assistant_message_id'] ?? 0);
        $workspaceId = isset($manifest['workspace_id']) && $manifest['workspace_id'] !== null
            ? (int) $manifest['workspace_id']
            : null;

        $metaJson = null;
        try {
            $metaJson = json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $metaJson = null;
        }

        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare(
            'INSERT INTO oaao_slide_project (
                project_id, conversation_id, message_id, user_id, workspace_id,
                title, slide_count, status, root_path, meta_json, created_at, updated_at
            ) VALUES (
                :project_id, :conversation_id, :message_id, :user_id, :workspace_id,
                :title, :slide_count, :status, :root_path, :meta_json, :created_at, :updated_at
            )
            ON CONFLICT(project_id) DO UPDATE SET
                conversation_id = excluded.conversation_id,
                message_id = excluded.message_id,
                user_id = excluded.user_id,
                workspace_id = excluded.workspace_id,
                title = excluded.title,
                slide_count = excluded.slide_count,
                status = excluded.status,
                root_path = excluded.root_path,
                meta_json = excluded.meta_json,
                updated_at = excluded.updated_at',
        );
        $stmt->execute([
            'project_id'      => $projectId,
            'conversation_id' => $conversationId,
            'message_id'      => $messageId > 0 ? $messageId : null,
            'user_id'         => $userId,
            'workspace_id'    => $workspaceId,
            'title'           => $title !== '' ? $title : 'Slide project',
            'slide_count'     => max(0, $slideCount),
            'status'          => $status,
            'root_path'       => SlideProjectStorage::projectDir($projectId),
            'meta_json'       => $metaJson,
            'created_at'      => $now,
            'updated_at'      => $now,
        ]);
    }

    public static function userMayAccess(array $row, int $userId, int $conversationId): bool
    {
        if ($userId < 1) {
            return false;
        }
        if ((int) ($row['user_id'] ?? 0) !== $userId) {
            return false;
        }
        if ($conversationId > 0 && (int) ($row['conversation_id'] ?? 0) !== $conversationId) {
            return false;
        }

        return true;
    }

    /**
     * @param array<string, mixed> $manifest
     *
     * @return list<array<string, mixed>>
     */
    public static function materialsFromManifest(array $manifest): array
    {
        $projectId = trim((string) ($manifest['project_id'] ?? ''));
        if ($projectId === '') {
            return [];
        }

        $out = [];
        $files = $manifest['files'] ?? null;
        if (\is_array($files)) {
            foreach ($files as $f) {
                if (! \is_array($f)) {
                    continue;
                }
                $name = trim((string) ($f['name'] ?? ''));
                if ($name === '') {
                    continue;
                }
                $uri = isset($f['uri']) && is_string($f['uri']) && trim($f['uri']) !== ''
                    ? trim($f['uri'])
                    : SlideProjectStorage::downloadPath($projectId, $name);
                $out[] = [
                    'material_id' => (string) ($f['id'] ?? 'file-' . md5($name)),
                    'kind'        => 'file',
                    'category'    => (string) ($f['category'] ?? 'document'),
                    'title'       => $name,
                    'mime'        => $f['mime'] ?? null,
                    'size_bytes'  => isset($f['size_bytes']) ? (int) $f['size_bytes'] : null,
                    'uri'         => $uri,
                    'project_id'  => $projectId,
                ];
            }
        }

        return $out;
    }
}
