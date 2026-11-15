// Tolerant matching of what was heard against what can be said (doc «Interacción v2» §2.4). No LLM (H19):
// normalized text → a Spanish-aware phonetic key → edit distance. Recognisers confuse b/v, s/c/z, ll/y and drop the h;
// this folds those away so «Durango», «durango», «Duranco» land on the same place.

/** Phonetic key for Spanish and English words heard by a recogniser. Input must be normalized (lower case, no accents). */
export function phonetic(s: string): string {
  return s
    .replace(/ch/g, "C")
    .replace(/ll/g, "y")
    .replace(/qu/g, "k")
    .replace(/c([ei])/g, "s$1")
    .replace(/c/g, "k")
    .replace(/z/g, "s")
    .replace(/v/g, "b")
    .replace(/w/g, "u")
    .replace(/g([ei])/g, "j$1")
    .replace(/x/g, "ks")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/(^|\s)h/g, "$1")
    .replace(/([^C\s])h/g, "$1")
    .replace(/(.)\1+/g, "$1")
    .trim();
}

/** Levenshtein distance with an early exit once `max` is exceeded. */
export function distance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Similarity in [0, 1] of two normalized phrases, on their phonetic keys. */
export function similarity(a: string, b: string): number {
  const pa = phonetic(a), pb = phonetic(b);
  const n = Math.max(pa.length, pb.length);
  if (!n) return 1;
  return 1 - distance(pa, pb) / n;
}

export interface Scored<T> { item: T; score: number }

/**
 * Ranks candidates by their best-matching phrase. Returns the ones at or above `min`, best first.
 * A clear winner is `ranked[0].score - (ranked[1]?.score ?? 0) >= margin` — the caller decides; ties are shown numbered.
 */
export function rank<T>(heard: string, items: T[], phrases: (t: T) => readonly string[], min = 0.72): Scored<T>[] {
  const out: Scored<T>[] = [];
  for (const item of items) {
    let best = 0;
    for (const p of phrases(item)) {
      if (!p) continue;
      const s = similarity(heard, p);
      if (s > best) best = s;
    }
    if (best >= min) out.push({ item, score: best });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** True if `text` equals one of the phrases, exactly or within a small phonetic slip (short commands only). */
export function saysOneOf(text: string, phrases: readonly string[], min = 0.84): boolean {
  if (phrases.includes(text)) return true;
  if (text.length > 28) return false;
  return phrases.some((p) => Math.abs(p.length - text.length) <= 3 && similarity(text, p) >= min);
}

/** True if any phrase occurs in `text` as whole words. */
export function containsOneOf(text: string, phrases: readonly string[]): string | null {
  const t = ` ${text} `;
  for (const p of phrases) if (t.includes(` ${p} `)) return p;
  return null;
}
