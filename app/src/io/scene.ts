// Scene and pose serialisation: JSON files and share URLs.
//
// A pose is { skeleton, version, root: {pos, rot}, joints: {name: quaternion}, pins: [...] } (brief).
// Joint quaternions are relative to each bone's rest frame, so poses carry across body shapes.
// Numbers are rounded once, on capture, to 1e-5 (about 0.001 degree), so any later save/load/URL
// round trip is exact. Every format carries a version; old versions are migrated on load.

export const SKELETON = 'makehuman-game_engine';
export const POSE_VERSION = 1;
export const SCENE_VERSION = 1;

export type Quat = [number, number, number, number]; // x, y, z, w
export type Vec3 = [number, number, number];

export interface Pin { joint: string; target: Vec3; surface?: string }
export interface PoseData {
  skeleton: string;
  version: number;
  root: { pos: Vec3; rot: Quat };
  joints: Record<string, Quat>;
  pins: Pin[];
}
export interface BodyShape { macros: Record<string, number>; race: Record<string, number>; local?: Record<string, number> }
export interface FigureData { body: BodyShape; pose: PoseData; hidden: string[] }
export interface CameraData { target: Vec3; radius: number; theta: number; phi: number; focal: number }
export interface SceneData {
  version: number;
  figures: FigureData[];
  props: unknown[]; // M4
  lights: { key: { dir: Vec3; intensity: number }; ambient: number };
  camera: CameraData;
  view: { mode: string; limits: boolean };
}

export const round = (v: number) => {
  const r = Math.round(v * 1e5) / 1e5;
  return Object.is(r, -0) ? 0 : r;
};
const rq = (q: Quat): Quat => q.map(round) as Quat;
const isIdentity = (q: Quat) => Math.abs(q[0]) < 1e-6 && Math.abs(q[1]) < 1e-6 && Math.abs(q[2]) < 1e-6 && Math.abs(q[3] - 1) < 1e-6;

/** Build pose data from bone names, joint quaternions and root; identity joints are left out. */
export function makePose(names: string[], joints: Quat[], rootPos: Vec3, rootRot: Quat, pins: Pin[] = []): PoseData {
  const out: Record<string, Quat> = {};
  names.forEach((n, i) => {
    if (i === 0) return; // the root's rotation is stored as root.rot
    const q = rq(joints[i]);
    if (!isIdentity(q)) out[n] = q;
  });
  return { skeleton: SKELETON, version: POSE_VERSION, root: { pos: rootPos.map(round) as Vec3, rot: rq(rootRot) }, joints: out, pins };
}

// ---------- migration ----------
type Migration = (s: Record<string, unknown>) => Record<string, unknown>;
const SCENE_MIGRATIONS: Record<number, Migration> = {
  // 1 -> 2: add when the format changes. Each step takes version n and returns version n+1.
};

export function migrateScene(raw: unknown): SceneData {
  let s = raw as Record<string, unknown>;
  if (!s || typeof s !== 'object' || typeof s.version !== 'number') throw new Error('not a Lay Figure scene');
  while ((s.version as number) < SCENE_VERSION) {
    const m = SCENE_MIGRATIONS[s.version as number];
    if (!m) throw new Error(`no migration from scene version ${s.version}`);
    s = m(s);
  }
  if ((s.version as number) > SCENE_VERSION) throw new Error(`scene version ${s.version} is newer than this app`);
  return s as unknown as SceneData;
}

export function validatePose(p: PoseData) {
  if (p.skeleton !== SKELETON) throw new Error(`pose is for skeleton ${p.skeleton}`);
  if (p.version > POSE_VERSION) throw new Error(`pose version ${p.version} is newer than this app`);
}

// ---------- share URLs ----------
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

/** "s1." + base64url(deflate-raw(JSON)). The prefix names the URL encoding, separately from the scene version. */
export async function sceneToHash(scene: SceneData) {
  const json = new TextEncoder().encode(JSON.stringify(scene));
  return 's1.' + b64url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function sceneFromHash(hash: string): Promise<SceneData | null> {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith('s1.')) return null;
  const json = new TextDecoder().decode(await pipe(unb64url(h.slice(3)), new DecompressionStream('deflate-raw')));
  return migrateScene(JSON.parse(json));
}
