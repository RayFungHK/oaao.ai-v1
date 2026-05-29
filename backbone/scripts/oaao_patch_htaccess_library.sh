#!/bin/sh
# Wrapper — never fail container boot (see docker-entrypoint.sh).
HT="${1:-/var/www/html/.htaccess}"
SCRIPT="$(dirname "$0")/oaao_patch_htaccess_library.php"
if [ -f "$SCRIPT" ]; then
    php "$SCRIPT" "$HT" 2>/dev/null || true
fi
exit 0
