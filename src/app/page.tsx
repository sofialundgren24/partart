import Link from "next/link";
import { Fruit, type FruitKind } from "@/components/Fruit";
import { MODES } from "@/lib/design/modes";

const JOURNEY: { k: string; fruit: FruitKind; t: string; d: string }[] = [
  { k: "Upload", fruit: "orange", t: "Upload anything", d: "Photos from any side, a description, real or target size — or a 3D scan." },
  { k: "Understand", fruit: "lemon", t: "Understand it", d: "Components, proportions, symmetry. What was seen, inferred or assumed — labelled." },
  { k: "Design", fruit: "strawberry", t: "Make it your way", d: "Realistic print, plywood, acrylic, paper, mixed media… or one part at a time." },
  { k: "Deconstruct", fruit: "tomato", t: "Break it into parts", d: "Every part gets an ID, a material, a method and real geometry." },
  { k: "Manufacture", fruit: "apple", t: "Your build kit", d: "STL, 3MF, SVG, DXF, PDF — validated, kerf-compensated, slicer-ready." },
  { k: "Assemble", fruit: "pear", t: "Put it together", d: "Illustrated steps, adhesives per joint, and a shopping list." },
];

export default function Home() {
  return (
    <main>
      <section className="relative overflow-hidden border-b-2 border-ink">
        <div className="halftone absolute inset-0 opacity-50" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-5 py-16 md:grid-cols-[1.2fr_1fr] md:py-24">
          <div>
            <p className="hand mb-3 text-xl">from any reference to a real, buildable object</p>
            <h1 className="riso text-6xl font-black leading-[0.95] md:text-8xl">
              Break things<br />into <span className="text-tomato">parts.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              Photograph a house, a doll, a car or anything you love. PARTART works out its parts, lets you choose how to make each one,
              and hands you the actual files, materials and instructions to build it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/create" className="btn btn-primary text-lg">Start with a photo →</Link>
              <Link href="/projects" className="btn">Your projects</Link>
            </div>
          </div>
          <ExplodingHouse />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="riso riso-pink mb-10 text-4xl font-black">Six steps, one journey</h2>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {JOURNEY.map((j, i) => (
            <li key={j.k} className="card peel-in p-5" style={{ animationDelay: `${i * 70}ms` }}>
              <div className="flex items-start gap-4">
                <Fruit kind={j.fruit} size={64} />
                <div>
                  <span className="font-mono text-xs text-ink-soft">0{i + 1} · {j.k.toUpperCase()}</span>
                  <h3 className="font-display text-2xl font-bold">{j.t}</h3>
                  <p className="mt-1 text-sm text-ink-soft">{j.d}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y-2 border-ink bg-plum py-14 text-paper">
        <div className="mx-auto max-w-7xl px-5">
          <h2 className="riso mb-2 text-4xl font-black text-paper">Make it your way</h2>
          <p className="mb-8 max-w-2xl text-paper/80">The same reference, ten ways to build it. Mix them freely — the roof in wood, windows in acrylic, ornaments printed.</p>
          <div className="flex flex-wrap gap-3">
            {MODES.map((m) => (
              <div key={m.key} className="flex items-center gap-2 rounded-full border-2 border-paper/70 bg-paper/10 px-3 py-1.5">
                <Fruit kind={m.fruit} size={26} />
                <span className="font-semibold">{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-2">
        <div>
          <h2 className="riso mb-4 text-4xl font-black">Honest by design</h2>
          <ul className="space-y-3 text-ink-soft">
            <li>• A single photo can&apos;t give exact 3D. Every dimension is tagged <b>observed</b>, <b>inferred</b>, <b>assumed</b> or <b>yours</b>, and PARTART asks for the views that would actually help.</li>
            <li>• Files are real and checked: watertight meshes re-read after writing, closed cut paths, kerf compensation, build-volume splitting with alignment pins.</li>
            <li>• Print time and filament come from your slicer. Prices are never invented — the shopping list gives quantities and verified shops only.</li>
            <li>• A valid mesh isn&apos;t a structural guarantee. PARTART checks fit, not strength.</li>
          </ul>
        </div>
        <div className="card halftone-tomato flex flex-col justify-center gap-3 p-8">
          <p className="font-mono text-xs">YOUR BUILD KIT</p>
          {["01_REFERENCE", "02_3D_MODELS", "03_3D_PRINT", "04_LASER_CUT", "05_MATERIALS", "06_ASSEMBLY", "07_TUTORIALS", "08_DOCUMENTATION"].map((f) => (
            <div key={f} className="flex items-center gap-2 rounded-lg border-2 border-ink bg-paper px-3 py-1.5 font-mono text-sm"><FolderIcon /> {f}/</div>
          ))}
        </div>
      </section>
    </main>
  );
}

/** Animated component breakdown: a house that separates into its parts and comes back together. */
function ExplodingHouse() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-md">
      <style>{`
        @keyframes up { 0%,20%,100% { transform: translateY(0) } 45%,75% { transform: translateY(-34px) } }
        @keyframes up2 { 0%,20%,100% { transform: translateY(0) } 45%,75% { transform: translateY(-64px) rotate(-4deg) } }
        @keyframes out-l { 0%,20%,100% { transform: translateX(0) } 45%,75% { transform: translateX(-30px) } }
        @keyframes out-r { 0%,20%,100% { transform: translateX(0) } 45%,75% { transform: translateX(30px) } }
        @keyframes down { 0%,20%,100% { transform: translateY(0) } 45%,75% { transform: translateY(22px) } }
        .eh-roof { animation: up 5s ease-in-out infinite; }
        .eh-chim { animation: up2 5s ease-in-out infinite; transform-origin: 300px 120px; }
        .eh-wl { animation: out-l 5s ease-in-out infinite; }
        .eh-wr { animation: out-r 5s ease-in-out infinite; }
        .eh-base { animation: down 5s ease-in-out infinite; }
      `}</style>
      <svg viewBox="0 0 460 420" className="h-full w-full">
        <circle cx="220" cy="220" r="170" fill="#f2d36b" opacity=".55" />
        <g className="eh-base">
          <rect x="70" y="330" width="290" height="22" rx="4" fill="#8f8a80" stroke="#2d1f33" strokeWidth="3" />
          <text x="372" y="347" className="font-mono" fontSize="11" fill="#2d1f33">C-BASE-01</text>
        </g>
        <g className="eh-wl">
          <rect x="95" y="200" width="120" height="130" fill="#e9d8b8" stroke="#2d1f33" strokeWidth="3" />
          <rect x="120" y="230" width="34" height="42" fill="#8fb8c9" stroke="#2d1f33" strokeWidth="3" />
          <rect x="165" y="262" width="34" height="68" fill="#6b3e2e" stroke="#2d1f33" strokeWidth="3" />
        </g>
        <g className="eh-wr">
          <rect x="215" y="200" width="120" height="130" fill="#ecdcbd" stroke="#2d1f33" strokeWidth="3" />
          <rect x="255" y="230" width="34" height="42" fill="#8fb8c9" stroke="#2d1f33" strokeWidth="3" />
          <text x="340" y="215" className="font-mono" fontSize="11" fill="#2d1f33">C-BODY-01</text>
        </g>
        <g className="eh-roof">
          <path d="M80 204 L215 110 L350 204 Z" fill="#e8553f" stroke="#2d1f33" strokeWidth="3" strokeLinejoin="round" />
          <path d="M80 204 L215 110 L350 204" fill="none" stroke="#2d1f33" strokeWidth="3" transform="translate(4 3)" opacity=".25" />
          <text x="16" y="170" className="font-mono" fontSize="11" fill="#2d1f33">C-ROOF-01</text>
        </g>
        <g className="eh-chim">
          <rect x="280" y="112" width="26" height="52" fill="#9c4a36" stroke="#2d1f33" strokeWidth="3" />
        </g>
        <text x="40" y="400" className="hand" fontSize="18" fill="#e8553f">↑ every part gets an ID</text>
      </svg>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden>
      <path d="M1 3h6l2 2h8v8H1z" fill="#f29b38" stroke="#2d1f33" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
