// Voice in and out for the whole app (doc «Interacción v2» §2.4–2.5). Replaces the single-turn useSpeech:
//  · one turn (push to talk) or a hands-free session that restarts itself after silences;
//  · barge-in: speaking while the assistant talks silences it at once;
//  · says WHERE the audio goes (H20): on this device when the browser can recognise locally, else the browser's service;
//  · long answers are spoken sentence by sentence (some browsers cut long utterances), and the best voice is chosen.
// Nothing listens until asked; the microphone is released when the turn or the session ends.

import type { Lang } from "@/core/i18n/texts";

interface Alt { transcript: string; confidence?: number }
interface ResultEvent { resultIndex: number; results: ArrayLike<ArrayLike<Alt> & { isFinal: boolean }> }
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; processLocally?: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
}
type RecognitionCtor = (new () => Recognition) & { available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string> };

export type Destination = "local" | "browser" | "none";
export interface VoiceSnapshot {
  supported: boolean;
  listening: boolean;
  session: boolean;
  interim: string;
  speaking: boolean;
  destination: Destination;
  error: string | null;
}

const LOCALE: Record<Lang, string> = { es: "es-MX", en: "en-US" };

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Splits an answer into sentences no longer than ~180 characters. */
export function sentences(text: string): string[] {
  const parts = text.replace(/\s+/g, " ").match(/[^.!?;]+[.!?;]*/g) ?? [text];
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (p.length <= 180) { out.push(p); continue; }
    let cur = "";
    for (const w of p.split(/(?<=,)\s+|\s+/)) {
      if ((cur + " " + w).length > 180 && cur) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Symbols read aloud in words. */
function speakable(text: string, lang: Lang): string {
  const es = lang === "es";
  return text
    .replace(/·/g, ",")
    .replace(/≥/g, es ? " mayor o igual a " : " at least ")
    .replace(/≤/g, es ? " menor o igual a " : " at most ")
    .replace(/±/g, es ? " más o menos " : " plus or minus ")
    .replace(/°C/g, es ? " grados" : " degrees")
    .replace(/σ/g, es ? " sigma" : " sigma")
    .replace(/δ/g, es ? " delta" : " delta")
    .replace(/\/déc(ada)?/g, es ? " por década" : " per decade")
    .replace(/\/dec(ade)?/g, " per decade")
    .replace(/\[([^\]]+)\]/g, (_, x: string) => (es ? ` entre ${x.replace(",", " y ")}` : ` between ${x.replace(",", " and ")}`));
}

function bestVoice(lang: Lang): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  if (!mine.length) return null;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const score = (v: SpeechSynthesisVoice) =>
    (offline && v.localService ? 100 : 0) +
    (/natural|neural|enhanced|premium|online/i.test(v.name) && !offline ? 20 : 0) +
    (v.lang.toLowerCase() === LOCALE[lang].toLowerCase() ? 5 : 0) +
    (v.localService ? 2 : 0);
  return mine.sort((a, b) => score(b) - score(a))[0];
}

export class Voice {
  private snap: VoiceSnapshot = { supported: false, listening: false, session: false, interim: "", speaking: false, destination: "none", error: null };
  private listeners = new Set<() => void>();
  private rec: Recognition | null = null;
  private onFinal: ((text: string) => void) | null = null;
  private restarts = 0;
  private localOk: Record<string, boolean> = {};
  private queue: string[] = [];
  private speakToken = 0;
  lang: Lang = "es";
  /** Called when the user starts talking while the assistant speaks (barge-in). */
  onBargeIn: () => void = () => {};
  onSpeakStart: (text: string) => void = () => {};
  onSpeakEnd: () => void = () => {};

  constructor() {
    const C = ctor();
    this.snap = { ...this.snap, supported: !!C };
  }

