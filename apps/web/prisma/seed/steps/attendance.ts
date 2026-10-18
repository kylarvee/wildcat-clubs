import type { EventKind } from "@prisma/client";
import type { ClubM, Ctx, Ev, Member, Occ } from "../ctx";
import { addDays, addMin, DAY, MIN, WEEK } from "../lib/dates";

/**
 * Attendance for past occurrences only. Each member has an engagement level
 * that fades at their own rate (core members keep coming, drop-ins fade within
 * weeks); semester starts spike, the run-up to finals dips, officers show up
 * most. Members of co-hosting clubs come as guests, which — together with
 * people who belong to several clubs in the same college — gives the network
 * map its cross-club edges and natural college clusters.
 */

const KIND_FACTOR: Record<EventKind, number> = { MEETING: 1, PRACTICE: 0.9, SOCIAL: 1.1, WORKSHOP: 0.85, SERVICE: 0.62, COMPETITION: 0.6, FUNDRAISER: 0.5, TRAINING: 0.8, OTHER: 0.8 };
const LEAD_ROLES = new Set(["OFFICER", "VP", "PRESIDENT"]);

function checkinAt(ctx: Ctx, occ: Occ): Date {
  const mins = Math.max(-12, Math.min(40, ctx.rng.normal(4, 7)));
  const at = new Date(occ.startsAt.getTime() + mins * MIN + ctx.rng.int(0, 59) * 1000);
  return at > ctx.NOW ? new Date(ctx.NOW.getTime() - ctx.rng.int(30, 600) * 1000) : at;
}

/**
 * One check-in, by the platform's rules (lib/attendance/rules decideMethod).
 * The typed code (SELF) and the one-tap prompt (TAP) are only for members of
 * the host or an approved co-host club, so never at a university event, which
 * has no host club; everyone else scans the QR code. Someone joining by
 * checking in wasn't a member yet, so they scanned it too. Online events have
 * nothing to scan in the room, so members there use the one-tap prompt. Now
 * and then a leader adds someone by hand (MANUAL).
 */
function record(ctx: Ctx, club: ClubM | null, ev: Ev, occ: Occ, userId: string, at?: Date, joining = false) {
  if (occ.attendees.has(userId)) return;
  const { rng } = ctx;
  const r = rng.next();
  const when = at ?? checkinAt(ctx, occ);
  const clubs = club ? [club, ...ev.cohosts.filter((c) => c.status === "APPROVED").map((c) => ctx.clubById.get(c.clubId)!)] : [];
  const member = !joining && clubs.some((c) => ctx.memberAt(c, userId, when) || ctx.rolesAt(c, userId, when).length > 0);
  const online = ev.locationType === "VIRTUAL";
  let method: "QR" | "SELF" | "TAP" | "MANUAL" = joining ? "QR" : r >= 0.95 ? "MANUAL" : !member ? "QR" : online ? "TAP" : r < 0.78 ? "QR" : "SELF";
  let recordedById: string | null = null;
  if (method === "MANUAL") {
    const holders = club ? ctx.capabilityHoldersAt(club, "attendance", occ.startsAt).filter((u) => u !== userId) : [ctx.p("alex").id];
    if (holders.length) recordedById = rng.pick(holders);
    else method = member && online ? "TAP" : "QR";
  }
  occ.attendees.set(userId, { id: ctx.id(), at: when, method, recordedById });
}

function memberP(m: Member, at: Date) {
  const weeks = Math.max(0, (at.getTime() - m.joinedAt!.getTime()) / WEEK);
  return m.eng.base * (m.eng.floor + (1 - m.eng.floor) * Math.pow(0.5, weeks / m.eng.half));
}

function seasonal(ctx: Ctx, at: Date) {
  const term = ctx.termAt(at);
  if (!term) return 0.7;
  if (term.kind === "SUMMER") return 0.6;
  const week = (at.getTime() - term.startsOn.getTime()) / WEEK;
  if (week < 2.5) return 1.3;
  if (term.endsOn.getTime() - at.getTime() < 21 * DAY) return 0.68;
  if (week > 7 && week < 9) return 0.85; // midterms
  return 1;
}

const pastOccs = (ctx: Ctx, ev: Ev, skip: Set<string>) =>
  ev.status === "SCHEDULED" && !skip.has(ev.id) ? ev.occurrences.filter((o) => o.status === "SCHEDULED" && o.startsAt < ctx.NOW) : [];

