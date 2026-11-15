// Text lint (doc 04 §4): no forbidden word may appear in interface text.
// Scans string literals and JSX text in src/ (comments are skipped). Runs before every build; exit 1 on a hit.
//   npm run lint:texts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "src");
// Same list as FORBIDDEN in src/core/i18n/texts.ts. «no hay cambio» is allowed only next to δ.
const FORBIDDEN = [/prueba/i, /causa/i, /predic/i, /recomend/i, /debería/i, /peligro/i, /diagnós/i, /no hay cambio(?![^"'`]*δ)/i, /riesgo(?!_potencial)/i, /urgente/i];
// Files that hold the list itself.
const SKIP = new Set(["core/i18n/texts.ts"].map((p) => join(SRC, p)));
// INPUT vocabulary of the assistant (what people may type or say; never shown on screen).
const INPUT_ONLY = new Set(["core/assistant/patterns.ts", "core/interaction/vocab.ts"].map((p) => join(SRC, p)));

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mjs)$/.test(f) ? [p] : [];
  });
}

/** Removes // and /* *\/ comments without touching strings. */
function stripComments(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) { out += c; if (c === "\\") { out += d ?? ""; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

let hits = 0;
for (const f of files(SRC).filter((x) => !INPUT_ONLY.has(x))) {
  const text = SKIP.has(f) ? stripComments(readFileSync(f, "utf8")).replace(/export const FORBIDDEN[^\n]*/, "") : stripComments(readFileSync(f, "utf8"));
  text.split("\n").forEach((line, n) => {
    for (const re of FORBIDDEN) {
      if (re.test(line)) {
        hits++;
        console.error(`${relative(join(here, ".."), f)}:${n + 1}  «${line.trim().slice(0, 100)}»  (${re.source})`);
      }
    }
  });
}
if (hits) {
  console.error(`\nlint:texts — ${hits} forbidden word(s). See doc 04 §4.`);
  process.exit(1);
}
console.log("lint:texts — ok");
