<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/** Open the shared adjunct SQLite used for chat threads and slide project indexes. */
final class AdjunctSqlite
{
    public static function openPdo(): ?\PDO
    {
        foreach (self::candidatePaths() as $path) {
            if (! is_file($path)) {
                continue;
            }
            try {
                $pdo = new \PDO('sqlite:' . $path);
                $pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);

                return $pdo;
            } catch (\Throwable) {
            }
        }

        return null;
    }

    /** @return list<string> */
    private static function candidatePaths(): array
    {
        /** @var list<string> $paths */
        $paths = [];
        $push = static function (string $p) use (&$paths): void {
            $p = trim($p);
            if ($p !== '' && ! \in_array($p, $paths, true)) {
                $paths[] = $p;
            }
        };

        $envAdj = getenv('OAAO_ADJUNCT_SQLITE');
        if (\is_string($envAdj) && trim($envAdj) !== '') {
            $push(trim($envAdj));
        }

        $authSqlite = getenv('OAAO_AUTH_SQLITE_PATH');
        if (\is_string($authSqlite) && trim($authSqlite) !== '') {
            $push(dirname(trim($authSqlite)) . '/oaao_local.sqlite');
        }

        $moduleRoot = dirname(__DIR__, 3);
        $push($moduleRoot . '/auth/data/oaao_local.sqlite');

        return $paths;
    }
}
