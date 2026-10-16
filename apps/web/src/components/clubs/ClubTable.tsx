import Link from "next/link";
import type { ClubListItem, ViewerClubState } from "@/lib/clubs/queries";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CLUB_TYPE_LABEL, CLUB_TYPE_TONE, pct } from "@/components/clubs/labels";
import { ClubStatusBadge, RatingInline } from "@/components/clubs/ClubCard";
import { RegisterButton, SubscribeToggle } from "@/components/clubs/MembershipControls";

/** List view of the clubs list: one row per club, for comparing numbers side by side. */
export function ClubTable({ clubs, states, signedIn }: { clubs: ClubListItem[]; states: Map<string, ViewerClubState>; signedIn: boolean }) {
  const actions = signedIn && clubs.some((c) => c.status === "APPROVED");
  return (
    // `relative` keeps the visually-hidden labels inside the horizontal scroller on phones.
    <Table className="relative">
      <caption className="sr-only">Clubs, one per row, with members, rating, retention and activity</caption>
      <THead>
        <tr>
          <TH scope="col">Club</TH>
          <TH scope="col" className="hidden xl:table-cell">Type</TH>
          <TH scope="col" className="text-right">Active</TH>
          <TH scope="col" className="hidden sm:table-cell">Rating</TH>
          <TH scope="col" className="hidden text-right lg:table-cell">Retention</TH>
          <TH scope="col" className="hidden text-right xl:table-cell" title="Events in the last 30 days and the next 30 days">Events</TH>
          {actions ? <TH scope="col"><span className="sr-only">Actions</span></TH> : null}
        </tr>
      </THead>
      <TBody>
        {clubs.map((c) => {
          const s = states.get(c.id);
          return (
            <TR key={c.id}>
              <TD className="min-w-[13rem] max-w-[22rem]">
                <div className="flex items-center gap-3">
                  <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/clubs/${c.slug}`} className="font-medium text-ink hover:text-brand hover:underline">
                        {c.name}
                      </Link>
                      <ClubStatusBadge club={c} />
                    </div>
                    <p className="truncate text-xs text-ink-3">
                      {c.placement}
                      {c.focus ? ` · ${c.focus}` : ""}
                    </p>
                  </div>
                </div>
              </TD>
              <TD className="hidden xl:table-cell">
                <Badge tone={CLUB_TYPE_TONE[c.type]}>{CLUB_TYPE_LABEL[c.type]}</Badge>
              </TD>
              <TD className="text-right tabular-nums">
                <span className="font-medium">{c.metrics.activeMembers.toLocaleString("en-US")}</span>
                <span className="block text-xs text-ink-3">of {c.metrics.registeredMembers.toLocaleString("en-US")}</span>
              </TD>
              <TD className="hidden whitespace-nowrap text-sm sm:table-cell">
                <RatingInline avg={c.metrics.avgRating} count={c.metrics.reviewCount} size={13} />
              </TD>
              <TD className="hidden text-right tabular-nums lg:table-cell">{pct(c.metrics.retentionRate)}</TD>
              <TD className="hidden text-right tabular-nums xl:table-cell">{c.metrics.activityScore}</TD>
              {actions ? (
                <TD>
                  {c.status === "APPROVED" ? (
                    <div className="flex items-center justify-end gap-2">
                      <RegisterButton clubId={c.id} clubName={c.name} slug={c.slug} gated={c.joinPolicy === "APPROVAL"} member={Boolean(s?.member)} pending={Boolean(s?.pending)} signedIn size="sm" />
                      <SubscribeToggle clubId={c.id} clubName={c.name} slug={c.slug} subscribed={Boolean(s?.subscribed)} signedIn />
                    </div>
                  ) : null}
                </TD>
              ) : null}
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
