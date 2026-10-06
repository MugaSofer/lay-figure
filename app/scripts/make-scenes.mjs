// Author the regression scenes with the app's own posing tools and save them as scene JSON
// (review/scenes/*.json). Run after `pnpm build`:  node scripts/make-scenes.mjs
// The scenes are committed; re-run only to change a pose deliberately.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'review', 'scenes');
mkdirSync(OUT, { recursive: true });

// Each recipe runs in the page with helpers (see setup below). Coordinates: metres, figure faces +Z,
// its left is +X, floor at y = 0.
const RECIPES = {
  'a-pose': () => {},
  contrapposto: ({ hips, arm, leg, turn, at, feet }) => {
    hips([-0.035, -0.02, 0]); // weight onto the right leg
    leg('r', feet.r);
    leg('l', feet.l.clone().add(new feet.l.constructor(0.0, 0.03, 0.09)));
    turn('pelvis', 'z', 6); turn('spine_02', 'z', -5); turn('spine_03', 'z', -5); turn('neck_01', 'z', 4); turn('head', 'y', -8);
    arm('l', at('pelvis', [0.25, -0.12, 0.04]));
    arm('r', at('pelvis', [-0.24, -0.16, -0.02]));
  },
  'deep-crouch': ({ hips, arm, leg, turn, at }) => {
    const fl = at('foot_l'), fr = at('foot_r');
    hips([0, -0.46, -0.08]);
    leg('l', fl); leg('r', fr);
    turn('spine_01', 'x', 18); turn('spine_02', 'x', 12); turn('neck_01', 'x', -15);
    arm('l', at('calf_l', [0.03, 0.12, 0.12], 1)); arm('r', at('calf_r', [-0.03, 0.12, 0.12], 1));
  },
  'arms-overhead': ({ arm, at }) => {
    arm('l', at('head', [0.12, 0.5, 0.04]));
    arm('r', at('head', [-0.12, 0.5, 0.04]));
  },
  'cross-legged': ({ hips, arm, leg, at, V }) => {
    hips([0, -0.68, -0.05]);
    // knees fall outward; each foot tucks under the opposite knee
    leg('l', at('pelvis', [-0.12, -0.16, 0.32]), new V(1, 0.5, 0.25), false);
    leg('r', at('pelvis', [0.12, -0.2, 0.26]), new V(-1, 0.5, 0.25), false);
    arm('l', at('calf_l', [0, 0.05, 0.05], 1)); arm('r', at('calf_r', [0, 0.05, 0.05], 1));
  },
  'hand-on-hip': ({ arm, turn, at, V }) => {
    arm('r', at('pelvis', [-0.19, 0.06, 0.0]), new V(-1, 0.1, -0.3));
    arm('l', at('pelvis', [0.24, -0.15, 0.03]));
    turn('head', 'y', -10);
  },
  'arms-crossed': ({ arm, at }) => {
    // wrists in front of the opposite chest; hands wrap toward the opposite upper arm
    arm('r', at('spine_03', [0.07, 0.0, 0.17]));
    arm('l', at('spine_03', [-0.07, -0.05, 0.22]));
  },
  'foreshortened-reach': ({ arm, turn, at }) => {
    turn('spine_01', 'x', 8); turn('spine_02', 'x', 6);
    arm('r', at('upperarm_r', [0.02, -0.02, 0.62]));
    arm('l', at('pelvis', [0.24, -0.15, 0.03]));
  },
  handshake: ({ arm, at }) => {
    // one figure for now; the second arrives with multiple figures (M4)
    arm('r', at('pelvis', [-0.1, 0.18, 0.34]));
    arm('l', at('pelvis', [0.24, -0.15, 0.03]));
  },
};

const { url, close } = await serve();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(url + '?bare');
await page.waitForFunction(() => window.lay?.app !== undefined, null, { timeout: 60000 });
for (const [name, recipe] of Object.entries(RECIPES)) {
  const scene = await page.evaluate(src => {
    const { app, figure: f, pose } = window.lay;
    const rig = pose.rig;
    const V = f.rootOffset.constructor, Q = f.joints[0].constructor;
    rig.limitsOn = true;
    f.resetPose();
    rig.resetContinuity();
    f.group.updateMatrixWorld(true);
    const bone = n => f.boneIndex.get(n);
    // world point at (bone head + offset), or along the bone (t = 0..1) + offset; read at call time
    const at = (n, off = [0, 0, 0], t = 0) => {
      f.group.updateMatrixWorld(true);
      const b = f.bones[bone(n)];
      return b.localToWorld(new V(0, f.rests[bone(n)].length * t, 0)).add(new V(...off));
    };
    const solve = (limb, target, pole, n = 40) => { for (let k = 0; k < n; k++) rig.solveLimb(limb, target, f.rests[limb.lower].length, pole); };
    const arm = (s, target, pole) => solve(rig.arms[s], target, pole);
    const leg = (s, target, pole, flat = true) => {
      const limb = rig.legs[s];
      const rot = rig.worldQuat(limb.end);
      solve(limb, target.clone(), pole);
      if (flat) rig.holdEnd(limb, rot, { goal: null }, false); // keep the foot flat on the floor
    };
    const hips = d => { f.rootOffset.set(...d); f.applyPose(); };
    const turn = (n, axis, deg) => {
      const i = bone(n);
      const a = { x: new V(1, 0, 0), y: new V(0, 1, 0), z: new V(0, 0, 1) }[axis];
      // rotate about a world axis through the joint
      const w = rig.worldQuat(i);
      rig.setWorld(i, new Q().setFromAxisAngle(a, (deg * Math.PI) / 180).multiply(w));
    };
    // eslint-disable-next-line no-new-func
    const recipe = new Function('h', `return (${src})(h)`);
    // legs keep their feet where they were when the hips move
    const feet = { l: at('foot_l'), r: at('foot_r') };
    recipe({ arm, leg, hips, turn, at, feet, V });
    f.applyPose();
    return app.capture();
  }, recipe.toString());
  scene.camera = { target: [0, 0.9, 0], radius: 4.2, theta: 0.35, phi: 1.45, focal: 50 };
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(scene, null, 1) + '\n');
  console.log('wrote', name);
}
await browser.close();
await close();
