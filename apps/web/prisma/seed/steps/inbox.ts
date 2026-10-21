import type { Prisma } from "@prisma/client";
import type { Assignment, ClubM, Ctx } from "../ctx";
import { addDays, addHours, addMin, minDate } from "../lib/dates";
import { replanRequirements } from "../lib/requirements";
import { gapNotice, gapTask, ORPHAN_REQUESTS_SOURCE, orphanRequestsTask, STAFFING_SOURCE, staffingSourceId } from "@/lib/staffing/rules";
import { addMember } from "./clubs";
import { allEvents } from "./events";
import type { Ev } from "../ctx";
import { placeOf, roomNotice } from "@/lib/events/notices";
import { reviewUnlockedNotice, startingSoonNotice } from "@/lib/jobs/reminder-rules";
import { fmtMoney } from "@/lib/time";
import { digestOn, resolveDelivery, type NotificationPrefs } from "@/components/notifications/catalog";
import type { UserRows } from "./people";

/**
 * Everything that's waiting on someone: approval tasks (join requests,
 * co-hosts, advisor invites, club and document reviews, department requests),
 * personal and club to-dos, complaints, each persona's notifications and
 * notification choices, the email outbox (mocked sends, and a big send still
 * waiting to go out), the activity stream, and WSUSA's staffing story (a
 * club that just lost its President, and join requests nobody can approve).
 */

// ─── Notification choices and the outbox ─────────────────────────────────────

/**
 * Settings → Notifications choices (User.notificationPrefs, read by the
 * registry in components/notifications/catalog). Everyone else keeps the
 * defaults; Maya does too, so a tester can flip one and watch it.
 */
const PERSONA_PREFS: Record<string, NotificationPrefs> = {
  // Co-host requests and cancellations reach her bell and phone; she handles them in the Events Builder.
  priya: { events: { email: false } },
  // Two clubs' announcements: she reads them on the bell.
  elena: { announcements: { email: false } },
  // A system administrator who'd rather hear about each submission than read the morning digest.
  sydney: { adminDigest: { email: false } },
};

function notificationPrefs(ctx: Ctx, users: UserRows): Map<string, NotificationPrefs> {
  const out = new Map<string, NotificationPrefs>();
  for (const [key, prefs] of Object.entries(PERSONA_PREFS)) {
    const id = ctx.p(key).id;
    users.get(id)!.notificationPrefs = prefs as Prisma.InputJsonObject;
    out.set(id, prefs);
  }
  return out;
}

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/** One outbox row as lib/integrations records it: sent rows have sentAt; QUEUED rows wait for the "Send queued messages" job. */
function outboxRow(
  ctx: Ctx,
  m: { to: string; subject: string; body: string; href: string | null; kind: string | null; at: Date; channel?: "EMAIL" | "PUSH"; status?: "MOCKED" | "QUEUED" | "FAILED"; error?: string },
) {
  const status = m.status ?? "MOCKED";
  ctx.rows.outbox.push({ id: ctx.id(), channel: m.channel ?? "EMAIL", to: m.to, subject: m.subject, body: m.body, href: m.href, status, error: m.error ?? null, kind: m.kind, createdAt: m.at, sentAt: status === "QUEUED" ? null : m.at });
}

function caseCode(ctx: Ctx) {
  return `WC-${ctx.rng.string("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4)}-${ctx.rng.int(10, 99)}`;
}

