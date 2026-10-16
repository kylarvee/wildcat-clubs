import { CalendarClock, MapPin } from "lucide-react";
import type { OccurrenceSummary } from "@/lib/attendance/queries";
import { fmtRange } from "@/lib/time";
import { INSTITUTION } from "@/lib/institution";
import { ClubLogo } from "@/components/ui/avatar";
import { LogoMark } from "@/components/shell/Logo";
import { cn } from "@/components/ui/cn";

/** Club logo, event title, time and place — the top of every check-in screen. */
export function EventHeading({
  occurrence,
  size = "md",
  className,
}: {
  occurrence: Pick<OccurrenceSummary, "title" | "startsAt" | "endsAt" | "allDay" | "place" | "club" | "cohosts">;
  size?: "md" | "lg";
  className?: string;
}) {
  const host = occurrence.club;
  const withCohosts = occurrence.cohosts.length ? ` with ${occurrence.cohosts.map((c) => c.name).join(", ")}` : "";
  return (
    <div className={cn("flex items-start gap-4", className)}>
      {host ? (
        <ClubLogo name={host.name} src={host.logoUrl} color={host.logoColor} size={size === "lg" ? "lg" : "md"} />
      ) : (
        <span className="shrink-0">
          <LogoMark size={size === "lg" ? 64 : 48} />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          {host ? host.name : `${INSTITUTION.shortName} · ${INSTITUTION.studentGovernment}`}
          <span className="font-medium normal-case tracking-normal text-ink-3">{withCohosts}</span>
        </p>
        <h1 className={cn("mt-0.5 font-bold tracking-tight text-ink", size === "lg" ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl")}>{occurrence.title}</h1>
        <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-2">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <span>{fmtRange(occurrence.startsAt, occurrence.endsAt, occurrence.allDay)}</span>
        </p>
        {occurrence.place ? (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            <span>{occurrence.place}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
