<?php

declare(strict_types=1);

namespace oaaoai\chat;

use oaaoai\vault\VaultChatScope;
use Razy\Database;

/**
 * Chat-facing facade for vault scope — SQL lives in {@see VaultChatScope} ({@code oaaoai/vault}).
 *
 * @deprecated Direct use from new code — prefer {@code api('vault')->scopeForChat()} where a controller is available.
 */
final class ChatVaultScope
{
    /**
     * @return list<int>
     */
    public static function vaultIdsForUserWorkspace(Database $db, int $uid, ?int $wid, ?object $authApi = null): array
    {
        return VaultChatScope::vaultIdsForUserWorkspace($db, $uid, $wid, $authApi);
    }

    /**
     * @return list<int>
     */
    public static function vaultIdsForRetrieval(Database $db, int $uid, ?int $wid, ?object $authApi = null): array
    {
        return VaultChatScope::vaultIdsForRetrieval($db, $uid, $wid, $authApi);
    }

    /**
     * @param list<int> $vaultIds
     *
     * @return list<int>
     */
    public static function filterVaultIdsWithEmbeddedDocuments(Database $db, array $vaultIds): array
    {
        return VaultChatScope::filterVaultIdsWithEmbeddedDocuments($db, $vaultIds);
    }

    /**
     * @return list<array{kind: string, id: int, vault_id: int, name: string}>
     */
    public static function composerRefsMatchingMessage(Database $db, int $uid, ?int $wid, string $message, int $max = 6): array
    {
        return VaultChatScope::composerRefsMatchingMessage($db, $uid, $wid, $message, $max);
    }

    /**
     * @return list<array{kind: string, id: int, vault_id: int, name: string}>
     */
    public static function embeddedAudioRefsForRecordLookup(
        Database $db,
        int $uid,
        ?int $wid,
        string $message,
        int $max = 4,
    ): array {
        if (! ChatTeachingIntent::impliesPersonalRecordVaultLookup($message)) {
            return [];
        }

        return VaultChatScope::embeddedAudioRefsForRecordLookup($db, $uid, $wid, $message, $max);
    }

    /**
     * @param list<array{kind: string, id: int, vault_id: int, name: string}> $refs
     *
     * @return array<int, list<int>>
     */
    public static function scopedDocumentIdsByVault(Database $db, array $refs): array
    {
        return VaultChatScope::scopedDocumentIdsByVault($db, $refs);
    }

    /**
     * @param list<int> $vaultIds
     *
     * @return array<string, array{file_name: string, vault_name: string, path: string}>
     */
    public static function documentCitationCatalog(Database $db, array $vaultIds): array
    {
        return VaultChatScope::documentCitationCatalog($db, $vaultIds);
    }
}