function complaints(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const alex = ctx.p("alex").id;
  const jordan = ctx.refs["admin:jordan"];
  const student = (clubKey?: string) => {
    const pool = ctx.people.filter((p) => p.kind === "STUDENT" && p.status === "ACTIVE" && !p.persona && (!clubKey || ctx.club(clubKey).byUser.get(p.id)?.status === "ACTIVE"));
    return rng.pick(pool).id;
  };
  const list: { anon: boolean; reporter: string | null; clubKey: string | null; category: string; subject: string; body: string; status: "NEW" | "IN_REVIEW" | "REFERRED" | "RESOLVED"; daysAgo: number; incidentDaysAgo: number; notes: [number, string][] }[] = [
    {
      anon: true, reporter: null, clubKey: "discgolf", category: "Hazing", status: "NEW", daysAgo: 1.3, incidentDaysAgo: 4,
      subject: "Pressure on new members before the season-opener tournament",
      body: "New members were told they had to do a 'polar plunge' in Pineview Reservoir to get a spot on the first tournament team. A couple of people felt like they couldn't say no. I don't want my name on this because I still want to play.",
      notes: [],
    },
    {
      anon: true, reporter: null, clubKey: "discgolf", category: "Misuse of funds", status: "IN_REVIEW", daysAgo: 9.4, incidentDaysAgo: 20,
      subject: "Club money used for an officers-only dinner",
      body: "The receipts for the 'league kickoff night' were actually a dinner for four officers at a restaurant on 25th Street. No members were invited.",
      notes: [[7.9, "Requested the event's budget items and receipts from the treasurer through the Budget tool. Not sharing the report itself."], [3.2, "Receipts show 4 meals. Scheduling a conversation with the advisor about reimbursing the club."]],
    },
    {
      anon: false, reporter: "paintball", clubKey: "paintball", category: "Harassment", status: "REFERRED", daysAgo: 30.2, incidentDaysAgo: 33,
      subject: "Repeated comments in the club chat",
      body: "Another member keeps making comments about my appearance in the club chat and in DMs after I asked them to stop. Screenshots available.",
      notes: [[29.1, "Spoke with the reporter. They'd like this referred."], [27.5, "Referred to the Title IX office per WSU policy. Club officers asked to moderate the chat."]],
    },
    {
      anon: false, reporter: "paintball", clubKey: "paintball", category: "Event safety", status: "RESOLVED", daysAgo: 55, incidentDaysAgo: 57,
      subject: "Players without masks near the field during a scenario game",
      body: "During the club's scenario game, spectators and players were walking around next to the field without masks, and nobody was checking at the gate.",
      notes: [[53, "Met with the club's president and advisor. They'll staff the gate at every game and keep spectators behind the netting."], [40, "Followed up after the next game — gate staffed, masks checked. Resolving."]],
    },
    {
      anon: false, reporter: null, clubKey: "paintball", category: "Discrimination", status: "NEW", daysAgo: 0.6, incidentDaysAgo: 10,
      subject: "Join request declined without a reason",
      body: "My request to join was declined and nobody would tell me why. My field waiver is on file. I'm worried it's because I'm an older, returning student.",
      notes: [],
    },
  ];
  for (const c of list) {
    const id = ctx.id();
    const createdAt = addDays(NOW, -c.daysAgo);
    const reporterId = c.anon ? null : c.reporter ? student(c.reporter) : student();
    ctx.rows.complaints.push({
      id, caseCode: caseCode(ctx), isAnonymous: c.anon, reporterId, category: c.category, subject: c.subject, body: c.body,
      clubId: c.clubKey ? ctx.club(c.clubKey).id : null, incidentDate: addDays(NOW, -c.incidentDaysAgo), status: c.status, createdAt,
      updatedAt: c.notes.length ? addDays(NOW, -c.notes[c.notes.length - 1][0]) : createdAt,
    });
    for (const [d, body] of c.notes) ctx.rows.complaintNotes.push({ id: ctx.id(), complaintId: id, authorId: alex, body, createdAt: addDays(NOW, -d) });
    // One WSUSA task per report, with no content (domain/complaints); it closes once the report leaves New.
    const touched = c.notes.length ? addDays(NOW, -c.notes[0][0]) : addHours(createdAt, 3);
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: "A new report is waiting", description: "Open it in Reports. Report details never appear in tasks, notifications or email.",
      assigneeType: "ADMINS", href: `/admin/complaints?open=${id}`, status: c.status === "NEW" ? "OPEN" : "DONE", sourceType: "complaint", sourceId: id, createdAt,
      completedAt: c.status === "NEW" ? null : touched, completedById: c.status === "NEW" ? null : alex,
    });
    // Every opening is logged; anonymous ones also record the acknowledged notice.
    const opens = c.status === "NEW" ? (c.anon ? 0 : 1) : rng.int(2, 5);
    for (let i = 0; i < opens; i++) {
      ctx.rows.complaintAccess.push({ id: ctx.id(), complaintId: id, adminId: rng.chance(0.75) ? alex : jordan, acknowledgedAnonymity: c.anon, at: minDate(addHours(createdAt, 2 + i * rng.float(5, 60)), NOW) });
    }
    if (reporterId) {
      ctx.rows.notifications.push({ id: ctx.id(), userId: reporterId, kind: "complaint.received", title: "We received your report", body: "WSUSA administrators will review it. You can check its status any time from Report a concern.", href: "/report", createdAt: addMin(createdAt, 1), readAt: addMin(createdAt, 10) });
    }
  }
  // New reports notify admins without any content (anonymous reports never appear in notifications).
  for (const admin of ctx.admins) {
    ctx.rows.notifications.push({ id: ctx.id(), userId: admin.id, kind: "complaint.new", title: "New report submitted", body: "Open Reports to review it.", href: "/admin/complaints", createdAt: addDays(NOW, -1.3), readAt: null });
  }
}

