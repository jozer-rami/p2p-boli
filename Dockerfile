# Stage 1: Build the React dashboard
FROM node:22-alpine AS dashboard-build

WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npx vite build

# Stage 2: Production runtime
FROM node:22-alpine

WORKDIR /app

# wget is used by the healthcheck
RUN apk add --no-cache wget

# Install production dependencies (includes tsx)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src/ ./src/
COPY tsconfig.json drizzle.config.ts ./

# Copy pre-built dashboard from stage 1
COPY --from=dashboard-build /app/dashboard/dist ./dashboard/dist

# Create non-root user
RUN addgroup -S boli && adduser -S boli -G boli
RUN mkdir -p /app/data/qr /app/data/tmp && chown -R boli:boli /app/data
USER boli

EXPOSE 3000

CMD ["node", "--import", "tsx", "src/index.ts"]
