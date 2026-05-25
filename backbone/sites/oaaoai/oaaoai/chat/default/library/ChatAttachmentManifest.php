<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Ephemeral chat attachment kinds + message manifest (no reopen — files disposed after turn).
 *
 * Loaded by Razy module library autoload: {@code oaaoai/chat/ChatAttachmentManifest}.
 */
final class ChatAttachmentManifest
{
    public const KIND_PDF = 'pdf';

    public const KIND_TEXT = 'text';

    public const KIND_IMAGE = 'image';

    public const KIND_AUDIO = 'audio';

    public const KIND_OTHER = 'other';

    public static function classifyKind(string $mime, string $fileName): string
    {
        $m = strtolower(trim($mime));
        $ext = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));

        if ($m === 'application/pdf' || $ext === 'pdf') {
            return self::KIND_PDF;
        }
        if (str_starts_with($m, 'image/')) {
            return self::KIND_IMAGE;
        }
        if (str_starts_with($m, 'audio/')) {
            return self::KIND_AUDIO;
        }
        if (str_starts_with($m, 'text/') || $m === 'application/json' || \in_array($ext, ['txt', 'md', 'csv', 'json', 'log'], true)) {
            return self::KIND_TEXT;
        }

        return self::KIND_OTHER;
    }

    /**
     * @param array<string, mixed> $row DB row
     *
     * @return array{file_name: string, mime_type: string, kind: string, byte_size: int, disposed: bool}
     */
    public static function manifestEntryFromRow(array $row, bool $disposed = false): array
    {
        $fileName = (string) ($row['file_name'] ?? 'attachment');
        $mime = (string) ($row['mime_type'] ?? 'application/octet-stream');

        return [
            'file_name' => $fileName,
            'mime_type' => $mime,
            'kind'      => self::classifyKind($mime, $fileName),
            'byte_size' => (int) ($row['byte_size'] ?? 0),
            'disposed'  => $disposed,
        ];
    }

    /**
     * @param list<array<string, mixed>> $rows
     *
     * @return list<array{file_name: string, mime_type: string, kind: string, byte_size: int, disposed: bool}>
     */
    public static function manifestFromRows(array $rows, bool $disposed = false): array
    {
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $out[] = self::manifestEntryFromRow($row, $disposed);
        }

        return $out;
    }
}
