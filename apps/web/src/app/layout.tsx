import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { Toaster } from "@/components/ui/misc";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { INSTITUTION, PLATFORM } from "@/lib/institution";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: `${PLATFORM.name} · ${INSTITUTION.shortName}`, template: `%s · ${PLATFORM.name}` },
  description: `Find, found and run student clubs at ${INSTITUTION.name}.`,
};

export const viewport: Viewport = { themeColor: "#492365" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <AssistantLauncher />
        <Toaster />
      </body>
    </html>
  );
}
