"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Card, Ctx, Figure } from "@/core/assistant/compose";
import type { Conversation, Via } from "@/core/assistant/conversation";
import { parse, type Command } from "@/core/assistant/parse";
import { digitsFor, num } from "@/core/format/format";
import { LEGEND, type Lang, type Register } from "@/core/i18n/texts";
import { Emblem } from "./ui";
import { useSpeech } from "./useSpeech";

const T = {
  es: {
    hello: "¿Qué quieres saber del planeta?",
    sub: "Pregunta con tus palabras. HORIZON te muestra qué está cambiando, dónde, cuánto y si ya se puede saber.",
    placeholder: "Pregúntale al mapa…",
    send: "Enviar",
    mic: "Hablar",
    stop: "Dejar de escuchar",
    listening: "Te escucho…",
    voice: "Responder en voz alta",
    note: "HORIZON no da consejos ni explica por qué ocurre un cambio",
    simNote: "Demo con datos simulados",
    kicker: "Monitor del sistema Tierra",
    resume: "Volver a la conversación",
    discover: "Descubre qué puede hacer HORIZON",
    prev: "Anterior",
    next: "Siguiente",
    tryIt: "Probar",
    notThat: "No era eso",
    onMap: "Ver en el mapa",
    evidence: "Evidencia",
    origin: { hori: "Calculado por HORI", sim: "Datos simulados", ui: null },
    you: "Tú",
    starters: [
      { t: "¿Qué cambió en Durango?", d: "El cambio en una región, con su serie" },
      { t: "Solo los cambios detectados", d: "Dónde ya se puede afirmar un cambio" },
      { t: "Compara 24 y 45 años", d: "Cómo más años de datos cambian la respuesta" },
      { t: "¿Qué significa el rayado?", d: "Cómo leer «aún no se puede saber»" },
    ],
    perDecade: "por década",
    minDetect: (x: string) => `Solo se notarían cambios de ${x} o más`,
    window: "Ventana",
  },
  en: {
    hello: "What do you want to know about the planet?",
    sub: "Ask in your own words. HORIZON shows what is changing, where, how much, and whether it is knowable yet.",
    placeholder: "Ask the map…",
    send: "Send",
    mic: "Speak",
    stop: "Stop listening",
    listening: "Listening…",
    voice: "Answer out loud",
    note: "HORIZON gives no advice and does not explain why a change happens",
    simNote: "Demo with simulated data",
    kicker: "Earth system monitor",
    resume: "Back to the conversation",
    discover: "Discover what HORIZON can do",
    prev: "Previous",
    next: "Next",
    tryIt: "Try it",
    notThat: "Not that",
    onMap: "Show on the map",
    evidence: "Evidence",
    origin: { hori: "Calculated by HORI", sim: "Simulated data", ui: null },
    you: "You",
    starters: [
      { t: "What changed in Durango?", d: "The change in one region, with its series" },
      { t: "Only detected changes", d: "Where a change can already be stated" },
      { t: "Compare 24 and 45 years", d: "How more years of data change the answer" },
      { t: "What do the stripes mean?", d: "How to read “not yet knowable”" },
    ],
    perDecade: "per decade",
    minDetect: (x: string) => `Only changes of ${x} or more would show`,
    window: "Window",
  },
};

