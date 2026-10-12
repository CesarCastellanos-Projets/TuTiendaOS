FROM php:8.2-fpm-alpine

# Instalar dependencias del sistema y extensiones requeridas para SUNAT y Greenter
RUN apk add --no-cache \
    openssl \
    libzip-dev \
    libxml2-dev \
    curl-dev \
    sqlite-dev \
    git \
    unzip \
    nginx \
    supervisor \
    gettext \
    oniguruma-dev \
    && docker-php-ext-install -j$(nproc) \
    pdo_sqlite \
    soap \
    zip \
    curl \
    fileinfo \
    bcmath \
    mbstring \
    opcache

# Copiar Composer desde imagen oficial
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

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
    && chown -R www-data:www-data storage bootstrap/cache database \
    && chmod -R 775 storage bootstrap/cache database

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
ENV PHP_FPM_MAX_CHILDREN=2
EXPOSE 8000

COPY docker/php.ini /usr/local/etc/php/conf.d/denzoz.ini
COPY docker/supervisord.conf /etc/supervisord.conf
RUN sed -i 's/\r$//' docker/entrypoint.sh && chmod +x docker/entrypoint.sh
ENTRYPOINT ["/var/www/docker/entrypoint.sh"]
