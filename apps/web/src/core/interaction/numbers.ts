// Spoken numbers → digits, Spanish and English: «dos mil diez» → 2010, «mil novecientos ochenta y uno» → 1981,
// «nineteen eighty one» → 1981, «veinticinco» → 25. Recognisers write numbers either way; the parser only reads digits,
// so this runs on every utterance first. Pure and deterministic (doc «Interacción v2» §2.4).

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const HUNDRED = new Set(["hundred"]);
const THOUSAND = new Set(["mil", "thousand"]);
const JOINERS = new Set(["y", "and"]);
/** Words that are numbers only next to another number word («un», «una», «oh» are too common alone). */
const WEAK = new Set(["un", "una", "oh", "y", "and"]);

function isNumWord(w: string): boolean {
  return w in UNITS || HUNDRED.has(w) || THOUSAND.has(w);
}

/** Value of one run of number words, or null if the run is not a well-formed number. */
function runValue(ws: string[]): number | null {
  const words = ws.filter((w) => !JOINERS.has(w));
  if (!words.length) return null;
  // English year style: «nineteen eighty one» = 19 | 81, «twenty ten» = 20 | 10 (two groups, no hundred/thousand).
  if (!words.some((w) => HUNDRED.has(w) || THOUSAND.has(w))) {
    const groups: number[] = [];
    for (const w of words) {
      const v = UNITS[w];
      const last = groups.length - 1;
      // a unit after a tens word joins it: «eighty one» → 81, «ochenta y uno» → 81
      if (last >= 0 && groups[last] % 10 === 0 && groups[last] >= 20 && groups[last] < 100 && v < 10 && v > 0) groups[last] += v;
      else groups.push(v);
    }
    if (groups.length === 1) return groups[0];
    if (groups.length === 2 && groups[0] >= 10 && groups[0] < 100 && groups[1] >= 10 && groups[1] < 100) return groups[0] * 100 + groups[1];
    return null;
  }
  let total = 0;
  let cur = 0;
  for (const w of words) {
    if (THOUSAND.has(w)) { total += (cur || 1) * 1000; cur = 0; continue; }
    if (HUNDRED.has(w)) { cur = (cur || 1) * 100; continue; }
    cur += UNITS[w];
  }
  return total + cur;
}

/**
 * Replaces every run of number words in an already-normalized text by its digits.
 * «muestrame el ano dos mil diez» → «muestrame el ano 2010». Text without number words comes back unchanged.
 */
export function spokenToDigits(text: string): string {
  const words = text.split(" ");
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    if (!isNumWord(words[i]) || (WEAK.has(words[i]) && !isNumWord(words[i + 1] ?? ""))) { out.push(words[i]); i++; continue; }
    let j = i;
    const run: string[] = [];
    while (j < words.length && (isNumWord(words[j]) || (JOINERS.has(words[j]) && isNumWord(words[j + 1] ?? "")))) run.push(words[j++]);
    const v = runValue(run);
    if (v === null) out.push(...run);
    else out.push(String(v));
    i = j;
  }
  return out.join(" ");
}
