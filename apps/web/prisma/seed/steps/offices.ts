import type { Prisma } from "@prisma/client";
import { OFFICE_KEYS, officeKeyForClub, routeAdminTask, storedOfficeId, UMBRELLA_DEFAULTS } from "@/lib/offices/rules";
import { gapNotice, gapTask, STAFFING_SOURCE, staffingSourceId } from "@/lib/staffing/rules";
import type { Assignment, ClubM, Ctx, SeedOffice } from "../ctx";
import type { ClubDef } from "../data/clubs";
import { addDays, addHours, addMin } from "../lib/dates";
import { replanRequirements } from "../lib/requirements";

/**
 * The offices that oversee clubs (lib/offices), built first so every later
 * step can route by them: WSUSA (the umbrella), Campus Recreation (club
 * sports, decides their funding) and Fraternity & Sorority Life (Greek
 * chapters; their funding goes to WSUSA). Clubs get their office by
 * lib/offices/rules officeKeyForClub; the umbrella is always stored as null.
 *
 * Contacts come only from official public weber.edu pages, checked October
 * 2026; a field that isn't published there is left null.
 *  - WSUSA: Student Involvement & Leadership's Ogden office, which runs Clubs &
 *    Organizations (lib/offices/rules UMBRELLA_DEFAULTS, from
 *    https://www.weber.edu/studentinvolvement/contact.html).
 *  - Campus Recreation: location, hours, email and phone from
 *    https://www.weber.edu/campusrecreation/ ("Wildcat Center (Ogden): Room
 *    101", "Monday - Friday: 9 a.m. - 6 p.m.", campusrecreation@weber.edu,
 *    801-626-7967). Sport Clubs' own block, https://www.weber.edu/sportclubs/,
 *    gives Wildcat Center 102B and the same phone, with no hours or office email.
 *  - Fraternity & Sorority Life: weber.edu publishes no FSL office of its own.
 *    https://www.weber.edu/dean-of-students/hazing.html says to reach "Student
 *    Involvement and Leadership or Fraternity & Sorority Life at 801-626-6349
 *    or visit Shepherd Union 326", so those two. No hours are published for
 *    FSL, and the only email on https://www.weber.edu/fsl/ is the student
 *    council's (fslc@weber.edu), not an office's, so both stay null.
 * Review times aren't published anywhere: they're the platform's estimate.
 */
export function buildOffices(ctx: Ctx) {
  const offices: Omit<SeedOffice, "id">[] = [
    {
      key: OFFICE_KEYS.umbrella,
      name: UMBRELLA_DEFAULTS.name,
      shortName: UMBRELLA_DEFAULTS.shortName,
      umbrella: true,
      decidesFunding: true,
      location: UMBRELLA_DEFAULTS.location,
      hours: UMBRELLA_DEFAULTS.hours,
      email: UMBRELLA_DEFAULTS.email,
      phone: UMBRELLA_DEFAULTS.phone,
      reviewDays: UMBRELLA_DEFAULTS.reviewDays,
    },
    {
      key: OFFICE_KEYS.campusRec,
      name: "Campus Recreation",
      shortName: "Campus Rec",
      umbrella: false,
      decidesFunding: true,
      location: "Wildcat Center, Room 101",
      hours: "Monday–Friday, 9 a.m.–6 p.m.",
      email: "campusrecreation@weber.edu",
      phone: "801-626-7967",
      reviewDays: 10,
    },
    {
      key: OFFICE_KEYS.fsl,
      name: "Fraternity & Sorority Life",
      shortName: "FSL",
      umbrella: false,
      decidesFunding: false,
      location: "Shepherd Union, Room 326",
      hours: null,
      email: null,
      phone: "801-626-6349",
      reviewDays: 10,
    },
  ];
  for (const o of offices) ctx.offices.set(o.key, { id: ctx.id(), ...o });
}

