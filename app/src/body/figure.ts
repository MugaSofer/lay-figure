// A posable figure: one skinned mesh whose shape (and so skeleton) can change at any time.
//
// Joint rotations are stored relative to each bone's rest frame, so a pose means the same thing on
// every body shape. Changing the shape re-derives the bones from the shaped mesh, rebinds the
// skeleton, and re-applies the pose.
import {
  Bone, BufferAttribute, BufferGeometry, Group, Material, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3,
} from 'three';
import type { BodyData, MacroLibrary } from './assets';
import { macroStack, type MacroSettings } from './macros';
import { triangleRegions, visibleIndex, type Region } from './regions';
import { applyTargets, boneRests, groundY, shapeNormals, shapeTriangles, type BoneRest } from './shape';

export class Figure {
  readonly group = new Group();
  readonly mesh: SkinnedMesh;
  readonly bones: Bone[];
  readonly boneIndex = new Map<string, number>();
  /** Per-bone rotation relative to rest (the pose). */
  readonly joints: Quaternion[];
  /** Root offset in the figure's space (hips drag, crouch), applied to the root bone. */
  readonly rootOffset = new Vector3();
  rests: BoneRest[] = [];
  shapePositions: Float32Array;
  private shapeNormalsBuf: Float32Array;
  private readonly tris: Uint32Array;
  private readonly restLocalQ: Quaternion[];
  private readonly restLocalP: Vector3[];
  private shapeSeq = 0;
  /** Called after every rebuild (shape change): skeleton rebound, rests recomputed. */
  readonly onRebuild: (() => void)[] = [];
  /** Called when the visible triangles change (hidden regions). */
  readonly onIndex: (() => void)[] = [];
  readonly hidden = new Set<Region>();
  private triRegions: Uint8Array;

  constructor(readonly data: BodyData, private readonly macros: MacroLibrary, material: Material) {
    const { meta } = data;
    this.tris = shapeTriangles(data);
    this.triRegions = triangleRegions(data);
    this.shapePositions = new Float32Array(data.basePositions);
    this.shapeNormalsBuf = new Float32Array(this.shapePositions.length);

    const n = meta.renderVertexCount, inf = meta.maxInfluences;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('uv', new BufferAttribute(data.uv, 2));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let r = 0; r < n; r++) {
      const s = data.renderToShape[r];
      for (let k = 0; k < Math.min(4, inf); k++) {
        si[r * 4 + k] = data.skinIndex[s * inf + k];
        sw[r * 4 + k] = data.skinWeight[s * inf + k];
      }
    }
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new BufferAttribute(sw, 4));
    geo.setIndex(new BufferAttribute(data.index, 1));

    this.bones = meta.bones.map((b, i) => {
      const bone = new Bone();
      bone.name = b.name;
      this.boneIndex.set(b.name, i);
      return bone;
    });
    meta.bones.forEach((b, i) => (b.parent >= 0 ? this.bones[b.parent] : this.group).add(this.bones[i]));
    this.joints = this.bones.map(() => new Quaternion());
    this.restLocalQ = this.bones.map(() => new Quaternion());
    this.restLocalP = this.bones.map(() => new Vector3());

    this.mesh = new SkinnedMesh(geo, material);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // bounds change with pose; the figure is always the subject
    this.group.add(this.mesh);
    this.rebuild();
  }

  bone(name: string) {
    const i = this.boneIndex.get(name);
    if (i === undefined) throw new Error(`no bone ${name}`);
    return this.bones[i];
  }

  /** Reshape from macro settings. Resolves once the needed target packs are loaded and applied. */
  async setMacros(settings: MacroSettings) {
    const seq = ++this.shapeSeq;
    const stack = macroStack(settings);
    const loaded = await this.macros.get([...stack.keys()]);
    if (seq !== this.shapeSeq) return; // a newer request superseded this one
    const pairs: [import('./assets').Target, number][] = [];
    for (const [name, w] of stack) {
      const t = loaded.get(name);
      if (t) pairs.push([t, w]);
    }
    applyTargets(this.data, pairs, this.shapePositions);
    this.rebuild();
  }

  /** Re-derive everything that depends on the shape: render positions, normals, skeleton. */
  rebuild() {
    const pos = this.shapePositions, meta = this.data.meta;
    const floor = groundY(pos, meta.ground);
    for (let i = 1; i < pos.length; i += 3) pos[i] -= floor;
    shapeNormals(pos, this.tris, this.shapeNormalsBuf);

    const geo = this.mesh.geometry;
    const P = geo.getAttribute('position') as BufferAttribute, N = geo.getAttribute('normal') as BufferAttribute;
    const pa = P.array as Float32Array, na = N.array as Float32Array, map = this.data.renderToShape;
    for (let r = 0; r < map.length; r++) {
      const s = map[r] * 3, d = r * 3;
      pa[d] = pos[s]; pa[d + 1] = pos[s + 1]; pa[d + 2] = pos[s + 2];
      na[d] = this.shapeNormalsBuf[s]; na[d + 1] = this.shapeNormalsBuf[s + 1]; na[d + 2] = this.shapeNormalsBuf[s + 2];
    }
    P.needsUpdate = N.needsUpdate = true;
    geo.computeBoundingSphere();

    // Rest skeleton from this shape
    this.rests = boneRests(pos, meta.bones);
    meta.bones.forEach((b, i) => {
      const rest = this.rests[i];
      if (b.parent >= 0) {
        const pr = this.rests[b.parent];
        const inv = pr.rotation.clone().invert();
        this.restLocalQ[i].copy(inv).multiply(rest.rotation);
        this.restLocalP[i].copy(rest.head).sub(pr.head).applyQuaternion(inv);
      } else {
        this.restLocalQ[i].copy(rest.rotation);
        this.restLocalP[i].copy(rest.head);
      }
      this.bones[i].quaternion.copy(this.restLocalQ[i]);
      this.bones[i].position.copy(this.restLocalP[i]);
    });
    // Bind at the current world transform (bind() recomputes the inverses from the rest bones), so a
    // figure that has been moved or rotated still rebinds correctly.
    this.group.updateMatrixWorld(true);
    this.mesh.bind(this.mesh.skeleton?.bones.length ? this.mesh.skeleton : new Skeleton(this.bones));
    this.applyPose();
    for (const f of this.onRebuild) f();
  }

  /** Push joint rotations and root offset onto the bones. */
  applyPose() {
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].quaternion.copy(this.restLocalQ[i]).multiply(this.joints[i]);
      this.bones[i].position.copy(this.restLocalP[i]);
    }
    this.bones[0].position.add(this.rootOffset);
    this.group.updateMatrixWorld(true);
  }

  resetPose() {
    this.joints.forEach(q => q.identity());
    this.rootOffset.set(0, 0, 0);
    this.applyPose();
  }

  setHidden(regions: Iterable<Region>) {
    this.hidden.clear();
    for (const r of regions) this.hidden.add(r);
    const geo = this.mesh.geometry;
    geo.setIndex(new BufferAttribute(visibleIndex(this.data, this.triRegions, this.hidden), 1));
    for (const f of this.onIndex) f();
  }

  /** Rest rotation of a bone relative to its parent (for converting world-space edits to joints). */
  restLocal(i: number) { return this.restLocalQ[i]; }
}
