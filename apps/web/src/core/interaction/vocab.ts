// INPUT vocabulary of the interaction layer: what people may SAY or type to drive the whole app (doc «Interacción v2» §2.4).
// Never shown on screen, so this file is exempt from the text lint (scripts/lint-texts.mjs), like assistant/patterns.ts.
// Every phrase is already normalized (lower case, no accents). Spanish and English are understood at the same time.

export type Phrases = readonly string[];

/** Meta commands: they drive the interface itself and work on every screen. */
export const META = {
  numbersOn: ["muestra numeros", "mostrar numeros", "ver numeros", "numeros", "pon numeros", "show numbers", "numbers"],
  numbersOff: ["oculta numeros", "quita numeros", "quita los numeros", "sin numeros", "hide numbers", "no numbers"],
  palette: ["comandos", "que puedo decir", "que puedo hacer", "paleta", "lista de comandos", "what can i say", "commands", "command palette"],
  dictate: ["dicta", "dictar", "dictado", "escribe", "quiero escribir", "modo dictado", "dictate", "dictation", "type", "write"],
  dictateEnd: ["listo", "fin del dictado", "termina el dictado", "terminar dictado", "deja de dictar", "done", "end dictation", "stop dictation"],
  send: ["envia", "enviar", "envialo", "manda", "mandalo", "send", "send it", "submit"],
  stopListening: ["deja de escuchar", "apaga el microfono", "apaga microfono", "no escuches", "stop listening", "mic off", "microphone off"],
  silence: ["silencio", "callate", "calla", "shh", "ya no hables", "no hables", "be quiet", "silence", "stop talking", "quiet"],
  handsFree: ["manos libres", "modo conversacion", "conversa conmigo", "escucha siempre", "hands free", "conversation mode"],
  commandsMode: ["modo ordenes", "solo ordenes", "commands mode", "command mode"],
  wakeOff: ["quita palabra de activacion", "sin palabra de activacion", "quita la palabra clave", "sin palabra clave", "wake word off"],
  wakeOn: ["usa palabra de activacion", "activa palabra de activacion", "palabra de activacion", "palabra clave", "solo cuando diga horizon", "wake word", "wake word on"],
  slower: ["habla mas lento", "mas lento", "mas despacio", "habla mas despacio", "speak slower", "slower"],
  faster: ["habla mas rapido", "mas rapido", "speak faster", "faster"],
  normalSpeed: ["velocidad normal", "habla normal", "normal speed"],
  nextYear: ["siguiente ano", "ano siguiente", "un ano adelante", "adelanta un ano", "next year", "one year forward"],
  prevYear: ["ano anterior", "un ano atras", "regresa un ano", "atrasa un ano", "previous year", "one year back"],
  fieldOff: ["quita modo campo", "apaga modo campo", "sin modo campo", "field mode off"],
  fieldOn: ["modo campo", "activa modo campo", "modo guantes", "field mode", "gloves mode"],
  calibrate: ["calibra", "calibrar", "calibra los gestos", "calibrar gestos", "calibrate", "calibrate gestures"],
  gesturesOn: ["activa gestos", "gestos", "usa la camara", "activa la camara", "modo gestos", "gestures", "gestures on", "camera on", "use the camera"],
  gesturesOff: ["apaga gestos", "quita gestos", "apaga la camara", "sin camara", "gestures off", "camera off"],
  close: ["cierra", "cerrar", "cierralo", "close", "close it", "escape"],
  scrollDown: ["mas abajo", "desplaza abajo", "baja la pagina", "scroll down", "page down"],
  scrollUp: ["mas arriba", "desplaza arriba", "sube la pagina", "scroll up", "page up"],
  nextField: ["siguiente", "siguiente campo", "next", "next field"],
  prevField: ["anterior", "campo anterior", "previous", "previous field"],
  speakAgain: ["repite", "repitelo", "otra vez", "repeat", "say it again"],
  readAloud: ["leeme", "lee en voz alta", "habla", "respondeme hablando", "read it", "read aloud", "speak"],
} as const satisfies Record<string, Phrases>;

/** Saying a number touches the control that wears it («siete», «número 7», «toca el 7»). */
export const NUMBER_PREFIX: Phrases = ["numero", "el numero", "toca", "toca el", "pulsa", "pulsa el", "abre el", "click", "clic", "number", "tap", "press", "select"];

/** Answers to a pending confirmation. Short on purpose; matched as the whole utterance. */
export const CONFIRM = {
  yes: ["si", "si confirmo", "confirmo", "confirmar", "confirma", "adelante", "hazlo", "dale", "de acuerdo", "ok", "okay", "yes", "confirm", "do it", "go ahead", "sure"],
  no: ["no", "cancela", "cancelar", "mejor no", "olvidalo", "dejalo", "cancel", "never mind", "no thanks", "stop"],
} as const;

/** «orden: …» inside dictation runs a command instead of writing it (doc §2.4). */
export const ORDER_PREFIX: Phrases = ["orden", "comando", "command"];

