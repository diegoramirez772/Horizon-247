// Accounts (Supabase Auth, email + password) for what needs a person behind it: sending reports to the swarm.
// The rest of HORIZON stays open without an account. The session is kept in this browser (localStorage + a cookie
// with the same lifetime) and refreshed on its own, so once you are in you stay in until you press «Salir».

const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const STORE = "h247-auth";
const COOKIE = "h247_auth";

export interface User { id: string; email: string; name: string }
export interface Session { access_token: string; refresh_token: string; expires_at: number; user: User }

export const authConfigured = (): boolean => !!URL_ && !!KEY;

let current: Session | null | undefined; // undefined = not read yet
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) f(); };

export function subscribe(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }

function read(): Session | null {
  if (current !== undefined) return current;
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Session | null;
    current = s?.refresh_token ? s : null;
  } catch { current = null; }
  return current;
}

function save(s: Session | null): void {
  current = s;
  try {
    if (s) {
      localStorage.setItem(STORE, JSON.stringify(s));
      document.cookie = `${COOKIE}=1; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } else {
      localStorage.removeItem(STORE);
      document.cookie = `${COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  } catch { /* private mode: the session lasts this page */ }
  emit();
}

/** Who is signed in (null on the server and when nobody is). */
export function currentUser(): User | null { return typeof window === "undefined" ? null : read()?.user ?? null; }

type Raw = { access_token?: string; refresh_token?: string; expires_in?: number; user?: { id: string; email?: string; user_metadata?: { name?: string } } };

function toSession(j: Raw): Session | null {
  if (!j.access_token || !j.refresh_token || !j.user) return null;
  const email = j.user.email ?? "";
  return {
    access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000,
    user: { id: j.user.id, email, name: (j.user.user_metadata?.name || email.split("@")[0] || "").slice(0, 60) },
  };
}

export class AuthError extends Error {}

/** Supabase's message → a short reason the screen can translate. */
function reason(status: number, body: { error_code?: string; msg?: string; error_description?: string; message?: string }): string {
  const code = body.error_code ?? "";
  const text = `${body.msg ?? ""} ${body.error_description ?? ""} ${body.message ?? ""}`.toLowerCase();
  if (code === "invalid_credentials" || text.includes("invalid login")) return "credentials";
  if (code === "email_not_confirmed" || text.includes("not confirmed")) return "unconfirmed";
  if (code === "user_already_exists" || text.includes("already registered")) return "exists";
  if (code === "weak_password" || text.includes("password should")) return "weak";
  if (code === "over_email_send_rate_limit" || status === 429) return "rate";
  if (code === "email_address_invalid" || text.includes("invalid format")) return "email";
  return "other";
}

async function call(path: string, body: unknown, token?: string): Promise<Raw> {
  const r = await fetch(`${URL_}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AuthError(reason(r.status, j));
  return j as Raw;
}

export async function signIn(email: string, password: string): Promise<User> {
  const s = toSession(await call("token?grant_type=password", { email: email.trim().toLowerCase(), password }));
  if (!s) throw new AuthError("other");
  save(s);
  return s.user;
}

/** Creates the account. Returns "in" when the project signs in right away, "confirm" when it sent a confirmation email. */
export async function signUp(email: string, password: string, name: string): Promise<"in" | "confirm"> {
  const j = await call("signup", { email: email.trim().toLowerCase(), password, data: { name: name.trim().slice(0, 60) } });
  const s = toSession(j);
  if (s) { save(s); return "in"; }
  return "confirm";
}

export async function signOut(): Promise<void> {
  const s = read();
  save(null);
  if (s) { try { await call("logout", {}, s.access_token); } catch { /* the local session is gone anyway */ } }
}

/** A valid access token, refreshing it when it expired. Throws «login» when nobody is signed in. */
export async function accessToken(): Promise<string> {
  const s = read();
  if (!s) throw new AuthError("login");
  if (s.expires_at > Date.now()) return s.access_token;
  try {
    const n = toSession(await call("token?grant_type=refresh_token", { refresh_token: s.refresh_token }));
    if (!n) throw new AuthError("login");
    save(n);
    return n.access_token;
  } catch {
    save(null);
    throw new AuthError("login");
  }
}

/** Ask the app to open the sign-in dialog (from any component). */
export function askLogin(): void { try { window.dispatchEvent(new Event("h247:login")); } catch { /* server */ } }

/**
 * The confirmation email brings you back with «#access_token=…&refresh_token=…»: take that session so the link
 * itself signs you in, and clean the address. Returns true when it did.
 */
export async function consumeRedirect(): Promise<boolean> {
  if (typeof window === "undefined" || !location.hash.includes("access_token=")) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  const access = h.get("access_token"), refresh = h.get("refresh_token");
  history.replaceState(null, "", location.pathname + location.search);
  if (!access || !refresh) return false;
  try {
    const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${access}` } });
    if (!r.ok) return false;
    const user = await r.json();
    const s = toSession({ access_token: access, refresh_token: refresh, expires_in: Number(h.get("expires_in")) || 3600, user });
    if (s) save(s);
    return !!s;
  } catch { return false; }
}
