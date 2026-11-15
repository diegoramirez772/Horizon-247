import type { Metadata } from "next";
import { SceneLab } from "@/components/SceneLab";

export const metadata: Metadata = {
  title: "HORIZON 247 · Escena",
  description: "Generador de escenas: los datos de la NASA convertidos en un paisaje 3D que dice qué dato produjo cada cosa.",
};

export default function EscenaPage() {
  return <SceneLab />;
}
