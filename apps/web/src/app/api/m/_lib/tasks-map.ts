import "server-only";
import { toTaskItem } from "@/components/tasks/items";
import { AWAITING_GRADE_NOTE, REQUIRED_LABEL, SELF_CLOSING_NOTE, taskKindLabel } from "@/components/tasks/labels";
import type { TaskRow } from "@/lib/domain/tasks";
import type { MTask, MTaskDecision } from "../_types";

/**
 * Tasks as the app shows them, worded by the web's own Tasks helpers
 * (components/tasks/items toTaskItem and labels), so the phone and /tasks
 * read the same: due dates in campus time, "Club test" vs "Requirement",
 * "Submitted — waiting for grading", the "Required by WSUSA" badge. No
 * database access here, so it can be unit-tested.
 */
export function toMTask(t: TaskRow, viewerId: string, now: Date, decision: MTaskDecision | null = null): MTask {
  const item = toTaskItem(t, viewerId, now);
  return {
    id: item.id,
    kind: item.kind,
    badge: item.required ? REQUIRED_LABEL : taskKindLabel(item),
    required: item.required,
    title: item.title,
    description: item.description,
    club: item.club && t.clubId ? { id: t.clubId, name: item.club.name, slug: item.club.slug, logoUrl: item.club.logoUrl, logoColor: item.club.logoColor } : null,
    dueLabel: item.due?.label ?? null,
    overdue: Boolean(item.due?.overdue),
    dueSoon: Boolean(item.due?.soon),
    waitingLabel: item.waiting,
    fromLabel: item.from ? `From ${item.from}` : null,
    forGroup: item.forGroup,
    // A request decided right here doesn't need "open it to approve or decline".
    note: decision ? null : item.waiting ? AWAITING_GRADE_NOTE : (SELF_CLOSING_NOTE[item.kind] ?? null),
    decision,
    checkable: item.checkable,
    path: item.href,
  };
}

/** What the app says once a request is decided. `leaving`: declining a co-host invitation the club had already accepted. */
export function decisionMessage(d: MTaskDecision, approve: boolean, opts: { leaving?: boolean } = {}): string {
  if (d.kind === "JOIN") return approve ? `${d.personName} is now a member of ${d.clubName}.` : `Declined ${d.personName}'s request to join ${d.clubName}.`;
  if (approve) return `${d.clubName} is co-hosting “${d.eventTitle}” now. It's on the club's calendar.`;
  return opts.leaving ? `${d.clubName} stepped back from co-hosting “${d.eventTitle}”.` : `Declined. ${d.clubName} won't co-host “${d.eventTitle}”.`;
}
