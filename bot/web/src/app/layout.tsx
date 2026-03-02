import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/providers/StarknetProvider";

export const metadata: Metadata = {
  title: "Loot Survivor Bot — Death Mountain",
  description: "Automated bot that plays Loot Survivor on your behalf",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="noise">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
