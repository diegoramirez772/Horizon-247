// HORIZON 247 service worker (Plan de unión U7). Hand-written, no library.
// - The app shell and Next's hashed files: cache first (they never change under the same name).
// - Pages: network first, the cached shell when offline.
// - HORI bundles: cached the first time they are read, then served from the cache and refreshed in the background.
// - NASA live APIs (POWER, EONET): network first, the last answer when offline (the screen shows its date).
// - GIBS tiles are cached by the map itself (imagery.ts, cache "h247-tiles-v1"): not touched here.
const SHELL = "h247-shell-v1";
const DATA = "h247-data-v1";
const LIVE = "h247-live-v1";
const PRECACHE = ["./", "./escena/", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  const keep = new Set([SHELL, DATA, LIVE, "h247-tiles-v1"]);
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("h247-") && !keep.has(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(name)).put(req, res.clone());
  return res;
}

async function networkFirst(req, name, fallback) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(name)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req)) || (fallback ? caches.match(fallback) : Response.error());
  }
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") { e.respondWith(networkFirst(req, SHELL, "./")); return; }
    if (url.pathname.includes("/_next/static/") || url.pathname.includes("/icons/")) { e.respondWith(cacheFirst(req, SHELL)); return; }
    if (url.pathname.includes("/bundles/")) { e.respondWith(staleWhileRevalidate(req, DATA)); return; }
    return;
  }
  if (url.hostname === "power.larc.nasa.gov" || url.hostname === "eonet.gsfc.nasa.gov") {
    e.respondWith(networkFirst(req, LIVE));
  }
});
