// Spike C: can a figure be posed comfortably by finger? Throwaway code.
import * as THREE from 'three';
import { Quaternion as Q, Vector3 as V3 } from 'three';

const DEG = Math.PI / 180;
const UP = new V3(0, 1, 0);
const DOWN = new V3(0, -1, 0);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2a28);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);

scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a3128, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-1.5, 3.2, 2.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -1.2, right: 1.2, top: 2.2, bottom: -0.2, near: 0.5, far: 8 });
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.02;
scene.add(key);

const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: 0x55524d, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- figure ----------
const skin = () => new THREE.MeshStandardMaterial({ color: 0xd9c3a5, roughness: 0.65 });
const staticMat = skin();
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos?: [number, number, number]) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  if (pos) m.position.set(...pos);
  parent.add(m);
  if (mat === staticMat) bodyMeshes.push(m);
  return m;
}
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, Math.max(len - 2 * r, 0.001), 6, 16);

const figure = new THREE.Group();
scene.add(figure);
const bodyMeshes: THREE.Mesh[] = []; // static body, used to keep IK targets and the elbow out of it
// Static body for context; the figure faces +Z, so its right side is -X.
const torso = mesh(capsule(0.15, 0.55), staticMat, figure, [0, 1.25, 0]);
torso.scale.set(1.15, 1, 0.7);
mesh(capsule(0.16, 0.34), staticMat, figure, [0, 0.98, 0]).scale.set(1.05, 1, 0.75);
mesh(capsule(0.05, 0.14), staticMat, figure, [0, 1.56, 0]);
mesh(new THREE.SphereGeometry(0.11, 24, 16), staticMat, figure, [0, 1.71, 0.01]).scale.set(0.85, 1.05, 1);
for (const s of [-1, 1]) {
  mesh(capsule(0.075, 0.45), staticMat, figure, [0.09 * s, 0.62, 0]);
  mesh(capsule(0.055, 0.45), staticMat, figure, [0.09 * s, 0.2, 0]);
}
// Static left arm (figure's left = +X)
mesh(capsule(0.045, 0.56), staticMat, figure, [0.21, 1.15, 0]).rotation.z = 0.08;
mesh(new THREE.SphereGeometry(0.06, 16, 12), staticMat, figure, [0.19, 1.42, 0]);

// Posable right arm: joints are Object3Ds; the bone runs along local -Y.
type JointName = 'shoulder' | 'elbow' | 'wrist';
const L1 = 0.3, L2 = 0.26, LH = 0.18;
const shoulder = new THREE.Object3D();
shoulder.position.set(-0.19, 1.42, 0);
figure.add(shoulder);
const elbow = new THREE.Object3D();
elbow.position.set(0, -L1, 0);
shoulder.add(elbow);
const wrist = new THREE.Object3D();
wrist.position.set(0, -L2, 0);
elbow.add(wrist);
const joints: Record<JointName, THREE.Object3D> = { shoulder, elbow, wrist };
const boneLen: Record<JointName, number> = { shoulder: L1, elbow: L2, wrist: LH };

const parts: THREE.Mesh[] = [];
function part(j: JointName, geo: THREE.BufferGeometry, pos: [number, number, number]) {
  const m = mesh(geo, skin(), joints[j], pos);
  m.userData.joint = j;
  parts.push(m);
  return m;
}
part('shoulder', capsule(0.05, L1 + 0.02), [0, -L1 / 2, 0]);
part('shoulder', new THREE.SphereGeometry(0.06, 16, 12), [0, 0, 0]);
part('elbow', capsule(0.042, L2 + 0.02), [0, -L2 / 2, 0]);
// Palm faces the body (+X) at rest; thumb points forward (+Z) so orientation reads at a glance.
part('wrist', new THREE.BoxGeometry(0.035, 0.1, 0.085), [0, -0.055, 0]);
part('wrist', new THREE.BoxGeometry(0.03, 0.08, 0.075), [0.004, -0.14, 0]);
part('wrist', capsule(0.014, 0.08), [0.012, -0.06, 0.055]).rotation.x = -0.5;

