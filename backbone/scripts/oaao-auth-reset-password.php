<?php

/**
 * Reset a user password using canonical DB settings from config/oaaoai/auth.php.
 *
 * CLI only. Docker example:
 *
 *   docker compose exec web php /var/www/html/scripts/oaao-auth-reset-password.php \
 *     --login=admin --password='YourNewPassword8+'
 *
 * Match exactly one of: --login= | --email= | --user-id=
 *
 * List accounts (no password change):
 *
 *   php oaao-auth-reset-password.php --list
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Forbidden');
}

$opts = getopt('', ['login:', 'email:', 'user-id:', 'password:', 'help', 'list']);
if (isset($opts['help']) || $opts === false) {
    fwrite(STDERR, <<<TXT
Usage:
  php oaao-auth-reset-password.php --login=NAME --password=SECRET
  php oaao-auth-reset-password.php --email=user@host --password=SECRET
  php oaao-auth-reset-password.php --user-id=1 --password=SECRET
  php oaao-auth-reset-password.php --list

Reads: config/oaaoai/auth.php (database.driver + credentials).
Use real login/email from your install; example addresses like you@example.com will match nothing.

TXT);
    exit(isset($opts['help']) ? 0 : 1);
}

$configPath = dirname(__DIR__) . '/config/oaaoai/auth.php';
if (! is_file($configPath)) {
    fwrite(STDERR, "Error: missing {$configPath}\n");

    exit(1);
}

/** @var array<string, mixed> $config */
$config = require $configPath;
$dbCfg = $config['database'] ?? [];
if (! is_array($dbCfg)) {
    fwrite(STDERR, "Error: invalid database config.\n");

    exit(1);
}

$driver = (string) ($dbCfg['driver'] ?? 'sqlite');
$prefix = (string) ($dbCfg['prefix'] ?? 'oaao_');
$table = preg_replace('/[^a-zA-Z0-9_]/', '', $prefix) . 'user';

try {
    if ($driver === 'pgsql') {
        $pdo = new PDO(
            sprintf(
                'pgsql:host=%s;port=%d;dbname=%s',
                $dbCfg['host'] ?? 'localhost',
                (int) ($dbCfg['port'] ?? 5432),
                $dbCfg['database'] ?? ''
            ),
            (string) ($dbCfg['username'] ?? ''),
            (string) ($dbCfg['password'] ?? ''),
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
    } else {
        $path = (string) ($dbCfg['database'] ?? ':memory:');
        $pdo = new PDO(
            'sqlite:' . $path,
            null,
            null,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
    }
} catch (PDOException $e) {
    fwrite(STDERR, 'Database connection failed: ' . $e->getMessage() . "\n");

    exit(1);
}

if (isset($opts['list'])) {
    $stmt = $pdo->query(
        "SELECT user_id, login_name, email, role, disabled FROM {$table} ORDER BY user_id ASC LIMIT 200"
    );
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    echo "user_id\tlogin_name\temail\trole\tdisabled\n";
    foreach ($rows as $r) {
        echo (int) ($r['user_id'] ?? 0) . "\t"
            . ($r['login_name'] ?? '') . "\t"
            . ($r['email'] ?? '') . "\t"
            . ($r['role'] ?? '') . "\t"
            . ($r['disabled'] ?? '') . "\n";
    }
    echo 'Rows: ' . count($rows) . " (table {$table}, {$driver})\n";

    exit(0);
}

$password = (string) ($opts['password'] ?? '');
if (strlen($password) < 8) {
    fwrite(STDERR, "Error: --password must be at least 8 characters.\n");

    exit(1);
}

$login = isset($opts['login']) ? trim((string) $opts['login']) : '';
$email = isset($opts['email']) ? strtolower(trim((string) $opts['email'])) : '';
$userId = isset($opts['user-id']) ? (int) $opts['user-id'] : 0;

$n = ($login !== '' ? 1 : 0) + ($email !== '' ? 1 : 0) + ($userId > 0 ? 1 : 0);
if ($n !== 1) {
    fwrite(STDERR, "Error: specify exactly one of --login, --email, or --user-id.\n");

    exit(1);
}

$hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
$now = date('Y-m-d H:i:s');

if ($userId > 0) {
    $sql = "UPDATE {$table} SET password = ?, updated_at = ? WHERE user_id = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$hash, $now, $userId]);
    $affected = $stmt->rowCount();
} elseif ($login !== '') {
    $sql = "UPDATE {$table} SET password = ?, updated_at = ? WHERE login_name = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$hash, $now, $login]);
    $affected = $stmt->rowCount();
} else {
    $sql = "UPDATE {$table} SET password = ?, updated_at = ? WHERE LOWER(TRIM(COALESCE(email, ''))) = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$hash, $now, $email]);
    $affected = $stmt->rowCount();
}

if ($affected < 1) {
    fwrite(STDERR, "Error: no row matched in {$table} — check spelling/case (email is matched lowercase+trim).\n");
    fwrite(STDERR, "Hint: php " . basename(__FILE__) . " --list\n");

    exit(1);
}

echo "Password updated ({$affected} row(s)) on {$driver} table {$table}.\n";