export function Chat({ conv, ctx, home, onHome, onCommand, onShow, onEvidence }: {
  conv: Conversation;
  ctx: Ctx;
  /** Show the start screen (the conversation is kept; «← Regresar» brings you here). */
  home: boolean;
  onHome: (home: boolean) => void;
  onCommand: (cmd: Command, via: Via, label: string) => void;
  /** Open the map on what an answer talks about. */
  onShow: (card: Card) => void;
  onEvidence: (card: Card) => void;
}) {
  const snap = useSyncExternalStore(conv.subscribe, conv.get, conv.get);
  const { lang, register } = ctx.state;
  const t = T[lang];
  // The "simulated data" notice is shown only when the layer on screen says so (honesty.simulated).
  const simulated = ctx.layer?.manifest.honesty.simulated === true;
  const end = useRef<HTMLDivElement>(null);
  const msgs = snap.messages;
  const lastAssistantId = [...msgs].reverse().find((m) => m.role === "assistant")?.id;

  const lastId = msgs.at(-1)?.id;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length, lastId]);

  const ask = (text: string, via: Via) => onCommand(parse(text, ctx.regions), via, text);

  if (home || msgs.length === 0) {
    // Start screen: the question, the box, and a carousel of what HORIZON can do (each card can be tried).
    return (
      <div className="relative flex h-full flex-col overflow-y-auto overflow-x-hidden">
        <HorizonBackdrop />
        <div className="relative mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center px-4 pb-6 pt-8">
          <div className="mb-4 flex justify-center"><Emblem size={92} /></div>
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.28em] text-text-3">{t.kicker}</p>
          <h1 className="mb-6 text-center text-[clamp(1.75rem,3.2vw,2.5rem)] font-semibold leading-tight tracking-tight text-balance">{t.hello}</h1>
          <Composer conv={conv} lang={lang} simulated={simulated} onSend={(x, v) => { onHome(false); ask(x, v); }} autoFocus bare />
          {msgs.length > 0 ? (
            <button type="button" onClick={() => onHome(false)} className="mx-auto mt-4 text-sm font-medium text-text-2 underline-offset-4 hover:text-text hover:underline">
              {t.resume} →
            </button>
          ) : null}
        </div>
        <Discover lang={lang} onTry={(cmd, label) => { onHome(false); onCommand(cmd, "chip", label); }} />
        {simulated ? <p className="relative px-4 pb-4 pt-2 text-center text-xs text-text-3">{t.simNote}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto">
        <ol className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-4 pb-8 pt-6">
          {msgs.map((m) => m.role === "user" ? (
            <li key={m.id} className="flex justify-end">
              <p className="max-w-[80%] rounded-3xl bg-surface-2 px-4 py-2.5 text-base">
                <span className="sr-only">{t.you}: </span>{m.text}
                {m.via === "voice" ? <span className="ml-2 text-xs text-text-3">· {lang === "es" ? "voz" : "voice"}</span> : null}
              </p>
            </li>
          ) : (
            <li key={m.id} className="enter">
              <Answer card={m.card} lang={lang} register={register} latest={m.id === lastAssistantId} ctx={ctx}
                onCommand={onCommand} onShow={onShow} onEvidence={onEvidence} />
            </li>
          ))}
        </ol>
        <div ref={end} />
      </div>
      <div className="relative px-4 pb-4 pt-2">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-bg to-transparent" />
        <div className="mx-auto w-full max-w-[760px]">
          <Composer conv={conv} lang={lang} simulated={simulated} onSend={ask} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one answer

function Answer({ card, lang, register, latest, ctx, onCommand, onShow, onEvidence }: {
  card: Card; lang: Lang; register: Register; latest: boolean; ctx: Ctx;
  onCommand: (cmd: Command, via: Via, label: string) => void; onShow: (c: Card) => void; onEvidence: (c: Card) => void;
}) {
  const t = T[lang];
  const origin = t.origin[card.origin];
  const live = card.evidence && ctx.layer?.manifest.id === card.evidence.layerId;
  // A cell's series may load after the answer was made: fall back to the live layer for the sparkline.
  let figure = card.figure;
  if (figure && !figure.series.some(Number.isFinite) && live && card.evidence?.selection.kind === "cell" && ctx.layer?.series) {
    const n = ctx.layer.manifest.window.n, i = card.evidence.selection.index;
    figure = { ...figure, series: Array.from(ctx.layer.series.subarray(i * n, i * n + n)) };
  }
  return (
    <article className="flex gap-3">
      <span className="mt-0.5 shrink-0"><Emblem size={32} /></span>
      <div className="min-w-0 flex-1">
        {card.action ? <p className="mb-1 truncate text-xs text-text-3">{card.action[lang]}</p> : null}
        <p className="text-base leading-7 text-pretty">{card.text[lang][register]}</p>
        {figure ? <FigureBlock f={figure} lang={lang} register={register} onClick={live ? () => onEvidence(card) : undefined} /> : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {origin ? (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${card.origin === "sim" ? "bg-sim/70 text-on-sim" : "border border-border text-text-2"}`}>{origin}</span>
          ) : null}
          {live ? (
            <>
              <ActionButton onClick={() => onShow(card)} icon={<MapIcon />}>{t.onMap}</ActionButton>
              <ActionButton onClick={() => onEvidence(card)} icon={<ChartIcon />}>{t.evidence}</ActionButton>
            </>
          ) : null}
          {latest && card.correctable ? (
            <ActionButton onClick={() => onCommand({ intent: { t: "undo" }, place: null }, "chip", t.notThat)} icon={<span aria-hidden="true">↶</span>}>{t.notThat}</ActionButton>
          ) : null}
        </div>
        {latest && card.chips.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {card.chips.map((c) => (
              <button key={c.label.es} type="button" onClick={() => onCommand(c.cmd, "chip", c.label[lang])}
                className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-text transition-colors hover:border-accent hover:text-accent">
                {c.label[lang]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ActionButton({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text">
      {icon}{children}
    </button>
  );
}

/** The key result inside the answer: verdict, the number that matters, and the series as a sparkline. */
function FigureBlock({ f, lang, register, onClick }: { f: Figure; lang: Lang; register: Register; onClick?: () => void }) {
  const t = T[lang];
  const d = digitsFor(register, f.effect);
  const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x), lang, d)}`;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick}
      className={`mt-3 flex w-full items-center gap-4 rounded-2xl border border-border bg-surface-2/70 p-3.5 text-left ${onClick ? "transition-colors hover:border-accent" : ""}`}>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-semibold"><VerdictGlyph v={f.verdict} />{LEGEND[lang][f.verdict].phrase}</p>
        {f.verdict === 1 && register === "sencillo" ? (
          <p className="mt-0.5 text-xl font-semibold leading-tight">
            {lang === "es" ? (f.effect > 0 ? "Sube" : "Baja") : (f.effect > 0 ? "Rising" : "Falling")}{" "}
            <span className="tabular">{num(Math.abs(f.effect), lang, d)} {f.unit}</span>
            <span className="text-sm font-normal text-text-2"> {lang === "es" ? "cada 10 años" : "every 10 years"}</span>
          </p>
        ) : f.verdict === 1 ? (
          <p className="tabular mt-0.5 text-2xl font-semibold leading-tight">
            {signed(f.effect)} <span className="text-sm font-normal text-text-2">{f.unitPerDecade}</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-text-2">{Number.isFinite(f.mde) ? t.minDetect(`${num(f.mde, lang, digitsFor(register, f.mde))} ${f.unitPerDecade}`) : ""}</p>
        )}
        <p className="tabular text-xs text-text-3">
          {register === "tecnico"
            ? `${f.verdict === 1 ? `IC ${signed(f.lo)} … ${signed(f.hi)} · ` : ""}MDE ${Number.isFinite(f.mde) ? num(f.mde, lang, digitsFor(register, f.mde)) : "—"} · ${f.window}`
            : `${t.window} ${f.window}`}
        </p>
      </div>
      <Spark values={f.series} highlight={f.verdict === 1} />
    </Tag>
  );
}

function Spark({ values, highlight }: { values: number[]; highlight: boolean }) {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 3) return null;
  const W = 150, H = 44;
  const ys = pts.map(([, v]) => v);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const path = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="ml-auto shrink-0">
      <path d={path} fill="none" stroke={highlight ? "var(--accent)" : "var(--text-3)"} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(lv)} r="3" fill={highlight ? "var(--accent)" : "var(--text-3)"} />
    </svg>
  );
}

function VerdictGlyph({ v }: { v: number }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.5" fill={v === 1 ? "currentColor" : v === 4 ? "var(--no-change)" : "none"} stroke="currentColor" strokeWidth="1.5" />
      {v === 3 ? <path d="M3 13L13 3M0 8L8 0M8 16L16 8" stroke="currentColor" strokeWidth="1.3" /> : null}
      {v === 2 ? <g fill="currentColor"><circle cx="5" cy="5" r="1.2" /><circle cx="11" cy="5" r="1.2" /><circle cx="5" cy="11" r="1.2" /><circle cx="11" cy="11" r="1.2" /></g> : null}
    </svg>
  );
}