// ---------- joint limits ----------
let limitsOn = true;
function swingTwist(q: Q, axis: V3) {
  const p = new V3(q.x, q.y, q.z);
  const proj = axis.clone().multiplyScalar(p.dot(axis));
  const twist = new Q(proj.x, proj.y, proj.z, q.w);
  if (twist.lengthSq() < 1e-12) twist.identity(); else twist.normalize();
  if (twist.w < 0) twist.set(-twist.x, -twist.y, -twist.z, -twist.w);
  const swing = q.clone().multiply(twist.clone().invert());
  const angle = 2 * Math.atan2(new V3(twist.x, twist.y, twist.z).dot(axis), twist.w);
  return { swing, twist, angle };
}
const axisAngle = (axis: V3, a: number) => new Q().setFromAxisAngle(axis, a);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

// Max shoulder swing by direction of tilt (azimuth 0 = forward, 90 = outward, ±180 = back, -90 = across the body)
const SWING_KNOTS: [number, number][] = [[-180, 60], [-90, 40], [-45, 120], [0, 180], [90, 180], [135, 100], [180, 60]];
function maxSwing(phiDeg: number) {
  for (let i = 1; i < SWING_KNOTS.length; i++) {
    const [p1, m1] = SWING_KNOTS[i - 1], [p2, m2] = SWING_KNOTS[i];
    if (phiDeg <= p2) return (m1 + ((phiDeg - p1) / (p2 - p1)) * (m2 - m1)) * DEG;
  }
  return 60 * DEG;
}
function clampShoulder(q: Q): Q {
  const { swing, angle } = swingTwist(q, UP);
  const t = clamp(angle, -85 * DEG, 85 * DEG);
  const d = DOWN.clone().applyQuaternion(swing);
  const theta = Math.acos(clamp(-d.y, -1, 1));
  const phi = Math.atan2(-d.x, d.z) / DEG; // right arm: outward is -X
  const m = maxSwing(phi);
  let s = swing;
  if (theta > m) {
    const h = new V3(d.x, 0, d.z);
    if (h.lengthSq() > 1e-10) {
      h.normalize();
      const d2 = DOWN.clone().multiplyScalar(Math.cos(m)).addScaledVector(h, Math.sin(m));
      s = new Q().setFromUnitVectors(DOWN, d2);
    }
  }
  return s.multiply(axisAngle(UP, t));
}
const HINGE = new V3(-1, 0, 0); // positive hinge bends the forearm forward (+Z)
function elbowParams(q: Q) {
  const { swing, angle } = swingTwist(q, UP);
  let hinge = 2 * Math.atan2(-swing.x, swing.w);
  if (hinge > Math.PI) hinge -= 2 * Math.PI;
  return { hinge, twist: angle };
}
const elbowQ = (hinge: number, twist: number) => axisAngle(HINGE, hinge).multiply(axisAngle(UP, twist));
function clampElbow(q: Q): Q {
  const { hinge, twist } = elbowParams(q);
  return elbowQ(clamp(hinge, 0, 150 * DEG), clamp(twist, -85 * DEG, 85 * DEG));
}
function wristTilts(q: Q) {
  const d = DOWN.clone().applyQuaternion(q);
  return { flex: Math.atan2(d.x, -d.y), dev: Math.atan2(d.z, -d.y) };
}
function clampWrist(q: Q): Q {
  const { flex, dev } = wristTilts(q);
  const f = clamp(flex, -70 * DEG, 80 * DEG), dv = clamp(dev, -35 * DEG, 20 * DEG);
  const d = new V3(Math.tan(f), -1, Math.tan(dv)).normalize();
  return new Q().setFromUnitVectors(DOWN, d); // the forearm owns twist; the wrist drops it
}
const clampers: Record<JointName, (q: Q) => Q> = { shoulder: clampShoulder, elbow: clampElbow, wrist: clampWrist };
let limitHit = false;
function setJoint(j: JointName, q: Q) {
  if (!limitsOn) { joints[j].quaternion.copy(q).normalize(); return; }
  const c = clampers[j](q);
  if (c.angleTo(q) > 0.5 * DEG) limitHit = true;
  joints[j].quaternion.copy(c);
}

// ---------- IK ----------
const wpos = (o: THREE.Object3D) => o.getWorldPosition(new V3());
const wquat = (o: THREE.Object3D) => o.getWorldQuaternion(new Q());
const perp = (v: V3, axis: V3) => v.clone().addScaledVector(axis, -v.dot(axis));

