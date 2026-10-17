import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { INSTITUTION } from "@/lib/institution";
import { Callout } from "@/components/ui/layout";
import { EducationManager } from "@/components/profile/settings/EducationManager";
import { RetiredNotice } from "@/components/profile/settings/RetiredNotice";

export const metadata: Metadata = { title: "Settings · Education" };

export default async function EducationSettingsPage() {
  const user = await requireUser("/settings/education");
  const [me, rows] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { graduatedAt: true } }),
    db.education.findMany({ where: { userId: user.id }, orderBy: [{ endYear: { sort: "desc", nulls: "first" } }, { startYear: "desc" }] }),
  ]);
  if (user.status === "ALUMNI") return <RetiredNotice handle={user.handle} graduatedAt={me?.graduatedAt ?? null} what="Your education" />;
  return (
    <div className="space-y-6">
      {user.kind === "STUDENT" ? (
        <Callout tone="info" icon={<GraduationCap />}>
          {INSTITUTION.name} is listed on your profile automatically with your majors, minors and class year — set those under{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            Profile
          </Link>
          .
        </Callout>
      ) : null}
      <EducationManager rows={rows} />
    </div>
  );
}
