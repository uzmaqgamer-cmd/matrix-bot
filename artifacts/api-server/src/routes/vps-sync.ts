/**
 * VPS → Replit state sync.
 * The VPS bot POSTs its full BotState here every 60s so the Replit dashboard
 * shows real exchange data instead of the Replit paper-trading state.
 * Auth: Authorization: Bearer {TELEGRAM_BOT_TOKEN}
 */
import { Router, Request, Response, json } from 'express';
import { BotState } from '../bot/types.js';

const router = Router();

let _vpsState: BotState | null = null;
let _vpsStateAt = 0;
const VPS_STALE_MS = 3 * 60 * 1000; // consider stale after 3 minutes with no push

export function getVpsState(): BotState | null { return _vpsState; }
export function getVpsStateAt(): number        { return _vpsStateAt; }
export function vpsStateIsAlive(): boolean {
  return _vpsState != null && (Date.now() - _vpsStateAt) < VPS_STALE_MS;
}

router.post('/vps-sync', json({ limit: '10mb' }), (req: Request, res: Response) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const auth  = req.headers.authorization ?? '';

  if (!token || auth !== `Bearer ${token}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const body = req.body as BotState;
  if (!body || typeof body !== 'object' || !('paperBalance' in body)) {
    res.status(400).json({ error: 'invalid body' });
    return;
  }

  _vpsState   = body;
  _vpsStateAt = Date.now();
  res.json({ ok: true, receivedAt: _vpsStateAt });
});

export default router;