function approvalTasks(ctx: Ctx) {
  const { NOW } = ctx;
  // Join requests waiting on the gate (and decided ones, closed).
  for (const club of ctx.clubs) {
    for (const m of club.members) {
      if (m.status !== "PENDING" && m.status !== "DECLINED") continue;
      const who = ctx.person(m.userId);
      ctx.rows.tasks.push({
        id: ctx.id(), kind: "APPROVAL", title: `${who.name} asked to join ${club.name}`, assigneeType: "CLUB", clubId: club.id, capability: "roster",
        href: `/clubs/${club.slug}/manage/members`, status: m.status === "PENDING" ? "OPEN" : "DONE", sourceType: "membership", sourceId: m.id, createdById: m.userId,
        createdAt: m.requestedAt, completedAt: m.status === "DECLINED" ? m.endedAt : null, completedById: m.status === "DECLINED" ? ctx.capabilityHoldersAt(club, "roster", m.endedAt ?? NOW)[0] ?? null : null,
      });
    }
  }
  // Co-host requests.
  for (const ev of allEvents(ctx)) {
    if (!ev.clubId) continue;
    const host = ctx.clubById.get(ev.clubId)!;
    for (const c of ev.cohosts) {
      const partner = ctx.clubById.get(c.clubId)!;
      if (partner.def.autoApproveCohosts && c.status === "APPROVED") continue;
      ctx.rows.tasks.push({
        id: ctx.id(), kind: "APPROVAL", title: `${host.name} asked ${partner.name} to co-host “${ev.title}”`, assigneeType: "CLUB", clubId: partner.id, capability: "events",
        href: `/clubs/${partner.slug}/manage/events`, status: c.status === "PENDING" ? "OPEN" : "DONE", sourceType: "cohost", sourceId: c.id, createdById: c.requestedById,
        createdAt: c.createdAt, completedAt: c.decidedAt, completedById: c.decidedById,
      });
      if (c.status !== "PENDING") ctx.activity({ at: c.decidedAt ?? c.createdAt, actorId: c.decidedById, action: c.status === "APPROVED" ? "event.cohost_approved" : "event.cohost_declined", entityType: "eventCohost", entityId: c.id, clubId: partner.id, data: { eventId: ev.id, title: ev.title, hostClubId: host.id }, isPublic: c.status === "APPROVED" });
    }
  }
  // An EAST club without a College Ambassador asked EAST Ambassadors for one (domain/ambassadors).
  // Priya's club when it has none (her story), otherwise the largest EAST club without one.
  const eastAmb = ctx.clubs.find((c) => c.type === "COLLEGE_AMBASSADORS" && c.collegeKey === "east" && c.status === "APPROVED");
  const activeAt = (a: { startedAt: Date; endedAt: Date | null }) => a.startedAt <= NOW && (!a.endedAt || a.endedAt > NOW);
  const canAsk = (c: (typeof ctx.clubs)[number]) =>
    c.collegeKey === "east" && c.type !== "COLLEGE_AMBASSADORS" && c.status === "APPROVED" && c.assignments.some((a) => a.role === "PRESIDENT" && activeAt(a)) && !c.assignments.some((a) => a.role === "AMBASSADOR" && activeAt(a));
  const asking = canAsk(ctx.club("robotics"))
    ? ctx.club("robotics")
    : ctx.clubs.filter(canAsk).sort((a, b) => b.members.filter((m) => m.status === "ACTIVE").length - a.members.filter((m) => m.status === "ACTIVE").length || a.name.localeCompare(b.name))[0];
  if (eastAmb && asking) {
    const askedAt = addDays(NOW, -2.4);
    const note = "We'd love help reaching more EAST students this spring.";
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: `${asking.name} asked for a College Ambassador`, description: note,
      assigneeType: "CLUB", clubId: eastAmb.id, capability: "roster", href: `/clubs/${eastAmb.slug}/manage/ambassadors?requested=1`, status: "OPEN",
      sourceType: "ambassadorRequest", sourceId: asking.id, createdById: ctx.leaderAt(asking, askedAt), createdAt: askedAt,
    });
    ctx.activity({ at: askedAt, actorId: ctx.leaderAt(asking, askedAt), action: "ambassador.requested", entityType: "club", entityId: asking.id, clubId: asking.id, data: { programId: eastAmb.id, note } });
    ctx.refs.ambassadorRequestClub = asking.name;
  }
  // Advisor invite to Prof. Nathan Reed.
  const bee = ctx.club("beekeeping");
  ctx.rows.tasks.push({
    id: ctx.id(), kind: "APPROVAL", title: `Frank Okafor invited you to advise ${bee.name}`, description: "Accepting makes you the club's advisor, with full permissions in the club. Founders need an accepted advisor before they can submit the club for WSUSA review.",
    assigneeType: "USER", assigneeId: ctx.p("nathan").id, clubId: bee.id, href: `/advisor/invite/${ctx.refs.beeInviteToken}`, status: "OPEN", sourceType: "advisorInvite", sourceId: ctx.refs.beeInviteId,
    createdById: ctx.p("frank").id, createdAt: addDays(NOW, -3.2),
  });
  // WSUSA queues.
  const bg = ctx.club("boardgames");
  ctx.rows.tasks.push({
    id: ctx.id(), kind: "APPROVAL", title: `Review new club: ${bg.name}`, description: "Registered club · advisor accepted · constitution and bylaws adopted with the builder.",
    assigneeType: "ADMINS", clubId: bg.id, href: `/admin/clubs/${bg.id}`, status: "OPEN", sourceType: "club", sourceId: bg.id, createdById: bg.founderId, createdAt: bg.submittedAt!,
  });
  const av = ctx.club("aviation");
  ctx.rows.tasks.push({
    id: ctx.id(), kind: "APPROVAL", title: `Add department "Aviation Technology" for ${av.name}`, description: `${av.name} chose "Other" and typed in Aviation Technology. Add it in Directory and link the club, or pick an existing department.`,
    assigneeType: "ADMINS", clubId: av.id, href: `/admin/clubs/${av.id}`, status: "OPEN", sourceType: "departmentRequest", sourceId: av.id, createdById: av.founderId, createdAt: av.submittedAt!,
  });
  ctx.rows.tasks.push({
    id: ctx.id(), kind: "APPROVAL", title: `Review new club: ${av.name}`, assigneeType: "ADMINS", clubId: av.id, href: `/admin/clubs/${av.id}`, status: "DONE", sourceType: "club", sourceId: av.id,
    createdById: av.founderId, createdAt: av.submittedAt!, completedAt: addDays(NOW, -6.3), completedById: ctx.p("alex").id,
  });
  const theatre = ctx.club("theatre");
  ctx.rows.tasks.push({
    id: ctx.id(), kind: "APPROVAL", title: `Approve custom bylaws: ${theatre.name}`, description: "Custom documents replace the builder version once approved.",
    assigneeType: "ADMINS", clubId: theatre.id, href: `/admin/clubs/${theatre.id}#documents`, status: "OPEN", sourceType: "clubDocument", sourceId: ctx.refs.customDocId,
    createdById: ctx.leaderAt(theatre, NOW), createdAt: addDays(NOW, -4.2),
  });
}

function todoTasks(ctx: Ctx) {
  const { NOW } = ctx;
  const t = (userKey: string, title: string, dueDays: number | null, done = false, description?: string) => {
    const u = ctx.p(userKey).id;
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "PERSONAL", title, description: description ?? null, assigneeType: "USER", assigneeId: u, dueAt: dueDays === null ? null : addDays(NOW, dueDays),
      status: done ? "DONE" : "OPEN", createdById: u, createdAt: addDays(NOW, -6), completedAt: done ? addDays(NOW, -1) : null, completedById: done ? u : null,
    });
  };
  t("maya", "Study for PSY 3600 exam", 3);
  t("maya", "Ask Dr. Larsen about lab openings for spring", 9);
  t("maya", "Return the trekking poles to the gear room", null, true);
  t("oscar", "Collect receipts from the speaker dinner", 2);
  t("oscar", "Read the Funding & Purchasing policy", null, true);
  t("priya", "Book Noorda 150 for spring build nights", 12);
  t("priya", "Send the competition travel itinerary to Dr. Alvarez", 4);
  t("vanessa", "Email Hill AFB speakers for the cyber panel", 5);
  t("amir", "Send Beta Alpha Psi news to the Goddard newsletter", 3);
  t("frank", "Finish the beekeeping constitution draft", 7);
  t("frank", "Ask Facilities about hive placement on Tracy Hall", 14);
  t("elena", "Review the competition travel budget", 1, true);
  t("alex", "Prep slides for the officer training makeup session", 7);

  // Club to-dos: for anyone holding the capability, and assigned to a person by leaders.
  const club = (key: string) => ctx.club(key);
  const robotics = club("robotics");
  ctx.rows.tasks.push(
    { id: ctx.id(), kind: "CLUB", title: "Upload minutes from Tuesday's build night", assigneeType: "CLUB", clubId: robotics.id, capability: "files", href: `/clubs/${robotics.slug}/manage/files`, dueAt: addDays(NOW, 2), status: "OPEN", createdById: ctx.p("priya").id, createdAt: addDays(NOW, -2) },
    { id: ctx.id(), kind: "CLUB", title: "Order motor controllers for the rover", assigneeType: "USER", assigneeId: ctx.holderAt(robotics, "Treasurer", NOW) ?? ctx.p("vanessa").id, clubId: robotics.id, href: `/clubs/${robotics.slug}/manage/budget`, dueAt: addDays(NOW, 6), status: "OPEN", createdById: ctx.p("priya").id, createdAt: addDays(NOW, -3) },
    { id: ctx.id(), kind: "CLUB", title: "Book a room for the spring hackathon", assigneeType: "CLUB", clubId: club("acm").id, capability: "events", href: `/clubs/${club("acm").slug}/manage/events`, dueAt: addDays(NOW, 20), status: "OPEN", createdById: ctx.leaderAt(club("acm"), NOW), createdAt: addDays(NOW, -5) },
    { id: ctx.id(), kind: "CLUB", title: "Reconcile September spending", description: "Match the September receipts to budget items before the advisor check-in.", assigneeType: "USER", assigneeId: ctx.p("oscar").id, clubId: club("fic").id, href: `/clubs/${club("fic").slug}/manage/budget`, dueAt: addDays(NOW, 4), status: "OPEN", createdById: ctx.leaderAt(club("fic"), NOW), createdAt: addDays(NOW, -4) },
    { id: ctx.id(), kind: "CLUB", title: "Recruit SWE mentors for Robot Day", assigneeType: "USER", assigneeId: ctx.p("vanessa").id, clubId: club("swe").id, href: `/clubs/${club("swe").slug}/manage/events`, dueAt: addDays(NOW, 10), status: "OPEN", createdById: ctx.refs.swePresident, createdAt: addDays(NOW, -7) },
    { id: ctx.id(), kind: "CLUB", title: "Post the election reminder", assigneeType: "CLUB", clubId: club("psych").id, capability: "announcements", href: `/clubs/${club("psych").slug}/manage/announcements`, dueAt: addDays(NOW, 1), status: "OPEN", createdById: ctx.refs.psychPresident, createdAt: addDays(NOW, -2) },
  );
}