  get = (): VoiceSnapshot => this.snap;
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<VoiceSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l();
  }

  /** Can this browser recognise `lang` on the device? Asked once per language; never downloads a pack by itself. */
  private async checkLocal(lang: Lang): Promise<boolean> {
    if (lang in this.localOk) return this.localOk[lang];
    const C = ctor();
    let ok = false;
    try { ok = (await C?.available?.({ langs: [LOCALE[lang]], processLocally: true })) === "available"; } catch { ok = false; }
    this.localOk[lang] = ok;
    return ok;
  }

  /**
   * Starts listening. `session` = hands-free: keeps listening across silences until stop().
   * `onFinal` receives each final utterance.
   */
  async listen(onFinal: (text: string) => void, session = false): Promise<void> {
    const C = ctor();
    if (!C) { this.set({ error: "no-support" }); return; }
    this.abortRec();
    this.onFinal = onFinal;
    this.restarts = 0;
    const local = await this.checkLocal(this.lang);
    this.set({ session, error: null, destination: local ? "local" : "browser" });
    this.startRec(C, local);
  }

  private startRec(C: RecognitionCtor, local: boolean): void {
    const r = new C();
    r.lang = LOCALE[this.lang];
    r.interimResults = true;
    r.continuous = this.snap.session;
    r.maxAlternatives = 1;
    if (local) r.processLocally = true;
    r.onspeechstart = () => { if (this.snap.speaking) { this.hush(); this.onBargeIn(); } };
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript;
        if (res.isFinal) {
          const t = text.trim();
          if (t) { this.set({ interim: "" }); this.onFinal?.(t); }
        } else interim += text;
      }
      if (interim && this.snap.speaking) { this.hush(); this.onBargeIn(); }
      this.set({ interim });
    };
    r.onerror = (e) => {
      // «no-speech» and «aborted» are normal in a session; the rest are shown.
      if (e.error !== "no-speech" && e.error !== "aborted") this.set({ error: e.error, session: e.error === "network" ? this.snap.session : false });
    };
    r.onend = () => {
      if (this.rec !== r) return;
      if (this.snap.session && this.restarts < 50 && !this.snap.error) {
        this.restarts++;
        setTimeout(() => { if (this.rec === r && this.snap.session) this.startRec(C, local); }, 250);
        return;
      }
      this.rec = null;
      this.set({ listening: false, session: false, interim: "" });
    };
    this.rec = r;
    this.set({ listening: true });
    try { r.start(); } catch { this.rec = null; this.set({ listening: false, session: false }); }
  }

  private abortRec(): void {
    const r = this.rec;
    this.rec = null;
    if (r) { r.onend = null; try { r.abort(); } catch { /* already stopped */ } }
  }

  /** Ends the turn (the last words are still delivered). */
  stop(): void {
    this.set({ session: false });
    try { this.rec?.stop(); } catch { /* already stopped */ }
  }

  /** Releases the microphone now. */
  release(): void {
    this.abortRec();
    this.set({ listening: false, session: false, interim: "" });
  }

  speak(text: string): void {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || !text.trim()) return;
    synth.cancel();
    const token = ++this.speakToken;
    this.queue = sentences(speakable(text, this.lang));
    const voice = bestVoice(this.lang);
    this.onSpeakStart(text);
    const next = () => {
      if (token !== this.speakToken) return;
      const s = this.queue.shift();
      if (!s) { this.set({ speaking: false }); this.onSpeakEnd(); return; }
      const u = new SpeechSynthesisUtterance(s);
      u.lang = LOCALE[this.lang];
      if (voice) u.voice = voice;
      u.rate = 1.02;
      u.onend = next;
      u.onerror = () => { if (token === this.speakToken) { this.set({ speaking: false }); this.onSpeakEnd(); } };
      synth.speak(u);
    };
    this.set({ speaking: true });
    next();
  }

  hush(): void {
    this.speakToken++;
    this.queue = [];
    window.speechSynthesis?.cancel();
    if (this.snap.speaking) { this.set({ speaking: false }); this.onSpeakEnd(); }
  }

  destroy(): void {
    this.release();
    this.hush();
  }
}
