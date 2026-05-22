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

    public static function ensureConversationDir(int $conversationId): string
    {
        $dir = self::conversationDir($conversationId);
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        return $dir;
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
}
