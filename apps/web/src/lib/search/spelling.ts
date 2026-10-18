/**
 * "Close spellings": when nothing matches, each word the index doesn't know
 * is swapped for the nearest word it does (by edit distance on the stem
 * Postgres made of it, or on the word as typed). Pure; the vocabulary comes
 * from the index itself (ts_stat), so a correction can only point at words
 * some club's visible page actually uses.
 */

/** Optimal string alignment distance (adjacent swaps count as one), stopping early past `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/** Typos allowed: one for 4–5 letters, two from 6. Shorter words aren't corrected. */
export const allowedTypos = (length: number) => (length < 4 ? 0 : length <= 5 ? 1 : 2);

/**
 * The vocabulary word closest to any of `forms` (the stem and the word as
 * typed), or null. Same first letter (typos rarely hit it), fewest edits,
 * then the word more clubs use, then the longer shared start.
 */
export function closestWord(forms: string[], vocab: Map<string, number>): string | null {
  let best: { word: string; d: number; ndoc: number; shared: number } | null = null;
  for (const form of new Set(forms.filter(Boolean))) {
    const max = allowedTypos(form.length);
    if (!max) continue;
    for (const [word, ndoc] of vocab) {
      if (word[0] !== form[0] || Math.abs(word.length - form.length) > max) continue;
      const d = editDistance(form, word, max);
      if (d > max) continue;
      let shared = 0;
      while (shared < word.length && word[shared] === form[shared]) shared++;
      if (!best || d < best.d || (d === best.d && (ndoc > best.ndoc || (ndoc === best.ndoc && shared > best.shared)))) best = { word, d, ndoc, shared };
    }
  }
  return best?.word ?? null;
}
