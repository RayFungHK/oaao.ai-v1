<?php
Phar::loadPhar('/var/www/html/Razy.phar', 'Razy.phar');
foreach (new RecursiveIteratorIterator(new Phar('Razy.phar')) as $f) {
    $p = (string) $f;
    if (str_ends_with($p, 'Registry.php') && str_contains($p, 'Distributor')) {
        file_put_contents('/var/www/html/scripts/razy-registry.php', file_get_contents($p));
        echo $p, PHP_EOL;
    }
    if (str_ends_with($p, 'ClosureLoader.php')) {
        file_put_contents('/var/www/html/scripts/razy-closure.php', file_get_contents($p));
        echo $p, PHP_EOL;
    }
}
