"use client";

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ErrorPage from "./error";
import { PLATFORM } from "@/lib/institution";

// Same fonts as the root layout, which this replaces: globals.css builds its font
// stack on these variables, so without them the page falls back to a serif.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/**
 * Catches errors in the root layout itself — the header runs per-request
 * queries there — which app/error.tsx sits below and can't catch. It replaces
 * the whole document, so it brings its own <html> and <body>; the message and
 * Try again button are app/error.tsx's.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body>
        <title>{`Something went wrong · ${PLATFORM.name}`}</title>
        <main>
          <ErrorPage error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
