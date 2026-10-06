"""MakeHuman macro sliders -> weighted list of macro target files.

Written from the target files' naming scheme and fitted black-box against MPFB's output
(pipeline/oracle). It does not use MakeHuman's or MPFB's code or their macro config file, which
are GPL; the targets themselves are CC0. Rules, as measured:

- Slider values in [0, 1] are first rescaled linearly into [0.01, 0.99].
- A slider maps to weights over its named levels by piecewise-linear interpolation between the
  levels' positions. A macro target's weight is the product of its levels' weights.
- Race weights are used as given (not normalised; the default is 0.33 each).
- Breast targets are named "female-..." but carry no gender factor.
- Targets whose final weight is below 0.01 are dropped.

Parity with MPFB (pipeline/oracle/compare_macros.py, 63 bodies): default body exact; single-slider
sweeps within 7 mm (height at mid values is the worst); random mixes median 5 mm, worst 25 mm.
The rest is MPFB-specific mixing we couldn't pin down black-box; our bodies remain MakeHuman bodies.
"""
from itertools import product

# Level positions on each slider. A level of None means "no target" (the neutral shape).
LEVELS = {
    "gender": [("female", 0.0), ("male", 1.0)],
    "age": [("baby", 0.0), ("child", 0.1875), ("young", 0.5), ("old", 1.0)],
    "muscle": [("minmuscle", 0.0), ("averagemuscle", 0.5), ("maxmuscle", 1.0)],
    "weight": [("minweight", 0.0), ("averageweight", 0.5), ("maxweight", 1.0)],
    "height": [("minheight", 0.0), (None, 0.5), ("maxheight", 1.0)],
    "proportions": [("uncommonproportions", 0.0), (None, 0.5), ("idealproportions", 1.0)],
    "cupsize": [("mincup", 0.0), ("averagecup", 0.5), ("maxcup", 1.0)],
    "firmness": [("minfirmness", 0.0), ("averagefirmness", 0.5), ("maxfirmness", 1.0)],
}
RACES = ("african", "asian", "caucasian")
DEFAULTS = {k: 0.5 for k in LEVELS} | {"race": {r: 0.33 for r in RACES}}
CUTOFF = 0.01


def level_weights(slider, value):
    """{level name: weight} for one slider value; at most two non-zero entries."""
    levels = LEVELS[slider]
    value = 0.01 + 0.98 * min(max(value, 0.0), 1.0)
    out = {}
    for (n0, p0), (n1, p1) in zip(levels, levels[1:]):
        if p0 <= value <= p1:
            t = (value - p0) / (p1 - p0)
            out[n0] = out.get(n0, 0.0) + (1 - t)
            out[n1] = out.get(n1, 0.0) + t
            break
    return {k: v for k, v in out.items() if v > 0}


def macro_stack(settings):
    """settings: dict like DEFAULTS (missing keys take defaults).
    Returns {target path relative to targets/, without extension: weight}."""
    s = DEFAULTS | {k: v for k, v in settings.items() if k != "race"}
    race = dict(DEFAULTS["race"], **settings.get("race", {}))
    W = {k: level_weights(k, s[k]) for k in LEVELS}
    stack = {}

    def add(path, w):
        if w >= CUTOFF:
            stack[path] = stack.get(path, 0.0) + w

    for (r, rw), (g, gw), (a, aw) in product(race.items(), W["gender"].items(), W["age"].items()):
        add(f"macrodetails/{r}-{g}-{a}", rw * gw * aw)
    for (a, aw), (m, mw), (wt, ww) in product(W["age"].items(), W["muscle"].items(), W["weight"].items()):
        amw = aw * mw * ww
        for g, gw in W["gender"].items():
            add(f"macrodetails/universal-{g}-{a}-{m}-{wt}", gw * amw)
            for h, hw in W["height"].items():
                if h:
                    add(f"macrodetails/height/{g}-{a}-{m}-{wt}-{h}", gw * amw * hw)
            if a != "baby":
                for p, pw in W["proportions"].items():
                    if p:
                        add(f"macrodetails/proportions/{g}-{a}-{m}-{wt}-{p}", gw * amw * pw)
        if a != "baby":
            for (c, cw), (f, fw) in product(W["cupsize"].items(), W["firmness"].items()):
                if not (c == "averagecup" and f == "averagefirmness"):
                    add(f"breast/female-{a}-{m}-{wt}-{c}-{f}", amw * cw * fw)
    return stack
