# syntax=docker/dockerfile:1

# Build stage
FROM node:26.5.0-alpine3.23@sha256:0473b6671ff22c8eeb570c0e1e51408595d3171e73f8002c269b763f0a943149 AS builder

WORKDIR /app

# Toolchain for native node modules that have no prebuilt binary for the target
# arch (notably tree-sitter-python from the gt translation tooling, and
# better-sqlite3 used by sqlite mode). Required for the linux/arm64 multi-arch
# build, where these compile from source via node-gyp.
RUN apk add --no-cache python3 make g++

# Install exactly the dependency graph committed in package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source files
COPY . .

# Build application
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build:ci

# Production stage
FROM node:26.5.0-alpine3.23@sha256:0473b6671ff22c8eeb570c0e1e51408595d3171e73f8002c269b763f0a943149 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The production container runs the standalone server directly and does not
# need npm. Remove the package manager and its bundled dependencies from the
# runtime image to reduce attack surface and avoid shipping vulnerable tools.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Supabase migrations (for reference)
COPY --from=builder /app/supabase ./supabase

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
