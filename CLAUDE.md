# Lay Figure — notes for Claude sessions

Browser-based posable figure for drawing reference. Spec: `Lay Figure — design brief.md`
(currently local only, not committed). Personal/environment notes live in `CLAUDE.local.md` (git-ignored).

## Status
Phase 0 done (report: `review/phase0/REPORT.md`, all recommendations approved 2026-10-06). Now on **M1 Mannequin**.
Key decisions carried into M1: MakeHuman CC0 data read directly (no MPFB code in the pipeline), body shaped on CPU
(own implementation of the macro maths), bones refit per body, CoR skinning + auto corrective shapes, touch IK
design from spike C (`spikes/c-touch/src/main.ts`: swivel continuity, smooth limits, SDF push-out, rate cap).

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
