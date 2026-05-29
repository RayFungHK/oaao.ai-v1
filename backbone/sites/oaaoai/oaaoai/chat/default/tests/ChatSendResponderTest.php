<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendRespondInput;
use oaaoai\chat\ChatSendResponder;
use PHPUnit\Framework\TestCase;

final class ChatSendResponderTest extends TestCase
{
    public function test_build_payload_includes_optional_fields(): void
    {
        $payload = ChatSendResponder::buildPayload(new ChatSendRespondInput(
            conversationId: 42,
            userMsgId: 1,
            asstMsgId: 2,
            assistantOut: 'hello',
            streamUrl: 'https://example/stream',
            runId: 'run-1',
            streamToken: 'tok',
            orchReady: true,
            workspaceId: 7,
            conversationTitleOut: 'Title',
            autoCompactApplied: true,
            inferenceSnapshot: ['mode' => 'off'],
        ));

        self::assertTrue($payload['success']);
        self::assertSame(42, $payload['conversation_id']);
        self::assertSame('Title', $payload['conversation_title']);
        self::assertSame(7, $payload['workspace_id']);
        self::assertTrue($payload['auto_compact_applied']);
        self::assertTrue($payload['orchestrator_persist']);
    }
}
