<?php

declare(strict_types=1);

namespace oaaoai\livemeeting;

require_once dirname(__DIR__, 3) . '/core/default/library/TenantBlobStorage.php';
require_once dirname(__DIR__, 3) . '/core/default/library/StorageDomain.php';

use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\TenantBlobStorage;

/** Archive live-meeting session metadata/audio to tenant object storage. */
final class LiveMeetingBlobSync
{
    public static function flushSessionMeta(\PDO $pdo, int $tenantId, string $sessionId): ?string
    {
        if ($tenantId < 1 || trim($sessionId) === '') {
            return null;
        }

        $metaPath = LiveMeetingStorage::sessionDir($sessionId) . '/meta.json';
        if (! is_file($metaPath)) {
            return null;
        }

        $content = file_get_contents($metaPath);
        if ($content === false) {
            return null;
        }

        $blob = new TenantBlobStorage($pdo, $tenantId, StorageDomain::LIVE_MEETING);
        $rel = 'sessions/' . $sessionId . '/meta.json';
        $locator = $blob->putContent($content, $rel);

        return $locator->toJson();
    }

    /**
     * @return list<string> uploaded relative keys
     */
    public static function flushSessionAudio(\PDO $pdo, int $tenantId, string $sessionId): array
    {
        if ($tenantId < 1 || trim($sessionId) === '') {
            return [];
        }

        $audioDir = LiveMeetingStorage::sessionDir($sessionId) . '/audio';
        if (! is_dir($audioDir)) {
            return [];
        }

        $blob = new TenantBlobStorage($pdo, $tenantId, StorageDomain::LIVE_MEETING);
        $uploaded = [];
        foreach (glob($audioDir . '/*.pcm') ?: [] as $file) {
            if (! is_file($file)) {
                continue;
            }
            $name = basename($file);
            $rel = 'sessions/' . $sessionId . '/audio/' . $name;
            $blob->putUploadedFile($file, $rel);
            $uploaded[] = $rel;
        }

        return $uploaded;
    }
}
