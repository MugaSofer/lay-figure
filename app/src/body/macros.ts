// MakeHuman macro sliders -> weighted macro targets. A port of pipeline/lay_pipeline/macros.py;
// see that file for how the rules were established. tests/macros.test.ts checks the two agree.

export type Slider = 'gender' | 'age' | 'muscle' | 'weight' | 'height' | 'proportions' | 'cupsize' | 'firmness';
export const RACES = ['african', 'asian', 'caucasian'] as const;
export type Race = (typeof RACES)[number];

export interface MacroSettings {
  gender: number; age: number; muscle: number; weight: number;
  height: number; proportions: number; cupsize: number; firmness: number;
  race: Record<Race, number>;
  /** Local modifiers by id (see LOCAL_MODIFIERS), -1..1; missing = 0. */
  local?: Record<string, number>;
  /** Muscle past 100% also adds mass (default true); false keeps it lean. */
  muscleMass?: boolean;
}

/** Sliders that may go past MakeHuman's range. Only muscle, and only its own shapes are extrapolated
 *  (see macroStack); the height, proportion and breast families stay at their MakeHuman maximum. */
export const EXTENDED_MAX: Partial<Record<Slider, number>> = { muscle: 1.5 };

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
    local: {},
    muscleMass: true,
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
  // signed add, for extrapolation (a negative weight subtracts a shape)
  const addSigned = (path: string, w: number) => { if (Math.abs(w) >= CUTOFF) out.set(path, (out.get(path) ?? 0) + w); };
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
  // Muscle past MakeHuman's maximum: carry on along (max-muscle shape - average-muscle shape), for the
  // universal targets only. Within range the max-muscle weight runs 0..0.98; past it, 1.96 per unit.
  const extra = Math.max(0, Math.min(s.muscle, EXTENDED_MAX.muscle ?? 1) - 1) * 1.96;
  if (extra > 0) {
    for (const [a, aw] of W.age) for (const [wt, ww] of W.weight) for (const [g, gw] of W.gender) {
      const k = extra * gw * aw * ww;
      addSigned(`macrodetails/universal-${g}-${a}-maxmuscle-${wt}`, k);
      addSigned(`macrodetails/universal-${g}-${a}-averagemuscle-${wt}`, -k);
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

// ---------- local modifiers (MakeHuman's per-region targets) ----------
export interface LocalModifier {
  id: string; label: string; group: 'muscle' | 'fat';
  /** target path with {s} for side (l and r both applied) and {d} for direction (decr/incr) */
  target: string;
  min: number; // 0 for one-directional modifiers
}
export const LOCAL_MODIFIERS: LocalModifier[] = [
  { id: 'shoulders', label: 'Shoulders', group: 'muscle', target: 'arms/{s}-upperarm-shoulder-muscle-{d}', min: -1 },
  { id: 'upperarms', label: 'Upper arms', group: 'muscle', target: 'arms/{s}-upperarm-muscle-{d}', min: -1 },
  { id: 'forearms', label: 'Forearms', group: 'muscle', target: 'arms/{s}-lowerarm-muscle-{d}', min: -1 },
  { id: 'chest', label: 'Chest', group: 'muscle', target: 'torso/torso-muscle-pectoral-{d}', min: -1 },
  { id: 'lats', label: 'Back (lats)', group: 'muscle', target: 'torso/torso-muscle-dorsi-{d}', min: -1 },
  { id: 'vshape', label: 'V-taper', group: 'muscle', target: 'torso/torso-vshape-{d}', min: -1 },
  { id: 'abs', label: 'Stomach tone', group: 'muscle', target: 'stomach/stomach-tone-{d}', min: -1 },
  { id: 'thighs', label: 'Thighs', group: 'muscle', target: 'legs/{s}-upperleg-muscle-{d}', min: -1 },
  { id: 'calves', label: 'Calves', group: 'muscle', target: 'legs/{s}-lowerleg-muscle-{d}', min: -1 },
  { id: 'fat-upperarms', label: 'Upper arms', group: 'fat', target: 'arms/{s}-upperarm-fat-{d}', min: -1 },
  { id: 'fat-forearms', label: 'Forearms', group: 'fat', target: 'arms/{s}-lowerarm-fat-{d}', min: -1 },
  { id: 'fat-thighs', label: 'Thighs', group: 'fat', target: 'legs/{s}-upperleg-fat-{d}', min: -1 },
  { id: 'fat-calves', label: 'Calves', group: 'fat', target: 'legs/{s}-lowerleg-fat-{d}', min: -1 },
  { id: 'buttocks', label: 'Buttocks', group: 'fat', target: 'buttocks/buttocks-volume-{d}', min: -1 },
  { id: 'hips', label: 'Hip width', group: 'fat', target: 'hip/hip-scale-horiz-{d}', min: -1 },
  { id: 'waist', label: 'Waist', group: 'fat', target: 'torso/measure-waist-circ-{d}', min: -1 },
  { id: 'chin', label: 'Double chin', group: 'fat', target: 'neck/neck-double-{d}', min: -1 },
  { id: 'pregnancy', label: 'Pregnancy', group: 'fat', target: 'stomach/stomach-pregnant-{d}', min: 0 },
];

/** Local targets and weights, named "local:<path>". Muscle past MakeHuman's maximum also ramps every
 *  muscle group up, since the macro shape alone only goes so far. */
export function localStack(s: MacroSettings): Map<string, number> {
  const out = new Map<string, number>();
  const boost = Math.max(0, s.muscle - 1) * 2; // 0 at MakeHuman's max, 1 at the extended max
  for (const m of LOCAL_MODIFIERS) {
    const v = (s.local?.[m.id] ?? 0) + (m.group === 'muscle' && m.id !== 'abs' ? boost : 0);
    if (Math.abs(v) < 1e-3) continue;
    const d = v > 0 ? 'incr' : 'decr';
    for (const side of m.target.includes('{s}') ? ['l', 'r'] : ['']) {
      out.set(`local:${m.target.replace('{s}', side).replace('{d}', d)}`, Math.abs(v));
    }
  }
  return out;
}

/** Weight as MakeHuman sees it. In MakeHuman, weight on a muscular body is mass rather than fat, and big
 *  muscles need it: with "muscle adds mass" on, muscle past 100% raises it, reaching halfway from the
 *  user's weight to the maximum at the extended muscle maximum (the user's Weight slider is unchanged). */
export function effectiveWeight(s: MacroSettings) {
  if (s.muscleMass === false) return s.weight;
  const e = Math.max(0, Math.min(s.muscle, EXTENDED_MAX.muscle ?? 1) - 1) / ((EXTENDED_MAX.muscle ?? 1.5) - 1);
  return s.weight + (1 - s.weight) * 0.5 * e;
}

/** Everything that shapes the body: macros and local modifiers. */
export function bodyStack(s: MacroSettings): Map<string, number> {
  return new Map([...macroStack({ ...s, weight: effectiveWeight(s) }), ...localStack(s)]);
}
