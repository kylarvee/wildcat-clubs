import type { EventKind, Visibility } from "@prisma/client";
import { expandOccurrences, type OccurrenceTimes } from "@/lib/events/recurrence";
import { generateCheckinSecret } from "@/lib/attendance/token";
import type { ClubM, Ctx, Ev, Occ } from "../ctx";
import { COLLEGE_BUILDINGS, OFFSITE } from "../data/reference";
import { DRAFT_IDEAS, EVENT_IDEAS, type EventIdea } from "../data/text";
import { addDays, addMin, calAdd, campusDate, DAY, floor5, local, maxDate, minDate } from "../lib/dates";
import { fallStart, holidayNote, springEnd } from "./reference";

/**
 * Events: a weekly or biweekly meeting series per club per semester (expanded
 * with the platform's own recurrence code, holidays cancelled), one-off
 * socials, workshops, service days and competitions, co-hosted events between
 * related clubs, idea drafts, university trainings — and a few events that are
 * happening right now so check-in can be tested immediately.
 */

const DOW_TIME: Partial<Record<EventKind, { dows: number[]; times: [number, number][] }>> = {
  SERVICE: { dows: [6], times: [[9, 0], [10, 0]] },
  SOCIAL: { dows: [4, 5], times: [[18, 30], [19, 0]] },
  WORKSHOP: { dows: [2, 3, 4], times: [[12, 0], [17, 30], [18, 0]] },
  COMPETITION: { dows: [6, 5], times: [[10, 0], [17, 0]] },
  FUNDRAISER: { dows: [3, 4], times: [[10, 0], [11, 0]] },
  TRAINING: { dows: [2, 3], times: [[17, 0]] },
  OTHER: { dows: [3, 4, 5], times: [[18, 0], [19, 0]] },
};

function meetLink(ctx: Ctx) {
  const a = "abcdefghijkmnopqrstuvwxyz";
  return `https://meet.google.com/${ctx.rng.string(a, 3)}-${ctx.rng.string(a, 4)}-${ctx.rng.string(a, 3)}`;
}

export function newEvent(ctx: Ctx, e: Partial<Ev> & Pick<Ev, "clubId" | "title" | "kind" | "createdById">): Ev {
  return {
    id: ctx.id(),
    descriptionHtml: null,
    status: "SCHEDULED",
    visibility: "PUBLIC",
    startsAt: null,
    durationMinutes: 60,
    recurrence: "NONE",
    recurrenceInterval: 1,
    recurrenceWeekdays: [],
    recurrenceUntil: null,
    locationType: "TBD",
    buildingId: null,
    buildingCode: null,
    room: null,
    address: null,
    lat: null,
    lng: null,
    virtualUrl: null,
    allowSelfCheckIn: true,
    createdAt: ctx.NOW,
    termId: null,
    isSeries: false,
    cohosts: [],
    occurrences: [],
    ...e,
  };
}

export function addOccurrences(ctx: Ctx, ev: Ev, times: OccurrenceTimes[], opts: { code?: string } = {}) {
  for (const t of times) {
    const note = ev.isSeries ? holidayNote(t.startsAt) : null;
    const occ: Occ = {
      id: ctx.id(),
      eventId: ev.id,
      clubId: ev.clubId,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      status: ev.status === "CANCELLED" || note ? "CANCELLED" : "SCHEDULED",
      note: note ?? (ev.status === "CANCELLED" ? "Cancelled" : null),
      roomOverride: null,
      checkinCode: ctx.checkinCode(opts.code),
      checkinSecret: generateCheckinSecret(),
      attendees: new Map(),
    };
    ev.occurrences.push(occ);
  }
}

function campusSpot(ctx: Ctx, club: ClubM | null, building?: string) {
  const { rng } = ctx;
  const key = club ? (club.def.scope === "SPORTS" ? "sports" : club.collegeKey ?? "university") : "university";
  const code = building ?? rng.pick(COLLEGE_BUILDINGS[key]);
  const b = ctx.buildings.get(code)!;
  return { locationType: "CAMPUS" as const, buildingId: b.id, buildingCode: code, room: rng.pick(b.rooms), lat: b.lat, lng: b.lng };
}

