"use client";

// The interaction layer for any page that is not the main one (e.g. /escena): its own hub, keys, gamepad, voice,
// hand and overlays. The page adds its vocabulary with hub.registerDomain(). Without an assistant on the page,
// anything not understood answers «di números o comandos».

import { useEffect, useState } from "react";
import { Hub } from "@/core/interaction/hub";
import type { Lang } from "@/core/i18n/texts";
import { HubProvider } from "./context";
import { InteractionLayer } from "./InteractionLayer";

export function InteractionRoot({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const [hub] = useState(() => {
    const h: Hub = new Hub({
      lang: () => lang,
      ask: () => h.notify(lang === "es" ? "No te entendí. Di «números» o «comandos»." : "I did not get that. Say «numbers» or «commands».", "info", true),
      answer: (card) => h.notify(card.text[lang].sencillo, "info", true),
      here: () => null,
      openMap: () => {},
    });
    return h;
  });
  useEffect(() => hub.install(), [hub]);
  return (
    <HubProvider value={hub}>
      {children}
      <InteractionLayer lang={lang} />
    </HubProvider>
  );
}
