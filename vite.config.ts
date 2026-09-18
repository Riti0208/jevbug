import { defineConfig } from 'vite';
import path from 'node:path';
import { jevDevApiPlugin } from './api/_lib/vite-dev-plugin';

export default defineConfig({
  plugins: [jevDevApiPlugin()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173 },
});
