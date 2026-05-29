<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendComposer;
use PHPUnit\Framework\TestCase;

final class ChatSendPrepareTest extends TestCase
{
    public function test_parse_enable_web_search_accepts_string_true(): void
    {
        self::assertTrue(ChatSendComposer::parseEnableWebSearch(['enable_web_search' => 'true']));
        self::assertFalse(ChatSendComposer::parseEnableWebSearch(['enable_web_search' => 'false']));
    }

    public function test_parse_attachment_ids_dedupes_and_caps(): void
    {
        $ids = ChatSendComposer::parseAttachmentIds([
            'attachment_ids' => [3, 3, 7, 0, -1],
        ], 8);
        self::assertSame([3, 7], $ids);
    }
}
