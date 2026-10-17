import "server-only";
import { ClipboardCheck } from "lucide-react";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { EmptyState } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { clubScope, type TestScope } from "@/components/tests/scope";
import type { Actor } from "@/lib/auth/session";

/**
 * Club tests need the club's "tests" capability (presidents, VPs, advisors,
 * admins, and officers whose seat grants it) and an approved club.
 */
export async function clubTestsAccess(slug: string): Promise<{ ok: true; scope: TestScope; user: Actor } | { ok: false; view: React.ReactNode }> {
  const { user, club, access, allowed } = await loadClubWorkspace(slug, "tests");
  if (club.status !== "APPROVED") {
    return {
      ok: false,
      view: <EmptyState icon={<ClipboardCheck />} title="Club tests open once your club is approved" description="After WSUSA approves the club, you can build quizzes and checks for your members here." />,
    };
  }
  if (!allowed) return { ok: false, view: <NoPermission what="club tests" suspended={access.suspended} /> };
  return { ok: true, scope: clubScope(club), user };
}
