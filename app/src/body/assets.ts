// Loads the body assets written by pipeline/lay_pipeline/build_body.py.

export interface BoneSpec {
  name: string;
  parent: number; // index into bones, -1 for the root
  head: number[]; // shape-vertex indices whose mean is the bone head
  tail: number[];
  roll: number; // Blender-convention roll, in Blender's Z-up frame
}

interface ArrayInfo { offset: number; length: number; type: string }

export interface BodyMeta {
  version: number;
  body: string;
  shapeVertexCount: number;
  bodyVertexCount: number;
  renderVertexCount: number;
  triangleCount: number;
  quant: number;
  maxInfluences: number;
  indexWidth: 2 | 4;
  layout: Record<string, ArrayInfo>;
  bones: BoneSpec[];
  ground: number[];
  macroPacks: Record<string, { file: string; offsets: number[]; bytes: number }>;
  macroTargets: Record<string, [string, number] | null>;
}

export interface BodyData {
  meta: BodyMeta;
  basePositions: Float32Array; // shape space, 3 per vertex, metres
  index: Uint16Array | Uint32Array; // render triangles
  renderToShape: Uint16Array | Uint32Array;
  uv: Float32Array;
  skinIndex: Uint8Array; // shape space, maxInfluences per vertex
  skinWeight: Float32Array;
}

export interface Target {
  indices: Uint16Array | Uint32Array; // shape-vertex indices, ascending
  deltas: Int16Array; // 3 per index, in units of meta.quant metres
}

const CTORS = { float32: Float32Array, uint32: Uint32Array, uint16: Uint16Array, uint8: Uint8Array, int16: Int16Array } as const;

/** Fetch a .gz asset. Some servers (e.g. Vite's) send it with Content-Encoding: gzip, so the browser has
 *  already inflated it; others (GitHub Pages) don't. Inflate only if the gzip magic bytes are present. */
export async function fetchGz(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

function view(buf: ArrayBuffer, info: ArrayInfo) {
  const C = CTORS[info.type as keyof typeof CTORS];
  if (!C) throw new Error(`unsupported array type ${info.type}`);
  return new C(buf, info.offset, info.length);
}

export async function loadBody(base: string): Promise<BodyData> {
  const meta: BodyMeta = await (await fetch(`${base}/body.json`)).json();
  if (meta.version !== 1) throw new Error(`body format ${meta.version} not supported`);
  const buf = await fetchGz(`${base}/${meta.body}`);
  const L = meta.layout;
  return {
    meta,
    basePositions: view(buf, L.basePositions) as Float32Array,
    index: view(buf, L.index) as Uint16Array | Uint32Array,
    renderToShape: view(buf, L.renderToShape) as Uint16Array | Uint32Array,
    uv: view(buf, L.uv) as Float32Array,
    skinIndex: view(buf, L.skinIndex) as Uint8Array,
    skinWeight: view(buf, L.skinWeight) as Float32Array,
  };
}

/** Macro target packs, fetched on first use and kept. */
export class MacroLibrary {
  private packs = new Map<string, Promise<Target[]>>();
  constructor(private base: string, private meta: BodyMeta) {}

  private pack(age: string) {
    let p = this.packs.get(age);
    if (!p) {
      const info = this.meta.macroPacks[age];
      const wide = this.meta.shapeVertexCount > 65535;
      p = fetchGz(`${this.base}/${info.file}`).then(buf => info.offsets.map(off => {
        const n = new DataView(buf).getUint32(off, true);
        const idxBytes = n * (wide ? 4 : 2);
        const indices = wide ? new Uint32Array(buf, off + 4, n) : new Uint16Array(buf, off + 4, n);
        let dOff = off + 4 + idxBytes;
        dOff += dOff % 2;
        return { indices, deltas: new Int16Array(buf, dOff, n * 3) };
      }));
      this.packs.set(age, p);
    }
    return p;
  }

  /** Resolve target names to loaded targets (null for targets with no effect). */
  async get(names: string[]): Promise<Map<string, Target | null>> {
    const out = new Map<string, Target | null>();
    const needed = new Set<string>();
    for (const n of names) {
      const ref = this.meta.macroTargets[n];
      if (ref === undefined) throw new Error(`unknown macro target ${n}`);
      if (ref) needed.add(ref[0]);
    }
    const loaded = new Map<string, Target[]>();
    await Promise.all([...needed].map(async a => loaded.set(a, await this.pack(a))));
    for (const n of names) {
      const ref = this.meta.macroTargets[n];
      out.set(n, ref ? loaded.get(ref[0])![ref[1]] : null);
    }
    return out;
  }
}
