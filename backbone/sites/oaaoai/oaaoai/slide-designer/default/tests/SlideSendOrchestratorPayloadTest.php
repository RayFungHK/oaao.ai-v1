<?php

declare(strict_types=1);

use oaaoai\slide_designer\SlideSendOrchestratorPayload;
use PHPUnit\Framework\TestCase;

final class SlideSendOrchestratorPayloadTest extends TestCase
{
    public function test_bubble_thread_returns_minimal_slide_designer_payload(): void
    {
        $ctx = new \oaaoai\chat\ChatSendContext(
            userId: 1,
            workspaceId: null,
            input: [],
        );
        $pdo = new \PDO('sqlite::memory:');
        $fragment = SlideSendOrchestratorPayload::buildFragment(
            null,
            $ctx,
            $pdo,
            10,
            true,
            '',
            0,
            null,
            0,
        );
        self::assertArrayHasKey('slide_designer', $fragment);
        self::assertArrayNotHasKey('conversation_materials', $fragment);
    }
}
