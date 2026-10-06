# Decisions

| Date | Decision | Why | Alternatives considered |
| --- | --- | --- | --- |
| 2026-10-06 | Public GitHub repo from day one, guarded by a pre-commit hook | Pages gives HTTPS + real PWA install on the phone anywhere; open from the start | Private repo + LAN dev server (safer against asset slips, but no free Pages) |
| 2026-10-06 | Adult pack developed and tested locally only (git-ignored `adult/`), served to phone via USB port forwarding | Brief bars it from GitHub; `localhost` over USB is a secure context so SW/PWA still work | LAN HTTP (no secure context), self-signed HTTPS (cert install on Android is fiddly) |
| 2026-10-06 | Pre-commit check written in Python behind a 2-line sh shim | Runs identically on Windows (Git for Windows runs hooks via sh) without bash logic | Pure sh hook (brief discourages bash-only scripts) |
| 2026-10-06 | Spike glTF compressed with gltfpack (meshopt, `-cc`) | 1.6 MB raw → 193 KB gzip on the wire (275 KB with morph normals); three.js ships the decoder | Draco (no morph target support), uncompressed + gzip (850 KB) |
| 2026-10-06 | Spikes live in `spikes/<letter>-<name>/`, built and deployed to Pages by `.github/workflows/pages.yml` | Throwaway code kept apart from `app/`; phone testing over HTTPS | Separate repo/branch |
| 2026-10-06 | Recommend Optimized Centers of Rotation skinning plus auto-generated corrective-smooth shapes (approved 2026-10-06) | Best of five methods in Spike B renders: keeps volume without DQS bulges; LBS-like shader cost | LBS+CS (thinner at shoulder/hip), DQS (bulges), runtime corrective smooth (40 ms/pose on laptop, too slow mid-drag on phone) |
| 2026-10-06 | Touch IK: elbow swivel chosen by minimum change from last frame, plus relaxed-pose pull and penalties; joints capped at 15 deg per update with per-frame re-solve | Removes flips found by an automated drag-path jitter test (about 2,000 jumps before) | Swivel from the elbow position (flips near a straight arm); hard limit-satisfying swivel search (branch switching) |
| 2026-10-06 | Body push-out uses a smooth distance field of body capsules, not a raycast | Raycast push was discontinuous at silhouettes and caused jumps | Mesh raycast |
| 2026-10-06 | Recommend MakeHuman CC0 over MHR, SOMA-X and Anny (approved 2026-10-06) | MHR has toeless feet and no named sliders; Anny is the same mesh; SOMA-X has licence questions and no sliders | MHR, SOMA-X, Anny, GHUM (academic only) |
| 2026-10-06 | Phase 0 closed; art director approved all recommendations. M1 begins | Spikes A/B/C answered their questions | n/a |
| 2026-10-06 | Own implementation of MakeHuman macro sliders, fitted black-box to MPFB output (not derived from GPL code or MPFB's macro config) | Keeps GPL out; the fit gives an exact default body and single sliders within 7 mm, random mixes median 5 mm | Port MPFB's code (GPL), ship MPFB-evaluated presets only (no continuous sliders) |
