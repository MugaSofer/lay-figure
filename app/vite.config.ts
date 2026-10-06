import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Assets live at the repo root (public/assets), shared with the pipeline's output.
export default defineConfig({
  base: './',
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
        globPatterns: ['**/*.{js,css,html,png,json}', 'assets/body/body.bin.gz', 'assets/body/macro-young.bin.gz'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // the Phase 0 spikes live under /spikes/ on the same site; don't serve the app for them
        navigateFallbackDenylist: [/\/spikes\//],
        // Other age packs are cached the first time they're used.
        runtimeCaching: [{
          urlPattern: /assets\/body\/macro-.*\.bin\.gz$/,
          handler: 'CacheFirst',
          options: { cacheName: 'body-packs', expiration: { maxEntries: 8 } },
        }],
      },
    }),
  ],
});
