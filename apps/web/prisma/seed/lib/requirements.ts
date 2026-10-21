import type { ClubRole, Prisma } from "@prisma/client";
import { heldCapabilities, periodStartIn, requirementReaches, seatDueAt, type SeatClock, type SeatReach } from "@/lib/authz/requirement-rules";
import { renewalCycle } from "@/lib/tests/cycles";
import type { Assignment, Ctx } from "../ctx";

/** The roles requirements reach people through (lib/domain/requirements REQUIREMENT_ROLES). */
const REQUIREMENT_ROLES: ReadonlySet<ClubRole> = new Set<ClubRole>(["AMBASSADOR", "OFFICER", "VP", "PRESIDENT"]);

/**
 * A leader seat just ended at `at`: its holder's requirement tasks and test
 * assignments as lib/domain/requirements syncUserRequirements leaves them, on
 * the shared rules (lib/authz/requirement-rules). Only a requirement that
 * reached them through that seat can change. If they still owe it through
 * another seat, the task moves to the earliest of those seats' deadlines (and
 * names that seat's club when it's a leader seat), and this cycle's test
 * assignment moves with it. If they owe it nowhere else, the task is
 * cancelled and its test assignment excused.
 */
export function replanRequirements(ctx: Ctx, ended: Assignment, at: Date) {
  const { NOW } = ctx;
  const person = ctx.person(ended.userId);
  const club = ctx.clubById.get(ended.clubId)!;
  const live = (a: Assignment) => a.userId === person.id && REQUIREMENT_ROLES.has(a.role) && a.startedAt <= NOW && (!a.endedAt || a.endedAt > NOW);
  const approved = ctx.clubs.filter((c) => c.status === "APPROVED");
  // Their seats now, in the planner's order: leader roles oldest first, then memberships (students only).
  const roles = approved
    .flatMap((c) => c.assignments.filter(live).map((a) => ({ a, c })))
    .sort((x, y) => x.a.startedAt.getTime() - y.a.startedAt.getTime() || x.a.id.localeCompare(y.a.id));
  const memberships = approved
    .flatMap((c) => c.members.filter((m) => m.userId === person.id && m.status === "ACTIVE").map((m) => ({ c, startedAt: m.joinedAt ?? m.requestedAt })))
    .sort((x, y) => x.startedAt.getTime() - y.startedAt.getTime() || x.c.id.localeCompare(y.c.id));
  type Seat = SeatReach & SeatClock & { clubId: string };
  const seats: Seat[] =
    person.status !== "ACTIVE"
      ? []
      : [
          ...roles.map(({ a, c }) => ({ role: a.role, startedAt: a.startedAt, clubId: c.id, clubApprovedAt: c.approvedAt, clubOfficeId: c.officeId, holds: heldCapabilities(roles.filter((x) => x.c === c).map((x) => x.a)) })),
          ...(person.kind === "STUDENT" ? memberships.map(({ c, startedAt }) => ({ role: "MEMBER" as const, startedAt, clubId: c.id, clubApprovedAt: c.approvedAt, clubOfficeId: c.officeId, holds: null })) : []),
        ];
  const endedSeat: SeatReach = { role: ended.role, clubOfficeId: club.officeId, holds: heldCapabilities([ended, ...club.assignments.filter(live)]) };
  const terms = [...ctx.terms].sort((x, y) => x.startsOn.getTime() - y.startsOn.getTime());

  const owes = (t: Prisma.TaskCreateManyInput) => t.assigneeId === person.id && t.sourceType === "requirement" && t.status === "OPEN";
  const requirementOf = (t: Prisma.TaskCreateManyInput) => ctx.rows.requirements.find((x) => x.id === t.sourceId?.split(":")[0]);
  const assigned = (testId: string) => ctx.rows.testAssignments.filter((a) => a.userId === person.id && a.testId === testId && a.status === "ASSIGNED");
  const dropped = new Set<string>();

  for (const t of ctx.rows.tasks) {
    if (!owes(t)) continue;
    const r = requirementOf(t);
    if (!r || r.active === false) continue;
    const rule = { appliesTo: r.appliesTo as ClubRole[], officeId: r.officeId ?? null, gatesCapability: r.gatesCapability ?? null };
    if (!requirementReaches(rule, endedSeat)) continue;
    const renewal = r.renewal ?? "ACADEMIC_YEAR";
    const periodStart = periodStartIn(renewal, NOW, terms);
    // Due at the earliest deadline among the seats it still reaches them through (the first seat on a tie);
    // it gates permissions when one of those is a leader seat.
    const reaching = seats.filter((s) => requirementReaches(rule, s)).map((s) => ({ s, dueAt: seatDueAt({ graceDays: r.graceDays ?? 0, createdAt: new Date(r.createdAt ?? NOW) }, periodStart, s) }));
    const first = reaching.reduce<(typeof reaching)[number] | null>((best, x) => (!best || x.dueAt < best.dueAt ? x : best), null);
    const want = first && { dueAt: first.dueAt, clubId: first.s.clubId, gates: reaching.some((x) => x.s.role !== "MEMBER") };
    const testId = r.kind === "TEST" ? (r.testId ?? null) : null;
    if (want) {
      Object.assign(t, { dueAt: want.dueAt, clubId: want.gates ? want.clubId : null });
      const cycle = renewalCycle(renewal, NOW, terms).key;
      if (testId) for (const a of assigned(testId)) if (a.cycleKey === cycle) a.dueAt = want.dueAt;
    } else {
      Object.assign(t, { status: "CANCELLED", completedAt: at, completedById: null });
      if (testId) dropped.add(testId);
    }
  }
  // A test they no longer owe is excused, unless a requirement they still owe asks for the same test.
  const stillAsked = new Set(ctx.rows.tasks.filter(owes).map((t) => requirementOf(t)?.testId));
  for (const testId of dropped) if (!stillAsked.has(testId)) for (const a of assigned(testId)) Object.assign(a, { status: "EXCUSED", resolvedAt: at });
}
