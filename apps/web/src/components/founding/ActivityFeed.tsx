import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
import { actionPhrase, BUSY_ACTIONS } from "@/lib/lake/actions";
import { fmtAgo, fmtLongDate } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";

/** Recent club activity from the lake (ActivityLog by clubId). Leaders-only surfaces. */
export async function ActivityFeed({ clubId, take = 12 }: { clubId: string; take?: number }) {
  const rows = await db.activityLog.findMany({
    // Busy actions (check-ins, follows, finished tasks…) would drown out the rest.
    where: { clubId, action: { notIn: BUSY_ACTIONS } },
    orderBy: { at: "desc" },
    take,
    select: { id: true, at: true, action: true, data: true, actor: { select: { name: true, avatarUrl: true, avatarColor: true } } },
  });
  if (!rows.length) return <p className="text-sm text-ink-3">Nothing yet — activity shows up here as your club gets going.</p>;
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <li key={String(r.id)} className="flex items-start gap-3 text-sm">
          <Avatar name={r.actor?.name ?? "Wildcat Clubs"} src={r.actor?.avatarUrl} color={r.actor?.avatarColor ?? "#77707f"} size="xs" className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-ink">{r.actor?.name ?? "Wildcat Clubs"}</span> <span className="text-ink-2">{actionPhrase(r.action, r.data, ROLE_LABEL)}</span>
            <time dateTime={r.at.toISOString()} title={fmtLongDate(r.at)} className="block text-xs text-ink-3">
              {fmtAgo(r.at)}
            </time>
          </span>
        </li>
      ))}
    </ol>
  );
}
