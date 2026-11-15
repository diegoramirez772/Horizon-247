// «¿Cómo se usa…?» — the assistant knows the product (H19: no LLM, deterministic). Each entry answers one real doubt in
// plain words AND offers the action that solves it (open a section, start the tour of the foci, slow the timeline,
// turn gestures on). Matching is on normalized text (no accents, lower case): a topic word is needed; a question or a
// complaint («no puedo», «va muy rápido») makes it surer. Answers never use the words the text lint forbids.

import type { Intent } from "./parse";

export type HowKey =
  | "gestos_clic" | "gestos_loco" | "gestos" | "velocidad" | "deteccion" | "focos" | "no_se_sabe" | "zona3d"
  | "cambio_tiempo" | "fauna" | "alertas" | "persona" | "planetas" | "voz";

type L2 = { es: string; en: string };
export interface HowChip { label: L2; intent: Intent }
export interface HowAnswer { text: L2; chips: HowChip[] }

interface Entry { key: HowKey; topic: RegExp; strong?: RegExp }

/** Order matters: the more specific doubt first (clicking with gestures before gestures in general). */
const ENTRIES: Entry[] = [
  { key: "gestos_clic", topic: /(gesto|con la mano|pellizc|hand)/, strong: /(clic|click|tocar|toco|seleccion|presion|aprieto|apretar|no puedo|como (le )?doy|tap)/ },
  { key: "gestos_loco", topic: /(gesto|mano|puntero|cursor|pointer)/, strong: /(loco|brinca|salta|tiembla|solo|se va|no se queda|raro|falla|no funciona|mal|jitter|jumps|crazy)/ },
  { key: "velocidad", topic: /(linea de(l)? tiempo|anos|timeline|reproduc|animacion|play)/, strong: /(rapido|lento|velocidad|despacio|fast|slow|speed)/ },
  { key: "focos", topic: /(\bfocos?\b|lo significativo|por que (ese|este) orden|recorrido|focus|foci)/ },
  { key: "no_se_sabe", topic: /(aun no se sabe|no se sabe|candidat|no concluyente|\bmde\b|not known yet)/ },
  { key: "deteccion", topic: /(deteccion|detecta|detector|significativ|apoyad|como sabe|como decide|veredicto|\bfdr\b|consenso|como funciona (hori|horizon|esto|el sistema|la deteccion)|detection)/ },
  { key: "zona3d", topic: /(zona (en )?3d|relieve|3d real|zona real|real 3d|terrain)/ },
  { key: "cambio_tiempo", topic: /(ano (por|a) ano|tiempo real|ver el cambio|veo el cambio|ver como cambia|se vea el cambio|real time|year by year)/ },
  { key: "alertas", topic: /(alerta|avis|notific|vigil|alert|notify|watch)/ },
  { key: "fauna", topic: /(fauna|animal|aves|pajaro|mariposa|anfibio|insecto|mamifero|reptil|especie|inaturalist|birds|wildlife)/ },
  { key: "persona", topic: /(persona|ritmo cardiaco|frecuencia cardiaca|corazon|pulso|mi salud|wearable|reloj|heart rate)/ },
  { key: "planetas", topic: /(modelador|que planetas|que mundos|otros planetas|otro planeta|other planets|which worlds)/ },
  { key: "gestos", topic: /(\bgestos?\b|gestures?)/ },
  { key: "voz", topic: /(\bvoz\b|microfono|dictar|hablarle|comandos de voz|voice)/ },
];

const QUESTION = /(^| )(como|que|por que|para que|cual|cuando|donde|no puedo|no se|no entiendo|explica|ayuda|ensena|sirve|significa|funciona|how|what|why|can t|cannot|explain)( |$)/;

/**
 * The doubt in a sentence, or null. `strict`: a question form or a strong word is required (used before the commands);
 * otherwise a topic word is enough (used when nothing else understood the sentence).
 */