const NATURAL_ELBOW = new V3(-0.4, -1, -0.12).normalize(); // right arm: outward is -X

// Rough torso volume (an elliptic cylinder) so the elbow doesn't swivel through the chest
function elbowInBody(shoulderLocal: Q) {
  const e = DOWN.clone().multiplyScalar(L1).applyQuaternion(wquat(shoulder.parent!).multiply(shoulderLocal)).add(wpos(shoulder));
  return e.y > 0.75 && e.y < 1.5 && (e.x / 0.2) ** 2 + (e.z / 0.13) ** 2 < 1;
}

// Two-bone solve that brings the point `reach` along the forearm to `target`.
// The elbow keeps its current swivel if it can; otherwise it swings to the nearest swivel the limits allow.
function solveArm(target: V3, reach: number) {
  figure.updateMatrixWorld(true);
  const S = wpos(shoulder);
  const P = wquat(shoulder.parent!);
  const toT = target.clone().sub(S);
  const dist = clamp(toT.length(), Math.abs(L1 - reach) + 1e-4, L1 + reach - 1e-4);
  const dir = toT.normalize();
  // Elbow swivel: keep where it was (continuity), drifting toward where a relaxed elbow points
  // (down, back, a little out) so it self-corrects instead of getting stuck in odd swivels.
  const natural = perp(NATURAL_ELBOW, dir);
  const prev = perp(wpos(elbow).sub(S), dir);
  const pole0 = natural.lengthSq() > 1e-6 ? natural.normalize() : prev.clone();
  if (prev.lengthSq() > 1e-6 && natural.lengthSq() > 1e-6) pole0.lerp(prev.normalize(), 0.85);
  if (pole0.lengthSq() < 1e-8) pole0.copy(perp(new V3(0, 0, -1), dir));
  pole0.normalize();
  const cosA = clamp((L1 * L1 + dist * dist - reach * reach) / (2 * L1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const interior = Math.acos(clamp((L1 * L1 + reach * reach - dist * dist) / (2 * L1 * reach), -1, 1));
  const twist = elbowParams(elbow.quaternion).twist;

  const candidate = (swivel: number) => {
    const pole = pole0.clone().applyAxisAngle(dir, swivel);
    const u = dir.clone().multiplyScalar(cosA).addScaledVector(pole, sinA); // upper-arm direction
    const yAx = u.clone().negate();
    const zAx = perp(pole.clone().negate(), u).normalize();
    const xAx = new V3().crossVectors(yAx, zAx);
    const world = new Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, yAx, zAx));
    return P.clone().invert().multiply(world);
  };
  let best = candidate(0);
  if (limitsOn) {
    for (let k = 0; k <= 18; k++) {
      let found = false;
      for (const s of k ? [k, -k] : [0]) {
        const c = candidate(s * 10 * DEG);
        if (clampShoulder(c).angleTo(c) < 0.5 * DEG && !elbowInBody(c)) { best = c; found = true; break; }
      }
      if (found) break;
    }
  }
  setJoint('shoulder', best);
  setJoint('elbow', elbowQ(Math.PI - interior, twist));
}

