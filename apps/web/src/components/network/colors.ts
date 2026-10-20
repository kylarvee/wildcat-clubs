import type { NetworkCollege } from "@/lib/analytics/network-model";

/**
 * College colors for the network canvas: the dataviz reference categorical
 * palette in its fixed order (validated on white — lightness, chroma, adjacent
 * CVD and normal-vision separation all pass). Colleges take slots in
 * alphabetical order, so a college keeps its color whatever the window or
 * grouping. Seven colleges is past what color alone can carry when any two
 * nodes may sit side by side, so color is never the only cue: the legend
 * isolates a college on click, tooltips and the panel name it, labels sit on
 * the canvas, and the table view lists everything.
 */
export const COLLEGE_SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"] as const;

/** Clubs that aren't part of a college (university-wide, independent, sports) — and any college past the eighth. */
export const NO_COLLEGE = "#8d8796";

/** Wildcat purple for "your clubs" and selection, so highlights never read as a college. */
export const HIGHLIGHT = "#5b2d7e";
export const INK = "#17131c";
/** Dashed ring on clubs you're a member of (purple HIGHLIGHT is for clubs you lead). */
export const MINE_GRAY = "#5e5866";
export const LINE = "#4a4453";

/**
 * The same hues in the same order, lifted for the landing page's dark band, so a
 * college keeps its color family wherever the map is drawn.
 */
export const COLLEGE_SLOTS_NIGHT = ["#6ea9ff", "#ff9467", "#45d6a4", "#ffcb57", "#ffa3c6", "#68cc68", "#a395ff", "#ff7b7a"] as const;
/** University-wide and independent clubs read as soft lavender on the dark map, part of the palette rather than a gray hole. */
export const NO_COLLEGE_NIGHT = "#b2a4de";

export type CanvasThemeName = "light" | "night";

/** Everything the canvas paints that isn't a college color. */
export type CanvasTheme = {
  /** The ground: node rings and the discs under faded nodes are drawn in it. */
  surface: string;
  line: string;
  /** Multiplies every resting line's opacity. */
  lineAlpha: number;
  /** Lines and rings of whatever you point at, select or the spotlight is on. */
  highlight: string;
  selectGlow: string;
  ink: string;
  inkSoft: string;
  mineGray: string;
  /** Clubs with no lines yet sit back as small quiet dots in this color (their college color while that college is isolated). */
  quiet: string;
  quietAlpha: number;
  /** Soft glow behind the busiest clubs. */
  glow: boolean;
  /** Labels on a small pill (dark map) or with a halo (light map). */
  pill: { fill: string; stroke: string } | null;
  halo: string;
};

export const CANVAS_THEMES: Record<CanvasThemeName, CanvasTheme> = {
  light: {
    surface: "#ffffff",
    line: LINE,
    lineAlpha: 1,
    highlight: HIGHLIGHT,
    selectGlow: "rgba(91,45,126,0.16)",
    ink: INK,
    inkSoft: "#4a4453",
    mineGray: MINE_GRAY,
    quiet: "#bcb6c5",
    quietAlpha: 0.65,
    glow: false,
    pill: null,
    halo: "rgba(255,255,255,0.92)",
  },
  night: {
    surface: "#130d1a",
    line: "#c7b6f2",
    lineAlpha: 0.95,
    highlight: "#efe3ff",
    selectGlow: "rgba(214,195,232,0.22)",
    ink: "#ffffff",
    inkSoft: "rgba(255,255,255,0.72)",
    mineGray: "#bdb4cc",
    quiet: "#a79fb5",
    quietAlpha: 0.3,
    glow: true,
    pill: { fill: "rgba(19,13,26,0.86)", stroke: "rgba(255,255,255,0.14)" },
    halo: "rgba(19,13,26,0.9)",
  },
};

export function collegeColors(colleges: NetworkCollege[], theme: CanvasThemeName = "light"): Map<string, string> {
  const slots = theme === "night" ? COLLEGE_SLOTS_NIGHT : COLLEGE_SLOTS;
  const none = theme === "night" ? NO_COLLEGE_NIGHT : NO_COLLEGE;
  return new Map(colleges.map((c, i) => [c.id, slots[i] ?? none]));
}

/** "#rrggbb" at an opacity, for gradients. */
export function withAlpha(hex: string, alpha: number): string {
  const v = hex.replace("#", "");
  const n = parseInt(v.length === 3 ? v.replace(/./g, (c) => c + c) : v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function colorOf(colors: Map<string, string>, collegeId: string | null): string {
  return (collegeId && colors.get(collegeId)) || NO_COLLEGE;
}
