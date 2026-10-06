// MakeHuman macro sliders -> weighted macro targets. A port of pipeline/lay_pipeline/macros.py;
// see that file for how the rules were established. tests/macros.test.ts checks the two agree.

export type Slider = 'gender' | 'age' | 'muscle' | 'weight' | 'height' | 'proportions' | 'cupsize' | 'firmness';
export const RACES = ['african', 'asian', 'caucasian'] as const;
export type Race = (typeof RACES)[number];

export interface MacroSettings {
  gender: number; age: number; muscle: number; weight: number;
  height: number; proportions: number; cupsize: number; firmness: number;
  race: Record<Race, number>;
}

const LEVELS: Record<Slider, [string | null, number][]> = {
  gender: [['female', 0], ['male', 1]],
  age: [['baby', 0], ['child', 0.1875], ['young', 0.5], ['old', 1]],
  muscle: [['minmuscle', 0], ['averagemuscle', 0.5], ['maxmuscle', 1]],
  weight: [['minweight', 0], ['averageweight', 0.5], ['maxweight', 1]],
  height: [['minheight', 0], [null, 0.5], ['maxheight', 1]],
  proportions: [['uncommonproportions', 0], [null, 0.5], ['idealproportions', 1]],
  cupsize: [['mincup', 0], ['averagecup', 0.5], ['maxcup', 1]],
  firmness: [['minfirmness', 0], ['averagefirmness', 0.5], ['maxfirmness', 1]],
};
export const SLIDERS = Object.keys(LEVELS) as Slider[];
const CUTOFF = 0.01;

export function defaultMacros(): MacroSettings {
  return {
    gender: 0.5, age: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5, cupsize: 0.5, firmness: 0.5,
    race: { african: 0.33, asian: 0.33, caucasian: 0.33 },
  };
}

/** Level weights for one slider: at most two non-zero entries. The null level is "no target". */
export function levelWeights(slider: Slider, value: number): [string | null, number][] {
  const levels = LEVELS[slider];
  const v = 0.01 + 0.98 * Math.min(Math.max(value, 0), 1);
  for (let i = 0; i < levels.length - 1; i++) {
    const [n0, p0] = levels[i], [n1, p1] = levels[i + 1];
    if (v >= p0 && v <= p1) {
      const t = (v - p0) / (p1 - p0);
      return ([[n0, 1 - t], [n1, t]] as [string | null, number][]).filter(([, w]) => w > 0);
    }
  }
  return [];
}

/** {target path relative to targets/: weight} */
export function macroStack(s: MacroSettings): Map<string, number> {
  const W = Object.fromEntries(SLIDERS.map(k => [k, levelWeights(k, s[k])])) as Record<Slider, [string | null, number][]>;
  const out = new Map<string, number>();
  const add = (path: string, w: number) => { if (w >= CUTOFF) out.set(path, (out.get(path) ?? 0) + w); };
  for (const r of RACES) for (const [g, gw] of W.gender) for (const [a, aw] of W.age) add(`macrodetails/${r}-${g}-${a}`, s.race[r] * gw * aw);
  for (const [a, aw] of W.age) for (const [m, mw] of W.muscle) for (const [wt, ww] of W.weight) {
    const amw = aw * mw * ww;
    for (const [g, gw] of W.gender) {
      add(`macrodetails/universal-${g}-${a}-${m}-${wt}`, gw * amw);
      for (const [h, hw] of W.height) if (h) add(`macrodetails/height/${g}-${a}-${m}-${wt}-${h}`, gw * amw * hw);
      if (a !== 'baby') for (const [p, pw] of W.proportions) if (p) add(`macrodetails/proportions/${g}-${a}-${m}-${wt}-${p}`, gw * amw * pw);
    }
    if (a !== 'baby') for (const [c, cw] of W.cupsize) for (const [f, fw] of W.firmness) {
      if (!(c === 'averagecup' && f === 'averagefirmness')) add(`breast/female-${a}-${m}-${wt}-${c}-${f}`, amw * cw * fw);
    }
  }
  return out;
}

// --- user-facing age: years <-> slider (MakeHuman's age levels sit at 1, 11, 25 and 90 years) ---
const AGE_KNOTS: [number, number][] = [[0, 1], [0.1875, 11], [0.5, 25], [1, 90]];
export function ageToYears(a: number) {
  for (let i = 1; i < AGE_KNOTS.length; i++) {
    const [s0, y0] = AGE_KNOTS[i - 1], [s1, y1] = AGE_KNOTS[i];
    if (a <= s1) return y0 + ((a - s0) / (s1 - s0)) * (y1 - y0);
  }
  return 90;
}
export function yearsToAge(y: number) {
  for (let i = 1; i < AGE_KNOTS.length; i++) {
    const [s0, y0] = AGE_KNOTS[i - 1], [s1, y1] = AGE_KNOTS[i];
    if (y <= y1) return s0 + ((y - y0) / (y1 - y0)) * (s1 - s0);
  }
  return 1;
}
