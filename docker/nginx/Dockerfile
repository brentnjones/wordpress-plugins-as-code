# nginx-unprivileged already listens on 8080 as a non-root user and is
# compatible with OpenShift's restricted SCC (arbitrary UID, group 0).
FROM docker.io/nginxinc/nginx-unprivileged:1.27-alpine

COPY templates/default.conf.template /etc/nginx/templates/default.conf.template

ENV FASTCGI_HOST=127.0.0.1

EXPOSE 8080
