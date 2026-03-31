# Hetzner Deployment Design

**Date:** 2026-03-30
**Status:** Approved

## Context

Deploy the Boli P2P trading bot to an existing Hetzner CPX11 server (2 shared vCPU, 2 GB RAM, 40 GB disk, Ubuntu 24.04) at `87.99.134.245` in Ashburn, VA.

The server already runs a Polymarket copy-trader-bot via Docker Compose at `/opt/copy-trader-bot/` with PostgreSQL, Prometheus, and Grafana. Current memory usage is ~700 MB with ~1.3 GB available. Boli is expected to consume ~80-120 MB.

**Approach:** Standalone Docker Compose deployment at `/opt/boli/`, fully independent from the copy-trader stack. No reverse proxy, no domain, no SSL — accessed by IP + port.

## Dockerfile

Multi-stage build using Node 22 Alpine:

### Stage 1: `dashboard-build`

- Base: `node:22-alpine`
- Workdir: `/app/dashboard`
- Copy `dashboard/package.json` and `dashboard/package-lock.json`
- Run `npm ci`
- Copy rest of `dashboard/` source
- Run `npx vite build` → produces `/app/dashboard/dist/`

### Stage 2: `runtime`

- Base: `node:22-alpine`
- Workdir: `/app`
- Install `wget` (for healthcheck, already in Alpine but ensuring availability)
- Copy `package.json` and `package-lock.json` from project root
- Run `npm ci --omit=dev`
- Copy `src/`, `tsconfig.json`, `drizzle.config.ts`
- Copy `dashboard/dist/` from stage 1 into `/app/dashboard/dist/`
- Create non-root user `boli` and switch to it
- Volume mount point: `/app/data` (SQLite DB + QR images)
- `EXPOSE 3000`
- `CMD ["node", "--import", "tsx", "src/index.ts"]`

**Why tsx in production:** The bot is not CPU-bound (polling loops every 5-60s). The tsx overhead is negligible and avoids maintaining a separate tsc build step + compiled output. If performance ever matters, switching to a pre-compiled build is trivial.

## docker-compose.yml

```yaml
services:
  bot:
    build: .
    container_name: boli-bot
    restart: unless-stopped
    env_file: .env
    ports:
      - "3001:3000"
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/api/status"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

Single service. No database container — SQLite is an embedded file in the `data/` volume. Port `3001` externally to avoid conflict with copy-trader's `3030`.

## .dockerignore

```
node_modules
dashboard/node_modules
dashboard/dist
data
.git
.env
.env.local
*.db
*.db-journal
*.db-shm
*.db-wal
*.log
tests
docs
.claude
.superpowers
p2p-trader
```

Keeps the build context small. The `data/` directory is excluded because it's mounted as a volume at runtime, not baked into the image.

## Deploy Script (`scripts/deploy.sh`)

```bash
#!/bin/bash
set -euo pipefail

SERVER="root@87.99.134.245"
REMOTE_DIR="/opt/boli"

echo "Deploying boli to $SERVER..."
ssh "$SERVER" "cd $REMOTE_DIR && git pull origin main && docker compose up -d --build"
echo "Done. Dashboard: http://87.99.134.245:3001"
```

Simple pull-and-rebuild. Docker layer caching makes rebuilds fast when only source changes (npm ci layer is cached if package-lock.json hasn't changed).

## First-Time Server Setup

One-time manual steps:

1. **SSH into server:** `ssh root@87.99.134.245`
2. **Add deploy key:** Generate an SSH key on the server and add it as a deploy key to the GitHub repo (read-only)
3. **Clone repo:** `git clone git@github.com:jozer-rami/p2p-boli.git /opt/boli`
4. **Create env file:** `cp /opt/boli/.env.example /opt/boli/.env && nano /opt/boli/.env` — fill in secrets
5. **Create data directories:** `mkdir -p /opt/boli/data/qr /opt/boli/data/tmp`
6. **Start:** `cd /opt/boli && docker compose up -d --build`
7. **Verify:** `docker compose logs -f` and visit `http://87.99.134.245:3001`

## Environment Variables

The `.env` file on the server must contain:

```
# Required
BYBIT_API_KEY=<key>
BYBIT_API_SECRET=<secret>
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat_id>

# Deployment defaults
BYBIT_TESTNET=false
DB_PATH=./data/bot.db
LOG_LEVEL=info
DASHBOARD_PORT=3000
DRY_RUN=true
```

Bot starts in dry-run mode. Switch to live by setting `DRY_RUN=false` and restarting: `docker compose up -d`.

## Port Allocation (Full Server)

| Port | Service |
|------|---------|
| 3001 | **Boli dashboard + API** |
| 3030 | Copy-trader dashboard |
| 3333 | Grafana |
| 5432 | PostgreSQL |
| 9090 | Copy-trader health/metrics |
| 9091 | Prometheus |

## Access

- **Dashboard:** `http://87.99.134.245:3001`
- **API:** `http://87.99.134.245:3001/api/status`
- **WebSocket:** `ws://87.99.134.245:3001/ws`
- **Telegram:** Works everywhere (outbound connections only)

## Resource Estimates

| Resource | Boli | Available | Headroom |
|----------|------|-----------|----------|
| RAM | ~100 MB | ~1.3 GB | Comfortable |
| Disk | ~200 MB (image + deps) | 28 GB | Plenty |
| CPU | Negligible (polling) | 2 shared vCPU | Fine |

## Update Workflow

From local machine:
```bash
# Option A: deploy script
./scripts/deploy.sh

# Option B: manual
ssh root@87.99.134.245 "cd /opt/boli && git pull && docker compose up -d --build"
```

## Files to Create

1. `Dockerfile` — in project root
2. `docker-compose.yml` — in project root
3. `.dockerignore` — in project root
4. `scripts/deploy.sh` — deploy script
