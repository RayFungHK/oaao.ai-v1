<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once __DIR__ . '/TenantRepository.php';

/**
 * Canonical tenant slug from the inbound HTTP host — aligned with Razy multisite ({@see sites.inc.php})
 * and PostgreSQL {@code oaao_tenant_host} when a {@link \PDO} connection is available.
 *
 * Resolution order:
 * 1. {@code OAAO_TENANT_SLUG} — explicit ops / single-tenant deploy override.
 * 2. PostgreSQL host binding ({@see TenantRepository::resolveByHost}) when {@code $pdo} is passed or {@see TenantContext} is bootstrapped.
 * 3. Razy {@code sites.inc.php} alias / domain keys (bootstrap fallback before PG seed).
 */
final class TenantHostResolver
{
    public static function tenantSlug(?\PDO $pdo = null): string
    {
        $env = getenv('OAAO_TENANT_SLUG');
        if ($env !== false && trim((string) $env) !== '') {
            return self::sanitizeSegment((string) $env);
        }

        if ($pdo !== null) {
            $row = TenantRepository::resolveByHost($pdo, self::requestHost());
            if (\is_array($row) && isset($row['slug']) && trim((string) $row['slug']) !== '') {
                return self::sanitizeSegment((string) $row['slug']);
            }
        }

        if (TenantContext::id() > 0) {
            return TenantContext::slug();
        }

        $host = self::requestHost();
        $domainKey = self::resolveDomainKey($host);

        return self::sanitizeSegment($domainKey !== '' ? $domainKey : 'localhost');
    }

    /** Hostname only, lowercased (no port). */
    public static function requestHost(): string
    {
        $host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? 'localhost';
        $host = strtolower(trim((string) $host));
        $host = (string) preg_replace('/:\d+$/', '', $host);

        return $host !== '' ? $host : 'localhost';
    }

    /**
     * Map inbound host → sites.inc.php domain key (before slug sanitization).
     */
    public static function resolveDomainKey(string $host): string
    {
        $host = strtolower(trim($host));
        if ($host === '') {
            return 'localhost';
        }

        $cfg = self::loadSitesConfig();
        if ($cfg === null) {
            return $host;
        }

        /** @var array<string, mixed> $alias */
        $alias = \is_array($cfg['alias'] ?? null) ? $cfg['alias'] : [];
        if (isset($alias[$host]) && \is_string($alias[$host]) && trim($alias[$host]) !== '') {
            return trim($alias[$host]);
        }

        /** @var array<string, mixed> $domains */
        $domains = \is_array($cfg['domains'] ?? null) ? $cfg['domains'] : [];

        if (isset($domains[$host])) {
            return $host;
        }

        foreach ($domains as $pattern => $_path) {
            if (! \is_string($pattern) || $pattern === '' || $pattern === '*') {
                continue;
            }
            if (! str_contains($pattern, '*')) {
                continue;
            }
            $quoted = preg_quote($pattern, '/');
            $quoted = str_replace('\*', '[^.]+', $quoted);
            if (preg_match('/^' . $quoted . '$/', $host) === 1) {
                return $pattern;
            }
        }

        if (isset($domains['*'])) {
            return '*';
        }

        return $host;
    }

    /** @return array<string, mixed>|null */
    private static function loadSitesConfig(): ?array
    {
        static $cached = null;
        if ($cached !== null) {
            return $cached === false ? null : $cached;
        }

        $candidates = [];
        if (\defined('SYSTEM_ROOT')) {
            $candidates[] = rtrim((string) SYSTEM_ROOT, '/\\') . '/sites.inc.php';
        }
        $candidates[] = \dirname(__DIR__, 6) . '/sites.inc.php';

        foreach ($candidates as $path) {
            if (! \is_file($path)) {
                continue;
            }
            /** @var mixed $loaded */
            $loaded = require $path;
            if (\is_array($loaded)) {
                $cached = $loaded;

                return $cached;
            }
        }

        $cached = false;

        return null;
    }

    private static function sanitizeSegment(string $raw): string
    {
        $s = strtolower((string) preg_replace('/[^a-z0-9]+/', '_', $raw));
        $s = trim($s, '_');

        return $s !== '' ? substr($s, 0, 48) : 't';
    }
}
