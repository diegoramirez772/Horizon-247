// The interaction hub (doc «Interacción v2» §4.1): every device ends here as words or verbs, and leaves as ONE of
// the same operations a button would do. Framework-free external store; React only draws its snapshot.
//   voice / typed palette → interpret() → interface command | number | control by name | view move | ZON | assistant
//   keys / gamepad / TV remote / switch → the five verbs on the focus (spatial navigation)
//   hand → pointer + pinch (activate / move) + palm (back) + thumbs up (confirm)
// Writes to ZON always go through a spoken + visible confirmation that reads the parameters back (doc §4.3).

import type { Card } from "@/core/assistant/compose";
import type { Lang } from "@/core/i18n/texts";
import { normalize } from "@/core/assistant/patterns";
import { applyDictation } from "./dictation";
import { activate, isTextField, magnet, moveFocus, pressEscape, scrollBy, stepFocus, tapAt, targets, type Target } from "./dom";
import { play } from "./earcons";
import { GestureMachine, type HandEvent, type Pose } from "./gestures";
import { HandTracker, type HandStats } from "./hand";
import { interpret, type Interpretation, type ManipKey, type MetaKey, type Mode, type SystemKey } from "./interpret";
import { activeManipulable, isSpinning, manipulableAt, startSpin, stopSpin, touch, type Manipulable } from "./manipulate";
import { batteryLow, detectLevel, Pads, type LevelInfo, type PadEvent } from "./devices";
import { spokenToDigits } from "./numbers";
import { Voice, type VoiceSnapshot } from "./voice";
import { ALERT_NEXT, monitorId, reporterId, zon, zonConfig, ZonError, type ZonAlert } from "./zon";
import { dbConfigured, listSwarmReports, sendSwarmReport } from "@/core/live/db";

export interface Here { name: string; lat: number; lon: number; entityId: string; variable: { name: string; unit: string; long_name?: string } | null }

export interface HubDeps {
  lang(): Lang;
  /** A question or command for the assistant (its own parser): `text` is normalized with digits, `label` is what was said. */
  ask(text: string, via: "voice" | "text", label: string): void;
  /** Adds an answer card to the conversation. */
  answer(card: Card): void;
  /** What is selected now, for «vigila esto» / «reporta aquí». */
  here(): Here | null;
  /** Opens the map panel (so «acércate» has something to move). */
  openMap(): void;
}

type T2 = Record<Lang, string>;

/**
 * A screen's own vocabulary (the scene generator: «más lluvia», «agrega 5 vacas»). Tried before the assistant and
 * before matching a control by name. `text` is normalized with digits. Return what to say, or null if not yours.
 */
export interface Domain {
  id: string;
  title: T2;
  handle(text: string, raw: string): T2 | null;
  /** Shown in the palette. */
  examples: Record<Lang, [string, string?][]>;
}

const RANGE_UP = ["sube", "subele", "mas", "aumenta", "incrementa", "up", "more", "increase", "raise"];
const RANGE_DOWN = ["baja", "bajale", "menos", "reduce", "disminuye", "down", "less", "decrease", "lower"];
export interface Pending { title: T2; lines: Record<Lang, string[]>; risk: "escritura" | "publicar"; run: () => Promise<void>; expires: number; sending: boolean }
export interface HandView { status: HandStats["status"]; x: number; y: number; visible: boolean; pinching: boolean; pose?: Pose; hold?: number; perSecond: number; inferMs: number; error?: string; snap: { x: number; y: number; w: number; h: number } | null }
export interface Notice { id: number; text: string; tone: "ok" | "error" | "info" }

export interface HubSnapshot {
  level: LevelInfo;
  mode: Mode;
  numbers: boolean;
  palette: boolean;
  paletteView: "commands" | "zon";
  heard: string;
  said: string;
  pending: Pending | null;
  choose: { n: number; name: string }[] | null;
  hand: HandView;
  notice: Notice | null;
  /** Report being dictated (doc §4.2 report.create). */
  reportDraft: { text: string; here: Here } | null;
  voice: VoiceSnapshot;
}