function locate(ctx: Ctx, club: ClubM, where: EventIdea["where"]) {
  const { rng } = ctx;
  if (where === "virtual") return { locationType: "VIRTUAL" as const, virtualUrl: meetLink(ctx) };
  if (where === "service" || where === "social" || where === "outdoors") {
    const spot = rng.pick(OFFSITE[where]);
    return { locationType: "ADDRESS" as const, address: spot.address, lat: spot.lat, lng: spot.lng };
  }
  return rng.chance(0.55) ? campusSpot(ctx, club, club.def.meeting.building) : campusSpot(ctx, club);
}

/** Next campus date on/after `from` that falls on `dow`, at H:M. */
function onWeekday(from: Date, dow: number, H: number, M: number) {
  const p = local(from);
  const shift = (dow - p.dow + 7) % 7;
  const d = calAdd(p.y, p.m, p.d, shift);
  return campusDate(d.y, d.m, d.d, H, M);
}

function describe(club: ClubM, title: string, kind: EventKind) {
  const lead: Record<string, string> = {
    MEETING: `Our regular ${club.def.meeting.title?.toLowerCase() ?? "meeting"}: updates, projects and time to hang out.`,
    SOCIAL: "Come hang out, meet members from other majors and bring a friend.",
    WORKSHOP: "Hands-on and beginner friendly — no experience needed.",
    SERVICE: "Give back with us. Wear comfortable clothes; we'll provide water and snacks.",
    COMPETITION: "Compete, cheer, or just come watch.",
    FUNDRAISER: "Every dollar goes back into club events.",
    TRAINING: "Required for anyone who wants to help lead activities.",
    OTHER: "Everyone's welcome.",
  };
  return `<p><strong>${title}</strong> with ${club.name}. ${lead[kind] ?? ""}</p><ul><li>Open to all Weber State students</li><li>Check in with the QR code when you arrive</li></ul>`;
}

const EVENT_TERMS = (ctx: Ctx) => {
  const f24 = ctx.terms.find((t) => t.name === "Fall 2024")!.startsOn;
  const current = ctx.termFor(ctx.NOW);
  return ctx.terms.filter((t) => t.countsForActivity && t.startsOn >= f24 && t.startsOn <= current.startsOn);
};

