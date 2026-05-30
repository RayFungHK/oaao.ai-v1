<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Canonical auth PDO for chat send — avoid calling protected controller helpers from library code.
 *
 * Do not use {@see method_exists()} on Razy {@code api()} emitters — they delegate via {@code __call}
 * (see {@code chat.php::oaao_chat_require_authenticated_only}).
 */
final class ChatSendCanonicalPdo
{
    public static function fromAuthApi(?object $authApi): ?\PDO
    {
        if (! is_object($authApi)) {
            return null;
        }

        try {
            $db = $authApi->getDB();
        } catch (\Throwable) {
            return null;
        }

        if (! $db instanceof \Razy\Database) {
            return null;
        }

        $pdo = $db->getDBAdapter();

        return $pdo instanceof \PDO ? $pdo : null;
    }

    public static function fromCanonDb(?\Razy\Database $canonDb): ?\PDO
    {
        if (! $canonDb instanceof \Razy\Database) {
            return null;
        }

        $pdo = $canonDb->getDBAdapter();

        return $pdo instanceof \PDO ? $pdo : null;
    }

    public static function fromController(object $controller): ?\PDO
    {
        try {
            $authApi = $controller->api('auth');
        } catch (\Throwable) {
            return null;
        }

        return self::fromAuthApi($authApi);
    }
}
