#!/usr/bin/env bash
# Matrix Signal Bot — VPS setup script
# Tested on Ubuntu 22.04 (DigitalOcean / Hetzner droplet)
# Run as root: bash setup.sh
set -euo pipefail

echo "=== [1/6] Installing Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git build-essential

echo "=== [2/6] Installing pnpm ==="
npm install -g pnpm pm2

echo "=== [3/6] Creating app directory ==="
mkdir -p /opt/matrix-bot
cd /opt/matrix-bot

echo ""
echo ">>> Paste your code into /opt/matrix-bot now."
echo "    Option A (GitHub):  git clone https://github.com/YOUR/REPO.git ."
echo "    Option B (scp):     already done before running this script"
echo ""
read -rp "Press ENTER once the code is in /opt/matrix-bot..."

echo "=== [4/6] Installing dependencies ==="
pnpm install --frozen-lockfile

echo "=== [5/6] Building api-server ==="
pnpm --filter @workspace/api-server run build

echo "=== [6/6] Setting up PM2 process manager ==="
cd /opt/matrix-bot/artifacts/api-server

if [ ! -f /opt/matrix-bot/.env ]; then
  echo ""
  echo ">>> .env file not found. Copy the example and fill in your secrets:"
  echo "    cp /opt/matrix-bot/deploy/.env.example /opt/matrix-bot/.env"
  echo "    nano /opt/matrix-bot/.env"
  echo ""
  read -rp "Press ENTER once /opt/matrix-bot/.env is ready..."
fi

pm2 start dist/index.mjs \
  --name matrix-bot \
  --env-file /opt/matrix-bot/.env \
  --interpreter node \
  -- --enable-source-maps

pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo ""
echo "✅  Matrix Bot is running!"
echo "    pm2 logs matrix-bot      — live logs"
echo "    pm2 restart matrix-bot   — restart after a code update"
echo "    pm2 stop matrix-bot      — stop"
echo ""
echo "    To redeploy after code changes:"
echo "    cd /opt/matrix-bot && git pull && pnpm install && pnpm --filter @workspace/api-server run build && pm2 restart matrix-bot"