function clubEvents(ctx: Ctx, club: ClubM) {
  const { rng, NOW } = ctx;
  const def = club.def;
  const lastActive = def.lastActiveTerm ? ctx.term(def.lastActiveTerm).endsOn : null;
  const ideasUsed = new Set<string>();
  const dow = def.meeting.dow;
  let lastAy = "";

  for (const term of EVENT_TERMS(ctx)) {
    if (def.life === "pilot" && term.id !== ctx.termFor(NOW).id) continue;
    const winStart = maxDate(term.startsOn, addDays(club.approvedAt!, 4));
    const winEnd = minDate(addDays(term.endsOn, -7), club.end < NOW ? club.end : addDays(term.endsOn, -7));
    if (winEnd.getTime() - winStart.getTime() < 21 * DAY) continue;
    const quiet = Boolean(lastActive && term.startsOn > lastActive);
    if (term.academicYear !== lastAy) {
      // Meeting nights stay put: club descriptions name the day ("Tuesday build nights").
      lastAy = term.academicYear;
    }

    if (!quiet) {
      const [H, M] = def.meeting.time;
      const first = onWeekday(maxDate(addDays(term.startsOn, 7), winStart), dow, H, M);
      const ev = newEvent(ctx, {
        clubId: club.id,
        title: def.meeting.title ?? "General Meeting",
        descriptionHtml: describe(club, def.meeting.title ?? "General Meeting", "MEETING"),
        kind: "MEETING",
        visibility: "PUBLIC",
        startsAt: first,
        durationMinutes: def.meeting.duration,
        recurrence: "WEEKLY",
        recurrenceInterval: def.meeting.interval,
        recurrenceWeekdays: [dow],
        recurrenceUntil: winEnd,
        ...campusSpot(ctx, club, def.meeting.building),
        room: def.meeting.room,
        createdById: ctx.leaderAt(club, addDays(first, -10)),
        createdAt: minDate(addDays(first, -rng.float(8, 20)), NOW),
        termId: term.id,
        isSeries: true,
      });
      const times = expandOccurrences({ startsAt: first, durationMinutes: ev.durationMinutes, recurrence: "WEEKLY", interval: ev.recurrenceInterval, weekdays: [dow], until: winEnd });
      addOccurrences(ctx, ev, times);
      if (ev.occurrences.length) club.events.push(ev);
    }

    const n = def.life === "pilot" ? rng.int(2, 4) : quiet ? (rng.chance(0.3) ? 1 : 0) : Math.max(3, Math.round(def.activity * rng.int(4, 10)));
    const bank = EVENT_IDEAS[def.category];
    for (let i = 0; i < n; i++) {
      const fresh = bank.filter((x) => !ideasUsed.has(`${term.id}:${x.title}`));
      const idea = rng.pick(fresh.length ? fresh : bank);
      ideasUsed.add(`${term.id}:${idea.title}`);
      const pattern = DOW_TIME[idea.kind] ?? DOW_TIME.OTHER!;
      const [H, M] = rng.pick(pattern.times);
      const day = new Date(winStart.getTime() + 7 * DAY + rng.next() * Math.max(DAY, winEnd.getTime() - winStart.getTime() - 10 * DAY));
      const startsAt = onWeekday(day, rng.pick(pattern.dows), H, M);
      if (startsAt > winEnd || startsAt < winStart) continue;
      // Leave a gap around "now" so the live events stand out.
      if (Math.abs(startsAt.getTime() - NOW.getTime()) < 6 * 3_600_000) continue;
      const cancelled = startsAt < NOW && rng.chance(0.02);
      const vis: Visibility = rng.chance(0.82) ? "PUBLIC" : rng.chance(0.65) ? "UNIVERSITY" : "MEMBERS";
      const ev = newEvent(ctx, {
        clubId: club.id,
        title: idea.title,
        descriptionHtml: describe(club, idea.title, idea.kind),
        kind: idea.kind,
        status: cancelled ? "CANCELLED" : "SCHEDULED",
        visibility: vis,
        startsAt,
        durationMinutes: idea.minutes ?? rng.pick([60, 90, 90, 120]),
        ...locate(ctx, club, idea.where),
        allowSelfCheckIn: rng.chance(0.85),
        createdById: ctx.leaderAt(club, addDays(startsAt, -14)),
        createdAt: minDate(addDays(startsAt, -rng.float(7, 30)), NOW),
        termId: term.id,
        cost: idea.cost && rng.chance(0.7) ? idea.cost : undefined,
      });
      addOccurrences(ctx, ev, [{ startsAt, endsAt: addMin(startsAt, ev.durationMinutes) }]);
      club.events.push(ev);

      // Co-host with a related club now and then.
      if (!cancelled && def.related.length && rng.chance(def.key === "robotics" ? 0.35 : 0.12)) {
        const partner = ctx.clubByKey.get(rng.pick(def.related));
        if (partner && partner.status === "APPROVED" && partner.approvedAt! < ev.createdAt && partner.end > startsAt && partner.type !== "COLLEGE_AMBASSADORS") {
          approvedCohost(ctx, ev, club, partner);
        }
      }
    }
  }

  // Wildcat Robotics always co-hosts with ACM and SWE at least once a term.
  if (def.key === "robotics") {
    for (const term of EVENT_TERMS(ctx)) {
      for (const partnerKey of ["acm", "swe"]) {
        const partner = ctx.club(partnerKey);
        const already = club.events.some((e) => e.termId === term.id && e.cohosts.some((c) => c.clubId === partner.id));
        if (already) continue;
        const candidates = club.events.filter((e) => e.termId === term.id && !e.isSeries && e.status === "SCHEDULED" && e.cohosts.length === 0);
        if (candidates.length) approvedCohost(ctx, rng.pick(candidates), club, partner);
      }
    }
  }
}

function approvedCohost(ctx: Ctx, ev: Ev, host: ClubM, partner: ClubM, status: "APPROVED" | "DECLINED" = "APPROVED") {
  const { rng, NOW } = ctx;
  if (ev.cohosts.some((c) => c.clubId === partner.id)) return;
  const createdAt = minDate(addDays(ev.createdAt, rng.float(0.2, 2)), NOW);
  const decidedAt = minDate(addDays(createdAt, rng.float(0.3, 3)), NOW);
  ev.cohosts.push({
    id: ctx.id(),
    clubId: partner.id,
    status,
    requestedById: ctx.leaderAt(host, createdAt),
    decidedById: partner.def.autoApproveCohosts ? null : ctx.leaderAt(partner, decidedAt),
    createdAt,
    decidedAt: partner.def.autoApproveCohosts ? createdAt : decidedAt,
  });
}

