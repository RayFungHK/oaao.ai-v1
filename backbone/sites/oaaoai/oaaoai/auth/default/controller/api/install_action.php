<?php

/**
 * POST /auth/install/save — First-run: PostgreSQL canonical schema + superuser +
 * adjunct SQLite file (tokens / rich history / training material).
 *
 * Postgres URL: form/body JSON `pg_url` or environment `OAAO_PG_URL`.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    require_once __DIR__ . '/_pg_url.php';

    try {
        $bootConfig = $this->getModuleConfig();
        if ((bool) ($bootConfig['installed'] ?? false)) {
            echo json_encode([
                'result'    => false,
                'message'   => 'Already installed. Reload the page to sign in.',
                'installed' => true,
            ]);

            return;
        }
    } catch (\Throwable) {
        // Missing/invalid seed config — continue; PostgreSQL bootstrap may still recover.
    }
    require_once __DIR__ . '/_install_pg_core_schema.php';
    require_once __DIR__ . '/_install_sqlite_local_schema.php';

    $authHome = dirname((string) $this->getModuleInfo()->getPath());
    $dataDir   = $authHome . DIRECTORY_SEPARATOR . 'data';
    if (! is_dir($dataDir)) {
        mkdir($dataDir, 0755, true);
    }
    $localSqlitePath = $dataDir . DIRECTORY_SEPARATOR . 'oaao_local.sqlite';

    $input  = json_decode(file_get_contents('php://input'), true) ?: [];
    $pgUrl  = trim((string) ($input['pg_url'] ?? ''));
    if ($pgUrl === '') {
        $env = getenv('OAAO_PG_URL');
        $pgUrl = ($env !== false && trim((string) $env) !== '') ? trim((string) $env) : '';
    }
    if ($pgUrl === '') {
        http_response_code(400);
        echo json_encode([
            'result'  => false,
            'message' => 'PostgreSQL URL required: set environment OAAO_PG_URL or include pg_url (postgresql://…) in the request body.',
        ]);

        return;
    }

    $parsed = oaao_auth_pg_parse_url($pgUrl);
    if ($parsed === null) {
        http_response_code(400);
        echo json_encode(['result' => false, 'message' => 'Invalid pg_url — use postgresql://user:password@host:port/database (or postgres://…)']);

        return;
    }

    try {
        $db = \Razy\Database::GetInstance('oaao');
        $ok = $db->connectWithDriver('pgsql', [
            'host'     => $parsed['host'],
            'port'     => $parsed['port'],
            'database' => $parsed['dbname'],
            'username' => $parsed['user'],
            'password' => $parsed['password'],
        ]);
        if (! $ok || $db->getDBAdapter() === null) {
            http_response_code(500);
            echo json_encode([
                'result'  => false,
                'message' => 'PostgreSQL connection failed — check pg_url credentials and firewall.',
            ]);

            return;
        }
        $db->setPrefix('oaao_');
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['result' => false, 'message' => 'PostgreSQL connection failed: ' . $e->getMessage()]);

        return;
    }

    try {
        $pdo = $db->getDBAdapter();
        // Bare MigrationManager: getMigrationManager() requires migration/ on disk (often omitted in Docker).
        $mgr = new \Razy\Database\MigrationManager($db);
        $mgr->ensureTrackingTable();
        oaao_auth_install_pg_core_schema($pdo);
        oaao_auth_seed_pg_migration_rows($pdo);
        $this->ensureTenantSchema($pdo);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['result' => false, 'message' => 'PostgreSQL schema bootstrap failed: ' . $e->getMessage()]);

        return;
    }

    try {
        $pdoLocal = new \PDO(
            'sqlite:' . $localSqlitePath,
            null,
            null,
            [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]
        );
        $this->installSqliteLocalSchema($pdoLocal);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['result' => false, 'message' => 'Local SQLite adjunct failed: ' . $e->getMessage()]);

        return;
    }

    $loginName   = trim($input['login_name'] ?? '');
    $password    = $input['password'] ?? '';
    $email       = trim($input['email'] ?? '');
    if ($email !== '') {
        $email = strtolower($email);
    }
    $displayName = trim($input['display_name'] ?? $loginName);

    if (strlen($loginName) < 3) {
        http_response_code(400);
        echo json_encode(['result' => false, 'message' => 'Login name must be at least 3 characters']);

        return;
    }
    if (strlen($password) < 8) {
        http_response_code(400);
        echo json_encode(['result' => false, 'message' => 'Password must be at least 8 characters']);

        return;
    }

    $localhostTenantId = 0;
    try {
        $localhostTenantId = (int) $pdo->query(
            "SELECT tenant_id FROM oaao_tenant WHERE slug = 'localhost' LIMIT 1",
        )->fetchColumn();
    } catch (\Throwable) {
        $localhostTenantId = 0;
    }

    $adminInserted = false;
    $now = date('Y-m-d H:i:s');
    $disp = $displayName !== '' ? $displayName : $loginName;
    $mail = $email !== '' ? $email : null;
    try {
        $db->insert('user', ['login_name', 'password', 'display_name', 'email', 'role', 'disabled', 'tenant_id', 'created_at', 'updated_at'])
            ->assign([
                'login_name'   => $loginName,
                'password'     => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]),
                'display_name' => $disp,
                'email'        => $mail,
                'role'         => 'admin',
                'disabled'     => 0,
                'tenant_id'    => $localhostTenantId > 0 ? $localhostTenantId : null,
                'created_at'   => $now,
                'updated_at'   => $now,
            ])
            ->query();
        $adminInserted = true;
    } catch (\PDOException $e) {
        // Retry: admin row may exist from a previous failed install (before config save).
        $info = $e->errorInfo;
        $state = (string) ($info[0] ?? '');
        $isDup = ($state === '23505')
            || str_contains(strtolower($e->getMessage()), 'unique')
            || str_contains(strtolower($e->getMessage()), 'duplicate');
        if ($isDup) {
            try {
                $aff = $db->update('user', ['password', 'display_name', 'email', 'updated_at'])
                    ->where('login_name=?,role=?')
                    ->assign([
                        'password'     => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]),
                        'display_name' => $disp,
                        'email'        => $mail,
                        'updated_at'   => $now,
                        'login_name'   => $loginName,
                        'role'         => 'admin',
                    ])
                    ->query()
                    ->affected();
                if ($aff > 0) {
                    $adminInserted = true;
                }
            } catch (\Throwable) {
                /* fall through */
            }
            if (! $adminInserted) {
                $cntRow = $db->prepare()
                    ->select('COUNT(*) AS cnt')
                    ->from('user')
                    ->where('role=?')
                    ->assign(['role' => 'admin'])
                    ->query()
                    ->fetch();
                $adminCount = (int) ((\is_array($cntRow) && isset($cntRow['cnt'])) ? $cntRow['cnt'] : 0);
                if ($adminCount >= 1) {
                    $adminInserted = false;
                } else {
                    http_response_code(500);
                    echo json_encode(['result' => false, 'message' => 'Superuser creation failed: ' . $e->getMessage()]);

                    return;
                }
            }
        } else {
            http_response_code(500);
            echo json_encode(['result' => false, 'message' => 'Superuser creation failed: ' . $e->getMessage()]);

            return;
        }
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['result' => false, 'message' => 'Superuser creation failed: ' . $e->getMessage()]);

        return;
    }

    try {
        $config = $this->getModuleConfig();
        $config['database']      = oaao_auth_pg_razy_db_config($parsed);
        $config['sqlite_local']  = [
            'driver'   => 'sqlite',
            'database' => $localSqlitePath,
            'prefix'   => 'oaao_',
        ];
        $config['installed'] = true;
        $config->save();
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'result'  => false,
            'message' => 'Saving configuration failed — ensure backbone/config/oaaoai/auth.php is writable (' . $e->getMessage() . ')',
        ]);

        return;
    }

    $authRoot     = dirname((string) $this->getModuleInfo()->getPath());
    $backboneRoot = dirname($authRoot, 4);
    $authPhpPath  = $backboneRoot . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'oaaoai' . DIRECTORY_SEPARATOR . 'auth.php';
    if (! is_file($authPhpPath)) {
        http_response_code(500);
        echo json_encode([
            'result'  => false,
            'message' => 'Cannot verify auth config — expected file missing at config/oaaoai/auth.php (wrong deploy layout?).',
        ]);

        return;
    }
    if (function_exists('opcache_invalidate')) {
        @opcache_invalidate($authPhpPath, true);
    }
    clearstatcache(true, $authPhpPath);
    /** @var mixed $written */
    $written = require $authPhpPath;
    if (! is_array($written) || empty($written['installed'])) {
        http_response_code(500);
        echo json_encode([
            'result'  => false,
            'message' => 'Configuration save returned OK but auth.php still shows installed=false — check permissions and Opcache (path: config/oaaoai/auth.php).',
        ]);

        return;
    }

    require_once __DIR__ . '/_ensure_pg_core_tables.php';
    oaao_auth_reset_pg_core_tables_cache();
    oaao_auth_reset_sqlite_local_schema_cache();

    echo json_encode([
        'result'  => true,
        'message' => ($adminInserted
            ? 'Installation complete — primary data in PostgreSQL; adjunct SQLite at auth/data/oaao_local.sqlite'
            : 'Configuration saved — an administrator already existed; reload to sign in.'),
    ]);
};
