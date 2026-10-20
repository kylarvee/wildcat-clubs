import type { EventKind, EventPerk, Visibility } from "@prisma/client";
import { expandOccurrences, type OccurrenceTimes } from "@/lib/events/recurrence";
import { generateCheckinSecret } from "@/lib/attendance/token";
import type { ClubM, Ctx, Ev, Occ } from "../ctx";
import { COLLEGE_BUILDINGS, OFFSITE } from "../data/reference";
import { isQuiet } from "../data/clubs";
import { EVENT_IDEAS, type EventIdea } from "../data/text";
import { addDays, addMin, calAdd, campusDate, DAY, floor5, HOUR, local, maxDate, minDate } from "../lib/dates";
import { shortcutRange } from "@/lib/events/browse-params";
import { resolveVisibility } from "@/lib/files/visibility";
import { createRng } from "../lib/rng";
import { fallStart, holidayNote, springEnd } from "./reference";

/**
 * Events: a weekly or biweekly meeting series per club per semester (expanded
 * with the platform's own recurrence code, holidays cancelled), one-off
 * socials, workshops, service days and competitions, co-hosted events between
 * related clubs, university trainings — and a few events that are happening
 * right now (one of them online) so check-in can be tested immediately.
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
    coverUrl: null,
    perks: [],
    createdAt: ctx.NOW,
    termId: null,
    isSeries: false,
    cohosts: [],
    occurrences: [],
    // Service projects count toward service hours: their length, up to three hours a date (60–180 minutes).
    serviceMinutes: e.kind === "SERVICE" ? Math.min(e.durationMinutes ?? 60, 180) : null,
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

function describe(club: ClubM, title: string, kind: EventKind, online = false) {
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
  // Online events have nothing to scan: members check in with one tap (lib/attendance/rules allowsTapCheckIn).
  const checkin = online ? "Members check in with one tap on Wildcat Clubs once it starts" : "Check in with the QR code when you arrive";
  return `<p><strong>${title}</strong> with ${club.name}. ${lead[kind] ?? ""}</p><ul><li>Open to all Weber State students</li><li>${checkin}</li></ul>`;
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
    if (quiet && def.life === "dormant") continue; // nothing at all once a dormant club went quiet
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
        kind: def.meeting.kind ?? "MEETING",
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

    // Story clubs run full calendars; directory clubs a lighter one (a meeting series plus a few events).
    const n =
      def.life === "pilot" ? rng.int(2, 4) :
      quiet ? (rng.chance(0.3) ? 1 : 0) :
      def.story ? Math.max(3, Math.round(def.activity * rng.int(4, 10))) :
      def.life === "active" ? rng.int(1, 3) : def.life === "small" ? (rng.chance(0.5) ? 1 : 0) : rng.int(0, 2);
    const bank = EVENT_IDEAS[def.topic];
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
        descriptionHtml: describe(club, idea.title, idea.kind, idea.where === "virtual"),
        kind: idea.kind,
        status: cancelled ? "CANCELLED" : "SCHEDULED",
        visibility: vis,
        startsAt,
        durationMinutes: idea.minutes ?? rng.pick([60, 90, 90, 120]),
        ...locate(ctx, club, idea.where),
        createdById: ctx.leaderAt(club, addDays(startsAt, -14)),
        createdAt: minDate(addDays(startsAt, -rng.float(7, 30)), NOW),
        termId: term.id,
        cost: idea.cost && rng.chance(0.7) ? idea.cost : undefined,
      });
      addOccurrences(ctx, ev, [{ startsAt, endsAt: addMin(startsAt, ev.durationMinutes) }]);
      club.events.push(ev);

      // Co-host with a related club now and then.
      if (!cancelled && def.related.length && rng.chance(def.key === "robotics" ? 0.35 : def.story ? 0.12 : 0.08)) {
        const partner = ctx.clubByKey.get(rng.pick(def.related));
        if (partner && partner.status === "APPROVED" && !isQuiet(partner.def.life) && partner.approvedAt! < ev.createdAt && partner.end > startsAt && partner.type !== "COLLEGE_AMBASSADORS") {
          approvedCohost(ctx, ev, club, partner);
        }
      }
    }
  }

  // RC Wrecker Bots (robotics) always co-hosts with CSWS (acm) and SWE at least once a term.
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
    descriptionHtml: "<p>Extra shop time before the spring competition's design review. Drivetrain, weapon and electronics teams especially — come finish your subsystem.</p>",
    kind: "OTHER",
    visibility: "MEMBERS",
    startsAt: buildStart,
    durationMinutes: 150,
    ...campusSpot(ctx, robotics, "NB"),
    room: "Room 150 (Makerspace)",
    createdById: ctx.p("priya").id,
    createdAt: addDays(NOW, -4.1),
    termId: term.id,
  });
  addOccurrences(ctx, build, [{ startsAt: buildStart, endsAt: addMin(buildStart, 150) }], { code: "BUILD8" });
  robotics.events.push(build);
  ctx.refs.buildEventId = build.id;

  // Online and live now in another of Maya's clubs. Online events are the only
  // ones with the one-tap "Check in" prompt (web and app), recorded as TAP.
  const premed = ctx.club("premed");
  const onlineStart = new Date(Math.floor(addMin(NOW, -10).getTime() / 60_000) * 60_000);
  const online = newEvent(ctx, {
    clubId: premed.id,
    title: "Online MCAT Study Hall",
    descriptionHtml:
      "<p>Two hours of MCAT prep on Google Meet: a short strategy talk, then quiet study in breakout rooms, with upperclassmen on hand for questions.</p><ul><li>Bring the practice questions you're stuck on.</li><li>Members check in with one tap on Wildcat Clubs once it starts.</li></ul>",
    kind: "WORKSHOP",
    visibility: "PUBLIC",
    startsAt: onlineStart,
    durationMinutes: 120,
    locationType: "VIRTUAL",
    virtualUrl: meetLink(ctx),
    createdById: ctx.leaderAt(premed, addDays(NOW, -6)),
    createdAt: addDays(NOW, -6.3),
    termId: term.id,
  });
  addOccurrences(ctx, online, [{ startsAt: onlineStart, endsAt: addMin(onlineStart, 120) }]);
  premed.events.push(online);
  ctx.refs.onlineEventId = online.id;
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
    `<p>Meet professionals from medicine, nursing, PA and dental programs. ${ctx.club("premed").name} invited ${ctx.club("nursing").name} to co-host.</p>`);
  ctx.refs.pendingCohostNursing = b.cohost.id;
  const c = make("bsu", "lia", "Unity Week Kickoff", "SOCIAL", 12, 18, "PENDING",
    "<p>Kick off Unity Week with music, food and student performances in the Shepherd Union.</p>", ["Catering", 1, 400]);
  ctx.refs.pendingCohostLia = c.cohost.id;
  make("robotics", "acm", "Wrecker Bots × CSWS: Intro to Embedded Programming", "WORKSHOP", 6, 18, "APPROVED",
    "<p>Program a motor controller from scratch. CSWS brings the software folks, the RC Wrecker Bots Club brings the robots.</p>", ["Pizza", 10, 14]);
  make("robotics", "swe", "Girls in STEM Robot Day", "SERVICE", 20, 10, "APPROVED",
    "<p>Middle-school girls from Ogden build and drive their first robots with RC Wrecker Bots and SWE mentors.</p>", ["Robot kits and supplies", 1, 320]);
}

/**
 * University service events (no host club; WSUSA runs them), which count
 * toward service hours like any service project: a Day of Service in every
 * fall and spring (and the next one on the calendar) and a pantry restock
 * night about a week ago. Their check-in codes come from their own
 * generator, so adding them doesn't shift the rest of the seed's choices.
 * Attendance: steps/attendance.
 */
