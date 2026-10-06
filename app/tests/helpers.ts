// Load the real body assets from disk for tests.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { MeshBasicMaterial } from 'three';
import { loadBody, MacroLibrary, type Fetcher } from '../src/body/assets';
import { Figure } from '../src/body/figure';
import { defaultMacros } from '../src/body/macros';

const ROOT = join(__dirname, '..', '..', 'public', 'assets', 'body');
export const diskFetcher: Fetcher = {
  json: async url => JSON.parse(readFileSync(join(ROOT, url.split('/').pop()!), 'utf8')),
  gz: async url => {
    const b = gunzipSync(readFileSync(join(ROOT, url.split('/').pop()!)));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
};

export async function makeFigure() {
  const data = await loadBody('body', diskFetcher);
  const fig = new Figure(data, new MacroLibrary('body', data.meta, diskFetcher), new MeshBasicMaterial());
  await fig.setMacros(defaultMacros());
  return fig;
}
