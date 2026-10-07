// Bakes corrective shapes off the main thread (see correctives.ts).
import { adjacency, bakeAll, type Adjacency, type BakeInput } from './correctives';

let adj: Adjacency | null = null, adjKey = '';
self.onmessage = (e: MessageEvent<{ id: number; input: BakeInput }>) => {
  const { id, input } = e.data;
  const key = `${input.n}:${input.tris.length}`;
  if (!adj || key !== adjKey) { adj = adjacency(input.tris, input.n); adjKey = key; } // topology never changes
  const t0 = performance.now();
  const keys = bakeAll(input, adj);
  const transfer = keys.flatMap(k => [k.indices.buffer, k.deltas.buffer, k.normalDeltas.buffer]);
  (self as unknown as Worker).postMessage({ id, keys, ms: performance.now() - t0 }, transfer as Transferable[]);
};
