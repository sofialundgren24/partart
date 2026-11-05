# PARTART — Architecture & MVP Plan

_Written 2026-11-05, at the start of the build. The repository was empty: no existing stack, code, AI or geometry integrations._

## 1. Repository state at start

Empty folder. Toolchain available on the dev machine: Node 22.14, npm 10.8, Python 3.13 (no geometry libs installed), git. No PostgreSQL, no Blender, no image-to-3D API keys.
Consequence: the MVP is designed so that **everything runs locally in Node** (no Python service required yet), and every AI provider is optional and pluggable.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router) + TypeScript + Tailwind 4 | Single deployable, API routes for jobs and file serving |
| 3D viewport | Three.js + React Three Fiber + drei | Component selection, exploded views, clipping planes, measuring |
| Solid geometry | **manifold-3d** (WASM) | Guaranteed-manifold booleans, plane splits, extrusions — every printable mesh is watertight by construction, not by luck |
| glTF I/O | @gltf-transform/core | Real GLB writer/reader (also used to import user scans) |
| Packaging | JSZip, pdf-lib | ZIP kit, PDF assembly guide / shopping list / sheet layouts |
| DB | Prisma 6 → SQLite in dev (`file:./dev.db`) | Schema is portable to PostgreSQL by switching `provider`; no Postgres on this machine |
| Storage | Local filesystem `./storage/projects/<id>/` behind a `Storage` interface | Swap for S3/R2 later |
| Jobs | DB-backed `Job` table + in-process runner with retry/resume | Heavy work leaves the request path; swap the runner for BullMQ/worker process in production |
| LLM / vision | Anthropic Claude (`claude-opus-5-5`) via `@anthropic-ai/sdk`, structured outputs | Component hierarchy, primitive proxies, uncertainties, requested views |

## 3. The honest core idea: two separate geometry systems

1. **Reconstruction** (what the object looks like) — a *reference* geometry with provenance and confidence.
2. **Manufacturing geometry** (what you actually cut/print) — derived from the component graph per chosen design mode, built by a deterministic geometry kernel, validated, then exported.

They meet in the **component graph**: every component has a persistent ID (`C-ROOF-01`), parent, relationships, a primitive shape + dimensions in **mm**, a transform in the shared project coordinate system (Z up, origin at base centre), provenance (`observed | inferred | user | assumed | template | imported`) and confidence.

### Reconstruction providers (interface `ReconstructionProvider`)
| Provider | Status in MVP | Notes |
|---|---|---|
| `parametric-proxy` | **Implemented** | Builds a primitive-based proxy (boxes, gabled prisms, cylinders, ellipsoids, wedges, extruded profiles) from the component graph. The LLM proposes structure + dimensions, never mesh coordinates. Always labelled "proxy — not a scan". |
| `mesh-import` | **Implemented** | User uploads GLB/STL/OBJ from photogrammetry (Polycam, KIRI, RealityScan) or any image-to-3D service; becomes an `imported` component with real validation. |
| Generative image-to-3D (Meshy, Tripo, Hyper3D Rodin, Stability SPAR3D / Stable Fast 3D, self-hosted Hunyuan3D-2 / TRELLIS) | **Interface only** | Not wired: no API keys on this machine and untested adapters would be fake functionality. All return a single fused mesh, so their output enters through the same path as `mesh-import` and still needs segmentation. |
| Multi-view (VGGT, MASt3R/DUSt3R, COLMAP) | Phase 6 | Needs a Python GPU worker. |
| Segmentation (SAM 2/3 masks → per-part mesh labelling) | Phase 6 | Needs a Python GPU worker. |

### Analysis providers (interface `AnalysisProvider`)
| Provider | Status |
|---|---|
| `claude-vision` | Implemented; enabled when `ANTHROPIC_API_KEY` is set. Returns category, component tree with primitives/dimensions, symmetry/repetition notes, uncertainties and **requested extra views/measurements**. |
| `template` | Implemented; always available. Category templates (house, vehicle, figurine, furniture, generic) the user edits. Clearly labelled "template — not derived from your photo". |

## 4. Manufacturing pipelines (each mode has its own geometry pipeline)