/** Where a seeded event meets, as people read it in notices (lib/events/notices). */
function seedPlace(ctx: Ctx, ev: Ev, roomOverride: string | null = null) {
  const b = ev.buildingCode ? ctx.buildings.get(ev.buildingCode) : undefined;
  return placeOf({ locationType: ev.locationType, building: b ? { name: b.name, code: ev.buildingCode } : null, room: ev.room, address: ev.address, virtualUrl: ev.virtualUrl }, roomOverride);
}

/**
 * Maya's event-changed notice: a date in the next two weeks of a weekly series
 * she follows moved rooms. ISMN first (she follows its calendar without
 * joining), else one of her clubs. The date really has its own room, as if a
 * leader changed it in the Events Builder about 20 hours before the seed ran,
 * and the notice reads exactly as lib/events/notices writes it.
 */
function mayaRoomChange(ctx: Ctx) {
  const { NOW } = ctx;
  const sentAt = addHours(NOW, -20);
  for (const key of ["anime", "psych", "climbing", "premed", "service"]) {
    const club = ctx.club(key);
    for (const ev of club.events.filter((e) => e.isSeries && e.status === "SCHEDULED" && e.locationType === "CAMPUS" && e.buildingCode)) {
      const occ = ev.occurrences.find((o) => o.status === "SCHEDULED" && !o.roomOverride && o.startsAt > addDays(NOW, 2) && o.startsAt < addDays(NOW, 10));
      const room = ctx.buildings.get(ev.buildingCode!)?.rooms.find((r) => r !== ev.room);
      if (!occ || !room) continue;
      occ.roomOverride = room;
      ctx.activity({ at: sentAt, actorId: ctx.leaderAt(club, sentAt), action: "event.room_changed", entityType: "occurrence", entityId: occ.id, clubId: club.id, data: { room } });
      const notice = roomNotice(
        { title: ev.title, host: club.name },
        { date: { id: occ.id, startsAt: occ.startsAt, endsAt: occ.endsAt, place: seedPlace(ctx, ev, room) }, before: seedPlace(ctx, ev), usual: seedPlace(ctx, ev), now: sentAt },
      );
      return notice ? { notice, href: `/events/${ev.id}?o=${occ.id}` } : null;
    }
  }
  return null;
}

