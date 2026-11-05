// Mesh file writers/readers: binary STL, OBJ, 3MF (core spec, millimetres), GLB via glTF-Transform.

import JSZip from "jszip";
import { Document, NodeIO } from "@gltf-transform/core";
import type { MeshData } from "../geometry/types";

// ---------- STL ----------

export function writeBinaryStl(d: MeshData, header = "PARTART"): Buffer {
  const triCount = d.indices.length / 3;
  const buf = Buffer.alloc(84 + triCount * 50);
  buf.write(header.slice(0, 79).padEnd(80, " "), 0, "ascii");
  buf.writeUInt32LE(triCount, 80);
  const P = d.positions;
  let o = 84;
  for (let t = 0; t < d.indices.length; t += 3) {
    const a = d.indices[t] * 3, b = d.indices[t + 1] * 3, c = d.indices[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]) {
      buf.writeFloatLE(v, o);
      o += 4;
    }
    buf.writeUInt16LE(0, o);
    o += 2;
  }
  return buf;
}

/** Parse binary or ASCII STL into an unwelded triangle soup. */
export function readStl(buf: Buffer): MeshData {
  const isBinary = buf.length >= 84 && 84 + buf.readUInt32LE(80) * 50 === buf.length;
  const pos: number[] = [];
  if (isBinary) {
    const n = buf.readUInt32LE(80);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) pos.push(buf.readFloatLE(o + k * 4));
    }
  } else {
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let m: RegExpExecArray | null;
    const s = buf.toString("utf8");
    while ((m = re.exec(s))) pos.push(+m[1], +m[2], +m[3]);
  }
  const indices = new Uint32Array(pos.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions: new Float32Array(pos), indices };
}

// ---------- OBJ ----------

export function writeObj(objects: { name: string; mesh: MeshData }[]): string {
  const lines = ["# PARTART export — units: millimetres, Z up"];
  let base = 1;
  for (const { name, mesh } of objects) {
    lines.push(`o ${name.replace(/\s+/g, "_")}`);
    const P = mesh.positions;
    for (let i = 0; i < P.length; i += 3) lines.push(`v ${fmt(P[i])} ${fmt(P[i + 1])} ${fmt(P[i + 2])}`);
    for (let t = 0; t < mesh.indices.length; t += 3)
      lines.push(`f ${mesh.indices[t] + base} ${mesh.indices[t + 1] + base} ${mesh.indices[t + 2] + base}`);
    base += P.length / 3;
  }
  return lines.join("\n") + "\n";
}

export function readObj(text: string): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const [, x, y, z] = line.split(/\s+/);
      verts.push(+x, +y, +z);
    } else if (line.startsWith("f ")) {
      const ids = line.slice(2).trim().split(/\s+/).map((tok) => {
        const n = parseInt(tok.split("/")[0], 10);
        return n < 0 ? verts.length / 3 + n : n - 1;
      });
      for (let k = 1; k + 1 < ids.length; k++) idx.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  return { positions: new Float32Array(verts), indices: new Uint32Array(idx) };
}

function fmt(n: number) {
  return Number(n.toFixed(4)).toString();
}

// ---------- 3MF ----------

export interface ThreeMfObject {
  name: string;
  mesh: MeshData;
  colorHex?: string;
}

/**
 * Core-spec 3MF (http://schemas.microsoft.com/3dmanufacturing/core/2015/02), unit = millimetre.
 * One <object> per part, each placed as its own build item. Colours via the materials extension basematerials.
 * Objects are laid out on a grid so they do not overlap on the plate.
 */
