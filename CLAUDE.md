# Lay Figure — notes for Claude sessions

Browser-based posable figure for drawing reference. Spec: `Lay Figure — design brief.md` (local only, git-ignored
by the art director's choice). Personal/environment notes live in `CLAUDE.local.md` (git-ignored).
Live: https://mugasofer.github.io/lay-figure/ (Phase 0 spikes under `/spikes/`).

## Status
- Phase 0 done: `review/phase0/REPORT.md` (all recommendations approved 2026-10-06).
- **M1 Mannequin** built and phone-tested: `review/m1/REPORT.md` (rounds of feedback appended there).
- Joint deformation per Phase 0 plan is complete: CoR skinning + corrective shapes baked per body
  (`body/correctives*.ts`: CPU CoR skin + delta mush at 28 key poses in a worker, RBF-blended morph targets).

## Layout
```
app/            Vite + TypeScript + Three.js app (src/, tests/, scripts/)
pipeline/       Python asset build (lay_pipeline/) + black-box checks against MPFB in Blender (oracle/)
assets-src/     raw downloads (git-ignored): MPFB2 2.0.17 source (CC0 data), MHR (comparison only)
adult/          adult pack sources/builds (git-ignored; never on GitHub)
public/         served as-is: assets/body/ (built by the pipeline), icons/
review/         scenes/*.json (regression poses), <milestone>/ renders + REPORT.md, make_sheet.py
spikes/         Phase 0 throwaway prototypes (deployed under /spikes/)
```

## Commands (Windows; Git Bash or cmd)
- Body assets: `cd pipeline && python -m lay_pipeline.build_body` (needs `assets-src/mpfb2-2.0.17`, ~20 s)
- Macro parity check vs MPFB: `python pipeline/oracle/compare_macros.py` (runs Blender; MPFB extension installed)
- App: `cd app && pnpm dev` (LAN: `--host`), `pnpm build`, `pnpm test` (vitest), `pnpm typecheck`
- Regression: `pnpm build && pnpm scenes` (re-authors review/scenes; only when changing poses deliberately),
  `pnpm review m1` (renders 3 cameras per scene), then `python review/make_sheet.py m1 0.3`
- Deploy: push to main; `.github/workflows/pages.yml` builds the app (site root) and spikes.

## Architecture (app/src)
- `body/` assets loader (gzip-aware), `macros.ts` (MakeHuman macro maths; port of `pipeline/lay_pipeline/macros.py`,
  fitted black-box to MPFB, never derived from GPL code), `shape.ts` (CPU shaping, normals, bone rest frames: C·M, not
  a change of basis), `figure.ts` (SkinnedMesh; rebuilds skeleton per shape; joints stored relative to rest frames),
  `corSkinning.ts` (CoR shader patch), `correctives.ts` / `correctiveKeys.ts` / `correctiveRuntime.ts` / worker
  (corrective shapes), `regions.ts` (hide regions). Body settings also carry `local` modifiers (regional muscle/fat)
  and `muscleMass`; muscle > 100% extrapolates only the universal muscle targets (see macros.ts).
- `pose/` `limits.ts` (anatomical limits in body terms; elbows/knees flex in their rest-bend plane and must agree with
  the solver), `rig.ts` (two-bone IK, aims, hips), `controller.ts` (gestures, undo, rings), `mirror.ts`, `colliders.ts`.
- `view/` stage (focal-length camera, key+ambient, shadows), input routing, GPU picker (flat bone ids!), rings.
- `io/scene.ts` versioned scene/pose JSON + share URLs (`#s1.` + deflate-raw base64url). Round trips are exact
  (numbers rounded once on capture). Add a migration in SCENE_MIGRATIONS whenever the format changes.
- Spike C's IK fixes are load-bearing (swivel continuity vs last unclamped answer, idle no-drift, twist unwrap,
  smooth limits, SDF push-out with start-clearance margin, slop rebase, 15°/update cap + per-frame re-solve).

## Conventions
- Repo is PUBLIC. `.githooks/pre_commit.py` blocks raw/adult paths, raw formats, files >5 MB, and new files in
  public/assets without an ASSETS.md change. Enable on a fresh clone: `git config core.hooksPath .githooks`.
- Every shipped asset: licence verified at primary source, logged in ASSETS.md. Ambiguous → ask.
- Engineering calls go in DECISIONS.md (date, decision, why, alternatives).
- Small commits, one concern each. Look at renders yourself (sliders at extremes, several views) before asking the
  art director to judge anything.
- Heredocs with apostrophes break in this Bash tool; write files with the Write tool instead.

## Tools
- Blender 4.5: `C:\Program Files\Blender Foundation\Blender 4.5\blender.exe` (not on PATH); MPFB2 2.0.17 installed as
  an extension (oracle checks only; MPFB code never runs in the pipeline).
- Playwright uses the installed Chrome (`channel: 'chrome'`), real GPU (Intel UHD 630).
- Phone testing: GitHub Pages (HTTPS, installable); adult pack and fast iteration via USB + `chrome://inspect`.