const M = {
  es: {
    noControl: (n: number) => `No hay un control con el número ${n}.`,
    numbersOn: "Di el número del control. «Oculta números» para quitarlos.",
    dictating: "Dictando. Di «listo» para terminar o «envía» para mandar.",
    dictEnd: "Dictado terminado.",
    handsFreeOn: "Manos libres: te escucho hasta que digas «deja de escuchar».",
    handsFreeOff: "Dejé de escuchar.",
    noView: "Abrí el mapa: repite la orden para moverlo.",
    gesturesOn: "Gestos activos: señala con el índice, junta índice y pulgar para tocar, palma abierta para regresar, pulgar arriba para confirmar.",
    gesturesOff: "Cámara apagada.",
    gesturesWeak: "Este equipo no tiene gráfica para gestos con cámara: usa la voz, el teclado o un mando.",
    camError: "No pude usar la cámara. Revisa el permiso del navegador.",
    choose: "¿Cuál? Di el número.",
    expired: "La confirmación caducó; no se hizo nada.",
    cancelled: "Cancelado; no se hizo nada.",
    sending: "Enviando…",
    noZon: "ZON no está conectado. Di «conecta ZON» o abre los comandos (Ctrl+K) para poner su dirección.",
    zonDown: "No pude hablar con ZON. Revisa la dirección y la llave.",
    noHere: "Primero elige un lugar: tócalo en el mapa, señálalo o di su nombre.",
    noAlerts: "No hay alertas que coincidan.",
    whichAlert: "¿Cuál alerta? Di por ejemplo «reconoce la alerta 2».",
    notAllowed: (from: string, to: string) => `Una alerta ${from} no puede pasar a ${to}.`,
    reportStart: "Dicta el reporte. Di «envía» cuando termines.",
    confirmHint: "Di «sí» o «cancela» · pulgar arriba · botón A",
    zonError: (e: string) => `ZON respondió: ${e}`,
    noVoice: "Este navegador no reconoce voz. Puedes usar el teclado, la paleta (Ctrl+K) o un mando.",
    micDenied: "El micrófono está bloqueado para esta página.",
    silence: "Silencio.",
    unheard: "No te entendí. Di «números» o «comandos».",
  },
  en: {
    noControl: (n: number) => `There is no control number ${n}.`,
    numbersOn: "Say the number of a control. «Hide numbers» removes them.",
    dictating: "Dictating. Say «done» to finish or «send» to send.",
    dictEnd: "Dictation finished.",
    handsFreeOn: "Hands-free: I keep listening until you say «stop listening».",
    handsFreeOff: "I stopped listening.",
    noView: "I opened the map: say it again to move it.",
    gesturesOn: "Gestures on: point with your index finger, pinch to tap, open palm to go back, thumbs up to confirm.",
    gesturesOff: "Camera off.",
    gesturesWeak: "This device has no graphics for camera gestures: use voice, the keyboard or a gamepad.",
    camError: "I could not use the camera. Check the browser permission.",
    choose: "Which one? Say the number.",
    expired: "The confirmation expired; nothing was done.",
    cancelled: "Cancelled; nothing was done.",
    sending: "Sending…",
    noZon: "ZON is not connected. Say «connect ZON» or open the commands (Ctrl+K) to set its address.",
    zonDown: "I could not reach ZON. Check the address and the key.",
    noHere: "First pick a place: tap it on the map, point at it or say its name.",
    noAlerts: "No alerts match.",
    whichAlert: "Which alert? Say for example «acknowledge alert 2».",
    notAllowed: (from: string, to: string) => `An alert that is ${from} cannot become ${to}.`,
    reportStart: "Dictate the report. Say «send» when you are done.",
    confirmHint: "Say «yes» or «cancel» · thumbs up · A button",
    zonError: (e: string) => `ZON answered: ${e}`,
    noVoice: "This browser does not recognise speech. Use the keyboard, the palette (Ctrl+K) or a gamepad.",
    micDenied: "The microphone is blocked for this page.",
    silence: "Quiet.",
    unheard: "I did not get that. Say «numbers» or «commands».",
  },
};

const STATE_EN: Record<string, string> = { abierta: "open", reconocida: "acknowledged", derivada: "escalated", cerrada: "closed" };
const CONFIRM_MS = 25000;
let cardId = 900000;

function zonCard(es: string, en: string): Card {
  return {
    id: cardId++, kind: "zon", source: "system", action: null,
    text: { es: { sencillo: es, normal: es, tecnico: es }, en: { sencillo: en, normal: en, tecnico: en } },
    origin: "zon", evidence: null, chips: [], correctable: false,
  };
}

export class Hub {
  private deps: HubDeps;
  readonly voice = new Voice();
  private snap: HubSnapshot;
  private listeners = new Set<() => void>();
  private cleanup: (() => void)[] = [];
  private gestures = new GestureMachine();
  private tracker: HandTracker | null = null;
  private pads = new Pads();
  private handsFree = false;
  private dictTarget: HTMLInputElement | HTMLTextAreaElement | null = null;
  private dictPrev: string | null = null;
  private lastAlerts: ZonAlert[] = [];
  private dragView: Manipulable | null = null;
  private lastCursor = { x: -1, y: -1 };
  private noticeTimer = 0;
  private digitBuf = "";
  private digitTimer = 0;
  private frameWatch = 0;
  private domains: Domain[] = [];
  private dragRange: HTMLInputElement | null = null;

  constructor(deps: HubDeps) {
    this.deps = deps;
    this.snap = {
      level: { level: 0, reason: "ssr", gpuHands: false }, mode: "commands", numbers: false, palette: false, paletteView: "commands",
      heard: "", said: "", pending: null, choose: null,
      hand: { status: "off", x: 0, y: 0, visible: false, pinching: false, perSecond: 0, inferMs: 0, snap: null },
      notice: null, reportDraft: null, voice: this.voice.get(),
    };
    this.voice.onSpeakStart = (text) => this.set({ said: text });
    this.voice.onSpeakEnd = () => this.set({ said: "" });
    this.voice.onBargeIn = () => play("tick");
  }

