# syntax=docker/dockerfile:1

# --- Stage 1: resolve plugins/themes declared as code (composer.json) ---
FROM docker.io/library/composer:2 AS build
WORKDIR /build
COPY composer.json composer.lock* ./
RUN composer install \
    --no-dev \
    --no-interaction \
    --no-progress \
    --no-scripts \
    --optimize-autoloader

# --- Stage 2: WordPress runtime (php-fpm) ---
# 6.6 didn't satisfy Yoast SEO's "requires at least WordPress 6.9" - bumped to 7.0.
FROM docker.io/library/wordpress:7.0-php8.3-fpm-alpine

# Bake the composer-managed plugins/themes into the WP core source tree.
# The stock docker-entrypoint.sh copies /usr/src/wordpress into /var/www/html
# on first boot (skipping anything already present), so this is all that's
# needed to make plugins/themes "part of the image".
COPY --from=build /build/wp-content/plugins/ /usr/src/wordpress/wp-content/plugins/
COPY --from=build /build/wp-content/themes/ /usr/src/wordpress/wp-content/themes/
COPY wp-content/mu-plugins/ /usr/src/wordpress/wp-content/mu-plugins/

# OpenShift's restricted SCC runs containers as an arbitrary, unpredictable
# UID that belongs to group 0. Make everything the app needs group-writable
# and drop the php-fpm pool's user/group directives so the master process
# (already non-root) doesn't try to setuid/setgid on startup.
RUN sed -i -e '/^user = /d' -e '/^group = /d' /usr/local/etc/php-fpm.d/www.conf && \
    mkdir -p /var/run/php && \
    for dir in /usr/src/wordpress /var/www/html /usr/local/etc/php-fpm.d /var/run/php /tmp; do \
        chgrp -R 0 "$dir" && chmod -R g=u "$dir"; \
    done

USER 1001
EXPOSE 9000