export function buildAttendance(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const live = new Set([ctx.refs.liveEventId, ctx.refs.buildEventId, ctx.refs.laterEventId, ctx.refs.onlineEventId]);
  const G = 2.5;

  // 1. Members who joined by checking in: their join is their first check-in.
  for (const club of ctx.clubs) {
    const occs = club.events.flatMap((e) => pastOccs(ctx, e, live).map((o) => ({ e, o }))).sort((a, b) => a.o.startsAt.getTime() - b.o.startsAt.getTime());
    for (const m of club.members) {
      if (!m.viaCheckin || !m.joinedAt) continue;
      const hit = occs.find((x) => x.o.startsAt >= m.joinedAt! && x.o.startsAt.getTime() - m.joinedAt!.getTime() < 21 * DAY);
      if (!hit) {
        m.viaCheckin = false;
        m.source = "REGISTER";
        continue;
      }
      const at = addMin(hit.o.startsAt, rng.int(2, 25));
      m.joinedAt = at;
      m.requestedAt = at;
      if (m.endedAt && m.endedAt <= at) m.endedAt = addDays(at, 21);
      record(ctx, club, hit.e, hit.o, m.userId, at, true);
    }
  }

  // 2. Club events.
  for (const club of ctx.clubs) {
    if (!club.approvedAt) continue;
    const act = Math.sqrt(Math.max(0.3, club.def.activity));
    const members = club.members.filter((m) => m.joinedAt && m.status !== "PENDING" && m.status !== "DECLINED");
    for (const ev of club.events) {
      for (const occ of pastOccs(ctx, ev, live)) {
        const t = occ.startsAt;
        const s = seasonal(ctx, t) * KIND_FACTOR[ev.kind] * act * G;
        for (const m of members) {
          if (m.joinedAt! > addMin(t, 30) || (m.endedAt && m.endedAt <= t)) continue;
          const person = ctx.person(m.userId);
          let p: number;
          if (person.kind === "FACULTY_STAFF") p = ev.kind === "MEETING" ? 0.05 : 0.12;
          else {
            p = memberP(m, t) * s;
            const roles = ctx.rolesAt(club, m.userId, t);
            if (roles.some((r) => LEAD_ROLES.has(r.role))) p = Math.max(p, ev.kind === "MEETING" ? 0.86 : 0.74);
            else if (roles.some((r) => r.role === "AMBASSADOR")) p = Math.max(p, 0.4);
            if (ev.visibility === "MEMBERS") p *= 1.05;
          }
          if (rng.chance(Math.min(0.97, p))) record(ctx, club, ev, occ, m.userId);
        }
        // Guests from co-hosting clubs.
        for (const ch of ev.cohosts.filter((c) => c.status === "APPROVED")) {
          const partner = ctx.clubById.get(ch.clubId)!;
          for (const m of partner.members) {
            if (!m.joinedAt || m.joinedAt > t || (m.endedAt && m.endedAt <= t) || m.status === "PENDING" || m.status === "DECLINED") continue;
            if (club.byUser.get(m.userId)?.joinedAt && ctx.memberAt(club, m.userId, t)) continue;
            if (ctx.person(m.userId).kind !== "STUDENT") continue;
            const p = memberP(m, t) * 0.55 * KIND_FACTOR[ev.kind] * seasonal(ctx, t);
            if (rng.chance(Math.min(0.85, p))) record(ctx, club, ev, occ, m.userId);
          }
        }
      }
    }
  }

  // 3. University events: officer training and the funding workshop.
  const training = ctx.universityEvents.find((e) => e.id === ctx.refs.trainingEventId)!;
  const workshop = ctx.universityEvents.find((e) => e.id === ctx.refs.fundingWorkshopId)!;
  const currentAy = ctx.academicYear(NOW).label;
  // Requirements bind every approved club's student leaders, ambassador orgs included.
  const approvedClubs = ctx.clubs.filter((c) => c.approvedAt);
  const trainedInAy = new Map<string, Set<string>>(); // ay → users
  // Oscar (inside his grace period) and the past-grace officer haven't been to training this year.
  const skipTraining = new Set([ctx.refs.pastGraceUserId, ctx.p("oscar").id].filter(Boolean));
  for (const occ of training.occurrences.filter((o) => o.status === "SCHEDULED" && o.startsAt < NOW).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const ay = ctx.academicYear(occ.startsAt).label;
    const done = trainedInAy.get(ay) ?? new Set<string>();
    trainedInAy.set(ay, done);
    for (const club of approvedClubs) {
      for (const a of club.assignments) {
        if (!LEAD_ROLES.has(a.role) || a.startedAt > occ.startsAt || (a.endedAt && a.endedAt <= occ.startsAt)) continue;
        if (done.has(a.userId) || skipTraining.has(a.userId)) continue;
        if (ay === currentAy || rng.chance(0.86)) {
          record(ctx, null, training, occ, a.userId);
          done.add(a.userId);
        }
      }
    }
  }
  for (const occ of workshop.occurrences.filter((o) => o.status === "SCHEDULED" && o.startsAt < NOW)) {
    for (const club of approvedClubs) {
      for (const a of club.assignments) {
        if (!(a.seatName === "Treasurer" || a.role === "PRESIDENT") || a.startedAt > occ.startsAt || (a.endedAt && a.endedAt <= occ.startsAt)) continue;
        if (rng.chance(a.seatName === "Treasurer" ? 0.5 : 0.2)) record(ctx, null, workshop, occ, a.userId);
      }
    }
  }

  // 4. Events happening right now: some people already checked in.
  const liveCheckins = (clubKey: string, eventId: string, n: number, exclude: string[]) => {
    const club = ctx.club(clubKey);
    const ev = club.events.find((e) => e.id === eventId)!;
    const occ = ev.occurrences[0];
    const pool = club.members.filter((m) => m.status === "ACTIVE" && m.joinedAt && !exclude.includes(m.userId) && ctx.person(m.userId).kind === "STUDENT");
    for (const m of rng.weightedOrder(pool, (x) => x.eng.base).slice(0, n)) {
      const span = Math.max(60_000, NOW.getTime() - occ.startsAt.getTime() - 60_000);
      record(ctx, club, ev, occ, m.userId, new Date(occ.startsAt.getTime() + rng.next() * span));
    }
  };
  liveCheckins("service", ctx.refs.liveEventId, 9, [ctx.p("maya").id, ctx.p("frank").id]);
  liveCheckins("robotics", ctx.refs.buildEventId, 12, [ctx.p("priya").id, ctx.p("vanessa").id]);
  // Online: a few members already tapped "Check in"; Maya hasn't, so her prompt shows.
  liveCheckins("premed", ctx.refs.onlineEventId, 6, [ctx.p("maya").id]);

  // 5. Persona guarantees.
  const maya = ctx.p("maya").id;
  const hostOccs = (club: ClubM, from: Date) =>
    club.events.flatMap((e) => pastOccs(ctx, e, live).filter((o) => o.startsAt >= from).map((o) => ({ e, o })));
  for (const key of ["psych", "premed", "climbing"]) {
    const club = ctx.club(key);
    const m = club.byUser.get(maya)!;
    const occs = hostOccs(club, m.joinedAt!);
    let count = occs.filter((x) => x.o.attendees.has(maya)).length;
    for (const x of rng.shuffle(occs)) {
      if (count >= 5) break;
      if (x.o.attendees.has(maya)) continue;
      record(ctx, club, x.e, x.o, maya);
      count++;
    }
  }
  // Active in Psi Chi (psych): at one of the last two meetings.
  const psych = ctx.club("psych");
  const lastTwo = hostOccs(psych, addDays(NOW, -60)).sort((a, b) => b.o.startsAt.getTime() - a.o.startsAt.getTime()).slice(0, 2);
  if (lastTwo.length && !lastTwo.some((x) => x.o.attendees.has(maya))) record(ctx, psych, lastTwo[0].e, lastTwo[0].o, maya);
  // Wildcat Service Club (service): joined two weeks ago — at most one check-in so far (not review-eligible yet).
  const service = ctx.club("service");
  const svc = hostOccs(service, service.byUser.get(maya)!.joinedAt!);
  const mine = svc.filter((x) => x.o.attendees.has(maya));
  for (const x of mine.slice(1)) x.o.attendees.delete(maya);
  if (!mine.length && svc.length) record(ctx, service, svc[svc.length - 1].e, svc[svc.length - 1].o, maya);
  // Sam has no history at all.
  const sam = ctx.p("sam").id;
  for (const ev of [...ctx.universityEvents, ...ctx.clubs.flatMap((c) => c.events)]) for (const o of ev.occurrences) o.attendees.delete(sam);
}

/** Check-ins per (club, user) at the club's own events. */
export function attendanceCounts(ctx: Ctx): Map<string, Map<string, { count: number; third: Date | null; last: Date | null }>> {
  const out = new Map<string, Map<string, { count: number; third: Date | null; last: Date | null }>>();
  for (const club of ctx.clubs) {
    const byUser = new Map<string, { count: number; third: Date | null; last: Date | null }>();
    const occs = club.events.flatMap((e) => e.occurrences).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    for (const o of occs) {
      for (const [u, a] of o.attendees) {
        const cur = byUser.get(u) ?? { count: 0, third: null, last: null };
        cur.count++;
        if (cur.count === 3) cur.third = a.at;
        cur.last = a.at;
        byUser.set(u, cur);
      }
    }
    out.set(club.id, byUser);
  }
  return out;
}