  // ---- store ----
  get = (): HubSnapshot => this.snap;
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<HubSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l();
  }
  private get m() { return M[this.deps.lang()]; }
  private get lang(): Lang { return this.deps.lang(); }

  setDeps(d: HubDeps): void { this.deps = d; }

  registerDomain(d: Domain): () => void {
    this.domains = [...this.domains.filter((x) => x.id !== d.id), d];
    this.set({});
    return () => { this.domains = this.domains.filter((x) => x !== d); this.set({}); };
  }
  getDomains(): Domain[] { return this.domains; }

  /** Installs keys, gamepad and the level. Call once on the client; returns the uninstaller. */
  install(): () => void {
    this.set({ level: detectLevel() });
    void batteryLow().then((low) => { if (low && this.snap.level.level >= 2) this.set({ level: { ...this.snap.level, level: 1, reason: "battery" } }); });
    this.cleanup.push(this.voice.subscribe(() => {
      const v = this.voice.get();
      this.set({ voice: v });
      if (v.error === "not-allowed" || v.error === "service-not-allowed") this.notify(this.m.micDenied, "error");
    }));
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener("keydown", onKey, true);
    this.cleanup.push(() => window.removeEventListener("keydown", onKey, true));
    this.pads.onEvent = (e) => this.onPad(e);
    this.pads.start();
    this.cleanup.push(() => this.pads.stop());
    const vis = () => { if (document.hidden && this.voice.get().session) this.voice.release(); };
    document.addEventListener("visibilitychange", vis);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", vis));
    return () => { for (const c of this.cleanup.splice(0)) c(); this.stopGestures(); this.voice.destroy(); };
  }

  notify(text: string, tone: Notice["tone"] = "info", speak = false): void {
    clearTimeout(this.noticeTimer);
    this.set({ notice: { id: Date.now(), text, tone } });
    this.noticeTimer = window.setTimeout(() => this.set({ notice: null }), tone === "error" ? 7000 : 4500);
    if (speak) this.speak(text);
  }

  /** Speaks if the user is in a voice turn or hands-free (voice in → voice out). */
  speak(text: string): void { this.voice.lang = this.lang; this.voice.speak(text); }
  hush(): void { this.voice.hush(); }

  // ---- voice ----
  /** The microphone button / Alt+V / gamepad Y: one turn, or the hands-free session if it is on. */
  talk(): void {
    const v = this.voice.get();
    if (!v.supported) { this.notify(this.m.noVoice, "error"); return; }
    if (v.listening) { this.voice.stop(); return; }
    this.hush();
    play("listen");
    this.voice.lang = this.lang;
    void this.voice.listen((t) => this.hear(t, "voice"), this.handsFree);
  }

  setHandsFree(on: boolean): void {
    this.handsFree = on;
    if (on) {
      this.notify(this.m.handsFreeOn, "info");
      if (!this.voice.get().listening) this.talk();
      else void this.voice.listen((t) => this.hear(t, "voice"), true);
    } else {
      this.voice.release();
      this.notify(this.m.handsFreeOff, "info");
    }
  }
  isHandsFree(): boolean { return this.handsFree; }

  /** Everything said or typed in the palette comes here. */
  hear(text: string, via: "voice" | "text"): void {
    const list = targets();
    const choose = this.snap.choose;
    const it = interpret(text, {
      mode: this.snap.mode,
      pendingConfirm: !!this.snap.pending,
      labels: list.map((t, i) => ({ n: i + 1, name: t.name })),
      hasManip: !!activeManipulable(),
    });
    if (via === "voice") { this.set({ heard: text }); play("heard"); }
    // While choosing, a number picks among the options (not among all the controls).
    if (choose && it.k === "number") {
      const c = choose[it.n - 1];
      this.set({ choose: null });
      if (c) this.pick(c.n, list);
      return;
    }
    // A bare number with a slider focused and no numbered overlay sets the slider («treinta»).
    if (it.k === "number" && !this.snap.numbers && this.focusedRange(String(it.n))) return;
    if (it.k === "label" || it.k === "choose" || it.k === "assistant") {
      const t = spokenToDigits(normalize(text));
      if (this.focusedRange(t)) return;
      for (const d of this.domains) {
        const said = d.handle(t, text);
        if (said) { play("done"); this.answerShort(said, via); return; }
      }
    }
    this.dispatch(it, list, via, text);
  }

  /** A short spoken + shown answer that is not a conversation card (screen domains). */
  private answerShort(said: T2, via: "voice" | "text"): void {
    const txt = said[this.lang];
    this.lastSaid = txt;
    this.notify(txt, "ok", via === "voice" || this.handsFree);
  }

  /** «sube», «baja», «a 30» while a slider has the focus: steps it like the arrow keys (every slider, every screen). */
  private focusedRange(t: string): boolean {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement) || el.type !== "range") return false;
    const n = t.match(/^(?:a |en |to )?(-?\d+(?:\.\d+)?)$/);
    const words = t.split(" ");
    const big = words.includes("mucho") || words.includes("much") ? 5 : 1;
    if (n) setRange(el, Number(n[1]));
    else if (words.some((w) => RANGE_UP.includes(w))) stepRange(el, big);
    else if (words.some((w) => RANGE_DOWN.includes(w))) stepRange(el, -big);
    else return false;
    play("tick");
    return true;
  }

  private dispatch(it: Interpretation, list: Target[], via: "voice" | "text", raw: string): void {
    switch (it.k) {
      case "none": return;
      case "confirm": void this.confirm(it.yes); return;
      case "meta": this.meta(it.what); return;
      case "number": this.pick(it.n, list); return;
      case "label": this.pick(it.n, list); return;
      case "choose": {
        const opts = it.options.map((n) => ({ n, name: list[n - 1]?.name ?? "" }));
        this.set({ choose: opts });
        play("confirm");
        this.notify(this.m.choose, "info", via === "voice");
        return;
      }
      case "manip": this.manip(it.what, it.times); return;
      case "system": void this.system(it.what, it.deixis, it.ordinal, it.rest, via); return;
      case "dictation": this.dictate(it.raw); return;
      case "assistant": {
        this.set({ choose: null });
        this.deps.ask(it.text, via, raw.trim());
        return;
      }
    }
  }

  private pick(n: number, list: Target[]): void {
    const t = list[n - 1];
    if (!t) { play("error"); this.notify(this.m.noControl(n), "error"); return; }
    activate(t.el);
    play("done");
    if (isTextField(t.el) && this.snap.voice.listening) this.startDictation(t.el);
  }

  // ---- interface commands ----
  meta(what: MetaKey): void {
    switch (what) {
      case "numbersOn": this.set({ numbers: true, choose: null }); play("done"); this.notify(this.m.numbersOn); return;
      case "numbersOff": this.set({ numbers: false }); play("done"); return;
      case "palette": this.set({ palette: !this.snap.palette, paletteView: "commands" }); return;
      case "dictate": this.startDictation(isTextField(document.activeElement) ? document.activeElement : null); return;
      case "dictateEnd": this.endDictation(); return;
      case "send": this.send(); return;
      case "stopListening": this.handsFree = false; this.voice.release(); play("done"); return;
      case "silence": this.hush(); stopSpin(); return;
      case "handsFree": this.setHandsFree(true); return;
      case "commandsMode": this.endDictation(); return;
      case "gesturesOn": void this.startGestures(); return;
      case "gesturesOff": this.stopGestures(); return;
      case "close": this.back(); return;
      case "scrollDown": scrollBy(Math.round(innerHeight * 0.6)); return;
      case "scrollUp": scrollBy(-Math.round(innerHeight * 0.6)); return;
      case "nextField": stepFocus(1); return;
      case "prevField": stepFocus(-1); return;
      case "speakAgain": case "readAloud": {
        const last = this.lastSaid;
        if (last) this.speak(last);
        return;
      }
    }
  }
  /** Last text the app spoke or would speak (for «repite»). Set by speakCard. */
  private lastSaid = "";
  speakCard(text: string, out: boolean): void {
    this.lastSaid = text;
    if (out) this.speak(text);
  }

  /** «atrás» / Esc / palm / B: closes what is open, innermost first; else the app's own Esc. */
  back(): void {
    if (this.snap.pending) { void this.confirm(false); return; }
    if (this.snap.choose) { this.set({ choose: null }); return; }
    if (this.snap.palette) { this.set({ palette: false }); return; }
    if (this.snap.numbers) { this.set({ numbers: false }); return; }
    if (this.snap.mode === "dictation") { this.endDictation(); return; }
    pressEscape();
  }

  // ---- dictation ----
  startDictation(el: HTMLInputElement | HTMLTextAreaElement | null, keepReport = false): void {
    const target = el ?? (document.getElementById("ask") as HTMLTextAreaElement | null);
    if (!keepReport) this.set({ reportDraft: null });
    this.dictTarget = keepReport ? null : target;
    this.dictPrev = null;
    target?.focus();
    this.set({ mode: "dictation" });
    play("listen");
    this.notify(keepReport ? this.m.reportStart : this.m.dictating, "info");
    if (this.voice.get().supported && !this.voice.get().listening) {
      this.voice.lang = this.lang;
      void this.voice.listen((t) => this.hear(t, "voice"), true);
    }
  }

  endDictation(): void {
    if (this.snap.mode !== "dictation") return;
    this.set({ mode: "commands" });
    this.dictTarget = null;
    if (!this.handsFree) this.voice.stop();
    play("done");
    this.notify(this.m.dictEnd);
  }

  private dictate(raw: string): void {
    const rep = this.snap.reportDraft;
    const current = rep ? rep.text : this.dictTarget?.value ?? "";
    const r = applyDictation(current, raw, this.dictPrev);
    if (r.op === "readBack") { this.speak(current || "—"); return; }
    if (r.op === "noMatch") return;
    this.dictPrev = current;
    if (rep) { this.set({ reportDraft: { ...rep, text: r.text } }); return; }
    if (this.dictTarget) setFieldValue(this.dictTarget, r.text);
  }

  private send(): void {
    const rep = this.snap.reportDraft;
    if (rep) { this.set({ mode: "commands" }); this.proposeReport(rep.text, rep.here); return; }
    const el = this.dictTarget ?? (document.activeElement as HTMLElement | null);
    const form = el?.closest("form");
    this.set({ mode: "commands" });
    this.dictTarget = null;
    if (!this.handsFree) this.voice.stop();
    if (form) { form.requestSubmit(); play("done"); }
  }

  // ---- moving the active view ----
  manip(what: ManipKey, times = 1): void {
    const m = activeManipulable();
    if (!m) { this.deps.openMap(); this.notify(this.m.noView, "info"); return; }
    touch(m);
    if (what !== "spin" && what !== "stop") stopSpin();
    const step = 0.12 * times;
    switch (what) {
      case "left": m.orbit(-step, 0); break;
      case "right": m.orbit(step, 0); break;
      case "up": m.orbit(0, -step); break;
      case "down": m.orbit(0, step); break;
      case "zoomIn": m.zoomBy(1.4 ** times); break;
      case "zoomOut": m.zoomBy(0.7 ** times); break;
      case "spin": startSpin(); break;
      case "stop": if (!stopSpin()) m.setPlaying?.(false); break;
      case "reset": m.reset(); break;
      case "play": m.setPlaying?.(true); break;
      case "pause": m.setPlaying?.(false); break;
    }
    play("tick");
  }

  // ---- ZON operations ----
  private async system(what: SystemKey, deixis: boolean, ordinal: number | null, rest: string, via: "voice" | "text"): Promise<void> {
    const m = this.m;
    const L = this.lang;
    if (what === "connect") { this.set({ palette: true, paletteView: "zon" }); return; }
    // Reports and the swarm also work without a ZON server: they go to the team database (red pública).
    const viaDb = !zonConfig() && dbConfigured() && (what === "report" || what === "swarm");
    if (!zonConfig() && !viaDb) { play("error"); this.deps.answer(zonCard(M.es.noZon, M.en.noZon)); return; }
    // «esto / aquí» with the hand or pointer over the map = tap there first, so «here» is what you point at.
    if (deixis && this.snap.hand.visible) {
      const { x, y } = this.lastCursor;
      if (manipulableAt(x, y)) { tapAt(x, y); await new Promise((r) => setTimeout(r, 120)); }
    }
    try {
      switch (what) {
        case "health": {
          const h = await zon.health();
          this.deps.answer(zonCard(
            `ZON ${h.status === "ok" ? "funciona" : h.status}. Registro de auditoría ${h.audit_intact ? "íntegro" : "ALTERADO"} (${h.audit_records} registros).`,
            `ZON is ${h.status === "ok" ? "up" : h.status}. Audit log ${h.audit_intact ? "intact" : "TAMPERED"} (${h.audit_records} records).`));
          play(h.audit_intact ? "done" : "error");
          return;
        }
        case "monitors": {
          const ms = await zon.monitors();
          const line = (x: (typeof ms)[number], i: number) => `${i + 1}. ${x.entity?.name ?? x.id} · ${x.variable?.name ?? ""}${x.cadence ? ` · ${x.cadence}` : ""}`;
          this.deps.answer(zonCard(
            ms.length ? `Tienes ${ms.length} monitor${ms.length === 1 ? "" : "es"}:\n${ms.slice(0, 12).map(line).join("\n")}` : "No tienes monitores todavía. Di «vigila esto» sobre un lugar.",
            ms.length ? `You have ${ms.length} monitor${ms.length === 1 ? "" : "s"}:\n${ms.slice(0, 12).map(line).join("\n")}` : "No monitors yet. Say «watch this» over a place."));
          play("done");
          return;
        }
        case "alerts": {
          const al = (await zon.alerts()).filter((a) => a.state !== "cerrada");
          this.lastAlerts = al;
          const line = (a: ZonAlert, i: number, en: boolean) => `${i + 1}. ${a.monitor} · ${a.variable} · ${a.type} · ${a.severity} · ${en ? STATE_EN[a.state] ?? a.state : a.state}${a.entity_status === "simulada" ? (en ? " · simulated" : " · simulada") : ""}`;
          this.deps.answer(zonCard(
            al.length ? `${al.length} alerta${al.length === 1 ? "" : "s"} sin cerrar:\n${al.slice(0, 10).map((a, i) => line(a, i, false)).join("\n")}\nUna anomalía es una desviación estadística: no demuestra una falla.` : M.es.noAlerts,
            al.length ? `${al.length} alert${al.length === 1 ? "" : "s"} not closed:\n${al.slice(0, 10).map((a, i) => line(a, i, true)).join("\n")}\nAn anomaly is a statistical deviation: it does not show a fault.` : M.en.noAlerts));
          play("done");
          return;
        }
        case "ack": case "escalate": case "closeAlert": {
          const to = what === "ack" ? "reconocida" : what === "escalate" ? "derivada" : "cerrada";
          let pool = this.lastAlerts;
          if (!pool.length) pool = this.lastAlerts = (await zon.alerts()).filter((a) => a.state !== "cerrada");
          const a = ordinal === -1 ? pool.at(-1) : ordinal ? pool[ordinal - 1] : pool.length === 1 ? pool[0] : undefined;
          if (!a) { play("confirm"); this.notify(pool.length ? m.whichAlert : m.noAlerts, "info", via === "voice"); return; }
          if (!ALERT_NEXT[a.state]?.includes(to)) { play("error"); this.notify(m.notAllowed(L === "en" ? STATE_EN[a.state] : a.state, L === "en" ? STATE_EN[to] : to), "error", via === "voice"); return; }
          this.propose({
            title: { es: `Marcar la alerta como ${to}`, en: `Mark the alert as ${STATE_EN[to]}` },
            lines: {
              es: [`Monitor: ${a.monitor}`, `Variable: ${a.variable} · ${a.type} · ${a.severity}`, `Pasa de ${a.state} a ${to}. Queda en el registro con tu nombre.`],
              en: [`Monitor: ${a.monitor}`, `Variable: ${a.variable} · ${a.type} · ${a.severity}`, `Goes from ${STATE_EN[a.state]} to ${STATE_EN[to]}. Logged under your name.`],
            },
            risk: "escritura",
            run: async () => {
              const r = await zon.transition(a.id, to);
              this.lastAlerts = this.lastAlerts.map((x) => (x.id === a.id ? r : x));
              this.deps.answer(zonCard(`Listo: la alerta de ${a.monitor} quedó ${to}.`, `Done: the alert on ${a.monitor} is now ${STATE_EN[to]}.`));
            },
          }, via);
          return;
        }
        case "watch": {
          const here = this.deps.here();
          if (!here || !here.variable) { play("error"); this.notify(m.noHere, "error", via === "voice"); return; }
          const named = rest.match(/(?:llamalo|llamado|nombre|name it|called)\s+(.+)$/)?.[1];
          const name = named ? named.replace(/\b\w/g, (c) => c.toUpperCase()) : `${here.name} · ${here.variable.name}`;
          const id = monitorId(named ?? `${here.entityId}-${here.variable.name}`);
          this.propose({
            title: { es: "Crear un monitor", en: "Create a monitor" },
            lines: {
              es: [`Nombre: ${name}`, `Lugar: ${here.name} (${here.lat.toFixed(2)}, ${here.lon.toFixed(2)})`, `Variable: ${here.variable.long_name ?? here.variable.name} (${here.variable.unit})`, "Revisa cada mes y abre alertas si algo se sale de lo normal."],
              en: [`Name: ${name}`, `Place: ${here.name} (${here.lat.toFixed(2)}, ${here.lon.toFixed(2)})`, `Variable: ${here.variable.long_name ?? here.variable.name} (${here.variable.unit})`, "Checks every month and opens alerts when something is unusual."],
            },
            risk: "escritura",
            run: async () => {
              await zon.createMonitor({
                id,
                entity: { id: here.entityId, type: "region", name: here.name, status: "real", geometry: { type: "Point", coordinates: [here.lon, here.lat] } },
                variable: { name: here.variable!.name, unit: here.variable!.unit, long_name: here.variable!.long_name ?? here.variable!.name },
                period: 12, cadence: "mensual",
              });
              this.deps.answer(zonCard(`Monitor «${name}» creado. Di «mis monitores» para verlo.`, `Monitor «${name}» created. Say «my monitors» to see it.`));
            },
          }, via);
          return;
        }
        case "report": {
          const here = this.deps.here();
          if (!here) { play("error"); this.notify(m.noHere, "error", via === "voice"); return; }
          const first = rest.replace(/^(que|de que|that)\s+/, "");
          this.set({ reportDraft: { text: first ? first[0].toUpperCase() + first.slice(1) : "", here } });
          this.startDictation(null, true);
          return;
        }
        case "swarm": {
          if (viaDb) {
            const r = await listSwarmReports(5);
            const top = r.map((x, i) => `${i + 1}. «${x.description}» · ${x.at.slice(0, 10)}`).join("\n");
            this.deps.answer(zonCard(r.length ? `Últimos reportes de la red (fuente no verificada):\n${top}` : "La red todavía no tiene reportes.",
              r.length ? `Latest swarm reports (unverified):\n${top}` : "The swarm has no reports yet."));
            play("done");
            return;
          }
          const s = (await zon.signals()) as { theme?: string; level?: string; score?: number }[];
          const top = s.slice(0, 5).map((x, i) => `${i + 1}. ${x.theme ?? "?"} · ${x.level ?? "?"}${x.score !== undefined ? ` · ${x.score.toFixed(2)}` : ""}`).join("\n");
          this.deps.answer(zonCard(
            s.length ? `${s.length} señal${s.length === 1 ? "" : "es"} de reportes (fuente no verificada salvo que diga lo contrario):\n${top}` : "No hay señales de reportes.",
            s.length ? `${s.length} report signal${s.length === 1 ? "" : "s"} (unverified source unless stated):\n${top}` : "No report signals."));
          play("done");
          return;
        }
        case "entity": {
          const id = rest ? monitorId(rest) : this.deps.here()?.entityId;
          if (!id) { this.notify(m.noHere, "error", via === "voice"); return; }
          const st = await zon.entityState(id) as { text?: Record<Lang, string>; priority?: string };
          const es = st.text?.es ?? JSON.stringify(st).slice(0, 400);
          const en = st.text?.en ?? es;
          this.deps.answer(zonCard(es, en));
          play("done");
          return;
        }
      }
    } catch (e) {
      play("error");
      const msg = e instanceof ZonError && e.status === 0 ? m.zonDown : m.zonError(e instanceof Error ? e.message : String(e));
      this.notify(msg, "error", via === "voice");
    }
  }

  private proposeReport(text: string, here: Here): void {
    if (!text.trim()) { this.set({ reportDraft: null }); return; }
    this.propose({
      title: { es: "Enviar un reporte", en: "Send a report" },
      lines: {
        es: [`«${text}»`, `Lugar: ${here.name} (${here.lat.toFixed(2)}, ${here.lon.toFixed(2)}; se redondea)`, "Otros lo verán como fuente no verificada."],
        en: [`«${text}»`, `Place: ${here.name} (${here.lat.toFixed(2)}, ${here.lon.toFixed(2)}; rounded)`, "Others will see it as an unverified source."],
      },
      risk: "publicar",
      run: async () => {
        if (zonConfig()) await zon.report({ reporter: { id: reporterId(), type: "persona" }, lat: here.lat, lon: here.lon, time: new Date().toISOString().slice(0, 19) + "Z", text });
        else await sendSwarmReport({ text, lat: here.lat, lon: here.lon, lang: this.lang });
        this.set({ reportDraft: null });
        this.deps.answer(zonCard("Reporte enviado como fuente no verificada.", "Report sent as an unverified source."));
      },
    }, "voice");
  }

  // ---- confirmation (doc §4.3) ----
  private propose(p: Omit<Pending, "expires" | "sending">, via: "voice" | "text"): void {
    const pending: Pending = { ...p, expires: Date.now() + CONFIRM_MS, sending: false };
    this.set({ pending });
    play("confirm");
    const L = this.lang;
    this.speakCard(`${p.title[L]}. ${p.lines[L].join(". ")}. ${L === "es" ? "¿Confirmas?" : "Confirm?"}`, via === "voice" || this.handsFree);
    window.setTimeout(() => {
      if (this.snap.pending === pending && !pending.sending) { this.set({ pending: null }); this.notify(this.m.expired, "info"); }
    }, CONFIRM_MS);
  }

  async confirm(yes: boolean): Promise<void> {
    const p = this.snap.pending;
    if (!p || p.sending) return;
    if (!yes) { this.set({ pending: null, reportDraft: null }); play("done"); this.notify(this.m.cancelled); return; }
    if (Date.now() > p.expires) { this.set({ pending: null }); this.notify(this.m.expired, "error"); return; }
    this.set({ pending: { ...p, sending: true } });
    try {
      await p.run();
      play("done");
      this.set({ pending: null });
    } catch (e) {
      play("error");
      this.set({ pending: null });
      this.notify(e instanceof ZonError && e.status === 0 ? this.m.zonDown : this.m.zonError(e instanceof Error ? e.message : String(e)), "error", true);
    }
  }

  // ---- keys: shortcuts + spatial navigation (doc §2.3) ----
  private onKey(e: KeyboardEvent): void {
    const typing = isTextField(e.target as Element);
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "k") { e.preventDefault(); this.set({ palette: !this.snap.palette, paletteView: "commands" }); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const code = e.code;
      if (code === "KeyV") { e.preventDefault(); this.talk(); return; }
      if (code === "KeyN") { e.preventDefault(); this.set({ numbers: !this.snap.numbers }); return; }
      if (code === "KeyG") { e.preventDefault(); if (this.snap.hand.status === "off" || this.snap.hand.status === "error") void this.startGestures(); else this.stopGestures(); return; }
      if (code === "KeyM") { e.preventDefault(); this.setHandsFree(!this.handsFree); return; }
    }
    if (e.key === "Escape" && (this.snap.pending || this.snap.choose || this.snap.palette || this.snap.numbers)) { e.preventDefault(); e.stopPropagation(); this.back(); return; }
    if (this.snap.pending && !typing && (e.key === "Enter")) { e.preventDefault(); void this.confirm(true); return; }
    // Numbers on: type the digits, Enter (or a short pause) picks.
    if (this.snap.numbers && !typing && /^\d$/.test(e.key)) {
      e.preventDefault();
      this.digitBuf += e.key;
      clearTimeout(this.digitTimer);
      const go = () => { const n = Number(this.digitBuf); this.digitBuf = ""; this.hear(String(n), "text"); };
      this.digitTimer = window.setTimeout(go, 700);
      return;
    }
    // Arrows move the focus between controls (TV-style) only when the focus is on a plain control: never inside
    // text, sliders, selects, radio groups or the map/scene canvas (which use the arrows themselves).
    if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key.startsWith("Arrow")) {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return;
      if (typing || el instanceof HTMLCanvasElement || el instanceof HTMLSelectElement || el instanceof HTMLInputElement) return;
      if (el.closest("[role=slider],[role=radiogroup],[role=tablist],[role=listbox],[role=menu],[role=grid]")) return;
      const dir = e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : "right";
      if (moveFocus(dir)) e.preventDefault();
    }
  }

  // ---- gamepad / TV remote (doc §2.3) ----
  private onPad(e: PadEvent): void {
    switch (e.type) {
      case "dir": {
        const el = document.activeElement;
        // on the map or a scene, the d-pad turns it; elsewhere it moves the focus
        const m = el instanceof HTMLCanvasElement ? manipulableAt(el.getBoundingClientRect().left + 2, el.getBoundingClientRect().top + 2) : null;
        if (m) { m.orbit(e.dir === "left" ? -0.06 : e.dir === "right" ? 0.06 : 0, e.dir === "up" ? -0.06 : e.dir === "down" ? 0.06 : 0); return; }
        if (el instanceof HTMLInputElement && el.type === "range" && (e.dir === "left" || e.dir === "right")) { stepRange(el, e.dir === "right" ? 1 : -1); return; }
        moveFocus(e.dir);
        return;
      }
      case "activate":
        if (this.snap.pending) { void this.confirm(true); return; }
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) { activate(document.activeElement); play("tick"); }
        else moveFocus("down");
        return;
      case "back": this.back(); return;
      case "talk": this.talk(); return;
      case "numbers": this.set({ numbers: !this.snap.numbers }); return;
      case "palette": this.set({ palette: !this.snap.palette, paletteView: "commands" }); return;
      case "orbit": { const m = activeManipulable(); if (m) { stopSpin(); m.orbit(e.dx, e.dy); } return; }
      case "zoom": activeManipulable()?.zoomBy(e.factor); return;
    }
  }

  // ---- hand (doc §2.6) ----
  /** The camera image while gestures are on (for the small mirrored preview), or null. */
  cameraVideo(): HTMLVideoElement | null { return this.tracker?.video ?? null; }

  async startGestures(): Promise<void> {
    if (this.tracker) return;
    const lv = this.snap.level;
    // Any device with a camera may try: without a recognised GPU the model runs on the CPU at a lower rate.
    if (lv.level < 1) { play("error"); this.notify(this.m.gesturesWeak, "error", true); return; }
    this.tracker = new HandTracker(lv.gpuHands);
    this.tracker.onStats = (s) => {
      this.set({ hand: { ...this.snap.hand, status: s.status, perSecond: s.perSecond, inferMs: s.inferMs, error: s.error } });
      if (s.status === "error") { this.notify(this.m.camError, "error", true); this.tracker = null; }
      if (s.status === "on" && s.perSecond > 0 && !this.frameWatch) this.watchFrames();
    };
    this.gestures = new GestureMachine();
    await this.tracker.start((hands, t) => { for (const ev of this.gestures.step(hands, t)) this.onHand(ev); });
    if (this.snap.hand.status === "on") { play("done"); this.notify(this.m.gesturesOn, "info", true); }
  }

  stopGestures(): void {
    cancelAnimationFrame(this.frameWatch);
    this.frameWatch = 0;
    if (!this.tracker) return;
    this.tracker.stop();
    this.tracker = null;
    this.dragView = null;
    this.set({ hand: { ...this.snap.hand, status: "off", visible: false, snap: null } });
    this.notify(this.m.gesturesOff);
  }

  /** While the camera is on, watch the page's own frame time: if it stays above 50 ms, the camera turns off (doc §2.7). */
  private watchFrames(): void {
    const deltas: number[] = [];
    let last = performance.now();
    let slowSince = 0;
    const loop = (t: number) => {
      deltas.push(t - last); last = t;
      if (deltas.length > 60) deltas.shift();
      const med = [...deltas].sort((a, b) => a - b)[deltas.length >> 1];
      if (med > 90 && !document.hidden) { slowSince ||= t; if (t - slowSince > 10000) { this.stopGestures(); this.notify(this.m.gesturesWeak, "error", true); return; } }
      else slowSince = 0;
      this.frameWatch = requestAnimationFrame(loop);
    };
    this.frameWatch = requestAnimationFrame(loop);
  }

  private onHand(ev: HandEvent): void {
    const W = innerWidth, H = innerHeight;
    switch (ev.type) {
      case "pointer": {
        const x = ev.x * W, y = ev.y * H;
        this.lastCursor = { x, y };
        const onView = manipulableAt(x, y);
        const t = onView || this.dragView ? null : magnet(x, y, 40);
        this.set({ hand: { ...this.snap.hand, x, y, visible: true, pinching: ev.pinching, pose: ev.pose, hold: ev.hold, snap: t && ev.pose !== "fist" ? t.box : null } });
        return;
      }
      case "lost": this.set({ hand: { ...this.snap.hand, visible: false, snap: null } }); this.dragView = null; return;
      case "tap": {
        if (this.snap.pending) return; // confirming takes a thumbs up or a word, never a stray pinch
        const x = ev.x * W, y = ev.y * H;
        const sn = this.snap.hand.snap;
        const range = rangeAt(x, y);
        if (range) { range.focus(); setRangeAtX(range, x); }
        else if (sn) tapAt(sn.x + sn.w / 2, sn.y + sn.h / 2); else tapAt(x, y);
        play("tick");
        return;
      }
      case "dragStart": {
        const x = ev.x * W, y = ev.y * H;
        this.dragRange = rangeAt(x, y);
        if (this.dragRange) { this.dragRange.focus(); return; }
        this.dragView = manipulableAt(x, y);
        if (this.dragView) { touch(this.dragView); stopSpin(); }
        return;
      }
      case "drag":
        if (this.dragRange) setRangeAtX(this.dragRange, ev.x * W);
        else if (this.dragView) this.dragView.orbit(ev.dx, ev.dy);
        else scrollBy(-ev.dy * H * 1.5);
        return;
      case "dragEnd": this.dragView = null; this.dragRange = null; return;
      case "zoom": activeManipulable()?.zoomBy(ev.factor); return;
      case "back": play("tick"); this.back(); return;
      case "confirm": if (this.snap.pending) void this.confirm(true); return;
    }
  }

  isSpinning(): boolean { return isSpinning(); }
}

function rangeAt(x: number, y: number): HTMLInputElement | null {
  const el = document.elementFromPoint(x, y);
  return el instanceof HTMLInputElement && el.type === "range" && !el.disabled ? el : null;
}

/** Sets a slider and fires the events React and plain listeners expect. */
function setRange(el: HTMLInputElement, v: number): void {
  const min = Number(el.min || 0), max = Number(el.max || 100), step = Number(el.step) || 1;
  const val = Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, String(Number(val.toFixed(6))));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function stepRange(el: HTMLInputElement, steps: number): void {
  const min = Number(el.min || 0), max = Number(el.max || 100);
  const step = Number(el.step) || 1;
  // a «step» by voice or pad is 5 % of the range (at least one native step), so it is visible
  const d = Math.max(step, Math.round(((max - min) * 0.05) / step) * step);
  setRange(el, Number(el.value) + steps * d);
}

function setRangeAtX(el: HTMLInputElement, x: number): void {
  const r = el.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (x - r.left) / r.width));
  const min = Number(el.min || 0), max = Number(el.max || 100);
  setRange(el, min + f * (max - min));
}

/** Sets a React-controlled field: the native setter + an input event, so React's onChange sees it. */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.setSelectionRange?.(value.length, value.length);
}
