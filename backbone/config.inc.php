<?php

declare(strict_types=1);

/*
 * Production: place Razy.phar next to this file (backbone/) and point phar_location here.
 * Do not commit machine-specific absolute paths.
 */
return [
    'debug'       => false,
    'multiple_site' => false,
    'phar_location' => __DIR__,
    'timezone'    => 'UTC',
];