// ---------------------------------------------------------------- composer

function Composer({ conv, lang, onSend, simulated, autoFocus = false, bare = false }: {
  conv: Conversation; lang: Lang; onSend: (text: string, via: Via) => void; autoFocus?: boolean;
  /** The layer on screen is simulated (manifest honesty.simulated): only then the "simulated" notice shows. */
  simulated: boolean;
  /** Start screen: no note and no voice option under the box. */
  bare?: boolean;
}) {
  const t = T[lang];
  const snap = useSyncExternalStore(conv.subscribe, conv.get, conv.get);
  const speech = useSpeech(lang);
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const spokenId = useRef(0);

  // Voice in → voice out (never for map exploration).
  const last = [...snap.messages].reverse().find((m) => m.role === "assistant");
  const card = last?.role === "assistant" ? last.card : null;
  useEffect(() => {
    if (!card || !snap.voiceReply || card.source === "map" || card.source === "controls" || card.id === spokenId.current) return;
    spokenId.current = card.id;
    speech.speak(card.text[lang].sencillo);
  }, [card, snap.voiceReply, speech, lang]);

  useEffect(() => { if (autoFocus) box.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  const send = (text: string, via: Via) => {
    const clean = text.trim();
    if (!clean) return;
    setDraft("");
    onSend(clean, via);
  };

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); send(draft, "text"); }}
        className={`flex items-end gap-2 rounded-3xl border border-border bg-surface p-2 pl-4 shadow-[0_6px_30px_rgba(16,24,40,0.08)] transition-shadow focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent),0_6px_30px_rgba(16,24,40,0.08)] ${speech.listening ? "shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent)]" : ""}`}>
        <label htmlFor="ask" className="sr-only">{t.placeholder}</label>
        <textarea id="ask" ref={box} rows={1} value={speech.listening ? speech.interim : draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft, "text"); } }}
          placeholder={speech.listening ? t.listening : t.placeholder}
          className="max-h-[180px] min-h-11 flex-1 resize-none bg-transparent py-2.5 text-base leading-6 text-text outline-none placeholder:text-text-3 focus:outline-none focus-visible:outline-none" />
        {speech.supported ? (
          <button type="button" onClick={() => (speech.listening ? speech.stop() : speech.listen((x) => send(x, "voice")))}
            aria-label={speech.listening ? t.stop : t.mic} title={speech.listening ? t.stop : t.mic} aria-pressed={speech.listening}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${speech.listening ? "bg-accent text-on-accent" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}>
            <MicIcon />
          </button>
        ) : null}
        <button type="submit" aria-label={t.send} title={t.send} disabled={!draft.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-30">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 15V3M4 8l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </form>
      {bare ? null : <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-2 text-xs text-text-3">
        <span>{simulated ? `${t.simNote} · ` : ""}{t.note}</span>
        <label className="flex cursor-pointer items-center gap-1.5 hover:text-text">
          <input type="checkbox" checked={snap.voiceReply} onChange={(e) => { conv.setVoiceReply(e.target.checked); if (!e.target.checked) speech.hush(); }} className="h-3.5 w-3.5 accent-[var(--accent)]" />
          {t.voice}
        </label>
      </div>}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="6.25" y="1.75" width="5.5" height="9.5" rx="2.75" />
      <path d="M3.5 8.5a5.5 5.5 0 0 0 11 0M9 14v2.5" strokeLinecap="round" />
    </svg>
  );
}
export function MapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M1.5 3.5l4-1.5 5 2 4-1.5v10l-4 1.5-5-2-4 1.5z" strokeLinejoin="round" /><path d="M5.5 2v10M10.5 4v10" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2 13.5h12M3 10l3-3 3 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------- start screen pieces

