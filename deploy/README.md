# Matrix Bot — VPS Deployment Guide

The bot process runs on your DigitalOcean droplet (Ubuntu 22.04).  
The dashboard stays on Replit preview — it reads the same PostgreSQL database.

---

## One-time setup

### 1. SSH into the droplet
```bash
ssh root@YOUR_DROPLET_IP
```

### 2. Push the code to the droplet

**Option A — via GitHub (recommended)**
```bash
# On Replit shell: push to your GitHub repo first
git remote add origin https://github.com/YOUR/REPO.git
git push -u origin main

# On the droplet:
git clone https://github.com/YOUR/REPO.git /opt/matrix-bot
```

**Option B — direct copy from your machine**
```bash
# From your local machine (not Replit):
scp -r /path/to/project root@YOUR_DROPLET_IP:/opt/matrix-bot
```

### 3. Run the setup script
```bash
cd /opt/matrix-bot
bash deploy/setup.sh
```

### 4. Create your .env file
```bash
cp /opt/matrix-bot/deploy/.env.example /opt/matrix-bot/.env
nano /opt/matrix-bot/.env
```

Fill in every value. **Important:**
- `DATABASE_URL` — copy the exact URL from Replit Secrets (same DB the dashboard reads)
- `BINANCE_API_KEY` / `BINANCE_API_SECRET` — Futures-enabled key, whitelist this droplet's IP
- `LIVE_TRADING=false` — leave false until you have verified paper trading works on the VPS

### 5. Start
```bash
pm2 restart matrix-bot   # or: pm2 start (if first time, setup.sh already did this)
pm2 logs matrix-bot      # watch live logs
```

---

## Enabling live trading

Once you've confirmed the bot scans and tracks signals correctly on the VPS:

```bash
nano /opt/matrix-bot/.env
# Change: LIVE_TRADING=false  →  LIVE_TRADING=true
pm2 restart matrix-bot
pm2 logs matrix-bot
```

Watch for `[trader] ✅ LIVE OPEN` in the logs when the next signal fires.

---

## Binance API key setup

1. Log in to Binance → Profile → API Management → Create API
2. Label: `matrix-bot`
3. Enable: **Futures trading** only (do NOT enable spot, withdrawal, or margin)
4. IP restriction: whitelist your droplet's IP address
5. Copy Key and Secret → paste into `/opt/matrix-bot/.env`

---

## Redeploy after code changes

```bash
# On Replit: commit and push changes
# On the droplet:
cd /opt/matrix-bot && git pull && pnpm install \
  && pnpm --filter @workspace/api-server run build \
  && pm2 restart matrix-bot
```

---

## Useful PM2 commands

| Command | Effect |
|---|---|
| `pm2 logs matrix-bot` | Stream live logs |
| `pm2 logs matrix-bot --lines 200` | Last 200 log lines |
| `pm2 restart matrix-bot` | Restart process |
| `pm2 stop matrix-bot` | Stop process |
| `pm2 status` | Show process table |
| `pm2 monit` | Live CPU/RAM monitor |

---

## Architecture

```
Binance Futures API
      ↑ orders / fills
DigitalOcean Droplet (this VPS)
└── matrix-bot process (Node.js / PM2)
     ├── Scanner  — fetches Bybit market data, fires signals
     ├── Tracker  — monitors positions, hits TP/SL/partial-TP
     ├── Trader   — places real Binance orders when LIVE_TRADING=true
     └── writes state → PostgreSQL (shared DB)

Replit Preview Dashboard
└── reads state from PostgreSQL every 5s → live display
```
