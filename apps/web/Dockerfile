# syntax=docker/dockerfile:1.4
# Multi-stage production build for MES Cleanroom Web Frontend
# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/

# Build shared package then Vite SPA
RUN npm --workspace=@mes/shared run build
RUN npm --workspace=@mes/web run build

# Stage 2: Production web server (Nginx Alpine)
FROM nginx:1.27-alpine AS runner

# Remove default nginx website
RUN rm -rf /usr/share/nginx/html/*

# Copy built SPA artifacts
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy custom production nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
