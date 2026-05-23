<?php
Phar::loadPhar('/var/www/html/Razy.phar', 'Razy.phar');
foreach (new RecursiveIteratorIterator(new Phar('Razy.phar')) as $f) {
    if (str_ends_with((string) $f, 'Application.php')) {
        file_put_contents('/var/www/html/scripts/razy-app.php', file_get_contents((string) $f));
        echo (string) $f, PHP_EOL;
    }
}
