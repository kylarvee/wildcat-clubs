import type { Ctx, ClubM } from "../ctx";
import { isQuiet } from "../data/clubs";
import { ANNOUNCEMENTS, BOMBING_REVIEWS, CHAT, REVIEWS } from "../data/text";
import { addDays, addHours, addMin, atLocal, minDate } from "../lib/dates";
import { seatsFor } from "@/lib/roles/defaults";
import { leadersBelow, nextInLine, type PipelineSeat } from "@/lib/roles/pipeline";
import { fmtDate } from "@/lib/time";
import { attendanceCounts } from "./attendance";
import { mayGraduation } from "./reference";

/**
 * Calendar subscriptions, reviews (with one review-bombing burst and one
 * hidden review), announcements, club chats and direct messages, and the
 * leadership pipeline in each of its four modes.
 */

export function buildSubscriptions(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const sam = ctx.p("sam").id;
  const seen = new Set<string>();
  const sub = (userId: string, clubId: string, at: Date) => {
    const k = `${userId}:${clubId}`;
    if (seen.has(k)) return;
    seen.add(k);
    ctx.rows.subscriptions.push({ userId, clubId, createdAt: at });
  };
  const current = ctx.people.filter((p) => p.kind === "STUDENT" && p.status === "ACTIVE" && p.id !== sam);
  for (const club of ctx.clubs.filter((c) => c.status === "APPROVED")) {
    for (const m of club.members) if (m.status === "ACTIVE" && m.joinedAt) sub(m.userId, club.id, m.joinedAt);
    // Some students follow a club's calendar without joining (a few dozen for a big club, a handful for a small one).
    const d = club.def;
    const extra = d.life === "dormant" ? rng.int(0, 2) : d.story ? Math.round(360 * rng.float(0.02, d.size > 50 ? 0.08 : 0.04)) : Math.round(Math.max(1, d.size) * rng.float(0.15, 0.6));
    for (const p of rng.sample(current.filter((s) => !club.byUser.has(s.id) && s.persona !== "maya"), extra)) {
      sub(p.id, club.id, addDays(NOW, -rng.float(1, 300)));
    }
  }
  sub(ctx.p("maya").id, ctx.club("anime").id, addDays(NOW, -33.2));
}

