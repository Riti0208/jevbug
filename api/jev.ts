/**
 * POST /api/jev — evaluates a batch of bug decision requests through Jev.
 * Thin handler: parse -> validate -> evaluate -> respond. All logic lives in
 * api/_lib/jev.ts so it is shared with the vite dev plugin and the CLI.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { evaluateBatch, validateBatch } from './_lib/jev';

function applyCors(req: VercelRequest, res: VercelResponse): void {
  const allowedOrigin = process.env.JEV_ALLOWED_ORIGIN;
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const validated = validateBatch(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  const response = await evaluateBatch(validated.batch, process.env);
  res.status(200).json(response);
}
