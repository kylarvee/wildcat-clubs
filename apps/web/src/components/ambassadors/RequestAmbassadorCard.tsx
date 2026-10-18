import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { ambassadorRequestView } from "@/lib/domain/ambassadors";
import { fmtAgo, fmtDate } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { RequestAmbassadorButton, WithdrawRequestButton } from "./RequestAmbassadorControls";

/**
 * A regular club's College Ambassador, as its org chart shows it. The club's
 * leaders don't fill this seat; they ask the college's ambassador program
 * (domain/ambassadors). Renders nothing for an ambassador program itself.
 */
export async function RequestAmbassadorCard({ clubId }: { clubId: string; clubSlug: string }) {
  const actor = await getCurrentUser();
  const view = await ambassadorRequestView(actor, clubId);
  if (!view) return null;
  const { program, placed, open, blocker } = view;

  return (
    <Card>
      <CardHeader
        title="College Ambassador"
        description={
          program ? (
            <>
              Placed by{" "}
              <Link href={`/clubs/${program.slug}`} className="underline underline-offset-2 hover:text-ink">
                {program.name}
              </Link>
              . Ambassadors carry your club&apos;s news and needs to the college, and the college&apos;s back to you.
            </>
          ) : (
            "College ambassadors are placed by a college's ambassador program."
          )
        }
      />
      <CardBody className="space-y-4">
        {placed.length ? (
          <ul className="space-y-2">
            {placed.map((p) => (
              <li key={p.assignmentId} className="flex items-center gap-2.5">
                <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="xs" />
                <span className="text-sm">
                  <Link href={`/u/${p.handle}`} className="font-medium text-ink hover:underline">
                    {p.name}
                  </Link>{" "}
                  <span className="text-xs text-ink-3">since {fmtDate(p.since, "MMMM yyyy")}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : program ? (
          <p className="text-sm text-ink-2">No ambassador yet.</p>
        ) : null}

        {open ? (
          <div className="space-y-2 rounded-xl border border-line bg-muted/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Requested</Badge>
              <span className="text-xs text-ink-3">
                Asked {Date.now() - open.at.getTime() < 60_000 ? "just now" : fmtAgo(open.at)}
                {open.byName ? ` by ${open.byName}` : ""}. {program?.name ?? "The program"} will place someone or reply.
              </span>
            </div>
            {open.note ? <p className="text-sm text-ink-2">&ldquo;{open.note}&rdquo;</p> : null}
            {view.canWithdraw && program ? <WithdrawRequestButton clubId={view.club.id} programName={program.name} /> : null}
          </div>
        ) : !blocker && program ? (
          <RequestAmbassadorButton clubId={view.club.id} clubName={view.club.name} programName={program.name} another={placed.length > 0} />
        ) : blocker && !placed.length ? (
          <p className="text-sm text-ink-3">{blocker}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
