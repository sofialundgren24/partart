// Rotation helpers matching manifold-3d's rotate([x, y, z]) convention: rotate about X, then Y, then Z
// (v' = Rz · Ry · Rx · v). Verified by tests/transform.test.ts against manifold itself.

import type { Vec3 } from "./types";

type M3 = [number, number, number, number, number, number, number, number, number]; // row-major

export function rotationMatrix(deg: Vec3): M3 {
  const [x, y, z] = deg.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const Rx: M3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry: M3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz: M3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul(Rz, mul(Ry, Rx));
}

export function mul(a: M3, b: M3): M3 {
  const r = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

export function apply(m: M3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

export function transpose(m: M3): M3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Local → world for a component transform. */
export function toWorld(p: Vec3, rotation: Vec3, position: Vec3): Vec3 {
  const r = apply(rotationMatrix(rotation), p);
  return [r[0] + position[0], r[1] + position[1], r[2] + position[2]];
}

/** World → local for a component transform. */
export function toLocal(p: Vec3, rotation: Vec3, position: Vec3): Vec3 {
  return apply(transpose(rotationMatrix(rotation)), [p[0] - position[0], p[1] - position[1], p[2] - position[2]]);
}

export function rotateVec(v: Vec3, rotation: Vec3): Vec3 {
  return apply(rotationMatrix(rotation), v);
}