/** The stored officeId for a club definition (null = WSUSA): club sports to Campus Recreation, FSL chapters to FSL. */
export function officeIdForDef(ctx: Ctx, def: Pick<ClubDef, "scope" | "category">): string | null {
  return storedOfficeId(ctx.offices.get(officeKeyForClub({ scope: def.scope, category: def.category })));
}

/** A club's office as a SeedOffice (the umbrella for null). */
export function officeOf(ctx: Ctx, club: Pick<ClubM, "officeId">): SeedOffice {
  const all = [...ctx.offices.values()];
  return all.find((o) => o.id === club.officeId) ?? all.find((o) => o.umbrella)!;
}

/** Office rows for insertAll. */
export function officeRows(ctx: Ctx): Prisma.OfficeCreateManyInput[] {
  return [...ctx.offices.values()].map((o) => ({ ...o, createdAt: new Date("2022-08-01T16:00:00Z"), updatedAt: new Date("2022-08-01T16:00:00Z") }));
}

/**
 * The officeId to store on a seeded task, by the platform's own rule
 * (lib/offices/rules routeAdminTask, what lib/domain/tasks createTask does):
 * ADMINS tasks about a club go to its office, except platform-wide work and
 * funding (to the club's office only when it decides funding). A task that
 * already says (a test's office, say) keeps it.
 */
export function seededTaskOfficeId(ctx: Ctx, t: Prisma.TaskCreateManyInput): string | null {
  if (t.officeId !== undefined) return t.officeId ?? null;
  if (t.assigneeType !== "ADMINS" || !t.clubId) return null;
  const club = ctx.clubById.get(t.clubId);
  if (!club?.officeId) return null;
  return routeAdminTask(t.sourceType ?? null, { officeId: club.officeId, decidesFunding: officeOf(ctx, club).decidesFunding });
}

/** One email as lib/integrations records it in mock mode (the inbox step's outbox rows). */
function mailed(ctx: Ctx, m: { to: string; kind: string; subject: string; body: string; href: string; at: Date }) {
  ctx.rows.outbox.push({ id: ctx.id(), channel: "EMAIL", to: m.to, subject: m.subject, body: m.body, href: m.href, status: "MOCKED", error: null, kind: m.kind, createdAt: m.at, sentAt: m.at });
}

/**
 * Rowan's queue at Campus Recreation, for the clubs it oversees:
 *  - a sport club whose President stepped down two days ago, recorded as
 *    lib/domain/staffing does (the APPROVAL task routes to Campus Rec; the
 *    remaining leaders get the notice, and Campus Rec's staff get the task's
 *    wording, by email too since staffing gaps always send). WSUSA's own
 *    staffing story (steps/inbox) is a WSUSA club, so Alex's default queue
 *    keeps one and Rowan's gets this one;
 *  - Rowan's bell for the Hiking and Outdoors Club's funding request
 *    (steps/money), which Campus Rec decides and which is past its review time.
 * The sport clubs that haven't re-registered (steps/renewals) are on Rowan's
 * Renewals tab. Runs after the inbox, before anything is written.
 */
