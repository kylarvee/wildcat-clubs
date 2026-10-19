import type { FundingSource, FundingStatus } from "@prisma/client";
import { CheckCircle2, CircleSlash, Clock, Undo2, Wallet } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, KeyValue } from "@/components/ui/layout";
import { plural } from "@/lib/funding/labels";
import { fmtLongDate, fmtMoney } from "@/lib/time";

type RequestFacts = {
  status: FundingStatus;
  title: string;
  justification: string | null;
  fundingSource: FundingSource;
  amountRequestedCents: number;
  amountApprovedCents: number | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  submittedBy: { name: string } | null;
  decidedBy: { name: string } | null;
  term: { name: string };
};

/**
 * Where a decided (or waiting) request stands, in a sentence, with WSUSA's
 * note. `audience` words it for the club or for admins. Approvals say which
 * source funded it; partial ones count the lines that got less (they're
 * unlocked, so the club can ask another source: `askAgainHref`).
 */
export function DecisionCallout({
  request: r,
  audience,
  reviewDays,
  fundedLabel,
  reducedLines = 0,
  askAgainHref,
}: {
  request: RequestFacts;
  audience: "club" | "admin";
  reviewDays?: number;
  /** The source that funded it ("Department · Nursing"). */
  fundedLabel?: string | null;
  /** Lines approved for less than they asked. */
  reducedLines?: number;
  /** Club side: start a request for what wasn't funded. */
  askAgainHref?: string | null;
}) {
  const note = r.decisionNote ? <p className="whitespace-pre-line">{r.decisionNote}</p> : null;
  const funded = fundedLabel ? `, funded by ${fundedLabel}` : "";
  switch (r.status) {
    case "SUBMITTED":
      return (
        <Callout tone="info" icon={<Clock />} title="In WSUSA review">
          {audience === "club"
            ? `WSUSA staff are reviewing it${reviewDays ? ` and usually respond within about ${reviewDays} business days` : ""}. They may fund it from another source than the one you expect. You'll get a notification when they decide.`
            : `Submitted ${r.submittedAt ? fmtLongDate(r.submittedAt) : ""}${r.submittedBy ? ` by ${r.submittedBy.name}` : ""}.`}
        </Callout>
      );
    case "APPROVED":
      return (
        <Callout tone="success" icon={<CheckCircle2 />} title={`Approved: ${fmtMoney(r.amountApprovedCents ?? 0)}`}>
          <p>
            The full amount, approved {r.decidedAt ? fmtLongDate(r.decidedAt) : ""}
            {r.decidedBy ? ` by ${r.decidedBy.name}` : ""}
            {funded}.
          </p>
          {note}
        </Callout>
      );
    case "PARTIALLY_APPROVED":
      return (
        <Callout tone="warning" icon={<CheckCircle2 />} title={`Partly approved: ${fmtMoney(r.amountApprovedCents ?? 0)} of ${fmtMoney(r.amountRequestedCents)}`}>
          <p>
            Decided {r.decidedAt ? fmtLongDate(r.decidedAt) : ""}
            {r.decidedBy ? ` by ${r.decidedBy.name}` : ""}
            {funded}.
            {reducedLines
              ? audience === "club"
                ? ` ${plural(reducedLines, "line")} got less than asked. ${reducedLines === 1 ? "It's" : "They're"} free again, so you can ask another source for the rest.`
                : ` ${plural(reducedLines, "line")} got less than asked; the club can ask another source for the rest.`
              : ""}
          </p>
          {note}
          {askAgainHref ? (
            <div className="mt-2">
              <ButtonLink href={askAgainHref} size="sm" variant="secondary">
                <Wallet className="h-4 w-4" aria-hidden /> Ask another source for the rest
              </ButtonLink>
            </div>
          ) : null}
        </Callout>
      );
    case "DENIED":
      return (
        <Callout tone="danger" icon={<CircleSlash />} title="Not approved">
          <p>
            Decided {r.decidedAt ? fmtLongDate(r.decidedAt) : ""}
            {r.decidedBy ? ` by ${r.decidedBy.name}` : ""}.{audience === "club" ? " The lines are free again, so you can change them and ask again." : ""}
          </p>
          {note}
        </Callout>
      );
    case "WITHDRAWN":
      return (
        <Callout tone="info" icon={<Undo2 />} title="Withdrawn by the club">
          <p>{r.decidedAt ? `Withdrawn ${fmtLongDate(r.decidedAt)}.` : null}</p>
          {r.decisionNote ? <p className="whitespace-pre-line">Reason: {r.decisionNote}</p> : null}
        </Callout>
      );
    default:
      return null;
  }
}

/** The request's facts: term, the source the club expects (and the one that funded it), who sent it, the money, and the club's reason. */
export function RequestFactsCard({
  request: r,
  sourceLabel,
  fundedLabel,
  extra,
}: {
  request: RequestFacts;
  /** The source the club expects. */
  sourceLabel: string;
  /** Approvals: the source that funded it. */
  fundedLabel?: string | null;
  extra?: { label: string; value: React.ReactNode }[];
}) {
  return (
    <Card>
      <CardHeader title="Request" />
      <CardBody className="space-y-4">
        <KeyValue
          items={[
            { label: "Semester", value: r.term.name },
            { label: "Expected source", value: sourceLabel },
            ...(fundedLabel ? [{ label: "Funded by", value: fundedLabel }] : []),
            { label: "Submitted", value: r.submittedAt ? `${fmtLongDate(r.submittedAt)}${r.submittedBy ? ` by ${r.submittedBy.name}` : ""}` : "Not yet" },
            {
              label: "Amount",
              value: (
                <span className="tabular-nums">
                  {fmtMoney(r.amountRequestedCents)} requested
                  {r.amountApprovedCents != null ? ` · ${fmtMoney(r.amountApprovedCents)} approved` : ""}
                </span>
              ),
            },
            ...(extra ?? []),
          ]}
        />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Why the club needs it</p>
          {r.justification ? <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{r.justification}</p> : <p className="mt-1 text-sm text-ink-3">No explanation given.</p>}
        </div>
      </CardBody>
    </Card>
  );
}
