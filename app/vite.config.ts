import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Shown in the app (More sheet) so a phone's running build can be identified.
const BUILD = (() => {
  let hash = 'dev';
  try { hash = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a git checkout */ }
  return `${hash} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
})();
import { VitePWA } from 'vite-plugin-pwa';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

// Content hashes of the body files. Their names carry no hash, so the service worker must be told when
// they change: the precache gets them as revisions, and target packs are fetched as name?v=hash.
const BODY_DIR = new URL('../public/assets/body/', import.meta.url);
const ASSET_HASHES = Object.fromEntries(readdirSync(BODY_DIR).map(f =>
  [f, createHash('sha256').update(readFileSync(new URL(f, BODY_DIR))).digest('hex').slice(0, 12)]));

// Assets live at the repo root (public/assets), shared with the pipeline's output.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD), __ASSET_HASHES__: JSON.stringify(ASSET_HASHES) },
  publicDir: '../public',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Lay Figure',
        short_name: 'Lay Figure',
        description: 'A posable figure for drawing reference',
        theme_color: '#2b2a28',
        background_color: '#2b2a28',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell and the default body precache, so the app works offline after the first visit.
        globPatterns: ['**/*.{js,css,html,png,json}', 'assets/body/body.bin.gz'],
        // Only Vite's own output has hashed names. The default treats everything under assets/ as hashed,
        // which pinned the first-installed body.json forever.
        dontCacheBustURLsMatching: /^assets\/[^/]+-[\w-]{8}\.(js|css)$/,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // the Phase 0 spikes live under /spikes/ on the same site; don't serve the app for them
        navigateFallbackDenylist: [/\/spikes\//],
        // Target packs are cached the first time they're used; their URLs carry a content hash (?v=).
        runtimeCaching: [{
          urlPattern: /assets\/body\/macro-[^/]*\.bin\.gz(\?.*)?$/,
          handler: 'CacheFirst',
          options: { cacheName: 'body-packs', expiration: { maxEntries: 8 } },
        }],
      },
    }),
  ],
});
