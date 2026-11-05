// Original fruit illustrations in a two-plate riso style (a colour plate + an ink plate offset by a hair).
// Metaphors: orange = peeling/uncovering, apple = sections, strawberry = layers, pear = assembly,
// tomato = cross-sections, lemon = precision.

type FruitKind = "orange" | "apple" | "strawberry" | "pear" | "tomato" | "lemon";

const INK = "#2d1f33";

export function Fruit({ kind, size = 64, className = "" }: { kind: FruitKind; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden>
      <defs>
        <pattern id={`dots-${kind}`} width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="1.1" fill={INK} opacity=".28" />
        </pattern>
      </defs>
      {SHAPES[kind]}
    </svg>
  );
}

const SHAPES: Record<FruitKind, React.ReactNode> = {
  orange: (
    <g>
      {/* peel spiral lifting off */}
      <path d="M50 18c18 0 32 14 32 32S68 82 50 82 18 68 18 50" fill="#f29b38" transform="translate(2 2)" />
      <path d="M50 18c18 0 32 14 32 32S68 82 50 82 18 68 18 50" fill="url(#dots-orange)" />
      <path d="M18 50c0-10 4-19 12-25" fill="none" stroke="#f29b38" strokeWidth="7" strokeLinecap="round" transform="translate(-6 -8) rotate(-18 30 30)" />
      {/* segments revealed */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} d="M50 50 L50 24" stroke="#fff3df" strokeWidth="2.2" transform={`rotate(${a} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="32" fill="none" stroke={INK} strokeWidth="2.5" strokeDasharray="150 52" />
      <path d="M54 16c4-6 10-8 16-7-3 6-8 9-16 7z" fill="#7a9a5b" stroke={INK} strokeWidth="2" />
    </g>
  ),
  apple: (
    <g>
      <path d="M48 28c-14-8-32 2-30 24 2 20 14 32 26 30 4-1 6-2 6-2s2 1 6 2c12 2 24-10 26-30 2-22-16-32-30-24z" fill="#e8553f" transform="translate(2 2)" />
      {/* a slice taken out: sections */}
      <path d="M50 30 L50 84 L84 56 Z" fill="#fff3df" stroke={INK} strokeWidth="2" />
      <path d="M58 52c2 3 2 6 0 8M64 50c2 3 2 6 0 8" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M48 28c-14-8-32 2-30 24 2 20 14 32 26 30" fill="none" stroke={INK} strokeWidth="2.5" />
      <path d="M50 28c0-8 2-14 6-18" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M56 14c8-4 16-2 20 4-8 4-14 3-20-4z" fill="#7a9a5b" stroke={INK} strokeWidth="2" />
    </g>
  ),
  strawberry: (
    <g>
      {/* stacked layers */}
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${22 + i * 6} ${40 + i * 12} Q50 ${46 + i * 14} ${78 - i * 6} ${40 + i * 12}`} fill="none" stroke={i % 2 ? "#e86a92" : "#e8553f"} strokeWidth="9" strokeLinecap="round" />
      ))}
      <path d="M20 36c0 26 18 48 30 50 12-2 30-24 30-50-10-8-50-8-60 0z" fill="url(#dots-strawberry)" stroke={INK} strokeWidth="2.5" />
      {[[34, 48], [50, 50], [66, 48], [42, 62], [58, 62], [50, 74]].map(([x, y]) => (
        <ellipse key={`${x}${y}`} cx={x} cy={y} rx="1.6" ry="2.4" fill="#f2d36b" stroke={INK} strokeWidth="1" />
      ))}
      <path d="M28 34l10-12 6 10 6-14 6 14 6-10 10 12" fill="#7a9a5b" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </g>
  ),
  pear: (
    <g>
      {/* two halves coming together: assembly */}
      <path d="M48 20c-6 0-8 8-8 16 0 6-16 14-16 30 0 14 10 22 24 22z" fill="#a7c26b" transform="translate(-4 0)" stroke={INK} strokeWidth="2.5" />
      <path d="M52 20c6 0 8 8 8 16 0 6 16 14 16 30 0 14-10 22-24 22z" fill="#c9d77b" transform="translate(4 0)" stroke={INK} strokeWidth="2.5" />
      <path d="M56 20c0 0 6 0 6 0" stroke={INK} />
      <path d="M50 20c0-6 2-10 6-12" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M40 56l-6 0M66 56l6 0" stroke="#e8553f" strokeWidth="3" strokeLinecap="round" />
      <path d="M36 52l-4 4 4 4M64 52l4 4-4 4" stroke="#e8553f" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  ),
  tomato: (
    <g>
      <circle cx="52" cy="54" r="32" fill="#e8553f" />
      <circle cx="50" cy="52" r="32" fill="none" stroke={INK} strokeWidth="2.5" />
      {/* cross-section chambers */}
      <circle cx="50" cy="52" r="22" fill="#f6a08f" stroke={INK} strokeWidth="1.5" />
      {[0, 120, 240].map((a) => (
        <g key={a} transform={`rotate(${a} 50 52)`}>
          <path d="M50 52 L50 32" stroke={INK} strokeWidth="1.8" />
          <ellipse cx="58" cy="42" rx="5" ry="7" fill="#fff3df" stroke={INK} strokeWidth="1.2" />
          {[0, 1, 2].map((s) => <circle key={s} cx={56 + s * 2} cy={38 + s * 3} r="1.2" fill="#f2d36b" />)}
        </g>
      ))}
      <path d="M40 22l10 6 10-6-4 8 8 2-14 2-14-2 8-2z" fill="#7a9a5b" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
    </g>
  ),
  lemon: (
    <g>
      <ellipse cx="52" cy="54" rx="34" ry="26" fill="#f2d36b" transform="rotate(-20 52 54)" />
      <ellipse cx="50" cy="52" rx="34" ry="26" fill="url(#dots-lemon)" stroke={INK} strokeWidth="2.5" transform="rotate(-20 50 52)" />
      {/* precision crosshair */}
      <circle cx="50" cy="52" r="10" fill="none" stroke="#e8553f" strokeWidth="2" />
      <path d="M50 36v32M34 52h32" stroke="#e8553f" strokeWidth="1.5" />
      <path d="M78 30c4-4 8-4 10-2" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </g>
  ),
};

export type { FruitKind };