/** A static horizon: faint dotted grid and the glowing limb of a planet (no motion, doc 03 §6). */
function HorizonBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 35%, black, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 35%, black, transparent 75%)",
        }} />
      <div className="absolute inset-x-0 bottom-0 h-[55%]"
        style={{ background: "radial-gradient(120% 90% at 50% 120%, var(--horizon-glow), transparent 70%)" }} />
    </div>
  );
}

type Art = "voice" | "legend" | "compare" | "filter" | "years" | "data";
const CARDS: Record<Lang, { art: Art; title: string; desc: string; cmd: Command; label: string }[]> = {
  es: [
    { art: "voice", title: "Pregunta como hablas", desc: "Escribe o usa el micrófono. El mapa se mueve solo hacia lo que preguntas.", cmd: { intent: { t: "help" }, place: null }, label: "¿Qué puedes hacer?" },
    { art: "legend", title: "Lee el mapa en 5 segundos", desc: "Sólido = cambio detectado. Rayado = aún no se puede saber, que no es lo mismo que «no cambia».", cmd: { intent: { t: "legend" }, place: null }, label: "¿Qué significa el rayado?" },
    { art: "compare", title: "Más años, más certeza", desc: "Con 24 años algo puede ser «aún no»; con 45 ya se ve. HORIZON te dice cuántos años faltan.", cmd: { intent: { t: "compare" }, place: null }, label: "Compara 24 y 45 años" },
    { art: "filter", title: "Solo lo que ya es seguro", desc: "Filtra el planeta para ver únicamente las zonas con cambio detectado.", cmd: { intent: { t: "filter", verdicts: [1] }, place: null }, label: "Solo los cambios detectados" },
    { art: "years", title: "Mira cada año", desc: "Reproduce 1980–2024 en el mapa, año por año, con un solo botón.", cmd: { intent: { t: "year", y: null }, place: null }, label: "Año a año" },
    { art: "data", title: "Cada número tiene origen", desc: "Producto, versión y métodos a un clic. Si no se puede saber, lo dice.", cmd: { intent: { t: "provenance" }, place: null }, label: "¿De dónde salen los datos?" },
  ],
  en: [
    { art: "voice", title: "Ask the way you talk", desc: "Type or use the microphone. The map moves to whatever you ask about.", cmd: { intent: { t: "help" }, place: null }, label: "What can you do?" },
    { art: "legend", title: "Read the map in 5 seconds", desc: "Solid = change detected. Striped = not yet knowable, which is not the same as “no change”.", cmd: { intent: { t: "legend" }, place: null }, label: "What do the stripes mean?" },
    { art: "compare", title: "More years, more certainty", desc: "With 24 years something may be “not yet”; with 45 it shows. HORIZON tells you how many years are missing.", cmd: { intent: { t: "compare" }, place: null }, label: "Compare 24 and 45 years" },
    { art: "filter", title: "Only what is already certain", desc: "Filter the planet to see only the areas with a detected change.", cmd: { intent: { t: "filter", verdicts: [1] }, place: null }, label: "Only detected changes" },
    { art: "years", title: "Watch every year", desc: "Play 1980–2024 on the map, year by year, with one button.", cmd: { intent: { t: "year", y: null }, place: null }, label: "Year by year" },
    { art: "data", title: "Every number has a source", desc: "Product, version and methods one click away. If it cannot be known, it says so.", cmd: { intent: { t: "provenance" }, place: null }, label: "Where does the data come from?" },
  ],
};

