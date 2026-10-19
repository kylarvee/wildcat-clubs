import Link from "next/link";
import type { ClubListItem, ViewerClubState } from "@/lib/clubs/queries";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CLUB_TYPE_LABEL, CLUB_TYPE_TONE, pct } from "@/components/clubs/labels";
import { ClubStatusBadge, RatingInline } from "@/components/clubs/ClubCard";
import { RegisterButton, SubscribeToggle } from "@/components/clubs/MembershipControls";
import { FoundIn } from "@/components/search/FoundIn";
import { Reasons } from "@/components/search/Reasons";
import { ACTIVITY_SCORE_HINT, noRetentionText, RETENTION_HINT } from "@/lib/metrics/pure";

/** List view of the clubs list: one row per club, for comparing numbers side by side. */
export function ClubTable({ clubs, states, signedIn }: { clubs: ClubListItem[]; states: Map<string, ViewerClubState>; signedIn: boolean }) {
  const actions = signedIn && clubs.some((c) => c.status === "APPROVED");
  return (
    // `relative` keeps the visually-hidden labels inside the horizontal scroller on phones.
    <Table className="relative">
      <caption className="sr-only">Clubs, one per row, with attending members, rating, retention and events held lately</caption>
      <THead>
        <tr>
          <TH scope="col">Club</TH>
          <TH scope="col" className="hidden xl:table-cell">Type</TH>
          <TH scope="col" className="text-right" title="Attending members, of everyone registered">
            Attending
          </TH>
          <TH scope="col" className="hidden sm:table-cell">Rating</TH>
          <TH scope="col" className="hidden text-right lg:table-cell" title={RETENTION_HINT}>Retention</TH>
          <TH scope="col" className="hidden text-right xl:table-cell" title={ACTIVITY_SCORE_HINT}>Events held</TH>
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
                    {c.match ? <FoundIn match={c.match} compact className="mt-1" /> : null}
                    {c.reasons.length ? <Reasons reasons={c.reasons} inline className="mt-1" /> : null}
                  </div>
                </div>
              </TD>
              <TD className="hidden xl:table-cell">
                <Badge tone={CLUB_TYPE_TONE[c.type]}>{CLUB_TYPE_LABEL[c.type]}</Badge>
              </TD>
              <TD className="text-right tabular-nums">
                <span className="font-medium">{c.metrics.activeMembers.toLocaleString("en-US")}</span>
                <span className="block text-xs text-ink-3">of {c.metrics.registeredMembers.toLocaleString("en-US")} registered</span>
              </TD>
              <TD className="hidden whitespace-nowrap text-sm sm:table-cell">
                <RatingInline avg={c.metrics.avgRating} count={c.metrics.reviewCount} size={13} />
              </TD>
              <TD className="hidden text-right tabular-nums lg:table-cell" title={c.metrics.retention?.label ?? noRetentionText()}>
                {pct(c.metrics.retentionRate)}
                {c.metrics.retention ? <span className="block text-xs text-ink-3">{c.metrics.retention.months}</span> : null}
              </TD>
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