function universityServiceEvents(ctx: Ctx) {
  const { NOW } = ctx;
  const alex = ctx.p("alex");
  const su = ctx.buildings.get("SU")!;
  const codes = createRng(20261020);
  const code = () => {
    for (;;) {
      const c = codes.string("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
      if (!ctx.usedCodes.has(c)) return c;
    }
  };
  const union = { locationType: "CAMPUS" as const, buildingId: su.id, buildingCode: "SU", lat: su.lat, lng: su.lng };
  const current = ctx.termFor(NOW);
  const next = ctx.terms.find((t) => t.countsForActivity && t.startsOn > current.startsOn);

  // A Saturday in each term's sixth week, 9:00 to 1:00. Three of the four hours count; the rest is check-in and lunch.
  for (const term of [...EVENT_TERMS(ctx), ...(next ? [next] : [])]) {
    const startsAt = onWeekday(addDays(term.startsOn, 35), 6, 9, 0);
    const ev = newEvent(ctx, {
      clubId: null,
      title: "WSUSA Day of Service",
      descriptionHtml:
        "<p>Weber State's campus-wide service day. Students from every club head out across Ogden for the morning: cleanup on the Ogden River Parkway, sorting at the Weber Cares Food Pantry and reading with kids at the Weber County Library.</p><ul><li>Meet in the Shepherd Union Ballroom at 9:00 for check-in and team assignments.</li><li>Checking in with the QR code at the door counts for three service hours.</li><li>Lunch is on WSUSA when everyone's back at 1:00.</li></ul>",
      kind: "SERVICE",
      visibility: "PUBLIC",
      startsAt,
      durationMinutes: 240,
      serviceMinutes: 180,
      ...union,
      room: "Ballroom A",
      createdById: alex.id,
      createdAt: minDate(addDays(startsAt, -28), addDays(NOW, -2)),
      termId: term.id,
    });
    addOccurrences(ctx, ev, [{ startsAt, endsAt: addMin(startsAt, 240) }], { code: code() });
    ctx.universityEvents.push(ev);
  }

  const restockAt = onWeekday(addDays(NOW, -12), 3, 18, 0);
  const restock = newEvent(ctx, {
    clubId: null,
    title: "Weber Cares Pantry Restock Night",
    descriptionHtml:
      "<p>Unload the week's donations and restock the Weber Cares Food Pantry shelves so they're full for the weekend. No experience needed, and you can bring a friend.</p><ul><li>Checking in counts for two service hours.</li><li>Wear closed-toe shoes.</li></ul>",
    kind: "SERVICE",
    visibility: "UNIVERSITY",
    startsAt: restockAt,
    durationMinutes: 120,
    serviceMinutes: 120,
    ...union,
    room: "Weber Cares Food Pantry",
    createdById: alex.id,
    createdAt: addDays(restockAt, -9),
    termId: current.id,
  });
  addOccurrences(ctx, restock, [{ startsAt: restockAt, endsAt: addMin(restockAt, 120) }], { code: code() });
  ctx.universityEvents.push(restock);
  ctx.refs.pantryRestockEventId = restock.id;
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
  universityServiceEvents(ctx);
  eventExtras(ctx);
}

// ─── Perks, hybrid events and covers (the Events page) ──────────────────────

/** Food an event offers, from its title and cost line (and a university event's description). */
const FOOD = /pizza|snack|refreshment|dinner|lunch|breakfast|catering|appetizer|cocoa|hot chocolate|ice cream|pan dulce|pancake|bbq|tacos?\b/i;
const SWAG = /t-shirt|swag|giveaway/i;
const plain = (html: string | null) => (html ?? "").replace(/<[^>]+>/g, " ");

/**
 * What the Events page filters on, decided after every event exists and from
 * its own generator, so none of the seed's other choices shift: Free food on
 * about 30% of socials (more often when the title or cost line is food), on
 * one-off events whose cost line is food (pizza, snacks, dinner…), on a few
 * meeting series and on university events that serve a meal; Free stuff on
 * some; an online link on a few in-person workshops (hybrid), past and
 * upcoming; and one free-food social this weekend in a club Maya belongs to.
 */
function eventExtras(ctx: Ctx) {
  const r = createRng(20261022);
  for (const ev of allEvents(ctx)) {
    const words = `${ev.title} ${ev.cost?.[0] ?? ""} ${ev.clubId ? "" : plain(ev.descriptionHtml)}`;
    const perks = new Set<EventPerk>();
    const food = FOOD.test(words);
    if (ev.kind === "SOCIAL") {
      if (r.chance(food ? 0.55 : 0.18)) perks.add("FREE_FOOD");
    } else if (ev.isSeries) {
      if (r.chance(0.12)) perks.add("FREE_FOOD");
    } else if (food) perks.add("FREE_FOOD");
    if (SWAG.test(words) || (!ev.isSeries && ev.kind !== "TRAINING" && ev.kind !== "MEETING" && r.chance(0.08))) perks.add("FREE_STUFF");
    ev.perks = (["FREE_FOOD", "FREE_STUFF"] as const).filter((p) => perks.has(p));
  }

  // Hybrid: in person with an online link too (check-in stays in the room).
  const workshops = r.shuffle(
    ctx.clubs.flatMap((c) => c.events).filter((e) => e.kind === "WORKSHOP" && !e.isSeries && e.status === "SCHEDULED" && e.startsAt && (e.locationType === "CAMPUS" || e.locationType === "ADDRESS") && !e.virtualUrl && e.visibility !== "MEMBERS"),
  );
  const upcoming = workshops.filter((e) => e.startsAt! > addDays(ctx.NOW, 1)).slice(0, 4);
  const past = workshops.filter((e) => e.startsAt! < addDays(ctx.NOW, -3)).slice(0, 2);
  const meet = () => `https://meet.google.com/${r.string("abcdefghijkmnopqrstuvwxyz", 3)}-${r.string("abcdefghijkmnopqrstuvwxyz", 4)}-${r.string("abcdefghijkmnopqrstuvwxyz", 3)}`;
  for (const ev of [...upcoming, ...past]) ev.virtualUrl = meet();
  ctx.refs.hybridWorkshopId = upcoming[0]?.id ?? "";

  weekendFreeFood(ctx, r);
}

/**
 * A free-food social this weekend (Friday 5 PM through Sunday, as the Events
 * page's "This weekend" counts it) in Hiking and Outdoors Club, one of Maya's
 * clubs: Saturday at 11:30, else Sunday at noon or 5 PM, whichever is at least
 * two hours away. Seeded late on a Sunday, it moves to next Saturday.
 */
function weekendFreeFood(ctx: Ctx, r: ReturnType<typeof createRng>) {
  const { NOW } = ctx;
  const club = ctx.club("climbing");
  const fri = local(shortcutRange("weekend", NOW).start);
  const at = (days: number, H: number, M = 0) => {
    const d = calAdd(fri.y, fri.m, fri.d, days);
    return campusDate(d.y, d.m, d.d, H, M);
  };
  const startsAt = [at(1, 11, 30), at(2, 12), at(2, 17)].find((s) => s.getTime() > NOW.getTime() + 2 * HOUR) ?? at(8, 11, 30);
  const spot = OFFSITE.outdoors.find((s) => s.address.startsWith("Waterfall Canyon")) ?? OFFSITE.outdoors[0];
  const ev = newEvent(ctx, {
    clubId: club.id,
    title: "Trailhead Cookout & Easy Hike",
    descriptionHtml:
      "<p>Free burgers, veggie dogs and s'mores at the Waterfall Canyon trailhead, then an easy group hike for anyone who wants one. New hikers are welcome.</p><ul><li>Bring water and a layer; it cools off fast in the canyon.</li><li>Check in with the QR code when you arrive.</li></ul>",
    kind: "SOCIAL",
    visibility: "PUBLIC",
    startsAt,
    durationMinutes: 120,
    locationType: "ADDRESS",
    address: spot.address,
    lat: spot.lat,
    lng: spot.lng,
    perks: ["FREE_FOOD"],
    createdById: ctx.leaderAt(club, addDays(NOW, -8)),
    createdAt: addDays(NOW, -8.2),
    termId: ctx.termFor(NOW).id,
  });
  let code = "";
  do code = r.string("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
  while (ctx.usedCodes.has(code));
  addOccurrences(ctx, ev, [{ startsAt, endsAt: addMin(startsAt, 120) }], { code });
  club.events.push(ev);
  ctx.refs.weekendFoodEventId = ev.id;
}

/**
 * Covers, once the files exist (call after buildFiles): an event's first
 * attached image from its own club's files that's public, as the Events
 * Builder allows (lib/events/rules coverProblem). Everything else keeps no
 * cover and shows its club's color and logo.
 */
export function assignCovers(ctx: Ctx) {
  const files = new Map(ctx.rows.files.map((f) => [f.id as string, f]));
  const lookup = (id: string) => {
    const f = files.get(id);
    return f ? { parentId: (f.parentId as string | null) ?? null, visibility: f.visibility ?? "INHERIT" } : undefined;
  };
  const memo = new Map<string, "PUBLIC" | "MEMBERS" | "LEADERS">();
  const events = new Map(allEvents(ctx).map((e) => [e.id, e]));
  for (const a of ctx.rows.attachments) {
    const ev = events.get(a.eventId as string);
    const f = files.get(a.fileId as string);
    if (!ev || !f || ev.coverUrl || !ev.clubId) continue;
    if (f.isFolder || f.clubId !== ev.clubId || !String(f.mimeType ?? "").startsWith("image/")) continue;
    if (resolveVisibility(f.id as string, lookup, memo) !== "PUBLIC") continue;
    ev.coverUrl = `/api/files/${f.id}`;
  }
}

export function allEvents(ctx: Ctx): Ev[] {
  return [...ctx.universityEvents, ...ctx.clubs.flatMap((c) => c.events)];
}
