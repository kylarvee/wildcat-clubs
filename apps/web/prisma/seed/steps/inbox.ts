import type { Prisma } from "@prisma/client";
import type { Ctx } from "../ctx";
import { addDays, addHours, addMin, minDate } from "../lib/dates";
import { allEvents } from "./events";

/**
 * Everything that's waiting on someone: approval tasks (join requests,
 * co-hosts, advisor invites, club and document reviews, department requests),
 * personal and club to-dos, complaints, each persona's notifications, the
 * mocked email outbox, and the activity stream.
 */

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
      anon: true, reporter: null, clubKey: "ski", category: "Hazing", status: "NEW", daysAgo: 1.3, incidentDaysAgo: 4,
      subject: "Pressure on new members before the season-opener trip",
      body: "New members were told they had to do a 'polar plunge' in Pineview Reservoir to get a seat on the first trip. A couple of people felt like they couldn't say no. I don't want my name on this because I still want to go on trips.",
      notes: [],
    },
    {
      anon: true, reporter: null, clubKey: "entre", category: "Misuse of funds", status: "IN_REVIEW", daysAgo: 9.4, incidentDaysAgo: 20,
      subject: "Club money used for an officers-only dinner",
      body: "The receipts for the 'networking night' were actually a dinner for four officers at a restaurant on 25th Street. No members were invited.",
      notes: [[7.9, "Requested the event's budget items and receipts from the treasurer through the Budget tool. Not sharing the report itself."], [3.2, "Receipts show 4 meals. Scheduling a conversation with the advisor about reimbursing the club."]],
    },
    {
      anon: false, reporter: "anime", clubKey: "anime", category: "Harassment", status: "REFERRED", daysAgo: 30.2, incidentDaysAgo: 33,
      subject: "Repeated comments in the club chat",
      body: "Another member keeps making comments about my appearance in the club chat and in DMs after I asked them to stop. Screenshots available.",
      notes: [[29.1, "Spoke with the reporter. They'd like this referred."], [27.5, "Referred to the Title IX office per WSU policy. Club officers asked to moderate the chat."]],
    },
    {
      anon: false, reporter: "theatre", clubKey: "theatre", category: "Event safety", status: "RESOLVED", daysAgo: 55, incidentDaysAgo: 57,
      subject: "Overcrowded rehearsal hall during the improv night",
      body: "About 90 people were packed into the rehearsal hall and the exit by the stage was blocked by set pieces.",
      notes: [[53, "Met with Theatre Guild's president and advisor. They'll move large improv nights to the Allred lobby and keep exits clear."], [40, "Followed up after the next event — exits clear, headcount capped. Resolving."]],
    },
    {
      anon: false, reporter: null, clubKey: "cyber", category: "Discrimination", status: "NEW", daysAgo: 0.6, incidentDaysAgo: 10,
      subject: "Join request declined without a reason",
      body: "My request to join was declined and nobody would tell me why. I've done the ethics pledge. I'm worried it's because I'm an older, returning student.",
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
      if (c.status !== "PENDING") ctx.activity({ at: c.decidedAt ?? c.createdAt, actorId: c.decidedById, action: c.status === "APPROVED" ? "cohost.approved" : "cohost.declined", entityType: "eventCohost", entityId: c.id, clubId: partner.id, data: { eventId: ev.id, hostClubId: host.id }, isPublic: c.status === "APPROVED" });
    }
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
  t("maya", "Pick up climbing shoes from the gear room", null, true);
  t("oscar", "Collect receipts from the speaker dinner", 2);
  t("oscar", "Read the Funding & Purchasing policy", null, true);
  t("priya", "Book Noorda 150 for spring build nights", 12);
  t("priya", "Send Lunabotics travel itinerary to Dr. Alvarez", 4);
  t("vanessa", "Email Hill AFB speakers for the cyber panel", 5);
  t("amir", "Send Accounting Society news to the Goddard newsletter", 3);
  t("frank", "Finish the beekeeping constitution draft", 7);
  t("frank", "Ask Facilities about hive placement on Tracy Hall", 14);
  t("elena", "Review the Lunabotics travel budget", 1, true);
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

