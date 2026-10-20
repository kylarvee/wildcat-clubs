"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { safeHex } from "@/components/clubs/labels";

/** "RC Wrecker Bots Club" → "RWB", the same monogram as ClubLogo. */
function monogram(name: string) {
  return (
    name
      .replace(/[^A-Za-z0-9 &]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !["of", "the", "and", "&", "for", "at", "club", "society", "association"].includes(w.toLowerCase()))
      .slice(0, 3)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

const LOGO = { sm: "h-8 w-8 rounded-lg text-xs", md: "h-14 w-14 rounded-2xl text-lg", lg: "h-20 w-20 rounded-3xl text-2xl" } as const;

/**
 * An event's cover image. The picture sits over a blurred copy of itself, so a
 * tall flyer shows whole and a wide photo fills the frame. With no cover (or
 * one that can't load) it falls back to the host club's color and logo, so
 * every card has a picture. Decorative: the card's text says what it shows.
 */
export function EventCover({
  src,
  color,
  name,
  logoUrl,
  size = "md",
  eager,
  className,
  children,
}: {
  src: string | null;
  /** The host club's color (Weber purple for university events). */
  color: string;
  /** The host's name, for the monogram. */
  name: string;
  logoUrl?: string | null;
  size?: keyof typeof LOGO;
  /** Load right away (a page header) instead of when scrolled near (cards). */
  eager?: boolean;
  className?: string;
  /** Overlays (a date chip, a status badge). */
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const hex = safeHex(color);
  const show = src && failed !== src;
  return (
    <div className={cn("relative isolate overflow-hidden", className)} style={{ backgroundColor: hex }}>
      {show ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-70 blur-xl" loading={eager ? "eager" : "lazy"} decoding="async" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="h-full w-full object-contain" loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailed(src)} />
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundImage: `linear-gradient(135deg, ${hex}, color-mix(in srgb, ${hex} 62%, #000))` }} aria-hidden="true">
          <span className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10" />
          <span className="absolute -bottom-12 -left-6 h-28 w-28 rounded-full bg-black/10" />
          {logoUrl && !logoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className={cn("relative bg-white object-cover shadow-md ring-2 ring-white/70", LOGO[size])} loading={eager ? "eager" : "lazy"} onError={() => setLogoFailed(true)} />
          ) : (
            <span className={cn("relative inline-flex items-center justify-center bg-white/15 font-bold tracking-tight text-white ring-1 ring-white/30", LOGO[size])}>{monogram(name)}</span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
