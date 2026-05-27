<?php

declare(strict_types=1);

namespace oaaoai\chat;

require_once __DIR__ . '/AgentMaterialStorage.php';

/**
 * Conversation materials — indexed from assistant {@code meta_json} (artifacts + explicit materials).
 */
final class ChatConversationMaterial
{
    /** Distributor module root ({@code …/oaaoai/oaaoai}). */
    private static function moduleRoot(): string
    {
        return dirname(__DIR__, 3);
    }

    /**
     * Replace all material rows for one assistant message from decoded meta.
     *
     * @param array<string, mixed> $meta
     */
    public static function syncFromMessageMeta(
        \PDO $pdo,
        int $conversationId,
        int $messageId,
        array $meta,
    ): void {
        require_once dirname(__DIR__) . '/controller/api/_ensure_conversation_material_schema.php';
        oaao_chat_ensure_conversation_material_schema($pdo);

        $items = self::normalizeFromMeta($meta);
        $pdo->prepare('DELETE FROM oaao_conversation_material WHERE conversation_id = ? AND message_id = ?')
            ->execute([$conversationId, $messageId]);

        if ($items === []) {
            return;
        }

        $stmt = $pdo->prepare(
            'INSERT INTO oaao_conversation_material (
                conversation_id, message_id, material_id, kind, category, title,
                mime, size_bytes, uri, task_id, meta_json, storage_locator_json, sort_order, created_at
            ) VALUES (
                :conversation_id, :message_id, :material_id, :kind, :category, :title,
                :mime, :size_bytes, :uri, :task_id, :meta_json, :storage_locator_json, :sort_order, :created_at
            )',
        );

