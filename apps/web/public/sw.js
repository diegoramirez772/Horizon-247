// HORIZON 247 service worker (Plan de unión U7). Hand-written, no library.
// - The app shell and Next's hashed files: cache first (they never change under the same name).
// - Pages: network first, the cached shell when offline.
// - HORI bundles: cached the first time they are read, then served from the cache and refreshed in the background.
// - Live APIs (POWER, EONET, iNaturalist, CelesTrak) and the GOES sky pictures: network first with a 4 s limit; when the
//   network is late or missing, the last answer (the screen shows its time). Photos and thumbnails: cached, refreshed behind.
// - The app's own «último dato bueno» (src/core/live/lastgood.ts, cache "h247-last-v1") is kept too.
// - GIBS tiles are cached by the map itself (imagery.ts, cache "h247-tiles-v1"): not touched here.
const SHELL = "h247-shell-v1";
const DATA = "h247-data-v1";
const LIVE = "h247-live-v1";
const PRECACHE = ["./", "./escena/", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  const keep = new Set([SHELL, DATA, LIVE, "h247-tiles-v1", "h247-last-v1"]);
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("h247-") && !keep.has(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(name)).put(req, res.clone());
  return res;
}

// Pictures loaded by <img> come back opaque (no CORS): they can still be kept and shown.
const keepable = (res) => res.ok || res.type === "opaque";

async function networkFirst(req, name, fallback, opts = {}) {
  const fresh = fetch(req).then(async (res) => { if (keepable(res)) await (await caches.open(name)).put(req, res.clone()); return res; });
  const saved = () => caches.match(req, { ignoreSearch: !!opts.ignoreSearch });
  if (opts.timeoutMs) {
    const late = new Promise((ok) => setTimeout(() => ok("late"), opts.timeoutMs));
    const first = await Promise.race([fresh.catch(() => "error"), late]);
    if (first !== "late" && first !== "error") return first;
    const hit = await saved();
    if (hit) return hit;
  }
  try { return await fresh; } catch { return (await saved()) || (fallback ? caches.match(fallback) : Response.error()); }
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (keepable(res)) cache.put(req, res.clone()); return res; }).catch(() => hit);
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
  const host = url.hostname;
  if (host === "power.larc.nasa.gov" || host === "eonet.gsfc.nasa.gov" || host === "api.inaturalist.org" || host === "celestrak.org") {
    e.respondWith(networkFirst(req, LIVE, null, { timeoutMs: 4000 }));
  } else if (host === "cdn.star.nesdis.noaa.gov") {
    // «latest» carries ?t= so it refreshes every 10 min; offline, any saved copy of the same picture will do
    e.respondWith(networkFirst(req, LIVE, null, { timeoutMs: 4000, ignoreSearch: true }));
  } else if (host === "i.ytimg.com" || host === "static.inaturalist.org" || host === "inaturalist-open-data.s3.amazonaws.com") {
    e.respondWith(staleWhileRevalidate(req, LIVE));
  }
});
