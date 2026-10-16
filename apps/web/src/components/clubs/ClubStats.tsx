import { Activity, Repeat, UserCheck, Users } from "lucide-react";
import type { ReactNode } from "react";
import { clubActivity, clubRetention, type RetentionPoint } from "@/lib/metrics";
import { getConfig } from "@/lib/config";
import { clubMetricsFor } from "@/lib/clubs/queries";
import { fmtLongDate } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { RetentionChart, type RetentionPointView } from "@/components/clubs/RetentionChart";
import { pct } from "@/components/clubs/labels";

const view = (p: RetentionPoint): RetentionPointView => ({ label: p.label, rate: p.rate, attendees: p.attendees, retained: p.retained, previousAttendees: p.previousAttendees, inProgress: p.inProgress });

function Tile({ icon, label, value, hint, tone = "default" }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "muted" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
        <span className="text-ink-3 [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden="true">
          {icon}
        </span>
        {label}
      </p>
      <p className={cn("mt-1.5 text-2xl font-semibold tracking-tight", tone === "good" ? "text-success" : tone === "muted" ? "text-ink-3" : "text-ink")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs leading-snug text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** Summary statistics on the club page. Every number comes from lib/metrics. */
export async function ClubStats({ clubId, clubName, retired }: { clubId: string; clubName: string; retired: boolean }) {
  const [activity, month, quarter, metrics, cfg] = await Promise.all([
    clubActivity(clubId),
    clubRetention(clubId, "month", { count: 6 }),
    clubRetention(clubId, "quarter", { count: 4 }),
    clubMetricsFor(clubId),
    getConfig(),
  ]);

  const status = retired
    ? { value: "Retired", hint: "History is kept on record", tone: "muted" as const }
    : activity.active
      ? activity.inPilot
        ? { value: "Pilot period", hint: activity.pilotEndsAt ? `New club — counts as active through ${fmtLongDate(activity.pilotEndsAt)}` : "New club — counts as active while it gets going", tone: "good" as const }
        : { value: "Active", hint: `${activity.heldEventsCurrentTerm} ${activity.heldEventsCurrentTerm === 1 ? "event" : "events"} held this term`, tone: "good" as const }
      : activity.reasons.length
        ? { value: "Inactive", hint: activity.reasons[0], tone: "muted" as const }
        : { value: "—", hint: "Not enough history yet", tone: "muted" as const };

  return (
    <Card className="p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<UserCheck />} label="Active members" value={activity.activeMembers.toLocaleString("en-US")} hint={`Checked in within ${cfg["activity.studentWindowDays"]} days or at one of the last ${cfg["activity.studentRecentEvents"]} events`} />
        <Tile icon={<Users />} label="Registered members" value={activity.registeredMembers.toLocaleString("en-US")} hint="Everyone who's joined" />
        <Tile icon={<Repeat />} label="Retention" value={pct(metrics.retentionRate)} hint="Last month's attendees who came back" />
        <Tile icon={<Activity />} label="Club status" value={status.value} hint={status.hint} tone={status.tone} />
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <RetentionChart month={month.map(view)} quarter={quarter.map(view)} clubName={clubName} />
      </div>
    </Card>
  );
}
