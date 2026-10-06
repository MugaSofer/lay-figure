// Pointer routing: one finger on the figure poses it, one finger on empty space orbits, two fingers
// pinch-zoom and pan, mouse wheel zooms, right/middle drag (or S Pen side button) orbits.
// Ported from spike C, including its fixes (tap slack, slop rebasing, long-press rings).
import { Vector2, Vector3 } from 'three';
import type { Stage } from './stage';

/** What the posing layer needs from input. */
export interface PoseInput {
  /** Is there something poseable (or a ring) under this point? Called on pointer down. */
  hitTest(x: number, y: number): 'ring' | 'body' | null;
  tap(x: number, y: number): void; // tap on the body
  longPress(x: number, y: number): void;
  tapEmpty(): void;
  beginDrag(x0: number, y0: number, x: number, y: number, kind: 'ring' | 'body'): void;
  moveDrag(x: number, y: number): void;
  endDrag(): void;
}

const LONG_PRESS_MS = 450;

export class InputRouter {
  private pointers = new Map<number, PointerEvent>();
  private mode: 'none' | 'pending' | 'drag' | 'orbit' | 'pinch' | 'pan' = 'none';
  private id = -1;
  private x0 = 0; private y0 = 0; private lx = 0; private ly = 0;
  private kind: 'ring' | 'body' = 'body';
  private timer = 0;
  private slop = 10;
  private moved = false;
  private pinch = { dist: 0, mid: new Vector2() };
  onCameraChange: () => void = () => {};

  constructor(private stage: Stage, private pose: PoseInput) {
    const c = stage.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.up(e));
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * 0.001));
    }, { passive: false });
  }

  private zoom(f: number) {
    const o = this.stage.orbit;
    o.radius = Math.min(Math.max(o.radius * f, 0.3), 40);
    this.stage.updateCamera();
    this.onCameraChange();
  }

  private down(e: PointerEvent) {
    this.stage.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, e);
    if (this.pointers.size === 2) {
      clearTimeout(this.timer);
      if (this.mode === 'drag') this.pose.endDrag();
      const [a, b] = [...this.pointers.values()];
      this.pinch.dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      this.pinch.mid.set((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      this.mode = 'pinch';
      return;
    }
    if (this.pointers.size > 2) return;
    const x = e.clientX, y = e.clientY;
    this.id = e.pointerId;
    this.x0 = this.lx = x; this.y0 = this.ly = y;
    this.moved = false;
    if (e.button === 1 || e.button === 2 || (e.buttons & 2)) { this.mode = e.shiftKey || e.button === 1 ? 'pan' : 'orbit'; return; }
    const hit = this.pose.hitTest(x, y);
    if (!hit) { this.mode = 'orbit'; return; }
    this.kind = hit;
    this.slop = e.pointerType === 'touch' ? 10 : 4;
    if (hit === 'ring') { this.mode = 'drag'; this.pose.beginDrag(x, y, x, y, 'ring'); return; }
    this.mode = 'pending';
    this.timer = window.setTimeout(() => {
      if (this.mode === 'pending') { this.mode = 'none'; navigator.vibrate?.(15); this.pose.longPress(this.x0, this.y0); }
    }, LONG_PRESS_MS);
  }

  private move(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, e);
    const x = e.clientX, y = e.clientY;
    if (Math.hypot(x - this.x0, y - this.y0) > this.slop) this.moved = true;
    switch (this.mode) {
      case 'pending':
        if (e.pointerId === this.id && this.moved) {
          clearTimeout(this.timer);
          this.mode = 'drag';
          this.pose.beginDrag(this.x0, this.y0, x, y, this.kind);
        }
        break;
      case 'drag': if (e.pointerId === this.id) this.pose.moveDrag(x, y); break;
      case 'orbit':
        if (e.pointerId === this.id) {
          const o = this.stage.orbit;
          o.theta -= (x - this.lx) * 0.008;
          o.phi = Math.min(Math.max(o.phi - (y - this.ly) * 0.008, 0.05), Math.PI - 0.05);
          this.lx = x; this.ly = y;
          this.stage.updateCamera();
          this.onCameraChange();
        }
        break;
      case 'pan':
        if (e.pointerId === this.id) { this.panBy(x - this.lx, y - this.ly); this.lx = x; this.ly = y; }
        break;
      case 'pinch': {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const mid = new Vector2((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        this.zoom(this.pinch.dist / Math.max(dist, 1));
        this.panBy(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
        this.pinch.dist = dist;
        this.pinch.mid.copy(mid);
        break;
      }
    }
  }

  private panBy(dx: number, dy: number) {
    const s = this.stage, cam = s.camera;
    const worldPerPx = (2 * Math.tan((cam.fov * Math.PI) / 360) * s.orbit.radius) / s.canvas.clientHeight;
    const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    s.orbit.target.addScaledVector(right, -dx * worldPerPx).addScaledVector(up, dy * worldPerPx);
    s.updateCamera();
    this.onCameraChange();
  }

  private up(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (e.pointerId === this.id) {
      clearTimeout(this.timer);
      if (this.mode === 'pending' && e.type === 'pointerup') this.pose.tap(this.x0, this.y0);
      else if (this.mode === 'drag') this.pose.endDrag();
      else if (this.mode === 'orbit' && !this.moved && e.type === 'pointerup') this.pose.tapEmpty();
    }
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.mode === 'pinch') {
      // one finger lifted from a pinch: carry on orbiting with the other, without a jump
      const [rest] = [...this.pointers.values()];
      this.id = rest.pointerId;
      this.lx = rest.clientX; this.ly = rest.clientY;
      this.moved = true;
      this.mode = 'orbit';
    }
  }
}
