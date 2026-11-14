import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HORIZON 247",
  description: "Universal Monitoring & Entity Intelligence — Identify. Observe. Detect.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
