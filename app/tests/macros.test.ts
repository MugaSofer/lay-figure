import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ageToYears, defaultMacros, macroStack, yearsToAge, type MacroSettings } from '../src/body/macros';

const cases: { settings: Partial<MacroSettings>; stack: Record<string, number> }[] =
  JSON.parse(readFileSync(join(__dirname, 'fixtures', 'macro_stacks.json'), 'utf8'));

describe('macro sliders', () => {
  it('match the pipeline (Python) implementation exactly', () => {
    for (const c of cases) {
      const s = { ...defaultMacros(), ...c.settings, race: { ...defaultMacros().race, ...(c.settings.race ?? {}) } };
      const ours = macroStack(s);
      expect([...ours.keys()].sort()).toEqual(Object.keys(c.stack).sort());
      for (const [k, w] of ours) expect(w).toBeCloseTo(c.stack[k], 12);
    }
  });
  it('convert age years both ways', () => {
    for (const y of [1, 11, 18, 25, 40, 90]) expect(ageToYears(yearsToAge(y))).toBeCloseTo(y, 9);
    expect(ageToYears(0.5)).toBe(25);
  });
});
