// Mirroring a pose through the figure's midline (x = 0). Each joint rotation is expressed in world axes
// at rest, reflected, and converted back into its twin bone's rest frame. Exact when the rest skeleton is
// symmetric, as MakeHuman's is.
import { Quaternion } from 'three';
import type { Figure } from '../body/figure';

export type MirrorMode = 'flip' | 'l2r' | 'r2l';

export function twinOf(name: string) {
  return name.endsWith('_l') ? name.slice(0, -2) + '_r' : name.endsWith('_r') ? name.slice(0, -2) + '_l' : name;
}

/** Reflect a rotation across the plane x = 0. */
export const reflectX = (w: Quaternion) => new Quaternion(w.x, -w.y, -w.z, w.w);

export function mirrorPose(fig: Figure, mode: MirrorMode) {
  const rests = fig.rests;
  const toWorldAxes = (i: number, q: Quaternion) => rests[i].rotation.clone().multiply(q).multiply(rests[i].rotation.clone().invert());
  const fromWorldAxes = (i: number, w: Quaternion) => rests[i].rotation.clone().invert().multiply(w).multiply(rests[i].rotation);
  const src = fig.joints.map(q => q.clone());
  fig.bones.forEach((bone, i) => {
    const twin = twinOf(bone.name);
    if (mode !== 'flip' && !twin.endsWith(mode === 'l2r' ? '_l' : '_r')) return; // only write the destination side
    const j = fig.boneIndex.get(twin)!;
    fig.joints[i].copy(fromWorldAxes(i, reflectX(toWorldAxes(j, src[j]))));
  });
  if (mode === 'flip') fig.rootOffset.x *= -1;
  fig.applyPose();
}