export function howtoOf(text: string, strict = true): HowKey | null {
  const t = ` ${text} `;
  const q = QUESTION.test(text);
  for (const e of ENTRIES) {
    if (!e.topic.test(t)) continue;
    const strong = e.strong ? e.strong.test(t) : false;
    if (e.strong && !strong && (e.key === "gestos_clic" || e.key === "gestos_loco" || e.key === "velocidad")) continue;
    if (!strict || q || strong) return e.key;
  }
  return null;
}

/** «va muy rápido», «más lento», «velocidad normal» → the timeline speed to set (relative steps as "+" / "-"). */
export function speedOf(text: string): number | "+" | "-" | null {
  if (!/(linea de(l)? tiempo|anos|timeline|reproduc|animacion|va |pasa|velocidad|speed|despacio|lento|rapido|slow|fast)/.test(text)) return null;
  if (/(habla|voz|lee|leer|speak|talk)/.test(text)) return null; // speech rate belongs to the voice, not the timeline
  if (/(velocidad normal|normal speed)/.test(text)) return 1;
  if (/(muy rapido|demasiado rapido|va rapido|va a madres|too fast|mas lento|mas despacio|despacio|slower|slow down)/.test(text)) return "-";
  if (/(muy lento|demasiado lento|mas rapido|faster|speed up)/.test(text)) return "+";
  return null;
}

const open = (panel: "fauna" | "person" | "zone" | "map" | "live", tour?: "apoyado" | "no_se_sabe"): Intent => ({ t: "open", panel, tour });