export async function write3mf(objects: ThreeMfObject[], title: string, plate = { x: 256, y: 256 }): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`,
  );
  const colors = objects.map((o) => o.colorHex ?? "#CCCCCC");
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">${esc(title)}</metadata>
  <metadata name="Application">PARTART</metadata>
  <resources>
    <basematerials id="1">
${colors.map((c, i) => `      <base name="m${i}" displaycolor="${c.toUpperCase()}FF"/>`).join("\n")}
    </basematerials>`);
  objects.forEach((o, i) => {
    const P = o.mesh.positions;
    const v: string[] = [];
    for (let k = 0; k < P.length; k += 3) v.push(`<vertex x="${fmt(P[k])}" y="${fmt(P[k + 1])}" z="${fmt(P[k + 2])}"/>`);
    const t: string[] = [];
    for (let k = 0; k < o.mesh.indices.length; k += 3)
      t.push(`<triangle v1="${o.mesh.indices[k]}" v2="${o.mesh.indices[k + 1]}" v3="${o.mesh.indices[k + 2]}"/>`);
    parts.push(`    <object id="${i + 2}" name="${esc(o.name)}" type="model" pid="1" pindex="${i}">
      <mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh>
    </object>`);
  });
  parts.push(`  </resources>\n  <build>`);
  // Simple grid layout on the plate based on each object's footprint.
  let cx = 5, cy = 5, rowH = 0;
  objects.forEach((o, i) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity;
    const P = o.mesh.positions;
    for (let k = 0; k < P.length; k += 3) {
      minX = Math.min(minX, P[k]); maxX = Math.max(maxX, P[k]);
      minY = Math.min(minY, P[k + 1]); maxY = Math.max(maxY, P[k + 1]);
      minZ = Math.min(minZ, P[k + 2]);
    }
    const w = maxX - minX, h = maxY - minY;
    if (cx + w > plate.x - 5 && cx > 5) { cx = 5; cy += rowH + 5; rowH = 0; }
    const tx = cx - minX, ty = cy - minY, tz = -minZ;
    parts.push(`    <item objectid="${i + 2}" transform="1 0 0 0 1 0 0 0 1 ${fmt(tx)} ${fmt(ty)} ${fmt(tz)}"/>`);
    cx += w + 5;
    rowH = Math.max(rowH, h);
  });
  parts.push(`  </build>\n</model>`);
  zip.file("3D/3dmodel.model", parts.join("\n"));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------- GLB ----------

export interface GlbNode {
  name: string; // partId — the viewer selects by this
  mesh: MeshData;
  colorHex: string;
  extras?: Record<string, unknown>;
  opacity?: number;
}

/** Writes GLB in metres (glTF convention, Y up). Input is mm, Z up → converted. */
export async function writeGlb(nodes: GlbNode[], sceneName: string): Promise<Buffer> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(sceneName);
  for (const n of nodes) {
    const { positions, normals, indices } = flatShaded(n.mesh);
    const pos = doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer);
    const nor = doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer);
    const idx = doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer);
    const [r, g, b] = hexToLinear(n.colorHex);
    const mat = doc
      .createMaterial(`${n.name}-mat`)
      .setBaseColorFactor([r, g, b, n.opacity ?? 1])
      .setRoughnessFactor(0.85)
      .setMetallicFactor(0);
    if ((n.opacity ?? 1) < 1) mat.setAlphaMode("BLEND");
    const prim = doc.createPrimitive().setAttribute("POSITION", pos).setAttribute("NORMAL", nor).setIndices(idx).setMaterial(mat);
    const mesh = doc.createMesh(n.name).addPrimitive(prim);
    const node = doc.createNode(n.name).setMesh(mesh);
    if (n.extras) node.setExtras(n.extras);
    scene.addChild(node);
  }
  const io = new NodeIO();
  const out = await io.writeBinary(doc);
  return Buffer.from(out);
}

/** Read a GLB into one merged mesh in mm, Z up (inverse of writeGlb's conversion). Applies node transforms. */
export async function readGlb(buf: Buffer): Promise<MeshData> {
  const io = new NodeIO();
  const doc = await io.readBinary(new Uint8Array(buf));
  const pos: number[] = [];
  const idx: number[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute("POSITION");
      if (!a) continue;
      const base = pos.length / 3;
      const el: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, el);
        const x = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
        const y = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
        const z = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
        // glTF (m, Y up) → mm, Z up
        pos.push(x * 1000, -z * 1000, y * 1000);
      }
      const ind = prim.getIndices();
      if (ind) for (let i = 0; i < ind.getCount(); i++) idx.push(base + ind.getScalar(i));
      else for (let i = 0; i < a.getCount(); i++) idx.push(base + i);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function flatShaded(d: MeshData) {
  const n = d.indices.length;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const indices = new Uint32Array(n);
  const P = d.positions;
  for (let t = 0; t < n; t += 3) {
    const ids = [d.indices[t], d.indices[t + 1], d.indices[t + 2]];
    const v = ids.map((i) => [P[i * 3] / 1000, P[i * 3 + 2] / 1000, -P[i * 3 + 1] / 1000]); // Z up mm → Y up m
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
    const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      positions.set(v[k], (t + k) * 3);
      normals.set([nx, ny, nz], (t + k) * 3);
      indices[t + k] = t + k;
    }
  }
  return { positions, normals, indices };
}

function hexToLinear(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))) as [number, number, number];
}
