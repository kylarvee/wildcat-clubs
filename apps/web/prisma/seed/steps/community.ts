import type { Ctx, ClubM } from "../ctx";
import { ANNOUNCEMENTS, BOMBING_REVIEWS, CHAT, REVIEWS } from "../data/text";
import { addDays, addHours, addMin, minDate } from "../lib/dates";
import { attendanceCounts } from "./attendance";
import { mayGraduation } from "./reference";

/**
 * Calendar subscriptions, reviews (with one review-bombing burst and one
 * hidden review), announcements, club chats and direct messages, and
 * elections in every state the Elections tool handles.
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
    // Some students follow a club's calendar without joining.
    const extra = Math.round(current.length * rng.float(0.02, club.def.size > 50 ? 0.08 : 0.04));
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
  add(climbing, maya, 5, "Wall nights are the highlight of my week. The officers teach every new climber how to belay safely and nobody makes you feel slow. Go to a trip if you can!", addDays(NOW, -21.3));

  for (const club of ctx.clubs.filter((c) => c.status === "APPROVED" && c.type !== "COLLEGE_AMBASSADORS" && c.def.life !== "pilot")) {
    const byUser = counts.get(club.id)!;
    const eligible = [...byUser.entries()].filter(([u, c]) => c.count >= 3 && ctx.person(u).kind === "STUDENT" && !ctx.person(u).persona && club.byUser.has(u));
    const target = club.def.life === "inactive" ? rng.int(0, 2) : Math.min(25, Math.round(Math.min(eligible.length * 0.35, 4 + club.def.size / 4)));
    const mean = club.def.key === "polisci" ? 4.0 : rng.float(3.6, 4.7);
    for (const [userId, c] of rng.sample(eligible, target)) {
      const lo = addDays(c.third!, 1);
      const hi = minDate(addDays(NOW, -3), addDays(c.last ?? NOW, 60));
      if (hi <= lo) continue;
      const createdAt = new Date(lo.getTime() + rng.next() * (hi.getTime() - lo.getTime()));
      const rating = Math.max(1, Math.min(5, Math.round(rng.normal(mean, 0.85))));
      const bank = REVIEWS[rating as 1 | 2 | 3 | 4 | 5];
      const body = rng.chance(0.78) ? rng.pick(bank).replace("{club}", club.name) : null;
      const edited = rng.chance(0.1) ? minDate(addDays(createdAt, rng.float(2, 40)), addDays(NOW, -3)) : createdAt;
      add(club, userId, rating, body, createdAt, { updatedAt: edited });
    }
  }

  // Political Science Society: four 1★ reviews within the last 36 hours.
  const polisci = ctx.club("polisci");
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
        reason: rng.pick(["Looks coordinated — four 1-star reviews in a day from people who barely come.", "This isn't what meetings are like. Seems like a pile-on.", "Brand-new reviews, all the same complaint, all within hours."]),
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
  const anime = ctx.club("anime");
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
  for (const club of ctx.clubs.filter((c) => c.status === "APPROVED")) {
    const n = club.def.life === "inactive" ? rng.int(0, 1) : rng.int(2, 6);
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
  for (const club of ctx.clubs.filter((c) => c.status === "APPROVED")) {
    const convoId = ctx.id();
    const active = club.members.filter((m) => m.status === "ACTIVE" && m.joinedAt && m.joinedAt < addDays(NOW, -1));
    if (!active.length) continue;
    const n = club.def.life === "inactive" ? rng.int(3, 8) : rng.int(10, 40);
    const leaders = club.assignments.filter((a) => !a.endedAt).map((a) => a.userId);
    const bank = [...CHAT.general, ...CHAT[club.def.category]];
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
    // Read markers: personas (Maya has a few unread in Psychology Club) and some regulars.
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
    [1, "Hey! Are you going on the Ogden Canyon trip Saturday?"],
    [0, "Yes!! Do you still have room in your car?"],
    [1, "One seat left, it's yours. Leaving the Stromberg lot at 8"],
    [0, "Perfect, I'll bring my own harness this time 😅"],
    [1, "Also random q — do you know anyone in Psych Club who'd want to help with our robot outreach day? We need people good with kids"],
    [0, "Totally, I'll ask at our meeting Wednesday"],
    [1, "You're the best. It's on the calendar as Girls in STEM Robot Day"],
    [0, "Saw it! Sharing it in our club chat"],
    [1, "Thanks! See you Saturday 🧗"],
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
    [0, "Let me know if you need Robotics folks there too"],
    [1, "Will do, thanks Priya!"],
  ], 14);
  const pres = (key: string) => ctx.clubByKey.get(key)!.assignments.find((a) => a.role === "PRESIDENT" && !a.endedAt)?.userId;
  // Fixed slots (Priya, SWE, ACM, Cyber, Motorsports, EAST Ambassadors); a slot without a distinct president falls back to Priya.
  const slots = [priya, pres("swe"), pres("acm"), pres("cyber"), pres("motorsports"), pres("east-amb")].map((x) => x ?? priya);
  const members = [...new Set(slots)];
  const lines: [number, string][] = [
    [0, "Hi all — starting this so EAST club presidents can coordinate dates. Please post big events here before you book."],
    [1, "Great idea. SWE's outreach day is Nov 7 at Noorda."],
    [2, "ACM hackathon planning starts next month, probably late February."],
    [3, "Cyber Club's women in cyber panel is next week — co-host request is out to SWE."],
    [0, "Robotics has the makerspace Tuesdays and the Lunabotics review Thursday night."],
    [4, "Motorsports is mostly at Davis, but we'd love to borrow a few Robotics people for wiring."],
    [5, "EAST Ambassadors can promote anything you post here in the college newsletter."],
    [0, "Perfect, thanks everyone 🙌"],
    [2, "Can someone share the room booking contact for Noorda 308?"],
    [0, "It's in the EAST Ambassadors files under Resources"],
  ];
  ctx.refs.leadersGroup = thread("LEADERS_GROUP", "Engineering club presidents", members, lines.map(([slot, body]) => [members.indexOf(slots[slot]), body] as [number, string]), 20);
}

export function buildElections(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const seat = (club: ClubM, name: string) => club.seats.get(name)!;
  const candidate = (electionId: string, userId: string, statement: string, nominatedById: string, at: Date) => {
    const id = ctx.id();
    ctx.rows.candidates.push({ id, electionId, userId, statement, nominatedById, createdAt: at });
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

  // Psychology Club: President, member vote, voting open now (Maya hasn't voted).
  {
    const club = ctx.club("psych");
    const id = ctx.id();
    const opens = addDays(NOW, -2.1);
    const closes = addDays(NOW, 5);
    const advisor = club.advisorIds[0];
    ctx.rows.elections.push({
      id, clubId: club.id, positionId: seat(club, "President").id, title: "President — Spring 2027", method: "MEMBER_VOTE", status: "VOTING",
      votingOpensAt: opens, votingClosesAt: closes, createdById: advisor, createdAt: addDays(NOW, -12.2),
    });
    ctx.refs.psychElectionId = id;
    const officerIds = ["Vice President", "Treasurer", "Secretary", "Events Coordinator", "Communications Officer", "Membership Officer"].map((s) => current(club, s)).filter((x): x is string => Boolean(x) && !ctx.person(x!).persona);
    const others = club.members.filter((m) => m.status === "ACTIVE" && !ctx.person(m.userId).persona && ctx.person(m.userId).kind === "STUDENT" && (ctx.person(m.userId).gradDate ?? NOW) > addDays(NOW, 200)).sort((a, b) => b.eng.base - a.eng.base).map((m) => m.userId);
    const names = [...new Set([...officerIds, ...others])].filter((u) => u !== ctx.refs.psychPresident).slice(0, 3);
    const statements = [
      "I've run our research spotlight series this year and want to grow it into a real mentoring program with faculty labs.",
      "More socials, more grad-school help, and meetings that start and end on time. I'll listen first.",
      "I want Psych Club to partner with CAPS on mental health week and bring back the end-of-year banquet.",
    ];
    const cands = names.map((u, i) => ({ id: candidate(id, u, statements[i], i === 0 ? u : ctx.refs.psychPresident, addDays(NOW, -rng.float(4, 10))), userId: u, weight: [1.4, 1, 0.8][i] }));
    const voters = rng.sample(club.members.filter((m) => m.status === "ACTIVE" && m.userId !== ctx.p("maya").id && ctx.person(m.userId).kind === "STUDENT").map((m) => m.userId), 19);
    votesFor(id, voters, cands, opens, NOW);
  }

  // Society of Women Engineers: leadership vote, closed, waiting for the result to be applied.
  {
    const club = ctx.club("swe");
    const id = ctx.id();
    const opens = addDays(NOW, -9.2);
    const closes = addDays(NOW, -2.1);
    const leaders = club.assignments.filter((a) => !a.endedAt && ["PRESIDENT", "VP", "OFFICER"].includes(a.role)).map((a) => a.userId);
    const officerCands = club.assignments.filter((a) => !a.endedAt && a.role === "OFFICER" && !ctx.person(a.userId).persona).map((a) => a.userId);
    const pool = officerCands.length >= 2 ? officerCands : [...officerCands, ...club.members.filter((m) => m.status === "ACTIVE" && !ctx.person(m.userId).persona && !officerCands.includes(m.userId) && ctx.person(m.userId).kind === "STUDENT" && m.userId !== ctx.refs.swePresident).map((m) => m.userId)];
    const [a, b] = pool;
    const cands = [
      { id: candidate(id, a, "I've organized our outreach days for two years. I want SWE at every Ogden middle school by spring.", ctx.refs.swePresident, addDays(NOW, -12)), userId: a, weight: 3 },
      { id: candidate(id, b, "Let's grow our mentoring circles and get more members to the national conference.", ctx.refs.swePresident, addDays(NOW, -12)), userId: b, weight: 1 },
    ];
    ctx.rows.elections.push({
      id, clubId: club.id, positionId: seat(club, "President").id, title: "President — Spring 2027", method: "LEADERSHIP_VOTE", status: "CLOSED",
      votingOpensAt: opens, votingClosesAt: closes, winnerId: a, createdById: club.advisorIds[0], createdAt: addDays(NOW, -13.4),
    });
    ctx.refs.sweElectionId = id;
    const cast = votesFor(id, [...new Set(leaders)], cands, opens, closes, true);
    // Make sure the recorded winner actually has the most votes.
    const tally = new Map<string, number>();
    for (const v of ctx.rows.votes.filter((x) => x.electionId === id)) tally.set(v.candidateId, (tally.get(v.candidateId) ?? 0) + 1);
    if ((tally.get(cands[1].id) ?? 0) >= (tally.get(cands[0].id) ?? 0)) {
      for (const v of ctx.rows.votes.filter((x) => x.electionId === id && x.candidateId === cands[1].id && x.voterId !== a)) {
        v.candidateId = cands[0].id;
        break;
      }
    }
    void cast;
  }

  // Applied AI Lab: two applied presidential elections in its history.
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
      ctx.activity({ at: h, actorId: creator, action: "election.applied", entityType: "election", entityId: id, clubId: club.id, data: { title, winnerId: winner }, isPublic: true });
    }
  }
}
