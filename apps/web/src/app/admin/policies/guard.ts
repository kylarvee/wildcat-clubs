import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";

export async function requirePolicyAdmin(returnTo: string) {
  const user = await requireUser(returnTo);
  if (!can(user, "admin.policies")) notFound();
  return user;
}
