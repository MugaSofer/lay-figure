import { describe, expect, it } from 'vitest';
import { makePose, migrateScene, sceneFromHash, sceneToHash, SCENE_VERSION, type SceneData } from '../src/io/scene';

const scene = (): SceneData => ({
  version: SCENE_VERSION,
  figures: [{
    body: { macros: { gender: 0.2, age: 0.6 }, race: { african: 0.5, asian: 0.2, caucasian: 0.3 } },
    pose: makePose(['Root', 'pelvis', 'thigh_l'], [[0, 0, 0, 1], [0.1234567, 0, 0, 0.99235], [0, 0, 0, 1]], [0, -0.123456789, 0.02], [0, 0, 0, 1]),
    hidden: ['hand_l'],
  }],
  props: [], lights: { key: { dir: [0, 1, 0], intensity: 2 }, ambient: 0.8 },
  camera: { target: [0, 1, 0], radius: 4, theta: 0.3, phi: 1.4, focal: 50 },
  view: { mode: 'shaded', limits: true },
});

describe('scene serialisation', () => {
  it('rounds once and leaves identity joints out', () => {
    const p = scene().figures[0].pose;
    expect(p.joints.pelvis[0]).toBe(0.12346);
    expect(p.joints.thigh_l).toBeUndefined();
    expect(p.root.pos[1]).toBe(-0.12346);
  });
  it('round-trips exactly through a share URL hash', async () => {
    const s = scene();
    const back = await sceneFromHash('#' + (await sceneToHash(s)));
    expect(back).toEqual(s);
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
  });
  it('round-trips exactly through JSON', () => {
    const s = scene();
    expect(migrateScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('rejects newer or foreign data clearly', () => {
    expect(() => migrateScene({ version: SCENE_VERSION + 1 })).toThrow(/newer/);
    expect(() => migrateScene({ hello: 1 })).toThrow(/not a Lay Figure scene/);
  });
  it('ignores hashes that are not scenes', async () => {
    expect(await sceneFromHash('#about')).toBeNull();
  });
});