export function howtoAnswer(key: HowKey): HowAnswer {
  switch (key) {
    case "gestos_clic":
      return {
        text: {
          es: "Para dar clic con la mano: junta índice y pulgar y suelta rápido (menos de un segundo) SIN mover la mano; si te mueves mientras pellizcas, cuenta como arrastrar. El clic cae donde apuntabas antes de cerrar los dedos y el puntero se imanta al botón más cercano. Si aun así cuesta, di «modo campo»: dejar el puntero quieto 1,2 s sobre un botón ya es un clic. Para mover la vista, pellizca y arrastra; para acercar, pellizca con las dos manos y sepáralas.",
          en: "To click with your hand: pinch index and thumb and release quickly (under a second) WITHOUT moving; moving while pinching counts as a drag. The click lands where you pointed before closing your fingers and the pointer snaps to the nearest button. If it is still hard, say «field mode»: resting the pointer 1.2 s on a button is a click. Pinch and drag to move the view; pinch with both hands and spread them to zoom.",
        },
        chips: [{ label: { es: "Encender gestos", en: "Turn gestures on" }, intent: { t: "gestures", on: true } }, { label: { es: "¿Por qué brinca el puntero?", en: "Why does the pointer jump?" }, intent: { t: "howto", key: "gestos_loco" } }],
      };
    case "gestos_loco":
      return {
        text: {
          es: "Si el puntero brinca: (1) ponte a 50–70 cm de la cámara, con luz de frente y no una ventana detrás; (2) una sola mano en cuadro; (3) haz puño para congelarlo, recoloca la mano y ábrela para seguir; (4) di «calibra» y mueve el índice 4 s por la zona que te queda cómoda: ese espacio pasa a cubrir toda la pantalla. Si entra otra mano a cuadro, el puntero sigue con la tuya. En esta laptop la cámara comparte el procesador con el globo 3D: con el mapa abierto lee menos veces por segundo; en el chat va más fino.",
          en: "If the pointer jumps: (1) sit 50–70 cm from the camera, light in front, no window behind; (2) one hand in frame; (3) make a fist to freeze it, re-centre and open to continue; (4) say «calibrate» and move your index finger for 4 s over the comfortable area: it then covers the whole screen. If another hand comes into view, the pointer stays with yours. On this laptop the camera shares the processor with the 3D globe: with the map open it reads fewer times per second; in the chat it is smoother.",
        },
        chips: [{ label: { es: "Encender gestos", en: "Turn gestures on" }, intent: { t: "gestures", on: true } }, { label: { es: "Apagar gestos", en: "Turn gestures off" }, intent: { t: "gestures", on: false } }],
      };
    case "gestos":
      return {
        text: {
          es: "Gestos: índice = mover el puntero · pellizco rápido = clic · pellizcar y mover = girar o arrastrar · dos manos pellizcando = acercar o alejar · puño = congelar el puntero · palma abierta quieta 1 s = regresar · pulgar arriba quieto 1 s = confirmar · barrer con la mano abierta ← → = año anterior o siguiente · ✌️ quieto = «¿qué hay aquí?» · meñique arriba = hablar. Se encienden con el botón de la mano (abajo a la derecha), con Alt+G o diciendo «enciende gestos». La imagen de la cámara no sale del equipo.",
          en: "Gestures: index = move the pointer · quick pinch = click · pinch and move = rotate or drag · two hands pinching = zoom · fist = freeze the pointer · open palm held 1 s = back · thumbs up held 1 s = confirm · swipe with an open hand ← → = previous or next year · ✌️ held = «what is here?» · pinky up = talk. Turn them on with the hand button (bottom right), Alt+G or by saying «gestures on». The camera image never leaves the device.",
        },
        chips: [{ label: { es: "Encender gestos", en: "Turn gestures on" }, intent: { t: "gestures", on: true } }, { label: { es: "¿Cómo doy clic?", en: "How do I click?" }, intent: { t: "howto", key: "gestos_clic" } }],
      };
    case "velocidad":
      return {
        text: {
          es: "La línea de tiempo tiene velocidad: ×0,5, ×1 o ×2 (junto al botón ▶). También puedes decir «más lento» o «más rápido», pausar con ❚❚, o arrastrar la barra y usar las flechas ← → para ir año por año.",
          en: "The timeline has a speed: ×0.5, ×1 or ×2 (next to ▶). You can also say «slower» or «faster», pause with ❚❚, or drag the bar and use ← → to go year by year.",
        },
        chips: [{ label: { es: "Más lento", en: "Slower" }, intent: { t: "speed", v: "-" } }, { label: { es: "Velocidad normal", en: "Normal speed" }, intent: { t: "speed", v: 1 } }],
      };
    case "deteccion":
      return {
        text: {
          es: "Cómo decide HORI: para cada zona mide la tendencia por década con TRES métodos distintos. Solo dice «cambio apoyado» si los tres coinciden y la zona sigue firme después de corregir por haber revisado miles de zonas a la vez (FDR): así se evitan los hallazgos de pura suerte. Además compara con δ, el cambio que importa: si el intervalo queda por debajo, es «sin cambio mayor que δ»; si no alcanza a decidir, es «aún no se sabe» y te dice cuántos años faltarían. Lo significativo = apoyado por los tres, firme tras el FDR y con el intervalo más allá de δ.",
          en: "How HORI decides: for each area it measures the trend per decade with THREE different methods. It only says «supported change» if all three agree and the area stays firm after correcting for checking thousands of areas at once (FDR): that avoids findings by pure luck. It also compares with δ, the change that matters: if the interval stays below, it is «no change larger than δ»; if it cannot decide yet, it is «not known yet» and says how many more years would be needed. Significant = supported by all three, firm after FDR, with its interval beyond δ.",
        },
        chips: [{ label: { es: "Recorrer lo significativo", en: "Tour what is significant" }, intent: open("map", "apoyado") }, { label: { es: "¿Qué significa cada color?", en: "What does each colour mean?" }, intent: { t: "legend" } }, { label: { es: "¿Qué es «aún no se sabe»?", en: "What is «not known yet»?" }, intent: { t: "howto", key: "no_se_sabe" } }],
      };
    case "focos":
      return {
        text: {
          es: "Un foco es un grupo de zonas vecinas donde HORI da el cambio por apoyado y todo su intervalo queda más allá de δ. No es otra evaluación: solo junta lo que HORI ya decidió. Van ordenados por área real × tamaño del cambio frente a δ × fuerza de la evidencia, nunca por la zona más llamativa. En el mapa: tarjeta «Lo significativo» → «Siguiente foco»; «¿Por qué va en este orden?» muestra la cuenta de cada uno.",
          en: "A focus is a group of neighbouring areas where HORI supports the change and the whole interval lies beyond δ. It is not a new evaluation: it only groups what HORI already decided. They are ordered by real area × size of the change against δ × strength of evidence, never by the most striking area. On the map: «What is significant» card → «Next focus»; «Why this order?» shows each one's numbers.",
        },
        chips: [{ label: { es: "Recorrer los focos", en: "Tour the foci" }, intent: open("map", "apoyado") }, { label: { es: "Dónde aún no se sabe", en: "Where it is not known yet" }, intent: open("map", "no_se_sabe") }],
      };
    case "no_se_sabe":
      return {
        text: {
          es: "«Aún no se sabe» (rayado) quiere decir que con los años que hay no alcanza para decidir si el cambio supera δ: no es «no cambió». El punteado son indicios todavía sin confirmar. Para cada zona HORI da el MDE (el cambio más chico que podría detectar con esos datos) y cuántos años más harían falta para saberlo.",
          en: "«Not known yet» (stripes) means the years available are not enough to decide whether the change exceeds δ: it does not mean «no change». Dots are hints not yet confirmed. For each area HORI gives the MDE (the smallest change it could detect with those data) and how many more years would be needed.",
        },
        chips: [{ label: { es: "Ver dónde aún no se sabe", en: "See where it is not known yet" }, intent: open("map", "no_se_sabe") }],
      };
    case "zona3d":
      return {
        text: {
          es: "La zona en 3D real es el lugar tal como es: relieve medido y foto de satélite de 2020. No se anima por años. Encima va el veredicto de HORI de toda la ventana (liso = cambio apoyado, puntos = indicios, rayas = aún no se sabe, gris = sin cambio mayor que δ). Para ver el cambio año por año de ese mismo lugar: «Escena generada con sus datos» → «Años · HORI» → ▶.",
          en: "The real 3D zone is the place as it is: measured relief and a 2020 satellite image. It does not animate by year. On top is HORI's verdict for the whole window (solid = supported change, dots = hints, stripes = not known yet, grey = no change larger than δ). To see that place year by year: «Generated scene from its data» → «Years · HORI» → ▶.",
        },
        chips: [{ label: { es: "Abrir la zona en 3D real", en: "Open the real 3D zone" }, intent: open("zone") }, { label: { es: "Escena con sus años", en: "Scene with its years" }, intent: { t: "scene", where: null, timeline: true } }],
      };
    case "cambio_tiempo":
      return {
        text: {
          es: "Hay tres relojes: (1) la tendencia es anual: en el mapa, «Año a año» muestra cada año y «Cómo crece la evidencia» muestra en qué año cada lugar pasó a «se sabe»; (2) En vivo: el infrarrojo de satélite cada 10 minutos y el clima de los últimos días; (3) Señales de fauna: mes a mes. Un cambio de tendencia no se puede ver «al segundo»: necesita años de datos.",
          en: "There are three clocks: (1) the trend is yearly: on the map, «Year by year» shows each year and «How evidence grows» shows the year each place became known; (2) Live: satellite infrared every 10 minutes and the weather of the last days; (3) Animal signals: month by month. A trend change cannot be seen «by the second»: it needs years of data.",
        },
        chips: [{ label: { es: "La evolución de la Tierra", en: "How Earth has changed" }, intent: { t: "evolution" } }, { label: { es: "Cómo crece la evidencia", en: "How evidence grows" }, intent: { t: "accumulated", end: null } }, { label: { es: "En vivo", en: "Live" }, intent: open("live") }],
      };
    case "fauna":
      return {
        text: {
          es: "Señales de fauna: para cada grupo (aves, mamíferos, anfibios, reptiles, insectos, mariposas) cuento cuántas veces se reporta en iNaturalist dividido entre todo lo que se reporta ahí ese mes, para que no cuente que cada año hay más gente usando la app. El detector de anomalías de HORI dice dónde se sale de su propio pasado, cuánto y desde cuándo. Mide reportes, no animales: el cambio puede venir de los animales o de cómo busca la gente.",
          en: "Animal signals: for each group (birds, mammals, amphibians, reptiles, insects, butterflies) I count how often it is reported on iNaturalist divided by everything reported there that month, so more app users each year does not count. HORI's anomaly detector says where it departs from its own past, how much and since when. It measures reports, not animals: a change can come from the animals or from how people look.",
        },
        chips: [{ label: { es: "Abrir Señales de fauna", en: "Open Animal signals" }, intent: open("fauna") }, { label: { es: "¿Cómo me avisas?", en: "How do you notify me?" }, intent: { t: "howto", key: "alertas" } }],
      };
    case "alertas":
      return {
        text: {
          es: "Avisos: en Señales de fauna pulsa «Vigilar y avisarme»: reviso cada 6 horas mientras la página está abierta y te aviso solo de lo nuevo (el navegador te pide permiso una vez). Para vigilar todo el día sin la página, ZON corre la misma regla una vez al día y manda los avisos a una bandeja o a un webhook, con historial de quién los vio.",
          en: "Notices: in Animal signals press «Watch and notify me»: I check every 6 hours while the page is open and notify only what is new (the browser asks once). To watch all day without the page, ZON runs the same rule daily and sends notices to an inbox or a webhook, with a history of who saw them.",
        },
        chips: [{ label: { es: "Abrir Señales de fauna", en: "Open Animal signals" }, intent: open("fauna") }],
      };
    case "persona":
      return {
        text: {
          es: "Persona: una señal del cuerpo medida con regularidad (por ejemplo el ritmo cardíaco en reposo de un reloj) vigilada con el detector de HORI, comparando cada hora con esa misma hora de los días anteriores. Hay una semana simulada para ver cómo encuentra lo que metimos a propósito, o puedes cargar tu archivo: se lee en tu navegador y no se sube. Una anomalía no dice qué le pasa a la persona.",
          en: "Person: a body signal measured regularly (for example resting heart rate from a watch) watched with HORI's detector, comparing each hour with that same hour on previous days. There is a simulated week to see it find what we injected on purpose, or you can load your file: it is read in your browser and not uploaded. An anomaly does not say what is happening to the person.",
        },
        chips: [{ label: { es: "Abrir Persona", en: "Open Person" }, intent: open("person") }],
      };
    case "planetas":
      return {
        text: {
          es: "El modelador arma escenas de Marte, la Luna, Mercurio, Venus, Titán, Europa, Ío y Plutón con datos de referencia de la NASA (gravedad, temperatura, atmósfera, cuánta luz del Sol llega). Júpiter y Saturno no tienen superficie: te lo digo y te muestro sus lunas. Pídelo así: «llévame a Titán».",
          en: "The modeler builds scenes of Mars, the Moon, Mercury, Venus, Titan, Europa, Io and Pluto with NASA reference data (gravity, temperature, atmosphere, how much sunlight arrives). Jupiter and Saturn have no surface: I say so and show their moons. Ask like this: «take me to Titan».",
        },
        chips: [{ label: { es: "Llévame a Europa", en: "Take me to Europa" }, intent: { t: "scene", where: null, timeline: false, preset: "europa", real: false } },
          { label: { es: "Llévame a Venus", en: "Take me to Venus" }, intent: { t: "scene", where: null, timeline: false, preset: "venus", real: false } },
          { label: { es: "Llévame a Titán", en: "Take me to Titan" }, intent: { t: "scene", where: null, timeline: false, preset: "titan", real: false } }],
      };
    case "voz":
      return {
        text: {
          es: "Voz: pulsa el micrófono o di los nombres de los botones que ves («siguiente foco», «señales de fauna»). También: «acerca», «gira», «para», «más lento», «llévame a Venus», «¿cómo funciona la detección?». Con «número» aparecen números sobre los controles y dices el número.",
          en: "Voice: press the microphone or say the names of the buttons you see («next focus», «animal signals»). Also: «zoom in», «rotate», «stop», «slower», «take me to Venus», «how does detection work?». Say «numbers» to label every control and then say the number.",
        },
        chips: [{ label: { es: "¿Qué gestos hay?", en: "Which gestures?" }, intent: { t: "howto", key: "gestos" } }],
      };
  }
}
