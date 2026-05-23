<?php
Phar::loadPhar('/var/www/html/Razy.phar', 'Razy.phar');
foreach (new RecursiveIteratorIterator(new Phar('Razy.phar')) as $f) {
    $path = (string) $f;
    $c = file_get_contents($path);
    if (str_contains($c, 'resetInstances')) {
        echo basename($path), ': resetInstances found', PHP_EOL;
    }
}
