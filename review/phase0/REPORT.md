# Phase 0 report

2026-10-06, revised the same evening after the art director's first review. Three throwaway spikes, each answering one question from the brief. What I need from you is collected at the bottom.

Live spikes: https://mugasofer.github.io/lay-figure/

---

## A. Base body

### What the first version got wrong

The first viewer mangled the body. MakeHuman's main sliders (sex, age, weight, muscle and so on) are "macros": the default body already contains half of each, so the viewer added them a second time at full strength. It also posed the figure with guessed bone angles. My seam check only proved the mesh doesn't *tear*; it never checked that the body looked right. That's fixed now.

The viewer now uses real MakeHuman bodies. MPFB evaluates MakeHuman's own macro maths in Blender for 11 presets (female, male, heavy, slim, muscular, soft, older, tall, short, idealised, larger cup). Each is stored as one shape relative to the default body, and the pose aims limbs at real directions.

![Body presets at rest](A_bodies_rest.jpg)

*Left to right: default, female, male, male + muscular, female + heavy + older, female + slim + idealised, male + heavy + soft, female + pregnant.*

![Body presets posed](A_bodies_posed.jpg)

Blending presets linearly only *approximates* MakeHuman's macro maths. That's fine for judging the body, but the real app ports the proper maths (see the recommendation). "Tall" and "short" will pose slightly off in this viewer, because the skeleton stays fitted to the default body; the real app refits bones to each body, as MakeHuman does. Over the wire it's 444 KB, including 24 local modifiers.

### Anny, and better alternatives

A second research pass compared every permissively licensed human model it could find, with licences checked at the source.

- **Anny is MakeHuman's exact mesh.** The content hash of `base.obj` matches, and so do all 1,481 shared data files, including every morph. Anny's renders look better because they're nicely lit Cycles clay renders of well-chosen bodies in mocap poses. We can match that look in Three.js; it's a rendering job, not a choice of model. Anny's genuinely better part is its cleaned skin weights (Apache 2.0, same vertex order), which we can borrow.
- **Meta MHR** (Apache 2.0; I verified the `LICENSE.txt` in the release myself): a realistic scan-derived surface, learned pose corrections and 72 facial expressions. I rendered it beside MakeHuman:

![MakeHuman (left) vs MHR (right)](A_makehuman_vs_mhr.jpg)

*MHR mesh © Meta Platforms, Apache License 2.0. Rendered for comparison only; not shipped.*

  It has a nice surface, but **toeless "sock" feet** and a smoothed-over torso and groin. For drawing reference, the feet alone rule it out as the base body. It also has no named sliders (no weight, muscle or age controls). Its learned pose corrections might still be worth borrowing later.
- **NVIDIA SOMA-X** (Apache 2.0): about 18,000 vertices, mostly quads, with corrections derived from MHR. It also has no named sliders, and it's very new. Its licence raises questions (some of its training data came from a GPL dataset, and it redistributes SMPL meshes), so I'd stay away for now.
- **Out:**
  - Google GHUM: academic licence only. My earlier lead was wrong.
  - ATLAS: never released.
  - MB-Lab and CharMorph's MB-Lab characters: AGPL.
  - CharMorph's "Vitruvian": the licence documentation is ambiguous.
  - Others: no licence, GPL or paid.

### Recommendation

1. **Use the CC0 MakeHuman body.** It's the only clean option with toes, readable anatomy and the exact slider set the brief asks for.
2. **Read MakeHuman's data files directly in our own pipeline.** They're simple text formats. This keeps MPFB2's GPL code out of our pipeline, so the code-licence question stays open.
3. **Shape the body on the phone's processor, not with GPU morphs.** Port MakeHuman's macro maths to TypeScript and ship the targets as compact files, lazy-loaded. A slider change re-sums the active targets, recomputes normals and refits the bones. This is the brief's "bake the body when shape editing ends", made the default.
4. **Build a custom rig:** `game_engine` (53 bones) plus the twist segments from MakeHuman's `default` rig. Compare Anny's cleaned weights in M1.
5. **Match Anny's look with lighting, not a different model:** soft key light, contact shadows (already in the brief), and a clay material.

---

## B. Joint deformation

You agreed LBS+CS looked best and asked whether anything is better. Yes. **Optimised Centres of Rotation (CoR)** (Le & Hodgins, Disney Research, 2016) is a published method for exactly this problem:

