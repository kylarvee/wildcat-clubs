import "server-only";
import { notFound } from "next/navigation";
import type { Actor } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/session";
import { adminScope, can } from "@/lib/authz";
import { listOffices } from "@/lib/offices";
import { universityScope, type TestScope } from "@/components/tests/scope";

/** University tests: admin.tests (WSUSA's admins, and an office's staff for their office's own tests). */
export async function requireTestAdmin(returnTo: string) {
  const user = await requireUser(returnTo);
  if (!can(user, "admin.tests")) notFound();
  return user;
}

/** The university tests this person manages: every office's for WSUSA's admins, else their own office's (Test.officeId). */
export async function testScopeFor(user: Actor): Promise<TestScope> {
  const s = adminScope(user);
  if (s.all) return universityScope();
  const offices = (await listOffices()).filter((o) => s.officeIds.includes(o.id));
  return universityScope({ officeIds: offices.map((o) => o.id), ownerName: offices.length === 1 ? offices[0].name : "your offices" });
}
