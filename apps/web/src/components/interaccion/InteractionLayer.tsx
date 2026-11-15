"use client";

// What the user always sees of the interaction layer (doc «Interacción v2» §4.5): mode and where the audio goes,
// subtitles of what was heard and what is being said, numbered controls, the confirmation that reads a write back,
// the hand cursor with its magnet, and short notices. Badges, cursor, subtitles and notices are pure overlay
// (data-h247-overlay: never a control, never take the pointer); the dock, dialogs and palette are normal controls,
// so they too can be reached by number, d-pad or hand.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
    wake: "Solo con «Horizon»", awake: "Te escucho: di la orden",
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
    wake: "Only with «Horizon»", awake: "Listening: say the command",
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
      {s.hand.visible ? <HandCursor lang={lang} /> : null}
      {s.hand.status === "on" || s.hand.status === "loading" ? <CameraPreview lang={lang} /> : null}
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
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("pointerdown", off);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", off); removeEventListener("keydown", esc); };
  }, [open]);
  const busy = v.listening || camOn || s.numbers;
  return (
    <nav ref={wrap} aria-label={t.dock}
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2 max-md:bottom-auto max-md:right-3 max-md:top-3 max-md:flex-col-reverse">
      {open ? (
        <div className="widget-in pointer-events-auto w-64 rounded-2xl border border-border bg-surface p-1.5 shadow-[0_16px_44px_rgba(16,24,40,0.18)]">
          <p className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-1 text-xs text-text-2" aria-live="polite">
            <span className={`h-2 w-2 rounded-full ${v.listening ? "animate-pulse bg-[#e5484d]" : "bg-text-3"}`} aria-hidden="true" />
            {status}{v.listening && s.mode !== "dictation" ? ` · ${t.modes.commands}` : ""}
            {s.hand.status !== "off" ? ` · ${t.cam[s.hand.status]}` : ""}
          </p>
          <MenuItem label={v.listening ? t.stopTalk : t.talk} keys="Alt+V" active={v.listening} onClick={() => hub.talk()} disabled={!speech}>
            <path d="M8 2.5a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-3a2 2 0 0 1 2-2zM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5" />
          </MenuItem>
          <MenuItem label={t.handsFreeBtn} keys="Alt+M" active={hf} onClick={() => hub.setHandsFree(!hf)} disabled={!speech}>
            <path d="M3 8a5 5 0 0 1 10 0M5.5 8a2.5 2.5 0 0 1 5 0M8 8v5" />
          </MenuItem>
          <MenuItem label={t.wake} keys="" active={s.voiceSettings.wake} onClick={() => hub.setWake(!s.voiceSettings.wake)} disabled={!speech}>
            <path d="M8 2v2M8 12v2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M2 8h2M12 8h2M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" />
          </MenuItem>
          <MenuItem label={t.numbers} keys="Alt+N" active={s.numbers} onClick={() => hub.meta(s.numbers ? "numbersOff" : "numbersOn")}>
            <path d="M5 3 4 13M11 3l-1 10M2.5 6h11M2 10h11" />
          </MenuItem>
          {s.level.level >= 1 ? (
            <MenuItem label={t.gestures} keys="Alt+G" active={camOn} onClick={() => (camOn ? hub.stopGestures() : void hub.startGestures())}>
              <path d="M5.5 8V3.5a1 1 0 0 1 2 0V7m0-3.5v-.5a1 1 0 0 1 2 0V7m0-3a1 1 0 0 1 2 0v4.5a4.5 4.5 0 0 1-9 0V7a1 1 0 0 1 2 0v1" />
            </MenuItem>
          ) : null}
          <MenuItem label={t.palette} keys="Ctrl+K" active={s.palette} onClick={() => { setOpen(false); hub.meta("palette"); }}>
            <path d="M3 4.5h10M3 8h10M3 11.5h6" />
          </MenuItem>
        </div>
      ) : null}
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-label={t.dock} title={`${t.dock} · ${status}`}
        className={`pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full shadow-[0_8px_24px_rgba(16,24,40,0.18)] transition-all hover:scale-105 ${open || busy ? "bg-accent text-on-accent" : "border border-border bg-surface text-text"}`}>
        {v.listening ? <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-[#e5484d]/30" /> : null}
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {open ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M5.5 8V3.5a1 1 0 0 1 2 0V7m0-3.5v-.5a1 1 0 0 1 2 0V7m0-3a1 1 0 0 1 2 0v4.5a4.5 4.5 0 0 1-9 0V7a1 1 0 0 1 2 0v1" />}
        </svg>
      </button>
    </nav>
  );
}

function MenuItem({ label, keys, active, onClick, disabled, children }: { label: string; keys: string; active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={`flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-sm transition-colors disabled:opacity-40 ${active ? "bg-accent text-on-accent" : "text-text hover:bg-surface-2"}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
      <span className="flex-1">{label}</span>
      <kbd className={`text-[11px] ${active ? "opacity-80" : "text-text-3"}`}>{keys}</kbd>
    </button>
  );
}

const noSub = () => () => {};


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
  if (!interim && !heard && !s.said && !s.awake) return null;
  return (
    <div data-h247-overlay="" aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-[55] flex flex-col items-center gap-1.5 px-4">
      {s.awake && !interim ? (
        <p className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent shadow-sm">{t.awake}</p>
      ) : null}
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

const POSE: Record<Lang, Record<string, string>> = {
  es: { talk: "Hablar…", palm: "Regresar…", thumb: "Confirmar…", fist: "Puntero en pausa", pinch: "", two: "¿Qué hay aquí?…", three: "Reportar aquí…", zoom: "Zoom: sube o baja la mano", dwell: "Tocar…" },
  en: { talk: "Talk…", palm: "Going back…", thumb: "Confirming…", fist: "Pointer paused", pinch: "", two: "What is here?…", three: "Report here…", zoom: "Zoom: raise or lower your hand", dwell: "Tapping…" },
};

function HandCursor({ lang }: { lang: Lang }) {
  const s = useHubState();
  const h = s.hand;
  const hold = h.hold ?? 0;
  const label = h.pose ? POSE[lang][h.pose] ?? "" : "";
  // Field mode: a bigger cursor and ring, readable at arm's length and in the sun.
  const field = h.settings.field;
  return (
    <div data-h247-overlay="" aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70]">
      {h.snap ? (
        <div className="absolute rounded-xl ring-[3px] ring-accent transition-all duration-100"
          style={{ left: h.snap.x - 4, top: h.snap.y - 4, width: h.snap.w + 8, height: h.snap.h + 8 }} />
      ) : null}
      <div className="absolute left-0 top-0" style={{ transform: `translate(${h.x}px, ${h.y}px)` }}>
        <div className="relative -translate-x-1/2 -translate-y-1/2">
          {/* The ring fills while a pose is held still: when it closes, the action happens. */}
          {hold > 0 ? (
            <span className={`absolute left-1/2 top-1/2 ${field ? "h-16 w-16" : "h-12 w-12"} -translate-x-1/2 -translate-y-1/2 rounded-full`}
              style={{ background: `conic-gradient(var(--accent) ${hold * 360}deg, transparent 0)`, WebkitMask: "radial-gradient(circle, transparent 52%, black 54%)", mask: "radial-gradient(circle, transparent 52%, black 54%)" }} />
          ) : null}
          <div className={`rounded-full border-[3px] border-white shadow-[0_0_0_2px_rgba(0,0,0,0.35),0_4px_16px_rgba(0,0,0,0.3)] transition-[width,height,background] duration-100 ${h.pinching ? "h-5 w-5 bg-accent" : h.pose === "fist" || h.pose === "zoom" ? "h-6 w-6 bg-text-3/60" : field ? "h-11 w-11 bg-accent/30" : "h-8 w-8 bg-accent/30"}`} />
        </div>
        {label ? <span className={`absolute left-5 top-4 whitespace-nowrap rounded-full bg-[#0b1220]/90 px-2.5 py-1 font-medium text-white ${field ? "text-sm" : "text-xs"}`}>{label}</span> : null}
      </div>
    </div>
  );
}

const GUIDE: Record<Lang, { g: string; what: string; field?: boolean }[]> = {
  es: [
    { g: "☝️ Mueve el índice", what: "Mover el puntero" },
    { g: "🤏 Pellizco rápido", what: "Tocar / abrir" },
    { g: "🤏 Pellizca y mueve", what: "Girar el globo · mover la barra de años · desplazar" },
    { g: "👋 Barre con la mano abierta", what: "← → año anterior / siguiente · ↑ ↓ desplazar", field: true },
    { g: "🤌 Pulgar con dedo medio, sube o baja", what: "Acercar / alejar con una sola mano", field: true },
    { g: "✌️ Dos dedos quietos 1 s", what: "¿Qué hay aquí? Te lo dice en voz alta", field: true },
    { g: "🖖 Tres dedos quietos 1 s", what: "Reportar en este punto (lo dictas y confirmas)", field: true },
    { g: "🤙 Solo el meñique arriba", what: "Hablar: señala y di «¿qué es esto?», «reporta aquí» o «muéstrame esto en 3D»" },
    { g: "🤏🤏 Dos manos", what: "Separar = acercar · juntar = alejar" },
    { g: "✋ Palma quieta 1 s", what: "Regresar" },
    { g: "👍 Pulgar arriba 1 s", what: "Confirmar" },
    { g: "✊ Puño", what: "Pausa: recoloca la mano sin mover el puntero" },
  ],
  en: [
    { g: "☝️ Move your index", what: "Move the pointer" },
    { g: "🤏 Quick pinch", what: "Tap / open" },
    { g: "🤏 Pinch and move", what: "Spin the globe · move the year bar · scroll" },
    { g: "👋 Sweep with an open hand", what: "← → previous / next year · ↑ ↓ scroll", field: true },
    { g: "🤌 Thumb on middle finger, up or down", what: "Zoom in / out with one hand", field: true },
    { g: "✌️ Two fingers still 1 s", what: "What is here? Read aloud", field: true },
    { g: "🖖 Three fingers still 1 s", what: "Report at this point (dictate and confirm)", field: true },
    { g: "🤙 Only the pinky up", what: "Talk: point and say «what is this?», «report here» or «show this in 3D»" },
    { g: "🤏🤏 Two hands", what: "Apart = zoom in · together = zoom out" },
    { g: "✋ Still palm 1 s", what: "Go back" },
    { g: "👍 Thumbs up 1 s", what: "Confirm" },
    { g: "✊ Fist", what: "Pause: re-centre your hand without moving the pointer" },
  ],
};

/** While gestures are on: a small view of the camera (you see what it sees), the field controls and the list of gestures. */
function CameraPreview({ lang }: { lang: Lang }) {
  const hub = useHub();
  const s = useHubState();
  const box = useRef<HTMLDivElement>(null);
  const [guide, setGuide] = useState(true);
  const g = s.hand.settings;
  useEffect(() => {
    const v = hub.cameraVideo();
    const el = box.current;
    if (!v || !el) return;
    // the front camera is shown as a mirror; the rear one as it is
    v.className = `h-full w-full object-cover ${g.facing === "user" ? "-scale-x-100" : ""}`;
    el.appendChild(v);
    return () => { if (v.parentElement === el) el.removeChild(v); };
  }, [hub, s.hand.status, g.facing]);
  const es = lang === "es";
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${on ? "border-accent bg-accent text-white" : "border-border text-text hover:bg-surface-2"}`;
  return (
    <div data-h247-overlay="" className={`fixed bottom-20 right-4 z-[61] overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_14px_40px_rgba(16,24,40,0.2)] max-md:bottom-auto max-md:top-16 ${g.field ? "w-64" : "w-56"}`}>
      <div ref={box} className="relative h-32 bg-black">
        {s.hand.status === "loading" ? <p className="absolute inset-0 flex items-center justify-center text-xs text-white/80">{es ? "Encendiendo la cámara…" : "Starting the camera…"}</p> : null}
        <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.hand.visible ? "bg-[#16a34a] text-white" : "bg-black/60 text-white/80"}`}>
          {s.hand.visible ? (es ? "Mano detectada" : "Hand detected") : s.hand.resting ? (es ? "En reposo · ahorra batería" : "Resting · saving battery") : (es ? "Muestra tu mano" : "Show your hand")}
        </span>
        {s.hand.calibrating !== null ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 text-center text-white">
            <span className="text-3xl font-bold tabular-nums">{s.hand.calibrating}</span>
            <span className="px-3 text-[11px]">{es ? "Mueve el índice de esquina a esquina" : "Move your index corner to corner"}</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
        <button type="button" aria-pressed={g.field} onClick={() => hub.setField(!g.field)} className={chip(g.field)}
          title={es ? "Para trabajo en campo: tocar dejando el puntero quieto (sirve con guantes), más tolerancia y menos recorrido" : "For field work: tap by resting the pointer (works with gloves), more tolerance, less travel"}>
          {es ? "Modo campo" : "Field mode"}
        </button>
        <button type="button" onClick={() => void hub.setFacing(g.facing === "user" ? "environment" : "user")} className={chip(false)}>
          {g.facing === "user" ? (es ? "Cámara frontal" : "Front camera") : (es ? "Cámara trasera" : "Rear camera")}
        </button>
        <button type="button" onClick={() => hub.calibrate()} disabled={s.hand.status !== "on" || s.hand.calibrating !== null} className={`${chip(!!g.reach)} disabled:opacity-50`}>
          {g.reach ? (es ? "Calibrado ✓" : "Calibrated ✓") : (es ? "Calibrar" : "Calibrate")}
        </button>
        {g.reach ? (
          <button type="button" onClick={() => hub.resetCalibration()} className="text-[11px] text-text-2 underline underline-offset-2">
            {es ? "Restablecer" : "Reset"}
          </button>
        ) : null}
      </div>
      <button type="button" onClick={() => setGuide((x) => !x)} aria-expanded={guide}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-text hover:bg-surface-2">
        {es ? "Gestos" : "Gestures"}<span className="text-text-3">{guide ? "▾" : "▸"}</span>
      </button>
      {guide ? (
        <ul className="max-h-60 space-y-1.5 overflow-y-auto px-3 pb-3 text-xs">
          {g.field ? (
            <li className="rounded-lg bg-accent/10 px-2 py-1.5 text-text">{es ? "⏱️ Deja el puntero quieto 1 s para tocar (con guantes)." : "⏱️ Rest the pointer 1 s to tap (with gloves)."}</li>
          ) : null}
          {GUIDE[lang].map((x) => (
            <li key={x.g}>
              <span className="font-medium text-text">{x.g}</span>
              {x.field ? <span className="ml-1.5 rounded bg-surface-2 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-text-2">{es ? "campo" : "field"}</span> : null}
              <span className="block text-text-2">{x.what}</span>
            </li>
          ))}
          <li className="pt-1 text-text-3">{es
            ? "Alt+G enciende o apaga la cámara. Di «modo campo» o «calibra». La imagen no sale de tu equipo."
            : "Alt+G turns the camera on or off. Say «field mode» or «calibrate». The image never leaves your device."}</li>
        </ul>
      ) : null}
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
