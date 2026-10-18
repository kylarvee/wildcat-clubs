import type { Prisma, PrismaClient } from "@prisma/client";
import { seatsFor } from "@/lib/roles/defaults";
import type { ClubM, Ctx } from "./ctx";
import { allEvents } from "./steps/events";
import type { RefRows } from "./steps/reference";
import type { UserRows } from "./steps/people";

/**
 * Writes everything the steps built, parents before children, in batches.
 */

const BATCH = 4000;
/** Batches written at once. Tables whose rows point at each other (FileItem folders) go one batch at a time. */
const PARALLEL = 4;
const SEQUENTIAL = new Set(["FileItem"]);

export async function insertMany<T>(label: string, rows: T[], write: (batch: T[]) => Promise<unknown>, log: (s: string) => void) {
  const t0 = Date.now();
  try {
    const batches: T[][] = [];
    for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
    const n = SEQUENTIAL.has(label) ? 1 : PARALLEL;
    for (let i = 0; i < batches.length; i += n) await Promise.all(batches.slice(i, i + n).map((b) => write(b)));
  } catch (e) {
    log(`  ✗ ${label}: ${rows.length} rows failed`);
    throw e;
  }
  if (process.env.SEED_VERBOSE) log(`  ${label.padEnd(22)} ${String(rows.length).padStart(7)} ${String(Date.now() - t0).padStart(6)} ms`);
}

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export function clubDescription(ctx: Ctx, club: ClubM): string | null {
  const d = club.def;
  // Real clubs: their own purpose statement from the WSU club list, nothing added.
  if (d.dir) return d.aboutHtml;
  if (d.life === "draft") return `<p>${d.about}</p>`;
  const [H, M] = d.meeting.time;
  const time = `${H % 12 === 0 ? 12 : H % 12}:${String(M).padStart(2, "0")} ${H < 12 ? "AM" : "PM"}`;
  const b = ctx.buildings.get(d.meeting.building);
  const when = `${DAYS[d.meeting.dow]} at ${time} in ${b?.name ?? "the Shepherd Union"}, ${d.meeting.room}${d.meeting.interval === 2 ? " — every other week" : " — every week"} during fall and spring semesters. The calendar always has the latest.`;
  const join = d.join ?? "Every Weber State student is welcome — register on this page or just check in at a meeting.";
  return [
    `<h2>About ${d.name}</h2>`,
    `<p>${d.about}</p>`,
    d.does.length ? `<h3>What we do</h3><ul>${d.does.map((x) => `<li>${x}</li>`).join("")}</ul>` : "",
    `<h3>Who can join</h3><p>${join}</p>`,
    `<h3>When we meet</h3><p>${when}</p>`,
  ].join("");
}

