<?php
Phar::loadPhar('/var/www/html/Razy.phar', 'Razy.phar');
$c = file_get_contents('phar://Razy.phar/library/Razy/Distributor.php');
file_put_contents('/var/www/html/scripts/razy-distributor.php', $c);
echo substr($c, 0, 2000);
