// GPU picking: render the figure's dominant-bone id and view depth for the single pixel under the pointer.
// A CPU raycast against the skinned mesh costs ~40 ms on a laptop (far more on a phone); this costs ~1 ms.
import {
  BufferAttribute, BufferGeometry, FloatType, HalfFloatType, NearestFilter, RGBAFormat, ShaderMaterial, SkinnedMesh, Vector2,
  Vector3, WebGLRenderTarget, type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import type { Figure } from '../body/figure';

const LAYER = 7;

const vertex = /* glsl */ `
attribute float pickId;
varying float vId;
varying float vDepth;
#include <common>
#include <skinning_pars_vertex>
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vId = pickId;
  vDepth = -mvPosition.z;
}`;
const fragment = /* glsl */ `
varying float vId;
varying float vDepth;
void main() { gl_FragColor = vec4(vId + 1.0, vDepth, 0.0, 1.0); }`;

export interface PickHit { bone: number; point: Vector3 }

export class GpuPicker {
  private target: WebGLRenderTarget;
  private mesh: SkinnedMesh;
  private buf: Float32Array | Uint16Array;
  private half: boolean;

  constructor(private renderer: WebGLRenderer, private fig: Figure) {
    this.half = !renderer.extensions.has('EXT_color_buffer_float');
    this.target = new WebGLRenderTarget(1, 1, { type: this.half ? HalfFloatType : FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter });
    this.buf = this.half ? new Uint16Array(4) : new Float32Array(4);
    const src = fig.mesh.geometry, { data } = fig, inf = data.meta.maxInfluences;
    const geo = new BufferGeometry();
    for (const name of ['position', 'skinIndex', 'skinWeight']) geo.setAttribute(name, src.getAttribute(name));
    geo.setIndex(src.getIndex());
    const ids = new Float32Array(data.meta.renderVertexCount);
    for (let r = 0; r < ids.length; r++) ids[r] = data.skinIndex[data.renderToShape[r] * inf];
    geo.setAttribute('pickId', new BufferAttribute(ids, 1));
    const mat = new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment });
    this.mesh = new SkinnedMesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER);
    fig.group.add(this.mesh);
    this.rebind();
    fig.onIndex.push(() => geo.setIndex(src.getIndex()));
  }

  /** Share the figure's skeleton (call after the figure rebinds on a shape change). */
  rebind() {
    this.mesh.bind(this.fig.mesh.skeleton, this.fig.mesh.bindMatrix);
  }

  /** x, y in canvas CSS pixels. */
  pick(camera: PerspectiveCamera, x: number, y: number): PickHit | null {
    const r = this.renderer, c = r.domElement;
    const w = c.clientWidth, h = c.clientHeight;
    const cam = camera.clone();
    cam.layers.set(LAYER);
    cam.setViewOffset(w, h, Math.floor(x), Math.floor(y), 1, 1);
    const prevTarget = r.getRenderTarget(), prevClear = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.fig.group, cam);
    r.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.buf);
    r.setRenderTarget(prevTarget);
    r.setClearAlpha(prevClear);
    const v = this.half ? [...this.buf].map(halfToFloat) : [...this.buf];
    if (v[0] < 0.5) return null;
    const bone = Math.round(v[0] - 1), depth = v[1];
    // point on the camera ray at that view depth
    const ndc = new Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1);
    const dir = new Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const fwd = camera.getWorldDirection(new Vector3());
    return { bone, point: camera.position.clone().addScaledVector(dir, depth / dir.dot(fwd)) };
  }
}

function halfToFloat(h: number) {
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  const v = e === 0 ? (f / 1024) * 2 ** -14 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * 2 ** (e - 15);
  return s ? -v : v;
}

