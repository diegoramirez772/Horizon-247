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
  // Reading level (doc v2 §2.5). One step first, so «más simple» is not read as «simple».
  deeper: has(["mas detalle", "mas a fondo", "mas profundo", "more detail", "go deeper"]),
  simpler: has(["mas simple", "mas sencillo", "menos detalle", "mas facil", "simpler", "less detail"]),
  // «normal» alone is an everyday word («¿es normal este calor?»): only as an explicit request.
  normal: has(["^normal$", "(modo|nivel|vista) normal", "normal (mode|level)", "^intermedio$", "modo intermedio"]),
  expert: any(["experto", "tecnico", "modo experto", "detalle", "expert", "technical"]),
  plain: any(["sencillo", "simple", "facil", "modo sencillo", "modo simple", "plain"]),
  // «¿Qué tan seguro?» = how often HORI is wrong (calibration), not «how long until we know» (detect).
  certainty: has(["que tan (segur|confiable|fiable|cierto)", "cuanto (le )?(puedo )?creer", "margen de error", "falsas alarmas", "se equivoca",
    "confiabilidad", "fiabilidad", "how sure", "how reliable", "how confident", "error rate", "false alarm", "how often .* wrong"]),
  english: has(["ingles", "english", "in english"]),
  spanish: has(["espanol", "spanish", "castellano", "en espanol"]),
  // Only as an explicit request: «claro» is also an everyday word.
  dark: has(["(modo|tema) oscuro", "^oscuro$", "dark (mode|theme)", "^dark$"]),
  light: has(["(modo|tema) claro", "^claro$", "light (mode|theme)", "^light$"]),
  // Topics that open their own components in the answer (generative interface, Plan de unión U3).
  livestock: has(["ganad", "vaca", "reses", "res ", "bovino", "becerr", "estres (termico|por calor)", "rancho", "cattle", "livestock", "cows", "heat stress", "ranch"]),
  astronaut: has(["astronaut", "tripula", "estacion espacial", "signos vitales", "iss\b", "crew", "space station", "vital signs"]),
  planets: has(["planetas", "sistema solar", "jupiter", "saturno", "venus", "mercurio", "neptuno", "urano", "la luna", "solar system", "planets", "the moon", "saturn", "jupiter"]),
  weatherNow: has(["clima", "como esta el tiempo", "que tiempo hace", "condiciones", "ahora mismo", "hoy", "weather", "right now", "conditions", "today"]),
  events: has(["incendio", "tormenta", "huracan", "ciclon", "volcan", "evento", "desastre", "que esta pasando en el mundo", "iceberg",
    "wildfire", "fire", "storm", "hurricane", "cyclone", "volcano", "event", "disaster"]),
  infrared: has(["infrarroj", "nubes", "satelite", "en vivo", "tiempo real", "infrared", "clouds", "satellite", "live", "real time"]),
  cameras: has(["camara", "video en vivo", "en vivo desde", "transmision", "webcam", "camera", "live feed", "live video", "stream", "como se ve el cielo", "el cielo ahora", "cielo en vivo", "foto del satelite", "imagen del satelite", "sky now", "satellite image", "satellite photo"]),
  joint: has(["cambio conjunto", "cambian? juntos?", "cambia junto", "cambian a la vez", "al mismo tiempo", "dos variables", "mas calor y menos", "mas calor y mas", "joint change", "change together", "changing together", "warmer and less", "warmer and more"]),
  alerts: has(["alerta", "anomal", "algo raro", "algo extrano", "pasa algo", "hay algo", "algo fuera de lo comun", "alert", "anything unusual", "anything wrong", "unusual"]),
  report: has(["^reporta", "^reporte", "^quiero reportar", "^aviso", "^report ", "^i want to report"]),
  swarm: has(["red enjambre", "enjambre", "reportes de la red", "que reporta la gente", "reportes ciudadanos", "swarm", "citizen reports"]),
  scene: has(["3d", "escena", "diorama", "maqueta", "como se veria", "como se ve ahi", "paisaje", "in 3d", "scene", "what would it look like"]),
  timeline: has(["linea de tiempo", "linea del tiempo", "timeline", "a traves de los anos", "over the years"]),
  rainVar: has(["lluvia", "precipitacion", "llueve", "llovio", "rain", "precipitation"]),
  tempVar: has(["temperatura", "calor", "calentamiento", "temperature", "warming"]),
  followUp: has(["^y ", "^y$", "^and ", "^tambien ", "^igual ", "^lo mismo", "^same "]),
  evolution: has(["evolucion", "como ha cambiado la tierra", "como cambio el planeta", "historia del planeta", "time ?lapse", "evolution", "how the earth changed"]),
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