// ---------- camera control ----------
const orbit = { target: new V3(-0.1, 1.2, 0), radius: 2.6, theta: -0.5, phi: 1.35 };
const LENSES = [24, 35, 50, 85, 135];
let lens = 50;
function updateCamera() {
  const { target, radius, theta, phi } = orbit;
  camera.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.filmGauge = 35;
  camera.setFocalLength(lens);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
updateCamera();

// ---------- rotation rings ----------
const ringGroup = new THREE.Group();
scene.add(ringGroup);
ringGroup.visible = false;
const RING_AXES = { x: new V3(1, 0, 0), y: new V3(0, 1, 0), z: new V3(0, 0, 1) };
type Axis = keyof typeof RING_AXES;
const ringColors: Record<Axis, number> = { x: 0xff5a5a, y: 0x6fe06f, z: 0x5aa0ff };
const ringPick: THREE.Mesh[] = [];
const ringVis: Record<Axis, THREE.Mesh> = {} as never;
for (const a of Object.keys(RING_AXES) as Axis[]) {
  const vis = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: ringColors[a], depthTest: false, transparent: true, opacity: 0.9 }));
  const pick = new THREE.Mesh(new THREE.TorusGeometry(1, 0.16, 6, 48), new THREE.MeshBasicMaterial({ visible: false }));
  for (const m of [vis, pick]) {
    if (a === 'x') m.rotation.y = Math.PI / 2;
    if (a === 'y') m.rotation.x = Math.PI / 2;
    m.renderOrder = 10;
    ringGroup.add(m);
  }
  pick.userData.axis = a;
  ringPick.push(pick);
  ringVis[a] = vis;
}
// Which rings each joint gets, and the frame they rotate in
const RINGS: Record<JointName, Axis[]> = { shoulder: ['x', 'y', 'z'], elbow: ['x', 'y'], wrist: ['x', 'z'] };
let ringJoint: JointName | null = null;
function ringFrame(j: JointName): Q {
  if (j === 'shoulder') return wquat(shoulder);
  if (j === 'elbow') return wquat(shoulder).multiply(axisAngle(HINGE, elbowParams(elbow.quaternion).hinge));
  return wquat(elbow); // wrist tilts live in the forearm frame
}
function updateRings() {
  ringGroup.visible = ringJoint !== null;
  if (!ringJoint) return;
  figure.updateMatrixWorld(true);
  const p = wpos(joints[ringJoint]);
  ringGroup.position.copy(p);
  ringGroup.quaternion.copy(ringFrame(ringJoint));
  const radiusPx = Math.min(110, 0.2 * Math.min(innerWidth, innerHeight));
  const worldPerPx = (2 * Math.tan((camera.fov * DEG) / 2) * p.distanceTo(camera.position)) / innerHeight;
  ringGroup.scale.setScalar(radiusPx * worldPerPx);
  for (const a of Object.keys(RING_AXES) as Axis[]) {
    const on = RINGS[ringJoint].includes(a);
    ringVis[a].visible = on;
    ringPick.find(m => m.userData.axis === a)!.visible = on;
  }
}
// Apply a rotation of `delta` about ring axis `a` of joint j
function rotateJoint(j: JointName, a: Axis, delta: number) {
  const q = joints[j].quaternion;
  if (j === 'elbow') {
    const { hinge, twist } = elbowParams(q);
    setJoint('elbow', a === 'x' ? elbowQ(hinge + delta, twist) : elbowQ(hinge, twist + delta));
  } else if (j === 'shoulder') {
    setJoint(j, q.clone().multiply(axisAngle(RING_AXES[a], delta)));
  } else {
    setJoint(j, axisAngle(RING_AXES[a], delta).multiply(q.clone()));
  }
}

