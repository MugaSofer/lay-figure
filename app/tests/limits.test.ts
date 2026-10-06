import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { clampJoint, resolveLimit, swingTwist, type LimitSpec } from '../src/pose/limits';

const DEG = Math.PI / 180;
const spec: LimitSpec = { swing: { forward: 90, back: 20, out: 40, in: 10 }, twist: [-30, 30] };
const L = resolveLimit(spec, new Quaternion(), 1); // bone pointing up (+Y) at rest, world-aligned

const swingToward = (dir: Vector3, deg: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0).cross(dir).normalize(), deg * DEG);
const angleFromRest = (q: Quaternion) => new Vector3(0, 1, 0).applyQuaternion(q).angleTo(new Vector3(0, 1, 0)) / DEG;

describe('joint limits', () => {
  it('leave rotations inside the limit alone', () => {
    for (const q of [new Quaternion(), swingToward(new Vector3(0, 0, 1), 60), swingToward(new Vector3(1, 0, 0), 30)]) {
      expect(clampJoint(q, L).angleTo(q)).toBeLessThan(1e-6);
    }
  });
  it('clamp swing to the per-direction maximum', () => {
    expect(angleFromRest(clampJoint(swingToward(new Vector3(0, 0, 1), 120), L))).toBeCloseTo(90, 4);
    expect(angleFromRest(clampJoint(swingToward(new Vector3(0, 0, -1), 60), L))).toBeCloseTo(20, 4);
    expect(angleFromRest(clampJoint(swingToward(new Vector3(1, 0, 0), 80), L))).toBeCloseTo(40, 4);
    expect(angleFromRest(clampJoint(swingToward(new Vector3(-1, 0, 0), 80), L))).toBeCloseTo(10, 4);
  });
  it('clamp twist and keep swing', () => {
    const q = swingToward(new Vector3(0, 0, 1), 45).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 80 * DEG));
    const c = clampJoint(q, L);
    expect(swingTwist(c).angle / DEG).toBeCloseTo(30, 4);
    expect(angleFromRest(c)).toBeCloseTo(45, 4);
  });
  it('are continuous: halving the input step roughly halves the largest output jump', () => {
    const worstJump = (step: number) => {
      let prev: Quaternion | null = null, worst = 0;
      for (let a = 0; a <= 360; a += step) {
        const c = clampJoint(swingToward(new Vector3(Math.sin(a * DEG), 0, Math.cos(a * DEG)), 150), L);
        if (prev) worst = Math.max(worst, c.angleTo(prev));
        prev = c;
      }
      return worst;
    };
    const a = worstJump(1), b = worstJump(0.5), c = worstJump(0.25);
    expect(b / a).toBeLessThan(0.6);
    expect(c / b).toBeLessThan(0.6);
  });
});
