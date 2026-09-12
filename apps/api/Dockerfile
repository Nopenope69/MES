# syntax=docker/dockerfile:1.4
# Multi-stage production build for MES API Engine
# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools for native compilation if required
RUN apk add --no-cache python3 make g++

# Copy package manifests for deterministic layer caching
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Clean install all dependencies
RUN npm ci

# Copy source code and build configs
COPY tsconfig*.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/

# Build shared package then api
RUN npm --workspace=@mes/shared run build
RUN npm --workspace=@mes/api run build

# Prune development dependencies
RUN npm prune --production

# Stage 2: Hardened, minimal production runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Install dumb-init for proper signal handling and curl for health probes
RUN apk add --no-cache dumb-init curl

ENV NODE_ENV=production
ENV PORT=4000
ENV FUJI_PORT=30040

# Create dedicated unprivileged user for security compliance
RUN addgroup -S mesgroup && adduser -S mesuser -G mesgroup

# Copy production artifacts from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/src/db/schema.sql ./apps/api/src/db/schema.sql

# Prepare data directory for persistent factory-edge storage
RUN mkdir -p /app/data && chown -R mesuser:mesgroup /app

USER mesuser

EXPOSE 4000 30040

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "apps/api/dist/server.js"]
