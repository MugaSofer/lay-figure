// Spike A viewer: load the MakeHuman glTF, stack morphs, pose a few bones, measure seam gaps. Throwaway.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2a28);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
camera.position.set(1.2, 1.3, 3.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a3128, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-1.5, 3, 2.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -1, right: 1, top: 2, bottom: -0.1 });
key.shadow.normalBias = 0.02;
scene.add(key);
const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.MeshStandardMaterial({ color: 0x55524d }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const mat = new THREE.MeshStandardMaterial({ color: 0xcdb8a0, roughness: 0.6 });
let root: THREE.Object3D | null = null;
let mesh: THREE.SkinnedMesh;
let src = 'body.glb';
let posed = false;
const statsEl = document.getElementById('stats')!;
let info = '';

async function load() {
  const t0 = performance.now();
  const buf = await (await fetch(src)).arrayBuffer();
  const gltf = await loader.parseAsync(buf, '');
  if (root) scene.remove(root);
  root = gltf.scene;
  root.traverse(o => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
      mesh = o as THREE.SkinnedMesh;
      mesh.material = mat;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    }
  });
  scene.add(root);
  restQ.clear();
  const g = mesh.geometry;
  info = `${src}: ${(buf.byteLength / 1024).toFixed(0)} KB, parsed in ${(performance.now() - t0).toFixed(0)} ms\n` +
    `${g.attributes.position.count} verts, ${(g.index?.count ?? 0) / 3} tris, ${mesh.skeleton.bones.length} bones, ` +
    `${Object.keys(mesh.morphTargetDictionary ?? {}).length} morphs`;
  buildSliders();
  applyPose();
  measure();
}

function buildSliders() {
  const box = document.getElementById('sliders')!;
  box.innerHTML = '';
  const PRESETS = ['female', 'male', 'heavy', 'slim', 'muscular', 'soft', 'older', 'tall', 'short', 'idealised', 'larger-cup'];
  const entries = Object.entries(mesh.morphTargetDictionary!)
    .sort(([a], [b]) => (PRESETS.includes(a) ? PRESETS.indexOf(a) : 99) - (PRESETS.includes(b) ? PRESETS.indexOf(b) : 99));
  const head = (t: string) => { const h = document.createElement('h4'); h.textContent = t; h.style.margin = '8px 0 2px'; box.appendChild(h); };
  head('Body presets (MakeHuman macros)');
  let localsShown = false;
  for (const [name, i] of entries) {
    if (!PRESETS.includes(name) && !localsShown) { head('Local modifiers'); localsShown = true; }
    const l = document.createElement('label');
    l.textContent = name;
    const r = document.createElement('input');
    Object.assign(r, { type: 'range', min: '0', max: '1', step: '0.01', value: String(mesh.morphTargetInfluences![i]) });
    r.oninput = () => { mesh.morphTargetInfluences![i] = +r.value; measure(); };
    l.appendChild(r);
    box.appendChild(l);
  }
}
const setAll = (f: (i: number) => number) => {
  mesh.morphTargetInfluences!.forEach((_, i) => (mesh.morphTargetInfluences![i] = f(i)));
  buildSliders();
  measure();
};

// A pose built by aiming limbs at world directions (the figure faces +Z, its right side is -X).
// Applied parent-first, so each aim sees the already-posed parent.
const down = new THREE.Vector3(0, -1, 0);
const dirOf = (deg: number, toward: THREE.Vector3, from = down) => {
  const r = THREE.MathUtils.degToRad(deg);
  return from.clone().multiplyScalar(Math.cos(r)).addScaledVector(toward, Math.sin(r)).normalize();
};
const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const POSE: [string, THREE.Vector3][] = [
  ['upperarm_r', dirOf(15, X.clone().negate())],
  ['lowerarm_r', dirOf(70, Z)],
  ['upperarm_l', dirOf(130, X)],
  ['lowerarm_l', dirOf(160, X.clone().add(Z).normalize())],
  ['thigh_r', dirOf(70, Z)],
  ['calf_r', dirOf(15, Z.clone().negate())],
  ['thigh_l', dirOf(10, X)],
];
const restQ = new Map<THREE.Bone, THREE.Quaternion>();
function aim(name: string, want: THREE.Vector3) {
  const b = mesh.skeleton.getBoneByName(name);
  const child = b?.children.find(c => (c as THREE.Bone).isBone);
  if (!b || !child) return;
  root!.updateMatrixWorld(true);
  const p = b.getWorldPosition(new THREE.Vector3());
  const cur = child.getWorldPosition(new THREE.Vector3()).sub(p).normalize();
  const rot = new THREE.Quaternion().setFromUnitVectors(cur, want);
  const world = rot.multiply(b.getWorldQuaternion(new THREE.Quaternion()));
  const parentQ = b.parent!.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(parentQ.invert().multiply(world));
}
function applyPose() {
  for (const b of mesh.skeleton.bones) {
    if (!restQ.has(b)) restQ.set(b, b.quaternion.clone());
    b.quaternion.copy(restQ.get(b)!);
  }
  if (posed) for (const [name, dir] of POSE) aim(name, dir);
}

// Seam check: vertices split at UV seams share a base position; after stacking morphs they must stay together.
function measure() {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const morphs = g.morphAttributes.position ?? [];
  const inf = mesh.morphTargetInfluences!;
  const rel = g.morphTargetsRelative;
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const list = groups.get(k);
    if (list) list.push(i); else groups.set(k, [i]);
  }
  const base = new THREE.Vector3(), d = new THREE.Vector3();
  const morphed = (i: number) => {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    base.copy(v);
    morphs.forEach((m, t) => {
      if (!inf[t]) return;
      d.set(m.getX(i), m.getY(i), m.getZ(i));
      if (!rel) d.sub(base);
      v.addScaledVector(d, inf[t]);
    });
    return v;
  };
  let worst = 0, seams = 0;
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    seams++;
    const a = morphed(ids[0]);
    for (const j of ids.slice(1)) worst = Math.max(worst, a.distanceTo(morphed(j)));
  }
  statsEl.textContent = `${info}\nseam vertex groups: ${seams}, worst gap after morphs: ${(worst * 1000).toFixed(3)} mm`;
  (window as unknown as { seamGap: number }).seamGap = worst;
}

document.getElementById('zero')!.onclick = () => setAll(() => 0);
document.getElementById('one')!.onclick = () => setAll(() => 1);
document.getElementById('rand')!.onclick = () => setAll(() => Math.random());
document.getElementById('pose')!.onclick = () => { posed = !posed; applyPose(); };
document.getElementById('wire')!.onclick = () => { mat.wireframe = !mat.wireframe; };

(window as unknown as { spikeA: unknown }).spikeA = {
  setAll, setInfluence: (name: string, v: number) => { mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]] = v; measure(); },
  togglePose: () => { posed = !posed; applyPose(); }, setSrc: (s: string) => { src = s; return load(); },
  stats: () => statsEl.textContent,
};
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
load();
