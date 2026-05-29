<?php

declare(strict_types=1);

use oaaoai\user\UserInvitationMail;
use PHPUnit\Framework\TestCase;

final class UserInvitationMailTest extends TestCase
{
    public function test_invite_subject_zh(): void
    {
        self::assertStringContainsString('受邀', UserInvitationMail::inviteSubject('zh-Hant'));
    }

    public function test_reset_body_en(): void
    {
        $body = UserInvitationMail::resetBody('https://example/reset', '2026-01-01', 'en');
        self::assertStringContainsString('password reset', strtolower($body));
    }
}
