# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS build

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

# ── Production stage ─────────────────────────────────────────
FROM node:20-alpine AS production

# Baked in so the image is hardened even if the deployment passes no NODE_ENV.
ENV NODE_ENV=production

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

# Non-root user for security
RUN addgroup -S baton && adduser -S baton -G baton
USER baton

EXPOSE 3001

CMD ["node", "dist/server.js"]
