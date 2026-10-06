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
  for (const [name, i] of Object.entries(mesh.morphTargetDictionary!)) {
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

// A pose that bends joints under the morphs, to see skinning and morphs together (local bone axes, rough)
const POSE: Record<string, [number, number, number]> = {
  upperarm_r: [0, 0, -0.9], lowerarm_r: [0, 0, -1.4], upperarm_l: [0.6, 0, 0.4], lowerarm_l: [0, 0, 1.2],
  thigh_r: [-1.2, 0, 0], calf_r: [1.6, 0, 0], spine_02: [0.25, 0, 0], neck_01: [0.2, 0.3, 0],
};
const restQ = new Map<THREE.Bone, THREE.Quaternion>();
function applyPose() {
  for (const b of mesh.skeleton.bones) {
    if (!restQ.has(b)) restQ.set(b, b.quaternion.clone());
    b.quaternion.copy(restQ.get(b)!);
    const p = POSE[b.name];
    if (posed && p) b.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p)));
  }
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