export function buildReviews(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const counts = attendanceCounts(ctx);
  const maya = ctx.p("maya").id;
  const reviewed = new Set<string>();
  const add = (club: ClubM, userId: string, rating: number, body: string | null, createdAt: Date, extra: { hiddenAt?: Date; hiddenReason?: string; updatedAt?: Date } = {}) => {
    const id = ctx.id();
    reviewed.add(`${club.id}:${userId}`);
    ctx.rows.reviews.push({ id, clubId: club.id, userId, rating, body, createdAt, updatedAt: extra.updatedAt ?? createdAt, hiddenAt: extra.hiddenAt ?? null, hiddenReason: extra.hiddenReason ?? null });
    ctx.activity({ at: createdAt, actorId: userId, action: "review.created", entityType: "review", entityId: id, clubId: club.id, data: { rating }, isPublic: true });
    return id;
  };

  // Maya already reviewed the climbing club.
  const climbing = ctx.club("climbing");
  add(climbing, maya, 5, "Saturday hikes are the highlight of my week. The trip leaders go over the route and safety plan with every new hiker and nobody makes you feel slow. Go on a trip if you can!", addDays(NOW, -21.3));

  for (const club of ctx.clubs.filter((c) => c.status === "APPROVED" && c.type !== "COLLEGE_AMBASSADORS" && c.def.life !== "pilot")) {
    const byUser = counts.get(club.id)!;
    const eligible = [...byUser.entries()].filter(([u, c]) => c.count >= 3 && ctx.person(u).kind === "STUDENT" && !ctx.person(u).persona && club.byUser.has(u));
    const target = isQuiet(club.def.life) ? rng.int(0, 2) : Math.min(25, Math.round(Math.min(eligible.length * 0.35, 4 + club.def.size / 4)));
    const mean = club.def.key === "discgolf" ? 4.0 : rng.float(3.6, 4.7);
    for (const [userId, c] of rng.sample(eligible, target)) {
      const lo = addDays(c.third!, 1);
      const hi = minDate(addDays(NOW, -3), addDays(c.last ?? NOW, 60));
      if (hi <= lo) continue;
      const createdAt = new Date(lo.getTime() + rng.next() * (hi.getTime() - lo.getTime()));
      // Low ratings only on the fictional demo clubs: nothing negative is invented about a real club.
      const rating = Math.max(club.def.dir ? 3 : 1, Math.min(5, Math.round(rng.normal(mean, 0.85))));
      const bank = REVIEWS[rating as 1 | 2 | 3 | 4 | 5];
      const body = rng.chance(0.78) ? rng.pick(bank).replace("{club}", club.name) : null;
      const edited = rng.chance(0.1) ? minDate(addDays(createdAt, rng.float(2, 40)), addDays(NOW, -3)) : createdAt;
      add(club, userId, rating, body, createdAt, { updatedAt: edited });
    }
  }

  // Ogden Valley Disc Golf Club (fictional demo club): four 1★ reviews within the last 36 hours.
  const polisci = ctx.club("discgolf");
  const pcounts = counts.get(polisci.id)!;
  const bombers = rng.sample(
    [...pcounts.entries()].filter(([u, c]) => c.count >= 3 && !reviewed.has(`${polisci.id}:${u}`) && !ctx.person(u).persona && ctx.person(u).kind === "STUDENT").map(([u]) => u),
    4,
  );
  const times = [rng.float(30, 35), rng.float(20, 28), rng.float(9, 16), rng.float(2, 6)].map((h) => addHours(NOW, -h));
  const bombIds = bombers.map((u, i) => add(polisci, u, 1, BOMBING_REVIEWS[i], times[i]));
  const flaggers = polisci.members.filter((m) => m.status === "ACTIVE" && !bombers.includes(m.userId) && !ctx.person(m.userId).persona).map((m) => m.userId);
  bombIds.forEach((reviewId, i) => {
    for (const u of rng.sample(flaggers, rng.int(2, 3))) {
      ctx.rows.reviewFlags.push({
        id: ctx.id(), reviewId, userId: u,
        reason: rng.pick(["Looks coordinated — four 1-star reviews in a day from people who barely come.", "This isn't what rounds are like. Seems like a pile-on.", "Brand-new reviews, all the same complaint, all within hours."]),
        createdAt: minDate(addHours(times[i], rng.float(1, 6)), addMin(NOW, -5)),
      });
    }
  });
  if (bombIds.length >= 3) {
    // Opened when the third low rating landed, as lib/domain/reviews.ts does.
    const at = times[2];
    const href = `/admin/reviews?club=${polisci.id}`;
    const description = "3 reviews of 2★ or lower in the last 48 hours. Check whether they're genuine before deciding whether to hide any.";
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: `Possible review bombing: ${polisci.name}`, description, assigneeType: "ADMINS", clubId: polisci.id, href,
      status: "OPEN", sourceType: "reviewBombing", sourceId: polisci.id, createdAt: at,
    });
    for (const admin of ctx.admins) {
      ctx.rows.notifications.push({ id: ctx.id(), userId: admin.id, kind: "review.bombing", title: `Possible review bombing: ${polisci.name}`, body: description, href, createdAt: at, readAt: null });
    }
    ctx.activity({ at, actorId: null, action: "review.bombing_flagged", entityType: "club", entityId: polisci.id, clubId: polisci.id, data: { lowRatings: 3 } });
    ctx.refs.bombingAt = at.toISOString();
  }

  // One review hidden by an admin for a personal attack.
  // On the fictional Wildcat Paintball Club.
  const anime = ctx.club("paintball");
  const acounts = counts.get(anime.id)!;
  const hiddenBy = [...acounts.entries()].find(([u, c]) => c.count >= 3 && !reviewed.has(`${anime.id}:${u}`) && !ctx.person(u).persona && ctx.person(u).kind === "STUDENT");
  if (hiddenBy) {
    const createdAt = addDays(NOW, -26.4);
    const pres = ctx.person(ctx.leaderAt(anime, createdAt));
    const id = add(anime, hiddenBy[0], 1, `Total waste of time. ${pres.first} is a power-tripping joke and everyone knows it.`, createdAt, {
      hiddenAt: addDays(NOW, -24.8),
      hiddenReason: "Personal attack on a named member — hidden under the Review Integrity policy.",
    });
    for (const m of rng.sample(anime.members.filter((x) => x.status === "ACTIVE" && x.userId !== hiddenBy[0] && !ctx.person(x.userId).persona), 3)) {
      ctx.rows.reviewFlags.push({ id: ctx.id(), reviewId: id, userId: m.userId, reason: "Attacks a named officer.", createdAt: addHours(createdAt, rng.float(2, 30)) });
    }
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: `Review reported on ${anime.name}`, description: "3 people reported this review. Decide whether to keep or hide it.",
      assigneeType: "ADMINS", clubId: anime.id, href: `/admin/reviews?club=${anime.id}&review=${id}`, status: "DONE", sourceType: "reviewFlag", sourceId: id,
      createdAt: addHours(createdAt, 30), completedAt: addDays(NOW, -24.8), completedById: ctx.p("alex").id,
    });
    ctx.activity({ at: addDays(NOW, -24.8), actorId: ctx.p("alex").id, action: "review.hidden", entityType: "review", entityId: id, clubId: anime.id });
  }
}