// ---------- undo ----------
type Pose = Record<JointName, Q>;
const snap = (): Pose => ({ shoulder: shoulder.quaternion.clone(), elbow: elbow.quaternion.clone(), wrist: wrist.quaternion.clone() });
const apply = (p: Pose) => (Object.keys(p) as JointName[]).forEach(j => joints[j].quaternion.copy(p[j]));
const samePose = (a: Pose, b: Pose) => (Object.keys(a) as JointName[]).every(j => a[j].angleTo(b[j]) < 1e-5);
const undoStack: Pose[] = [], redoStack: Pose[] = [];
const REST = snap();
function commit(before: Pose) {
  if (samePose(before, snap())) return;
  undoStack.push(before);
  redoStack.length = 0;
  refreshBar();
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
function rayAt(x: number, y: number) {
  ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  return ray;
}
function pickPart(x: number, y: number) {
  return rayAt(x, y).intersectObjects(parts, false)[0] ?? null;
}
function pickRing(x: number, y: number) {
  if (!ringGroup.visible) return null;
  return rayAt(x, y).intersectObjects(ringPick.filter(m => m.visible), false)[0] ?? null;
}
// Point on the plane through `p` facing the camera, under screen point (x, y)
function dragPoint(x: number, y: number, p: V3) {
  const n = camera.getWorldDirection(new V3());
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
  return rayAt(x, y).ray.intersectPlane(plane, new V3()) ?? p.clone();
}
function toScreen(p: V3) {
  const v = p.clone().project(camera);
  return new THREE.Vector2((v.x + 1) * 0.5 * innerWidth, (1 - v.y) * 0.5 * innerHeight);
}

// ---------- selection / highlight ----------
let selected: JointName | null = null;
let hovered: JointName | null = null;
function refreshHighlight() {
  for (const m of parts) {
    const j = m.userData.joint as JointName;
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(j === selected ? 0x7a4a10 : j === hovered ? 0x3a3020 : 0);
  }
}

// ---------- gestures ----------
type Gesture =
  | { kind: 'pending'; id: number; x0: number; y0: number; hit: THREE.Intersection; timer: number; slop: number }
  | { kind: 'ik'; id: number; j: JointName; grabOffset: V3; reach: number; handWorld: Q | null; plane: V3 }
  | { kind: 'ring'; id: number; j: JointName; axis: Axis; tangentPx: THREE.Vector2; radiusPx: number; last: THREE.Vector2 }
  | { kind: 'orbit'; id: number; lx: number; ly: number }
  | { kind: 'pinch'; dist: number; mid: THREE.Vector2 }
  | { kind: 'none' };
let g: Gesture = { kind: 'none' };
const pointers = new Map<number, PointerEvent>();
let gestureStart: Pose = snap();
let hadTwoFingers = false;

function beginIK(id: number, hit: THREE.Intersection) {
  const j = hit.object.userData.joint as JointName;
  const jo = joints[j];
  figure.updateMatrixWorld(true);
  const local = jo.worldToLocal(hit.point.clone());
  const along = clamp(-local.y, 0.02, boneLen[j]);
  const axisPt = jo.localToWorld(new V3(0, -along, 0));
  if (j === 'wrist') {
    const wp = wpos(wrist);
    g = { kind: 'ik', id, j, grabOffset: hit.point.clone().sub(wp), reach: L2, handWorld: holdHand ? wquat(wrist) : null, plane: hit.point.clone() };
  } else {
    g = { kind: 'ik', id, j, grabOffset: hit.point.clone().sub(axisPt), reach: along, handWorld: null, plane: hit.point.clone() };
  }
  select(j, false);
}
function moveIK(x: number, y: number) {
  if (g.kind !== 'ik') return;
  let p = dragPoint(x, y, g.plane);
  // The drag plane has no depth sense, so targets often land inside the body. If the body
  // surface is nearer than the plane under the finger, put the target just in front of it.
  const hitBody = rayAt(x, y).intersectObjects(bodyMeshes, false)[0];
  if (hitBody && hitBody.distance < camera.position.distanceTo(p)) {
    p = hitBody.point.clone().add(rayAt(x, y).ray.direction.clone().multiplyScalar(-0.06));
  }
  p.sub(g.grabOffset);
  limitHit = false;
  if (g.j === 'shoulder') {
    figure.updateMatrixWorld(true);
    const S = wpos(shoulder);
    const cur = DOWN.clone().applyQuaternion(wquat(shoulder));
    const want = p.sub(S).normalize();
    const world = new Q().setFromUnitVectors(cur, want).multiply(wquat(shoulder));
    setJoint('shoulder', wquat(shoulder.parent!).invert().multiply(world));
  } else {
    solveArm(p, g.reach);
    if (g.handWorld) {
      // Keep the hand's world angle: give its twist to the forearm, the rest to the wrist.
      figure.updateMatrixWorld(true);
      const local = wquat(elbow).invert().multiply(g.handWorld);
      const { angle } = swingTwist(local, UP);
      const { hinge, twist } = elbowParams(elbow.quaternion);
      setJoint('elbow', elbowQ(hinge, twist + angle));
      figure.updateMatrixWorld(true);
      setJoint('wrist', wquat(elbow).invert().multiply(g.handWorld));
    }
  }
}
function beginRing(id: number, hit: THREE.Intersection, x: number, y: number) {
  const axis = hit.object.userData.axis as Axis;
  const j = ringJoint!;
  const center = ringGroup.position.clone();
  const axisW = RING_AXES[axis].clone().applyQuaternion(ringGroup.quaternion);
  // Tangent of positive rotation at the grabbed point, projected to the screen
  const r = hit.point.clone().sub(center);
  const t = new V3().crossVectors(axisW, r).normalize().multiplyScalar(r.length() * 0.05);
  const a = toScreen(hit.point), b = toScreen(hit.point.clone().add(t));
  const tangentPx = b.sub(a);
  const len = tangentPx.length();
  // Edge-on rings project to almost nothing; fall back to a sensible drag direction.
  g = {
    kind: 'ring', id, j, axis, last: new THREE.Vector2(x, y),
    tangentPx: len > 1e-3 ? tangentPx.divideScalar(len) : new THREE.Vector2(1, 0),
    radiusPx: Math.max(40, toScreen(center).distanceTo(toScreen(hit.point))),
  };
}
function moveRing(x: number, y: number) {
  if (g.kind !== 'ring') return;
  const cur = new THREE.Vector2(x, y);
  const d = cur.clone().sub(g.last).dot(g.tangentPx) / g.radiusPx;
  g.last = cur;
  limitHit = false;
  rotateJoint(g.j, g.axis, d);
}

let holdHand = true;
function select(j: JointName | null, rings: boolean) {
  selected = j;
  ringJoint = rings ? j : null;
  refreshHighlight();
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, e);
  if (pointers.size === 1) { gestureStart = snap(); hadTwoFingers = false; }
  if (pointers.size === 2) {
    // Second finger: whatever was happening becomes a camera pinch.
    if (g.kind === 'pending') clearTimeout(g.timer);
    hadTwoFingers = true;
    const [a, b] = [...pointers.values()];
    g = { kind: 'pinch', dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mid: new THREE.Vector2((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2) };
    return;
  }
  if (pointers.size > 2) return;
  const x = e.clientX, y = e.clientY;
  if ((e.buttons & 2) || e.button === 1) { g = { kind: 'orbit', id: e.pointerId, lx: x, ly: y }; return; } // S Pen side button / right / middle mouse
  const rh = pickRing(x, y);
  if (rh) { beginRing(e.pointerId, rh, x, y); return; }
  const hit = pickPart(x, y);
  if (!hit) { g = { kind: 'orbit', id: e.pointerId, lx: x, ly: y }; return; }
  const id = e.pointerId;
  const timer = window.setTimeout(() => {
    if (g.kind === 'pending' && g.id === id) {
      select(hit.object.userData.joint, true);
      navigator.vibrate?.(15);
      g = { kind: 'none' };
    }
  }, 450);
  g = { kind: 'pending', id, x0: x, y0: y, hit, timer, slop: e.pointerType === 'touch' ? 10 : 4 };
});

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) {
    // Hover (mouse, S Pen)
    if (e.pointerType !== 'touch') {
      const h = pickPart(e.clientX, e.clientY);
      const j = (h?.object.userData.joint as JointName) ?? null;
      if (j !== hovered) { hovered = j; refreshHighlight(); }
    }
    return;
  }
  pointers.set(e.pointerId, e);
  const x = e.clientX, y = e.clientY;
  switch (g.kind) {
    case 'pending':
      if (g.id === e.pointerId && Math.hypot(x - g.x0, y - g.y0) > g.slop) {
        clearTimeout(g.timer);
        beginIK(g.id, g.hit);
        moveIK(x, y);
      }
      break;
    case 'ik': if (g.id === e.pointerId) moveIK(x, y); break;
    case 'ring': if (g.id === e.pointerId) moveRing(x, y); break;
    case 'orbit':
      if (g.id === e.pointerId) {
        orbit.theta -= (x - g.lx) * 0.008;
        orbit.phi = clamp(orbit.phi - (y - g.ly) * 0.008, 0.1, Math.PI - 0.1);
        g.lx = x; g.ly = y;
        updateCamera();
      }
      break;
    case 'pinch': {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mid = new THREE.Vector2((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      orbit.radius = clamp(orbit.radius * (g.dist / Math.max(dist, 1)), 0.4, 12);
      const worldPerPx = (2 * Math.tan((camera.fov * DEG) / 2) * orbit.radius) / innerHeight;
      const right = new V3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new V3().setFromMatrixColumn(camera.matrixWorld, 1);
      orbit.target.addScaledVector(right, -(mid.x - g.mid.x) * worldPerPx).addScaledVector(up, (mid.y - g.mid.y) * worldPerPx);
      g.dist = dist; g.mid = mid;
      updateCamera();
      break;
    }
  }
});

