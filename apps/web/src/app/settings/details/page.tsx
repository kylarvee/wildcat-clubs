import type { Metadata } from "next";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { periodStartFor } from "@/lib/authz/requirements";
import { myDetails } from "@/lib/domain/details";
import { ageOn, detailsCurrent, missingDetails } from "@/lib/details/rules";
import { INSTITUTION } from "@/lib/institution";
import { fmtDate, fmtLongDate } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/layout";
import { DetailsForm } from "@/components/profile/settings/DetailsForm";

export const metadata: Metadata = { title: "Settings · Member details" };

/**
 * Member details: what WSUSA needs from every club member, entered once here
 * and reused by every club (no club sign-up asks again). A "Member details"
 * requirement asks people to confirm them each renewal period.
 */
export default async function DetailsPage() {
  const user = await requireUser("/settings/details");
  const now = new Date();
  const [d, req] = await Promise.all([myDetails(user), db.roleRequirement.findFirst({ where: { kind: "PROFILE", active: true }, select: { name: true, renewal: true } })]);
  const since = req ? await periodStartFor(req.renewal, now) : null;
  const missing = missingDetails(d, user.kind);
  const current = since ? detailsCurrent(d, user.kind, since) : !missing.length && Boolean(d?.confirmedAt);
  const minor = d?.birthDate ? ageOn(d.birthDate, now) < 18 : false;
  const student = user.kind === "STUDENT";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Member details</h2>
        <p className="mt-1 text-sm text-ink-3">
          {INSTITUTION.studentGovernment} asks every club member for these. You enter them once, here, and every club you join uses them, so no club sign-up asks again.
        </p>
      </div>

      {current && d?.confirmedAt ? (
        <Callout tone="success" icon={<CheckCircle2 />} title="You're all set">
          Confirmed {fmtLongDate(d.confirmedAt)}. Update anything here whenever it changes.
        </Callout>
      ) : (
        <Callout tone="warning" icon={<ShieldAlert />} title={missing.length ? "A few details are missing" : `Confirm your details${since ? ` for the year starting ${fmtDate(since, "MMMM yyyy")}` : ""}`}>
          {missing.length
            ? `Still needed: ${missing.join(", ")}. `
            : "Check that everything below is still right, then confirm. "}
          {req ? `${INSTITUTION.studentGovernment} requires it of every club member${student ? "" : " in a club"}.` : null}
        </Callout>
      )}

      {minor ? (
        <Callout tone="info" title="Under 18?">
          {INSTITUTION.studentGovernment}&apos;s member agreements need a parent or guardian&apos;s signature for students under 18. Contact {INSTITUTION.studentGovernment} and they&apos;ll send the guardian version.
        </Callout>
      ) : null}

      <Card className="p-4 sm:p-6">
        <DetailsForm
          kind={user.kind}
          weberEmail={user.email}
          canConfirm={!missing.length && !current}
          initial={{
            studentId: d?.studentId ?? "",
            birthDate: d?.birthDate ? d.birthDate.toISOString().slice(0, 10) : "",
            gender: d?.gender ?? "",
            phone: d?.phone ?? "",
            contactEmail: d?.contactEmail ?? "",
            yearInSchool: d?.yearInSchool ?? "",
            addressLine: d?.addressLine ?? "",
            addressCity: d?.addressCity ?? "",
            addressState: d?.addressState ?? "UT",
            addressZip: d?.addressZip ?? "",
            emergencyName: d?.emergencyName ?? "",
            emergencyRelationship: d?.emergencyRelationship ?? "",
            emergencyPhone: d?.emergencyPhone ?? "",
            emergencyEmail: d?.emergencyEmail ?? "",
          }}
        />
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-ink">Who sees what</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
          <li>
            <strong className="font-medium text-ink">You and {INSTITUTION.studentGovernment} staff</strong> see everything here.
          </li>
          <li>
            <strong className="font-medium text-ink">Leaders who manage a club&apos;s roster, and its advisors,</strong> see your phone, personal email and year in school, for clubs you&apos;re in.
          </li>
          <li>
            <strong className="font-medium text-ink">Your emergency contact</strong> opens only when one of those leaders needs it, and every time it&apos;s opened is recorded.
          </li>
          <li>Your student ID, date of birth, gender and address never go to clubs.</li>
        </ul>
      </Card>
    </div>
  );
}
