FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.25.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
EXPOSE 4310
CMD ["pnpm", "api"]

FROM runtime AS site-build
RUN pnpm build

FROM nginx:alpine AS workbench
COPY --from=site-build /app/sites/workbench/out /usr/share/nginx/html
COPY ops/workbench.nginx.conf /etc/nginx/conf.d/default.conf

FROM nginx:alpine AS catalog
COPY --from=site-build /app/sites/catalog/out /usr/share/nginx/html
COPY ops/catalog.nginx.conf /etc/nginx/conf.d/default.conf