function personaNotifications(ctx: Ctx) {
  const { NOW } = ctx;
  const n = (key: string, kind: string, title: string, body: string | null, href: string, hoursAgo: number, read: boolean) => {
    const userId = ctx.p(key).id;
    const createdAt = addHours(NOW, -hoursAgo);
    ctx.rows.notifications.push({ id: ctx.id(), userId, kind, title, body, href, createdAt, readAt: read ? addHours(createdAt, 1) : null });
  };
  const slug = (k: string) => ctx.club(k).slug;
  const nm = (k: string) => ctx.club(k).name;
  // Maya. Every kind here is one the app sends (components/notifications/catalog; verify.ts checks).
  n("maya", "election.voting_opened", "Voting is open: President — Spring 2027", `Cast your secret ballot for ${nm("psych")}. One vote each.`, `/clubs/${slug("psych")}/elections/${ctx.refs.psychElectionId}`, 50, false);
  // The Reminders job's notice about an hour before the live service event started (it started 15 minutes before the seed ran).
  const live = ctx.club("service").events.find((e) => e.id === ctx.refs.liveEventId);
  if (live?.startsAt) {
    const soon = startingSoonNotice({ title: live.title, startsAt: live.startsAt, place: seedPlace(ctx, live).text, host: nm("service") });
    n("maya", "event.starting_soon", soon.title, soon.body, `/events/${live.id}?o=${ctx.refs.liveOccurrenceId}`, 1.25, false);
  }
  const moved = mayaRoomChange(ctx);
  if (moved) n("maya", moved.notice.kind, moved.notice.title, moved.notice.body, moved.href, 20, false);
  n("maya", "announcement.new", `New announcement in ${nm("climbing")}`, null, `/clubs/${slug("climbing")}`, 30, false);
  const unlocked = reviewUnlockedNotice({ clubName: nm("premed"), attended: 3, opensAt: null });
  n("maya", "review.unlocked", unlocked.title, unlocked.body, `/clubs/${slug("premed")}#reviews`, 24 * 120, true);
  n("maya", "membership.approved", `You're in! Welcome to ${nm("climbing")}`, null, `/clubs/${slug("climbing")}`, 24 * 390, true);
  n("maya", "message.new", "Priya Patel sent you a message", "Thanks! See you Saturday 🥾", "/messages", 20, false);
  // Oscar
  n("oscar", "role.assigned", `You're now Treasurer of ${nm("fic")}`, null, `/clubs/${slug("fic")}`, 24 * 20.3, true);
  n("oscar", "funding.submitted", "Funding request submitted: Fall speaker series", "WSUSA reviews requests in about ten business days.", `/clubs/${slug("fic")}/manage/budget`, 24 * 5.2, true);
  n("oscar", "task.assigned", "New club task: Reconcile September spending", null, "/tasks", 24 * 4, false);
  // His officer test is due in about 10 days: its week-ahead reminder (requirement.due_soon) comes from the Reminders job in about 3.
  // Vanessa
  n("vanessa", "event.cohost_request", `${nm("cyber")} asked SWE to co-host “Women in Cybersecurity Panel”`, "Approve it from your tasks so it lands on SWE's calendar.", `/clubs/${slug("swe")}/manage/events`, 30, false);
  n("vanessa", "election.voting_opened", "Voting is open: President — Spring 2027", `${nm("swe")}'s leaders choose together: it has to be unanimous, and ballots are secret.`, `/clubs/${slug("swe")}/elections/${ctx.refs.sweElectionId}`, 24 * 9.2, true);
  n("vanessa", "task.assigned", "New club task: Recruit SWE mentors for Robot Day", null, "/tasks", 24 * 7, true);
  n("vanessa", "message.new", "Priya Patel sent you a message", null, "/messages", 24 * 2, true);
  // Priya
  n("priya", "membership.requested", `New join requests for ${nm("robotics")}`, "5 people are waiting for approval.", `/clubs/${slug("robotics")}/manage/members`, 10, false);
  n("priya", "event.cohost_approved", "SWE approved co-hosting “Girls in STEM Robot Day”", null, `/clubs/${slug("robotics")}/manage/events`, 24 * 3, true);
  n("priya", "event.cohost_approved", "CSWS approved co-hosting “Wrecker Bots × CSWS: Intro to Embedded Programming”", null, `/clubs/${slug("robotics")}/manage/events`, 24 * 4, true);
  n("priya", "funding.approved", "Funding approved: Combat robotics competition travel", "WSUSA approved the full amount. An invoice is being processed.", `/clubs/${slug("robotics")}/manage/budget`, 24 * 9.3, true);
  n("priya", "test.completed", "12 members passed the Event Safety Quiz", null, `/clubs/${slug("robotics")}/manage/tests`, 24 * 1, false);
  // Amir
  n("amir", "role.assigned", `You're now College Ambassador of ${nm("accounting")}`, "Placed by Goddard School Ambassadors.", `/clubs/${slug("accounting")}`, 24 * 400, true);
  n("amir", "role.assigned", `You're now College Ambassador of ${nm("marketing")}`, "Placed by Goddard School Ambassadors.", `/clubs/${slug("marketing")}`, 24 * 400, true);
  n("amir", "announcement.new", "New announcement in Goddard School Ambassadors", null, `/clubs/${slug("gsbe-amb")}`, 40, false);
  // Frank
  n("frank", "club.submitted", `${nm("boardgames")} is in WSUSA review`, "WSUSA reviews new clubs in about ten business days. We'll let you know as soon as there's a decision.", `/clubs/${slug("boardgames")}/manage`, 24 * 5.1, true);
  n("frank", "advisor.accepted", `${ctx.person(ctx.club("boardgames").advisorIds[0]).name} accepted your invitation to advise ${nm("boardgames")}`, null, `/clubs/${slug("boardgames")}/manage`, 24 * 30.2, true);
  n("frank", "advisor.invited", "Invitation sent to Prof. Nathan Reed", "We'll tell you when he responds.", `/clubs/${slug("beekeeping")}/manage`, 24 * 3.2, false);
  n("frank", "advisor.declined", `An advisor declined your invitation for ${nm("boardgames")}`, "You can invite someone else from the club's settings.", `/clubs/${slug("boardgames")}/manage`, 24 * 34.1, true);
  // Gwen
  n("gwen", "profile.alumni", "Congratulations, graduate!", "Your profile is now an alumni profile. Your club history and projects stay on it.", `/u/${ctx.p("gwen").handle}`, 24 * 168, true);
  n("gwen", "election.applied", "Applied AI Lab has a new president", null, `/clubs/${slug("ailab")}`, 24 * 168, true);
  n("gwen", "role.ended", "Your role as President of Applied AI Lab has ended", "Graduated — it stays in the Lab's role history and on your profile.", `/clubs/${slug("ailab")}`, 24 * 168.2, true);
  // Elena
  n("elena", "membership.requested", `New join requests for ${nm("robotics")}`, "5 people are waiting for approval.", `/clubs/${slug("robotics")}/manage/members`, 10, false);
  const mcat = ctx.rows.fundingRequests.find((r) => r.clubId === ctx.club("premed").id && r.status === "PARTIALLY_APPROVED");
  if (mcat) {
    const lead = `WSUSA approved ${fmtMoney(mcat.amountApprovedCents ?? 0)} of the ${fmtMoney(mcat.amountRequestedCents ?? 0)} requested.`;
    n("elena", "funding.partially_approved", `Funding partly approved: ${mcat.title}`, mcat.decisionNote ? `${lead} ${mcat.decisionNote}` : lead, `/clubs/${slug("premed")}/manage/budget/requests/${mcat.id}`, 24 * 20.2, true);
  }
  n("elena", "event.cohost_request", `${nm("premed")} asked ${nm("nursing")} to co-host “Health Careers Night”`, null, `/clubs/${slug("premed")}/manage/events`, 24 * 1.4, false);
  // Nathan
  n("nathan", "advisor.invited", "Frank Okafor invited you to advise Wildcat Beekeeping Society", "Open the request to accept or decline.", `/advisor/invite/${ctx.refs.beeInviteToken}`, 24 * 3.2, false);
  // Alex (admin queues; review-bombing and report alerts are added with those records)
  n("alex", "club.submitted", `New club submitted: ${nm("boardgames")}`, null, `/admin/clubs/${ctx.club("boardgames").id}`, 24 * 5.1, false);
  n("alex", "funding.submitted", `Funding request: ${nm("fic")} — Fall speaker series`, null, "/admin/funding", 24 * 5.2, true);
  n("alex", "funding.submitted", `Funding request: ${nm("nursing")} — Pinning ceremony`, null, "/admin/funding", 24 * 1.1, false);
  n("alex", "constitution.custom_submitted", `${nm("theatre")} uploaded a custom bylaws for approval`, null, `/admin/clubs/${ctx.club("theatre").id}#documents`, 24 * 4.2, false);
  // Sydney: nothing in the app notifies about system settings or job runs (System → Scheduled jobs shows those).
}

