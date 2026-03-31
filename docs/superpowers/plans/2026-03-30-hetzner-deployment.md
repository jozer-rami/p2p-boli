# Hetzner Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Boli P2P trading bot to the existing Hetzner CPX11 server via Docker Compose, accessible at `http://87.99.134.245:3001`.

**Architecture:** Multi-stage Docker build (dashboard build + Node runtime), single-service Docker Compose, SQLite data persisted via volume mount. Deployed to `/opt/boli/` on the server, independent from the existing copy-trader stack.

**Tech Stack:** Docker, Docker Compose, Node 22 Alpine, tsx

**Spec:** `docs/superpowers/specs/2026-03-30-hetzner-deployment-design.md`

---

### Task 1: Move tsx to production dependencies

`tsx` is currently in `devDependencies` but is needed at runtime (`node --import tsx`). Move it so `npm ci --omit=dev` still includes it.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Move tsx from devDependencies to dependencies**

In `package.json`, remove `"tsx": "^4.19.0"` from `devDependencies` and add it to `dependencies`:

```json
"dependencies": {
    "better-sqlite3": "^12.0.0",
    "bybit-api": "^4.6.1",
    "dotenv": "^16.5.0",
    "drizzle-orm": "^0.44.0",
    "express": "^5.2.1",
    "grammy": "^1.41.1",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "tsx": "^4.19.0",
    "ws": "^8.20.0"
  },
```

- [ ] **Step 2: Regenerate lockfile**

Run: `npm install`

This updates `package-lock.json` to reflect the moved dependency.

- [ ] **Step 3: Verify the bot still starts locally**

Run: `npm run start:dry` and confirm it boots without errors (Ctrl+C after seeing "API server listening").

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: move tsx to production dependencies for Docker runtime"
```

---

### Task 2: Create .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

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

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "build: add .dockerignore for lean Docker build context"
```

---

### Task 3: Create Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create the multi-stage Dockerfile**

```dockerfile
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
```

- [ ] **Step 2: Test the Docker build locally**

Run: `docker build -t boli-bot .`

Expected: Build completes successfully. Dashboard build step produces output like `vite v6.x.x building for production...`. Final image should be ~250-350 MB.

- [ ] **Step 3: Verify the image runs**

Run: `docker run --rm -it --env-file .env -p 3001:3000 boli-bot`

Expected: Bot starts and logs appear. Visit `http://localhost:3001` — dashboard should load. Ctrl+C to stop.

Note: If you don't have a `.env` file locally, create a minimal one with `DRY_RUN=true` and dummy values for the required keys. The goal is just to verify the image boots.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "build: add multi-stage Dockerfile for production deployment"
```

---

### Task 4: Create docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

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

- [ ] **Step 2: Test with docker compose**

Run: `docker compose up --build`

Expected: Bot starts, healthcheck passes after ~15s. Check with: `docker compose ps` — status should show `healthy`. Visit `http://localhost:3001`. Ctrl+C to stop.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "build: add docker-compose.yml for single-service deployment"
```

---

### Task 5: Create deploy script

**Files:**
- Create: `scripts/deploy.sh`

- [ ] **Step 1: Create the deploy script**

```bash
#!/bin/bash
set -euo pipefail

SERVER="root@87.99.134.245"
REMOTE_DIR="/opt/boli"

echo "Deploying boli to $SERVER..."
ssh "$SERVER" "cd $REMOTE_DIR && git pull origin main && docker compose up -d --build"
echo "Done. Dashboard: http://87.99.134.245:3001"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/deploy.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy.sh
git commit -m "build: add deploy.sh for Hetzner server updates"
```

---

### Task 6: First-time server setup and deploy

This task is done manually via SSH. Each step is a command to run.

- [ ] **Step 1: SSH into the server**

```bash
ssh root@87.99.134.245
```

- [ ] **Step 2: Generate a deploy key and add it to GitHub**

On the server:
```bash
ssh-keygen -t ed25519 -C "boli-deploy-key" -f ~/.ssh/boli_deploy -N ""
cat ~/.ssh/boli_deploy.pub
```

Copy the public key output. Go to `https://github.com/jozer-rami/p2p-boli/settings/keys` and add it as a deploy key (read-only access is sufficient).

Configure SSH to use this key for GitHub:
```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com-boli
  HostName github.com
  User git
  IdentityFile ~/.ssh/boli_deploy
EOF
```

- [ ] **Step 3: Clone the repo**

```bash
git clone git@github.com-boli:jozer-rami/p2p-boli.git /opt/boli
```

If the server already has a GitHub SSH key configured, you can skip the deploy key and use:
```bash
git clone git@github.com:jozer-rami/p2p-boli.git /opt/boli
```

- [ ] **Step 4: Create the .env file**

```bash
cp /opt/boli/.env.example /opt/boli/.env
nano /opt/boli/.env
```

Fill in the real values:
```
BYBIT_API_KEY=<your-key>
BYBIT_API_SECRET=<your-secret>
TELEGRAM_BOT_TOKEN=<your-token>
TELEGRAM_CHAT_ID=<your-chat-id>
BYBIT_TESTNET=false
DB_PATH=./data/bot.db
LOG_LEVEL=info
DASHBOARD_PORT=3000
DRY_RUN=true
```

- [ ] **Step 5: Create persistent data directories**

```bash
mkdir -p /opt/boli/data/qr /opt/boli/data/tmp
```

- [ ] **Step 6: Build and start**

```bash
cd /opt/boli && docker compose up -d --build
```

Expected: Image builds (first time takes 2-3 minutes), container starts.

- [ ] **Step 7: Verify**

```bash
docker compose ps
docker compose logs --tail 50
```

Expected: Container status is `healthy`. Logs show bot starting in dry-run mode, polling loops active.

Visit `http://87.99.134.245:3001` in a browser — dashboard should load.

- [ ] **Step 8: Verify deploy script works from local machine**

Back on your local machine:
```bash
./scripts/deploy.sh
```

Expected: Pulls latest, rebuilds (should be fast due to layer cache), restarts.
