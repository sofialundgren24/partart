# PARTART

**Upload anything. Explore how it can be made. Break it into parts. Build it in real life.**

PARTART turns a photo (or a 3D scan) of an object into a component breakdown, lets you choose how each part is made (3D print, laser-cut wood/acrylic, paper, cardboard, hand-made — or a mix), and generates a validated build kit: STL/3MF/OBJ/GLB, SVG/DXF/PDF cutting sheets, an illustrated assembly guide, a shopping list and personalised Blender / Nomad Sculpt lessons.

## Quick start

```bash
npm install
cp .env.example .env        # optional: add ANTHROPIC_API_KEY for photo analysis
npx prisma db push          # creates prisma/dev.db (SQLite)
npm run dev                 # http://localhost:3210
```

Without `ANTHROPIC_API_KEY` everything works, but analysis starts from an editable **category template** (clearly labelled as not derived from your photo). With the key, Claude (`claude-opus-5-5`) reads your photos and proposes the component hierarchy, primitive dimensions, uncertainties and the extra views it needs.

```bash
npm test          # geometry + end-to-end kit generation across 9 mode/category combos
npm run typecheck
```

## The journey

| Step | Page | What happens |
|---|---|---|
| Upload | `/create` | Photos with view labels, intent, real/target size, region; optional STL/OBJ/GLB |
| Understand | `/p/:id/analyze` | Component tree with provenance (observed / inferred / assumed / template / user / imported) and confidence; edit, add, remove, rename, merge, separate, mirror, rescale |
| Design | `/p/:id/design` | Ten modes ("Make it your way"), concept comparison with real piece counts, sheet areas and volumes, per-part method/material overrides |
| Deconstruct | `/p/:id/workshop` | 3D workspace: assembled / exploded / components / materials / manufacturing / assembly views, hide/isolate, cross-section, measuring |
| Manufacture | `/p/:id/kit` | Printer + laser profiles, kit generation job, readiness report, print cards, sheet previews, file browser, ZIP |
| Assemble | `/p/:id/assembly` | Step-by-step 3D assembly on the real manufacturing geometry, illustrated PDF |
| Materials | `/p/:id/materials` | Shopping list (minimum / recommended / premium) from the actual files, verified shops for Sweden |
| Learn | `/p/:id/learn` | Blender & Nomad courses built from your parts + a runnable Blender blockout script |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and [docs/STATUS.md](docs/STATUS.md) for what works, what's tested and what's not done yet.