/**
 * What the platform emailed and pushed: each row the kind of notice the app
 * sends that way (components/notifications/catalog), so the outbox agrees
 * with the registry. WSUSA's routine notices (submissions) go into the
 * admins' daily digest instead, except for Sydney, who turned it off; the
 * first "Send queued messages" run after seeding sends today's digest.
 */
function outbox(ctx: Ctx, prefs: Map<string, NotificationPrefs>) {
  const { NOW } = ctx;
  const mail = (to: string, kind: string | null, subject: string, body: string, href: string | null, hoursAgo: number) => outboxRow(ctx, { to, kind, subject, body, href, at: addHours(NOW, -hoursAgo) });
  const e = (k: string) => ctx.p(k).email;
  const nm = (k: string) => ctx.club(k).name;
  // The invitation itself (lib/domain/advisors emailAddress): it can reach someone without an account, so it has no kind.
  mail(e("nathan"), null, "Frank Okafor invited you to advise Wildcat Beekeeping Society", "Frank Okafor invited you to be the faculty advisor for Wildcat Beekeeping Society on Wildcat Clubs. Sign in with your Weber State account to accept or decline.", `/advisor/invite/${ctx.refs.beeInviteToken}`, 24 * 3.2);
  mail(ctx.person(ctx.club("aviation").founderId).email, "club.changes_requested", "Changes requested: Aviation Club", "WSUSA reviewed Aviation Club and asked for a couple of changes before approval. Open the club workspace to see the note.", `/clubs/${ctx.club("aviation").slug}/manage`, 24 * 6.3);
  // Urgent for WSUSA: emailed right away, never held for the digest.
  for (const a of ctx.admins) mail(a.email, "review.bombing", `Possible review bombing: ${nm("discgolf")}`, "3 reviews of 2★ or lower in the last 48 hours.", `/admin/reviews?club=${ctx.club("discgolf").id}`, 9);
  // A digest kind: only an admin who turned the digest off got it one by one.
  for (const a of ctx.admins.filter((x) => !digestOn(prefs.get(x.id) ?? {}))) mail(a.email, "funding.submitted", `Funding request: ${nm("fic")} — Fall speaker series`, "A new funding request is waiting for review.", "/admin/funding", 24 * 5.2);
  mail(e("oscar"), "requirement.assigned", "Your new role has WSUSA requirements", "Finish Club Officer Policy Test, Club Officer Training to keep your permissions on.", "/tasks", 24 * 20.3);
  mail(e("maya"), "election.voting_opened", "Voting is open: President — Spring 2027", `Cast your secret ballot for ${nm("psych")}. One vote each.`, `/clubs/${ctx.club("psych").slug}/elections/${ctx.refs.psychElectionId}`, 50);
  mail(e("vanessa"), "event.cohost_request", `Co-host request from ${nm("cyber")}`, `${nm("cyber")} asked SWE to co-host “Women in Cybersecurity Panel”.`, `/clubs/${ctx.club("swe").slug}/manage/events`, 30);
  mail(e("priya"), "funding.approved", "Funding approved: Combat robotics competition travel", "WSUSA approved your request.", `/clubs/${ctx.club("robotics").slug}/manage/budget`, 24 * 9.3);
  for (const m of ctx.club("robotics").members.filter((x) => x.status === "ACTIVE" && x.joinedAt && x.joinedAt > addDays(NOW, -30)).slice(0, 4)) {
    mail(ctx.person(m.userId).email, "membership.approved", `You're in! Welcome to ${nm("robotics")}`, "Your join request was approved.", `/clubs/${ctx.club("robotics").slug}`, (NOW.getTime() - m.joinedAt!.getTime()) / 3_600_000);
  }
  outboxRow(ctx, {
    channel: "PUSH", to: ctx.p("priya").id, kind: "membership.requested", subject: `New join requests for ${nm("robotics")}`, body: "5 people are waiting for approval.",
    href: `/clubs/${ctx.club("robotics").slug}/manage/members`, status: "FAILED", error: "Expo push token expired (DeviceNotRegistered).", at: addHours(NOW, -10),
  });
  queuedAnnouncement(ctx, prefs);
}

/**
 * A big send still going out: Priya posted to the RC Wrecker Bots Club a few
 * minutes before the seed ran. Its audience (members and leaders, about 90)
 * is over lib/domain/notify's QUEUE_OVER, so every bell has it already and
 * the emails wait as QUEUED for the "Send queued messages" job, which sends
 * up to about 200 a run. Who's emailed follows the registry and each person's
 * choices (resolveDelivery): Dr. Alvarez turned Announcements email off, so
 * she has the bell and no email.
 */
export const QUEUED_ANNOUNCEMENT_TITLE = "Competition team tryouts are this Saturday";

