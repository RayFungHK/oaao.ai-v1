<?php

/**
 * oaao.ai User Model
 */

use Razy\Database;
use Razy\ORM\Model;
use Razy\ORM\ModelQuery;

return new class extends Model {
    /**
     * Column `disabled` (SMALLINT / cast bool): prefer equality, not `disabled != ?`.
     * `disabled = 0` ⇒ enabled (logical !disabled).
     * `disabled = 1` ⇒ disabled (logical disabled).
     */
    private const DISABLED_DB_ENABLED = 0;

    /** Disabled account (`disabled = 1`). Counterpart of {@see self::DISABLED_DB_ENABLED}. */
    private const DISABLED_DB_DISABLED = 1;

    protected static string $table = 'user';
    protected static string $primaryKey = 'user_id';
    protected static bool $timestamps = true;

    protected static array $fillable = [
        'login_name', 'password', 'display_name', 'email', 'role', 'tenant_id',
        'session_key', 'session_expires', 'last_login', 'disabled', 'permission_group_id',
    ];

    protected static array $hidden = ['password', 'session_key'];

    protected static array $casts = [
        'user_id' => 'int',
        // Keep `disabled` as DB SMALLINT (0/1); casting to bool confused some query bindings.
    ];

    // --- Scopes ---

    public function scopeActive(ModelQuery $query): ModelQuery
    {
        return $query->where('disabled=?', ['disabled' => self::DISABLED_DB_ENABLED]);
    }

    // --- Session Management ---

    public function generateSession(int $lifetime = 86400, Database $db = null): string
    {
        if ($db === null) {
            throw new \InvalidArgumentException('Database connection required');
        }
        $token = bin2hex(random_bytes(64));
        $expires = date('Y-m-d H:i:s', time() + $lifetime);
        $lastLogin = date('Y-m-d H:i:s');
        static::dbUpdateSessionFields($db, (int) $this->user_id, $token, $expires, $lastLogin);
        $this->session_key     = $token;
        $this->session_expires = $expires;
        $this->last_login      = $lastLogin;

        return $token;
    }

    public function clearSession(Database $db = null): void
    {
        if ($db === null) {
            throw new \InvalidArgumentException('Database connection required');
        }
        static::dbClearSessionFields($db, (int) $this->user_id);
        $this->session_key     = null;
        $this->session_expires = null;
    }

    public function isSessionValid(): bool
    {
        if (empty($this->session_key) || empty($this->session_expires)) {
            return false;
        }
        $expires = $this->session_expires;
        $ts = ($expires instanceof \DateTimeInterface) ? $expires->getTimestamp() : strtotime($expires);
        return $ts > time();
    }

    // --- Static Query Helpers ---

    public static function findBySessionKey(Database $database, string $key): ?static
    {
        if (empty($key)) {
            return null;
        }
        return static::query($database)
            ->where('session_key=?,disabled=?', [
                'session_key' => $key,
                'disabled'    => self::DISABLED_DB_ENABLED,
            ])
            ->first();
    }

    public static function findByLoginName(Database $database, string $loginName, ?int $tenantId = null): ?static
    {
        $params = [
            'login_name' => $loginName,
            'disabled'   => self::DISABLED_DB_ENABLED,
        ];
        $where = 'login_name=?,disabled=?';
        if ($tenantId !== null && $tenantId > 0) {
            $where .= ',tenant_id=?';
            $params['tenant_id'] = $tenantId;
        }

        return static::query($database)->where($where, $params)->first();
    }

    /**
     * Resolve login row for POST /auth/api/login — tenant-scoped first, then legacy NULL tenant_id rows.
     */
    public static function findForLogin(
        Database $database,
        string $loginOrEmail,
        ?int $tenantId = null,
    ): ?static {
        $user = static::findByLoginName($database, $loginOrEmail, $tenantId)
            ?: static::findByEmail($database, $loginOrEmail, $tenantId);
        if ($user !== null || $tenantId === null || $tenantId < 1) {
            return $user;
        }

        $legacy = static::findByLoginName($database, $loginOrEmail, null)
            ?: static::findByEmail($database, $loginOrEmail, null);
        if ($legacy === null) {
            return null;
        }
        $legacyTid = isset($legacy->tenant_id) ? (int) $legacy->tenant_id : 0;
        if ($legacyTid > 0 && $legacyTid !== $tenantId) {
            return null;
        }

        return $legacy;
    }

    public static function bindTenantId(Database $database, int $userId, int $tenantId): void
    {
        if ($userId < 1 || $tenantId < 1) {
            return;
        }
        $database->update(static::$table, ['tenant_id', 'updated_at'])
            ->where(static::$primaryKey . '=?')
            ->assign([
                'tenant_id'  => $tenantId,
                'updated_at' => date('Y-m-d H:i:s'),
                static::$primaryKey => $userId,
            ])
            ->query();
    }

    public static function findByEmail(Database $database, string $email, ?int $tenantId = null): ?static
    {
        // Match canonical storage: register/install persist strtolower(trim(email)); plain `email=?` works on SQLite + PostgreSQL.
        // PostgreSQL `LIKE` is case-sensitive (use ILIKE only on PG); it does not replace normalizing here.
        $needle = strtolower(trim($email));
        if ($needle === '') {
            return null;
        }

        $params = [
            'email'    => $needle,
            'disabled' => self::DISABLED_DB_ENABLED,
        ];
        $where = 'email=?,disabled=?';
        if ($tenantId !== null && $tenantId > 0) {
            $where .= ',tenant_id=?';
            $params['tenant_id'] = $tenantId;
        }

        return static::query($database)->where($where, $params)->first();
    }

    /**
     * Platform host: {@code platform_admin} on the platform tenant only (not customer {@code admin}).
     */
    public static function isPlatformOperator(?self $user): bool
    {
        if ($user === null) {
            return false;
        }
        require_once dirname(__DIR__, 3) . '/core/default/library/TenantContext.php';
        if (! \Oaaoai\Core\TenantContext::isPlatform()) {
            return false;
        }
        $role = isset($user->role) ? strtolower(trim((string) $user->role)) : '';
        if ($role !== 'platform_admin') {
            return false;
        }
        $userTid = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
        $ctxTid = \Oaaoai\Core\TenantContext::id();

        return $userTid > 0 && $ctxTid > 0 && $userTid === $ctxTid;
    }

    /**
     * @deprecated Use {@see isPlatformOperator()} — platform host no longer accepts cross-tenant customer admins.
     */
    public static function findByLoginNameForPlatformHost(Database $database, string $loginName): ?static
    {
        unset($database, $loginName);

        return null;
    }

    /**
     * @deprecated Use tenant-scoped lookup + {@see isPlatformOperator()}.
     */
    public static function findByEmailForPlatformHost(Database $database, string $email): ?static
    {
        unset($database, $email);

        return null;
    }

    /**
     * @deprecated Use {@see isPlatformOperator()}.
     */
    public static function mayUsePlatformHostSession(?self $user): bool
    {
        return self::isPlatformOperator($user);
    }

    /**
     * Bcrypt hash for {@see password_verify()} (`password` is in {@see $hidden}).
     *
     * Razy fluent Statement: chain {@code ->where('user_id=?')->assign(['user_id' => $id])}. Passing the bind
     * array as the second argument to {@code where()} generates invalid SQL ({@code WHERE "user_id" IS NULL}).
     */
    public static function fetchPasswordHash(Database $database, int $userId): string
    {
        if ($userId < 1) {
            return '';
        }
        $result = $database->prepare()
            ->select('password')
            ->from(static::$table)
            ->where('user_id=?')
            ->assign(['user_id' => $userId])
            ->limit(1)
            ->query();
        $row = $result->fetch();
        if ($row === false || $row === null) {
            return '';
        }
        if (is_object($row)) {
            return (string) ($row->password ?? '');
        }
        if (is_array($row)) {
            return (string) ($row['password'] ?? '');
        }

        return '';
    }

    /**
     * Password bcrypt update without {@see save()}: hidden `password` may be unloaded from SELECT,
     * and a full UPDATE can NULL NOT NULL password columns on PostgreSQL.
     */
    public static function savePasswordHash(Database $database, int $userId, string $hash): void
    {
        if ($userId < 1 || $hash === '') {
            return;
        }
        $now = date('Y-m-d H:i:s');
        $database->update(static::$table, ['password', 'updated_at'])
            ->where('user_id=?')
            ->assign([
                'password'   => $hash,
                'updated_at' => $now,
                'user_id'    => $userId,
            ])
            ->query();
    }

    private static function dbUpdateSessionFields(
        Database $database,
        int $userId,
        string $sessionKey,
        string $sessionExpires,
        string $lastLogin
    ): void {
        if ($userId < 1) {
            return;
        }
        $now = date('Y-m-d H:i:s');
        $database->update(static::$table, ['session_key', 'session_expires', 'last_login', 'updated_at'])
            ->where('user_id=?')
            ->assign([
                'session_key'     => $sessionKey,
                'session_expires' => $sessionExpires,
                'last_login'      => $lastLogin,
                'updated_at'      => $now,
                'user_id'         => $userId,
            ])
            ->query();
    }

    private static function dbClearSessionFields(Database $database, int $userId): void
    {
        if ($userId < 1) {
            return;
        }
        $now = date('Y-m-d H:i:s');
        $database->update(static::$table, ['session_key', 'session_expires', 'updated_at'])
            ->where('user_id=?')
            ->assign([
                'session_key'     => null,
                'session_expires' => null,
                'updated_at'      => $now,
                'user_id'         => $userId,
            ])
            ->query();
    }
};
