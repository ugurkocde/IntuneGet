# syntax=docker/dockerfile:1

# Build stage
FROM node:22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e AS builder

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
FROM node:22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

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
