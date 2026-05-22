<?php
return array (
  'installed' => true,
  'database' => 
  array (
    'driver' => 'pgsql',
    'host' => 'postgres',
    'port' => 5432,
    'database' => 'oaao',
    'username' => 'oaao',
    'password' => 'oaao_dev',
    'prefix' => 'oaao_',
  ),
  'sqlite_local' => 
  array (
    'driver' => 'sqlite',
    'database' => '/var/www/html/sites/oaaoai/oaaoai/auth/data/oaao_local.sqlite',
    'prefix' => 'oaao_',
  ),
);
