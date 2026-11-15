"use client";

// What the user always sees of the interaction layer (doc «Interacción v2» §4.5): mode and where the audio goes,
// subtitles of what was heard and what is being said, numbered controls, the confirmation that reads a write back,
// the hand cursor with its magnet, and short notices. Badges, cursor, subtitles and notices are pure overlay
// (data-h247-overlay: never a control, never take the pointer); the dock, dialogs and palette are normal controls,
// so they too can be reached by number, d-pad or hand.

import { useEffect, useState, useSyncExternalStore } from "react";
import { targets, type Target } from "@/core/interaction/dom";
import type { Lang } from "@/core/i18n/texts";
import { useHub, useHubState } from "./context";
import { Palette } from "./Palette";

const T = {
  es: {
    modes: { commands: "Órdenes", dictation: "Dictando", conversation: "Conversación" },
    off: "Micrófono apagado",
    listening: "Escuchando",
    handsFree: "Manos libres",
    dest: { local: "voz procesada en este equipo", browser: "voz procesada por el servicio del navegador", none: "" },
    cam: { off: "", loading: "Cargando gestos…", on: "Cámara activa (solo en este equipo)", error: "Cámara no disponible" },
    numbers: "Números", palette: "Comandos", gestures: "Gestos", talk: "Hablar", stopTalk: "Dejar de escuchar", handsFreeBtn: "Manos libres",
    you: "Tú", confirm: "Confirmar", cancel: "Cancelar", send: "Enviar", which: "¿Cuál?",
    report: "Reporte en dictado", reportHint: "Di «envía» al terminar · «borra la última frase» · «cancela»",
    dock: "Controles de interacción",
  },
  en: {
    modes: { commands: "Commands", dictation: "Dictating", conversation: "Conversation" },
    off: "Microphone off",
    listening: "Listening",
    handsFree: "Hands-free",
    dest: { local: "speech processed on this device", browser: "speech processed by the browser's service", none: "" },
    cam: { off: "", loading: "Loading gestures…", on: "Camera on (this device only)", error: "Camera unavailable" },
    numbers: "Numbers", palette: "Commands", gestures: "Gestures", talk: "Talk", stopTalk: "Stop listening", handsFreeBtn: "Hands-free",
    you: "You", confirm: "Confirm", cancel: "Cancel", send: "Send", which: "Which one?",
    report: "Report being dictated", reportHint: "Say «send» when done · «delete the last sentence» · «cancel»",
    dock: "Interaction controls",
  },
};

