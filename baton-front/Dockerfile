# ── Build stage ───────────────────────────────────────────────
# Pinned to $BUILDPLATFORM: the Vite build runs natively on the build host,
# never under QEMU (which intermittently kills Node with SIGILL mid-npm-ci
# and hangs the job). The output is static files, identical for every
# target architecture; only the nginx stage below is per-platform.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build

WORKDIR /app

# Copy dependency manifests first (layer caching)
COPY package.json package-lock.json ./

# Install all dependencies
RUN npm ci

# Copy source code and config files
COPY . .

# Build the Vite/React application
RUN npm run build

# ── Production stage ─────────────────────────────────────────
FROM nginx:alpine AS production

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
