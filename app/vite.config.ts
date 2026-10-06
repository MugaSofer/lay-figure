import { defineConfig } from 'vite';

// Assets live at the repo root (public/assets), shared with the pipeline's output.
export default defineConfig({
  base: './',
  publicDir: '../public',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
