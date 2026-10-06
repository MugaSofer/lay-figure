import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Figure } from '../src/body/figure';
import { mirrorPose } from '../src/pose/mirror';
import { PoseRig } from '../src/pose/rig';
import { makeFigure } from './helpers';

let fig: Figure, rig: PoseRig;
beforeAll(async () => { fig = await makeFigure(); rig = new PoseRig(fig); }, 30000);

// deterministic pseudo-random
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const randomAxis = () => new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();

describe('rig', () => {
  it('bone +Y runs from head to tail at rest', () => {
    fig.resetPose();
    for (let i = 1; i < fig.bones.length; i++) {
      const r = fig.rests[i];
      if (r.length < 1e-4) continue;
      const y = new Vector3(0, 1, 0).applyQuaternion(rig.worldQuat(i));
      expect(y.angleTo(r.tail.clone().sub(r.head))).toBeLessThan(1e-4);
    }
  });

  it('limb IK reaches targets that a valid pose can reach', () => {
    // Targets come from random poses within limits, so every one is reachable. This tests the two-bone
    // solver itself, so the automatic shoulder rhythm (which moves the shoulder) is off.
    rig.limitsOn = true;
    rig.shoulderRhythm = false;
    const errors: number[] = [];
    for (const limb of [rig.arms.l, rig.arms.r, rig.legs.l, rig.legs.r]) {
      for (let n = 0; n < 15; n++) {
        // a reachable target: pose the limb randomly within limits, record the end, reset, solve
        fig.resetPose();
        for (const b of [limb.upper, limb.lower]) rig.setJoint(b, new Quaternion().setFromAxisAngle(randomAxis(), rand() * 2));
        fig.group.updateMatrixWorld(true);
        const target = rig.worldPos(limb.end);
        const reach = target.distanceTo(rig.worldPos(limb.lower));
        fig.resetPose();
        rig.resetContinuity();
        for (let k = 0; k < 40; k++) rig.solveLimb(limb, target, reach);
        fig.group.updateMatrixWorld(true);
        errors.push(rig.worldPos(limb.end).distanceTo(target));
        for (const b of [limb.upper, limb.lower]) expect(rig.violation(b, fig.joints[b])).toBeLessThan(1e-3);
      }
    }
    errors.sort((a, b) => a - b);
    console.log(`IK miss: median ${(errors[errors.length >> 1] * 1000).toFixed(2)} mm, worst ${(errors[errors.length - 1] * 1000).toFixed(2)} mm`);
    expect(errors[errors.length >> 1]).toBeLessThan(0.0005);
    expect(errors[errors.length - 1]).toBeLessThan(0.002);
    rig.shoulderRhythm = true;
  });

  it('reaches anatomically easy targets with limits on (not just ones generated through the limits)', () => {
    rig.limitsOn = true;
    const cases: [typeof rig.arms.l, (s: Vector3) => Vector3][] = [
      // hand to just in front of its own shoulder (elbow deeply bent)
      [rig.arms.l, s => s.clone().add(new Vector3(0, -0.05, 0.18))],
      [rig.arms.r, s => s.clone().add(new Vector3(0, -0.05, 0.18))],
      // hand straight out in front at shoulder height (elbow straight)
      [rig.arms.l, s => s.clone().add(new Vector3(0.05, 0, 0.45))],
      // foot tucked up under the hip, as in a deep crouch (knee deeply bent)
      [rig.legs.l, s => s.clone().add(new Vector3(0, -0.3, -0.12))],
      [rig.legs.r, s => s.clone().add(new Vector3(0, -0.3, -0.12))],
      // leg straight forward (hip flexed 90, knee straight)
      [rig.legs.r, s => s.clone().add(new Vector3(0, -0.05, 0.75))],
    ];
    for (const [limb, where] of cases) {
      fig.resetPose();
      rig.resetContinuity();
      fig.group.updateMatrixWorld(true);
      const target = where(rig.worldPos(limb.upper));
      const reach = fig.rests[limb.lower].length;
      for (let k = 0; k < 40; k++) rig.solveLimb(limb, target, reach);
      fig.group.updateMatrixWorld(true);
      expect(rig.worldPos(limb.end).distanceTo(target)).toBeLessThan(0.01);
    }
  });

  it('mirroring twice gives the original pose', () => {
    fig.resetPose();
    for (let i = 1; i < fig.bones.length; i++) fig.joints[i].setFromAxisAngle(randomAxis(), rand());
    fig.rootOffset.set(0.1, -0.05, 0.02);
    const before = fig.joints.map(q => q.clone());
    mirrorPose(fig, 'flip');
    mirrorPose(fig, 'flip');
    fig.joints.forEach((q, i) => expect(q.angleTo(before[i])).toBeLessThan(1e-5));
    expect(fig.rootOffset.x).toBeCloseTo(0.1, 9);
  });

  it('mirroring a pose puts the twin limb at the reflected position', () => {
    fig.resetPose();
    rig.setJoint(rig.arms.l.upper, new Quaternion().setFromAxisAngle(new Vector3(1, 0.2, 0.3).normalize(), 0.9));
    fig.group.updateMatrixWorld(true);
    const handL = rig.worldPos(rig.arms.l.end);
    mirrorPose(fig, 'l2r');
    fig.group.updateMatrixWorld(true);
    const handR = rig.worldPos(rig.arms.r.end);
    expect(handR.x).toBeCloseTo(-handL.x, 3);
    expect(handR.y).toBeCloseTo(handL.y, 3);
    expect(handR.z).toBeCloseTo(handL.z, 3);
  });
});