function queuedAnnouncement(ctx: Ctx, prefs: Map<string, NotificationPrefs>) {
  const club = ctx.club("robotics");
  const priya = ctx.p("priya");
  const at = addMin(ctx.NOW, -4);
  const title = QUEUED_ANNOUNCEMENT_TITLE;
  const text = "Bring your laptop and any parts you're working on. Tryouts run 10 AM to 2 PM in the Makerspace; no experience needed.";
  const id = ctx.id();
  ctx.rows.announcements.push({ id, clubId: club.id, authorId: priya.id, title, bodyHtml: `<p>${text}</p>`, audience: "MEMBERS", pinned: false, createdAt: at, updatedAt: at });
  ctx.activity({ at, actorId: priya.id, action: "announcement.created", entityType: "announcement", entityId: id, clubId: club.id, data: { title, audience: "MEMBERS" } });

  // lib/domain/announcements: active members plus current leaders and advisors, minus the author.
  const active = (userId: string) => ctx.person(userId).status === "ACTIVE";
  const audience = [
    ...new Set([
      ...club.members.filter((m) => m.status === "ACTIVE" && active(m.userId)).map((m) => m.userId),
      ...club.assignments.filter((a) => a.role !== "MEMBER" && a.startedAt <= ctx.NOW && (!a.endedAt || a.endedAt > ctx.NOW) && active(a.userId)).map((a) => a.userId),
    ]),
  ].filter((userId) => userId !== priya.id);
  const notice = { title: `New announcement in ${club.name}`, body: `${title} — ${text}`, href: `/clubs/${club.slug}#announcements` };
  const admins = new Set(ctx.admins.map((a) => a.id));
  for (const userId of audience) {
    ctx.rows.notifications.push({ id: ctx.id(), userId, kind: "announcement.new", ...notice, createdAt: at, readAt: null });
    const d = resolveDelivery("announcement.new", { emailOn: true, admin: admins.has(userId), prefs: prefs.get(userId) ?? {} });
    // Recorded the way lib/integrations/email queueEmails composes it: the link under the body.
    if (d.email === "now") outboxRow(ctx, { to: ctx.person(userId).email, kind: "announcement.new", subject: notice.title, body: `${notice.body}\n\n${APP_URL}${notice.href}`, href: `${APP_URL}${notice.href}`, at, status: "QUEUED" });
  }
  ctx.refs.queuedAnnouncement = title;
}

function activity(ctx: Ctx) {
  const { NOW } = ctx;
  const since60 = addDays(NOW, -60);
  const since30 = addDays(NOW, -30);
  for (const d of ctx.rows.decisions) {
    const action = { SUBMITTED: "club.submitted", APPROVED: "club.approved", CHANGES_REQUESTED: "club.changes_requested", REJECTED: "club.rejected", RETIRED: "club.retired" }[d.action as string];
    if (action) ctx.activity({ at: d.at as Date, actorId: d.byId, action, entityType: "club", entityId: d.clubId, clubId: d.clubId, isPublic: action === "club.approved" || action === "club.retired" });
  }
  for (const club of ctx.clubs) {
    ctx.activity({ at: club.createdAt, actorId: club.founderId, action: "club.created", entityType: "club", entityId: club.id, clubId: club.id });
    for (const a of club.assignments) {
      const data: Prisma.InputJsonValue = { userId: a.userId, role: a.role, position: a.seatName, ...(a.viaClubId ? { viaClubId: a.viaClubId } : {}) };
      ctx.activity({ at: a.startedAt, actorId: a.assignedById, action: "role.assigned", entityType: "roleAssignment", entityId: a.id, clubId: club.id, data, isPublic: true });
      if (a.endedAt) ctx.activity({ at: a.endedAt, actorId: a.endReason === "RESIGNED" ? a.userId : null, action: "role.ended", entityType: "roleAssignment", entityId: a.id, clubId: club.id, data: { userId: a.userId, role: a.role, reason: a.endReason }, isPublic: true });
    }
    for (const m of club.members) {
      if (m.joinedAt && m.joinedAt >= since60 && m.status !== "PENDING") {
        ctx.activity({ at: m.joinedAt, actorId: m.userId, action: "membership.joined", entityType: "membership", entityId: m.id, clubId: club.id, data: { source: m.source }, isPublic: true });
      }
      if (m.status === "PENDING") ctx.activity({ at: m.requestedAt, actorId: m.userId, action: "membership.requested", entityType: "membership", entityId: m.id, clubId: club.id });
    }
  }
  for (const ev of allEvents(ctx)) {
    if (ev.createdAt >= since60) ctx.activity({ at: ev.createdAt, actorId: ev.createdById, action: "event.created", entityType: "event", entityId: ev.id, clubId: ev.clubId, data: { title: ev.title }, isPublic: ev.status === "SCHEDULED" && ev.visibility === "PUBLIC" });
    for (const o of ev.occurrences) {
      if (o.startsAt < since30) continue;
      for (const [userId, a] of o.attendees) {
        ctx.activity({ at: a.at, actorId: a.method === "MANUAL" ? a.recordedById : userId, action: a.method === "MANUAL" ? "attendance.manual_add" : "attendance.checkin", entityType: "attendance", entityId: a.id, clubId: ev.clubId, data: { occurrenceId: o.id, eventId: ev.id, title: ev.title, method: a.method, userId }, isPublic: a.method !== "MANUAL" });
      }
    }
  }
}

/**
 * WSUSA's staffing story (lib/domain/staffing), built last so every other
 * step keeps the roles it was built with:
 *   - a small approved club whose only President stepped down about three
 *     days ago (the advisor ended the role at their request), so nobody holds
 *     the seat: an open "{club} has no President" task for WSUSA, and the
 *     club's other leaders were told;
 *   - a gated club where nobody holds the Members permission, with a join
 *     request waiting nine days: an open "Join requests waiting at {club}".
 * No other club gets a staffing task: gaps that were already there aren't
 * backfilled (Club analytics' No President / No advisor filters show them).
 */
