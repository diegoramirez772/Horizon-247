"use client";

// The honest side of «último dato bueno» (core/live/lastgood.ts): when the network is missing or slow and something on
// screen comes from what this browser saved, a small pill says so and from what time. It goes away when fresh data lands.

import { useEffect, useState } from "react";
import type { Lang } from "@/core/i18n/texts";
import { subscribeStale } from "@/core/live/lastgood";

export function OfflineBanner({ lang }: { lang: Lang }) {
  const es = lang === "es";
  const [stale, setStale] = useState<Map<string, number>>(new Map());
  const [online, setOnline] = useState(true);
  const [hidden, setHidden] = useState(false);
  useEffect(() => subscribeStale((s) => { setStale(s); if (s.size) setHidden(false); }), []);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    on();
    addEventListener("online", on); addEventListener("offline", on);
    return () => { removeEventListener("online", on); removeEventListener("offline", on); };
  }, []);
  if (hidden || (online && !stale.size)) return null;
  const hhmm = (t: number) => new Date(t).toLocaleTimeString(es ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" });
  const items = [...stale.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([k, t]) => `${k} ${hhmm(t)}`).join(" · ");
  return (
    <div role="status" className="fade pointer-events-auto fixed left-1/2 top-3 z-[60] md:left-[calc(50%+120px)] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs shadow-md">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-[#f5a524]" : "bg-[#9aa3ad]"}`} />
      <span className="min-w-0 truncate">
        <span className="font-semibold">{online ? (es ? "Red lenta o sin internet" : "Slow or no internet") : (es ? "Sin conexión" : "Offline")}</span>
        {items ? <span className="text-text-2"> · {es ? "muestro lo último guardado:" : "showing the last saved:"} {items}</span> : <span className="text-text-2"> · {es ? "lo guardado sigue disponible" : "saved data still available"}</span>}
      </span>
      <button type="button" onClick={() => setHidden(true)} aria-label={es ? "Ocultar" : "Hide"} className="shrink-0 px-1 text-text-3 hover:text-text">×</button>
    </div>
  );
}
