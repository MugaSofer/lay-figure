import { beforeAll, describe, expect, it } from 'vitest';
import type { Figure } from '../src/body/figure';
import { defaultMacros, type MacroSettings } from '../src/body/macros';
import { makeFigure } from './helpers';

// Muscle past MakeHuman's maximum must add muscle, and about the same amount whatever the other sliders
// say. (It once extrapolated the height and proportion families too, so at non-default heights the extra
// "muscle" was mostly the body resizing by tens of centimetres, and the muscle seemed to come and go.)
let fig: Figure;
beforeAll(async () => { fig = await makeFigure(); }, 30000);

async function extraMuscleMm(base: Partial<MacroSettings>) {
  const shape = async (muscle: number) => {
    await fig.setMacros({ ...defaultMacros(), ...base, muscle });
    return new Float32Array(fig.shapePositions);
  };
  const a = await shape(1), b = await shape(1.5);
  let t = 0;
  const n = fig.data.meta.bodyVertexCount;
  for (let i = 0; i < n * 3; i++) t += (a[i] - b[i]) ** 2;
  return Math.sqrt(t / n) * 1000;
}

describe('extended muscle', () => {
  it('adds a similar amount of shape whatever the other sliders are', async () => {
    const ref = await extraMuscleMm({});
    expect(ref).toBeGreaterThan(5);
    for (const k of ['gender', 'age', 'weight', 'height', 'proportions', 'cupsize', 'firmness'] as const) {
      for (const v of [0, 1]) {
        const e = await extraMuscleMm({ [k]: v });
        expect(e, `${k}=${v}`).toBeGreaterThan(ref * 0.6);
        expect(e, `${k}=${v}`).toBeLessThan(ref * 1.5);
      }
    }
  }, 120000);

  it('leaves height alone', async () => {
    const top = async (muscle: number) => {
      await fig.setMacros({ ...defaultMacros(), height: 1, muscle });
      return fig.rests[fig.boneIndex.get('head')!].tail.y;
    };
    expect(Math.abs((await top(1.5)) - (await top(1)))).toBeLessThan(0.02);
  }, 60000);
});
