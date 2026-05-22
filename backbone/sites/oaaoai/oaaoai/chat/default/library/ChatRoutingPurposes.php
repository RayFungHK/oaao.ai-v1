<?php

declare(strict_types=1);

namespace oaaoai\chat;

use oaaoai\endpoints\CanonicalEndpointsRepository;
use Razy\Database;

/**
 * Enabled {@code oaao_purpose} rows exposed to the workspace chat header (orchestrator {@code purpose_id}).
 */
final class ChatRoutingPurposes
{
    public static function isChatRoutingPurposeKey(string $purposeKey): bool
    {
        $k = trim($purposeKey);

        return $k === 'chat' || str_starts_with($k, 'chat.');
    }

    /**
     * @return list<array{purpose_key: string, label: string}>
     */
    public static function listSelectable(?Database $canonicalDb): array
    {
        if (! $canonicalDb instanceof Database) {
            return [['purpose_key' => 'chat', 'label' => 'Chat']];
        }

        $repo = new CanonicalEndpointsRepository($canonicalDb);
        $rows = $repo->listPurposesWithDefaultEndpointName();

        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            if ((int) ($row['is_enabled'] ?? 0) !== 1) {
                continue;
            }
            $pk = trim((string) ($row['purpose_key'] ?? ''));
            if ($pk === '' || ! self::isChatRoutingPurposeKey($pk)) {
                continue;
            }
            $label = trim((string) ($row['label'] ?? ''));
            $out[] = [
                'purpose_key' => $pk,
                'label'       => $label !== '' ? $label : $pk,
            ];
        }

        if ($out === []) {
            return [['purpose_key' => 'chat', 'label' => 'Chat']];
        }

        return $out;
    }

    public static function defaultPurposeKey(?Database $canonicalDb): string
    {
        $list = self::listSelectable($canonicalDb);
        foreach ($list as $p) {
            if ($p['purpose_key'] === 'chat') {
                return 'chat';
            }
        }

        return $list[0]['purpose_key'] ?? 'chat';
    }

    public static function isAllowedKey(?Database $canonicalDb, string $purposeKey): bool
    {
        $want = trim($purposeKey);
        if ($want === '') {
            return false;
        }
        foreach (self::listSelectable($canonicalDb) as $p) {
            if ($p['purpose_key'] === $want) {
                return true;
            }
        }

        return false;
    }
}