function endPointer(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (g.kind === 'pending' && g.id === e.pointerId) {
    clearTimeout(g.timer);
    select(g.hit.object.userData.joint, ringJoint === g.hit.object.userData.joint);
  } else if (g.kind === 'orbit' && !hadTwoFingers) {
    // A tap on empty space deselects
    if (e.type === 'pointerup' && !moved) select(null, false);
  }
  if (pointers.size === 0) {
    commit(gestureStart);
    g = { kind: 'none' };
    moved = false;
  } else if (g.kind === 'pinch') {
    // One finger lifted from a pinch: carry on orbiting with the other, without a jump.
    const [rest] = [...pointers.values()];
    g = { kind: 'orbit', id: rest.pointerId, lx: rest.clientX, ly: rest.clientY };
  }
}
let moved = false;
canvas.addEventListener('pointermove', e => { if (pointers.has(e.pointerId) && g.kind === 'orbit') moved = true; });
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch' && hovered) { hovered = null; refreshHighlight(); } });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  orbit.radius = clamp(orbit.radius * Math.exp(e.deltaY * 0.001), 0.4, 12);
  updateCamera();
}, { passive: false });

// ---------- toolbar ----------
const $ = (id: string) => document.getElementById(id) as HTMLButtonElement;
function refreshBar() {
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
  $('limits').classList.toggle('on', limitsOn);
  $('hold').classList.toggle('on', holdHand);
  $('lens').textContent = `${lens}mm`;
}
$('undo').onclick = () => { const p = undoStack.pop(); if (p) { redoStack.push(snap()); apply(p); } refreshBar(); };
$('redo').onclick = () => { const p = redoStack.pop(); if (p) { undoStack.push(snap()); apply(p); } refreshBar(); };
$('limits').onclick = () => {
  limitsOn = !limitsOn;
  if (limitsOn) { const before = snap(); (Object.keys(joints) as JointName[]).forEach(j => setJoint(j, joints[j].quaternion.clone())); commit(before); }
  refreshBar();
};
$('hold').onclick = () => { holdHand = !holdHand; refreshBar(); };
$('lens').onclick = () => {
  const next = LENSES[(LENSES.indexOf(lens) + 1) % LENSES.length];
  orbit.radius *= next / lens; // walk back with a longer lens so the framing holds
  lens = next;
  resize(); updateCamera(); refreshBar();
};
$('reset').onclick = () => { const before = snap(); apply(REST); commit(before); };
const help = document.getElementById('help')!;
$('helpBtn').onclick = () => help.classList.add('show');
help.onclick = () => help.classList.remove('show');
refreshBar();

