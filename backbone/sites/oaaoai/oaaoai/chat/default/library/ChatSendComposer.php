<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Parses chat-owned composer flags from the send POST body.
 */
final class ChatSendComposer
{
    /**
     * @param array<string, mixed> $input
     */
    public static function parseEnableWebSearch(array $input): bool
    {
        $webRaw = $input['enable_web_search'] ?? null;
        if ($webRaw === true || $webRaw === 1 || $webRaw === '1') {
            return true;
        }

        return \is_string($webRaw) && strtolower(trim($webRaw)) === 'true';
    }

    /**
     * @param array<string, mixed> $input
     * @return list<int>
     */
    public static function parseAttachmentIds(array $input, int $max = 8): array
    {
        /** @var list<int> $attachmentIds */
        $attachmentIds = [];
        $attRaw = $input['attachment_ids'] ?? null;
        if (! \is_array($attRaw)) {
            return [];
        }

        foreach ($attRaw as $a) {
            $aid = \is_int($a) ? $a : (int) $a;
            if ($aid > 0) {
                $attachmentIds[] = $aid;
            }
            if (\count($attachmentIds) >= $max) {
                break;
            }
        }

        return array_values(array_unique($attachmentIds, SORT_NUMERIC));
    }
}
