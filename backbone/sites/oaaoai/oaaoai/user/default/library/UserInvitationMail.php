<?php

declare(strict_types=1);

namespace oaaoai\user;

/**
 * Invitation + password reset mail bodies (EN; zh optional via env locale later).
 */
final class UserInvitationMail
{
    public static function inviteSubject(): string
    {
        return 'You are invited to OAAO';
    }

    public static function inviteBody(string $registerUrl, string $expiresAt): string
    {
        return "You have been invited to join this OAAO workspace.\n\n"
            . "Complete registration (set your display name and password):\n"
            . $registerUrl . "\n\n"
            . "This link expires at: {$expiresAt}\n\n"
            . "If you did not expect this email, you can ignore it.";
    }

    public static function resetSubject(): string
    {
        return 'Reset your OAAO password';
    }

    public static function resetBody(string $resetUrl, string $expiresAt): string
    {
        return "A password reset was requested for your OAAO account.\n\n"
            . "Set a new password:\n"
            . $resetUrl . "\n\n"
            . "This link expires at: {$expiresAt}\n\n"
            . "If you did not request this, ignore this email.";
    }
}
