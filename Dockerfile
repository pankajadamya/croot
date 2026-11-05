# syntax=docker/dockerfile:1.7
#
# croot production image: Express API + built React app in one Node process (Collab/Coolify pattern).
# No secret is read at build time; every credential arrives as a runtime environment variable.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
# prisma generate (postinstall) loads prisma.config.ts, which needs a DATABASE_URL. Placeholder only.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS prod-deps
WORKDIR /app
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM base AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NPM_CONFIG_UPDATE_NOTIFIER=false STORAGE_BACKEND=s3

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json prisma.config.ts tsconfig.json tsconfig.server.json ./
COPY prisma ./prisma
COPY server/src ./server/src
COPY shared ./shared

ARG SOURCE_COMMIT=unknown
ENV GIT_SHA=${SOURCE_COMMIT}
LABEL org.opencontainers.image.title="croot" org.opencontainers.image.revision="${SOURCE_COMMIT}"

USER node
EXPOSE 3000

# Readiness, not liveness: an instance that cannot reach Postgres is reported unhealthy.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health/ready" > /dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
# Migrations are applied before start; keep them backward compatible (expand, then contract).
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node --import tsx server/src/index.ts"]
