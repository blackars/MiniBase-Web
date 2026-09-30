import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "MiniBase Web", description: "Inventario real para IA agentica",
  icons: { icon: [
    { url: "/favicon.ico", media: "(prefers-color-scheme: light)" },
    { url: "/favicon-white.ico", media: "(prefers-color-scheme: dark)" },
  ] } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="es" className="dark"><body className="bg-zinc-950 text-zinc-100 min-h-screen">{children}</body></html>);
}
