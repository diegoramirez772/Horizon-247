"use client";

// The tour of the foci (traspaso 3D, D2 + D6): «Con evidencia» walks the places where HORI supports a change beyond δ,
// «Dónde aún no se sabe» walks the places it cannot decide yet. Every button has a visible name, so voice («siguiente
// foco», «dónde aún no se sabe») and the hand reach it like any other control (doc «Interacción v2» §2.2).

import type { Manifest } from "@/contract/types";
import { type Focus, type FocusSet, SCORE_TEXT, UNKNOWN_TEXT } from "@/core/detect/focos";
import { focusWords } from "@/core/detect/words";
import type { Lang, Register } from "@/core/i18n/texts";

export type TourMode = "apoyado" | "no_se_sabe";
export interface TourState { mode: TourMode; rank: number }

const C = {
  es: {
    title: "Lo significativo", supported: "Con evidencia", unknown: "Dónde aún no se sabe", next: "Siguiente foco", prev: "Foco anterior",
    of: (a: number, b: number) => `${a} de ${b}`, why: "¿Por qué va en este orden?", close: "Quitar los focos", show: "Ver lo significativo",
    zone: "Este foco en relieve real", scene: "Escena generada del foco",
    noneSupported: "En esta capa HORI no tiene grupos de celdas apoyadas con todo el intervalo más allá de δ.",
    noneUnknown: "En esta capa no hay zonas grandes donde aún no se sepa.",
    loose: (n: number) => `${n} celdas apoyadas quedan fuera de los focos (intervalo que toca δ o grupos de menos de 3 celdas).`,
    note: "Los focos solo agrupan celdas vecinas con el veredicto de HORI; no son una evaluación nueva.",
  },
  en: {
    title: "What is significant", supported: "With evidence", unknown: "Where it is not known yet", next: "Next focus", prev: "Previous focus",
    of: (a: number, b: number) => `${a} of ${b}`, why: "Why this order?", close: "Hide the foci", show: "Show what is significant",
    zone: "This focus in real relief", scene: "Generated scene of the focus",
    noneSupported: "In this layer HORI has no groups of supported cells with the whole interval beyond δ.",
    noneUnknown: "In this layer there are no large areas where it is not known yet.",
    loose: (n: number) => `${n} supported cells fall outside the foci (interval touching δ or groups under 3 cells).`,
    note: "The foci only group neighbouring cells with HORI's verdict; they are not a new evaluation.",
  },
};

export function FocusTour({ foci, manifest, lang, register, tour, setTour, onZone, onScene }: {
  foci: FocusSet; manifest: Manifest; lang: Lang; register: Register;
  tour: TourState | null; setTour: (t: TourState | null) => void;
  onZone: (f: Focus) => void; onScene: (f: Focus) => void;
}) {
  const c = C[lang];
  if (!tour) {
    return (
      <button type="button" onClick={() => setTour({ mode: "apoyado", rank: 1 })}
        className="glass absolute bottom-3 left-3 z-10 inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-xs font-semibold">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="1.8" fill="currentColor" /></svg>
        {c.show}
      </button>
    );
  }
  const list = tour.mode === "apoyado" ? foci.supported : foci.unknown;
  const f = list.find((x) => x.rank === tour.rank) ?? list[0] ?? null;
  const w = f ? focusWords(f, manifest, lang) : null;
  const go = (d: number) => list.length && setTour({ ...tour, rank: ((((f?.rank ?? 1) - 1 + d) % list.length) + list.length) % list.length + 1 });
  const plain = register === "sencillo";
  return (
    <section aria-label={c.title} className="glass absolute bottom-3 left-3 z-10 w-[min(380px,calc(100%-1.5rem))] rounded-2xl p-3 text-sm">
      <div className="flex items-center gap-1">
        {(["apoyado", "no_se_sabe"] as TourMode[]).map((mode) => (
          <button key={mode} type="button" aria-pressed={tour.mode === mode} onClick={() => setTour({ mode, rank: 1 })}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tour.mode === mode ? "bg-accent text-on-accent" : "text-text-2 hover:bg-surface-2"}`}>
            {mode === "apoyado" ? c.supported : c.unknown}
          </button>
        ))}
        <button type="button" onClick={() => setTour(null)} aria-label={c.close} title={c.close}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-text-2 hover:bg-surface-2">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
      {f && w ? (
        <div aria-live="polite">
          <p className="mt-2 font-semibold leading-snug">{w.title}</p>
          <p className="mt-0.5 leading-snug text-text-2">{w.line}</p>
          {plain ? null : <p className="tabular mt-1 text-xs leading-snug text-text-3">{w.detail}</p>}
          <details className="mt-1.5 text-xs text-text-2">
            <summary className="cursor-pointer font-medium">{c.why}</summary>
            <p className="mt-1">{w.why}</p>
            <p className="mt-1">{tour.mode === "apoyado" ? SCORE_TEXT[lang] : UNKNOWN_TEXT[lang]}</p>
            {tour.mode === "apoyado" && foci.looseSupported > 0 ? <p className="mt-1">{c.loose(foci.looseSupported)}</p> : null}
            <p className="mt-1 text-text-3">{c.note}</p>
          </details>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => go(-1)} aria-label={c.prev} title={c.prev}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border hover:bg-surface-2">‹</button>
            <span className="tabular text-xs text-text-2">{c.of(f.rank, list.length)}</span>
            <button type="button" onClick={() => go(1)} aria-label={c.next}
              className="inline-flex h-8 items-center rounded-full bg-accent px-3 text-xs font-semibold text-on-accent">{c.next} ›</button>
            {manifest.profile === "earth" ? (
              <>
                <button type="button" onClick={() => onZone(f)} className="inline-flex h-8 items-center rounded-full border border-border px-2.5 text-xs font-medium hover:bg-surface-2">{c.zone}</button>
                <button type="button" onClick={() => onScene(f)} className="inline-flex h-8 items-center rounded-full border border-border px-2.5 text-xs font-medium hover:bg-surface-2">{c.scene}</button>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-text-2">{tour.mode === "apoyado" ? c.noneSupported : c.noneUnknown}</p>
      )}
    </section>
  );
}
