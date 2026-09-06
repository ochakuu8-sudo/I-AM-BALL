import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const assetHash = createHash('sha256');
for (const file of ['town.glb', 'crate.glb', 'cone.glb', 'colliders.json']) {
  assetHash.update(
    readFileSync(new URL(`./public/models/${file}`, import.meta.url)),
  );
}

export default defineConfig({
  define: {
    __TOWN_ASSET_VERSION__: JSON.stringify(
      assetHash.digest('hex').slice(0, 12),
    ),
  },
  base: process.env.PAGES_BASE_PATH ? `${process.env.PAGES_BASE_PATH}/` : '/',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  build: { outDir: 'dist/client' },
  server:
    process.env.CODEX_SANDBOX === 'seatbelt'
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
});
