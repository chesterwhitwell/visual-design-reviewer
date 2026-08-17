# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install --yes --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3080 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 reviewer \
    && useradd --system --uid 1001 --gid reviewer --home-dir /app reviewer \
    && mkdir -p /app/data /app/config /app/lib/db/migrations \
    && chmod 0700 /app/data \
    && chown -R reviewer:reviewer /app

COPY --from=builder --chown=reviewer:reviewer /app/.next/standalone ./
COPY --from=builder --chown=reviewer:reviewer /app/.next/static ./.next/static
COPY --from=builder --chown=reviewer:reviewer /app/public ./public
COPY --from=builder --chown=reviewer:reviewer /app/config ./config
COPY --from=builder --chown=reviewer:reviewer /app/lib/db/migrations ./lib/db/migrations

USER reviewer
EXPOSE 3080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
