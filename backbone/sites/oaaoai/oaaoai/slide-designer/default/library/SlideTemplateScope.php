<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

require_once dirname(__DIR__, 3) . '/core/default/library/TenantContext.php';

use Oaaoai\Core\TenantContext;

/**
 * Slide template scope — global (platform), tenant, personal (user).
 */
final class SlideTemplateScope
{
    public const GLOBAL = 'global';

    public const TENANT = 'tenant';

    public const PERSONAL = 'personal';

    /** @var list<string> */
    public const LEVELS = [self::GLOBAL, self::TENANT, self::PERSONAL];

    /**
     * @return array{
     *     scope: string,
     *     tenant_id: int|null,
     *     user_id: int,
     *     is_platform_operator: bool,
     *     is_tenant_admin: bool
     * }
     */
    public static function contextFromAuth(object $user, ?\PDO $canonPdo = null): array
    {
        $uid = (int) ($user->user_id ?? 0);
        $userTid = isset($user->tenant_id) ? (int) $user->tenant_id : 0;

        if ($canonPdo instanceof \PDO) {
            TenantContext::bootstrap($canonPdo);
        }

        $ctxTid = TenantContext::id();
        $tenantId = $ctxTid > 0 ? $ctxTid : ($userTid > 0 ? $userTid : null);

        $role = isset($user->role) ? strtolower(trim((string) $user->role)) : '';
        $isPlatformOp = false;
        if ($role === 'platform_admin' && TenantContext::isPlatform()) {
            $isPlatformOp = $userTid > 0 && $ctxTid > 0 && $userTid === $ctxTid;
        }

        $isTenantAdmin = $role === 'admin';

        return [
            'scope'                  => self::PERSONAL,
            'tenant_id'              => $tenantId,
            'user_id'                => $uid,
            'is_platform_operator'   => $isPlatformOp,
            'is_tenant_admin'        => $isTenantAdmin,
        ];
    }

    public static function normalizeScope(?string $raw, string $default = self::PERSONAL): string
    {
        $s = strtolower(trim((string) $raw));

        return \in_array($s, self::LEVELS, true) ? $s : $default;
    }

    /**
     * @param array{tenant_id: int|null, user_id: int, is_platform_operator: bool, is_tenant_admin?: bool} $ctx
     */
    public static function canWriteScope(array $ctx, string $scope): bool
    {
        $scope = self::normalizeScope($scope);
        if ($scope === self::GLOBAL) {
            return (bool) ($ctx['is_platform_operator'] ?? false);
        }
        if ($scope === self::TENANT) {
            $tid = $ctx['tenant_id'] ?? null;

            return (bool) ($ctx['is_tenant_admin'] ?? false)
                && $tid !== null
                && $tid > 0
                && (int) ($ctx['user_id'] ?? 0) > 0;
        }

        return (int) ($ctx['user_id'] ?? 0) > 0;
    }

    /**
     * @param array<string, mixed> $ctx
     *
     * @return array{can_write_global: bool, can_write_tenant: bool, can_write_personal: bool}
     */
    public static function scopeCapabilities(array $ctx): array
    {
        return [
            'can_write_global'   => false,
            'can_write_tenant'   => self::canWriteScope($ctx, self::TENANT),
            'can_write_personal' => self::canWriteScope($ctx, self::PERSONAL),
        ];
    }

    /**
     * @param array<string, mixed> $ctx
     *
     * @return array<string, mixed>
     */
    public static function orchestratorPayload(array $ctx): array
    {
        return [
            'user_id'                => (int) ($ctx['user_id'] ?? 0),
            'tenant_id'              => isset($ctx['tenant_id']) && $ctx['tenant_id'] !== null
                ? (int) $ctx['tenant_id']
                : null,
            'is_platform_operator'   => (bool) ($ctx['is_platform_operator'] ?? false),
            'is_tenant_admin'        => (bool) ($ctx['is_tenant_admin'] ?? false),
        ];
    }

    /**
     * @param array<string, mixed> $ctx
     * @param array<string, mixed> $template
     */
    public static function canReadTemplate(array $ctx, array $template): bool
    {
        $scope = self::normalizeScope(isset($template['scope']) ? (string) $template['scope'] : null);
        $status = trim((string) ($template['status'] ?? 'draft'));
        $owner = (int) ($template['owner_user_id'] ?? $template['created_by'] ?? 0);
        $uid = (int) ($ctx['user_id'] ?? 0);
        $rowTid = isset($template['tenant_id']) ? (int) $template['tenant_id'] : 0;
        $ctxTid = isset($ctx['tenant_id']) ? (int) $ctx['tenant_id'] : 0;
        $isOp = (bool) ($ctx['is_platform_operator'] ?? false);

        if ($scope === self::GLOBAL) {
            if ($status === 'published') {
                return true;
            }

            return $isOp || ($owner > 0 && $owner === $uid);
        }

        if ($scope === self::TENANT) {
            if ($rowTid < 1 || $ctxTid < 1 || $rowTid !== $ctxTid) {
                return false;
            }
            if ($status === 'published') {
                return true;
            }

            return $owner === $uid || $isOp;
        }

        return $owner === $uid;
    }

    /**
     * @param object $user Auth user row
     * @param object|null $authModule {@code $this->api('auth')}
     *
     * @return array{scope: string, tenant_id: int|null, user_id: int, is_platform_operator: bool}
     */
    public static function contextFromAuthModule(object $user, ?object $authModule): array
    {
        $canonPdo = null;
        if ($authModule !== null && method_exists($authModule, 'getDB')) {
            $cdb = $authModule->getDB();
            if ($cdb !== null && method_exists($cdb, 'getDBAdapter')) {
                $adapter = $cdb->getDBAdapter();
                if ($adapter instanceof \PDO) {
                    $canonPdo = $adapter;
                }
            }
        }

        return self::contextFromAuth($user, $canonPdo);
    }
}
