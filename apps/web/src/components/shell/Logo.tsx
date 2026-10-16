import Link from "next/link";
import { PLATFORM } from "@/lib/institution";

/** The Wildcat Clubs mark: a purple tile with a stylized "W" made of two linked rings (clubs connecting). */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#492365" />
      <path d="M7 10.5 L11 22 L16 13.5 L21 22 L25 10.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="8.2" r="2.1" fill="#c9b3e6" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-brand">
      <LogoMark />
      <span className="text-[17px] font-bold tracking-tight text-ink">{PLATFORM.name}</span>
    </Link>
  );
}
