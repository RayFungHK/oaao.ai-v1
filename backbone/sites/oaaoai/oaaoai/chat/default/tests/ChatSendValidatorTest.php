<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendAbort;
use oaaoai\chat\ChatSendValidator;
use PHPUnit\Framework\TestCase;

final class ChatSendValidatorTest extends TestCase
{
    public function test_assert_authenticated_user_rejects_zero(): void
    {
        $this->expectException(ChatSendAbort::class);
        ChatSendValidator::assertAuthenticatedUser(0);
    }

    public function test_assert_content_length_rejects_oversize(): void
    {
        $this->expectException(ChatSendAbort::class);
        ChatSendValidator::assertContentLength(str_repeat('x', 32001));
    }
}
