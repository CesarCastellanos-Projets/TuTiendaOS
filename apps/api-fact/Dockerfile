FROM php:8.2-cli-alpine

# Instalar dependencias del sistema y extensiones requeridas para SUNAT y Greenter
RUN apk add --no-cache \
    openssl \
    libzip-dev \
    libxml2-dev \
    curl-dev \
    sqlite-dev \
    git \
    unzip \
    && docker-php-ext-install -j$(nproc) \
    pdo_sqlite \
    soap \
    zip \
    curl \
    fileinfo \
    bcmath

# Copiar Composer desde imagen oficial
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www

# Copiar código fuente
COPY . /var/www

# Configurar carpetas de almacenamiento, base SQLite y permisos
RUN mkdir -p storage/framework/sessions \
             storage/framework/views \
             storage/framework/cache/data \
             storage/logs \
             storage/app/sunat \
             storage/app/private \
             bootstrap/cache \
             database \
    && touch database/database.sqlite \
    && chmod -R 777 storage bootstrap/cache database

# Instalar dependencias de producción
RUN composer install --no-dev --optimize-autoloader --no-interaction

# Variables de entorno por defecto
ENV APP_ENV=production
ENV APP_DEBUG=false
ENV DB_CONNECTION=sqlite
ENV DB_DATABASE=/var/www/database/database.sqlite
ENV CACHE_STORE=file
ENV SESSION_DRIVER=file
ENV PORT=8000
EXPOSE 8000

# Script de arranque: migraciones y servidor Laravel
CMD test -n "$APP_KEY" && test -n "$API_FACT_TOKEN" \
    && mkdir -p "${SUNAT_STORAGE_ROOT:-/var/www/storage/app/private}" "${SUNAT_CONFIG_DIR:-/var/www/storage/app/sunat}" "$(dirname "${DB_DATABASE:-/var/www/database/database.sqlite}")" \
    && touch "${DB_DATABASE:-/var/www/database/database.sqlite}" \
    && php artisan migrate --force \
    && php artisan serve --host=0.0.0.0 --port=${PORT:-8000}
