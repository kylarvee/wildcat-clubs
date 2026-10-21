import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type OfficeContactInfo = { name: string; location: string | null; hours: string | null; email: string | null; phone: string | null };

/** An office's contact rows that have something in them (empty fields are hidden). */
export function officeContactRows(office: OfficeContactInfo) {
  return [
    office.location ? { icon: MapPin, label: "Office", value: office.location } : null,
    office.hours ? { icon: Clock, label: "Hours", value: office.hours } : null,
    office.email ? { icon: Mail, label: "Email", value: office.email, href: `mailto:${office.email}` } : null,
    office.phone ? { icon: Phone, label: "Phone", value: office.phone, href: `tel:${office.phone.replace(/[^\d+]/g, "")}` } : null,
  ].filter(Boolean) as { icon: typeof MapPin; label: string; value: string; href?: string }[];
}

/**
 * How to reach an office (lib/offices): its location, hours, email and phone,
 * each only when the office has one. Pure, so server pages and client
 * components both use it.
 */
export function OfficeContact({ office, className }: { office: OfficeContactInfo; className?: string }) {
  const rows = officeContactRows(office);
  if (!rows.length) return null;
  return (
    <dl className={cn("space-y-2.5", className)}>
      {rows.map((r) => (
        <div key={r.label} className="flex gap-2.5 text-sm">
          <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <dt className="sr-only">{r.label}</dt>
          <dd className="min-w-0 text-ink">
            {r.href ? (
              <a href={r.href} className="break-words text-brand-600 underline-offset-2 hover:underline">
                {r.value}
              </a>
            ) : (
              r.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