export function buildAnnouncements(ctx: Ctx) {
  const { rng, NOW } = ctx;
  for (const club of ctx.clubs.filter((c) => c.status === "APPROVED" && c.def.life !== "dormant")) {
    const n = club.def.life === "inactive" ? rng.int(0, 1) : club.def.life === "small" ? rng.int(0, 2) : rng.int(2, 6);
    const picks = rng.sample(ANNOUNCEMENTS, n);
    picks.forEach((a, i) => {
      const createdAt = club.def.life === "inactive" ? addDays(NOW, -rng.float(120, 300)) : addDays(NOW, -rng.float(1, 58));
      if (createdAt < (club.approvedAt ?? NOW)) return;
      const comms = ctx.holderAt(club, "Communications Officer", createdAt);
      const author = comms && rng.chance(0.6) ? comms : ctx.leaderAt(club, createdAt);
      const leaders = "leaders" in a && a.leaders;
      ctx.rows.announcements.push({
        id: ctx.id(), clubId: club.id, authorId: author, title: a.title,
        bodyHtml: a.body(club.name, `${ctx.buildings.get(club.def.meeting.building)?.name ?? "Shepherd Union"} ${club.def.meeting.room}`),
        audience: leaders ? "LEADERS" : rng.chance(0.4) ? "PUBLIC" : "MEMBERS", pinned: i === 0 && rng.chance(0.35), createdAt, updatedAt: createdAt,
      });
    });
  }
  const alex = ctx.p("alex").id;
  const makeup = ctx.universityEvents.find((e) => e.id === ctx.refs.trainingEventId)!.occurrences.find((o) => o.note && o.startsAt > ctx.NOW)!;
  ctx.rows.announcements.push(
    {
      id: ctx.id(), clubId: null, authorId: alex, title: "Club Officer Training: makeup session added",
      bodyHtml: `<p>Took an officer role after this semester's training? A makeup session of <strong>Club Officer Training</strong> is on the calendar for <strong>${makeup.startsAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Denver" })} at 5:30 PM</strong> in the Shepherd Union, Room 404A.</p><ul><li>Check in at the door — that's what marks your requirement complete.</li><li>Officers, VPs and presidents need one session each academic year.</li></ul>`,
      audience: "PUBLIC", pinned: true, createdAt: addDays(NOW, -4.2), updatedAt: addDays(NOW, -4.2),
    },
    {
      id: ctx.id(), clubId: null, authorId: alex, title: "Spring 2027 funding requests open November 1",
      bodyHtml: "<p>WSUSA will start reviewing <strong>Spring 2027</strong> funding requests on November 1. Add your event costs in the Events Builder and general costs in the Budget tool now so your treasurer can submit early.</p><p>New treasurer? Take the <em>Funding Rules Refresher</em> (five questions) first.</p>",
      audience: "PUBLIC", pinned: false, createdAt: addDays(NOW, -12.3), updatedAt: addDays(NOW, -12.3),
    },
  );
}

