import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { isAdmin } from "@/lib/authz";
import type { StarterPrompt } from "@/lib/ai/types";

/**
 * Suggested first messages, tailored to who's asking: WSUSA admins, club
 * leaders, founders and advisors get prompts for their work; everyone gets a
 * student prompt or two. At most four.
 */
export async function starterPrompts(actor: Actor): Promise<StarterPrompt[]> {
  const roles = await db.roleAssignment.findMany({
    where: { userId: actor.id, endedAt: null, role: { not: "MEMBER" } },
    select: { role: true, club: { select: { name: true, status: true } } },
    orderBy: { startedAt: "desc" },
  });
  const leading = roles.filter((r) => r.club.status === "APPROVED" && r.role !== "ADVISOR");
  const advising = roles.filter((r) => r.role === "ADVISOR" && r.club.status === "APPROVED");
  const founding = roles.filter((r) => r.club.status === "DRAFT" || r.club.status === "CHANGES_REQUESTED" || r.club.status === "SUBMITTED");
  const out: StarterPrompt[] = [];
  const add = (label: string, prompt = label) => {
    if (out.length < 4 && !out.some((p) => p.label === label)) out.push({ label, prompt });
  };

  if (isAdmin(actor)) {
    add("Which clubs are at risk this term?");
    add("What's waiting on me?", "What's waiting on me in my tasks?");
    add("Explain WSUSA requirements", "How do WSUSA requirements and grace periods work?");
  }
  if (founding.length) {
    const club = founding[0].club;
    add(`What's left for ${club.name}?`, `What's left before ${club.name} can be submitted to WSUSA?`);
  }
  if (leading.length) {
    const club = leading[0].club.name;
    add("Plan a weekly meeting for my club", `Help me plan a weekly meeting for ${club} for the rest of this term.`);
    add(`What can I do in ${club}?`, `What am I allowed to do in ${club}?`);
  }
  if (advising.length) {
    const club = advising[0].club.name;
    add(`How is ${club} doing?`, `How is ${club} doing — is it active, and how's attendance?`);
  }
  if (actor.kind === "STUDENT") {
    add("Find clubs about AI");
    if (!founding.length) add("Help me start a club");
    add("What's on my calendar this week?");
    add("How do reviews work?");
  } else {
    if (!advising.length) add("How do I become an advisor?", "How do I become a club advisor?");
    add("Find clubs about AI");
    add("Help me start a club");
  }
  return out;
}
