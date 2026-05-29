<?php

declare(strict_types=1);

/**
 * Patch .htaccess after `Razy.phar rewrite` (legacy / belt-and-suspenders).
 *
 * Razy >= v1.0.3-beta no longer puts `library` on the index.php skip-list in htaccess.tpl.
 * This script remains for older phar builds and optional explicit `/library/*` early routing.
 *
 * Usage: php scripts/oaao_patch_htaccess_library.php [/path/to/.htaccess]
 */

$ht = $argv[1] ?? (getcwd() . DIRECTORY_SEPARATOR . '.htaccess');
if (! is_file($ht)) {
    exit(0);
}

$content = file_get_contents($ht);
if ($content === false) {
    fwrite(STDERR, "oaao_patch_htaccess_library: unreadable {$ht}\n");
    exit(0);
}

$marker = 'OAAO_LIBRARY_MODULE_ROUTE';
$block = <<<'HT'


# OAAO_LIBRARY_MODULE_ROUTE — oaaoai/library module (api_name library)
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_FILENAME} !-l
RewriteRule ^library/.*$ %{ENV:BASE}index.php [L]
HT;

if (strpos($content, $marker) === false) {
    $needles = [
        '# ── Distributor Rewrite Rules ──',
        '# -- Distributor Rewrite Rules --',
    ];
    $inserted = false;
    foreach ($needles as $needle) {
        if (strpos($content, $needle) !== false) {
            $content = str_replace($needle, $needle . $block, $content);
            $inserted = true;
            break;
        }
    }
    if (! $inserted && preg_match('/^RewriteEngine on\s*\r?\n/m', $content)) {
        $content = preg_replace('/^RewriteEngine on\s*\r?\n/m', 'RewriteEngine on' . $block . "\n", $content, 1);
    }
}

$content = str_replace('plugins|library|asset', 'plugins|asset', $content);

if (file_put_contents($ht, $content) === false) {
    fwrite(STDERR, "oaao_patch_htaccess_library: write failed {$ht}\n");
    exit(0);
}

exit(0);
