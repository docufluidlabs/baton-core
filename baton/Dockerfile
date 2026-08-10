# ── Build stage ───────────────────────────────────────────────
# Pinned to $BUILDPLATFORM: npm and tsc always run natively on the build
# host, never under QEMU emulation. qemu-user intermittently kills Node
# with SIGILL ("Illegal instruction") mid-`npm ci`, after which npm waits
# forever on the dead child - a silent multi-hour hang in CI. The
# dependency tree is pure JavaScript (bcryptjs, no native addons), so
# node_modules built on one architecture is valid on every architecture.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build

WORKDIR /app

# Copy dependency manifests first (layer caching)
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source code and TypeScript config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# ── Production deps stage ────────────────────────────────────
# Also native (see above). SCARF_ANALYTICS opts out of the @scarf/scarf
# install-time beacon a transitive dependency ships - no build machine
# phones home.
FROM --platform=$BUILDPLATFORM node:20-alpine AS proddeps

WORKDIR /app
ENV SCARF_ANALYTICS=false

COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# ── Production stage ─────────────────────────────────────────
# Target platform. Runs no npm at all - it only receives files.
FROM node:20-alpine AS production

# Baked in so the image is hardened even if the deployment passes no NODE_ENV.
ENV NODE_ENV=production

WORKDIR /app

COPY package.json ./
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Non-root user for security
RUN addgroup -S baton && adduser -S baton -G baton
USER baton

EXPOSE 3001

CMD ["node", "dist/server.js"]
