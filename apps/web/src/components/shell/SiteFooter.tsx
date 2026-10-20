import Link from "next/link";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { LogoMark } from "@/components/shell/Logo";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <LogoMark size={28} />
            <span className="font-bold">{PLATFORM.name}</span>
          </div>
          <p className="text-sm text-ink-3">
            The home for student clubs at {INSTITUTION.name}. Run with {INSTITUTION.studentGovernment}.
          </p>
        </div>
        <FooterCol title="Explore" links={[["Clubs", "/clubs"], ["Events", "/events"], ["Club network", "/network"], ["Start a club", "/clubs/new"]]} />
        <FooterCol title="For members" links={[["Dashboard", "/dashboard"], ["My involvement", "/me/involvement"], ["Get the app", "/get-the-app"], ["Report a concern", "/report"]]} />
        {/* Topic anchors in the library, not policy slugs: an archived policy would make a slug link 404 on every page. */}
        <FooterCol title="Policy" links={[["Policy library", "/policies"], ["Review policy", "/policies#reviews"], ["Reporting policy", "/policies#complaints"]]} />
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-ink-3">
        {PLATFORM.name} · {INSTITUTION.name} · {INSTITUTION.city}
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-ink">{title}</p>
      <ul className="space-y-2 text-sm">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-ink-3 hover:text-ink">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
