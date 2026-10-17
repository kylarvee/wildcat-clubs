import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { myProjects, myRoleOptions } from "@/lib/profiles/queries";
import { ProjectManager } from "@/components/profile/settings/ProjectManager";
import { RetiredNotice } from "@/components/profile/settings/RetiredNotice";

export const metadata: Metadata = { title: "Settings · Projects" };

export default async function ProjectSettingsPage() {
  const user = await requireUser("/settings/projects");
  if (user.status === "ALUMNI") {
    const g = await db.user.findUnique({ where: { id: user.id }, select: { graduatedAt: true } });
    return <RetiredNotice handle={user.handle} graduatedAt={g?.graduatedAt ?? null} what="Your projects list" />;
  }
  const [projects, roles] = await Promise.all([myProjects(user.id), myRoleOptions(user.id)]);
  return <ProjectManager projects={projects} roles={roles} />;
}
