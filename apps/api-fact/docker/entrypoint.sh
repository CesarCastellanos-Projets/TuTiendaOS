#!/bin/sh
set -eu
: "${APP_KEY:?Falta APP_KEY}"
: "${API_FACT_TOKEN:?Falta API_FACT_TOKEN}"
PORT="${PORT:-8000}"
PHP_FPM_MAX_CHILDREN="${PHP_FPM_MAX_CHILDREN:-2}"
case "$PORT:$PHP_FPM_MAX_CHILDREN" in *[!0-9:]*|:*|*:) echo "Configuración numérica inválida" >&2; exit 1;; esac
test "$PORT" -ge 1 && test "$PORT" -le 65535
test "$PHP_FPM_MAX_CHILDREN" -ge 1 && test "$PHP_FPM_MAX_CHILDREN" -le 16
export PORT PHP_FPM_MAX_CHILDREN
mkdir -p "${SUNAT_STORAGE_ROOT:-/var/www/storage/app/private}" "${SUNAT_CONFIG_DIR:-/var/www/storage/app/sunat}" /run/nginx
if [ "${DB_CONNECTION:-sqlite}" = sqlite ]; then
    mkdir -p "$(dirname "${DB_DATABASE:-/var/www/database/database.sqlite}")"
    touch "${DB_DATABASE:-/var/www/database/database.sqlite}"
    chown www-data:www-data "$(dirname "${DB_DATABASE:-/var/www/database/database.sqlite}")" "${DB_DATABASE:-/var/www/database/database.sqlite}"
fi
chown www-data:www-data "${SUNAT_STORAGE_ROOT:-/var/www/storage/app/private}" "${SUNAT_CONFIG_DIR:-/var/www/storage/app/sunat}"
envsubst '${PORT}' < docker/nginx.conf.template > /etc/nginx/nginx.conf
envsubst '${PHP_FPM_MAX_CHILDREN}' < docker/fpm.conf.template > /usr/local/etc/php-fpm.d/zzzz-denzoz.conf
php artisan migrate --force
php artisan config:cache
chown -R www-data:www-data bootstrap/cache storage/framework
nginx -t
php-fpm -t
exec /usr/bin/supervisord -c /etc/supervisord.conf
