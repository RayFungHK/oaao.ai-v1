<?php
Phar::loadPhar('/var/www/html/Razy.phar', 'Razy.phar');
foreach (new RecursiveIteratorIterator(new Phar('Razy.phar')) as $f) {
    $path = (string) $f;
    if (stripos($path, 'Database') !== false) {
        echo $path, PHP_EOL;
    }
}
