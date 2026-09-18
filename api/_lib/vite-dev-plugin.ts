import type { Plugin } from 'vite';

/**
 * Placeholder — replaced by the Jev integration work. Serves /api/jev during `vite dev`
 * so the browser can talk to Jev without deploying to Vercel.
 */
export function jevDevApiPlugin(): Plugin {
  return { name: 'jev-dev-api' };
}
