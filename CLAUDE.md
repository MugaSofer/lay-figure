# Lay Figure — notes for Claude sessions

Browser-based posable figure for drawing reference. Spec: `Lay Figure — design brief.md`
(currently local only, not committed). Personal/environment notes live in `CLAUDE.local.md` (git-ignored).

## Status
Phase 0 (spikes A/B/C). Hard stop after Phase 0 for the art director's go-ahead.

## Layout
```
app/            Vite + TypeScript + Three.js app
pipeline/       Python + headless Blender asset conversion (no bash-only scripts)
assets-src/     raw downloads (git-ignored)
adult/          adult pack sources/builds (git-ignored; never on GitHub)
public/assets/  built glTF, textures, pose library
review/         regression screenshots per milestone
```

## Conventions
- Repo is PUBLIC. `.githooks/pre_commit.py` blocks raw/adult paths, raw formats, files >5 MB,
  and public/assets changes without ASSETS.md. Enable on a fresh clone: `git config core.hooksPath .githooks`.
- Every shipped asset: licence verified at primary source, logged in ASSETS.md. Ambiguous → ask.
- Engineering calls go in DECISIONS.md (date, decision, why, alternatives).
- Small commits, one concern each.

## Tools
- Blender 4.5: `C:\Program Files\Blender Foundation\Blender 4.5\blender.exe` (not on PATH).
- Phone testing: SFW builds via GitHub Pages; adult pack and fast iteration via USB +
  `chrome://inspect` port forwarding (phone sees `localhost`, a secure context).
