<?php
Phar::loadPhar('/var/www/html/Razy.phar', 'Razy.phar');
$hits = [];
foreach (new RecursiveIteratorIterator(new Phar('Razy.phar')) as $f) {
    $c = file_get_contents((string) $f);
    if (preg_match('/resetInstances|disconnect|shutdown/i', $c)) {
        $hits[(string) $f] = preg_match_all('/resetInstances|->disconnect|\bshutdown\b/i', $c);
    }
}
foreach ($hits as $path => $count) {
    echo basename($path), " ($count)\n";
}
