# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Build-time env vars (Vite embeds VITE_* at build time)
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

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
