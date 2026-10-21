import { getConfig } from "@/lib/config";
import { officeForClub } from "@/lib/offices";
import { overseenBy } from "@/lib/offices/rules";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { OfficeContact } from "@/components/offices/OfficeContact";

/**
 * Who reviews a club and how to reach them: the office that oversees it
 * (lib/offices, "Overseen by Campus Recreation"), its location, hours, email
 * and phone (empty fields are hidden), and for WSUSA's clubs WSUSA's
 * reviewers (system config wsusa.reviewers).
 */
export async function ClubOfficeContacts({ clubId, title = "Who reviews your club", description }: { clubId: string; title?: string; description?: string }) {
  const office = await officeForClub(clubId);
  const reviewers = office.umbrella ? ((await getConfig())["wsusa.reviewers"] ?? []).filter((r) => r && (r.name || r.email)) : [];
  const contact = office.location || office.hours || office.email || office.phone;

  return (
    <Card>
      <CardHeader title={title} description={description ? `${overseenBy(office)}. ${description}` : overseenBy(office)} />
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
            <p className="text-sm text-ink-3">The {office.name} team reviews its clubs.</p>
          )}
        </div>
        {contact ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{office.name}</p>
            <OfficeContact office={office} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
