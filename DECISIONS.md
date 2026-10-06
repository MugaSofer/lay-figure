# Decisions

| Date | Decision | Why | Alternatives considered |
| --- | --- | --- | --- |
| 2026-10-06 | Public GitHub repo from day one, guarded by a pre-commit hook | Pages gives HTTPS + real PWA install on the phone anywhere; open from the start | Private repo + LAN dev server (safer against asset slips, but no free Pages) |
| 2026-10-06 | Adult pack developed and tested locally only (git-ignored `adult/`), served to phone via USB port forwarding | Brief bars it from GitHub; `localhost` over USB is a secure context so SW/PWA still work | LAN HTTP (no secure context), self-signed HTTPS (cert install on Android is fiddly) |
| 2026-10-06 | Pre-commit check written in Python behind a 2-line sh shim | Runs identically on Windows (Git for Windows runs hooks via sh) without bash logic | Pure sh hook (brief discourages bash-only scripts) |
| 2026-10-06 | Spike glTF compressed with gltfpack (meshopt, `-cc`) | 1.6 MB raw → 193 KB gzip on the wire (275 KB with morph normals); three.js ships the decoder | Draco (no morph target support), uncompressed + gzip (850 KB) |
| 2026-10-06 | Spikes live in `spikes/<letter>-<name>/`, built and deployed to Pages by `.github/workflows/pages.yml` | Throwaway code kept apart from `app/`; phone testing over HTTPS | Separate repo/branch |
| 2026-10-06 | Recommend Optimized Centers of Rotation skinning plus auto-generated corrective-smooth shapes (pending art director) | Best of five methods in Spike B renders: keeps volume without DQS bulges; LBS-like shader cost | LBS+CS (thinner at shoulder/hip), DQS (bulges), runtime corrective smooth (40 ms/pose on laptop, too slow mid-drag on phone) |
| 2026-10-06 | Touch IK: elbow swivel chosen by minimum change from last frame, plus relaxed-pose pull and penalties; joints capped at 15 deg per update with per-frame re-solve | Removes flips found by an automated drag-path jitter test (about 2,000 jumps before) | Swivel from the elbow position (flips near a straight arm); hard limit-satisfying swivel search (branch switching) |
| 2026-10-06 | Body push-out uses a smooth distance field of body capsules, not a raycast | Raycast push was discontinuous at silhouettes and caused jumps | Mesh raycast |
| 2026-10-06 | Recommend MakeHuman CC0 over MHR, SOMA-X and Anny (pending art director) | MHR has toeless feet and no named sliders; Anny is the same mesh; SOMA-X has licence questions and no sliders | MHR, SOMA-X, Anny, GHUM (academic only) |
