<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendOrchestratorBinding;
use PHPUnit\Framework\TestCase;

final class ChatSendOrchestratorBindingTest extends TestCase
{
    public function test_is_ready_requires_binding_and_base(): void
    {
        self::assertFalse(ChatSendOrchestratorBinding::isReady(null, 'http://127.0.0.1:8103'));
        self::assertFalse(ChatSendOrchestratorBinding::isReady(['endpoint_id' => 1], ''));
        self::assertTrue(ChatSendOrchestratorBinding::isReady(['endpoint_id' => 1], 'http://127.0.0.1:8103'));
    }
}
