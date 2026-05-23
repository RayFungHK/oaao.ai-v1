<?php

/**
 * oaao.ai Auth Controller
 *
 * **Canonical (global) DB — PostgreSQL**: users, sessions (ORM), endpoints, vaults, migrations
 * tracked on {@see getDB()} — same role as {@code razit}’s primary {@code Database::GetInstance('main')}.
 *
 * **Split adjunct SQLite**: workspace chat (conversations/messages), token telemetry, history deltas,
 * training rows — {@see getDBSplit()} / {@see getDBLocal()}. Chat and similar modules must not use
 * {@see getDB()} for conversation tables.
 */

namespace Module\oaao\auth;

use InvalidArgumentException;
use Razy\Agent;
use Razy\Controller;
use Razy\Database\MigrationManager;

return new class extends Controller {
    private $db = null;

    /** @var \Razy\Database|null Adjunct SQLite (tokens / local history / training material) */
    private $dbLocal = null;

    /** Last adjunct SQLite wiring failure (debug / JSON detail after chat retry). */
    private string $adjunctSqliteLastError = '';

    private $currentUser = null;
    private bool $resolved = false;
    private bool $installed = false;

    public function getSessionCookieName(): string
    {
        $seg = '';
        if (\defined('RELATIVE_ROOT') && \is_string(RELATIVE_ROOT) && RELATIVE_ROOT !== '') {
            $seg = trim(str_replace('\\', '/', RELATIVE_ROOT), '/');
        } else {
            $path = parse_url($this->getSiteURL(), PHP_URL_PATH);
            $seg = trim(str_replace('\\', '/', (string) ($path ?: '/')), '/');
        }

        return 'oaao_' . ($seg !== '' ? str_replace(['/', '-', '.'], '_', $seg) : 'root');
    }

    public function getSessionCookiePath(): string
    {
        return \defined('RELATIVE_COOKIE_PATH') ? RELATIVE_COOKIE_PATH : '/';
    }

    public function __onInit(Agent $agent): bool
    {
        $config = $this->getModuleConfig();
        $this->installed = (bool) ($config['installed'] ?? false);

        $agent->addAPICommand([
            'restrict'                     => 'api/restrict',
            'getUser'                      => 'getUser',
            'getUserId'                    => 'getUserId',
            'getDB'                        => 'getDB',
            'getDBLocal'                   => 'getDBLocal',
            'getDBSplit'                   => 'getDBSplit',
            'ensureAdjunctSqliteLoaded'    => 'ensureAdjunctSqliteLoaded',
            'getAdjunctSqliteLastError'    => 'getAdjunctSqliteLastError',
            'requireAdmin'                 => 'requireAdmin',
            'loadModel'                    => 'loadModel',
            'isInstalled'                  => 'isInstalled',
            'databaseIsPgsql'              => 'databaseIsPgsql',
            'ensurePgCoreTables'           => 'ensurePgCoreTables',
            'ensurePgWorkspaceTables'      => 'ensurePgWorkspaceTables',
            'installSqliteLocalSchema'     => 'installSqliteLocalSchema',
            'upgradeSqliteLocalAdjunct'    => 'upgradeSqliteLocalAdjunct',
            'ensureTenantSchema'           => 'ensureTenantSchema',
            'ensurePermissionGroupSchema'  => 'ensurePermissionGroupSchema',
        ]);

        $agent->addLazyRoute([
            'GET status' => 'api/status',
        ]);

        if (! $this->installed) {
            $agent->addLazyRoute([
                'install'             => 'install',
                'POST /install/save'  => 'api/install_action',
            ]);
        } else {
            $agent->addLazyRoute([
                'POST login'    => 'api/login',
                'POST register' => 'api/register',
                'GET me'        => 'api/me',
                'POST logout'   => 'api/logout',
            ]);
        }

        return true;
    }

    public function __onAPICall(\Razy\ModuleInfo $module, string $method, string $fqdn = ''): bool
    {
        return true;
    }

    public function __onReady(): void
    {
        if (class_exists(\OaaoBenchProbe::class, false)) {
            \OaaoBenchProbe::mark('auth_onready_start');
        }

        $config   = $this->getModuleConfig();
        $dbConfig = $config['database'] ?? [];

        if (class_exists(\OaaoBenchProbe::class, false)) {
            \OaaoBenchProbe::mark('auth_onready_after_config');
        }

        if (empty($dbConfig)) {
            return;
        }

        $driver = $dbConfig['driver'] ?? 'sqlite';

        try {
            $db = \Razy\Database::GetInstance('oaao');
            if (class_exists(\OaaoBenchProbe::class, false)) {
                \OaaoBenchProbe::mark('auth_onready_after_get_instance');
            }
            if ($db->getDBAdapter() instanceof \PDO) {
                $this->db = $db;
                if (class_exists(\OaaoBenchProbe::class, false)) {
                    \OaaoBenchProbe::mark('auth_onready_reused_pdo');
                }
            } elseif ($driver === 'pgsql') {
                $ok = $db->connectWithDriver('pgsql', [
                    'host'     => $dbConfig['host'] ?? 'localhost',
                    'port'     => (int) ($dbConfig['port'] ?? 5432),
                    'database' => $dbConfig['database'] ?? '',
                    'username' => $dbConfig['username'] ?? '',
                    'password' => $dbConfig['password'] ?? '',
                ]);
                if (! $ok || $db->getDBAdapter() === null) {
                    $this->db = null;

                    return;
                }
                $db->setPrefix($dbConfig['prefix'] ?? 'oaao_');
                $this->db = $db;
            } else {
                $sqlitePath = $dbConfig['database'] ?? ':memory:';
                if ($sqlitePath !== ':memory:') {
                    $dir = \dirname((string) $sqlitePath);
                    if (! \is_dir($dir)) {
                        @\mkdir($dir, 0755, true);
                    }
                }
                $ok = $db->connectWithDriver('sqlite', [
                    'database' => $sqlitePath,
                ]);
                if (! $ok || $db->getDBAdapter() === null) {
                    $this->db = null;

                    return;
                }
                $db->setPrefix($dbConfig['prefix'] ?? 'oaao_');
                $this->db = $db;
            }
        } catch (\Throwable $e) {
            $this->db = null;

            return;
        }

        if (class_exists(\OaaoBenchProbe::class, false)) {
            \OaaoBenchProbe::mark('auth_onready_after_connect');
        }

        require_once __DIR__ . '/../library/CrossProcessBootCache.php';
        if ($this->isInstalled() && $this->db && \OaaoAuthCrossProcessBootCache::workerReady()) {
            require_once __DIR__ . '/api/_ensure_pg_core_tables.php';
            \OaaoAuthPgCoreBootstrapCache::markDone();
            if (class_exists(\OaaoBenchProbe::class, false)) {
                \OaaoBenchProbe::mark('auth_onready_fast_path');
            }
            if (class_exists(\OaaoBenchProbe::class, false)) {
                \OaaoBenchProbe::mark('auth_onready_done');
            }

            return;
        }

        if ($this->isInstalled() && $this->db) {
            static $oaaoAuthReadyBootstrapped = false;
            if (! $oaaoAuthReadyBootstrapped) {
                if (class_exists(\OaaoBenchProbe::class, false)) {
                    \OaaoBenchProbe::mark('auth_onready_bootstrap_run');
                }
                try {
                    // Do not use getMigrationManager() here: it throws if migration/ is missing (common in
                    // slim Docker copies). Tracking table + DDL bootstrap only need a bare MigrationManager.
                    $tracking = new MigrationManager($this->db);
                    $tracking->ensureTrackingTable();

                    if (($this->db->getDriverType() ?? '') === 'sqlite') {
                        require_once __DIR__ . '/api/_install_sqlite_schema.php';
                        $pdo = $this->db->getDBAdapter();
                        $hasUser = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='oaao_user'")->fetchColumn();
                        if (! $hasUser) {
                            oaao_auth_install_sqlite_core_schema($pdo);
                            oaao_auth_seed_sqlite_migration_rows($pdo);
                        }
                        oaao_auth_upgrade_sqlite_core_schema($pdo);
                    } elseif (($this->db->getDriverType() ?? '') === 'pgsql') {
                        require_once __DIR__ . '/api/_ensure_pg_core_tables.php';
                        oaao_auth_ensure_pg_core_tables($this->db);
                    }

                    try {
                        $manager = $this->getMigrationManager($this->db);
                        $pending = $manager->getPending();
                        if (! empty($pending)) {
                            $manager->migrate();
                        }
                    } catch (InvalidArgumentException) {
                        // No migration/ directory — skip optional PHP migrations only.
                    }
                } catch (\Throwable $e) {
                    error_log('oaaoai/auth __onReady DB bootstrap: ' . $e->getMessage());
                }
                $oaaoAuthReadyBootstrapped = true;
            } elseif (class_exists(\OaaoBenchProbe::class, false)) {
                \OaaoBenchProbe::mark('auth_onready_bootstrap_skip');
            }
            if (class_exists(\OaaoBenchProbe::class, false)) {
                \OaaoBenchProbe::mark('auth_onready_after_pg_boot');
            }
        }

        if ($this->isInstalled() && $this->db) {
            \OaaoAuthCrossProcessBootCache::markWorkerReady();
        }
        if (class_exists(\OaaoBenchProbe::class, false)) {
            \OaaoBenchProbe::mark('auth_onready_done');
        }
    }

    /**
     * Idempotent wiring for adjunct SQLite — runs from {@see __onReady} and may be re-invoked when chat sees an unset split DB (Docker volume / mkdir races).
     *
     * Path order: {@code OAAO_ADJUNCT_SQLITE} env (Docker override), {@code sqlite_local.database}, then {@code auth/data/oaao_local.sqlite}. Env helps when the bind-mounted {@code auth/data} is not writable for {@code www-data}.
     */
    private function wireAdjunctSqliteFromConfig(): void
    {
        if ($this->dbLocal !== null && $this->dbLocal->getDBAdapter() instanceof \PDO) {
            $this->adjunctSqliteLastError = '';

            return;
        }

        $config = $this->getModuleConfig();
        $localCfg = $config['sqlite_local'] ?? [];
        $prefix = \is_array($localCfg) ? ($localCfg['prefix'] ?? 'oaao_') : 'oaao_';

        $fromConfig = '';
        if (\is_array($localCfg)) {
            $fromConfig = \trim((string) ($localCfg['database'] ?? ''));
        }

        /** @var list<string> $paths */
        $paths = [];
        $pushPath = static function (string $p) use (&$paths): void {
            $p = trim($p);
            if ($p === '') {
                return;
            }
            if (! \in_array($p, $paths, true)) {
                $paths[] = $p;
            }
        };

        $envAdj = getenv('OAAO_ADJUNCT_SQLITE');
        if ($envAdj !== false && trim((string) $envAdj) !== '') {
            $pushPath((string) $envAdj);
        }

        if ($fromConfig !== '') {
            $pushPath($fromConfig);
        }
        if ($this->isInstalled()) {
            $authHome = \dirname((string) $this->getModuleInfo()->getPath());
            $fallback = $authHome . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'oaao_local.sqlite';
            if ($fallback !== '') {
                $pushPath($fallback);
            }
        }

        if ($paths === []) {
            if ($this->isInstalled()) {
                $this->adjunctSqliteLastError = 'no adjunct SQLite paths configured';
                error_log('oaaoai/auth: adjunct SQLite skipped — sqlite_local.database empty and no OAAO_ADJUNCT_SQLITE');
            }

            return;
        }

        // Dedicated registry name avoids a stale broken {@see Database::GetInstance()} surviving across PHP-FPM worker requests under the legacy {@code oaao_local} key after failed connects.
        $ldb = \Razy\Database::GetInstance('oaao_adjunct_sqlite');
        if ($ldb->getDBAdapter() instanceof \PDO) {
            $ldb->setPrefix($prefix);
            $this->dbLocal = $ldb;
            $this->adjunctSqliteLastError = '';

            return;
        }

        $lastErr = '';

        foreach ($paths as $localPath) {
            try {
                $dir = \dirname((string) $localPath);
                if (! \is_dir($dir)) {
                    @\mkdir($dir, 0755, true);
                }
                if (! \is_dir($dir)) {
                    @\mkdir($dir, 0777, true);
                }

                if (! \is_dir($dir)) {
                    $lastErr = 'cannot create directory for adjunct SQLite: ' . $dir;

                    continue;
                }

                if (! \is_writable($dir)) {
                    $lastErr = 'directory not writable for adjunct SQLite (need www-data write): ' . $dir;

                    continue;
                }

                $lok = $ldb->connectWithDriver('sqlite', ['database' => $localPath]);
                if (! $lok || ! $ldb->getDBAdapter() instanceof \PDO) {
                    try {
                        $probe = new \PDO(
                            'sqlite:' . $localPath,
                            null,
                            null,
                            [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION],
                        );
                        $probe = null;
                        $lastErr = 'PDO opened adjunct SQLite but Razy connectWithDriver failed — check worker logs';
                    } catch (\PDOException $pdoEx) {
                        $lastErr = $pdoEx->getMessage();
                    }

                    continue;
                }

                $ldb->setPrefix($prefix);
                require_once __DIR__ . '/api/_install_sqlite_local_schema.php';
                oaao_auth_install_sqlite_local_schema($ldb->getDBAdapter());
                $this->dbLocal = $ldb;
                $this->adjunctSqliteLastError = '';

                return;
            } catch (\Throwable $e) {
                $lastErr = $e->getMessage();
            }
        }

        $this->dbLocal = null;
        $this->adjunctSqliteLastError = $lastErr;
        if ($this->isInstalled()) {
            error_log('oaaoai/auth: adjunct SQLite failed for paths [' . implode(', ', $paths) . ']: ' . $lastErr);
        }
    }

    /**
     * Best-effort adjunct reconnect — callable from chat ({@see \\Module\\oaao\\chat}) when {@see getDBSplit()} was null after boot.
     */
    public function ensureAdjunctSqliteLoaded(): void
    {
        $this->wireAdjunctSqliteFromConfig();
    }

    /**
     * Human-readable reason the last adjunct wiring attempt failed (empty after success).
     */
    public function getAdjunctSqliteLastError(): string
    {
        return $this->adjunctSqliteLastError;
    }

    /**
     * Path-only URL to the auth module (for redirects / HTML links — stays on the browser’s current host).
     */
    public function signInPath(): string
    {
        $siteUrl = rtrim((string) $this->getSiteURL(), '/');
        $urlPath = parse_url($siteUrl . '/', PHP_URL_PATH);
        $trimPath = is_string($urlPath) ? trim($urlPath, '/') : '';
        $appBase = $trimPath === '' ? '' : '/' . $trimPath;

        return ($appBase === '' ? '/' : rtrim($appBase, '/') . '/') . 'auth/';
    }

    /**
     * @return mixed|null Active user entity or null
     */
    public function resolveUser()
    {
        if ($this->resolved) {
            return $this->currentUser;
        }
        $this->resolved = true;

        if (! $this->db || ! $this->isInstalled()) {
            return null;
        }

        $pdo = $this->db->getDBAdapter();
        require_once __DIR__ . '/api/_ensure_pg_core_tables.php';
        if ($pdo instanceof \PDO && oaao_auth_database_is_pgsql($this->db)) {
            require_once dirname(__DIR__, 3) . '/core/default/library/TenantContext.php';
            \Oaaoai\Core\TenantContext::bootstrap($pdo);
        }

        $sessionToken = $_COOKIE[$this->getSessionCookieName()] ?? '';
        if ($sessionToken === '') {
            return null;
        }

        $User = $this->loadModel('User');
        $user = $User::findBySessionKey($this->db, $sessionToken);

        if ($user && $user->isSessionValid()) {
            $User = $this->loadModel('User');
            if (\Oaaoai\Core\TenantContext::isPlatform()) {
                if (! $User::isPlatformOperator($user)) {
                    return null;
                }
            } else {
                $ctxTid = \Oaaoai\Core\TenantContext::id();
                $userTid = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
                if ($ctxTid > 0 && $userTid > 0 && $userTid !== $ctxTid) {
                    return null;
                }
            }
            $this->currentUser = $user;

            return $user;
        }

        return null;
    }

    public function getUser()
    {
        return $this->resolveUser();
    }

    public function getUserId(): int
    {
        $user = $this->resolveUser();

        return (int) ($user->user_id ?? 0);
    }

    /**
     * Canonical global DB (PostgreSQL after production install). Identity / ORM only for modules
     * that share platform state — not for workspace chat rows ({@see getDBSplit()}).
     */
    public function databaseIsPgsql(?\Razy\Database $database = null): bool
    {
        $db = $database ?? $this->db;
        if (! $db instanceof \Razy\Database) {
            return false;
        }
        require_once __DIR__ . '/api/_ensure_pg_core_tables.php';

        return oaao_auth_database_is_pgsql($db);
    }

    public function ensurePgCoreTables(?\Razy\Database $database = null): void
    {
        $db = $database ?? $this->db;
        if (! $db instanceof \Razy\Database) {
            return;
        }
        require_once __DIR__ . '/api/_ensure_pg_core_tables.php';
        oaao_auth_ensure_pg_core_tables($db);
    }

    public function ensurePgWorkspaceTables(\PDO $pdo): void
    {
        require_once __DIR__ . '/api/_install_pg_core_schema.php';
        oaao_auth_ensure_pg_workspace_tables($pdo);
    }

    public function installSqliteLocalSchema(\PDO $pdo): void
    {
        require_once __DIR__ . '/api/_install_sqlite_local_schema.php';
        oaao_auth_install_sqlite_local_schema($pdo);
    }

    public function upgradeSqliteLocalAdjunct(\PDO $pdo): void
    {
        require_once __DIR__ . '/api/_install_sqlite_local_schema.php';
        oaao_auth_upgrade_sqlite_local_adjunct($pdo);
        oaao_auth_upgrade_sqlite_message_meta_json($pdo);
    }

    public function ensureTenantSchema(\PDO $pdo): void
    {
        require_once __DIR__ . '/api/_ensure_tenant_schema.php';
        oaao_auth_ensure_tenant_schema($pdo);
    }

    public function ensurePermissionGroupSchema(\PDO $pdo): void
    {
        require_once __DIR__ . '/api/_ensure_permission_group_schema.php';
        oaao_auth_ensure_permission_group_schema($pdo);
    }

    public function getDB()
    {
        return $this->db;
    }

    /**
     * Adjunct SQLite file — conversations/messages, telemetry, RAG/ASR-friendly blobs over time.
     * Alias: {@see getDBSplit()}.
     */
    public function getDBLocal()
    {
        if ($this->dbLocal === null || ! ($this->dbLocal->getDBAdapter() instanceof \PDO)) {
            $this->wireAdjunctSqliteFromConfig();
        }

        return $this->dbLocal;
    }

    /** @see getDBLocal() */
    public function getDBSplit()
    {
        return $this->getDBLocal();
    }

    public function requireAdmin()
    {
        $user = $this->resolveUser();
        if (! $user || ($user->role ?? '') !== 'admin') {
            return null;
        }

        return $user;
    }

    /**
     * Reads {@see getModuleConfig()} each call so it stays aligned with {@see api/status}
     * and the SPA shell after install (do not rely only on {@see $installed}).
     */
    public function isInstalled(): bool
    {
        try {
            return (bool) ($this->getModuleConfig()['installed'] ?? false);
        } catch (\Throwable) {
            return false;
        }
    }
};
