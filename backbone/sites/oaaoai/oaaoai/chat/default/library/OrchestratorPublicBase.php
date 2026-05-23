<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Browser-reachable orchestrator base URL — rewrites loopback env defaults for LAN/mobile clients.
 *
 * On HTTPS pages, direct {@code http://host:8103} stream URLs are blocked (mixed content). Use
 * {@see streamProxyPath()} via {@see forClientStream()} instead.
 */
final class OrchestratorPublicBase
{
    public static function fromEnv(): string
    {
        $raw = getenv('OAAO_ORCHESTRATOR_PUBLIC_BASE');
        if (\is_string($raw) && trim($raw) !== '') {
            return self::rewriteLoopbackForClient(rtrim(trim($raw), '/'));
        }
        $port = getenv('OAAO_SIDECAR_PORT');
        if ($port !== false && (string) $port !== '') {
            return self::rewriteLoopbackForClient(
                'http://127.0.0.1:' . max(1, min(65535, (int) $port))
            );
        }

        return '';
    }

    public static function isClientHttps(): bool
    {
        if (! empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
            return true;
        }
        $xf = strtolower(trim((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')));

        return $xf === 'https';
    }

    /**
     * Same-origin SSE proxy path (no orchestrator path suffix).
     */
    public static function streamProxyPath(): string
    {
        $raw = getenv('OAAO_ORCHESTRATOR_STREAM_PROXY_PATH');
        if (\is_string($raw) && trim($raw) !== '') {
            return '/' . ltrim(trim($raw), '/');
        }

        return '/chat/api/orchestrator_stream';
    }

    /**
     * When true, {@see buildStreamUrl()} emits the proxy path (no {@code /v1/stream} suffix).
     */
    public static function usesStreamProxy(string $base): bool
    {
        $base = rtrim(trim($base), '/');
        if ($base === '') {
            return false;
        }

        return str_ends_with($base, self::streamProxyPath());
    }

    /**
     * Base URL for browser SSE — HTTPS pages get same-origin proxy; HTTP keeps direct sidecar URL.
     */
    public static function forClientStream(string $directPublicBase): string
    {
        $direct = self::rewriteLoopbackForClient(rtrim(trim($directPublicBase), '/'));
        if ($direct === '') {
            return '';
        }
        if (! self::isClientHttps()) {
            return $direct;
        }
        if (! str_starts_with(strtolower($direct), 'http://')) {
            return $direct;
        }

        return self::sameOriginStreamBase();
    }

    public static function sameOriginStreamBase(): string
    {
        $scheme = self::isClientHttps() ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '';
        $host = \is_string($host) ? trim($host) : '';
        if ($host === '') {
            return self::streamProxyPath();
        }

        return $scheme . '://' . $host . self::streamProxyPath();
    }

    /**
     * @param array<string, scalar|null> $query
     */
    public static function buildStreamUrl(string $publicBase, array $query): string
    {
        $base = rtrim(trim($publicBase), '/');
        if ($base === '') {
            return '';
        }
        $qs = http_build_query($query, '', '&', PHP_QUERY_RFC3986);
        if (self::usesStreamProxy($base)) {
            return $base . ($qs !== '' ? '?' . $qs : '');
        }

        return $base . '/v1/stream' . ($qs !== '' ? '?' . $qs : '');
    }

    public static function rewriteLoopbackForClient(string $base): string
    {
        $base = rtrim(trim($base), '/');
        if ($base === '') {
            return '';
        }
        $host = parse_url($base, PHP_URL_HOST);
        if (! \is_string($host) || ! self::isLoopbackHost($host)) {
            return $base;
        }
        $clientHost = self::clientReachableHost();
        if ($clientHost === '') {
            return $base;
        }
        $port = parse_url($base, PHP_URL_PORT);
        if ($port === null || (int) $port <= 0) {
            $envPort = getenv('OAAO_SIDECAR_PORT');
            $port = ($envPort !== false && (string) $envPort !== '') ? (int) $envPort : 8103;
        }
        $port = max(1, min(65535, (int) $port));

        return 'http://' . $clientHost . ':' . $port;
    }

    private static function isLoopbackHost(string $host): bool
    {
        $h = strtolower(trim($host));

        return \in_array($h, ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'], true);
    }

    private static function clientReachableHost(): string
    {
        $hh = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '';
        $hh = \is_string($hh) ? trim($hh) : '';
        if ($hh === '') {
            return '';
        }
        $hostOnly = preg_replace('/:\d+$/', '', $hh) ?? $hh;
        $hostOnly = trim($hostOnly);
        if ($hostOnly === '') {
            return '';
        }

        return $hostOnly;
    }
}