/** Moving the 2D map, the globe or a 3D scene: whatever is active (doc §2.6). Whole-utterance phrases. */
export const MANIP = {
  left: ["izquierda", "a la izquierda", "gira a la izquierda", "gira izquierda", "rota a la izquierda", "left", "turn left", "rotate left"],
  right: ["derecha", "a la derecha", "gira a la derecha", "gira derecha", "rota a la derecha", "right", "turn right", "rotate right"],
  up: ["arriba", "hacia arriba", "inclina arriba", "mira arriba", "up", "tilt up"],
  down: ["abajo", "hacia abajo", "inclina abajo", "mira abajo", "down", "tilt down"],
  zoomIn: ["acerca", "acercate", "acercar", "mas cerca", "zoom", "amplia", "zoom in", "closer"],
  zoomOut: ["aleja", "alejate", "mas lejos", "zoom out", "farther", "further"],
  spin: ["gira", "girar", "rota", "dale vueltas", "spin", "rotate", "turn around"],
  stop: ["para", "detente", "alto", "quieto", "stop", "hold", "freeze"],
  reset: ["centra", "centrar", "restablece", "vista inicial", "reinicia la vista", "reset view", "center", "recenter"],
  play: ["reproduce", "play", "anima", "animar"],
  pause: ["pausa", "pausar", "pause"],
} as const satisfies Record<string, Phrases>;

/** Operations on ZON (monitors, alerts, reports). Matched as «contains». */
export const SYSTEM = {
  monitors: ["mis monitores", "monitores", "lista de monitores", "que vigilo", "my monitors", "monitors"],
  alerts: ["alertas", "alertas abiertas", "mis alertas", "hay alertas", "alerts", "open alerts"],
  ack: ["reconoce", "reconocer", "reconocida", "enterado", "acknowledge", "ack"],
  escalate: ["deriva", "derivar", "derivada", "escala", "escalar", "escalate", "hand over"],
  closeAlert: ["cierra la alerta", "cerrar la alerta", "cierra alerta", "close the alert", "close alert", "resolve"],
  watch: ["vigila", "vigilar", "monitorea", "monitorear", "sigue esto", "watch", "monitor this", "keep an eye"],
  report: ["reporta", "reportar", "nuevo reporte", "quiero reportar", "levanta un reporte", "report", "new report"],
  health: ["estado del sistema", "salud del sistema", "como esta el sistema", "zon", "system status", "health"],
  swarm: ["senales", "enjambre", "senales del enjambre", "swarm", "signals"],
  entity: ["estado de", "status of"],
  connect: ["conecta zon", "configura zon", "conectar zon", "connect zon", "set up zon"],
} as const satisfies Record<string, Phrases>;

/** Deixis: «esto», «aquí» = what the hand or the pointer is on (doc §2.6 «apuntar + hablar»). */
/** Said before a command when the wake word is on: «Horizon, acércate». */
export const WAKE: Phrases = ["oye horizon", "ok horizon", "okay horizon", "hey horizon", "horizonte", "horizon"];

/** «What is this?» with the hand pointing (or about what is selected). Whole-utterance phrases. */
export const HERE_INFO: Phrases = ["que hay aqui", "que hay ahi", "que es esto", "que es eso", "que pasa aqui", "que pasa ahi", "que tal aqui", "y aqui",
  "what is here", "what is this", "what is that", "what about here", "whats here", "whats this"];

export const DEIXIS: Phrases = ["esto", "esta", "este", "aqui", "ahi", "alli", "eso", "esa", "this", "here", "there", "that"];

/** Editing a dictated draft by voice (doc §2.4). Order matters: longer first. */
export const EDIT = {
  deleteSentence: ["borra la ultima frase", "borrar la ultima frase", "quita la ultima frase", "delete the last sentence", "delete last sentence"],
  deleteWord: ["borra la ultima palabra", "borrar la ultima palabra", "quita la ultima palabra", "delete the last word", "delete last word"],
  clearAll: ["borra todo", "borrar todo", "empieza de nuevo el texto", "clear all", "delete everything"],
  undo: ["deshaz", "deshacer", "undo"],
  newLine: ["nueva linea", "salto de linea", "nuevo parrafo", "new line", "new paragraph"],
  readBack: ["lee lo que escribi", "leeme el texto", "lee el borrador", "read it back", "read the draft"],
  replace: ["cambia", "reemplaza", "replace", "change"],
  replaceBy: ["por", "with", "to"],
} as const satisfies Record<string, Phrases>;

/** Spoken punctuation inside dictation → the sign. */
export const PUNCT: readonly [string, string][] = [
  ["punto y coma", ";"], ["dos puntos", ":"], ["punto y aparte", ".\n"], ["punto y seguido", "."], ["punto final", "."],
  ["abre interrogacion", "¿"], ["cierra interrogacion", "?"], ["signo de interrogacion", "?"], ["abre exclamacion", "¡"], ["cierra exclamacion", "!"],
  ["abre parentesis", "("], ["cierra parentesis", ")"], ["guion", "-"], ["coma", ","], ["punto", "."],
  ["question mark", "?"], ["exclamation mark", "!"], ["semicolon", ";"], ["colon", ":"], ["comma", ","], ["full stop", "."], ["period", "."],
];
