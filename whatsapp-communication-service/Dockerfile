# syntax=docker/dockerfile:1

# Multi-arch base (arm64 preferred for t4g.micro)
FROM node:20-alpine AS base

ENV NODE_ENV=production
WORKDIR /app

# Install deps separately to leverage Docker layer caching
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --only=production

FROM base AS build
COPY . .
# Remove dev-only folders that shouldn't be in production image
RUN rm -rf tests coverage infra-service certs logs postman || true

FROM base AS runtime
WORKDIR /app

# Persist WhatsApp auth outside container FS by default
ENV WA_SESSION_DIR=/data/wa-sessions
ENV PORT=3000

# Copy node_modules and source
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app /app

# Create data directory and wa-sessions in workdir with proper permissions
RUN mkdir -p /data/wa-sessions ./wa-sessions && \
    chown -R node:node /data /app

# Switch to non-root user
USER node

# Create mount point for sessions (bind/volume at runtime)
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD wget -qO- http://127.0.0.1:3000/v1/ping || exit 1

CMD ["node", "src/index.js"]