function universityEvents(ctx: Ctx) {
  const alex = ctx.p("alex");
  const f24 = fallStart(2024);
  const until = springEnd(2027);
  const untilDate = campusDate(until.y, until.m, until.d, 23, 0);
  const su = ctx.buildings.get("SU")!;

  const trainingStart = (() => {
    const d = calAdd(f24.y, f24.m, f24.d, 15);
    return campusDate(d.y, d.m, d.d, 17, 30);
  })();
  const training = newEvent(ctx, {
    clubId: null,
    title: "Club Officer Training",
    descriptionHtml:
      "<h3>Required for club officers, vice presidents and presidents</h3><p>WSUSA's officer training covers running a club at Weber State: funding and purchasing rules, event safety, hazing and non-discrimination policy, and how to use Wildcat Clubs for attendance, budgets and elections.</p><ul><li>Attend one session each academic year.</li><li>Check in with the QR code at the door — that's what marks your requirement complete.</li><li>Dinner is provided.</li></ul><p>Can't make it? A makeup session is held mid-semester for officers who start late.</p>",
    kind: "TRAINING",
    visibility: "UNIVERSITY",
    startsAt: trainingStart,
    durationMinutes: 90,
    recurrence: "SEMESTERLY",
    recurrenceUntil: untilDate,
    locationType: "CAMPUS",
    buildingId: su.id,
    buildingCode: "SU",
    room: "Ballroom C",
    lat: su.lat,
    lng: su.lng,
    allowSelfCheckIn: true,
    createdById: alex.id,
    createdAt: addDays(trainingStart, -30),
  });
  addOccurrences(ctx, training, expandOccurrences({ startsAt: trainingStart, durationMinutes: 90, recurrence: "SEMESTERLY", until: untilDate }, ctx.terms));
  // Makeup sessions every three weeks after this term's session (so anyone who
  // takes a role mid-semester has one inside their 45 days), plus the next one
  // coming up — a Wednesday about a week out.
  const ay = ctx.academicYear(ctx.NOW);
  const makeups: Date[] = [];
  for (const term of ctx.terms.filter((t) => t.academicYear === ay.label && t.countsForActivity)) {
    const main = training.occurrences.find((o) => o.startsAt >= term.startsOn && o.startsAt <= term.endsOn);
    if (!main || main.startsAt > ctx.NOW) continue;
    const stop = minDate(addDays(term.endsOn, -7), addDays(ctx.NOW, -1));
    for (let d = addDays(main.startsAt, 21); d < stop; d = addDays(d, 21)) {
      const at = onWeekday(d, 3, 17, 30);
      if (at < stop) makeups.push(at);
    }
  }
  makeups.push(onWeekday(addDays(ctx.NOW, 6), 3, 17, 30));
  for (const m of makeups) {
    addOccurrences(ctx, training, [{ startsAt: m, endsAt: addMin(m, 90) }]);
    const occ = training.occurrences[training.occurrences.length - 1];
    occ.note = "Makeup session for officers who started mid-semester";
    occ.roomOverride = "Room 404A";
  }
  training.occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  ctx.universityEvents.push(training);
  ctx.refs.trainingEventId = training.id;

  const fwStart = (() => {
    const d = calAdd(f24.y, f24.m, f24.d, 24);
    return campusDate(d.y, d.m, d.d, 12, 0);
  })();
  const funding = newEvent(ctx, {
    clubId: null,
    title: "Funding Workshop",
    descriptionHtml:
      "<p>Learn how WSUSA club funding works before you submit a request: what's eligible, how to itemize costs in the Budget tool, deadlines, and what happens after approval (invoices and reimbursements).</p><ul><li>Bring your treasurer.</li><li>Lunch provided.</li></ul>",
    kind: "WORKSHOP",
    visibility: "UNIVERSITY",
    startsAt: fwStart,
    durationMinutes: 60,
    recurrence: "SEMESTERLY",
    recurrenceUntil: untilDate,
    locationType: "CAMPUS",
    buildingId: su.id,
    buildingCode: "SU",
    room: "Room 316",
    lat: su.lat,
    lng: su.lng,
    createdById: alex.id,
    createdAt: addDays(fwStart, -21),
  });
  addOccurrences(ctx, funding, expandOccurrences({ startsAt: fwStart, durationMinutes: 60, recurrence: "SEMESTERLY", until: untilDate }, ctx.terms));
  ctx.universityEvents.push(funding);
  ctx.refs.fundingWorkshopId = funding.id;
}

