// Serve the built app (dist/) for scripts; returns { url, close }.
import { preview } from 'vite';

export async function serve() {
  const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'error' });
  const url = server.resolvedUrls.local[0];
  return { url, close: () => new Promise(r => server.httpServer.close(r)) };
}
