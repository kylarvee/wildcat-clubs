import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
import { fmtAgo, fmtLongDate } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import type { ClubRole } from "@prisma/client";

/** Busy, low-signal actions that would drown out the rest of a club feed. */
const NOISY = ["calendar.subscribed", "calendar.unsubscribed", "attendance.checkin", "task.completed", "task.reopened", "constitution.draft_saved", "role.permissions_set", "file.renamed", "file.moved"];

const PHRASES: Record<string, string> = {
  "file.folder_created": "made a folder",
  "file.renamed": "renamed a file",
  "file.moved": "moved files",
  "file.trashed": "moved files to the trash",
  "file.restored": "restored files from the trash",
  "file.deleted": "deleted files for good",
  "file.visibility_set": "changed who can open a file",
  "file.featured_set": "updated the club page Resources",
  "file.shared": "shared a file",
  "file.share_changed": "changed someone's file access",
  "file.unshared": "removed someone's file access",
  "file.default_folders": "set up the club's starting folders",
  "club.created": "created the club",
  "club.profile_updated": "updated the club profile",
  "club.submitted": "submitted the club to WSUSA",
  "club.resubmitted": "resubmitted the club to WSUSA",
  "club.approved": "approved the club",
  "club.changes_requested": "asked for changes",
  "club.rejected": "decided not to approve the club",
  "club.retired": "retired the club",
  "club.reinstated": "reinstated the club",
  "club.document_added": "added a document to the profile",
  "club.document_removed": "took a document off the profile",
  "club.contact_email_set": "updated the club's Google account",
  "club.cohost_auto_set": "changed co-host auto-approval",
  "role.ended": "ended a role",
  "membership.joined": "joined the club",
  "membership.requested": "asked to join",
  "membership.approved": "approved a join request",
  "membership.declined": "declined a join request",
  "membership.left": "left the club",
  "membership.removed": "removed a member",
  "membership.title_set": "set a member's title",
  "advisor.invited": "invited an advisor",
  "advisor.invite_resent": "resent an advisor invitation",
  "advisor.invite_cancelled": "cancelled an advisor invitation",
  "advisor.accepted": "became the club's advisor",
  "advisor.declined": "declined to advise the club",
  "constitution.draft_created": "started a constitution draft",
  "constitution.adopted": "adopted a new constitution and bylaws",
  "constitution.custom_submitted": "sent a custom document to WSUSA",
  "constitution.custom_approved": "approved a custom document",
  "constitution.custom_rejected": "returned a custom document",
  "constitution.custom_withdrawn": "withdrew a custom document",
  "department.created": "added the club's department",
  "department.linked": "linked the club's department",
  "file.uploaded": "uploaded a file",
};

function describe(action: string, data: unknown) {
  const d = (data ?? {}) as Record<string, unknown>;
  if (action === "role.assigned") {
    const seat = typeof d.position === "string" ? d.position : typeof d.role === "string" ? ROLE_LABEL[d.role as ClubRole] : null;
    return seat ? `filled the ${seat} seat` : "assigned a role";
  }
  if (action === "file.uploaded" && typeof d.name === "string") return `uploaded ${d.name}`;
  if (PHRASES[action]) return PHRASES[action];
  const [noun, verb] = action.split(".");
  return `${(verb ?? "").replace(/_/g, " ")} ${noun ?? ""}`.trim();
}

/** Recent club activity from the lake (ActivityLog by clubId). Leaders-only surfaces. */
export async function ActivityFeed({ clubId, take = 12 }: { clubId: string; take?: number }) {
  const rows = await db.activityLog.findMany({
    where: { clubId, action: { notIn: NOISY } },
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
            <span className="font-medium text-ink">{r.actor?.name ?? "Wildcat Clubs"}</span> <span className="text-ink-2">{describe(r.action, r.data)}</span>
            <time dateTime={r.at.toISOString()} title={fmtLongDate(r.at)} className="block text-xs text-ink-3">
              {fmtAgo(r.at)}
            </time>
          </span>
        </li>
      ))}
    </ol>
  );
}
