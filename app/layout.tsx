import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saddle — Mounted to success",
  description:
    "A chat agent whose answers are interactive visuals rendered from ClickHouse, powered by Trigger.dev.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0c12] text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