- For each vertex, precompute a "centre of rotation" from how similarly nearby triangles are weighted to bones.
- At pose time, rotate the vertex around that centre with a blended rotation.
- It avoids LBS's collapse and DQS's bulge, and costs about the same as LBS in the vertex shader. The precompute took 6 s on the laptop, a pipeline step.

My implementation reproduces Blender's LBS to within 0.0002 mm, so the comparison is fair. All five methods:

![Shoulder](B_shoulder.jpg)
![Elbow](B_elbow.jpg)
![Wrist](B_wrist.jpg)
![Hip](B_hip.jpg)
![Knee](B_knee.jpg)

My read:

- **CoR + Corrective Smooth is the best of the five.**
  - At the shoulder at 170°, it keeps the volume LBS+CS loses, without DQS's lump.
  - At the knee at 150°, it's the only method besides DQS without a fold line at the back, and it's smoother than DQS.
  - At the hip, it keeps the thigh's volume without ballooning.
  - At the twisted wrist, it holds the wrist's width.
- **CoR alone** creases oddly at the deep knee, so Corrective Smooth still earns its place.
- **The wrist bent 70° toward the palm** is beaten by every method. That's a weighting problem: better weights (Anny's?) or one hand-sculpted shape.

### Compound poses, several views

You asked for more angles and viewpoints before locking this in, and you were right to. The sheets above test one joint at a time, mostly from one side.

This set uses 14 compound poses close to the brief's regression scenes, each seen from three sides including the back, with the four contenders side by side. A hinge-aware posing helper keeps knees and elbows bending in their natural plane, so a bad pose can't masquerade as bad skinning.

| Pose | Best | Notes |
| --- | --- | --- |
| Arms overhead | **CoR+CS** | DQS lumps at the shoulders and armpits; LBS thins the armpits; LBS+CS creases across the shoulder blades |
| Deep crouch | **CoR+CS** | From behind, LBS flattens the buttocks and DQS balloons them |
| Leg out sideways, leg back | **CoR+CS** (DQS close) | LBS creases hard at the groin and the buttock fold |
| Head turn | **CoR+CS** | LBS+CS gives the neck odd cord-like ridges |
| Forward reach | **LBS+CS** | From the side, CoR+CS puts a soft lump under the armpit, a milder version of DQS's |
| Cross-legged sit | debatable | CoR+CS and DQS show a sharp horizontal crease across the lower belly; LBS+CS stays rounder |
| Hand on hip, arms crossed, upper-arm twist in and out, forward bend, twist plus side bend, deep elbow, wrist extension | little difference | |

![Arms overhead](B_ext_arms_overhead.jpg)
![Forward reach](B_ext_reach_forward.jpg)
![Arms crossed](B_ext_arms_crossed.jpg)
![Hand on hip](B_ext_hand_on_hip.jpg)
![Upper-arm twist, inward](B_ext_arm_twist_in.jpg)
![Upper-arm twist, outward](B_ext_arm_twist_out.jpg)
![Deep crouch](B_ext_deep_crouch.jpg)
![Cross-legged](B_ext_cross_legged.jpg)
![Leg out sideways](B_ext_leg_side.jpg)
![Leg back](B_ext_leg_back.jpg)
![Forward bend](B_ext_forward_bend.jpg)
![Twist and side bend](B_ext_twist_sidebend.jpg)
![Head turn](B_ext_head_turn.jpg)
![Deep elbow](B_ext_elbow_deep.jpg)
![Wrist extension](B_ext_wrist_ext.jpg)

*Notes on the sheets: the hip and crouch poses keep the pelvis fixed, so the figure floats. Limbs pass through each other because there's no collision until M4. The light patches across shoulders are shadows cast by raised arms.*

