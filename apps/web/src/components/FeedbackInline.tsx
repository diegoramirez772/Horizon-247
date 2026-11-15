"use client";

// «¿Algo no cuadra?» under the latest answer (propuesta 3 de William): an anonymous note to the team database.
// Nothing personal is asked; the view's URL goes along so the team can open the same screen.

import { useState } from "react";
import { dbConfigured, sendFeedback } from "@/core/live/db";
import type { Lang } from "@/core/i18n/texts";

type Phase = "closed" | "open" | "sending" | "sent" | "failed";

export function FeedbackInline({ lang, layerId }: { lang: Lang; layerId: string | null }) {
  const es = lang === "es";
  const [phase, setPhase] = useState<Phase>("closed");
  const [kind, setKind] = useState<"error" | "comentario">("error");
  const [text, setText] = useState("");
  if (!dbConfigured()) return null;

  if (phase === "closed") {
    return (
      <button type="button" onClick={() => setPhase("open")}
        className="inline-flex min-h-8 items-center rounded-full px-2.5 text-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text">
        {es ? "¿Algo no cuadra?" : "Something off?"}
      </button>
    );
  }
  if (phase === "sent") {
    return <p role="status" className="px-2.5 text-sm text-text-2">{es ? "Gracias, le llegó al equipo." : "Thanks, the team got it."}</p>;
  }
  const send = async () => {
    setPhase("sending");
    try { await sendFeedback({ kind, message: text, layerId, lang }); setPhase("sent"); setText(""); }
    catch { setPhase("failed"); }
  };
  return (
    <form className="mt-2 w-full rounded-2xl border border-border bg-surface p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <div className="flex gap-1.5" role="radiogroup" aria-label={es ? "Tipo" : "Kind"}>
        {(["error", "comentario"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${kind === k ? "bg-accent text-on-accent" : "border border-border text-text-2"}`}>
            {k === "error" ? (es ? "Un error" : "An error") : (es ? "Un comentario" : "A comment")}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} required
        aria-label={es ? "Qué viste" : "What you saw"}
        placeholder={es ? "Qué viste y qué esperabas. No escribas datos personales." : "What you saw and what you expected. No personal data."}
        className="mt-2 w-full resize-y rounded-xl border border-border-control bg-bg px-3 py-2 text-sm" />
      <div className="mt-2 flex items-center gap-2">
        <button type="submit" disabled={phase === "sending" || !text.trim()}
          className="rounded-xl bg-accent px-3.5 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50">
          {phase === "sending" ? (es ? "Enviando…" : "Sending…") : (es ? "Enviar" : "Send")}
        </button>
        <button type="button" onClick={() => setPhase("closed")} className="text-sm text-text-2 underline underline-offset-2">
          {es ? "Cancelar" : "Cancel"}
        </button>
        {phase === "failed" ? <span role="alert" className="text-sm text-text-2">{es ? "No se pudo enviar. Intenta de nuevo." : "Could not send. Try again."}</span> : null}
      </div>
    </form>
  );
}