function personaNotifications(ctx: Ctx) {
  const { NOW } = ctx;
  const n = (key: string, kind: string, title: string, body: string | null, href: string, hoursAgo: number, read: boolean) => {
    const userId = ctx.p(key).id;
    const createdAt = addHours(NOW, -hoursAgo);
    ctx.rows.notifications.push({ id: ctx.id(), userId, kind, title, body, href, createdAt, readAt: read ? addHours(createdAt, 1) : null });
  };
  const slug = (k: string) => ctx.club(k).slug;
  // Maya
  n("maya", "election.voting_open", "Voting is open: Psychology Club President", "Cast your secret ballot before voting closes in 5 days.", `/clubs/${slug("psych")}`, 50, false);
  n("maya", "event.starting", "Starting now: Care Kit Assembly for the Weber Cares Pantry", "Service & Volunteer Club · Shepherd Union Room 404B. Check in when you arrive.", `/events/${ctx.refs.liveEventId}`, 0.25, false);
  n("maya", "announcement.new", "New announcement in Wildcat Climbing Club", null, `/clubs/${slug("climbing")}`, 30, false);
  n("maya", "review.unlocked", "You can now review Pre-Med Society", "You've been to three events — tell other students what it's like.", `/clubs/${slug("premed")}`, 24 * 120, true);
  n("maya", "membership.approved", "You're in! Welcome to Wildcat Climbing Club", null, `/clubs/${slug("climbing")}`, 24 * 390, true);
  n("maya", "message.new", "Priya Patel sent you a message", "Thanks! See you Saturday 🧗", "/messages", 20, false);
  // Oscar
  n("oscar", "role.assigned", "You're now Treasurer of Finance & Investment Club", null, `/clubs/${slug("fic")}`, 24 * 20.3, true);
  n("oscar", "funding.submitted", "Funding request submitted: Fall speaker series", "WSUSA reviews requests in about ten business days.", `/clubs/${slug("fic")}/manage/budget`, 24 * 5.2, true);
  n("oscar", "task.assigned", "New club task: Reconcile September spending", null, "/tasks", 24 * 4, false);
  n("oscar", "requirement.reminder", "Club Officer Policy Test due in 10 days", "Pass it to keep your Treasurer permissions active.", `/tests/${ctx.refs.officerTestId}`, 6, false);
  // Vanessa
  n("vanessa", "event.cohost_request", "Cybersecurity Club asked SWE to co-host “Women in Cybersecurity Panel”", "Approve it from your tasks so it lands on SWE's calendar.", `/clubs/${slug("swe")}/manage/events`, 30, false);
  n("vanessa", "election.closed", "Voting closed: SWE President — Spring 2027", "Results are in. The President or advisor applies the result in the Org Chart.", `/clubs/${slug("swe")}`, 50, true);
  n("vanessa", "task.assigned", "New club task: Recruit SWE mentors for Robot Day", null, "/tasks", 24 * 7, true);
  n("vanessa", "message.new", "Priya Patel sent you a message", null, "/messages", 24 * 2, true);
  // Priya
  n("priya", "membership.requested", "New join requests for Wildcat Robotics", "5 people are waiting for approval.", `/clubs/${slug("robotics")}/manage/members`, 10, false);
  n("priya", "event.cohost_approved", "SWE approved co-hosting “Girls in STEM Robot Day”", null, `/clubs/${slug("robotics")}/manage/events`, 24 * 3, true);
  n("priya", "event.cohost_approved", "ACM Computer Science Club approved co-hosting “Robotics × ACM: Intro to ROS Workshop”", null, `/clubs/${slug("robotics")}/manage/events`, 24 * 4, true);
  n("priya", "funding.approved", "Funding approved: Lunabotics competition travel", "WSUSA approved the full amount. An invoice is being processed.", `/clubs/${slug("robotics")}/manage/budget`, 24 * 9.3, true);
  n("priya", "test.completed", "12 members passed the Event Safety Quiz", null, `/clubs/${slug("robotics")}/manage/tests`, 24 * 1, false);
  // Amir
  n("amir", "role.assigned", "You're now College Ambassador of Accounting Society", "Placed by Goddard School Ambassadors.", `/clubs/${slug("accounting")}`, 24 * 400, true);
  n("amir", "role.assigned", "You're now College Ambassador of Marketing Association", "Placed by Goddard School Ambassadors.", `/clubs/${slug("marketing")}`, 24 * 400, true);
  n("amir", "announcement.new", "New announcement in Goddard School Ambassadors", null, `/clubs/${slug("gsbe-amb")}`, 40, false);
  // Frank
  n("frank", "club.submitted", "Board Game Guild is in WSUSA review", "WSUSA reviews new clubs in about ten business days. We'll let you know as soon as there's a decision.", `/clubs/${slug("boardgames")}/manage`, 24 * 5.1, true);
  n("frank", "advisor.accepted", `${ctx.person(ctx.club("boardgames").advisorIds[0]).name} accepted your invitation to advise Board Game Guild`, null, `/clubs/${slug("boardgames")}/manage`, 24 * 30.2, true);
  n("frank", "advisor.invited", "Invitation sent to Prof. Nathan Reed", "We'll tell you when he responds.", `/clubs/${slug("beekeeping")}/manage`, 24 * 3.2, false);
  n("frank", "advisor.declined", "An advisor declined your invitation for Board Game Guild", "You can invite someone else from the club's settings.", `/clubs/${slug("boardgames")}/manage`, 24 * 34.1, true);
  // Gwen
  n("gwen", "profile.alumni", "Congratulations, graduate!", "Your profile is now an alumni profile. Your club history and projects stay on it.", `/u/${ctx.p("gwen").handle}`, 24 * 168, true);
  n("gwen", "election.applied", "Applied AI Lab has a new president", null, `/clubs/${slug("ailab")}`, 24 * 168, true);
  n("gwen", "role.ended", "Your role as President of Applied AI Lab has ended", "Graduated — it stays in the Lab's role history and on your profile.", `/clubs/${slug("ailab")}`, 24 * 168.2, true);
  n("gwen", "project.viewed", "Your project “Advising FAQ Chatbot” was added to Applied AI Lab's role history", null, `/u/${ctx.p("gwen").handle}`, 24 * 160, false);
  // Elena
  n("elena", "membership.requested", "New join requests for Wildcat Robotics", "5 people are waiting for approval.", `/clubs/${slug("robotics")}/manage/members`, 10, false);
  n("elena", "funding.submitted", "Pre-Med Society funding request decided", "Partially approved: MCAT prep books.", `/clubs/${slug("premed")}/manage/budget`, 24 * 20.2, true);
  n("elena", "event.cohost_request", "Pre-Med Society asked Nursing Student Association to co-host “Health Careers Night”", null, `/clubs/${slug("premed")}/manage/events`, 24 * 1.4, false);
  // Nathan
  n("nathan", "advisor.invited", "Frank Okafor invited you to advise Wildcat Beekeeping Society", "Open the request to accept or decline.", `/advisor/invite/${ctx.refs.beeInviteToken}`, 24 * 3.2, false);
  n("nathan", "system.welcome", "Welcome to Wildcat Clubs", "Advisors accept invitations here and get full access to the clubs they advise.", "/dashboard", 24 * 3.3, true);
  n("nathan", "advisor.reminder", "Reminder: Frank Okafor is waiting on your answer", "Wildcat Beekeeping Society can't be submitted for WSUSA review until an advisor accepts.", `/advisor/invite/${ctx.refs.beeInviteToken}`, 5, false);
  // Alex (admin queues; review-bombing and report alerts are added with those records)
  n("alex", "club.submitted", "New club submitted: Board Game Guild", null, `/admin/clubs/${ctx.club("boardgames").id}`, 24 * 5.1, false);
  n("alex", "funding.submitted", "Funding request: Finance & Investment Club — Fall speaker series", null, "/admin/funding", 24 * 5.2, true);
  n("alex", "funding.submitted", "Funding request: Nursing Student Association — Pinning ceremony", null, "/admin/funding", 24 * 1.1, false);
  n("alex", "document.submitted", "Theatre Guild submitted custom bylaws for approval", null, `/admin/clubs/${ctx.club("theatre").id}#documents`, 24 * 4.2, false);
  // Sydney
  n("sydney", "system.integrations", "Integrations are in mock mode", "Email, push and Google sync are off — messages are recorded in the outbox.", "/system", 24 * 30, true);
  n("sydney", "system.jobs", "Scheduled jobs ran", "All jobs completed.", "/system", 3, false);
  n("sydney", "system.ai", "Claude features are off", "Add an API key and switch on the assistant or grading assist in System settings.", "/system", 24 * 30, true);
}

