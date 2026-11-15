// INPUT vocabulary of the assistant: words people may type or say, in Spanish and English.
// These strings are never shown on screen, so this file is exempt from the text lint (scripts/lint-texts.mjs):
// people may well ask "¿cuál es la causa?" and the assistant must recognise it to answer within its limits.

/** Lower case, no accents, no punctuation, single spaces. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d)[.,](\d)/g, "$1‧$2") // keep decimals (24.5 or 24,5) through the punctuation strip
    .replace(/[¿?¡!.,;:()"'«»]/g, " ")
    .replace(/‧/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

const any = (words: string[]) => new RegExp(`(^|\\s)(${words.join("|")})(\\s|$)`);
const has = (words: string[]) => new RegExp(words.join("|"));

export const P = {
  // Out of scope (SANTUARIO H17): advice, what to do.
  advice: has(["que (debo|deberia|tengo que|puedo) hacer", "que hago", "recomiend", "recomendacion", "consejo", "aconsej", "deberia",
    "what should i", "should i", "what do i do", "recommend", "advice", "advise"]),
  // Causes (H16): the assistant detects, it does not explain why.
  cause: has(["por que", "porque sube", "porque baja", "causa", "culpa", "debido a", "why", "cause", "reason", "due to"]),
  help: has(["ayuda", "que puedes", "que sabes", "como funciona", "como se usa", "que haces", "help", "what can you", "how does it work", "how do i use"]),
  greet: any(["hola", "buenas", "buenos dias", "buenas tardes", "hey", "hello", "hi", "good morning"]),
  legend: has(["rayad", "punte", "solido", "gris", "leyenda", "colores", "que significa", "que quiere decir", "simbolo",
    "stripe", "dotted", "dots", "solid", "legend", "what does .* mean", "colou?rs"]),
  contrast: has(["contraste", "ingenu", "corregid", "correccion", "falsos positivos", "comparar metodos", "contrast", "naive", "false positive", "correction"]),
  provenance: has(["de donde", "fuente", "datos son", "que datos", "procedencia", "nasa", "dataset", "licencia", "where .* data", "source", "provenance", "which data", "licen"]),
  detect: has(["cuanto falta", "cuantos anos (mas|faltan)", "estar segur", "seguro", "se puede saber", "cuando se sabra", "detectab", "mde",
    "how long", "how many more years", "be sure", "certain", "when will we know", "knowable"]),
  compare: has(["compara", "24 (y|vs|contra) 45", "45 (y|vs|contra) 24", "diferencia entre (las )?ventanas", "compare", "versus"]),
  accumulated: has(["acumulad", "evolucion de la evidencia", "hasta (el )?(19|20)\\d\\d", "accumulat", "evidence over time", "until (19|20)\\d\\d"]),
  yearMode: has(["ano a ano", "por ano", "anual", "year by year", "yearly", "each year"]),
  full: has(["ventana completa", "todo el periodo", "periodo completo", "full window", "whole period"]),
  summary: has(["resumen", "que cambio", "que esta cambiando", "que cambia", "panorama", "en general", "summary", "what changed", "what is changing", "overview"]),
  expert: any(["experto", "tecnico", "modo experto", "detalle", "mas detalle", "expert", "technical", "more detail"]),
  plain: any(["sencillo", "simple", "facil", "modo sencillo", "plain", "simpler"]),
  english: has(["ingles", "english", "in english"]),
  spanish: has(["espanol", "spanish", "castellano", "en espanol"]),
  // Only as an explicit request: «claro» is also an everyday word.
  dark: has(["(modo|tema) oscuro", "^oscuro$", "dark (mode|theme)", "^dark$"]),
  light: has(["(modo|tema) claro", "^claro$", "light (mode|theme)", "^light$"]),
  mars: has(["marte", "mars"]),
  person: has(["persona", "astronauta", "person", "astronaut"]),
  earth: has(["tierra", "earth"]),
  undo: has(["no era eso", "eso no", "deshacer", "regresa", "atras", "not that", "undo", "go back"]),
  clear: has(["borrar (la )?conversacion", "limpiar", "empezar de nuevo", "reinicia", "clear", "start over", "reset"]),
  // «muéstrame solo …»: highlight one kind of verdict on the map.
  only: has(["solo", "solamente", "unicamente", "nada mas", "only", "just"]),
  fDetected: has(["detectad", "ya se sabe", "cambio real", "detected", "real change"]),
  fUnknown: has(["aun no", "todavia no", "incierto", "no se puede saber", "rayad", "not yet", "unknown", "uncertain"]),
  fNoChange: has(["sin cambio", "no cambia", "gris", "no change"]),
  fPossible: has(["posible", "punte", "candidat", "possible"]),
  unfilter: has(["quita(r)? (el )?filtro", "todo de nuevo", "mostrar todo", "muestra todo", "ver todo", "show all", "clear filter", "remove filter"]),
  world: has(["mundo", "planeta", "todo el mapa", "alejar", "world", "whole map", "zoom out"]),
  window: /(\d{2})\s*(anos|years|yr)/,
  year: /\b(19\d\d|20\d\d)\b/,
  coord: /(-?\d{1,2}(?:[.,]\d+)?)\s*[°]?\s*(n|s)?\s*[ ,;]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[°]?\s*(e|o|w)?\b/,
};
