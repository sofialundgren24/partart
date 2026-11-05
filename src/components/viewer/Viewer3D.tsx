"use client";
// Interactive viewport: selection, hide/isolate, exploded view, colour modes, cross-section clipping, measuring.
// GLB files are in metres (glTF convention); all readouts are converted back to millimetres.

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export interface ViewerProps {
  url: string;
  selected?: string | null;
  onSelect?: (partId: string | null) => void;
  hidden?: Set<string>;
  isolated?: string | null;
  explode?: number; // 0..1
  colors?: Record<string, string>; // override colours (material / method / confidence modes)
  opacity?: Record<string, number>;
  visible?: Set<string> | null; // assembly mode: only these parts
  highlight?: Set<string> | null; // assembly mode: current step
  clip?: { axis: "x" | "y" | "z"; t: number } | null;
  measure?: boolean;
  height?: number | string;
  showDims?: boolean;
}

export default function Viewer3D(props: ViewerProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-ink bg-[#fbf7ee]" style={{ height: props.height ?? 560 }}>
      <Canvas camera={{ fov: 35, near: 0.001, far: 100, position: [0.5, 0.4, 0.6] }} gl={{ localClippingEnabled: true, antialias: true }} onPointerMissed={() => props.onSelect?.(null)}>
        <color attach="background" args={["#fbf7ee"]} />
        <hemisphereLight args={["#fff8ec", "#d9c9b0", 1.1]} />
        <directionalLight position={[1, 2, 1.5]} intensity={1.6} />
        <directionalLight position={[-1.5, 1, -1]} intensity={0.5} />
        <Suspense fallback={null}>
          <Model {...props} />
        </Suspense>
      </Canvas>
      {props.measure && <p className="pointer-events-none absolute left-3 top-3 rounded-full border-2 border-ink bg-paper px-3 py-1 text-xs font-semibold">Measuring: click two points on the model</p>}
    </div>
  );
}

function Model({ url, selected, onSelect, hidden, isolated, explode = 0, colors, opacity, visible, highlight, clip, measure, showDims = true }: ViewerProps) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const parts = useMemo(() => {
    const map = new Map<string, { obj: THREE.Object3D; meshes: THREE.Mesh[]; centre: THREE.Vector3; base: THREE.Color; baseOpacity: number }>();
    scene.updateMatrixWorld(true);
    scene.children.forEach((child) => {
      const meshes: THREE.Mesh[] = [];
      child.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      if (!meshes.length) return;
      meshes.forEach((m) => { m.material = (m.material as THREE.MeshStandardMaterial).clone(); });
      const box = new THREE.Box3().setFromObject(child);
      const mat = meshes[0].material as THREE.MeshStandardMaterial;
      map.set(child.name, { obj: child, meshes, centre: box.getCenter(new THREE.Vector3()), base: mat.color.clone(), baseOpacity: mat.opacity });
    });
    return map;
  }, [scene]);
  const bounds = useMemo(() => new THREE.Box3().setFromObject(scene), [scene]);
  const centre = useMemo(() => bounds.getCenter(new THREE.Vector3()), [bounds]);
  const size = useMemo(() => bounds.getSize(new THREE.Vector3()), [bounds]);
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };

  // Frame the model once.
  useEffect(() => {
    const r = Math.max(size.x, size.y, size.z) || 0.2;
    camera.position.set(centre.x + r * 1.5, centre.y + r * 1.1, centre.z + r * 1.8);
    camera.near = r / 200;
    camera.far = r * 50;
    camera.updateProjectionMatrix();
    if (controls) { controls.target.copy(centre); controls.update(); }
  }, [camera, controls, centre, size]);

  // Colours, visibility, clipping.
  const plane = useMemo(() => new THREE.Plane(), []);
  useEffect(() => {
    if (clip) {
      // UI axes are project axes (Z up). In glTF space: X → x, Y (depth) → z, Z (height) → y.
      const k = clip.axis === "x" ? "x" : clip.axis === "y" ? "z" : "y";
      const v = bounds.min[k] + (bounds.max[k] - bounds.min[k]) * clip.t;
      plane.normal.set(k === "x" ? -1 : 0, k === "y" ? -1 : 0, k === "z" ? -1 : 0);
      plane.constant = v; // keeps everything with coordinate ≤ v
    }
    for (const [id, p] of parts) {
      const isHidden = hidden?.has(id) || (isolated && isolated !== id) || (visible && !visible.has(id));
      p.obj.visible = !isHidden;
      for (const m of p.meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.color.copy(colors?.[id] ? new THREE.Color(colors[id]) : p.base);
        const op = opacity?.[id] ?? p.baseOpacity;
        const dim = highlight && !highlight.has(id) ? 0.35 : 1;
        mat.opacity = op * dim;
        mat.transparent = mat.opacity < 1;
        mat.depthWrite = mat.opacity >= 1;
        mat.emissive = new THREE.Color(id === selected ? "#e8553f" : highlight?.has(id) ? "#f29b38" : "#000000");
        mat.emissiveIntensity = id === selected ? 0.45 : highlight?.has(id) ? 0.25 : 0;
        mat.clippingPlanes = clip ? [plane] : [];
        mat.side = clip ? THREE.DoubleSide : THREE.FrontSide;
        mat.needsUpdate = true;
      }
    }
  }, [parts, hidden, isolated, visible, colors, opacity, highlight, selected, clip, plane, bounds]);

  // Animated explode.
  useFrame((_, dt) => {
    for (const [, p] of parts) {
      const target = p.centre.clone().sub(centre).multiplyScalar(explode * 1.1);
      p.obj.position.lerp(target, Math.min(1, dt * 8));
    }
  });

  const [pts, setPts] = useState<THREE.Vector3[]>([]);
  useEffect(() => { if (!measure) setPts([]); }, [measure]);

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (measure) {
      setPts((p) => (p.length >= 2 ? [e.point.clone()] : [...p, e.point.clone()]));
      return;
    }
    let o: THREE.Object3D | null = e.object;
    while (o && !parts.has(o.name)) o = o.parent;
    onSelect?.(o ? o.name : null);
  };

  const r = Math.max(size.x, size.y, size.z) || 0.2;
  return (
    <>
      <primitive object={scene} onClick={click} />
      <Grid position={[centre.x, bounds.min.y - 0.0005, centre.z]} args={[r * 4, r * 4]} cellSize={0.01} sectionSize={0.05} cellColor="#d9cbb1" sectionColor="#b9a787" fadeDistance={r * 6} infiniteGrid />
      <OrbitControls makeDefault enableDamping />
      {pts.length > 0 && pts.map((p, i) => <mesh key={i} position={p}><sphereGeometry args={[r / 120, 12, 12]} /><meshBasicMaterial color="#e8553f" /></mesh>)}
      {pts.length === 2 && (
        <>
          <Line points={pts} color="#e8553f" lineWidth={2} />
          <Html position={pts[0].clone().lerp(pts[1], 0.5)} center>
            <span className="whitespace-nowrap rounded-full border-2 border-ink bg-butter px-2 py-0.5 font-mono text-xs font-bold">{(pts[0].distanceTo(pts[1]) * 1000).toFixed(1)} mm</span>
          </Html>
        </>
      )}
      {showDims && (
        <Html position={[bounds.max.x, bounds.min.y, bounds.max.z]} style={{ pointerEvents: "none" }}>
          <span className="whitespace-nowrap rounded-md bg-paper/90 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">
            {(size.x * 1000).toFixed(0)} × {(size.z * 1000).toFixed(0)} × {(size.y * 1000).toFixed(0)} mm
          </span>
        </Html>
      )}
    </>
  );
}
