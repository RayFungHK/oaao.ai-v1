<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Ephemeral chat attachment disk layout ({@code OAAO_CHAT_ATTACHMENT_ROOT}).
 */
final class ChatAttachmentStorage
{
    public static function root(): string
    {
        $env = getenv('OAAO_CHAT_ATTACHMENT_ROOT');
        if (\is_string($env) && trim($env) !== '') {
            return rtrim(trim($env), '/\\');
        }

        $data = getenv('OAAO_AUTH_SQLITE_PATH');
        if (\is_string($data) && trim($data) !== '') {
            return dirname(trim($data)) . '/chat-attachments';
        }

        return dirname(__DIR__, 4) . '/data/chat-attachments';
    }

    public static function conversationDir(int $conversationId): string
    {
        return self::root() . '/' . max(0, $conversationId);
    }

    public static function draftDir(int $userId): string
    {
        return self::root() . '/draft/' . max(0, $userId);
    }

    public static function ensureConversationDir(int $conversationId): string
    {
        $dir = self::conversationDir($conversationId);
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        return $dir;
    }

    public static function ensureDraftDir(int $userId): string
    {
        $dir = self::draftDir($userId);
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        return $dir;
    }

    /**
     * Move composer draft uploads ({@code conversation_id=0}) onto a thread before send / manifest.
     *
     * @param list<int> $ids
     */
    public static function claimDraftAttachments(\Razy\Database $db, int $userId, int $conversationId, array $ids): void
    {
        if ($userId < 1 || $conversationId < 1 || $ids === []) {
            return;
        }

        $destDir = self::ensureConversationDir($conversationId);
        $draftDir = self::draftDir($userId);

        foreach ($ids as $rawId) {
            $aid = (int) $rawId;
            if ($aid < 1) {
                continue;
            }
            $row = $db->prepare()
                ->select('id, conversation_id, storage_path')
                ->from('conversation_attachment')
                ->where('id=?,user_id=?')
                ->assign(['id' => $aid, 'user_id' => $userId])
                ->limit(1)
                ->query()
                ->fetch();
            if (! \is_array($row)) {
                continue;
            }
            $curCid = (int) ($row['conversation_id'] ?? -1);
            if ($curCid === $conversationId) {
                continue;
            }
            if ($curCid !== 0) {
                continue;
            }
            $rel = trim((string) ($row['storage_path'] ?? ''));
            if ($rel !== '') {
                $src = $draftDir . '/' . $rel;
                $dest = $destDir . '/' . $rel;
                if (is_file($src)) {
                    if (! is_file($dest)) {
                        @rename($src, $dest);
                    } else {
                        @unlink($src);
                    }
                }
            }
            $db->update('conversation_attachment', ['conversation_id'])
                ->where('id=?,user_id=?')
                ->assign([
                    'conversation_id' => $conversationId,
                    'id'              => $aid,
                    'user_id'         => $userId,
                ])
                ->query();
        }
    }

    public static function ttlDays(): int
    {
        $raw = getenv('OAAO_CHAT_ATTACHMENT_TTL_DAYS');

        return max(1, min(90, (int) ($raw !== false && $raw !== '' ? $raw : 7)));
    }

    /**
     * Remove expired rows and on-disk bytes (best-effort; called on upload / chat API touch).
     */
    public static function sweepExpired(\Razy\Database $db): void
    {
        $now = date('Y-m-d H:i:s');
        $rows = $db->prepare()
            ->select('id, conversation_id, storage_path')
            ->from('conversation_attachment')
            ->where('expires_at IS NOT NULL, expires_at<?')
            ->assign(['expires_at' => $now])
            ->limit(200)
            ->query()
            ->fetchAll();
        if (! \is_array($rows)) {
            return;
        }
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $id = (int) ($row['id'] ?? 0);
            $cid = (int) ($row['conversation_id'] ?? 0);
            $rel = trim((string) ($row['storage_path'] ?? ''));
            if ($rel !== '' && $cid > 0) {
                $path = self::conversationDir($cid) . '/' . $rel;
                if (is_file($path)) {
                    @unlink($path);
                }
            }
            if ($id > 0) {
                $db->delete('conversation_attachment', ['id' => $id])->query();
            }
        }
    }

    /**
     * @param list<int> $ids
     *
     * @return list<array<string, mixed>>
     */
    public static function loadRowsForIds(\Razy\Database $db, int $conversationId, int $userId, array $ids): array
    {
        $out = [];
        foreach ($ids as $rawId) {
            $aid = (int) $rawId;
            if ($aid < 1) {
                continue;
            }
            $row = $db->prepare()
                ->select('id, conversation_id, file_name, mime_type, storage_path, byte_size, extract_status')
                ->from('conversation_attachment')
                ->where('id=?,conversation_id=?,user_id=?')
                ->assign(['id' => $aid, 'conversation_id' => $conversationId, 'user_id' => $userId])
                ->limit(1)
                ->query()
                ->fetch();
            if (\is_array($row)) {
                $out[] = $row;
            }
        }

        return $out;
    }

    /**
     * Delete attachment bytes + DB rows after orchestrator consumed them for the turn.
     *
     * @param list<int> $ids
     */
    public static function disposeByIds(\Razy\Database $db, int $conversationId, int $userId, array $ids): int
    {
        $removed = 0;
        foreach ($ids as $rawId) {
            $aid = (int) $rawId;
            if ($aid < 1) {
                continue;
            }
            $row = $db->prepare()
                ->select('id, conversation_id, storage_path')
                ->from('conversation_attachment')
                ->where('id=?,conversation_id=?,user_id=?')
                ->assign(['id' => $aid, 'conversation_id' => $conversationId, 'user_id' => $userId])
                ->limit(1)
                ->query()
                ->fetch();
            if (! \is_array($row)) {
                continue;
            }
            $cid = (int) ($row['conversation_id'] ?? 0);
            $rel = trim((string) ($row['storage_path'] ?? ''));
            if ($rel !== '' && $cid > 0) {
                $path = self::conversationDir($cid) . '/' . $rel;
                if (is_file($path)) {
                    @unlink($path);
                }
            }
            $db->delete('conversation_attachment', ['id' => $aid])->query();
            $removed++;
        }

        return $removed;
    }
}
