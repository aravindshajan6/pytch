# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_BASE=/api/v1
ENV VITE_API_BASE=$VITE_API_BASE
# Two separate bundles: the public app (player + partner) and the admin console.
RUN npm run build && npx vite build --config vite.admin.config.ts \
    && test ! -e dist/admin.html

FROM nginx:1.27-alpine AS runtime
ENV ADMIN_ALLOW_CIDR=0.0.0.0/0
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-public.conf nginx/security-admin.conf /etc/nginx/snippets/
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/dist-admin /usr/share/nginx/admin
COPY --from=build /app/public/favicon.svg /usr/share/nginx/admin/favicon.svg
EXPOSE 80 8090
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
