<?php

declare(strict_types=1);

namespace oaaoai\chat;

require_once dirname(__DIR__, 3) . '/core/default/library/TenantBlobStorage.php';
require_once dirname(__DIR__, 3) . '/core/default/library/StorageDomain.php';
require_once dirname(__DIR__, 3) . '/core/default/library/StorageLocator.php';

use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\StorageLocator;
use Oaaoai\Core\TenantBlobStorage;

/**
 * Unified blob I/O for agent-generated conversation materials ({@see StorageDomain::AGENT_MATERIALS}).
 */
final class AgentMaterialStorage
{
    public static function relativeKey(int $conversationId, string $materialId, string $fileName): string
    {
        $safeId = preg_replace('/[^a-zA-Z0-9_-]+/', '_', $materialId) ?: 'material';
        $base = basename(str_replace(["\0", '..'], '', trim($fileName)));
        if ($base === '') {
            $base = 'file.bin';
        }

        return max(0, $conversationId) . '/' . $safeId . '/' . $base;
    }

    public static function mediaApiUri(int $conversationId, string $materialId): string
    {
        return '/chat/api/material_media?' . http_build_query([
            'conversation_id' => max(0, $conversationId),
            'material_id'     => $materialId,
        ]);
    }

    /**
     * @return array{mode: string, absolute_path?: string, url?: string}
     */
    public static function getStorage(
        \PDO $canonicalPdo,
        int $tenantId,
        ?string $locatorJson,
        ?string $relativeKey = null,
    ): array {
        $blob = new TenantBlobStorage($canonicalPdo, $tenantId, StorageDomain::AGENT_MATERIALS);
        $legacy = $relativeKey !== null && trim($relativeKey) !== '' ? trim($relativeKey) : null;

        return $blob->presignOrAbsolute($locatorJson, $legacy, StorageDomain::defaultLocalRoot(StorageDomain::AGENT_MATERIALS));
    }

    public static function saveStorage(
        \PDO $canonicalPdo,
        int $tenantId,
        int $conversationId,
        string $materialId,
        string $bytes,
        string $fileName,
    ): StorageLocator {
        $blob = new TenantBlobStorage($canonicalPdo, $tenantId, StorageDomain::AGENT_MATERIALS);
        $rel = self::relativeKey($conversationId, $materialId, $fileName);

        return $blob->putContent($bytes, $rel);
    }

    public static function saveStorageFile(
        \PDO $canonicalPdo,
        int $tenantId,
        int $conversationId,
        string $materialId,
        string $sourcePath,
        string $fileName,
    ): StorageLocator {
        $blob = new TenantBlobStorage($canonicalPdo, $tenantId, StorageDomain::AGENT_MATERIALS);
        $rel = self::relativeKey($conversationId, $materialId, $fileName);

        return $blob->putUploadedFile($sourcePath, $rel);
    }

    /**
     * Persist artifact / material blobs referenced in assistant meta; mutates {@code $meta} in place.
     *
     * @param array<string, mixed> $meta
     */
    public static function persistMetaArtifacts(
        \PDO $canonicalPdo,
        int $tenantId,
        int $conversationId,
        array &$meta,
    ): void {
        if ($tenantId < 1 || $conversationId < 1) {
            return;
        }

        $pipe = $meta['oaao_pipeline'] ?? null;
        if (\is_array($pipe) && isset($pipe['artifacts']) && \is_array($pipe['artifacts'])) {
            /** @var list<array<string, mixed>> $arts */
            $arts = [];
            foreach ($pipe['artifacts'] as $raw) {
                if (! \is_array($raw)) {
                    continue;
                }
                $arts[] = self::persistOneArtifact($canonicalPdo, $tenantId, $conversationId, $raw);
            }
            $pipe['artifacts'] = $arts;
            $meta['oaao_pipeline'] = $pipe;
        }

        if (isset($meta['materials']) && \is_array($meta['materials'])) {
            /** @var list<array<string, mixed>> $mats */
            $mats = [];
            foreach ($meta['materials'] as $raw) {
                if (! \is_array($raw)) {
                    continue;
                }
                $mats[] = self::persistOneArtifact($canonicalPdo, $tenantId, $conversationId, $raw, preferMaterialId: true);
            }
            $meta['materials'] = $mats;
        }
    }

