import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { positionKey } from "@/lib/profiles/linkedin";
import { toMonthInput } from "@/lib/profiles/format";
import { Callout } from "@/components/ui/layout";
import { ExperienceManager } from "@/components/profile/settings/ExperienceManager";
import { LinkedInImport } from "@/components/profile/settings/LinkedInImport";
import { RetiredNotice } from "@/components/profile/settings/RetiredNotice";

export const metadata: Metadata = { title: "Settings · Experience" };

export default async function ExperienceSettingsPage() {
  const user = await requireUser("/settings/experience");
  if (user.status === "ALUMNI") {
    const g = await db.user.findUnique({ where: { id: user.id }, select: { graduatedAt: true } });
    return <RetiredNotice handle={user.handle} graduatedAt={g?.graduatedAt ?? null} what="Your experience" />;
  }
  const rows = await db.experience.findMany({ where: { userId: user.id }, orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { startDate: "desc" }] });
  // Same duplicate rule the import uses (title + company + start month).
  const existingKeys = rows.map((r) => {
    const [y, m] = toMonthInput(r.startDate).split("-").map(Number);
    return positionKey({ title: r.title, company: r.organization, startedOn: { year: y, month: m } });
  });
  return (
    <div className="space-y-6">
      <Callout tone="info" icon={<Info />}>
        Your club roles appear on your profile automatically, from each club&apos;s org chart — you don&apos;t add them here. Add things you did in a role (projects, files) from{" "}
        <Link href="/settings/projects" className="font-medium underline underline-offset-2">
          Projects
        </Link>
        .
      </Callout>
      <ExperienceManager rows={rows} />
      <LinkedInImport existingKeys={existingKeys} />
    </div>
  );
}
