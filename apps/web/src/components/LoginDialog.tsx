"use client";

// Sign in / create account (Supabase Auth). Opens from the sidebar or when an action needs a person (sending a
// report to the swarm). Once in, the session stays in this browser until «Salir».

import { useEffect, useRef, useState } from "react";
import { AuthError, signIn, signUp } from "@/core/live/auth";
import type { Lang } from "@/core/i18n/texts";
import { Logo } from "./ui";

const T = {
  es: {
    in: "Entrar", up: "Crear cuenta", email: "Correo", password: "Contraseña", name: "Tu nombre", close: "Cerrar",
    titleIn: "Bienvenido de vuelta", titleUp: "Únete a la red", subIn: "Entra para enviar reportes a la red enjambre y seguir tus lugares.",
    subUp: "Tu cuenta sirve para aportar reportes. Ver los datos no la necesita.", go: "Entrar", create: "Crear cuenta", wait: "Un momento…",
    hint: "Mínimo 8 caracteres", show: "Mostrar", hide: "Ocultar", stay: "Te quedas dentro en este navegador hasta que salgas.",
    sent: "Te mandamos un correo para confirmar tu cuenta. Ábrelo y luego entra aquí.",
    err: {
      credentials: "Correo o contraseña incorrectos.", unconfirmed: "Falta confirmar tu correo: revisa tu bandeja.",
      exists: "Ese correo ya tiene cuenta. Entra con él.", weak: "La contraseña es muy corta o muy simple.",
      rate: "Se enviaron demasiados correos de confirmación en la última hora. Intenta en un rato.", email: "Ese correo no parece válido.",
      other: "No se pudo. Intenta de nuevo.", login: "Entra de nuevo.",
    } as Record<string, string>,
  },
  en: {
    in: "Sign in", up: "Create account", email: "Email", password: "Password", name: "Your name", close: "Close",
    titleIn: "Welcome back", titleUp: "Join the network", subIn: "Sign in to send reports to the swarm and follow your places.",
    subUp: "Your account is for contributing reports. Viewing the data does not need one.", go: "Sign in", create: "Create account", wait: "One moment…",
    hint: "At least 8 characters", show: "Show", hide: "Hide", stay: "You stay signed in on this browser until you sign out.",
    sent: "We sent you an email to confirm your account. Open it, then sign in here.",
    err: {
      credentials: "Wrong email or password.", unconfirmed: "Your email is not confirmed yet: check your inbox.",
      exists: "That email already has an account. Sign in with it.", weak: "The password is too short or too simple.",
      rate: "Too many confirmation emails in the last hour. Try again later.", email: "That email does not look valid.",
      other: "It did not work. Try again.", login: "Sign in again.",
    } as Record<string, string>,
  },
};

export function LoginDialog({ lang, open, onClose }: { lang: Lang; open: boolean; onClose: () => void }) {
  const t = T[lang];
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    const id = window.setTimeout(() => first.current?.focus(), 60);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", esc);
    return () => { clearTimeout(id); removeEventListener("keydown", esc); };
  }, [open, mode, onClose]);
  if (!open) return null;

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      if (mode === "in") { await signIn(email, password); onClose(); }
      else {
        const r = await signUp(email, password, name);
        if (r === "in") onClose();
        else { setMsg({ kind: "ok", text: t.sent }); setMode("in"); }
      }
    } catch (e) {
      setMsg({ kind: "error", text: t.err[e instanceof AuthError ? e.message : "other"] ?? t.err.other });
    } finally { setBusy(false); }
  };

  const field = "h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-[15px] outline-none transition-[border-color,box-shadow] placeholder:text-text-3 focus:border-text-3 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_14%,transparent)]";
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="login-title" onClick={(e) => e.stopPropagation()}
        className="widget-in relative w-full max-w-[420px] overflow-hidden rounded-t-3xl border border-border bg-surface shadow-[0_30px_80px_rgba(16,24,40,0.35)] sm:rounded-3xl">
        {/* a quiet horizon on top: the planet's limb */}
        <div aria-hidden="true" className="relative h-28 overflow-hidden bg-gradient-to-b from-surface-2 to-surface">
          <div className="absolute -bottom-40 left-1/2 h-56 w-[140%] -translate-x-1/2 rounded-[50%] bg-gradient-to-b from-[#1d4ed8]/25 via-[#0ea5e9]/10 to-transparent blur-[1px]" />
          <div className="absolute -bottom-44 left-1/2 h-56 w-[130%] -translate-x-1/2 rounded-[50%] border-t border-[#60a5fa]/50" />
          <div className="absolute left-5 top-5"><Logo /></div>
          <button type="button" onClick={onClose} aria-label={t.close}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-text-2 hover:bg-surface hover:text-text">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>

        <div className="px-6 pb-6 pt-1">
          <h2 id="login-title" className="text-2xl font-semibold tracking-tight">{mode === "in" ? t.titleIn : t.titleUp}</h2>
          <p className="mt-1 text-sm text-text-2">{mode === "in" ? t.subIn : t.subUp}</p>

          <div role="tablist" className="mt-5 grid grid-cols-2 rounded-full bg-surface-2 p-1 shadow-[inset_0_0_0_1px_var(--border)]">
            {(["in", "up"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => { setMode(m); setMsg(null); }}
                className={`h-9 rounded-full text-sm font-semibold transition-all ${mode === m ? "bg-surface text-text shadow-[0_1px_3px_rgba(16,24,40,0.12),0_0_0_1px_var(--border)]" : "text-text-2 hover:text-text"}`}>
                {m === "in" ? t.in : t.up}
              </button>
            ))}
          </div>

          <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            {mode === "up" ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-2">{t.name}</span>
                <input ref={first} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} className={field} />
              </label>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-2">{t.email}</span>
              <input ref={mode === "in" ? first : undefined} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" className={field} />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-text-2">
                {t.password}{mode === "up" ? <span className="font-normal text-text-3">{t.hint}</span> : null}
              </span>
              <span className="relative block">
                <input type={show ? "text" : "password"} required minLength={mode === "up" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "in" ? "current-password" : "new-password"} className={`${field} pr-20`} />
                <button type="button" onClick={() => setShow((x) => !x)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-text-2 hover:bg-surface-2 hover:text-text">
                  {show ? t.hide : t.show}
                </button>
              </span>
            </label>

            {msg ? (
              <p role={msg.kind === "error" ? "alert" : "status"}
                className={`rounded-xl px-3 py-2 text-sm ${msg.kind === "error" ? "bg-[#e5484d]/10 text-text" : "bg-[#16a34a]/10 text-text"}`}>{msg.text}</p>
            ) : null}

            <button type="submit" disabled={busy}
              className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-on-accent transition-opacity disabled:opacity-60">
              {busy ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-on-accent border-t-transparent" /> : null}
              {busy ? t.wait : mode === "in" ? t.go : t.create}
            </button>
            <p className="text-center text-xs text-text-3">{t.stay}</p>
          </form>
        </div>
      </div>
    </div>
  );
}
