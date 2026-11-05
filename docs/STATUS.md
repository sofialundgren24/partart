# PARTART — Build status

_Last updated 2026-11-05 (first build session)._

## What was implemented

A working vertical slice through the whole journey, phases 1–5 in reduced form:

| Area | Status |
|---|---|
| Landing, upload (multi-image + view labels, intent, sizes, region, optional mesh) | ✅ working |
| Analysis: Claude vision provider (structured output, provenance, uncertainties, requested views/measurements) | ✅ implemented, **not exercised end-to-end here** (no API key on this machine) |
| Analysis: template provider (offline, labelled as template) | ✅ working, tested |
| Component hierarchy: persistent part IDs, edit / add / remove / rename / reparent / merge / separate / mirror / rescale | ✅ working |
| Reconstruction: parametric proxy (primitives → manifold solids) and mesh import (STL/OBJ/GLB) | ✅ working, tested |
| Reconstruction: generative image-to-3D, multi-view, segmentation | ❌ interface only (Phase 6) |
| 3D viewer (R3F): select, hide, isolate, explode, colour by material/method/confidence/provenance, cross-section, measure, overall dimensions, assembly stepping | ✅ working |
| Design modes ×10, controls (detail, difficulty, palette, finish, size), per-part overrides, concept comparison with iso previews | ✅ working |
| 3D print pipeline: hollow shells/roofs, cut openings, printed window frames and door leaves, axle bores, orientation search, build-volume fit, plane splitting with alignment-pin holes + printed pins | ✅ working, tested |
| Laser pipeline: finger-jointed boxes with tab-and-slot floors/lids, openings cut into walls, gable roofs, wedges, layered slices with dowel holes, clear panes/door leaves/frames, kerf compensation (polygon offset), shelf nesting | ✅ working, tested |
| Paper/cardboard: box cross-nets with glue tabs and score lines (auto-split into faces when too big for A4), roof nets, cylinder wraps, layered fallback | ✅ working, tested |
| Validation engine & readiness status | ✅ working |
| Mixed media in one coordinate system with connection checks | ✅ working (checks listed below) |
| Shopping list from real data, verified Swedish shops, user-entered prices | ✅ working |
| Assembly sequence, illustrated PDF guide, interactive 3D assembly + autoplay | ✅ working |
| Learn: Blender & Nomad courses from the component graph, Blender blockout script, lesson renders | ✅ working |
| ZIP kit in the requested folder structure + manifest with SHA-256 per file | ✅ working |
| Background jobs (DB-backed, retry, resume after restart) | ✅ working (in-process runner) |
| Auth / multiple users | ❌ not implemented (single local user) |

## Files a kit contains (all generated, none are placeholders)

`02_3D_MODELS/` complete_assembly.glb/.obj (the real manufacturing geometry in place), reference_proxy.glb, size gauges for hand-made parts ·
`03_3D_PRINT/` one binary STL per part/section, oriented and on the bed; one 3MF per material+colour ·
`04_LASER_CUT/` SVG + DXF (R12) per sheet with CUT/ENGRAVE/SCORE layers, sheet_layouts.pdf, LASER_INSTRUCTIONS.md ·
`04_PAPER_TEMPLATES/` SVG per page + print-at-100 % PDF ·
`05_MATERIALS/` shopping_list.pdf/.csv, material_manifest.json ·
`06_ASSEMBLY/` assembly_guide.pdf, exploded_view.glb, step JSONs ·
`07_TUTORIALS/` build_blockout.py, Blender & Nomad course.md ·
`08_DOCUMENTATION/` validation_report.json, manufacturing_report.pdf, dimensions.csv, project_manifest.json · `README.md`

## Validation actually performed

- **Geometry:** every STL is re-read from the written bytes and checked for watertightness (each edge shared by exactly two triangles), consistent orientation, positive signed volume and zero degenerate triangles.
- **Print:** build-volume fit (6 axis poses, plus 90° turn on the bed), split when needed, minimum feature vs 2 × nozzle, overhang area > 45° → support recommendation, bed contact → brim suggestion.
- **Laser:** every contour closed and non-degenerate, inside the sheet, kerf-compensated; parts too large for the sheet/work area are reported as failures.
- **Connections:** opening distance from the corner joints, pane/door-leaf overlap, frame aperture vs hole, resting contact parent↔child, roof overhang, wheel bore clearance, sheet-thickness sensitivity warning.
- **Dimensions:** manufactured bounding box vs modelled bounding box per part (tolerance accounts for whole-sheet layering).
- **Assembly:** every live part appears in a step; every part has a file or hand-making instructions; unintended overlaps between unrelated parts.
- **Readiness:** geometry failure → *not manufacturable*; any other failure → *needs adjustment*; warnings → *ready with warnings*.

Validation is geometric and fit-based; it is **not** structural engineering.

## Tests

`npm test` — 17 tests, all passing; `next build` succeeds:
- rotation convention matches manifold-3d;
- STL/OBJ/GLB round-trips (watertight, sizes in mm), 3MF structure and units, box → 6 jointed panels, kerf offset = kerf/2 per side, nesting + SVG/DXF layers;
- full kit generation for architecture × {realistic, woodwork, mixed, papercraft, cardboard}, vehicles × realistic, figurines × {sculptural, collectible}, furniture × flat-pack — asserts no geometry failures, non-empty files, every STL re-parses, ZIP integrity;
- oversize part is split into sections that all fit a 180 mm printer, with pins.

Manually verified in the running app: create → analyze (template) → design (concepts, previews, overrides) → kit (UI generation, report, sheets, print cards) → workshop (exploded manufacturing geometry) → assembly → materials → learn; STL import → kit; generated Blender script parses as Python; generated PDFs load (pdf-lib).

## Honest limitations / what remains

1. **Real photo analysis was not run** — the Claude provider is implemented against the current SDK and typechecks, but needs `ANTHROPIC_API_KEY` to be exercised. Output quality on complex objects is unknown until tested.
2. **Reconstruction is a primitive proxy.** No true image-to-3D, multi-view or segmentation yet; imported scans are a single body (no automatic part separation).
3. **Nesting is rectangle shelf packing,** so offcut % is high for irregular parts (true-shape nesting is a follow-up).
4. **Roof gables** are glued to slopes along engraved lines (no slot joints); ridge bevel is left to the maker.
5. **Split hollow parts** (e.g. a 2 mm roof shell) have no room for pins → warned; internal pin bosses would fix this.
6. **Print time / exact filament** are not computed (slicer integration not done); filament is a labelled geometric estimate.
7. **Suppliers:** only Sweden has a (small, manually verified) list; no live prices or product availability.
8. **3MF** uses the core spec (+ base materials); one plate layout, no slicer-specific project settings.
9. **Cross-section** view is uncapped; no stencil caps.
10. Single local user, no auth; storage is the local filesystem; jobs run in-process.

## External services

| Service | Needed for | Status |
|---|---|---|
| Anthropic API (`claude-opus-5-5`, server-side refusal fallback enabled) | photo analysis | optional |
| Google Fonts (Fraunces, Inter, JetBrains Mono via next/font) | typography | fetched at build |
| Everything else (geometry, exports, PDFs, nesting) | — | runs locally, no services |