    /**
     * @param array<string, mixed> $artifact
     *
     * @return array<string, mixed>
     */
    private static function persistOneArtifact(
        \PDO $canonicalPdo,
        int $tenantId,
        int $conversationId,
        array $artifact,
        bool $preferMaterialId = false,
    ): array {
        if (! empty($artifact['storage_locator']) && \is_array($artifact['storage_locator'])) {
            return self::attachUri($artifact, $conversationId);
        }

        $materialId = $preferMaterialId && isset($artifact['material_id']) && \is_string($artifact['material_id'])
            ? trim($artifact['material_id'])
            : (isset($artifact['id']) && \is_string($artifact['id']) ? trim($artifact['id']) : '');
        if ($materialId === '') {
            return $artifact;
        }

        $name = trim((string) ($artifact['name'] ?? $artifact['title'] ?? 'file.bin'));
        if ($name === '') {
            $name = 'file.bin';
        }

        $bytes = self::readArtifactBytes($artifact);
        if ($bytes === null) {
            return $artifact;
        }

        try {
            $loc = self::saveStorage($canonicalPdo, $tenantId, $conversationId, $materialId, $bytes, $name);
            $artifact['storage_locator'] = $loc->toArray();
            $artifact['size_bytes'] = $loc->size ?? strlen($bytes);
            if (! isset($artifact['mime']) || trim((string) $artifact['mime']) === '') {
                $artifact['mime'] = self::guessMime($name);
            }
        } catch (\Throwable) {
            return $artifact;
        }

        return self::attachUri($artifact, $conversationId, $materialId);
    }

    /**
     * @param array<string, mixed> $artifact
     *
     * @return array<string, mixed>
     */
    private static function attachUri(array $artifact, int $conversationId, ?string $materialId = null): array
    {
        $mid = $materialId
            ?? (isset($artifact['material_id']) && \is_string($artifact['material_id']) ? trim($artifact['material_id']) : '')
            ?: (isset($artifact['id']) && \is_string($artifact['id']) ? trim($artifact['id']) : '');
        if ($mid !== '' && (! isset($artifact['uri']) || trim((string) $artifact['uri']) === '')) {
            $artifact['uri'] = self::mediaApiUri($conversationId, $mid);
        }

        return $artifact;
    }

    /**
     * @param array<string, mixed> $artifact
     */
    private static function readArtifactBytes(array $artifact): ?string
    {
        $b64 = isset($artifact['image_base64']) ? trim((string) $artifact['image_base64']) : '';
        if ($b64 === '' && isset($artifact['b64'])) {
            $b64 = trim((string) $artifact['b64']);
        }
        if ($b64 !== '') {
            $raw = base64_decode($b64, true);

            return \is_string($raw) && $raw !== '' ? $raw : null;
        }

        $path = isset($artifact['path']) ? trim((string) $artifact['path']) : '';
        if ($path === '' && isset($artifact['output_path'])) {
            $path = trim((string) $artifact['output_path']);
        }
        if ($path !== '' && is_file($path) && is_readable($path)) {
            $raw = file_get_contents($path);

            return \is_string($raw) && $raw !== '' ? $raw : null;
        }

        return null;
    }

    private static function guessMime(string $fileName): string
    {
        $ext = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));
        return match ($ext) {
            'png'  => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'webp' => 'image/webp',
            'gif'  => 'image/gif',
            'pdf'  => 'application/pdf',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'md'   => 'text/markdown',
            'txt'  => 'text/plain',
            'json' => 'application/json',
            'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            default => 'application/octet-stream',
        };
    }

    /**
     * @param array<string, mixed> $row material row (with meta and/or storage_locator_json)
     */
    public static function locatorJsonFromMaterialRow(array $row): ?string
    {
        if (isset($row['storage_locator_json']) && \is_string($row['storage_locator_json'])) {
            $j = trim($row['storage_locator_json']);
            if ($j !== '') {
                return $j;
            }
        }
        if (isset($row['storage_locator']) && \is_array($row['storage_locator'])) {
            try {
                return json_encode($row['storage_locator'], JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
            }
        }
        $meta = $row['meta'] ?? null;
        if (\is_array($meta) && isset($meta['storage_locator']) && \is_array($meta['storage_locator'])) {
            try {
                return json_encode($meta['storage_locator'], JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
            }
        }

        return null;
    }
}
