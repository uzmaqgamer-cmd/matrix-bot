/**
 * Cloudflare Worker — Binance Futures API proxy
 *
 * Deploys in 2 minutes on Cloudflare's free tier (100k req/day).
 * This Worker forwards requests from the Replit deployed server to
 * fapi.binance.com, bypassing Binance's datacenter IP geo-block.
 *
 * HOW TO DEPLOY
 * ─────────────
 * 1. Go to https://workers.cloudflare.com  (free account, no card needed)
 * 2. Click "Create application" → "Create Worker"
 * 3. Paste this entire file into the editor, click "Deploy"
 * 4. Copy the Worker URL shown (e.g. https://my-worker.username.workers.dev)
 * 5. In Replit → Secrets, add:
 *      Key:   BINANCE_PROXY_URL
 *      Value: https://my-worker.username.workers.dev
 * 6. Publish your Replit app — the bot will call the Worker, which calls Binance.
 *
 * The Worker only proxies GET requests and adds no auth; it is safe to use
 * for public Binance market-data endpoints only.
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = 'https://fapi.binance.com' + url.pathname + url.search;
    const resp = await fetch(target, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    return new Response(resp.body, {
      status: resp.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