export function buildOfficeStories(ctx: Ctx) {
  const { NOW } = ctx;
  const rec = ctx.offices.get(OFFICE_KEYS.campusRec)!;
  const rowan = ctx.p("rowan");
  const activeAt = (a: Assignment) => a.startedAt <= NOW && (!a.endedAt || a.endedAt > NOW);
  const size = (c: ClubM) => c.members.filter((m) => m.status === "ACTIVE").length;
  const flagged = new Set(ctx.rows.tasks.filter((t) => t.sourceType === STAFFING_SOURCE && t.status === "OPEN").map((t) => t.clubId));

  // A sport club anyone can join (so no join request goes unapproved), with one President who isn't a persona, an
  // advisor and another officer: the smallest with six or more members, Cornhole Club in today's data. Whether that
  // President also leads another club changes with the day the seed runs, so it isn't a condition: what they owed
  // through the seat follows it either way (replanRequirements).
  const candidates = ctx.clubs
    .filter((c) => c.officeId === rec.id && c.status === "APPROVED" && c.def.life !== "dormant" && (c.def.joinPolicy ?? "OPEN") === "OPEN" && !flagged.has(c.id))
    .map((club) => {
      const now = club.assignments.filter(activeAt);
      const presidents = now.filter((a) => a.role === "PRESIDENT");
      return { club, now, president: presidents.length === 1 ? presidents[0] : null };
    })
    .filter(({ now, president }) => president && !ctx.person(president.userId).persona && now.some((a) => a.role === "ADVISOR") && now.some((a) => a.role === "VP" || a.role === "OFFICER"))
    .sort((a, b) => size(a.club) - size(b.club) || a.club.name.localeCompare(b.club.name));
  const pick = candidates.find((c) => size(c.club) >= 6) ?? candidates[0];
  if (pick?.president) {
    const { club, president } = pick;
    const advisorId = pick.now.find((a) => a.role === "ADVISOR")!.userId;
    const endedAt = addDays(NOW, -2.2);
    president.endedAt = endedAt;
    president.endReason = "RESIGNED";
    ctx.activity({ at: endedAt, actorId: president.userId, action: "role.ended", entityType: "roleAssignment", entityId: president.id, clubId: club.id, data: { userId: president.userId, role: "PRESIDENT", reason: "RESIGNED" }, isPublic: true });
    // What they owed through the seat follows it (domain/roles → requirements reopenRequirementTasks).
    replanRequirements(ctx, president, endedAt);

    const flaggedAt = addMin(endedAt, 1);
    const story = { club: { name: club.name, slug: club.slug, type: club.type }, gap: "president" as const, leftName: ctx.person(president.userId).name, hasAdvisor: true, office: rec.name };
    const task = gapTask(story);
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: task.title, description: task.description, assigneeType: "ADMINS", clubId: club.id, href: task.href,
      status: "OPEN", sourceType: STAFFING_SOURCE, sourceId: staffingSourceId(club.id, "president"), createdById: president.userId, createdAt: flaggedAt,
    });
    ctx.activity({ at: flaggedAt, actorId: null, action: "staffing.gap_flagged", entityType: "club", entityId: club.id, clubId: club.id, data: { gap: "president" } });
    const notice = gapNotice(story);
    const told = [...new Set(pick.now.filter((a) => a !== president && a.role !== "MEMBER").map((a) => a.userId))];
    for (const userId of told) {
      ctx.rows.notifications.push({ id: ctx.id(), userId, kind: "staffing.gap", title: notice.title, body: notice.body, href: notice.href, createdAt: flaggedAt, readAt: userId === advisorId ? addHours(flaggedAt, 5) : null });
      mailed(ctx, { to: ctx.person(userId).email, kind: "staffing.gap", subject: notice.title, body: notice.body, href: notice.href, at: flaggedAt });
    }
    // Campus Rec has staff, so its staff hear, not WSUSA's admins (lib/offices notifyOffice).
    ctx.rows.notifications.push({ id: ctx.id(), userId: rowan.id, kind: "staffing.gap", title: task.title, body: task.description, href: task.href, createdAt: flaggedAt, readAt: null });
    mailed(ctx, { to: rowan.email, kind: "staffing.gap", subject: task.title, body: task.description, href: task.href, at: flaggedAt });
    ctx.refs.officeStaffingClub = club.name;
  }

  // The funding request Campus Rec decides (steps/money): Rowan's bell from when it came in.
  const request = ctx.rows.fundingRequests.find((r) => r.id === ctx.refs.lateReviewRequest);
  const club = request ? ctx.clubById.get(request.clubId) : undefined;
  if (request && club?.officeId === rec.id && request.submittedAt) {
    ctx.rows.notifications.push({
      id: ctx.id(), userId: rowan.id, kind: "funding.submitted", title: `Funding request: ${club.name} — ${request.title}`, body: null,
      href: `/admin/funding/${request.id}`, createdAt: new Date(request.submittedAt as Date), readAt: addHours(new Date(request.submittedAt as Date), 20),
    });
  }
}
