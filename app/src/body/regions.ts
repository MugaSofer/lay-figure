// Body regions for hiding (and later per-region layers: skin, muscle, skeleton). A triangle belongs to
// the region of the majority of its vertices' dominant bones.
import type { BodyData } from './assets';

export const REGIONS = [
  'head', 'neck', 'chest', 'abdomen', 'pelvis',
  'upperarm_l', 'forearm_l', 'hand_l', 'upperarm_r', 'forearm_r', 'hand_r',
  'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r',
] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  head: 'Head', neck: 'Neck', chest: 'Chest', abdomen: 'Abdomen', pelvis: 'Pelvis',
  upperarm_l: 'Upper arm L', forearm_l: 'Forearm L', hand_l: 'Hand L', upperarm_r: 'Upper arm R', forearm_r: 'Forearm R', hand_r: 'Hand R',
  thigh_l: 'Thigh L', shin_l: 'Shin L', foot_l: 'Foot L', thigh_r: 'Thigh R', shin_r: 'Shin R', foot_r: 'Foot R',
};

export function boneRegion(name: string): Region {
  const side = name.endsWith('_l') ? 'l' : 'r';
  if (name === 'head') return 'head';
  if (name === 'neck_01') return 'neck';
  if (name === 'spine_03' || name.startsWith('clavicle')) return 'chest';
  if (name === 'spine_01' || name === 'spine_02') return 'abdomen';
  if (name === 'pelvis' || name === 'Root') return 'pelvis';
  if (name.startsWith('upperarm')) return `upperarm_${side}`;
  if (name.startsWith('lowerarm')) return `forearm_${side}`;
  if (/^(hand|thumb|index|middle|ring|pinky)/.test(name)) return `hand_${side}`;
  if (name.startsWith('thigh')) return `thigh_${side}`;
  if (name.startsWith('calf')) return `shin_${side}`;
  if (name.startsWith('foot') || name.startsWith('ball')) return `foot_${side}`;
  return 'abdomen';
}

/** Region index per render triangle. */
export function triangleRegions(data: BodyData): Uint8Array {
  const { meta, index, renderToShape, skinIndex } = data, inf = meta.maxInfluences;
  const boneReg = meta.bones.map(b => REGIONS.indexOf(boneRegion(b.name)));
  const out = new Uint8Array(index.length / 3);
  for (let t = 0; t < out.length; t++) {
    const r = [0, 1, 2].map(k => boneReg[skinIndex[renderToShape[index[t * 3 + k]] * inf]]);
    out[t] = r[0] === r[1] || r[0] === r[2] ? r[0] : r[1] === r[2] ? r[1] : r[0];
  }
  return out;
}

/** Triangle index buffer with the hidden regions left out. */
export function visibleIndex(data: BodyData, triRegion: Uint8Array, hidden: Set<Region>) {
  const hide = new Set([...hidden].map(r => REGIONS.indexOf(r)));
  const src = data.index;
  const keep: number[] = [];
  for (let t = 0; t < triRegion.length; t++) if (!hide.has(triRegion[t])) keep.push(src[t * 3], src[t * 3 + 1], src[t * 3 + 2]);
  return src instanceof Uint32Array ? new Uint32Array(keep) : new Uint16Array(keep);
}
