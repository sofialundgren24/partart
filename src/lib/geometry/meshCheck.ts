// Independent mesh checks. These run on the exact triangles that are written to disk, so a passing check
// says something about the file, not just about the kernel that produced it.

import type { MeshData, Vec3 } from "./types";
import { meshBBox, bboxSize } from "./kernel";

export interface MeshCheckResult {
  triangles: number;
  vertices: number;
  watertight: boolean; // every undirected edge shared by exactly two triangles
  consistentOrientation: boolean; // every directed edge appears once (neighbours wind oppositely)
  outwardNormals: boolean; // signed volume positive
  degenerateTriangles: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  volumeMm3: number;
  surfaceAreaMm2: number;
  size: Vec3;
}

export function checkMesh(d: MeshData): MeshCheckResult {
  const P = d.positions, I = d.indices;
  const undirected = new Map<string, number>();
  const directed = new Set<string>();
  let dupDirected = 0;
  let degenerate = 0;
  let vol = 0;
  let area = 0;
  for (let t = 0; t < I.length; t += 3) {
    const ids = [I[t], I[t + 1], I[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = ids[k], b = ids[(k + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      undirected.set(key, (undirected.get(key) ?? 0) + 1);
      const dk = `${a}>${b}`;
      if (directed.has(dk)) dupDirected++;
      directed.add(dk);
    }
    const [ax, ay, az] = [P[ids[0] * 3], P[ids[0] * 3 + 1], P[ids[0] * 3 + 2]];
    const [bx, by, bz] = [P[ids[1] * 3], P[ids[1] * 3 + 1], P[ids[1] * 3 + 2]];
    const [cx, cy, cz] = [P[ids[2] * 3], P[ids[2] * 3 + 1], P[ids[2] * 3 + 2]];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const a2 = Math.hypot(nx, ny, nz);
    if (a2 < 1e-12) degenerate++;
    area += a2 / 2;
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let boundary = 0, nonManifold = 0;
  for (const n of undirected.values()) {
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
  }
  return {
    triangles: I.length / 3,
    vertices: P.length / 3,
    watertight: boundary === 0 && nonManifold === 0,
    consistentOrientation: dupDirected === 0,
    outwardNormals: vol > 0,
    degenerateTriangles: degenerate,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    volumeMm3: vol,
    surfaceAreaMm2: area,
    size: bboxSize(meshBBox(d)),
  };
}

export interface OverhangResult {
  overhangAreaMm2: number; // downward-facing area steeper than the threshold, excluding faces on the bed
  bedContactAreaMm2: number;
  overhangFraction: number;
}

/** Overhang analysis for a mesh already placed on the bed (min z = 0). */
export function overhangs(d: MeshData, maxAngleDeg = 45): OverhangResult {
  const P = d.positions, I = d.indices;
  const limit = -Math.cos(((90 - maxAngleDeg) * Math.PI) / 180); // normal.z below this → overhang
  let minZ = Infinity;
  for (let i = 2; i < P.length; i += 3) minZ = Math.min(minZ, P[i]);
  let over = 0, bed = 0, total = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    const ar = len / 2;
    total += ar;
    const onBed = Math.max(P[a + 2], P[b + 2], P[c + 2]) - minZ < 0.05;
    if (onBed && nz / len < -0.99) bed += ar;
    else if (nz / len < limit) over += ar;
  }
  return { overhangAreaMm2: over, bedContactAreaMm2: bed, overhangFraction: total ? over / total : 0 };
}
