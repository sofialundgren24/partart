// Solid geometry kernel built on manifold-3d. Every solid produced here is a closed, oriented 2-manifold by
// construction (manifold-3d guarantees this for all of its operations).

import type { Manifold as ManifoldT, CrossSection as CrossSectionT, ManifoldToplevel, Mat4 } from "manifold-3d";
import type { BBox, ComponentSpec, MeshData, Primitive, Vec3 } from "./types";

let wasmPromise: Promise<ManifoldToplevel> | null = null;

export async function getManifold(): Promise<ManifoldToplevel> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const mod = await import("manifold-3d");
      const factory = (mod as unknown as { default: () => Promise<ManifoldToplevel> }).default;
      const wasm = await factory();
      wasm.setup();
      return wasm;
    })();
  }
  return wasmPromise;
}

export type Manifold = ManifoldT;
export type CrossSection = CrossSectionT;

const SEGMENTS = 64;

/** Build a solid for a primitive in its local frame (centred on XY, resting on z = 0). */
export function primitiveSolid(wasm: ManifoldToplevel, p: Primitive, meshLoader?: (path: string) => MeshData, segments = SEGMENTS): Manifold {
  const { Manifold, CrossSection } = wasm;
  const SEG = segments;
  switch (p.type) {
    case "box":
      return Manifold.cube([p.w, p.d, p.h], true).translate([0, 0, p.h / 2]);
    case "cylinder":
      return Manifold.cylinder(p.h, p.r, p.rTop ?? p.r, SEG, false);
    case "ellipsoid":
      return Manifold.sphere(1, SEG).scale([p.w / 2, p.d / 2, p.h / 2]).translate([0, 0, p.h / 2]);
    case "gable": {
      // Triangle in the (y, z) plane, extruded along x.
      const tri = CrossSection.ofPolygons([[[-p.d / 2, 0], [p.d / 2, 0], [0, p.h]]]);
      return extrudeAlongX(Manifold.extrude(tri, p.w), p.w);
    }
    case "wedge": {
      const tri = CrossSection.ofPolygons([[[-p.d / 2, 0], [p.d / 2, 0], [-p.d / 2, p.h]]]);
      return extrudeAlongX(Manifold.extrude(tri, p.w), p.w);
    }
    case "mesh": {
      if (!meshLoader) throw new Error("Mesh primitive requires a mesh loader");
      return manifoldFromMesh(wasm, meshLoader(p.storagePath));
    }
  }
}

/** An extrusion of an (a, b) profile along +c becomes x = c - len/2, y = a, z = b. */
function extrudeAlongX(m: Manifold, len: number): Manifold {
  // Column-major 4x4: columns are images of the a, b, c axes, then translation.
  const mat: Mat4 = [
    0, 1, 0, 0, // a -> y
    0, 0, 1, 0, // b -> z
    1, 0, 0, 0, // c -> x
    -len / 2, 0, 0, 1,
  ];
  return m.transform(mat);
}

/** Place a local-frame solid into project space using the component's rotation and position. */
export function placeSolid(m: Manifold, rotation: Vec3, position: Vec3): Manifold {
  let out = m;
  if (rotation[0] || rotation[1] || rotation[2]) out = out.rotate(rotation);
  return out.translate(position);
}

export function componentSolid(wasm: ManifoldToplevel, c: ComponentSpec, meshLoader?: (path: string) => MeshData, segments = SEGMENTS): Manifold {
  return placeSolid(primitiveSolid(wasm, c.primitive, meshLoader, segments), c.rotation, c.position);
}

export function toMeshData(m: Manifold): MeshData {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = mesh.vertProperties[i * np];
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

/** Convert arbitrary triangle data into a Manifold, welding coincident vertices first. Throws if not manifold. */
export function manifoldFromMesh(wasm: ManifoldToplevel, data: MeshData): Manifold {
  const welded = weldVertices(data, 1e-4);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: welded.positions, triVerts: welded.indices });
  mesh.merge();
  return new wasm.Manifold(mesh);
}

export function weldVertices(data: MeshData, eps: number): MeshData {
  const map = new Map<string, number>();
  const out: number[] = [];
  const remap = new Uint32Array(data.positions.length / 3);
  const q = 1 / eps;
  for (let i = 0; i < remap.length; i++) {
    const x = data.positions[i * 3], y = data.positions[i * 3 + 1], z = data.positions[i * 3 + 2];
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = out.length / 3;
      out.push(x, y, z);
      map.set(key, idx);
    }
    remap[i] = idx;
  }
  const indices: number[] = [];
  for (let t = 0; t < data.indices.length; t += 3) {
    const a = remap[data.indices[t]], b = remap[data.indices[t + 1]], c = remap[data.indices[t + 2]];
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  return { positions: new Float32Array(out), indices: new Uint32Array(indices) };
}

export function bboxOf(m: Manifold): BBox {
  const b = m.boundingBox();
  return { min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]] };
}

export function meshBBox(d: MeshData): BBox {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < d.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = d.positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

export function bboxSize(b: BBox): Vec3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

/** Move a solid so it is centred on XY and rests on z = 0 (for printing). */
export function dropToBed(m: Manifold): Manifold {
  const b = bboxOf(m);
  return m.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
}
