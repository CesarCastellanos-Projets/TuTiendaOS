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
             bootstrap/cache \
             database \
    && touch database/database.sqlite \
    && chmod -R 777 storage bootstrap/cache database

# Instalar dependencias de producción
RUN composer install --no-dev --optimize-autoloader --no-interaction

# Variables de entorno por defecto
ENV APP_ENV=production
ENV APP_DEBUG=false
ENV APP_KEY=base64:e1sLw5r8gP+4Yp0q/8mP4Q2J5t3b1Z7n8M9k0L1v2X4=
ENV API_FACT_TOKEN=cambia-este-token-largo-y-seguro
ENV PORT=8000
EXPOSE 8000

# Script de arranque: migraciones y servidor Laravel
CMD php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=${PORT:-8000}
