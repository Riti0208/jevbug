/**
 * GET /api/health — reports Jev backend/model/key configuration.
 * Never reveals the key itself, only whether one is present.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { resolveJevConfig } from './_lib/jev';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  const config = resolveJevConfig(process.env);
  res.status(200).json({ ok: true, backend: config.backend, model: config.model, hasKey: config.hasKey });
}
