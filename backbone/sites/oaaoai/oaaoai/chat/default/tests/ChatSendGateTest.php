<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendGate;
use PHPUnit\Framework\TestCase;

final class ChatSendGateTest extends TestCase
{
    public function test_workspace_denial_null_when_no_workspace(): void
    {
        self::assertNull(ChatSendGate::workspaceDenial(1, null, null));
    }
}
