import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";

/** University tests are WSUSA's: admin.tests (admins and sysadmins). */
export async function requireTestAdmin(returnTo: string) {
  const user = await requireUser(returnTo);
  if (!can(user, "admin.tests")) notFound();
  return user;
}
