import { CalendarDays, Compass, QrCode } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { INSTITUTION } from "@/lib/institution";

/** New here (no clubs yet): three steps to get going, starting with the clubs list. */
export function WelcomeCard({ firstName }: { firstName: string }) {
  const steps = [
    { icon: Compass, title: "Find a club", body: `Browse ${INSTITUTION.shortName}'s clubs by college, major or interest, then press Register.` },
    { icon: CalendarDays, title: "Your calendar fills in", body: "Events from clubs you join or follow show up on your calendar here." },
    { icon: QrCode, title: "Show up and check in", body: "Scan the code at the meeting with your phone's camera. After a few events you can review the club." },
  ];
  return (
    <section aria-labelledby="dash-welcome-title">
      <Card className="overflow-hidden">
        <div className="bg-[linear-gradient(120deg,var(--color-brand-700),var(--color-brand-600)_70%,var(--color-brand-200))] px-5 py-6 text-white sm:px-6">
          <h2 id="dash-welcome-title" className="text-xl font-semibold">
            Welcome to Wildcat Clubs, {firstName}!
          </h2>
          <p className="mt-1 max-w-xl text-sm text-white/85">This is your home base: your clubs, your calendar and anything waiting on you. Start by finding a club or two.</p>
        </div>
        <ol className="grid gap-4 px-5 py-5 sm:grid-cols-3 sm:px-6">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
                <s.icon className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </p>
                <p className="mt-0.5 text-sm text-ink-3">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <ButtonLink href="/clubs">
            <Compass className="h-4 w-4" aria-hidden /> Browse clubs
          </ButtonLink>
        </div>
      </Card>
    </section>
  );
}