export function buildMessaging(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const personaIds = new Set(["maya", "oscar", "vanessa", "priya", "amir", "frank", "elena"].map((k) => ctx.p(k).id));
  for (const club of ctx.clubs.filter((c) => c.status === "APPROVED" && c.def.life !== "dormant")) {
    const convoId = ctx.id();
    const active = club.members.filter((m) => m.status === "ACTIVE" && m.joinedAt && m.joinedAt < addDays(NOW, -1));
    if (!active.length) continue;
    const n = club.def.life === "inactive" ? rng.int(3, 8) : club.def.life === "small" ? rng.int(2, 8) : rng.int(10, 40);
    const leaders = club.assignments.filter((a) => !a.endedAt).map((a) => a.userId);
    const bank = [...CHAT.general, ...CHAT[club.def.topic]];
    const msgs: { at: Date; author: string; body: string }[] = [];
    const span = club.def.life === "inactive" ? 200 : 21;
    for (let i = 0; i < n; i++) {
      const at = addMin(NOW, -rng.float(30, span * 24 * 60));
      const author = leaders.length && rng.chance(0.4) ? rng.pick(leaders) : rng.weighted(active, (m) => m.eng.base).userId;
      if ((club.byUser.get(author)?.joinedAt ?? NOW) > at) continue;
      msgs.push({ at, author, body: rng.pick(bank) });
    }
    msgs.sort((a, b) => a.at.getTime() - b.at.getTime());
    ctx.rows.conversations.push({ id: convoId, type: "CLUB", clubId: club.id, title: null, createdAt: club.approvedAt!, lastMessageAt: msgs.at(-1)?.at ?? club.approvedAt! });
    for (const m of msgs) ctx.rows.messages.push({ id: ctx.id(), conversationId: convoId, authorId: m.author, body: m.body, createdAt: m.at });
    // Read markers: personas (Maya has a few unread in Psi Chi) and some regulars.
    const readers = new Set([...active.filter((m) => personaIds.has(m.userId)).map((m) => m.userId), ...rng.sample(active, 8).map((m) => m.userId)]);
    for (const u of readers) {
      const unread = u === ctx.p("maya").id && club.def.key === "psych" ? 3 : rng.int(0, 4);
      const lastRead = msgs.length > unread ? msgs[msgs.length - 1 - unread].at : club.approvedAt!;
      ctx.rows.conversationMembers.push({ conversationId: convoId, userId: u, joinedAt: club.byUser.get(u)!.joinedAt!, lastReadAt: lastRead });
    }
    ctx.refs[`clubConvo:${club.def.key}`] = convoId;
  }

  const thread = (type: "DIRECT" | "LEADERS_GROUP", title: string | null, members: string[], lines: [number, string][], daysAgo: number, unreadFor?: { userId: string; count: number }) => {
    const id = ctx.id();
    const start = addDays(NOW, -daysAgo);
    const msgs = lines.map(([who, body], i) => ({ author: members[who], body, at: addMin(start, (i * (daysAgo * 24 * 60 - 60)) / Math.max(1, lines.length - 1) + rng.float(0, 20)) }));
    const last = msgs.at(-1)!.at;
    ctx.rows.conversations.push({ id, type, clubId: null, title, createdAt: start, lastMessageAt: last });
    for (const m of msgs) ctx.rows.messages.push({ id: ctx.id(), conversationId: id, authorId: m.author, body: m.body, createdAt: m.at });
    for (const u of members) {
      const unread = unreadFor?.userId === u ? unreadFor.count : 0;
      ctx.rows.conversationMembers.push({ conversationId: id, userId: u, joinedAt: start, lastReadAt: msgs[msgs.length - 1 - unread]?.at ?? start });
    }
    return id;
  };
  const maya = ctx.p("maya").id;
  const priya = ctx.p("priya").id;
  const vanessa = ctx.p("vanessa").id;
  ctx.refs.dmMayaPriya = thread("DIRECT", null, [maya, priya], [
    [1, "Hey! Are you going on the Waterfall Canyon hike Saturday?"],
    [0, "Yes!! Do you still have room in your car?"],
    [1, "One seat left, it's yours. Leaving the Stromberg lot at 8"],
    [0, "Perfect, I'll wear actual hiking boots this time 😅"],
    [1, "Also random q — do you know anyone in Psi Chi who'd want to help with our robot outreach day? We need people good with kids"],
    [0, "Totally, I'll ask at our meeting Wednesday"],
    [1, "You're the best. It's on the calendar as Girls in STEM Robot Day"],
    [0, "Saw it! Sharing it in our club chat"],
    [1, "Thanks! See you Saturday 🥾"],
  ], 9, { userId: maya, count: 1 });
  ctx.refs.dmPriyaVanessa = thread("DIRECT", null, [priya, vanessa], [
    [0, "Hi Vanessa! Want to co-host the Girls in STEM Robot Day again this year?"],
    [1, "Absolutely. Same as last year — SWE brings mentors, you bring robots?"],
    [0, "Yes. I'll send the co-host request from the Events Builder so it lands on your calendar"],
    [1, "Approved 👍 Our president is graduating in December btw, so I'll be your main contact"],
    [0, "Congrats in advance! Who's running for president?"],
    [1, "Leadership vote just closed — results are up, waiting on her to apply them"],
    [0, "Nice. Also Cyber Club asked if SWE wants to co-host their women in cyber panel, did you see it?"],
    [1, "Just saw the request in my tasks. Going to say yes after I check the date"],
    [0, "Let me know if you need Wrecker Bots folks there too"],
    [1, "Will do, thanks Priya!"],
  ], 14);
  const pres = (key: string) => ctx.clubByKey.get(key)!.assignments.find((a) => a.role === "PRESIDENT" && !a.endedAt)?.userId;
  // Fixed slots (Priya, SWE, CSWS, Cyber Security Club, Weber Racing, EAST Ambassadors); a slot without a distinct president falls back to Priya.
  const slots = [priya, pres("swe"), pres("acm"), pres("cyber"), pres("motorsports"), pres("east-amb")].map((x) => x ?? priya);
  const members = [...new Set(slots)];
  const lines: [number, string][] = [
    [0, "Hi all — starting this so EAST club presidents can coordinate dates. Please post big events here before you book."],
    [1, "Great idea. SWE's outreach day is Nov 7 at Noorda."],
    [2, "CSWS hackathon planning starts next month, probably late February."],
    [3, "CSC's women in cyber panel is next week — co-host request is out to SWE."],
    [0, "Wrecker Bots has the makerspace Tuesdays and our competition design review Thursday night."],
    [4, "Weber Racing is mostly at the Davis shop, but we'd love to borrow a few Wrecker Bots people for wiring."],
    [5, "EAST Ambassadors can promote anything you post here in the college newsletter."],
    [0, "Perfect, thanks everyone 🙌"],
    [2, "Can someone share the room booking contact for Noorda 308?"],
    [0, "It's in the EAST Ambassadors files under Resources"],
  ];
  ctx.refs.leadersGroup = thread("LEADERS_GROUP", "Engineering club presidents", members, lines.map(([slot, body]) => [members.indexOf(slots[slot]), body] as [number, string]), 20);
}

