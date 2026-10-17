import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";

/** Officer requirements are managed by whoever runs tests or trainings (admins). */
export async function requireRequirementAdmin(returnTo: string) {
  const user = await requireUser(returnTo);
  if (!can(user, "admin.tests") && !can(user, "admin.trainings")) notFound();
  return user;
}