**Where that leaves it:** CoR+CS is still my pick on balance, but it isn't a clean sweep. It has two known weak spots, the armpit in a forward reach and the lower-belly crease when sitting cross-legged. The pipeline's corrective shapes would target exactly those. CoR also has a tuning knob (how widely each vertex's centre of rotation is averaged), and it can be blended back toward LBS per body region. Either could soften the armpit. I'd tune that in M1, against these same sheets.

**Recommendation:**

- **CoR skinning in the vertex shader.** It replaces Three.js's default LBS: one extra per-vertex attribute plus a custom skinning chunk.
- **Pose-driven corrective shapes generated automatically per body.** When shape editing ends, a Web Worker runs Corrective Smooth at a few key angles per joint and stores the results as shapes that joint angles drive.
- **Twist bones** for the forearm and upper arm.
- **Hand-sculpted shapes** only for what's left (wrist flexion, groin).

---

## C. Touch posing

Prototype: https://mugasofer.github.io/lay-figure/spikes/c-touch/

**Your phone test:** it all feels great, at a steady 60 fps (dipping to 41 briefly while loading). That's a good sign for one figure; two full bodies with shadows is the real test, in M1.

**Fixed: no way out of rotation rings.** Tapping empty space was meant to close them, but finger jitter counted as an orbit. Taps now get 10 px of slack, tapping the part again closes the rings, and a **Done** button appears.

**Fixed: IK vibration and teleporting.** I reproduced it with a test that drags along 150 paths in 3–4 px steps and flags any joint that turns more than 8° in one step. It found about 2,000 jumps, from five separate causes:

1. **The elbow's swivel flipped near a straight arm.** It was worked out from the elbow's position each frame, which becomes undefined as the arm straightens. **Fix:** choose the swivel whose shoulder rotation is closest to last frame's, with a gentle pull toward a relaxed elbow, and limits and body contact as penalties.
2. **The "hold hand" twist wrapped at 180°**, so the forearm snapped the other way. **Fix:** unwrap the twist so it stays continuous.
3. **The wrist limit could jump between its extremes.** **Fix:** clamp to a smooth ellipse in rotation space, so there's no edge to flip across.
4. **The push-out from the body was discontinuous at the silhouette,** because it used a raycast. **Fix:** a smooth distance field built from the body's capsules.
5. **The 10 px drag threshold was applied all at once,** and near a straight arm, 1 cm of hand movement bends the elbow about 25°. **Fix:** measure drags from the point where they begin.

On top of those, every joint is capped at 15° per update, and the IK re-solves each frame while your finger is down. A genuine big change, like the elbow switching sides at a limit, now plays out as a quick swing instead of a jump.

**Vibration** is the arm still moving after your finger stops. A second test pauses every 10 steps and checks the arm settles within 400 ms:

| Version | Pauses that didn't settle |
| --- | --- |
| After the five fixes above | 22 of 1,998 |
| Continuity measured against the solver's own unclamped answer (the solver and the limits had been fighting) | 8 of 1,998 |
| The drift toward a relaxed elbow only acts while your finger moves | 0 of 456 on the paths that failed before (full re-run: 1 of 1,998, a slow 1° per frame glide with limits off) |

No single frame now moves a joint more than about 21°, so there are no teleports.

**S Pen:** basic pen input works, since it arrives as an ordinary pointer. Hover and the side button didn't work on your battered pen; I'll come back to them once a working pen can show what Chrome on the Note 9 actually reports.

---

## Proposed target revisions

- **First load:** propose **under 8 MB**, down from 25. The body is about 0.5 MB with presets, Three.js about 0.7 MB, and targets lazy-load.
- **30 fps with two figures on the Note 9:** one arm runs at 60 fps. I'll measure the real case early in M1.

## Licensing questions

None blocks M1.

1. **Code licence:** still open. Recommendation A2 keeps every option available.
2. **Adult pack genitals:** most community genital assets are AGPL. The clean CC0 options are simplified only. No clearly clean CC0 asset gives anatomically complete female genitalia, so we'd likely sculpt our own (after M5).
3. **Anatomy pack:** Z-Anatomy and BodyParts3D are CC BY-SA, so a fitted pack would stay BY-SA forever as a separate download. **New option:** Blender Studio's Human Base Meshes bundle (CC0) includes a full realistic skeleton, which would avoid share-alike for the bones layer.
4. **CT-derived Sketchfab skeleton:** carries a "NoAI" flag, so I propose excluding it.
5. **jwc's "Skeleton" asset:** claims a CC0 source that's gone. Moot if (3)'s CC0 skeleton works.
6. **Apache notices:** borrowing Anny's weights (or anything from MHR) means shipping the Apache 2.0 notice and credits. That's routine.

## What I need from you to leave Phase 0

1. **A:** go or no-go on the MakeHuman body, read directly, shaped on the phone's processor. Have a play with the fixed viewer first: https://mugasofer.github.io/lay-figure/spikes/a-body/
2. **B:** does CoR + Corrective Smooth look right to you?
3. **C:** a re-test of the IK on your phone.