/**
 * The leadership pipeline in every mode the Elections tool handles:
 *   Psi Chi (psych)      MEMBER_VOTE, voting open now (Maya hasn't voted).
 *   SWE (swe)            SELF_SELECT, closed and unanimous, waiting for a President (not the VP) to apply it.
 *   Wrecker Bots         ADVISOR_PRESIDENT: the VP stepped down, Priya proposed a successor, Dr. Alvarez is to confirm.
 *   Wildcat Investors    NEXT_IN_LINE: the VP stepped down; one officer said yes, Oscar hasn't answered, one said no.
 *   Applied AI Lab       two applied member votes in its history.
 * Candidates on the org chart below the seat are added from the pipeline, in
 * pipeline order (lib/roles/pipeline), as the app does.
 */
export function buildElections(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const seat = (club: ClubM, name: string) => club.seats.get(name)!;
  const candidate = (electionId: string, userId: string, statement: string | null, nominatedById: string, at: Date, extra: { fromPipeline?: boolean; acceptedAt?: Date | null } = {}) => {
    const id = ctx.id();
    ctx.rows.candidates.push({ id, electionId, userId, statement, nominatedById, createdAt: at, fromPipeline: extra.fromPipeline ?? false, acceptedAt: extra.acceptedAt ?? null });
    return id;
  };
  const votesFor = (electionId: string, voters: string[], cands: { id: string; userId: string; weight: number }[], from: Date, to: Date, noSelf = false) => {
    let total = 0;
    for (const v of voters) {
      const options = noSelf ? cands.filter((c) => c.userId !== v) : cands;
      if (!options.length) continue;
      const c = rng.weighted(options, (x) => x.weight);
      ctx.rows.votes.push({ id: ctx.id(), electionId, voterId: v, candidateId: c.id, createdAt: new Date(from.getTime() + rng.next() * (to.getTime() - from.getTime())) });
      total++;
    }
    return total;
  };
  const current = (club: ClubM, seatName: string) => club.assignments.find((a) => a.seatName === seatName && !a.endedAt)?.userId ?? null;
  /** The club's seats as lib/roles/pipeline sees them: chart order, with today's student holders. */
  const pipelineOf = (club: ClubM): PipelineSeat[] =>
    seatsFor(club.type).map((t, i) => {
      const s = seat(club, t.name);
      const holders = club.assignments.filter((a) => a.positionId === s.id && !a.endedAt && ctx.person(a.userId).kind === "STUDENT" && ctx.person(a.userId).status === "ACTIVE");
      return { id: s.id, role: s.role, name: s.name, sortOrder: i, holders: holders.map((a) => ({ userId: a.userId, assignmentId: a.id, startedAt: a.startedAt })) };
    });
  /** A leader steps down from a seat, opening it in the pipeline. */
  const stepDown = (club: ClubM, seatName: string, at: Date) => {
    for (const a of club.assignments.filter((x) => x.seatName === seatName && !x.endedAt)) {
      a.endedAt = at;
      a.endReason = "RESIGNED";
    }
  };
  const termName = ctx.termFor(NOW).name;
  const leaderIds = (club: ClubM) => [...new Set(club.assignments.filter((a) => !a.endedAt && ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"].includes(a.role) && ctx.person(a.userId).kind === "STUDENT" && ctx.person(a.userId).status === "ACTIVE").map((a) => a.userId))];

  // ─── Psi Chi (psych): President, member vote, voting open now (Maya hasn't voted) ───
  {
    const club = ctx.club("psych");
    const id = ctx.id();
    const opens = addDays(NOW, -2.1);
    const closes = addDays(NOW, 5);
    const advisor = club.advisorIds[0];
    const createdAt = addDays(NOW, -12.2);
    ctx.rows.elections.push({
      id, clubId: club.id, positionId: seat(club, "President").id, title: "President — Spring 2027", method: "MEMBER_VOTE", status: "VOTING",
      votingOpensAt: opens, votingClosesAt: closes, createdById: advisor, createdAt,
    });
    ctx.refs.psychElectionId = id;
    // The officers below the President start on the ballot from the org chart; one more member ran.
    const pipeline = leadersBelow(pipelineOf(club), seat(club, "President").id, club.type).map((p) => p.userId).filter((u) => !ctx.person(u).persona);
    const others = club.members.filter((m) => m.status === "ACTIVE" && !ctx.person(m.userId).persona && ctx.person(m.userId).kind === "STUDENT" && (ctx.person(m.userId).gradDate ?? NOW) > addDays(NOW, 200)).sort((a, b) => b.eng.base - a.eng.base).map((m) => m.userId);
    const names = [...new Set([...pipeline, ...others])].filter((u) => u !== ctx.refs.psychPresident).slice(0, 3);
    const statements = [
      "I've run our research spotlight series this year and want to grow it into a real mentoring program with faculty labs.",
      "More socials, more grad-school help, and meetings that start and end on time. I'll listen first.",
      "I want Psych Club to partner with CAPS on mental health week and bring back the end-of-year banquet.",
    ];
    const cands = names.map((u, i) => {
      const at = addDays(NOW, -rng.float(4, 10));
      const fromPipeline = pipeline.includes(u);
      return { id: candidate(id, u, statements[i], fromPipeline ? advisor : u, fromPipeline ? new Date(createdAt.getTime() + i) : at, { fromPipeline }), userId: u, weight: [1.4, 1, 0.8][i] };
    });
    const voters = rng.sample(club.members.filter((m) => m.status === "ACTIVE" && m.userId !== ctx.p("maya").id && ctx.person(m.userId).kind === "STUDENT").map((m) => m.userId), 19);
    votesFor(id, voters, cands, opens, NOW);
    ctx.activity({ at: createdAt, actorId: advisor, action: "election.created", entityType: "election", entityId: id, clubId: club.id, data: { title: "President — Spring 2027", seat: "President", method: "MEMBER_VOTE", candidates: pipeline.length }, isPublic: true });
  }

  // ─── SWE: self-select, closed and unanimous, waiting for its President, its advisor or an admin (not the VP) to apply it ───
  {
    const club = ctx.club("swe");
    const id = ctx.id();
    const createdAt = addDays(NOW, -13.4);
    const opens = addDays(NOW, -9.2);
    const closes = addDays(NOW, -2.1);
    const advisor = club.advisorIds[0];
    const president = seat(club, "President");
    // Everyone below the President started on the list; all but two withdrew (Vanessa would rather stay VP).
    const pipeline = leadersBelow(pipelineOf(club), president.id, club.type);
    const stay = pipeline.filter((p) => !ctx.person(p.userId).persona && p.role === "OFFICER").slice(0, 2);
    const [a, b] = stay.length === 2 ? stay.map((p) => p.userId) : [...stay.map((p) => p.userId), ...club.members.filter((m) => m.status === "ACTIVE" && !ctx.person(m.userId).persona && ctx.person(m.userId).kind === "STUDENT" && m.userId !== ctx.refs.swePresident && !stay.some((p) => p.userId === m.userId)).map((m) => m.userId)].slice(0, 2);
    ctx.rows.elections.push({
      id, clubId: club.id, positionId: president.id, title: "President — Spring 2027", method: "SELF_SELECT", status: "CLOSED",
      votingOpensAt: opens, votingClosesAt: closes, createdById: advisor, createdAt,
    });
    ctx.refs.sweElectionId = id;
    ctx.activity({ at: createdAt, actorId: advisor, action: "election.created", entityType: "election", entityId: id, clubId: club.id, data: { title: "President — Spring 2027", seat: "President", method: "SELF_SELECT", candidates: pipeline.length }, isPublic: true });
    pipeline.forEach((p, i) => {
      if (p.userId === a || p.userId === b) return;
      ctx.activity({ at: addDays(createdAt, 1 + i * 0.4), actorId: p.userId, action: "election.withdrawn", entityType: "election", entityId: id, clubId: club.id, data: { userId: p.userId, self: true } });
    });
    const order = (u: string) => {
      const i = pipeline.findIndex((p) => p.userId === u);
      return i === -1 ? pipeline.length : i;
    };
    const ca = candidate(id, a, "I've organized our outreach days for two years. I want SWE at every Ogden middle school by spring.", advisor, new Date(createdAt.getTime() + order(a)), { fromPipeline: order(a) < pipeline.length });
    candidate(id, b, "Let's grow our mentoring circles and get more members to the national conference.", advisor, new Date(createdAt.getTime() + order(b)), { fromPipeline: order(b) < pipeline.length });
    // Unanimous: every leader but the choice voted, all for them (nobody votes for themselves).
    const leaders = leaderIds(club);
    const voters = leaders.filter((u) => u !== a);
    for (const v of voters) ctx.rows.votes.push({ id: ctx.id(), electionId: id, voterId: v, candidateId: ca, createdAt: new Date(opens.getTime() + rng.next() * (closes.getTime() - opens.getTime())) });
    // Frozen when voting closed, as lib/domain/elections does.
    ctx.activity({ at: closes, actorId: null, action: "election.closed", entityType: "election", entityId: id, clubId: club.id, data: { votes: voters.length, eligibleVoters: leaders.length, unanimous: ca } });
  }

  // ─── RC Wrecker Bots (robotics): Advisor & President. The VP stepped down; Priya proposed a successor; Dr. Alvarez confirms ───
  {
    const club = ctx.club("robotics");
    const priya = ctx.p("priya");
    const vp = seat(club, "Vice President");
    stepDown(club, "Vice President", addDays(NOW, -9.3));
    const id = ctx.id();
    const createdAt = addDays(NOW, -6.2);
    const proposedAt = addDays(NOW, -1.8);
    const decideBy = atLocal(addDays(NOW, 8), 17);
    const title = `Vice President — ${termName}`;
    const pipeline = leadersBelow(pipelineOf(club), vp.id, club.type);
    const ids = pipeline.map((p, i) => candidate(id, p.userId, null, priya.id, new Date(createdAt.getTime() + i), { fromPipeline: true }));
    // Priya proposed the first officer in pipeline order.
    const pick = pipeline[0];
    ctx.rows.elections.push({
      id, clubId: club.id, positionId: vp.id, title, method: "ADVISOR_PRESIDENT", status: "NOMINATING",
      votingOpensAt: createdAt, votingClosesAt: decideBy, createdById: priya.id, createdAt,
      proposedCandidateId: ids[0], proposedById: priya.id, proposedAt,
    });
    ctx.refs.roboticsProposalId = id;
    const href = `/clubs/${club.slug}/manage/elections/${id}`;
    const memberHref = `/clubs/${club.slug}/elections/${id}`;
    const pickName = ctx.person(pick.userId).name;
    ctx.activity({ at: createdAt, actorId: priya.id, action: "election.created", entityType: "election", entityId: id, clubId: club.id, data: { title, seat: vp.name, method: "ADVISOR_PRESIDENT", candidates: pipeline.length }, isPublic: true });
    ctx.activity({ at: proposedAt, actorId: priya.id, action: "election.proposed", entityType: "election", entityId: id, clubId: club.id, data: { userId: pick.userId } });
    const advisors = club.assignments.filter((a) => a.role === "ADVISOR" && !a.endedAt).map((a) => a.userId);
    for (const advisorId of advisors) {
      ctx.rows.tasks.push({
        id: ctx.id(), kind: "APPROVAL", title: `Confirm ${pickName} as ${vp.name}`,
        description: `${priya.name} proposed ${pickName} for ${vp.name} of ${club.name}. Confirming puts them in the seat; you can also send it back.`,
        assigneeType: "USER", assigneeId: advisorId, clubId: club.id, href, dueAt: decideBy, status: "OPEN",
        sourceType: "electionProposal", sourceId: id, createdById: priya.id, createdAt: proposedAt,
      });
      ctx.rows.notifications.push({ id: ctx.id(), userId: advisorId, kind: "election.proposed", title: `Waiting on you: ${pickName} for ${vp.name}`, body: `${priya.name} proposed ${pickName} for ${vp.name} of ${club.name}. Confirm it, or send it back.`, href, createdAt: proposedAt, readAt: null });
    }
    for (const p of pipeline) {
      ctx.rows.notifications.push({ id: ctx.id(), userId: p.userId, kind: "election.candidate_added", title: `You're a candidate for ${vp.name}`, body: `You're on ${club.name}'s org chart below ${vp.name}, so you're a candidate automatically. You can withdraw if you'd rather not.`, href: memberHref, createdAt, readAt: addHours(createdAt, 3) });
    }
    ctx.rows.notifications.push({ id: ctx.id(), userId: pick.userId, kind: "election.proposed", title: `You've been proposed for ${vp.name}`, body: `${priya.name} proposed you for ${vp.name} of ${club.name}. It takes effect once it's confirmed. You can withdraw if you'd rather not.`, href: memberHref, createdAt: proposedAt, readAt: null });
  }

  // ─── Wildcat Investors (fic): Next in line. The VP stepped down; the officers were asked to move up ───
  {
    const club = ctx.club("fic");
    const vp = seat(club, "Vice President");
    stepDown(club, "Vice President", addDays(NOW, -10.4));
    const president = current(club, "President") ?? club.advisorIds[0];
    const id = ctx.id();
    const createdAt = addDays(NOW, -8.1);
    const respondBy = atLocal(addDays(NOW, 3.9), 17);
    const title = `Vice President — ${termName}`;
    const asked = nextInLine(pipelineOf(club), vp.id, club.type);
    const oscar = ctx.p("oscar").id;
    // One officer behind Oscar (Treasurer) in line said yes; Oscar hasn't answered; everyone else said no.
    // If Oscar says yes before answers close, he's ahead of them in line and moves up instead.
    const yesAt = addDays(NOW, -5.2);
    const yes = asked.find((p) => p.userId !== oscar && asked.indexOf(p) > asked.findIndex((x) => x.userId === oscar)) ?? asked.find((p) => p.userId !== oscar);
    const declined = new Set(asked.filter((p) => p.userId !== oscar && p !== yes));
    ctx.rows.elections.push({
      id, clubId: club.id, positionId: vp.id, title, method: "NEXT_IN_LINE", status: "VOTING",
      votingOpensAt: createdAt, votingClosesAt: respondBy, createdById: president, createdAt,
    });
    ctx.refs.ficNextInLineId = id;
    const memberHref = `/clubs/${club.slug}/elections/${id}`;
    ctx.activity({ at: createdAt, actorId: president, action: "election.created", entityType: "election", entityId: id, clubId: club.id, data: { title, seat: vp.name, method: "NEXT_IN_LINE", candidates: asked.length }, isPublic: true });
    asked.forEach((p, i) => {
      const said = declined.has(p) ? "no" : p === yes ? "yes" : null;
      // Saying no takes them off the list, so only the others keep a row.
      const candidateId = said === "no" ? ctx.id() : candidate(id, p.userId, null, president, new Date(createdAt.getTime() + i), { fromPipeline: true, acceptedAt: said === "yes" ? yesAt : null });
      const answeredAt = said === "no" ? addDays(NOW, -6.5 + i * 0.3) : said === "yes" ? yesAt : null;
      const declinedHere = said === "no";
      ctx.rows.tasks.push({
        id: ctx.id(), kind: "APPROVAL", title: `Move up to ${vp.name}?`,
        description: `You're next in line in ${club.name}. Say yes or no by ${fmtDate(respondBy, "EEE, MMM d 'at' h:mm a")}; the first in line who says yes takes the seat.`,
        assigneeType: "USER", assigneeId: p.userId, clubId: club.id, href: memberHref, dueAt: respondBy, status: answeredAt ? "DONE" : "OPEN",
        sourceType: "electionAnswer", sourceId: candidateId, createdById: president, createdAt,
        completedAt: answeredAt, completedById: answeredAt ? p.userId : null,
      });
      ctx.rows.notifications.push({
        id: ctx.id(), userId: p.userId, kind: "election.next_in_line", title: `Move up to ${vp.name} of ${club.name}?`,
        body: `You're next in line. Say yes or no by ${fmtDate(respondBy, "EEE, MMM d 'at' h:mm a")}. The first in line who says yes takes the seat.`,
        href: memberHref, createdAt, readAt: answeredAt ?? null,
      });
      if (answeredAt) ctx.activity({ at: answeredAt, actorId: p.userId, action: declinedHere ? "election.declined" : "election.accepted", entityType: "election", entityId: id, clubId: club.id, data: { userId: p.userId, ...(declinedHere ? { self: true } : {}) } });
    });
    if (yes) ctx.rows.notifications.push({ id: ctx.id(), userId: president, kind: "election.accepted", title: `${ctx.person(yes.userId).name} said yes to moving up to ${vp.name}`, body: `The first in line who says yes by ${fmtDate(respondBy, "EEE, MMM d 'at' h:mm a")} takes the seat.`, href: `/clubs/${club.slug}/manage/elections/${id}`, createdAt: yesAt, readAt: null });
  }

  // ─── Applied AI Lab: two applied presidential elections in its history ───
  {
    const club = ctx.club("ailab");
    const gwen = ctx.p("gwen").id;
    for (const [year, winner, title] of [[2024, gwen, "President — 2024–2025"], [2026, ctx.refs.ailabPresident, "President — 2026–2027"]] as [number, string, string][]) {
      const h = mayGraduation(year);
      const opens = addDays(h, -21);
      const closes = addDays(h, -14);
      const id = ctx.id();
      const atTime = club.members.filter((m) => m.joinedAt && m.joinedAt < opens && (!m.endedAt || m.endedAt > closes) && ctx.person(m.userId).kind === "STUDENT");
      const others = atTime.filter((m) => m.userId !== winner && (ctx.person(m.userId).gradDate ?? NOW) > addDays(h, 120) && !ctx.person(m.userId).persona).map((m) => m.userId);
      const runners = rng.sample(others, year === 2026 ? 2 : 1);
      const creator = ctx.leaderAt(club, addDays(opens, -7));
      ctx.rows.elections.push({
        id, clubId: club.id, positionId: seat(club, "President").id, title, method: "MEMBER_VOTE", status: "APPLIED",
        votingOpensAt: opens, votingClosesAt: closes, winnerId: winner, createdById: creator, createdAt: addDays(opens, -10), appliedAt: h,
      });
      const cands = [winner, ...runners].map((u, i) => ({
        id: candidate(id, u, i === 0 ? "Keep the Lab hands-on: every member on a real project by week four." : "More workshops for beginners and better project matching.", creator, addDays(opens, -6)),
        userId: u,
        weight: i === 0 ? 3 : 1,
      }));
      votesFor(id, rng.sample(atTime.map((m) => m.userId), Math.min(atTime.length, year === 2026 ? 31 : 18)), cands, opens, closes);
      ctx.activity({ at: h, actorId: creator, action: "election.applied", entityType: "election", entityId: id, clubId: club.id, data: { title, method: "MEMBER_VOTE", seat: "President", winnerId: winner }, isPublic: true });
    }
  }
}
