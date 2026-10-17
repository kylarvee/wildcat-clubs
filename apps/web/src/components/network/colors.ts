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

export function collegeColors(colleges: NetworkCollege[]): Map<string, string> {
  return new Map(colleges.map((c, i) => [c.id, COLLEGE_SLOTS[i] ?? NO_COLLEGE]));
}

export function colorOf(colors: Map<string, string>, collegeId: string | null): string {
  return (collegeId && colors.get(collegeId)) || NO_COLLEGE;
}