export function InteractionLayer({ lang }: { lang: Lang }) {
  const s = useHubState();
  return (
    <>
      <Subtitles lang={lang} />
      {s.numbers || s.choose ? <Numbers /> : null}
      {s.choose ? <Choose lang={lang} /> : null}
      {s.reportDraft && !s.pending ? <ReportDraft lang={lang} /> : null}
      {s.pending ? <Confirm lang={lang} /> : null}
      {s.hand.visible ? <HandCursor /> : null}
      <Notice />
      <Dock lang={lang} />
      {s.palette ? <Palette lang={lang} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- dock (bottom-left): mode + devices

function Dock({ lang }: { lang: Lang }) {
  const hub = useHub();
  const s = useHubState();
  const t = T[lang];
  const v = s.voice;
  // Speech support is only known in the browser: disabled on the server render, enabled right after hydration.
  const speech = useSyncExternalStore(noSub, () => v.supported, () => false);
  const hf = hub.isHandsFree();
  const camOn = s.hand.status === "on" || s.hand.status === "loading";
  const status = v.listening ? (s.mode === "dictation" ? t.modes.dictation : hf ? t.handsFree : t.listening) : t.off;
  return (
    <nav aria-label={t.dock}
      className="pointer-events-none fixed bottom-3 left-[calc(var(--rail,240px)+0.75rem)] z-[60] flex max-w-[calc(100vw-1.5rem)] items-end gap-2 max-md:bottom-auto max-md:left-16 max-md:top-3">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface/95 p-1 shadow-[0_6px_24px_rgba(16,24,40,0.12)] backdrop-blur">
        <DockButton label={v.listening ? t.stopTalk : t.talk} keys="Alt+V" active={v.listening} onClick={() => hub.talk()} disabled={!speech}>
          <path d="M8 2.5a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-3a2 2 0 0 1 2-2zM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5" />
        </DockButton>
        <DockButton label={t.handsFreeBtn} keys="Alt+M" active={hf} onClick={() => hub.setHandsFree(!hf)} disabled={!speech}>
          <path d="M3 8a5 5 0 0 1 10 0M5.5 8a2.5 2.5 0 0 1 5 0M8 8v5" />
        </DockButton>
        <DockButton label={t.numbers} keys="Alt+N" active={s.numbers} onClick={() => hub.meta(s.numbers ? "numbersOff" : "numbersOn")}>
          <path d="M5 3 4 13M11 3l-1 10M2.5 6h11M2 10h11" />
        </DockButton>
        {s.level.level >= 2 ? (
          <DockButton label={t.gestures} keys="Alt+G" active={camOn} onClick={() => (camOn ? hub.stopGestures() : void hub.startGestures())}>
            <path d="M5.5 8V3.5a1 1 0 0 1 2 0V7m0-3.5v-.5a1 1 0 0 1 2 0V7m0-3a1 1 0 0 1 2 0v4.5a4.5 4.5 0 0 1-9 0V7a1 1 0 0 1 2 0v1" />
          </DockButton>
        ) : null}
        <DockButton label={t.palette} keys="Ctrl+K" active={s.palette} onClick={() => hub.meta("palette")}>
          <path d="M3 4.5h10M3 8h10M3 11.5h6" />
        </DockButton>
      </div>
      <div className="pointer-events-none hidden flex-col gap-0.5 rounded-xl bg-surface/90 px-2.5 py-1.5 text-[11px] leading-4 text-text-2 shadow-sm backdrop-blur sm:flex" aria-live="polite">
        <span className="flex items-center gap-1.5 font-medium text-text">
          <span className={`h-2 w-2 rounded-full ${v.listening ? "animate-pulse bg-[#e5484d]" : "bg-text-3"}`} aria-hidden="true" />
          {status}{v.listening && s.mode !== "dictation" ? ` · ${t.modes.commands}` : ""}
        </span>
        {v.listening && v.destination !== "none" ? <span>{t.dest[v.destination]}</span> : null}
        {s.hand.status !== "off" ? <span>{t.cam[s.hand.status]}{s.hand.status === "on" && s.hand.perSecond ? ` · ${s.hand.perSecond}/s` : ""}</span> : null}
      </div>
    </nav>
  );
}

const noSub = () => () => {};

function DockButton({ label, keys, active, onClick, disabled, children }: { label: string; keys: string; active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} title={`${label} (${keys})`}
      className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${active ? "bg-accent text-on-accent" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}>
      <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
    </button>
  );
}

// ---------------------------------------------------------------- subtitles (top centre)

function Subtitles({ lang }: { lang: Lang }) {
  const s = useHubState();
  const t = T[lang];
  const [heard, setHeard] = useState("");
  // what was heard stays 3 s after the turn ends
  useEffect(() => {
    if (!s.heard) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows the last utterance for a moment, then clears it
    setHeard(s.heard);
    const id = window.setTimeout(() => setHeard(""), 3000);
    return () => clearTimeout(id);
  }, [s.heard]);
  const interim = s.voice.listening ? s.voice.interim : "";
  if (!interim && !heard && !s.said) return null;
  return (
    <div data-h247-overlay="" aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-[55] flex flex-col items-center gap-1.5 px-4">
      {interim || heard ? (
        <p className="max-w-2xl rounded-full bg-surface/95 px-4 py-1.5 text-sm shadow-sm backdrop-blur">
          <span className="mr-1.5 font-medium text-text-3">{t.you}:</span>
          <span className={interim ? "text-text-3 italic" : "text-text"}>{interim || heard}</span>
        </p>
      ) : null}
      {s.said ? (
        <p className="max-w-2xl rounded-2xl bg-[#0b1220]/85 px-4 py-2 text-center text-[15px] leading-6 text-white shadow-lg backdrop-blur">{s.said}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- numbers on every control

function Numbers() {
  const s = useHubState();
  const [list, setList] = useState<Target[]>([]);
  useEffect(() => {
    let raf = 0;
    const read = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setList(targets())); };
    read();
    const id = window.setInterval(read, 600);
    addEventListener("scroll", read, true);
    addEventListener("resize", read);
    return () => { clearInterval(id); cancelAnimationFrame(raf); removeEventListener("scroll", read, true); removeEventListener("resize", read); };
  }, []);
  const only = s.choose ? new Map(s.choose.map((c, i) => [c.n, i + 1])) : null;
  return (
    <div data-h247-overlay="" aria-hidden="true" className="pointer-events-none fixed inset-0 z-[58]">
      {list.map((t, i) => {
        const shown = only ? only.get(i + 1) : i + 1;
        if (shown === undefined) return null;
        return (
          <span key={i} style={{ transform: `translate(${Math.max(2, t.box.x - 6)}px, ${Math.max(2, t.box.y - 8)}px)` }}
            className={`absolute left-0 top-0 min-w-6 rounded-md px-1 text-center text-xs font-bold leading-5 shadow-md ring-2 ring-white/80 ${only ? "bg-[#f5a524] text-black" : "bg-accent text-on-accent"}`}>
            {shown}
          </span>
        );
      })}
    </div>
  );
}

function Choose({ lang }: { lang: Lang }) {
  const hub = useHub();
  const s = useHubState();
  if (!s.choose) return null;
  return (
    <div role="dialog" aria-label={T[lang].which}
      className="fixed inset-x-0 bottom-28 z-[61] mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-2 shadow-xl">
      <span className="px-2 text-sm font-medium">{T[lang].which}</span>
      {s.choose.map((c, i) => (
        <button key={c.n} type="button" onClick={() => hub.hear(String(i + 1), "text")}
          className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent">
          <span className="rounded bg-[#f5a524] px-1.5 text-xs font-bold text-black">{i + 1}</span>{c.name}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- confirmation of a write

function Confirm({ lang }: { lang: Lang }) {
  const hub = useHub();
  const s = useHubState();
  const t = T[lang];
  const p = s.pending!;
  const [left, setLeft] = useState(1);
  useEffect(() => {
    const total = p.expires - Date.now();
    const id = window.setInterval(() => setLeft(Math.max(0, (p.expires - Date.now()) / total)), 200);
    return () => clearInterval(id);
  }, [p.expires]);
  const hint = lang === "es" ? "Di «sí» o «cancela» · pulgar arriba · botón A" : "Say «yes» or «cancel» · thumbs up · A button";
  return (
    <div className="fixed inset-0 z-[62] flex items-end justify-center bg-black/25 p-4 sm:items-center" onClick={() => void hub.confirm(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="h247-confirm-title" aria-describedby="h247-confirm-body" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl">
        <div className="h-1 bg-accent transition-[width] duration-200" style={{ width: `${left * 100}%` }} />
        <div className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-text-3">{p.risk === "publicar" ? (lang === "es" ? "Otros lo verán" : "Others will see it") : (lang === "es" ? "Se guardará en ZON" : "Will be saved in ZON")}</p>
          <h2 id="h247-confirm-title" className="mt-1 text-lg font-semibold">{p.title[lang]}</h2>
          <ul id="h247-confirm-body" className="mt-3 space-y-1.5 text-sm leading-6 text-text-2">
            {p.lines[lang].map((l) => <li key={l}>{l}</li>)}
          </ul>
          <div className="mt-5 flex gap-2">
            <button type="button" autoFocus disabled={p.sending} onClick={() => void hub.confirm(true)}
              className="h-11 flex-1 rounded-full bg-accent font-medium text-on-accent disabled:opacity-60">{p.sending ? "…" : t.confirm}</button>
            <button type="button" disabled={p.sending} onClick={() => void hub.confirm(false)}
              className="h-11 flex-1 rounded-full border border-border font-medium hover:bg-surface-2">{t.cancel}</button>
          </div>
          <p className="mt-3 text-center text-xs text-text-3">{hint}</p>
        </div>
      </div>
    </div>
  );
}

function ReportDraft({ lang }: { lang: Lang }) {
  const hub = useHub();
  const s = useHubState();
  const t = T[lang];
  const r = s.reportDraft!;
  return (
    <div role="region" aria-label={t.report}
      className="fixed inset-x-0 bottom-28 z-[61] mx-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-accent bg-surface p-4 shadow-xl">
      <p className="text-xs font-medium uppercase tracking-wide text-text-3">{t.report} · {r.here.name}</p>
      <p className="mt-2 min-h-12 whitespace-pre-line text-base leading-7">{r.text || <span className="text-text-3">…</span>}</p>
      <p className="mt-2 text-xs text-text-3">{t.reportHint}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => hub.meta("send")} className="h-10 flex-1 rounded-full bg-accent text-sm font-medium text-on-accent">{t.send}</button>
        <button type="button" onClick={() => { hub.endDictation(); void hub.confirm(false); }} className="h-10 flex-1 rounded-full border border-border text-sm">{t.cancel}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- hand cursor

function HandCursor() {
  const s = useHubState();
  const h = s.hand;
  return (
    <div data-h247-overlay="" aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70]">
      {h.snap ? (
        <div className="absolute rounded-xl ring-[3px] ring-accent transition-all duration-100"
          style={{ left: h.snap.x - 4, top: h.snap.y - 4, width: h.snap.w + 8, height: h.snap.h + 8 }} />
      ) : null}
      <div className="absolute left-0 top-0" style={{ transform: `translate(${h.x}px, ${h.y}px)` }}>
        <div className={`-translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_2px_rgba(0,0,0,0.35),0_4px_16px_rgba(0,0,0,0.3)] transition-[width,height,background] duration-100 ${h.pinching ? "h-5 w-5 bg-accent" : "h-8 w-8 bg-accent/30"}`} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- notices

function Notice() {
  const s = useHubState();
  const n = s.notice;
  return (
    <div data-h247-overlay="" aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-[63] flex justify-center px-4">
      {n ? (
        <p key={n.id} className={`max-w-lg rounded-2xl px-4 py-2.5 text-sm shadow-lg ${n.tone === "error" ? "bg-[#3a1214] text-white" : "bg-[#0b1220]/90 text-white"}`}>{n.text}</p>
      ) : null}
    </div>
  );
}
