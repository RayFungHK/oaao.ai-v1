# PHP + Apache serving Razy (backbone/). Requires Razy.phar next to backbone/config.inc.php.
FROM php:8.3-apache-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        libsqlite3-dev \
        libzip-dev \
        libpq-dev \
    && docker-php-ext-install -j"$(nproc)" pdo pdo_sqlite pdo_pgsql zip \
    && rm -rf /var/lib/apt/lists/*

RUN a2enmod rewrite headers \
    && sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

RUN { \
    echo 'upload_max_filesize = 32M'; \
    echo 'post_max_size = 40M'; \
    echo 'memory_limit = 256M'; \
    echo 'max_execution_time = 120'; \
} > /usr/local/etc/php/conf.d/oaao.ini

WORKDIR /var/www/html
COPY backbone/ .
RUN test -f /var/www/html/Razy.phar \
    || (echo "ERROR: Place Razy.phar in backbone/ before building — see docker/env.example"; exit 1)

COPY docker/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# CRLF from the host makes the shebang /bin/sh\r — kernel reports "no such file or directory"
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p sites/oaaoai/oaaoai/auth/data \
    && chown -R www-data:www-data sites/oaaoai/oaaoai/auth/data \
    && find /var/www/html -type d -exec chmod 755 {} + \
    && find /var/www/html -type f -exec chmod 644 {} + \
    && chown -R www-data:www-data /var/www/html

EXPOSE 80
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