export async function insertAll(db: PrismaClient, ctx: Ctx, ref: RefRows, users: UserRows, log: (s: string) => void) {
  const r = ctx.rows;
  await insertMany("College", ref.colleges, (d) => db.college.createMany({ data: d }), log);
  await insertMany("Department", ref.departments, (d) => db.department.createMany({ data: d }), log);
  await insertMany("Major", ref.majors, (d) => db.major.createMany({ data: d }), log);
  await insertMany("Building", ref.buildings, (d) => db.building.createMany({ data: d }), log);
  await insertMany("Term", ref.terms, (d) => db.term.createMany({ data: d }), log);
  await insertMany("User", [...users.values()], (d) => db.user.createMany({ data: d }), log);
  await insertMany("PersonalDetails", r.personalDetails, (d) => db.personalDetails.createMany({ data: d }), log);
  await insertMany("UserMajor", r.userMajors, (d) => db.userMajor.createMany({ data: d }), log);
  await insertMany("Experience", r.experiences, (d) => db.experience.createMany({ data: d }), log);
  await insertMany("Education", r.educations, (d) => db.education.createMany({ data: d }), log);

  const clubs: Prisma.ClubCreateManyInput[] = ctx.clubs.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    type: c.type,
    status: c.status,
    scope: c.scope,
    collegeId: c.collegeId,
    departmentId: c.departmentId,
    requestedDepartmentName: c.def.requestedDepartmentName ?? null,
    focusMajorId: c.focusMajorId,
    focusOther: c.def.focusOther ?? null,
    shortDescription: c.def.short,
    descriptionHtml: clubDescription(ctx, c),
    logoColor: c.def.color,
    contactEmail: c.def.contactEmail,
    category: c.def.category,
    websiteUrl: null,
    socialLinks: [],
    joinPolicy: c.def.joinPolicy ?? "OPEN",
    successionMethod: c.def.succession ?? "ADVISOR_PRESIDENT",
    autoApproveCohosts: Boolean(c.def.autoApproveCohosts),
    createdById: c.founderId,
    createdAt: c.createdAt,
    submittedAt: c.def.life === "draft" ? null : c.submittedAt,
    approvedAt: c.approvedAt,
    retiredAt: c.retiredAt,
    retiredReason: c.def.retired?.reason ?? null,
  }));
  await insertMany("Club", clubs, (d) => db.club.createMany({ data: d }), log);

  const positions: Prisma.PositionCreateManyInput[] = ctx.clubs.flatMap((c) =>
    seatsFor(c.type).map((s, i) => ({
      id: c.seats.get(s.name)!.id,
      clubId: c.id,
      role: s.role,
      name: s.name,
      responsibilities: s.responsibilities,
      defaultPermissions: [...s.defaultPermissions],
      maxHolders: s.maxHolders,
      sortOrder: i,
      isCore: Boolean(s.isCore),
      createdAt: c.createdAt, // seats exist from founding, so role history can measure vacancies
    })),
  );
  await insertMany("Position", positions, (d) => db.position.createMany({ data: d }), log);
  await insertMany("ClubDecision", r.decisions, (d) => db.clubDecision.createMany({ data: d }), log);
  await insertMany("AdvisorInvite", r.invites, (d) => db.advisorInvite.createMany({ data: d }), log);
  await insertMany("ConstitutionDraft", r.drafts, (d) => db.constitutionDraft.createMany({ data: d }), log);
  // Folders before their contents.
  const files = [...r.files].sort((a, b) => Number(Boolean(b.isFolder)) - Number(Boolean(a.isFolder)));
  await insertMany("FileItem", files, (d) => db.fileItem.createMany({ data: d }), log);
  await insertMany("ClubDocument", r.documents, (d) => db.clubDocument.createMany({ data: d }), log);

  const memberships: Prisma.MembershipCreateManyInput[] = ctx.clubs.flatMap((c) =>
    c.members.map((m) => ({
      id: m.id, userId: m.userId, clubId: m.clubId, status: m.status, source: m.source, internalTitle: m.internalTitle,
      requestedAt: m.requestedAt, joinedAt: m.joinedAt, endedAt: m.endedAt,
    })),
  );
  await insertMany("Membership", memberships, (d) => db.membership.createMany({ data: d }), log);

  const assignments: Prisma.RoleAssignmentCreateManyInput[] = ctx.clubs.flatMap((c) =>
    c.assignments.map((a) => ({
      id: a.id, clubId: a.clubId, userId: a.userId, positionId: a.positionId, role: a.role, permissions: a.permissions, viaClubId: a.viaClubId,
      startedAt: a.startedAt, endedAt: a.endedAt, endReason: a.endReason, assignedById: a.assignedById,
    })),
  );
  await insertMany("RoleAssignment", assignments, (d) => db.roleAssignment.createMany({ data: d }), log);
  await insertMany("Project", r.projects, (d) => db.project.createMany({ data: d }), log);
  await insertMany("ProjectFile", r.projectFiles, (d) => db.projectFile.createMany({ data: d }), log);

  const evs = allEvents(ctx);
  const events: Prisma.EventCreateManyInput[] = evs.map((e) => ({
    id: e.id, clubId: e.clubId, title: e.title, descriptionHtml: e.descriptionHtml, kind: e.kind, status: e.status, visibility: e.visibility,
    startsAt: e.startsAt, durationMinutes: e.durationMinutes, recurrence: e.recurrence, recurrenceInterval: e.recurrenceInterval,
    recurrenceWeekdays: e.recurrenceWeekdays, recurrenceUntil: e.recurrenceUntil, locationType: e.locationType, buildingId: e.buildingId,
    room: e.room, address: e.address, lat: e.locationType === "CAMPUS" || e.locationType === "ADDRESS" ? e.lat : null,
    lng: e.locationType === "CAMPUS" || e.locationType === "ADDRESS" ? e.lng : null, virtualUrl: e.virtualUrl,
    allowSelfCheckIn: e.allowSelfCheckIn, createdById: e.createdById, createdAt: e.createdAt, updatedAt: e.createdAt,
  }));
  await insertMany("Event", events, (d) => db.event.createMany({ data: d }), log);
  const occs: Prisma.EventOccurrenceCreateManyInput[] = evs.flatMap((e) =>
    e.occurrences.map((o) => ({
      id: o.id, eventId: o.eventId, startsAt: o.startsAt, endsAt: o.endsAt, status: o.status, roomOverride: o.roomOverride, note: o.note,
      checkinCode: o.checkinCode, checkinSecret: o.checkinSecret,
    })),
  );
  await insertMany("EventOccurrence", occs, (d) => db.eventOccurrence.createMany({ data: d }), log);
  const cohosts: Prisma.EventCohostCreateManyInput[] = evs.flatMap((e) =>
    e.cohosts.map((c) => ({
      id: c.id, eventId: e.id, clubId: c.clubId, status: c.status, requestedById: c.requestedById, decidedById: c.decidedById, createdAt: c.createdAt, decidedAt: c.decidedAt,
    })),
  );
  await insertMany("EventCohost", cohosts, (d) => db.eventCohost.createMany({ data: d }), log);
  await insertMany("EventAttachment", r.attachments, (d) => db.eventAttachment.createMany({ data: d }), log);
  await insertMany("CalendarSubscription", r.subscriptions, (d) => db.calendarSubscription.createMany({ data: d }), log);
  const attendance: Prisma.AttendanceCreateManyInput[] = evs.flatMap((e) =>
    e.occurrences.flatMap((o) =>
      [...o.attendees.entries()].map(([userId, a]) => ({
        id: a.id, occurrenceId: o.id, userId, clubId: e.clubId, method: a.method, checkedInAt: a.at, recordedById: a.recordedById,
      })),
    ),
  );
  await insertMany("Attendance", attendance, (d) => db.attendance.createMany({ data: d }), log);
  await insertMany("Review", r.reviews, (d) => db.review.createMany({ data: d }), log);
  await insertMany("ReviewFlag", r.reviewFlags, (d) => db.reviewFlag.createMany({ data: d }), log);
  await insertMany("BudgetItem", r.budgetItems, (d) => db.budgetItem.createMany({ data: d }), log);
  await insertMany("FundingRequest", r.fundingRequests, (d) => db.fundingRequest.createMany({ data: d }), log);
  await insertMany("FundingRequestItem", r.fundingItems, (d) => db.fundingRequestItem.createMany({ data: d }), log);
  await insertMany("Invoice", r.invoices, (d) => db.invoice.createMany({ data: d }), log);
  await insertMany("Conversation", r.conversations, (d) => db.conversation.createMany({ data: d }), log);
  await insertMany("ConversationMember", r.conversationMembers, (d) => db.conversationMember.createMany({ data: d }), log);
  await insertMany("Message", r.messages, (d) => db.message.createMany({ data: d }), log);
  await insertMany("Announcement", r.announcements, (d) => db.announcement.createMany({ data: d }), log);
  await insertMany("Policy", r.policies, (d) => db.policy.createMany({ data: d }), log);
  await insertMany("Test", r.tests, (d) => db.test.createMany({ data: d }), log);
  await insertMany("TestQuestion", r.questions, (d) => db.testQuestion.createMany({ data: d }), log);
  await insertMany("RoleRequirement", r.requirements, (d) => db.roleRequirement.createMany({ data: d }), log);
  await insertMany("TestAssignment", r.testAssignments, (d) => db.testAssignment.createMany({ data: d }), log);
  await insertMany("TestAttempt", r.attempts, (d) => db.testAttempt.createMany({ data: d }), log);
  await insertMany("TestAnswer", r.answers, (d) => db.testAnswer.createMany({ data: d }), log);
  await insertMany("Election", r.elections, (d) => db.election.createMany({ data: d }), log);
  await insertMany("ElectionCandidate", r.candidates, (d) => db.electionCandidate.createMany({ data: d }), log);
  await insertMany("Vote", r.votes, (d) => db.vote.createMany({ data: d }), log);
  await insertMany("Complaint", r.complaints, (d) => db.complaint.createMany({ data: d }), log);
  await insertMany("ComplaintNote", r.complaintNotes, (d) => db.complaintNote.createMany({ data: d }), log);
  await insertMany("ComplaintAccessLog", r.complaintAccess, (d) => db.complaintAccessLog.createMany({ data: d }), log);
  await insertMany("Task", r.tasks, (d) => db.task.createMany({ data: d }), log);
  await insertMany("Notification", r.notifications, (d) => db.notification.createMany({ data: d }), log);
  await insertMany("OutboxMessage", r.outbox, (d) => db.outboxMessage.createMany({ data: d }), log);
  const activity = [...r.activity].sort((a, b) => new Date(a.at as Date).getTime() - new Date(b.at as Date).getTime());
  await insertMany("ActivityLog", activity, (d) => db.activityLog.createMany({ data: d }), log);
}