function Discover({ lang, onTry }: { lang: Lang; onTry: (cmd: Command, label: string) => void }) {
  const t = T[lang];
  const row = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const update = () => {
    const el = row.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  };
  const go = (dir: number) => row.current?.scrollBy({ left: dir * 296, behavior: "smooth" });

  // Auto-advance every 5 s; stops while the pointer or the keyboard focus is on the carousel,
  // and never runs if the person asked the system for less motion.
  const [holding, setHolding] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const auto = !holding && !reduced;
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => {
      const el = row.current;
      if (!el) return;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + 296, behavior: "smooth" });
    }, 5000);
    return () => window.clearInterval(id);
  }, [auto]);
  return (
    <section aria-labelledby="discover" className="relative mx-auto w-full max-w-[1120px] px-4 pb-4" aria-roledescription="carrusel"
      onMouseEnter={() => setHolding(true)} onMouseLeave={() => setHolding(false)}
      onFocus={() => setHolding(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHolding(false); }}>
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 id="discover" className="text-sm font-semibold">{t.discover}</h2>
        <div className="flex gap-1.5">
          <ArrowButton label={t.prev} disabled={edge.start} onClick={() => go(-1)}><path d="M10 3L5 8l5 5" /></ArrowButton>
          <ArrowButton label={t.next} disabled={edge.end} onClick={() => go(1)}><path d="M6 3l5 5-5 5" /></ArrowButton>
        </div>
      </div>
      <ul ref={row} onScroll={update} aria-label={t.discover}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: "linear-gradient(90deg, transparent, black 24px, black calc(100% - 24px), transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, black 24px, black calc(100% - 24px), transparent)" }}>
        {CARDS[lang].map((c, i) => (
          <li key={c.art} className={`snap-start ${i === 0 ? "pl-6" : ""} ${i === CARDS[lang].length - 1 ? "pr-6" : ""}`}>
            <button type="button" onClick={() => onTry(c.cmd, c.label)}
              className="group flex h-full w-[280px] flex-col overflow-hidden rounded-2xl border border-border bg-surface/90 text-left backdrop-blur transition-all hover:-translate-y-0.5 hover:border-text-3 hover:shadow-[0_12px_30px_rgba(0,0,0,0.08)]">
              <span className="flex h-[96px] items-center justify-center border-b border-border bg-surface-2/70"><CardArt art={c.art} /></span>
              <span className="flex flex-1 flex-col p-4">
                <span className="text-[15px] font-semibold">{c.title}</span>
                <span className="mt-1 flex-1 text-sm leading-snug text-text-2">{c.desc}</span>
                <span className="mt-3 text-sm font-semibold text-text group-hover:underline group-hover:underline-offset-4">{t.tryIt} →</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArrowButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text transition-opacity hover:bg-surface-2 disabled:opacity-30">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
    </button>
  );
}

/** Small line illustrations for the carousel (data colours only where they mean data). */
function CardArt({ art }: { art: Art }) {
  const ink = "currentColor";
  return (
    <svg width="168" height="64" viewBox="0 0 168 64" fill="none" aria-hidden="true" className="text-text-2">
      {art === "voice" ? (
        <>
          <rect x="74" y="10" width="20" height="32" rx="10" stroke={ink} strokeWidth="2" />
          <path d="M66 32a18 18 0 0 0 36 0M84 50v6" stroke={ink} strokeWidth="2" strokeLinecap="round" />
          {[12, 22, 32].map((d) => <path key={d} d={`M${60 - d / 2} ${26 - d / 4}q-${d / 3} ${8 + d / 4} 0 ${16 + d / 2}M${108 + d / 2} ${26 - d / 4}q${d / 3} ${8 + d / 4} 0 ${16 + d / 2}`} stroke={ink} strokeWidth="1.5" strokeLinecap="round" opacity={1 - d / 50} />)}
        </>
      ) : art === "legend" ? (
        <>
          <rect x="22" y="14" width="36" height="36" rx="8" fill="var(--data-red, #D9481F)" />
          <rect x="66" y="14" width="36" height="36" rx="8" stroke={ink} strokeWidth="1.5" />
          {[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => <circle key={`${r}${c}`} cx={72 + c * 8} cy={20 + r * 8} r="1.4" fill={ink} />))}
          <rect x="110" y="14" width="36" height="36" rx="8" stroke={ink} strokeWidth="1.5" />
          <path d="M112 44l28-28M112 34l18-18M122 48l22-22M134 48l10-10" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : art === "compare" ? (
        <>
          <rect x="30" y="28" width="44" height="22" rx="6" stroke={ink} strokeWidth="1.5" />
          <path d="M34 46l36-14M34 38l22-8" stroke={ink} strokeWidth="1.3" opacity="0.7" />
          <text x="52" y="22" textAnchor="middle" fontSize="11" fontWeight="600" fill={ink}>24</text>
          <path d="M82 39h12M90 35l4 4-4 4" stroke={ink} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="102" y="28" width="44" height="22" rx="6" fill="var(--data-red, #D9481F)" />
          <text x="124" y="22" textAnchor="middle" fontSize="11" fontWeight="600" fill={ink}>45</text>
        </>
      ) : art === "filter" ? (
        <>
          {Array.from({ length: 6 }, (_, r) => Array.from({ length: 14 }, (_, c) => {
            const on = (r * 3 + c * 5) % 7 === 0 || (r === 2 && c > 4 && c < 9);
            return <rect key={`${r}-${c}`} x={22 + c * 9} y={6 + r * 9} width="7" height="7" rx="1.5"
              fill={on ? (c > 8 ? "#2B73D6" : "#D9481F") : "currentColor"} opacity={on ? 1 : 0.14} />;
          }))}
        </>
      ) : art === "years" ? (
        <>
          <circle cx="34" cy="32" r="14" fill={ink} />
          <path d="M30 25l11 7-11 7z" fill="var(--surface)" />
          <path d="M58 32h86" stroke={ink} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
          <path d="M58 32h52" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="110" cy="32" r="5" fill={ink} />
          <text x="58" y="52" fontSize="10" fill={ink}>1980</text>
          <text x="144" y="52" fontSize="10" textAnchor="end" fill={ink}>2024</text>
        </>
      ) : (
        <>
          <path d="M44 10l20 7v14c0 12-9 20-20 23-11-3-20-11-20-23V17z" stroke={ink} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M36 32l6 6 11-12" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M78 46l12-10 10 6 14-16 16 8 12-14" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M78 54h66" stroke={ink} strokeWidth="1.2" opacity="0.3" />
        </>
      )}
    </svg>
  );
}