function liveEvents(ctx: Ctx) {
  const { NOW } = ctx;
  const service = ctx.club("service");
  const psych = ctx.club("psych");
  const robotics = ctx.club("robotics");
  const term = ctx.termFor(NOW);

  // Started 15 minutes ago, ends 105 minutes from now (to the minute).
  const liveStart = new Date(Math.floor(addMin(NOW, -15).getTime() / 60_000) * 60_000);
  const live = newEvent(ctx, {
    clubId: service.id,
    title: "Care Kit Assembly for the Weber Cares Pantry",
    descriptionHtml:
      "<p>We're packing 300 care kits (toiletries, socks, snacks) for students who use the <strong>Weber Cares Food Pantry</strong>. Drop in for 20 minutes or stay the whole time.</p><ul><li>No sign-up needed — just check in when you arrive.</li><li>Counts toward service hours.</li></ul>",
    kind: "SERVICE",
    visibility: "PUBLIC",
    startsAt: liveStart,
    durationMinutes: 120,
    ...campusSpot(ctx, service, "SU"),
    room: "Room 404B",
    allowSelfCheckIn: true,
    createdById: ctx.leaderAt(service, addDays(NOW, -10)),
    createdAt: addDays(NOW, -10.2),
    termId: term.id,
    cost: ["Care kit supplies", 300, 4],
  });
  addOccurrences(ctx, live, [{ startsAt: liveStart, endsAt: addMin(liveStart, 120) }], { code: "HERE26" });
  service.events.push(live);
  ctx.refs.liveEventId = live.id;
  ctx.refs.liveOccurrenceId = live.occurrences[0].id;

  const laterStart = floor5(addMin(NOW, 180));
  const later = newEvent(ctx, {
    clubId: psych.id,
    title: "Grad School Q&A with Psychology Faculty",
    descriptionHtml: "<p>Thinking about a master's or PhD? Three Psychology faculty answer your questions about applications, research experience and funding. Bring questions — we'll have pizza.</p>",
    kind: "WORKSHOP",
    visibility: "PUBLIC",
    startsAt: laterStart,
    durationMinutes: 60,
    ...campusSpot(ctx, psych, "SS"),
    room: "Room 238",
    allowSelfCheckIn: true,
    createdById: ctx.leaderAt(psych, addDays(NOW, -12)),
    createdAt: addDays(NOW, -12.4),
    termId: term.id,
    cost: ["Pizza", 8, 14],
  });
  addOccurrences(ctx, later, [{ startsAt: laterStart, endsAt: addMin(laterStart, 60) }], { code: "LATER7" });
  psych.events.push(later);
  ctx.refs.laterEventId = later.id;

  const buildStart = floor5(addMin(NOW, -30));
  const build = newEvent(ctx, {
    clubId: robotics.id,
    title: "Open Build Night (extra session)",
    descriptionHtml: "<p>Extra shop time before the Lunabotics design review. Drivetrain and electronics teams especially — come finish your subsystem.</p>",
    kind: "OTHER",
    visibility: "MEMBERS",
    startsAt: buildStart,
    durationMinutes: 150,
    ...campusSpot(ctx, robotics, "NB"),
    room: "Room 150 (Makerspace)",
    allowSelfCheckIn: true,
    createdById: ctx.p("priya").id,
    createdAt: addDays(NOW, -4.1),
    termId: term.id,
  });
  addOccurrences(ctx, build, [{ startsAt: buildStart, endsAt: addMin(buildStart, 150) }], { code: "BUILD8" });
  robotics.events.push(build);
  ctx.refs.buildEventId = build.id;
}

