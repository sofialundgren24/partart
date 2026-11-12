# PARTART — owning the logic

Anyone can wrap an image-to-3D API. PARTART's value is the logic between the photo and the kit, which runs as our own
code, is deterministic, and costs nothing per user. AI is an optional helper for the steps where it is genuinely
better, never the source of truth. Every part keeps its provenance (observed / inferred / assumed / user), and the user
accepts or rejects everything that was not seen.

## Principles

1. **Measure, don't guess.** Proportions, window rows and roof pitches come from geometry in the image, not from a
   language model's description of it.
2. **Rules are named and explainable.** Every inferred part says which rule made it and which visible parts it used.
3. **Geometry checks every proposal.** Nothing is offered that would sit inside another part or off a face.
4. **The front is the truth.** Nothing is invented on the side the photo shows.
5. **AI is replaceable.** Any model call sits behind an interface with a non-AI fallback and a measured cost.

## The pipeline we own

| # | Step | Our logic | Status |
|---|---|---|---|
| 1 | **Hidden sides** | Rule engine (`src/lib/analysis/inference.ts`): mirror a populated face onto its unseen opposite, continue window rows onto blank walls, back door, gable trim on the far end. Exact point-in-solid tests for every primitive reject candidates hidden in a turret/wing or off a gable's slope, or too close to the corner joints. User accepts/rejects per suggestion; preview in the 3D view. | **Done (v1)** |
| 2 | **Facade rectification** | Vanishing points from line segments (LSD + RANSAC) → homography → a straight-on image of each wall. Classical CV, runs in the browser (WASM) or a Rust worker. | Next |
| 3 | **Window & door detection** | Small open detector (YOLO-class, ONNX) trained on open facade datasets (CMP Facade, ECP). Runs locally. Output snapped to rows/columns by our own grid fitting (windows repeat). | Planned |
| 4 | **Measured proportions** | From the rectified facade + one known size (door ≈ 2.1 m, or the user's number): wall width/height, window sizes and sills, floor heights, roof pitch from the gable outline. | Planned |
| 5 | **Volumes from depth** | Monocular depth (Depth Anything, open weights) → which masses stand forward (bays, porch, turret) → our primitives (box, ngon, gable…). | Planned |
| 6 | **Roof & cladding reading** | Texture statistics on rectified roof/wall patches: course spacing → shingle/siding exposure, fishscale vs straight from edge shape. Feeds the exact strip counts. | Planned |
| 7 | **Element library** | Real Victorian/Scandinavian windows, brackets, fans, railings as parametric parts the detector snaps to, instead of generic shapes. | Planned |
| 8 | **More views** | Several photos registered to one model; any face seen in a photo turns its parts from inferred to observed. | Planned |
| 9 | **Optional AI** | Generated "back side" images or an LLM pass for naming/semantics only, behind a setting with a shown cost. Its output goes through the same rule checks and acceptance UI. | Optional |

Steps 2–6 make the photo → components step ours; step 1 and everything after components (trimming, joints, cladding
counts, nesting, files, catalogue, assembly) already is.

## Product track (in parallel)

- Show cladding strips in the 3D view and a proper sheet/vector viewer.
- First physical test build (small house, laser + glue) — fix what the real build exposes.
- Hosting (Postgres, object storage, job queue), accounts, payment, cost limits; closed beta with makers; then launch.