// ---------- HUD ----------
const fpsEl = document.getElementById('fps')!, selEl = document.getElementById('sel')!;
function describe(j: JointName) {
  const q = joints[j].quaternion;
  if (j === 'shoulder') {
    const { swing, angle } = swingTwist(q, UP);
    const d = DOWN.clone().applyQuaternion(swing);
    return `Shoulder\nraise ${(Math.acos(clamp(-d.y, -1, 1)) / DEG).toFixed(0)}°  twist ${(angle / DEG).toFixed(0)}°`;
  }
  if (j === 'elbow') {
    const { hinge, twist } = elbowParams(q);
    return `Elbow\nbend ${(hinge / DEG).toFixed(0)}°  twist ${(twist / DEG).toFixed(0)}°`;
  }
  const { flex, dev } = wristTilts(q);
  return `Wrist\nflex ${(flex / DEG).toFixed(0)}°  dev ${(dev / DEG).toFixed(0)}°`;
}
let frames = 0, lastFps = performance.now();
renderer.setAnimationLoop(() => {
  updateRings();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - lastFps > 500) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - lastFps))} fps`;
    frames = 0; lastFps = now;
  }
  selEl.textContent = selected ? describe(selected) + (limitHit && limitsOn ? '\nat limit' : '') : 'Tap the arm';
  selEl.classList.toggle('limit', limitHit && limitsOn && !!selected);
});

// Test hook for automated screenshots
const screenOf = (j: JointName, along = 0.5) => {
  figure.updateMatrixWorld(true);
  const p = toScreen(joints[j].localToWorld(new V3(0, -along * boneLen[j], 0)));
  return { x: p.x, y: p.y };
};
(window as unknown as { spike: unknown }).spike = { joints, screenOf, ringJoint: () => ringJoint, describe: () => selEl.textContent };
