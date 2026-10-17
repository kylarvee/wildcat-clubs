/**
 * File and folder names. Client-safe, so the explorer can check a rename
 * before it reaches the server (which checks again).
 */

export const MAX_NAME_LENGTH = 200;

/** Trims, folds whitespace and drops control characters and slashes (they'd break paths in Drive and on disk). */
export function cleanName(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

/** Why a name can't be used, or null when it's fine. */
export function nameProblem(raw: string): string | null {
  const name = cleanName(raw);
  if (!name) return "Give it a name.";
  if (name === "." || name === "..") return "That name is reserved. Try another.";
  if (raw.trim().length > MAX_NAME_LENGTH) return `Names can be up to ${MAX_NAME_LENGTH} characters.`;
  return null;
}

/** "report.final.pdf" → ["report.final", ".pdf"]; folders and dotfiles have no extension. */
export function splitExt(name: string, isFolder = false): [string, string] {
  if (isFolder) return [name, ""];
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

/**
 * A name that doesn't clash (case-insensitively) with `taken`:
 * "Flyer.png" → "Flyer (2).png", "New folder" → "New folder 2".
 */
export function uniqueName(name: string, taken: Iterable<string>, isFolder = false): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const [base, ext] = splitExt(name, isFolder);
  const stem = base.replace(isFolder ? / \d+$/ : / \(\d+\)$/, "");
  for (let i = 2; i < 10_000; i++) {
    const candidate = isFolder ? `${stem} ${i}` : `${stem} (${i})${ext}`;
    if (!lower.has(candidate.toLowerCase())) return candidate.slice(0, MAX_NAME_LENGTH);
  }
  return `${stem} ${Date.now()}${ext}`;
}
