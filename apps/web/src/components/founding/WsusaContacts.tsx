import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { getConfig } from "@/lib/config";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

/** WSUSA reviewers and office details from system config (empty fields are hidden). */
export async function WsusaContacts({ title = "Who reviews your club", description }: { title?: string; description?: string }) {
  const cfg = await getConfig();
  // Config values are sysadmin-edited JSON; read them as plain strings.
  const office = cfg["wsusa.office"] as { name: string; location: string; hours: string; email: string; phone: string; reviewDays: number };
  const reviewers = (cfg["wsusa.reviewers"] ?? []).filter((r) => r && (r.name || r.email));
  const rows = [
    office.location ? { icon: MapPin, label: "Office", value: office.location } : null,
    office.hours ? { icon: Clock, label: "Hours", value: office.hours } : null,
    office.email ? { icon: Mail, label: "Email", value: office.email, href: `mailto:${office.email}` } : null,
    office.phone ? { icon: Phone, label: "Phone", value: office.phone, href: `tel:${office.phone.replace(/[^\d+]/g, "")}` } : null,
  ].filter(Boolean) as { icon: typeof MapPin; label: string; value: string; href?: string }[];

  return (
    <Card>
      <CardHeader title={title} description={description ?? office.name} />
      <CardBody className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Reviewers</p>
          {reviewers.length ? (
            <ul className="space-y-3">
              {reviewers.map((r, i) => (
                <li key={i} className="text-sm">
                  <span className="block font-medium text-ink">{r.name}</span>
                  {r.title ? <span className="block text-ink-3">{r.title}</span> : null}
                  {r.email ? (
                    <a href={`mailto:${r.email}`} className="text-brand-600 underline-offset-2 hover:underline">
                      {r.email}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">The {office.name || "WSUSA"} team reviews new clubs.</p>
          )}
        </div>
        {rows.length ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{office.name || "Office"}</p>
            <dl className="space-y-2.5">
              {rows.map((r) => (
                <div key={r.label} className="flex gap-2.5 text-sm">
                  <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                  <dt className="sr-only">{r.label}</dt>
                  <dd className="text-ink">
                    {r.href ? (
                      <a href={r.href} className="text-brand-600 underline-offset-2 hover:underline">
                        {r.value}
                      </a>
                    ) : (
                      r.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
