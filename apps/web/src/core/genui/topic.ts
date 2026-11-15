// Generative interface of the ASSISTANT (Plan de unión U3): the answer brings the components its topic needs —
// clima, ganado, astronauta, Marte, planetas, eventos — next to the text. This is not the Monitoreo panel (2D/3D):
// these components live inside the conversation. Which components appear is a pure function of the question and
// of what is on screen, so the same question always builds the same interface.
// Every component says where its numbers come from: HORI (computed), NASA en vivo (fetched now), or simulated.

import type { Lang } from "@/core/i18n/texts";
import type { Topic } from "@/core/assistant/parse";
import { HOME_PLACE, type Where } from "./places";

export type Widget =
  | { w: "now"; where: Where } // latest POWER conditions at a place (temperature, rain, humidity, wind, 3 weeks)
  | { w: "thi"; where: Where } // livestock heat stress from POWER (THI, NRC 1971 + LCI thresholds)
  | { w: "events"; near: Where | null } // NASA EONET open natural events, nearest first
  | { w: "astronaut" } // simulated crew vitals + real context; always labelled SIMULADO
  | { w: "mars" } // HORI's Martian dust layer (real, MCS/Montabone) + the 2018 global storm
  | { w: "planets" } // NASA planetary fact sheet (constants, not measurements of today)
  | { w: "swarm"; where: Where | null; draft: string | null }; // red enjambre: send a report + the latest reports (unverified)

export interface TopicAnswer {
  widgets: Widget[];
  text: Record<Lang, string>;
  /** Short line above the text (what the interface did). */
  action: Record<Lang, string>;
  origin: "zon" | "sim" | "hori" | "ui";
}

const L = (es: string, en: string): Record<Lang, string> => ({ es, en });

export function topicAnswer(topic: Topic, where: Where | null, draft: string | null = null): TopicAnswer {
  const at = where ?? HOME_PLACE;
  switch (topic) {
    case "clima":
      return {
        widgets: [{ w: "now", where: at }, { w: "events", near: at }],
        action: L(`Condiciones recientes en ${at.name}`, `Recent conditions in ${at.name}`),
        text: L(
          `Esto es lo último que midió la NASA en ${at.name} (POWER, con unos días de retraso). Abajo tienes los eventos naturales abiertos más cercanos.`,
          `This is the latest NASA measured in ${at.name} (POWER, a few days behind). Below are the nearest open natural events.`),
        origin: "zon",
      };
    case "ganado":
      return {
        widgets: [{ w: "thi", where: at }, { w: "now", where: at }],
        action: L(`Estrés por calor del ganado en ${at.name}`, `Livestock heat stress in ${at.name}`),
        text: L(
          `Calculo el índice de temperatura y humedad (THI) de cada día con la temperatura máxima y la humedad que midió la NASA en ${at.name}. Es un indicador del ambiente: no dice cómo está cada animal.`,
          `I compute the temperature–humidity index (THI) for each day from the maximum temperature and humidity NASA measured in ${at.name}. It describes the environment; it is not a diagnosis of the animals.`),
        origin: "zon",
      };
    case "astronauta":
      return {
        widgets: [{ w: "astronaut" }],
        action: L("Monitoreo de tripulación (simulado)", "Crew monitoring (simulated)"),
        text: L(
          "Así se vería el monitoreo de una tripulación con el mismo núcleo de HORI. Los signos vitales son simulados: no es tecnología médica validada.",
          "This is how crew monitoring would look with the same HORI core. The vital signs are simulated: this is not validated medical technology."),
        origin: "sim",
      };
    case "marte":
      return {
        widgets: [{ w: "mars" }, { w: "planets" }],
        action: L("Polvo en Marte, 13 años marcianos", "Dust on Mars, 13 Martian years"),
        text: L(
          "HORI revisó el polvo de la atmósfera de Marte con datos reales (Mars Climate Database, climatología de Montabone). La tormenta global de 2018 se ve sola. En 13 años marcianos no hay ninguna tendencia probada, y con menos de 15 años HORI todavía no está calibrado en Marte.",
          "HORI checked the dust in Mars' atmosphere with real data (Mars Climate Database, Montabone climatology). The 2018 global storm stands out by itself. In 13 Martian years no trend is proven, and with fewer than 15 years HORI is not calibrated on Mars yet."),
        origin: "hori",
      };
    case "planetas":
      return {
        widgets: [{ w: "planets" }, { w: "mars" }],
        action: L("Planetas del sistema solar", "Planets of the solar system"),
        text: L(
          "Datos de referencia de la NASA (ficha planetaria del NSSDC). Son constantes de cada planeta, no mediciones de hoy. De Marte sí tengo una serie analizada por HORI.",
          "NASA reference values (NSSDC planetary fact sheet). They are constants of each planet, not today's measurements. For Mars I do have a series analysed by HORI."),
        origin: "ui",
      };
    case "red":
      return {
        widgets: [{ w: "swarm", where, draft }],
        action: L("Red enjambre · reportes de personas", "Swarm · people's reports"),
        text: L(
          draft
            ? "Revisa tu reporte y el lugar, y envíalo a la red. Llega como fuente no verificada hasta que alguien del equipo lo revise; HORI lo usa como señal, no como evidencia firme."
            : "Estos son los últimos reportes de la red enjambre: lo que la gente ve en su lugar. Son fuente no verificada hasta que alguien del equipo los revise. También puedes enviar el tuyo.",
          draft
            ? "Check your report and the place, then send it to the swarm. It arrives as an unverified source until someone on the team reviews it; HORI uses it as a signal, not as proof."
            : "These are the latest reports of the swarm: what people see where they are. They are unverified until someone on the team reviews them. You can send yours too."),
        origin: "zon",
      };
    case "eventos":
      return {
        widgets: [{ w: "events", near: where }],
        action: L("Eventos naturales abiertos ahora", "Natural events open now"),
        text: L(
          "Estos son los eventos naturales que la NASA tiene abiertos (EONET). Los reúne de otras fuentes y cada uno trae su enlace; HORI no los detectó.",
          "These are the natural events NASA has open (EONET). It gathers them from other sources and each one keeps its link; HORI did not detect them."),
        origin: "zon",
      };
  }
}
