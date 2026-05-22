<?php

/**
 * PostgreSQL URL helper for install + config (postgresql://… like OAAO_PG_URL).
 */

/**
 * @return array{host:string,port:int,dbname:string,user:string,password:string}|null
 */
function oaao_auth_pg_parse_url(string $url): ?array
{
    $parts = parse_url(trim($url));
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if (! is_array($parts) || ($scheme !== 'postgresql' && $scheme !== 'postgres')) {
        return null;
    }
    $dbname = ltrim((string) ($parts['path'] ?? ''), '/');
    if ($dbname === '') {
        return null;
    }

    return [
        'host'     => (string) ($parts['host'] ?? 'localhost'),
        'port'     => (int) ($parts['port'] ?? 5432),
        'dbname'   => $dbname,
        'user'     => urldecode((string) ($parts['user'] ?? '')),
        'password' => urldecode((string) ($parts['pass'] ?? '')),
    ];
}

/**
 * @param array{host:string,port:int,dbname:string,user:string,password:string} $parsed
 *
 * @return array<string, scalar>
 */
function oaao_auth_pg_razy_db_config(array $parsed): array
{
    return [
        'driver'   => 'pgsql',
        'host'     => $parsed['host'],
        'port'     => $parsed['port'],
        'database' => $parsed['dbname'],
        'username' => $parsed['user'],
        'password' => $parsed['password'],
        'prefix'   => 'oaao_',
    ];
}
