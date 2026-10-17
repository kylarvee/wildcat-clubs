import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Callout } from "@/components/ui/layout";
import { fmtGraduated } from "@/lib/profiles/format";
import { INSTITUTION, PLATFORM } from "@/lib/institution";

/** Shown instead of an editor once someone has graduated: alumni profiles are read-only. */
export function RetiredNotice({ handle, graduatedAt, what = "Your profile" }: { handle: string; graduatedAt: Date | null; what?: string }) {
  return (
    <Callout tone="brand" icon={<GraduationCap />} title={`Congratulations, graduate${graduatedAt ? ` (${fmtGraduated(graduatedAt)})` : ""}!`}>
      {what} was retired when you graduated, so it can&apos;t be changed — it stays as the record of your time in Weber State clubs.{" "}
      <Link href={`/u/${handle}`} className="font-medium underline underline-offset-2">
        See your profile
      </Link>
      . If something is wrong, email {INSTITUTION.studentGovernment} at{" "}
      <a href={`mailto:${PLATFORM.supportEmail}`} className="font-medium underline underline-offset-2">
        {PLATFORM.supportEmail}
      </a>
      .
    </Callout>
  );
}