| Method | Pipeline | Outputs |
|---|---|---|
| 3D print | primitive → manifold solid → orientation search (6 axis-aligned poses, minimise overhang area then height) → build-volume check → plane split + alignment-pin holes + printed pins if too large → validation | per-part binary STL, combined 3MF (mm, one object per part), GLB |
| Laser / sheet | primitive → flat panels (boxes → 4 walls + floor with finger joints sized to sheet thickness; gabled prisms → gables + roof slopes; cylinders/ellipsoids → stacked layered slices) → kerf offset (outward by kerf/2 on outer contours, inward on holes) → shelf nesting on sheets with spacing → validation (closed paths, inside sheet, spacing) | SVG (cut = red #FF0000 hairline, engrave = blue #0000FF, score = green #00A000 — LightBurn/xTool friendly), DXF R12 (layers CUT/ENGRAVE/SCORE), PDF layout |
| Papercraft / cardboard | same panel pipeline with fold (score) lines and glue tabs instead of finger joints, A4/A3 pages | SVG + PDF |
| Manual (fabric, clay, paint) | instructions only | in assembly guide |

Mixed media = per-component method/material assignment within one shared coordinate system; connection checks compare mating dimensions (e.g. printed frame aperture vs acrylic pane + clearance, wall-slot width vs sheet thickness + tolerance).

## 5. Data model (Prisma)

User, Project, ReferenceImage, ObjectAnalysis, ReconstructedModel, Component, ComponentRelationship, ManufacturingDesign, ComponentAssignment, Material, PrinterProfile, LaserProfile, ManufacturingJob (Job), GeneratedFile, ValidationReport, Supplier, ShoppingList, AssemblyStep, Tutorial. Complex sub-structures (primitive params, validation details) are JSON text columns. See `prisma/schema.prisma`.

## 6. Hardest engineering problems (and the MVP stance)

1. **Single image → true 3D.** Ill-posed. MVP: proxy reconstruction with explicit uncertainty + requests for more views; mesh import for real scans. No claim of exactness.
2. **Mesh → semantic parts.** Generative meshes are one fused blob. MVP builds parts from the component graph instead; true segmentation is Phase 6.
3. **Mesh → flat sheet parts.** General surfaces don't unfold into joinable panels. MVP supports primitive families with known decompositions; layered slicing covers organic shapes.
4. **Robust booleans/splitting.** Solved by manifold-3d.
5. **Nesting.** True polygon nesting is NP-hard; MVP uses rectangle shelf packing (honest waste numbers computed from real part areas).
6. **Print time/filament.** Only a slicer knows. MVP reports **mesh volume** and a labelled *estimate* of filament mass (volume × density, shell/infill model); print time is "obtain from your slicer".
7. **Live supplier data.** No verified product API. MVP lists material specs and quantities, and only shows supplier names/links that were manually verified, with the verification date; prices are never invented.

## 7. Automation vs user confirmation

| Fully automated | Requires user confirmation |
|---|---|
| Primitive → solid, exports, validation, kerf, nesting, orientation, splitting, part IDs, manifests, ZIP | Analysis result (component tree, dimensions, scale) before manufacturing |
| Assembly order from hierarchy | Missing measurements / ambiguous regions flagged by the analyser |
| Shopping quantities | Printer & laser profiles; material thickness must match actual stock (measure it!) |
| Blender script generation | Test cut before full cut; kerf value per machine |

## 8. External services & costs

| Service | Used for | Required? | Cost |
|---|---|---|---|
| Anthropic API (`claude-opus-5-5`) | Image analysis | Optional (template mode without it) | $4 / $20 per MTok in/out (Nov 2026); one analysis ≈ a few images + ~4k output tokens |
| Image-to-3D APIs (Meshy, Tripo, Rodin…) | Future generative reconstruction | No | Per-generation credits; check current pricing |
| Object storage / Postgres | Production | No (local FS + SQLite in dev) | — |

## 9. Phase plan

Phases follow the brief (1 Foundation → 7 Polish). This first build delivers a vertical slice touching every area; see `docs/STATUS.md` for what actually works and what is tested.