        $sort = 0;
        foreach ($items as $row) {
            $metaJson = null;
            if (isset($row['meta']) && \is_array($row['meta']) && $row['meta'] !== []) {
                try {
                    $metaJson = json_encode($row['meta'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    $metaJson = null;
                }
            }
            $locJson = AgentMaterialStorage::locatorJsonFromMaterialRow($row);
            $stmt->execute([
                'conversation_id'       => $conversationId,
                'message_id'            => $messageId,
                'material_id'           => (string) ($row['material_id'] ?? ''),
                'kind'                  => (string) ($row['kind'] ?? 'file'),
                'category'              => (string) ($row['category'] ?? 'document'),
                'title'                 => (string) ($row['title'] ?? 'File'),
                'mime'                  => $row['mime'] ?? null,
                'size_bytes'            => isset($row['size_bytes']) ? (int) $row['size_bytes'] : null,
                'uri'                   => $row['uri'] ?? null,
                'task_id'               => $row['task_id'] ?? null,
                'meta_json'             => $metaJson,
                'storage_locator_json'  => $locJson,
                'sort_order'            => $sort++,
                'created_at'            => (string) ($row['created_at'] ?? date('Y-m-d H:i:s')),
            ]);
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function listForMessage(\PDO $pdo, int $conversationId, int $messageId): array
    {
        require_once dirname(__DIR__) . '/controller/api/_ensure_conversation_material_schema.php';
        oaao_chat_ensure_conversation_material_schema($pdo);

        $stmt = $pdo->prepare(
            'SELECT material_id, kind, category, title, mime, size_bytes, uri, task_id, meta_json, storage_locator_json, sort_order, created_at
             FROM oaao_conversation_material
             WHERE conversation_id = ? AND message_id = ?
             ORDER BY sort_order ASC, id ASC',
        );
        $stmt->execute([$conversationId, $messageId]);
        /** @var list<array<string, mixed>> $rows */
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        $out = [];
        foreach ($rows as $row) {
            $meta = null;
            $mj = $row['meta_json'] ?? null;
            if (\is_string($mj) && $mj !== '') {
                $decoded = json_decode($mj, true);
                $meta = \is_array($decoded) ? $decoded : null;
            }
            unset($row['meta_json']);
            $row['meta'] = $meta;
            $locJson = isset($row['storage_locator_json']) ? (string) $row['storage_locator_json'] : '';
            unset($row['storage_locator_json']);
            if ($locJson !== '') {
                $row['storage_locator_json'] = $locJson;
            }
            $out[] = $row;
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $meta
     *
     * @return list<array<string, mixed>>
     */
    public static function normalizeFromMeta(array $meta): array
    {
        /** @var array<string, true> $seen */
        $seen = [];
        /** @var list<array<string, mixed>> $out */
        $out = [];

        $taskId = '';
        $pipe = $meta['oaao_pipeline'] ?? null;
        if (\is_array($pipe)) {
            $taskId = isset($pipe['task_id']) && \is_string($pipe['task_id']) ? trim($pipe['task_id']) : '';
        }

        $proj = $meta['slide_project'] ?? null;
        if (\is_array($proj)) {
            $row = self::slideProjectMaterialRow($proj);
            if ($row !== null) {
                $key = (string) ($row['material_id'] ?? '');
                if ($key !== '' && ! isset($seen[$key])) {
                    $seen[$key] = true;
                    $out[] = $row;
                }
            }
        }

        $explicit = $meta['materials'] ?? null;
        if (\is_array($explicit)) {
            foreach ($explicit as $raw) {
                if (! \is_array($raw)) {
                    continue;
                }
                $row = self::normalizeRow($raw, $taskId);
                if ($row === null) {
                    continue;
                }
                $key = (string) ($row['material_id'] ?? '');
                if ($key === '' || isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                $out[] = $row;
            }
        }

        if (\is_array($pipe)) {
            $arts = $pipe['artifacts'] ?? null;
            if (\is_array($arts)) {
                foreach ($arts as $raw) {
                    if (! \is_array($raw)) {
                        continue;
                    }
                    $row = self::normalizeArtifact($raw, $taskId);
                    if ($row === null) {
                        continue;
                    }
                    $key = (string) ($row['material_id'] ?? '');
                    if ($key === '' || isset($seen[$key])) {
                        continue;
                    }
                    $seen[$key] = true;
                    $out[] = $row;
                }
            }
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $raw
     *
     * @return array<string, mixed>|null
     */
    private static function normalizeRow(array $raw, string $defaultTaskId): ?array
    {
        $id = isset($raw['material_id']) && \is_string($raw['material_id'])
            ? trim($raw['material_id'])
            : (isset($raw['id']) && \is_string($raw['id']) ? trim($raw['id']) : '');
        if ($id === '') {
            return null;
        }
        $title = trim((string) ($raw['title'] ?? $raw['name'] ?? 'File'));
        $mime = isset($raw['mime']) && \is_string($raw['mime']) ? trim($raw['mime']) : '';
        $category = self::resolveCategory(
            isset($raw['category']) && \is_string($raw['category']) ? $raw['category'] : '',
            $mime,
            (string) ($raw['kind'] ?? ''),
            (string) ($raw['agent_kind'] ?? ''),
            $title,
            isset($raw['uri']) && \is_string($raw['uri']) ? $raw['uri'] : '',
        );

        return [
            'material_id' => $id,
            'kind'        => trim((string) ($raw['kind'] ?? 'file')) ?: 'file',
            'category'    => $category,
            'title'       => $title !== '' ? $title : 'File',
            'mime'        => $mime !== '' ? $mime : null,
            'size_bytes'  => isset($raw['size_bytes']) ? (int) $raw['size_bytes'] : null,
            'uri'         => isset($raw['uri']) && \is_string($raw['uri']) && trim($raw['uri']) !== ''
                ? trim($raw['uri'])
                : null,
            'task_id'     => trim((string) ($raw['task_id'] ?? $defaultTaskId)) ?: null,
            'meta'        => isset($raw['meta']) && \is_array($raw['meta']) ? $raw['meta'] : null,
            'storage_locator' => isset($raw['storage_locator']) && \is_array($raw['storage_locator'])
                ? $raw['storage_locator']
                : null,
            'created_at'  => (string) ($raw['created_at'] ?? date('Y-m-d H:i:s')),
        ];
    }

    /**
     * @param array<string, mixed> $artifact
     *
     * @return array<string, mixed>|null
     */
    private static function normalizeArtifact(array $artifact, string $defaultTaskId): ?array
    {
        $id = isset($artifact['id']) && \is_string($artifact['id']) ? trim($artifact['id']) : '';
        if ($id === '') {
            return null;
        }
        $name = trim((string) ($artifact['name'] ?? 'File'));
        $mime = isset($artifact['mime']) && \is_string($artifact['mime']) ? trim($artifact['mime']) : '';
        $agentKind = isset($artifact['agent_kind']) && \is_string($artifact['agent_kind'])
            ? trim($artifact['agent_kind'])
            : '';
        $rt = isset($artifact['run_task_id']) && \is_string($artifact['run_task_id'])
            ? trim($artifact['run_task_id'])
            : $defaultTaskId;

        $row = [
            'material_id' => $id,
            'kind'        => 'artifact',
            'category'    => self::resolveCategory(
                '',
                $mime,
                'artifact',
                $agentKind,
                $name,
                isset($artifact['uri']) && \is_string($artifact['uri']) ? $artifact['uri'] : '',
            ),
            'title'       => $name !== '' ? $name : 'File',
            'mime'        => $mime !== '' ? $mime : null,
            'size_bytes'  => isset($artifact['size_bytes']) ? (int) $artifact['size_bytes'] : null,
            'uri'         => isset($artifact['uri']) && \is_string($artifact['uri']) && trim($artifact['uri']) !== ''
                ? trim($artifact['uri'])
                : null,
            'task_id'     => $rt !== '' ? $rt : null,
            'meta'        => $artifact,
            'storage_locator' => isset($artifact['storage_locator']) && \is_array($artifact['storage_locator'])
                ? $artifact['storage_locator']
                : null,
            'created_at'  => date('Y-m-d H:i:s'),
        ];
        if ($row['uri'] === null && isset($artifact['storage_locator']) && \is_array($artifact['storage_locator'])) {
            // uri filled after persist with conversation id — index row may still resolve via locator
        }

        return $row;
    }

    private static function resolveCategory(
        string $explicit,
        string $mime,
        string $kind,
        string $agentKind,
        string $title = '',
        string $uri = '',
    ): string {
        $cat = strtolower(trim($explicit));
        if (\in_array($cat, ['document', 'image', 'code', 'link', 'slide'], true)) {
            return $cat;
        }
        if ($uri !== '' && preg_match('#^https?://#i', $uri) === 1 && $mime === '') {
            return 'link';
        }
        if ($kind === 'slide_preview' || $agentKind === 'slide_designer' || $agentKind === 'slides') {
            if (str_contains($mime, 'presentation') || str_ends_with(strtolower($title), '.pptx')) {
                return 'document';
            }

            return 'slide';
        }
        if (str_starts_with($mime, 'image/')) {
            return 'image';
        }
        $lowerMime = strtolower($mime);
        if (preg_match('#/(x-)?(python|javascript|typescript|html|css|json|xml|shell)#', $lowerMime) === 1
            || str_contains($lowerMime, 'text/plain')
        ) {
            return 'code';
        }
        $nameHint = strtolower($title);
        if (preg_match('/\.(py|js|ts|tsx|jsx|html|css|json|txt|sh|php)$/i', $nameHint) === 1) {
            return 'code';
        }

        return 'document';
    }

    /**
     * Quick count for UI affordances without hitting the materials table.
     *
     * @param array<string, mixed>|null $meta
     */
    public static function countFromMeta(?array $meta): int
    {
        if ($meta === null || $meta === []) {
            return 0;
        }

        return \count(self::normalizeFromMeta($meta));
    }

  /**
     * Stable material id for a slide project (used as {@code active_material_id}).
     */
    public static function slideMaterialId(string $projectId): string
    {
        return 'slide-' . $projectId;
    }

    /**
     * @param array<string, mixed> $proj {@code meta.slide_project}
     *
     * @return array<string, mixed>|null
     */
    public static function slideProjectMaterialRow(array $proj): ?array
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
     * Resolve {@code active_material_id} to project id + registry row.
     *
     * @return array{project_id: string, material: array<string, mixed>}|null
     */
    public static function resolveSlideProjectMaterial(
        \PDO $pdo,
        int $conversationId,
        int $userId,
        string $materialId,
        ?object $slideApi = null,
    ): ?array {
        require_once dirname(__DIR__) . '/controller/api/_ensure_conversation_material_schema.php';
        oaao_chat_ensure_conversation_material_schema($pdo);

        $projectId = self::resolveSlideProjectIdFromMaterialId($pdo, $conversationId, $materialId);
        if ($projectId === '' || $slideApi === null) {
            return null;
        }

        return $slideApi->resolveSlideMaterialByProjectId($pdo, $conversationId, $userId, $projectId);
    }

    private static function resolveSlideProjectIdFromMaterialId(
        \PDO $pdo,
        int $conversationId,
        string $materialId,
    ): string {
        $mid = trim($materialId);
        if ($mid === '') {
            return '';
        }
        if (str_starts_with($mid, 'slide-')) {
            return trim(substr($mid, 6));
        }
        $stmt = $pdo->prepare(
            'SELECT meta_json FROM oaao_conversation_material
             WHERE conversation_id = ? AND material_id = ? ORDER BY id DESC LIMIT 1',
        );
        $stmt->execute([$conversationId, $mid]);
        $mj = $stmt->fetchColumn();
        if (\is_string($mj) && $mj !== '') {
            $decoded = json_decode($mj, true);
            if (\is_array($decoded) && isset($decoded['project_id'])) {
                return trim((string) $decoded['project_id']);
            }
        }

        return '';
    }

    /**
     * Latest slide-project materials in a conversation (for planner / library UI).
     *
     * @return list<array<string, mixed>>
     */
    public static function listSlideProjectsForConversation(
        \PDO $pdo,
        int $conversationId,
        int $userId,
        int $limit = 12,
        ?object $slideApi = null,
    ): array {
        if ($slideApi === null) {
            return [];
        }

        return $slideApi->listSlidePlannerRowsForConversation($pdo, $conversationId, $userId, $limit);
    }

    /**
     * Planner / orchestrator payload — slide projects + recent file materials.
     *
     * @return list<array<string, mixed>>
     */
    public static function catalogForPlanner(
        \PDO $pdo,
        int $conversationId,
        int $userId,
        int $limit = 16,
        ?object $slideApi = null,
    ): array {
        require_once dirname(__DIR__) . '/controller/api/_ensure_conversation_material_schema.php';
        oaao_chat_ensure_conversation_material_schema($pdo);

        /** @var array<string, true> $seen */
        $seen = [];
        $out = [];

        foreach (self::listSlideProjectsForConversation($pdo, $conversationId, $userId, 8, $slideApi) as $row) {
            $key = (string) ($row['material_id'] ?? '');
            if ($key === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = $row;
        }

        $stmt = $pdo->prepare(
            'SELECT material_id, kind, category, title, mime, size_bytes, uri, task_id, meta_json, created_at
             FROM oaao_conversation_material
             WHERE conversation_id = ?
             ORDER BY id DESC
             LIMIT ' . max(1, min($limit, 32)),
        );
        $stmt->execute([$conversationId]);
        foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [] as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $key = trim((string) ($row['material_id'] ?? ''));
            if ($key === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $meta = null;
            $mj = $row['meta_json'] ?? null;
            if (\is_string($mj) && $mj !== '') {
                $decoded = json_decode($mj, true);
                $meta = \is_array($decoded) ? $decoded : null;
            }
            $out[] = [
                'material_id' => $key,
                'kind'        => (string) ($row['kind'] ?? 'file'),
                'category'    => (string) ($row['category'] ?? 'document'),
                'title'       => (string) ($row['title'] ?? 'File'),
                'mime'        => $row['mime'] ?? null,
                'size_bytes'  => isset($row['size_bytes']) ? (int) $row['size_bytes'] : null,
                'uri'         => $row['uri'] ?? null,
                'task_id'     => $row['task_id'] ?? null,
                'meta'        => $meta,
                'created_at'  => (string) ($row['created_at'] ?? ''),
            ];
            if (\count($out) >= $limit) {
                break;
            }
        }

        return $out;
    }

    /**
     * Materials for zip export — one message or whole conversation.
     *
     * @return list<array<string, mixed>>
     */
    public static function listForZipExport(\PDO $pdo, int $conversationId, int $messageId = 0): array
    {
        if ($messageId > 0) {
            return self::listForMessage($pdo, $conversationId, $messageId);
        }

        require_once dirname(__DIR__) . '/controller/api/_ensure_conversation_material_schema.php';
        oaao_chat_ensure_conversation_material_schema($pdo);

        $stmt = $pdo->prepare(
            'SELECT material_id, kind, category, title, mime, size_bytes, uri, task_id, meta_json, sort_order, created_at
             FROM oaao_conversation_material
             WHERE conversation_id = ?
             ORDER BY message_id ASC, sort_order ASC, id ASC',
        );
        $stmt->execute([$conversationId]);
        /** @var list<array<string, mixed>> $rows */
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $meta = null;
            $mj = $row['meta_json'] ?? null;
            if (\is_string($mj) && $mj !== '') {
                $decoded = json_decode($mj, true);
                $meta = \is_array($decoded) ? $decoded : null;
            }
            unset($row['meta_json']);
            $row['meta'] = $meta;
            $out[] = $row;
        }

        return $out;
    }

    /**
     * Map a material {@code uri} (slide-designer download API) to an on-disk file.
     *
     * @return array{path: string, name: string}|null
     */
    public static function resolveDownloadablePath(
        \PDO $pdo,
        int $userId,
        int $conversationId,
        string $uri,
        ?object $slideApi = null,
        ?\PDO $canonicalPdo = null,
        int $tenantId = 0,
        ?array $materialRow = null,
    ): ?array {
        $uri = trim($uri);
        if ($uri === '') {
            return null;
        }

        if ($materialRow !== null && $canonicalPdo instanceof \PDO && $tenantId > 0) {
            $locJson = AgentMaterialStorage::locatorJsonFromMaterialRow($materialRow);
            if ($locJson !== null) {
                try {
                    $resolved = AgentMaterialStorage::getStorage($canonicalPdo, $tenantId, $locJson);
                    if (($resolved['mode'] ?? '') === 'local' && ! empty($resolved['absolute_path'])) {
                        $path = (string) $resolved['absolute_path'];
                        if (is_file($path)) {
                            $name = trim((string) ($materialRow['title'] ?? basename($path)));

                            return ['path' => $path, 'name' => $name !== '' ? $name : basename($path)];
                        }
                    }
                } catch (\Throwable) {
                }
            }
        }

        $pathPart = parse_url($uri, PHP_URL_PATH);
        if (\is_string($pathPart) && str_contains($pathPart, '/chat/api/material_media') && $canonicalPdo instanceof \PDO && $tenantId > 0) {
            parse_str((string) parse_url($uri, PHP_URL_QUERY), $q);
            $materialId = isset($q['material_id']) ? trim((string) $q['material_id']) : '';
            if ($materialId !== '') {
                require_once dirname(__DIR__) . '/controller/api/_ensure_conversation_material_schema.php';
                oaao_chat_ensure_conversation_material_schema($pdo);
                $st = $pdo->prepare(
                    'SELECT title, storage_locator_json, meta_json FROM oaao_conversation_material
                     WHERE conversation_id = ? AND material_id = ? ORDER BY id DESC LIMIT 1',
                );
                $st->execute([$conversationId, $materialId]);
                $row = $st->fetch(\PDO::FETCH_ASSOC);
                if (\is_array($row)) {
                    $locJson = AgentMaterialStorage::locatorJsonFromMaterialRow($row);
                    if ($locJson !== null) {
                        try {
                            $resolved = AgentMaterialStorage::getStorage($canonicalPdo, $tenantId, $locJson);
                            if (($resolved['mode'] ?? '') === 'local' && ! empty($resolved['absolute_path'])) {
                                $path = (string) $resolved['absolute_path'];
                                if (is_file($path)) {
                                    $name = trim((string) ($row['title'] ?? basename($path)));

                                    return ['path' => $path, 'name' => $name !== '' ? $name : basename($path)];
                                }
                            }
                        } catch (\Throwable) {
                        }
                    }
                }
            }
        }

        $pathPart = parse_url($uri, PHP_URL_PATH);
        if (\is_string($pathPart) && str_contains($pathPart, '/slide-designer/api/download') && $slideApi !== null) {
            return $slideApi->resolveSlideProjectDownloadPath($pdo, $userId, $conversationId, $uri);
        }

        return null;
    }

    /**
     * Load prior material bodies for orchestrator regenerate / retry / continue.
     *
     * @return list<array{material_id: string, title: string, kind: string, body: string}>
     */
    public static function groundingContextForOrchestrator(
        \PDO $pdo,
        int $conversationId,
        int $userId,
        ?string $activeMaterialId = null,
        int $reuseMessageId = 0,
        ?object $slideApi = null,
        ?\PDO $canonicalPdo = null,
        int $tenantId = 0,
    ): array {
        if ($conversationId < 1 || $userId < 1) {
            return [];
        }

        require_once dirname(__DIR__) . '/controller/api/_ensure_conversation_material_schema.php';
        oaao_chat_ensure_conversation_material_schema($pdo);

        /** @var list<array<string, mixed>> $rows */
        $rows = [];
        if ($reuseMessageId > 0) {
            $rows = self::listForMessage($pdo, $conversationId, $reuseMessageId);
        }
        if ($rows === []) {
            $stmt = $pdo->prepare(
                'SELECT material_id, kind, category, title, mime, size_bytes, uri, task_id, meta_json, storage_locator_json, created_at
                 FROM oaao_conversation_material
                 WHERE conversation_id = ?
                 ORDER BY id DESC
                 LIMIT 12',
            );
            $stmt->execute([$conversationId]);
            foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [] as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $meta = null;
                $mj = $row['meta_json'] ?? null;
                if (\is_string($mj) && $mj !== '') {
                    $decoded = json_decode($mj, true);
                    $meta = \is_array($decoded) ? $decoded : null;
                }
                unset($row['meta_json']);
                $row['meta'] = $meta;
                $rows[] = $row;
            }
        }

        /** @var list<array{material_id: string, title: string, kind: string, body: string}> $out */
        $out = [];
        /** @var array<string, true> $seen */
        $seen = [];
        $totalChars = 0;
        $maxTotal = 28_000;

        foreach ($rows as $row) {
            $body = self::extractGroundingBodyFromMaterialRow(
                $pdo,
                $userId,
                $conversationId,
                $row,
                $slideApi,
                $canonicalPdo,
                $tenantId,
            );
            if ($body === '') {
                continue;
            }
            $mid = trim((string) ($row['material_id'] ?? ''));
            if ($mid === '' || isset($seen[$mid])) {
                continue;
            }
            if ($totalChars >= $maxTotal) {
                break;
            }
            $clip = mb_substr($body, 0, min(14_000, $maxTotal - $totalChars), 'UTF-8');
            $seen[$mid] = true;
            $totalChars += mb_strlen($clip, 'UTF-8');
            $out[] = [
                'material_id' => $mid,
                'title'       => trim((string) ($row['title'] ?? $mid)),
                'kind'        => trim((string) ($row['kind'] ?? 'file')),
                'body'        => $clip,
            ];
        }

        $active = trim((string) ($activeMaterialId ?? ''));
        if ($active !== '' && ! isset($seen[$active])) {
            $resolved = self::resolveSlideProjectMaterial($pdo, $conversationId, $userId, $active, $slideApi);
            if ($resolved !== null && $slideApi !== null) {
                $outline = $slideApi->readSlideProjectTextFile($resolved['project_id'], 'deck_outline.md', 14_000);
                if ($outline !== '') {
                    $out[] = [
                        'material_id' => $active,
                        'title'       => 'deck_outline.md',
                        'kind'        => 'slide_project',
                        'body'        => $outline,
                    ];
                }
            }
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function extractGroundingBodyFromMaterialRow(
        \PDO $pdo,
        int $userId,
        int $conversationId,
        array $row,
        ?object $slideApi = null,
        ?\PDO $canonicalPdo = null,
        int $tenantId = 0,
    ): string {
        $meta = $row['meta'] ?? null;
        if (\is_array($meta)) {
            foreach (['body', 'grounding_text', 'grounding', 'excerpt'] as $key) {
                $v = $meta[$key] ?? null;
                if (\is_string($v) && trim($v) !== '') {
                    return trim($v);
                }
            }
        }

        $uri = isset($row['uri']) && \is_string($row['uri']) ? trim($row['uri']) : '';
        if ($uri === '') {
            return '';
        }

        $mime = isset($row['mime']) && \is_string($row['mime']) ? strtolower(trim($row['mime'])) : '';
        $title = strtolower(trim((string) ($row['title'] ?? '')));
        $textLike = str_contains($mime, 'markdown')
            || str_contains($mime, 'text/')
            || str_ends_with($title, '.md')
            || str_ends_with($title, '.txt');
        if (! $textLike) {
            return '';
        }

        $resolved = self::resolveDownloadablePath(
            $pdo,
            $userId,
            $conversationId,
            $uri,
            $slideApi,
            $canonicalPdo,
            $tenantId,
            $row,
        );
        if ($resolved === null) {
            return '';
        }

        $raw = @file_get_contents($resolved['path']);
        if (! \is_string($raw) || trim($raw) === '') {
            return '';
        }

        return trim($raw);
    }

    /**
     * Unique entry name inside a zip archive.
     */
    public static function zipEntryName(string $materialId, string $fileName): string
    {
        $safeId = preg_replace('/[^a-zA-Z0-9_-]+/', '_', $materialId) ?? 'file';
        $safeId = trim($safeId, '_') !== '' ? trim($safeId, '_') : 'file';
        $base = basename($fileName);
        $base = str_replace(['/', '\\', "\0"], '_', $base);

        return $safeId . '__' . $base;
    }
}
