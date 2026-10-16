/**
 * Decorative backdrop for the landing hero: a loose web of clubs (dots)
 * linked by shared members (lines) — the idea behind the network canvas.
 * Fixed coordinates, so it renders identically on server and client.
 */
const NODES: [number, number, number][] = [
  [520, 70, 9], [640, 40, 5], [740, 120, 12], [610, 170, 6], [860, 70, 7], [900, 210, 10], [700, 260, 5],
  [800, 330, 8], [560, 300, 11], [470, 200, 5], [960, 360, 6], [650, 420, 7], [880, 470, 12], [520, 450, 6],
  [760, 520, 5], [990, 120, 5], [420, 360, 7], [1000, 520, 8],
];
const EDGES: [number, number, number][] = [
  [0, 1, 1], [0, 3, 2], [1, 2, 1], [2, 3, 3], [2, 4, 2], [4, 5, 2], [2, 5, 1], [3, 6, 1], [5, 7, 3], [6, 7, 1],
  [3, 8, 2], [8, 9, 1], [0, 9, 1], [7, 10, 1], [7, 11, 2], [8, 11, 2], [11, 12, 1], [10, 12, 2], [11, 13, 1],
  [12, 14, 1], [13, 16, 1], [8, 16, 1], [4, 15, 1], [12, 17, 2], [5, 10, 1],
];

export function HeroPattern({ className }: { className?: string }) {
  return (
    <svg viewBox="380 0 660 580" preserveAspectRatio="xMaxYMid slice" className={className} aria-hidden="true" focusable="false">
      <g stroke="#d6c3e8" strokeLinecap="round">
        {EDGES.map(([a, b, w], i) => (
          <line key={i} x1={NODES[a][0]} y1={NODES[a][1]} x2={NODES[b][0]} y2={NODES[b][1]} strokeWidth={w * 1.1} strokeOpacity={0.18 + w * 0.08} />
        ))}
      </g>
      <g>
        {NODES.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={i % 4 === 0 ? "#c9b3e6" : "#ebe1f4"} fillOpacity={0.55} stroke="#3b1c52" strokeWidth={2} />
        ))}
      </g>
    </svg>
  );
}
