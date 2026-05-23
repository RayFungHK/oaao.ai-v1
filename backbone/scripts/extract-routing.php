<?php
Phar::loadPhar('/var/www/html/Razy.phar', 'Razy.phar');
foreach (new RecursiveIteratorIterator(new Phar('Razy.phar')) as $f) {
    $p = (string) $f;
    if (str_ends_with($p, 'Module.php') || str_ends_with($p, 'LazyRoute.php') || str_ends_with($p, 'RouteDispatcher.php')) {
        $name = basename($p);
        file_put_contents('/var/www/html/scripts/razy-' . $name, file_get_contents($p));
        echo $name, PHP_EOL;
    }
}
