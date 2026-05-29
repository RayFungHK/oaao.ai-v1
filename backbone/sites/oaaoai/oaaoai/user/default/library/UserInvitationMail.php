<?php

declare(strict_types=1);

namespace oaaoai\user;

/**
 * Invitation + password reset mail bodies (EN default; zh-Hant when locale is Chinese).
 */
final class UserInvitationMail
{
    public static function inviteSubject(string $locale = 'en'): string
    {
        return self::isZh($locale)
            ? '您已受邀加入 OAAO'
            : 'You are invited to OAAO';
    }

    public static function inviteBody(string $registerUrl, string $expiresAt, string $locale = 'en'): string
    {
        if (self::isZh($locale)) {
            return "您已受邀加入此 OAAO 工作區。\n\n"
                . "請完成註冊（設定顯示名稱與密碼）：\n"
                . $registerUrl . "\n\n"
                . "此連結有效期限：{$expiresAt}\n\n"
                . "若您未預期收到此信，可忽略本郵件。";
        }

        return "You have been invited to join this OAAO workspace.\n\n"
            . "Complete registration (set your display name and password):\n"
            . $registerUrl . "\n\n"
            . "This link expires at: {$expiresAt}\n\n"
            . "If you did not expect this email, you can ignore it.";
    }

    public static function resetSubject(string $locale = 'en'): string
    {
        return self::isZh($locale)
            ? '重設您的 OAAO 密碼'
            : 'Reset your OAAO password';
    }

    public static function resetBody(string $resetUrl, string $expiresAt, string $locale = 'en'): string
    {
        if (self::isZh($locale)) {
            return "我們收到您 OAAO 帳號的密碼重設請求。\n\n"
                . "請設定新密碼：\n"
                . $resetUrl . "\n\n"
                . "此連結有效期限：{$expiresAt}\n\n"
                . "若您未提出此請求，請忽略本郵件。";
        }

        return "A password reset was requested for your OAAO account.\n\n"
            . "Set a new password:\n"
            . $resetUrl . "\n\n"
            . "This link expires at: {$expiresAt}\n\n"
            . "If you did not request this, ignore this email.";
    }

    /** Normalize invite/reset mail locale from API body or inviter prefs. */
    public static function normalizeMailLocale(string $raw): string
    {
        $locale = trim($raw);
        if ($locale === 'zh' || $locale === 'zh-Hant' || $locale === 'zh-hant') {
            return 'zh-Hant';
        }

        return 'en';
    }

    private static function isZh(string $locale): bool
    {
        $lo = strtolower(trim($locale));

        return $lo === 'zh' || str_starts_with($lo, 'zh-');
    }
}
