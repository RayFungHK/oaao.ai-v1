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

# Same-origin /sidecar → orchestrator (SSE bypasses PHP entirely).
# Strip CR (Windows env files) — bare \r breaks sed and heredoc upstream URLs.
SIDECAR_UPSTREAM="$(printf '%s' "${OAAO_ORCHESTRATOR_INTERNAL_URL:-http://orchestrator:8103}" | tr -d '\r' | sed 's#/*$##')"
SIDECAR_WS_UPSTREAM="$(printf '%s' "$SIDECAR_UPSTREAM" | sed 's#^http#ws#')"
SIDECAR_PATH="$(printf '%s' "${OAAO_ORCHESTRATOR_SIDECAR_PATH:-/sidecar}" | tr -d '\r' | sed 's#^/*##;s#/*$##')"
SIDECAR_PATH="/${SIDECAR_PATH}"
cat > /etc/apache2/conf-available/oaao-sidecar-proxy.conf <<EOF
# Apache reverse proxy — browser SSE + WebSocket to Python orchestrator (no PHP workers).
# Requires mod_proxy_wstunnel (see docker/web/Dockerfile).
ProxyPreserveHost On
ProxyPass ${SIDECAR_PATH}/ ${SIDECAR_WS_UPSTREAM}/ upgrade=websocket
ProxyPass ${SIDECAR_PATH}/ ${SIDECAR_UPSTREAM}/
ProxyPassReverse ${SIDECAR_PATH}/ ${SIDECAR_UPSTREAM}/
RequestHeader set X-Forwarded-Proto "https" env=HTTPS
ProxyTimeout 3600
EOF
a2enconf oaao-sidecar-proxy >/dev/null 2>&1 || true

# Razy catch-all sends unknown paths to index.php — exclude /sidecar for mod_proxy.
if [ -f /var/www/html/.htaccess ] && ! grep -q 'OAAO_ORCHESTRATOR_SIDECAR' /var/www/html/.htaccess; then
    sed -i '/^RewriteEngine on$/a\
\
# OAAO_ORCHESTRATOR_SIDECAR — Apache ProxyPass handles /sidecar (not PHP).\
RewriteRule ^sidecar(/.*)?$ - [L]' /var/www/html/.htaccess
fi

exec apache2-foreground
