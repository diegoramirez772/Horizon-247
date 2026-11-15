"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@/core/i18n/texts";

// Minimal typing of the Web Speech API (not in TypeScript's DOM lib).
interface RecognitionResultEvent { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LOCALE: Record<Lang, string> = { es: "es-MX", en: "en-US" };

/**
 * Voice in (SpeechRecognition) and voice out (speechSynthesis), both from the browser — no service of ours.
 * The microphone permission is asked only when the mic is pressed (doc 02 F3). If voice is not available,
 * the assistant stays in text, without an alarming message (doc 01 §7).
 */
export function useSpeech(lang: Lang) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capability, only knowable on the client
    setSupported(ctor() !== null);
    return () => { rec.current?.abort(); window.speechSynthesis?.cancel(); };
  }, []);

  const listen = useCallback((onFinal: (text: string) => void) => {
    const C = ctor();
    if (!C) return;
    window.speechSynthesis?.cancel();
    rec.current?.abort();
    const r = new C();
    r.lang = LOCALE[lang];
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let done = false;
    r.onresult = (e) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) final = true;
      }
      setInterim(text);
      if (final && !done) { done = true; setInterim(""); onFinal(text.trim()); }
    };
    r.onerror = (e) => { setFailed(e.error); setListening(false); };
    r.onend = () => { setListening(false); setInterim(""); };
    rec.current = r;
    setFailed(null);
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }, [lang]);

  const stop = useCallback(() => { rec.current?.stop(); }, []);

  const speak = useCallback((text: string) => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/·/g, ",").replace(/≥/g, lang === "es" ? "mayor o igual a" : "at least"));
    u.lang = LOCALE[lang];
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
    if (voice) u.voice = voice;
    u.rate = 1;
    synth.speak(u);
  }, [lang]);

  const hush = useCallback(() => { window.speechSynthesis?.cancel(); }, []);

  return { supported, listening, interim, failed, listen, stop, speak, hush };
}