function staffingStory(ctx: Ctx) {
  const { NOW } = ctx;
  const activeAt = (a: Assignment) => a.startedAt <= NOW && (!a.endedAt || a.endedAt > NOW);
  const size = (c: ClubM) => c.members.filter((m) => m.status === "ACTIVE").length;
  const leadsElsewhere = (a: Assignment) => ctx.clubs.some((c) => c.assignments.some((x) => x !== a && x.userId === a.userId && x.role !== "MEMBER" && activeAt(x)));

  // A WSUSA directory club (an office's clubs go to that office's queue; steps/offices gives Campus Rec its own story)
  // with one President, an advisor and at least one more officer; the smallest with six members or more.
  const candidates = ctx.clubs
    .filter((c) => c.status === "APPROVED" && c.officeId === null && !c.def.story && c.type !== "COLLEGE_AMBASSADORS" && c.def.life !== "dormant")
    .map((club) => {
      const now = club.assignments.filter(activeAt);
      const presidents = now.filter((a) => a.role === "PRESIDENT");
      return { club, now, president: presidents.length === 1 ? presidents[0] : null };
    })
    .filter(({ now, president }) => president && !ctx.person(president.userId).persona && !leadsElsewhere(president) && now.some((a) => a.role === "ADVISOR") && now.some((a) => a.role === "VP" || a.role === "OFFICER"))
    .sort((a, b) => size(a.club) - size(b.club) || a.club.name.localeCompare(b.club.name));
  const pick = candidates.find((c) => size(c.club) >= 6) ?? candidates[0];
  if (pick?.president) {
    const { club, president } = pick;
    const advisorId = pick.now.find((a) => a.role === "ADVISOR")!.userId;
    const endedAt = addDays(NOW, -3.1);
    president.endedAt = endedAt;
    president.endReason = "RESIGNED";
    ctx.activity({ at: endedAt, actorId: advisorId, action: "role.ended", entityType: "roleAssignment", entityId: president.id, clubId: club.id, data: { userId: president.userId, role: "PRESIDENT", reason: "RESIGNED" }, isPublic: true });
    // They lead nowhere else now, so the leader requirements they owed close with the seat and their test
    // assignments are excused (domain/requirements reopenRequirementTasks). Member requirements stay.
    replanRequirements(ctx, president, endedAt);
    ctx.rows.notifications.push({
      id: ctx.id(), userId: president.userId, kind: "role.ended", title: `Your role as ${president.seatName ?? "President"} of ${club.name} ended`,
      body: "Resigned. Your time in the role stays in the club's history.", href: `/clubs/${club.slug}/history`, createdAt: addMin(endedAt, 1), readAt: addHours(endedAt, 6),
    });

    const flaggedAt = addMin(endedAt, 1);
    const story = { club: { name: club.name, slug: club.slug, type: club.type }, gap: "president" as const, leftName: ctx.person(president.userId).name, hasAdvisor: true };
    const task = gapTask(story);
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: task.title, description: task.description, assigneeType: "ADMINS", clubId: club.id, href: task.href,
      status: "OPEN", sourceType: STAFFING_SOURCE, sourceId: staffingSourceId(club.id, "president"), createdById: advisorId, createdAt: flaggedAt,
    });
    ctx.activity({ at: flaggedAt, actorId: null, action: "staffing.gap_flagged", entityType: "club", entityId: club.id, clubId: club.id, data: { gap: "president" } });
    // The remaining leaders and advisors hear about it (not the advisor who ended the role), and so does WSUSA,
    // with its task's wording. staffing.gap always sends, so everyone told was emailed too (lib/domain/staffing).
    const notice = gapNotice(story);
    const told = [...new Set(pick.now.filter((a) => a !== president && a.role !== "MEMBER" && a.userId !== advisorId).map((a) => a.userId))];
    for (const userId of told) {
      ctx.rows.notifications.push({ id: ctx.id(), userId, kind: "staffing.gap", title: notice.title, body: notice.body, href: notice.href, createdAt: flaggedAt, readAt: null });
      outboxRow(ctx, { to: ctx.person(userId).email, kind: "staffing.gap", subject: notice.title, body: notice.body, href: notice.href, at: flaggedAt });
    }
    for (const a of ctx.admins) {
      ctx.rows.notifications.push({ id: ctx.id(), userId: a.id, kind: "staffing.gap", title: task.title, body: task.description, href: task.href, createdAt: flaggedAt, readAt: null });
      outboxRow(ctx, { to: a.email, kind: "staffing.gap", subject: task.title, body: task.description, href: task.href, at: flaggedAt });
    }
    ctx.refs.staffingClub = club.name;
  }

  // Join requests nobody can approve: the first gated club (by name) where nobody holds the Members permission.
  const gated = ctx.clubs
    .filter((c) => c.status === "APPROVED" && c.type !== "COLLEGE_AMBASSADORS" && c.def.joinPolicy === "APPROVAL" && ctx.capabilityHoldersAt(c, "roster", NOW).length === 0)
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  const asker = gated
    ? ctx.people.filter((p) => p.kind === "STUDENT" && p.status === "ACTIVE" && !p.persona && !gated.byUser.has(p.id)).sort((a, b) => a.handle.localeCompare(b.handle))[0]
    : undefined;
  if (gated && asker) {
    const requestedAt = addDays(NOW, -9.2);
    const m = addMember(ctx, gated, asker.id, { status: "PENDING", source: "REGISTER", joinedAt: null, requestedAt, eng: { base: 0, half: 1, floor: 0 } });
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: `${asker.name} asked to join ${gated.name}`, assigneeType: "CLUB", clubId: gated.id, capability: "roster",
      href: `/clubs/${gated.slug}/manage/members`, status: "OPEN", sourceType: "membership", sourceId: m.id, createdById: asker.id, createdAt: requestedAt,
    });
    ctx.activity({ at: requestedAt, actorId: asker.id, action: "membership.requested", entityType: "membership", entityId: m.id, clubId: gated.id });
    // The scheduled "Club staffing" job flagged it once the request had waited a week.
    const flaggedAt = addHours(requestedAt, 7 * 24 + 0.5);
    const task = orphanRequestsTask(gated);
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: task.title, description: task.description, assigneeType: "ADMINS", clubId: gated.id, href: task.href,
      status: "OPEN", sourceType: ORPHAN_REQUESTS_SOURCE, sourceId: gated.id, createdAt: flaggedAt,
    });
    ctx.activity({ at: flaggedAt, actorId: null, action: "staffing.requests_flagged", entityType: "club", entityId: gated.id, clubId: gated.id, data: { waitingSince: requestedAt.toISOString() } });
    ctx.refs.orphanClub = gated.name;
  }
}

export function buildInbox(ctx: Ctx, users: UserRows) {
  const prefs = notificationPrefs(ctx, users);
  complaints(ctx);
  approvalTasks(ctx);
  todoTasks(ctx);
  personaNotifications(ctx);
  outbox(ctx, prefs);
  activity(ctx);
  staffingStory(ctx);
}
