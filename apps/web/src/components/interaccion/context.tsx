"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { Hub, HubSnapshot } from "@/core/interaction/hub";

const HubContext = createContext<Hub | null>(null);

export const HubProvider = HubContext.Provider;

export function useHub(): Hub {
  const hub = useContext(HubContext);
  if (!hub) throw new Error("useHub fuera de HubProvider");
  return hub;
}

export function useHubState(): HubSnapshot {
  const hub = useHub();
  return useSyncExternalStore(hub.subscribe, hub.get, hub.get);
}
