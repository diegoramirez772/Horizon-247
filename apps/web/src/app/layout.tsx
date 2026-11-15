import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { InlineScript } from "@/components/InlineScript";

export const metadata: Metadata = {
  title: "HORIZON 247",
  description: "Pregúntale a HORIZON: qué cambia en la Tierra, dónde, cuánto y si ya se puede saber. Con datos de la NASA.",
  // PWA (Plan de unión U7): installable, works offline with the bundles already seen.
  manifest: "manifest.webmanifest",
  icons: { icon: [{ url: "icons/icon.svg", type: "image/svg+xml" }, { url: "icons/icon-192.png", sizes: "192x192" }], apple: "icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "HORIZON 247", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#FFFFFF" }, { media: "(prefers-color-scheme: dark)", color: "#0A0A0A" }],
};

// The service worker is registered after the page loads, only on https or localhost (where browsers allow it).
// In development it is never used (dev chunks keep their names, so a cache would serve stale code): any old one is removed.
const SW = process.env.NODE_ENV === "production"
  ? `if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost")){addEventListener("load",function(){navigator.serviceWorker.register("sw.js").catch(function(){})})}`
  : `if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})});if(self.caches)caches.keys().then(function(k){k.forEach(function(n){if(n.indexOf("h247-")===0)caches.delete(n)})})}`;

// Runs before the first paint (Next 16 guide «Preventing flash before hydration»):
// applies the saved theme and the language from the URL so nothing flickers.
const BOOT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("h247-theme");if(t==="dark")d.setAttribute("data-theme","dark");var l=new URLSearchParams(location.search).get("lang");if(l==="en"||l==="es")d.lang=l;else if(!l&&(navigator.language||"").toLowerCase().indexOf("en")===0)d.lang="en";}catch(e){}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${GeistSans.variable} h-full`} suppressHydrationWarning>
      <head>
        <InlineScript html={BOOT} />
        <InlineScript html={SW} />
      </head>
      <body className="min-h-full bg-bg text-text">{children}</body>
    </html>
  );
}
