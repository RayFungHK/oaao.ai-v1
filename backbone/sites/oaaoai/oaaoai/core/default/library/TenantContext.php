<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once __DIR__ . '/TenantHostResolver.php';
final class TenantContext
{
    /** @var array<string, mixed>|null */
    private static ?array $tenant = null;

    private static bool $resolved = false;

    public static function reset(): void
    {
        self::$tenant = null;
        self::$resolved = false;
    }

    /**
     * @return array<string, mixed>|null tenant row
     */
    public static function bootstrap(\PDO $pdo, ?string $host = null): ?array
    {
        if (self::$resolved) {
            return self::$tenant;
        }
        self::$resolved = true;

        require_once __DIR__ . '/TenantRepository.php';

        $host = $host ?? TenantHostResolver::requestHost();
        self::$tenant = TenantRepository::resolveByHost($pdo, $host);

        return self::$tenant;
    }

    /**
     * @return array<string, mixed> tenant row
     */
    public static function require(\PDO $pdo, ?string $host = null): array
    {
        $row = self::bootstrap($pdo, $host);
        if ($row === null) {
            http_response_code(404);
            header('Content-Type: application/json; charset=UTF-8');
            echo json_encode([
                'success' => false,
                'message' => 'Unknown tenant for this host',
                'data'    => ['host' => $host ?? TenantHostResolver::requestHost()],
            ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            exit;
        }

        return $row;
    }

    public static function id(): int
    {
        return isset(self::$tenant['tenant_id']) ? (int) self::$tenant['tenant_id'] : 0;
    }

    public static function slug(): string
    {
        return isset(self::$tenant['slug']) ? trim((string) self::$tenant['slug']) : TenantHostResolver::tenantSlug();
    }

    public static function kind(): string
    {
        return isset(self::$tenant['kind']) ? strtolower(trim((string) self::$tenant['kind'])) : 'customer';
    }

    public static function isPlatform(): bool
    {
        return self::kind() === 'platform';
    }

    public static function isActive(): bool
    {
        $st = isset(self::$tenant['status']) ? strtolower(trim((string) self::$tenant['status'])) : 'active';

        return $st === 'active';
    }

    /** @return array<string, mixed>|null */
    public static function row(): ?array
    {
        return self::$tenant;
    }

    public static function signupMode(): string
    {
        return isset(self::$tenant['signup_mode']) ? strtolower(trim((string) self::$tenant['signup_mode'])) : 'private';
    }
}
