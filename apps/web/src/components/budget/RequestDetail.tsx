import type { FundingSource, FundingStatus } from "@prisma/client";
import { CheckCircle2, CircleSlash, Clock, Undo2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, KeyValue } from "@/components/ui/layout";
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
 * note. `audience` words it for the club or for admins.
 */
export function DecisionCallout({ request: r, audience, reviewDays }: { request: RequestFacts; audience: "club" | "admin"; reviewDays?: number }) {
  const note = r.decisionNote ? <p className="whitespace-pre-line">{r.decisionNote}</p> : null;
  switch (r.status) {
    case "SUBMITTED":
      return (
        <Callout tone="info" icon={<Clock />} title="In WSUSA review">
          {audience === "club"
            ? `WSUSA staff are reviewing it${reviewDays ? ` and usually respond within about ${reviewDays} business days` : ""}. You'll get a notification when they decide.`
            : `Submitted ${r.submittedAt ? fmtLongDate(r.submittedAt) : ""}${r.submittedBy ? ` by ${r.submittedBy.name}` : ""}.`}
        </Callout>
      );
    case "APPROVED":
      return (
        <Callout tone="success" icon={<CheckCircle2 />} title={`Approved: ${fmtMoney(r.amountApprovedCents ?? 0)}`}>
          <p>
            The full amount, approved {r.decidedAt ? fmtLongDate(r.decidedAt) : ""}
            {r.decidedBy ? ` by ${r.decidedBy.name}` : ""}.
          </p>
          {note}
        </Callout>
      );
    case "PARTIALLY_APPROVED":
      return (
        <Callout tone="warning" icon={<CheckCircle2 />} title={`Partly approved: ${fmtMoney(r.amountApprovedCents ?? 0)} of ${fmtMoney(r.amountRequestedCents)}`}>
          <p>
            Decided {r.decidedAt ? fmtLongDate(r.decidedAt) : ""}
            {r.decidedBy ? ` by ${r.decidedBy.name}` : ""}.
          </p>
          {note}
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

/** The request's facts: term, source, who sent it, the money, and the club's reason. */
export function RequestFactsCard({ request: r, sourceLabel, extra }: { request: RequestFacts; sourceLabel: string; extra?: { label: string; value: React.ReactNode }[] }) {
  return (
    <Card>
      <CardHeader title="Request" />
      <CardBody className="space-y-4">
        <KeyValue
          items={[
            { label: "Semester", value: r.term.name },
            { label: "Funding from", value: sourceLabel },
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
