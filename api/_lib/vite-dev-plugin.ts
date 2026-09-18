/**
 * `vite dev` middleware that serves POST /api/jev and GET /api/health so the
 * browser can talk to Jev without deploying to Vercel. Mirrors api/jev.ts and
 * api/health.ts exactly (same validateBatch/evaluateBatch/resolveJevConfig),
 * just wired through Vite's Connect server instead of a Vercel function.
 *
 * Server-only: everything here runs inside `configureServer`, so it never
 * ships to the client bundle and `vite build` is unaffected.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(payload);
}

export function jevDevApiPlugin(): Plugin {
  return {
    name: 'jev-dev-api',
    apply: 'serve',

    async configureServer(server: ViteDevServer) {
      // Loaded lazily inside configureServer so nothing here touches the build graph.
      const { loadEnv } = await import('vite');
      const { validateBatch, evaluateBatch, resolveJevConfig } = await import('./jev');

      const getEnv = (): Record<string, string | undefined> => {
        const mode = server.config.mode ?? 'development';
        const root = server.config.root ?? process.cwd();
        const fileEnv = loadEnv(mode, root, '');
        return { ...process.env, ...fileEnv };
      };

      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const url = req.url.split('?')[0];

        if (url === '/api/health' && req.method === 'GET') {
          const config = resolveJevConfig(getEnv());
          sendJson(res, 200, { ok: true, backend: config.backend, model: config.model, hasKey: config.hasKey });
          return;
        }

        if (url === '/api/jev' && req.method === 'POST') {
          try {
            const body = await readJsonBody(req);
            const validated = validateBatch(body);
            if (!validated.ok) {
              sendJson(res, 400, { error: validated.error });
              return;
            }
            const response = await evaluateBatch(validated.batch, getEnv());
            sendJson(res, 200, response);
          } catch (err) {
            sendJson(res, 400, { error: err instanceof Error ? err.message : 'Invalid request body.' });
          }
          return;
        }

        next();
      });
    },
  };
}