function upcomingCohosts(ctx: Ctx) {
  const { NOW, rng } = ctx;
  const term = ctx.termFor(NOW);
  const make = (hostKey: string, partnerKey: string, title: string, kind: EventKind, days: number, H: number, status: "PENDING" | "APPROVED", desc: string, cost?: [string, number, number]) => {
    const host = ctx.club(hostKey);
    const partner = ctx.club(partnerKey);
    const d = local(addDays(NOW, days));
    const startsAt = campusDate(d.y, d.m, d.d, H, 0);
    const ev = newEvent(ctx, {
      clubId: host.id,
      title,
      descriptionHtml: desc,
      kind,
      visibility: "PUBLIC",
      startsAt,
      durationMinutes: 90,
      ...campusSpot(ctx, host, host.def.meeting.building),
      createdById: ctx.leaderAt(host, addDays(NOW, -3)),
      createdAt: addDays(NOW, -rng.float(3, 6)),
      termId: term.id,
      cost,
    });
    addOccurrences(ctx, ev, [{ startsAt, endsAt: addMin(startsAt, 90) }]);
    host.events.push(ev);
    const createdAt = status === "PENDING" ? addDays(NOW, -rng.float(1, 3)) : addDays(ev.createdAt, 0.5);
    ev.cohosts.push({
      id: ctx.id(),
      clubId: partner.id,
      status,
      requestedById: ctx.leaderAt(host, createdAt),
      decidedById: status === "APPROVED" ? ctx.leaderAt(partner, createdAt) : null,
      createdAt,
      decidedAt: status === "APPROVED" ? addDays(createdAt, 1) : null,
    });
    return { ev, cohost: ev.cohosts[ev.cohosts.length - 1] };
  };

  const a = make("cyber", "swe", "Women in Cybersecurity Panel", "WORKSHOP", 9, 18, "PENDING",
    "<p>Security engineers from Hill AFB and Salt Lake companies talk about their paths into cybersecurity, followed by Q&amp;A and a résumé swap. We'd love SWE to co-host.</p>", ["Refreshments", 1, 150]);
  ctx.refs.pendingCohostSwe = a.cohost.id;
  ctx.refs.pendingCohostSweEvent = a.ev.id;
  const b = make("premed", "nursing", "Health Careers Night", "WORKSHOP", 15, 18, "PENDING",
    "<p>Meet professionals from medicine, nursing, PA and dental programs. Pre-Med Society invited the Nursing Student Association to co-host.</p>");
  ctx.refs.pendingCohostNursing = b.cohost.id;
  const c = make("bsu", "lia", "Unity Week Kickoff", "SOCIAL", 12, 18, "PENDING",
    "<p>Kick off Unity Week with music, food and student performances in the Shepherd Union.</p>", ["Catering", 1, 400]);
  ctx.refs.pendingCohostLia = c.cohost.id;
  make("robotics", "acm", "Robotics × ACM: Intro to ROS Workshop", "WORKSHOP", 6, 18, "APPROVED",
    "<p>Get started with the Robot Operating System. ACM brings the software folks, Wildcat Robotics brings the robots.</p>", ["Pizza", 10, 14]);
  make("robotics", "swe", "Girls in STEM Robot Day", "SERVICE", 20, 10, "APPROVED",
    "<p>Middle-school girls from Ogden build and drive their first robots with Wildcat Robotics and SWE mentors.</p>", ["Robot kits and supplies", 1, 320]);
}

function draftIdeas(ctx: Ctx) {
  const { rng, NOW } = ctx;
  for (const club of ctx.clubs) {
    if (club.status !== "APPROVED" || club.def.life === "inactive") continue;
    const ideas = rng.sample(DRAFT_IDEAS[club.def.category], club.def.life === "pilot" ? rng.int(1, 2) : rng.int(1, 3));
    for (const title of ideas) {
      const createdAt = addDays(NOW, -rng.float(2, 45));
      club.events.push(
        newEvent(ctx, {
          clubId: club.id,
          title,
          descriptionHtml: `<p>${rng.pick(["Idea from the last officer meeting.", "Someone suggested this in the club chat — worth planning?", "Needs a date and a room.", "Could co-host with another club."])}</p>`,
          kind: rng.pick(["OTHER", "SOCIAL", "WORKSHOP", "SERVICE"] as EventKind[]),
          status: "DRAFT",
          createdById: ctx.leaderAt(club, createdAt),
          createdAt,
        }),
      );
    }
  }
}

export function buildEvents(ctx: Ctx) {
  universityEvents(ctx);
  for (const club of ctx.clubs) {
    if ((club.status === "APPROVED" || club.status === "RETIRED") && club.approvedAt) clubEvents(ctx, club);
  }
  liveEvents(ctx);
  upcomingCohosts(ctx);
  // One declined co-host request, for history.
  const anime = ctx.club("anime");
  const target = anime.events.find((e) => !e.isSeries && e.startsAt && e.startsAt < ctx.NOW && e.cohosts.length === 0);
  if (target) approvedCohost(ctx, target, anime, ctx.club("chess"), "DECLINED");
  draftIdeas(ctx);
}

export function allEvents(ctx: Ctx): Ev[] {
  return [...ctx.universityEvents, ...ctx.clubs.flatMap((c) => c.events)];
}
