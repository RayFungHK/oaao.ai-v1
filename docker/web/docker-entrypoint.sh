#!/bin/sh
set -e

AUTH_DATA=/var/www/html/sites/oaaoai/oaaoai/auth/data
DIST_DATA=/var/www/html/sites/oaaoai/oaaoai/data
SLIDE_TPL="$DIST_DATA/slide-templates/custom"
LIVE_MEETING="${DIST_DATA}/live-meeting/sessions"
mkdir -p "$AUTH_DATA" "$SLIDE_TPL/incoming" "$DIST_DATA" "$LIVE_MEETING" 2>/dev/null || true
# Bind mounts often ignore chown (Docker Desktop); www-data must still create oaao_local.sqlite (+ WAL sidecars).
chown -R www-data:www-data "$AUTH_DATA" "$DIST_DATA" 2>/dev/null \
    || chmod -R a+rwx "$AUTH_DATA" "$DIST_DATA" 2>/dev/null \
    || true

for d in "$AUTH_DATA" "$DIST_DATA"; do
    if ! su www-data -s /bin/sh -c "touch \"$d/.oaao_writable_probe\" && rm -f \"$d/.oaao_writable_probe\"" 2>/dev/null; then
        chmod -R a+rwx "$d" 2>/dev/null || true
    fi
done

# Apache returns 403 if it cannot open .htaccess (e.g. 0600 from a host bind-mount).
chmod 755 /var/www/html 2>/dev/null || true
if [ -f /var/www/html/.htaccess ]; then
    chmod 644 /var/www/html/.htaccess 2>/dev/null || true
fi

# Keep Apache webassets/data rewrites aligned with sites.inc.php (incl. OAAO_* host env).
if [ -f /var/www/html/Razy.phar ]; then
    php /var/www/html/Razy.phar rewrite >/dev/null 2>&1 || true
    chmod 644 /var/www/html/.htaccess 2>/dev/null || true
fi

if [ "${OAAO_BENCH_PROBE:-}" = "1" ]; then
    echo 'auto_prepend_file=/var/www/html/bench_probe_boot.php' >> /usr/local/etc/php/conf.d/oaao-bench.ini
fi

exec apache2-foreground
