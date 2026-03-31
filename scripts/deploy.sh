#!/bin/bash
set -euo pipefail

SERVER="root@87.99.134.245"
REMOTE_DIR="/opt/boli"

echo "Deploying boli to $SERVER..."
ssh "$SERVER" "cd $REMOTE_DIR && git pull origin main && docker compose up -d --build"
echo "Done. Dashboard: http://87.99.134.245:3001"
