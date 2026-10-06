// Rotation rings for direct (FK) joint rotation: three rings in the joint's local axes, constant size on
// screen, with fat invisible copies for finger-sized picking.
import {
  Group, Mesh, MeshBasicMaterial, Quaternion, Raycaster, TorusGeometry, Vector2, Vector3, type Camera, type Intersection,
} from 'three';

export type Axis = 'x' | 'y' | 'z';
export const AXES: Record<Axis, Vector3> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const COLORS: Record<Axis, number> = { x: 0xff5a5a, y: 0x6fe06f, z: 0x5aa0ff };

export class Rings {
  readonly group = new Group();
  private picks: Mesh[] = [];
  bone = -1;

  constructor() {
    for (const a of Object.keys(AXES) as Axis[]) {
      const vis = new Mesh(new TorusGeometry(1, 0.022, 8, 72), new MeshBasicMaterial({ color: COLORS[a], depthTest: false, transparent: true, opacity: 0.92 }));
      const pick = new Mesh(new TorusGeometry(1, 0.15, 6, 48), new MeshBasicMaterial({ visible: false }));
      for (const m of [vis, pick]) {
        if (a === 'x') m.rotation.y = Math.PI / 2;
        if (a === 'y') m.rotation.x = Math.PI / 2;
        m.renderOrder = 10;
        this.group.add(m);
      }
      pick.userData.axis = a;
      this.picks.push(pick);
    }
    this.group.visible = false;
  }

  show(bone: number) { this.bone = bone; this.group.visible = true; }
  hide() { this.bone = -1; this.group.visible = false; }
  get visible() { return this.group.visible; }

  /** Place at a joint, oriented to its frame, sized to ~radiusPx on screen. */
  place(pos: Vector3, rot: Quaternion, camera: Camera & { fov: number }, viewportH: number) {
    this.group.position.copy(pos);
    this.group.quaternion.copy(rot);
    const radiusPx = Math.min(110, 0.2 * viewportH);
    const worldPerPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * pos.distanceTo(camera.position)) / viewportH;
    this.group.scale.setScalar(radiusPx * worldPerPx);
    this.group.updateMatrixWorld(true);
  }

  pick(ray: Raycaster): Intersection | null {
    if (!this.visible) return null;
    return ray.intersectObjects(this.picks, false)[0] ?? null;
  }

  /** Screen-space drag direction for positive rotation about the ring's axis at the grabbed point. */
  dragFrame(hit: Intersection, toScreen: (p: Vector3) => Vector2) {
    const axis = hit.object.userData.axis as Axis;
    const center = this.group.position;
    const axisW = AXES[axis].clone().applyQuaternion(this.group.quaternion);
    const r = hit.point.clone().sub(center);
    const t = new Vector3().crossVectors(axisW, r).normalize().multiplyScalar(r.length() * 0.05);
    const a = toScreen(hit.point), b = toScreen(hit.point.clone().add(t));
    const dir = b.sub(a);
    const len = dir.length();
    return {
      axis,
      dir: len > 1e-3 ? dir.divideScalar(len) : new Vector2(1, 0),
      radiusPx: Math.max(40, toScreen(center).distanceTo(toScreen(hit.point))),
    };
  }
}
