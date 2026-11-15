// Writing without a keyboard (doc «Interacción v2» §2.4): what is dictated is TEXT, never a command.
// Only a few whole-utterance edits are understood («borra la última frase», «cambia veinte por treinta»,
// «nueva línea»); anything else is appended with spoken punctuation turned into signs. Pure: (draft, heard) → result.

import { normalize } from "@/core/assistant/patterns";
import { spokenToDigits } from "./numbers";
import { EDIT, PUNCT } from "./vocab";

export type DictationOp = "append" | "deleteSentence" | "deleteWord" | "clear" | "undo" | "newLine" | "replace" | "readBack" | "noMatch";

export interface DictationResult {
  text: string;
  op: DictationOp;
  /** For «replace»: what was replaced, to say it back («cambié 20 por 30»). */
  detail?: { from: string; to: string };
}

/** Whole-utterance match against one edit command. */
const said = (list: readonly string[], n: string): boolean => list.includes(n);

/** Spoken punctuation → signs, on the raw text (keeps the case and accents of what was dictated). */
export function punctuate(raw: string): string {
  let s = ` ${raw.trim()} `;
  for (const [said, sign] of PUNCT) {
    const re = new RegExp(`\\s${accentTolerant(said).replace(/ /g, "\\s+")}(?=\\s)`, "gi");
    s = s.replace(re, sign === "¿" || sign === "¡" || sign === "(" ? ` ${sign}` : sign);
  }
  return s.replace(/([¿¡(])\s+/g, "$1").replace(/\s+([.,;:?!)])/g, "$1").replace(/[ \t]+/g, " ").trim();
}

/** «interrogacion» also matches «interrogación» in the raw transcript. */
function accentTolerant(s: string): string {
  const V: Record<string, string> = { a: "[aá]", e: "[eé]", i: "[ií]", o: "[oó]", u: "[uúü]" };
  return s.replace(/[aeiou]/g, (c) => V[c]);
}

function capitalizeAfterStops(s: string): string {
  return s.replace(/(^|[.?!]\s+|\n\s*|[¿¡])(\p{Ll})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}

function deleteLastSentence(draft: string): string {
  const t = draft.replace(/\s+$/, "");
  const cut = t.replace(/[.?!]$/, "");
  const i = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("?"), cut.lastIndexOf("!"), cut.lastIndexOf("\n"));
  return i < 0 ? "" : t.slice(0, i + 1);
}

/** Applies one dictated utterance to the draft. `prev` is the draft before the last change (for «deshaz»). */
export function applyDictation(draft: string, heard: string, prev: string | null = null): DictationResult {
  const n = normalize(heard);
  if (!n) return { text: draft, op: "noMatch" };
  if (said(EDIT.deleteSentence, n)) return { text: deleteLastSentence(draft), op: "deleteSentence" };
  if (said(EDIT.deleteWord, n)) return { text: draft.replace(/\s*\S+\s*$/, ""), op: "deleteWord" };
  if (said(EDIT.clearAll, n)) return { text: "", op: "clear" };
  if (said(EDIT.undo, n)) return { text: prev ?? draft, op: "undo" };
  if (said(EDIT.newLine, n)) return { text: `${draft.replace(/\s+$/, "")}\n`, op: "newLine" };
  if (said(EDIT.readBack, n)) return { text: draft, op: "readBack" };

  // «cambia X por Y»: X is searched in the draft by its normalized form (numbers as digits), the last occurrence wins.
  const verb = EDIT.replace.find((v) => n.startsWith(`${v} `));
  if (verb) {
    const rest = spokenToDigits(n.slice(verb.length + 1));
    for (const by of EDIT.replaceBy) {
      const k = rest.lastIndexOf(` ${by} `);
      if (k <= 0) continue;
      const from = rest.slice(0, k).trim();
      const to = rest.slice(k + by.length + 2).trim();
      const hit = findLast(draft, from);
      if (hit) return { text: draft.slice(0, hit[0]) + to + draft.slice(hit[1]), op: "replace", detail: { from: draft.slice(hit[0], hit[1]), to } };
    }
  }

  const piece = punctuate(heard);
  if (!piece) return { text: draft, op: "noMatch" };
  const glue = !draft || /[\n¿¡(]$/.test(draft) || /^[.,;:?!)]/.test(piece) ? "" : " ";
  return { text: capitalizeAfterStops(draft + glue + piece), op: "append" };
}

/** Last span of `draft` whose normalized words equal `target` (already normalized, digits). */
function findLast(draft: string, target: string): [number, number] | null {
  const words = [...draft.matchAll(/\S+/g)].map((m) => ({ s: m.index!, e: m.index! + m[0].length, n: spokenToDigits(normalize(m[0])) }));
  const want = target.split(" ").filter(Boolean);
  if (!want.length) return null;
  for (let i = words.length - want.length; i >= 0; i--) {
    if (want.every((w, j) => words[i + j].n === w)) {
      // keep trailing punctuation of the last word outside the replaced span
      const last = words[i + want.length - 1];
      const tail = draft.slice(last.s, last.e).match(/[.,;:?!)]+$/)?.[0].length ?? 0;
      return [words[i].s, last.e - tail];
    }
  }
  return null;
}
