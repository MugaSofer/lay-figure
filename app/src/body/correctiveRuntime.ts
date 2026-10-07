// Corrective shapes at run time: bake them for the current body in a worker whenever the body settles,
// install them as morph targets, and set their influences from the live pose every frame.
import { BufferAttribute } from 'three';
import type { BakedKey } from './correctives';
import { generateKeys, KeyMixer } from './correctiveKeys';
import type { Figure } from './figure';
import { shapeTriangles } from './shape';
import type { PoseRig } from '../pose/rig';

export class Correctives {
  enabled = true;
  /** Shape generation baked so far; the figure's shape generation is compared to know when to re-bake. */
  private worker: Worker | null = null;
  private seq = 0;
  private mixer: KeyMixer | null = null;
  private influences: number[] = [];
  private tris: Uint32Array;
  private timer = 0;
  onStatus: (s: 'baking' | 'ready' | 'error', detail?: string) => void = () => {};

  constructor(private fig: Figure, private rig: PoseRig) {
    this.tris = shapeTriangles(fig.data);
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./correctives.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = e => this.receive(e.data);
      this.worker.onerror = e => this.onStatus('error', e.message);
    }
    fig.onRebuild.push(() => this.schedule());
  }

  /** Re-bake shortly after the body stops changing (slider drags rebuild many times a second). */
  schedule(delay = 500) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.bake(), delay);
  }

  bake() {
    if (!this.worker) return;
    const fig = this.fig, { data } = fig;
    const { keys, mats } = generateKeys(this.rig);
    const id = ++this.seq;
    this.pendingKeys.set(id, keys);
    this.onStatus('baking');
    this.worker.postMessage({
      id,
      input: {
        n: data.meta.bodyVertexCount, rest: fig.shapePositions.slice(), tris: this.tris,
        skinIndex: data.skinIndex, skinWeight: data.skinWeight, inf: data.meta.maxInfluences, cor: fig.corShape.slice(), mats,
      },
    });
  }
  private pendingKeys = new Map<number, ReturnType<typeof generateKeys>['keys']>();

  private receive({ id, keys: baked, ms }: { id: number; keys: BakedKey[]; ms: number }) {
    const keys = this.pendingKeys.get(id);
    this.pendingKeys.delete(id);
    if (!keys || id !== this.seq) return; // a newer bake is on its way
    const fig = this.fig, geo = fig.mesh.geometry, map = fig.data.renderToShape, R = map.length;
    // shape space -> render vertices (UV seams share a shape vertex)
    const toRender = (b: BakedKey, normal: boolean) => {
      const shapeArr = new Float32Array(fig.shapePositions.length);
      const src = normal ? b.normalDeltas : b.deltas;
      for (let k = 0; k < b.indices.length; k++) shapeArr.set(src.subarray(k * 3, k * 3 + 3), b.indices[k] * 3);
      const out = new Float32Array(R * 3);
      for (let r = 0; r < R; r++) out.set(shapeArr.subarray(map[r] * 3, map[r] * 3 + 3), r * 3);
      return new BufferAttribute(out, 3);
    };
    geo.morphAttributes.position = baked.map(b => toRender(b, false));
    geo.morphAttributes.normal = baked.map(b => toRender(b, true));
    geo.morphTargetsRelative = true;
    geo.dispose(); // morph data changed: re-upload
    fig.mesh.updateMorphTargets();
    this.mixer = new KeyMixer(keys);
    this.influences = new Array(keys.length).fill(0);
    this.update();
    this.onStatus('ready', `${keys.length} corrective shapes in ${Math.round(ms)} ms`);
  }

  /** Set influences from the current pose (cheap; call every frame). */
  update() {
    const inf = this.fig.mesh.morphTargetInfluences;
    if (!this.mixer || !inf) return;
    if (!this.enabled) { inf.fill(0); return; }
    this.mixer.influences(this.fig.joints, this.influences);
    for (let i = 0; i < inf.length; i++) inf[i] = this.influences[i] ?? 0;
  }
}
