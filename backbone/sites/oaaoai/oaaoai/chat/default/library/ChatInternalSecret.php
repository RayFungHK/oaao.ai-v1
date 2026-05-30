<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Resolve {@code OAAO_ORCH_SHARED_SECRET} for strip_hash / orchestrator internal calls.
 *
 * PHP-FPM often exposes compose env via $_ENV rather than getenv(); also supports {@code env:VAR} pointers.
 */
final class ChatInternalSecret
{
    public static function require(): string
    {
        $raw = self::read('OAAO_ORCH_SHARED_SECRET');
        if ($raw === '') {
            throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
        }

        if (str_starts_with($raw, 'env:')) {
            $target = trim(substr($raw, 4));
            if ($target === '') {
                throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET env: pointer missing target name.');
            }
            $inner = self::read($target);
            if ($inner === '') {
                throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET env:' . $target . ' is unset or empty.');
            }

            return $inner;
        }

        return $raw;
    }

    private static function read(string $key): string
    {
        $v = getenv($key);
        if (\is_string($v) && trim($v) !== '') {
            return trim($v);
        }

        if (isset($_ENV[$key]) && \is_string($_ENV[$key]) && trim($_ENV[$key]) !== '') {
            return trim($_ENV[$key]);
        }

        if (isset($_SERVER[$key]) && \is_string($_SERVER[$key]) && trim($_SERVER[$key]) !== '') {
            return trim($_SERVER[$key]);
        }

        return '';
    }
}