function outbox(ctx: Ctx) {
  const { NOW } = ctx;
  const mail = (to: string, subject: string, body: string, href: string | null, hoursAgo: number, channel: "EMAIL" | "PUSH" = "EMAIL") =>
    ctx.rows.outbox.push({ id: ctx.id(), channel, to, subject, body, href, status: "MOCKED", createdAt: addHours(NOW, -hoursAgo) });
  const e = (k: string) => ctx.p(k).email;
  mail(e("nathan"), "Frank Okafor invited you to advise Wildcat Beekeeping Society", "Frank Okafor invited you to be the faculty advisor for Wildcat Beekeeping Society on Wildcat Clubs. Sign in with your Weber State account to accept or decline.", `/advisor/invite/${ctx.refs.beeInviteToken}`, 24 * 3.2);
  mail(e("frank"), "Board Game Guild is in WSUSA review", "Thanks for submitting Board Game Guild. WSUSA Clubs & Organizations reviews new clubs in about ten business days.", `/clubs/${ctx.club("boardgames").slug}/manage`, 24 * 5.1);
  mail(ctx.person(ctx.club("aviation").founderId).email, "Changes requested: Aviation Club", "WSUSA reviewed Aviation Club and asked for a couple of changes before approval. Open the club workspace to see the note.", `/clubs/${ctx.club("aviation").slug}/manage`, 24 * 6.3);
  for (const a of ctx.admins) mail(a.email, "Possible review bombing: Political Science Society", "3 reviews of 2★ or lower in the last 48 hours.", `/admin/reviews?club=${ctx.club("polisci").id}`, 9);
  for (const a of ctx.admins) mail(a.email, "Funding request: Finance & Investment Club — Fall speaker series", "A new funding request is waiting for review.", "/admin/funding", 24 * 5.2);
  mail(e("oscar"), "Your new role has required training", "Finish Club Officer Policy Test, Club Officer Training to keep your leadership permissions active.", "/tasks", 24 * 20.3);
  mail(e("maya"), "Voting is open: Psychology Club President", "Cast your secret ballot before voting closes.", `/clubs/${ctx.club("psych").slug}`, 50);
  mail(e("maya"), "Starting now: Care Kit Assembly for the Weber Cares Pantry", "Check in when you arrive.", `/events/${ctx.refs.liveEventId}`, 0.25, "PUSH");
  mail(e("vanessa"), "Co-host request from Cybersecurity Club", "Cybersecurity Club asked SWE to co-host “Women in Cybersecurity Panel”.", `/clubs/${ctx.club("swe").slug}/manage/events`, 30);
  mail(e("priya"), "Funding approved: Lunabotics competition travel", "WSUSA approved your request.", `/clubs/${ctx.club("robotics").slug}/manage/budget`, 24 * 9.3);
  for (const m of ctx.club("robotics").members.filter((x) => x.status === "ACTIVE" && x.joinedAt && x.joinedAt > addDays(NOW, -30)).slice(0, 4)) {
    mail(ctx.person(m.userId).email, "You're in! Welcome to Wildcat Robotics", "Your join request was approved.", `/clubs/${ctx.club("robotics").slug}`, (NOW.getTime() - m.joinedAt!.getTime()) / 3_600_000);
  }
  ctx.rows.outbox.push({ id: ctx.id(), channel: "PUSH", to: ctx.p("priya").id, subject: "New join requests for Wildcat Robotics", body: "5 people are waiting for approval.", href: `/clubs/${ctx.club("robotics").slug}/manage/members`, status: "FAILED", error: "Expo push token expired (DeviceNotRegistered).", createdAt: addHours(NOW, -10) });
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
    if (ev.createdAt >= since60) ctx.activity({ at: ev.createdAt, actorId: ev.createdById, action: ev.status === "DRAFT" ? "event.drafted" : "event.created", entityType: "event", entityId: ev.id, clubId: ev.clubId, data: { title: ev.title }, isPublic: ev.status === "SCHEDULED" && ev.visibility === "PUBLIC" });
    for (const o of ev.occurrences) {
      if (o.startsAt < since30) continue;
      for (const [userId, a] of o.attendees) {
        ctx.activity({ at: a.at, actorId: a.method === "MANUAL" ? a.recordedById : userId, action: "attendance.checkin", entityType: "attendance", entityId: a.id, clubId: ev.clubId, data: { occurrenceId: o.id, method: a.method, userId } });
      }
    }
  }
}

export function buildInbox(ctx: Ctx) {
  complaints(ctx);
  approvalTasks(ctx);
  todoTasks(ctx);
  personaNotifications(ctx);
  outbox(ctx);
  activity(ctx);
}
