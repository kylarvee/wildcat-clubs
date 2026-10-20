import { randomBytes } from "node:crypto";
import type { RoleEndReason } from "@prisma/client";
import type { Assignment, ClubM, Ctx, Person } from "../ctx";
import { addDays, DAY, maxDate, minDate } from "../lib/dates";
import { seatsFor } from "@/lib/roles/defaults";
import { addMember, engagement, ensureMemberGraduating } from "./clubs";
import { decGraduation, fallStartDate, mayGraduation, springStartDate } from "./reference";

/**
 * Role history back to each club's founding: presidents, VPs and officers per
 * academic year with hand-offs at spring commencement, December graduations,
 * resignations and seats left empty for a while. Personas' roles are pinned so
 * their test scenarios hold, everything else is generated around them.
 */

/** Same as domain/advisors: the link is the only key to the invite page, so it's random, not a seeded id. */
const inviteToken = () => randomBytes(32).toString("base64url");

const FAR = new Date("2100-01-01T00:00:00Z");
const H = (y: number) => mayGraduation(y);

type Pin = { seat: string; userId: string; start: Date; end: Date | null; reason: RoleEndReason | null };

const REGULAR_ORDER = ["President", "Vice President", "Treasurer", "Secretary", "Events Coordinator", "Communications Officer", "Membership Officer"];
const AMB_ORDER = ["President", "Vice President", "Marketing Ambassador", "Inter-club Coordination Ambassador", "Events Ambassador", "Club Representative Ambassador"];

const FILL: Record<string, [number, number, number, number]> = {
  // [inactive, small, medium, large]
  President: [1, 1, 1, 1],
  "Vice President": [0.3, 0.7, 0.9, 0.97],
  Treasurer: [0.15, 0.55, 0.8, 0.92],
  Secretary: [0.1, 0.45, 0.72, 0.88],
  "Events Coordinator": [0.05, 0.35, 0.62, 0.9],
  "Communications Officer": [0.02, 0.18, 0.45, 0.72],
  "Membership Officer": [0, 0.08, 0.3, 0.66],
};

function pinsFor(ctx: Ctx): Map<string, Pin[]> {
  const { rng, NOW } = ctx;
  const pins = new Map<string, Pin[]>();
  const add = (club: string, pin: Pin) => pins.set(club, [...(pins.get(club) ?? []), pin]);
  const priya = ctx.p("priya").id;
  const vanessa = ctx.p("vanessa").id;
  const gwen = ctx.p("gwen").id;

  add("robotics", { seat: "Events Coordinator", userId: priya, start: H(2024), end: H(2025), reason: "SUCCEEDED" });
  add("robotics", { seat: "Vice President", userId: priya, start: H(2025), end: H(2026), reason: "SUCCEEDED" });
  add("robotics", { seat: "President", userId: priya, start: H(2026), end: null, reason: null });

  const swe = ctx.club("swe");
  const swePres = ensureMemberGraduating(ctx, swe, decGraduation(2026), addDays(H(2025), -60));
  ctx.refs.swePresident = swePres.id;
  add("swe", { seat: "Vice President", userId: swePres.id, start: H(2025), end: H(2026), reason: "SUCCEEDED" });
  add("swe", { seat: "President", userId: swePres.id, start: H(2026), end: null, reason: null });
  add("swe", { seat: "Secretary", userId: vanessa, start: H(2025), end: H(2026), reason: "SUCCEEDED" });
  add("swe", { seat: "Vice President", userId: vanessa, start: H(2026), end: null, reason: null });

  const psych = ctx.club("psych");
  const psychPres = ensureMemberGraduating(ctx, psych, decGraduation(2026), addDays(H(2025), -60));
  ctx.refs.psychPresident = psychPres.id;
  add("psych", { seat: "Secretary", userId: psychPres.id, start: H(2025), end: H(2026), reason: "SUCCEEDED" });
  add("psych", { seat: "President", userId: psychPres.id, start: H(2026), end: null, reason: null });

  const ailab = ctx.club("ailab");
  add("ailab", { seat: "Vice President", userId: gwen, start: addDays(ailab.approvedAt!, 2), end: H(2024), reason: "SUCCEEDED" });
  add("ailab", { seat: "President", userId: gwen, start: H(2024), end: H(2026), reason: "GRADUATED" });
  const successor = rng.pick(
    ailab.members.filter((m) => {
      const p = ctx.person(m.userId);
      return !p.persona && m.status === "ACTIVE" && m.joinedAt! <= addDays(H(2025), -40) && (p.gradDate ?? NOW) >= mayGraduation(2027);
    }),
  );
  ctx.refs.ailabPresident = successor.userId;
  add("ailab", { seat: "Events Coordinator", userId: successor.userId, start: H(2025), end: H(2026), reason: "SUCCEEDED" });
  add("ailab", { seat: "President", userId: successor.userId, start: H(2026), end: null, reason: null });

  const fic = ctx.club("fic");
  const t1 = rng.pick(
    fic.members.filter((m) => {
      const p = ctx.person(m.userId);
      return !p.persona && m.status === "ACTIVE" && m.joinedAt! <= addDays(H(2026), -40) && (p.gradDate ?? NOW) >= mayGraduation(2027);
    }),
  );
  ctx.refs.ficFormerTreasurer = t1.userId;
  ctx.refs.oscarRoleStart = addDays(NOW, -20.3).toISOString();
  add("fic", { seat: "Treasurer", userId: t1.userId, start: H(2026), end: addDays(NOW, -22.4), reason: "RESIGNED" });
  add("fic", { seat: "Treasurer", userId: ctx.p("oscar").id, start: addDays(NOW, -20.3), end: null, reason: null });

  add("gsbe-amb", { seat: "Club Representative Ambassador", userId: ctx.p("amir").id, start: addDays(fallStartDate(2025), 7.2), end: null, reason: null });
  return pins;
}

function periodsFor(club: ClubM) {
  const hs: Date[] = [];
  for (let y = 2023; y <= 2031; y++) {
    const h = H(y);
    if (h > club.createdAt && h < club.end) hs.push(h);
  }
  const bounds = [club.createdAt, ...hs, club.end];
  return bounds.slice(0, -1).map((s, i) => ({ start: s, end: bounds[i + 1] }));
}

/** Officers get their seat's default capabilities (leaders can customize them later in the Org Chart). */
function permissionsFor(seatPerms: string[]) {
  return [...seatPerms];
}

function history(ctx: Ctx, club: ClubM, pins: Pin[]) {
  const { rng, NOW } = ctx;
  const def = club.def;
  const isAmb = club.type === "COLLEGE_AMBASSADORS";
  const order = isAmb ? AMB_ORDER : REGULAR_ORDER;
  const excluded = new Set(pins.map((p) => p.userId));
  const live: Assignment[] = [];
  const size = def.status === "RETIRED" ? 24 : def.size;
  const tierBase = size >= 60 ? 3 : size >= 25 ? 2 : 1;
  const lastActive = def.lastActiveTerm ? ctx.term(def.lastActiveTerm).endsOn : null;

  const pinsOverlapping = (seat: string, s: Date, e: Date) => pins.filter((p) => p.seat === seat && p.start < e && (p.end ?? FAR) > s).length;
  const pinnedHolder = (userId: string, at: Date) => pins.some((p) => p.userId === userId && p.start <= at && (p.end ?? FAR) > at);

  const make = (seatName: string, userId: string, start: Date): Assignment | null => {
    if (start > NOW) return null;
    const seat = club.seats.get(seatName)!;
    const a: Assignment = {
      id: ctx.id(),
      clubId: club.id,
      userId,
      positionId: seat.id,
      seatName,
      role: seat.role,
      permissions: seat.role === "OFFICER" || seat.role === "AMBASSADOR" ? permissionsFor(seat.defaultPermissions) : [],
      viaClubId: null,
      startedAt: start,
      endedAt: null,
      endReason: null,
      assignedById: seatName === "President" && start.getTime() === club.createdAt.getTime() ? null : ctx.leaderAt(club, addDays(start, -0.01)),
    };
    if (a.assignedById === userId) a.assignedById = club.advisorIds[0] ?? null;
    club.assignments.push(a);
    live.push(a);
    return a;
  };
  // Former presidents aren't picked again for lower seats (no stepping down to VP).
  const formerPresidents = new Set<string>();
  const end = (a: Assignment, at: Date, reason: RoleEndReason) => {
    a.endedAt = at;
    a.endReason = reason;
    if (a.role === "PRESIDENT") formerPresidents.add(a.userId);
    const i = live.indexOf(a);
    if (i >= 0) live.splice(i, 1);
  };
  const liveIn = (seat: string) => live.filter((a) => a.seatName === seat);

  const okAt = (userId: string, at: Date, tenureDays: number, foundingOnly = false) => {
    const m = club.byUser.get(userId);
    const p = ctx.person(userId);
    if (!m || !m.joinedAt || p.kind !== "STUDENT" || p.persona || excluded.has(userId)) return false;
    if (m.status === "PENDING" || m.status === "DECLINED") return false;
    if (foundingOnly && m.source !== "FOUNDER") return false;
    if (m.joinedAt > addDays(at, -tenureDays)) return false;
    if (m.endedAt && m.endedAt < addDays(at, 60)) return false;
    if (!p.gradDate || p.gradDate < addDays(at, 100)) return false;
    return true;
  };

  const pick = (seatName: string, at: Date, tenureDays: number, foundingOnly = false): string | null => {
    const promotion = seatName === "President" || seatName === "Vice President";
    const cands = club.members
      .map((m) => m.userId)
      .filter((u) => okAt(u, at, tenureDays, foundingOnly))
      .filter((u) => !pinnedHolder(u, at) && !formerPresidents.has(u))
      .filter((u) => {
        const held = live.find((a) => a.userId === u);
        if (!held) return true;
        if (!promotion) return false;
        return seatName === "President" ? held.seatName !== "President" : !["President", "Vice President"].includes(held.seatName ?? "");
      });
    if (!cands.length) return null;
    const tenure = (u: string) => Math.max(1, (at.getTime() - club.byUser.get(u)!.joinedAt!.getTime()) / DAY);
    const isOfficer = (u: string) => live.some((a) => a.userId === u);
    // Clubs where the advisor and President pick (or the next in line moves up) favor long-serving officers; voting clubs, engaged members.
    const voted = def.succession === "MEMBER_VOTE" || def.succession === "SELF_SELECT";
    if (seatName === "President" && !voted) {
      return rng.weighted(cands, (u) => Math.pow(tenure(u), 2) * (isOfficer(u) ? 4 : 1) * club.byUser.get(u)!.eng.base);
    }
    return rng.weighted(cands, (u) => club.byUser.get(u)!.eng.base * Math.sqrt(tenure(u)) * (promotion && isOfficer(u) ? 3 : 1));
  };

  const place = (seatName: string, at: Date, tenureDays: number, foundingOnly = false) => {
    const u = pick(seatName, at, tenureDays, foundingOnly);
    if (!u) return null;
    const held = live.find((a) => a.userId === u);
    if (held) end(held, at, "SUCCEEDED");
    return make(seatName, u, at);
  };

  const dormantAfter = def.life === "dormant" && lastActive ? lastActive : null;
  const wantFor = (seatName: string, start: Date, pi: number): number => {
    const inactiveNow = lastActive && start > lastActive;
    if (dormantAfter && start > dormantAfter) return 0; // nobody took over once the club went quiet
    const tier = inactiveNow ? 0 : tierBase;
    if (isAmb) {
      if (seatName === "President") return 1;
      if (seatName === "Vice President") return rng.chance(0.9) ? 1 : 0;
      if (seatName === "Marketing Ambassador") return rng.int(1, 2);
      if (seatName === "Club Representative Ambassador") return def.key === "gsbe-amb" ? 5 : 4;
      return rng.chance(0.75) ? 1 : 0;
    }
    if (seatName === "President") return def.key === "bsu" && pi === periodsFor(club).length - 1 ? 2 : 1;
    const p = FILL[seatName]?.[tier] ?? 0;
    let n = rng.chance(p) ? 1 : 0;
    if (seatName === "Events Coordinator" && tier === 3 && rng.chance(0.45)) n = 2;
    return n;
  };

  const periods = periodsFor(club);
  periods.forEach((p, pi) => {
    // 1. Hand-off at spring commencement.
    if (pi > 0) {
      for (const a of [...live]) {
        const person = ctx.person(a.userId);
        if (person.gradDate && person.gradDate <= addDays(p.start, 10)) {
          end(a, minDate(person.gradDate, p.start), "GRADUATED");
          continue;
        }
        const seat = club.seats.get(a.seatName!)!;
        const pinnedOut = seat.maxHolders === 1 && pinsOverlapping(a.seatName!, p.start, p.end) > 0;
        const stays = rng.chance(a.seatName === "President" ? 0.3 : 0.42) && okAt(a.userId, p.start, 0);
        if (dormantAfter && p.start > dormantAfter) end(a, p.start, "RESIGNED");
        else if (pinnedOut || !stays) end(a, p.start, "SUCCEEDED");
      }
    }

    // 2. Fill seats for the year.
    for (const seatName of order) {
      if (!club.seats.has(seatName)) continue;
      const want = wantFor(seatName, p.start, pi) - pinsOverlapping(seatName, p.start, p.end);
      let guard = 0;
      while (liveIn(seatName).length < want && guard++ < 6) {
        if (pi === 0) {
          if (seatName === "President" && !excluded.has(club.founderId) && !live.some((a) => a.userId === club.founderId)) {
            make(seatName, club.founderId, club.createdAt);
            continue;
          }
          const atFounding = addDays(club.createdAt, rng.float(0.2, 3));
          const a = place(seatName, atFounding, 0, true);
          if (a) continue;
          const later = addDays(club.approvedAt ?? club.createdAt, rng.float(25, 45));
          if (later < minDate(p.end, NOW) && place(seatName, later, 14)) continue;
          break;
        }
        if (!place(seatName, p.start, 21)) break;
      }
    }

    // 3. Mid-year changes: December graduations, people who leave, resignations.
    for (const a of [...live]) {
      const person = ctx.person(a.userId);
      const m = club.byUser.get(a.userId);
      let endAt: Date | null = null;
      let reason: RoleEndReason = "RESIGNED";
      if (person.gradDate && person.gradDate > a.startedAt && person.gradDate < p.end) {
        endAt = person.gradDate;
        reason = "GRADUATED";
      }
      if (m?.endedAt && m.endedAt > a.startedAt && m.endedAt < p.end && (!endAt || m.endedAt < endAt)) {
        endAt = m.endedAt;
        reason = "RESIGNED";
      }
      if (!endAt && rng.chance(0.06)) {
        const lo = addDays(maxDate(a.startedAt, p.start), 30);
        const hi = addDays(minDate(p.end, NOW), -20);
        if (hi > lo) endAt = new Date(lo.getTime() + rng.next() * (hi.getTime() - lo.getTime()));
      }
      if (!endAt || endAt > NOW) continue;
      end(a, endAt, reason);
      const seatName = a.seatName!;
      const seat = club.seats.get(seatName)!;
      if (seat.maxHolders === 1 && pinsOverlapping(seatName, endAt, p.end) > 0) continue;
      if (!rng.chance(seatName === "President" ? 0.95 : 0.5)) continue; // otherwise the seat sits empty until the next hand-off
      const nextSpring = springStartDate(new Date(endAt).getUTCFullYear() + (new Date(endAt).getUTCMonth() >= 6 ? 1 : 0));
      const refillAt = reason === "GRADUATED" ? addDays(nextSpring, rng.float(5, 20)) : addDays(endAt, rng.float(12, 40));
      if (refillAt >= minDate(p.end, NOW)) continue;
      if (dormantAfter && refillAt > dormantAfter) continue;
      const b = place(seatName, refillAt, 21);
      if (b) {
        const bp = ctx.person(b.userId);
        if (bp.gradDate && bp.gradDate < p.end && bp.gradDate <= NOW) end(b, bp.gradDate, "GRADUATED");
      }
    }
  });

  // Retired clubs close every seat.
  if (club.retiredAt) for (const a of [...live]) end(a, club.retiredAt, "CLUB_RETIRED");

  // Pinned (persona) history.
  for (const pin of pins) {
    const seat = club.seats.get(pin.seat)!;
    club.assignments.push({
      id: ctx.id(),
      clubId: club.id,
      userId: pin.userId,
      positionId: seat.id,
      seatName: pin.seat,
      role: seat.role,
      permissions: seat.role === "OFFICER" || seat.role === "AMBASSADOR" ? [...seat.defaultPermissions] : [],
      viaClubId: null,
      startedAt: pin.start,
      endedAt: pin.end && pin.end <= NOW ? pin.end : null,
      endReason: pin.end && pin.end <= NOW ? pin.reason : null,
      assignedById: null,
      pinned: true,
    });
  }
  for (const a of club.assignments) if (a.pinned && !a.assignedById) a.assignedById = otherLeader(club, a);

  // Dormant clubs: whoever still held a seat when the club went quiet stepped down at the next hand-off.
  if (dormantAfter) {
    const stop = periods.find((x) => x.start > dormantAfter)?.start ?? addDays(dormantAfter, 30);
    for (const a of [...live]) end(a, minDate(maxDate(stop, addDays(a.startedAt, 1)), addDays(NOW, -30)), "RESIGNED");
  }

  // Directory clubs: today's seats match the real list's officer counts.
  if (def.seatPlan && !dormantAfter) {
    const plan = def.seatPlan;
    const yearStart = periods[periods.length - 1].start;
    const recent = () => minDate(maxDate(addDays(NOW, -rng.float(20, 140)), addDays(club.approvedAt ?? club.createdAt, 2), yearStart), addDays(NOW, -2));
    for (const seatName of order) {
      if (!club.seats.has(seatName)) continue;
      const want = plan[seatName] ?? 0;
      // More holders than the list shows: the extras stepped down earlier this year.
      for (const a of liveIn(seatName).sort((x, y) => x.startedAt.getTime() - y.startedAt.getTime()).slice(want)) {
        end(a, minDate(addDays(NOW, -1), maxDate(addDays(a.startedAt, 1), addDays(NOW, -rng.float(10, 60)))), "RESIGNED");
      }
      for (let guard = 0; liveIn(seatName).length < want && guard < 4; guard++) {
        const at = recent();
        if (place(seatName, at, 14)) continue;
        // Small clubs: anyone still on the roster without a seat (even someone who joined this week; their seat starts a day after they joined).
        const free = club.members.filter((m) => {
          const p = ctx.person(m.userId);
          return m.status === "ACTIVE" && m.joinedAt && m.joinedAt < addDays(NOW, -1) && p.kind === "STUDENT" && !p.persona && !excluded.has(m.userId) && !live.some((a) => a.userId === m.userId);
        });
        if (!free.length) break;
        const m = rng.weighted(free, (x) => x.eng.base);
        make(seatName, m.userId, minDate(maxDate(at, addDays(m.joinedAt!, 1)), addDays(NOW, -1)));
      }
    }
    // A seat holder registered before taking the seat (a check-in join would move their join date past it).
    for (const a of club.assignments) {
      const m = club.byUser.get(a.userId);
      if (m?.viaCheckin) {
        m.viaCheckin = false;
        m.source = "REGISTER";
      }
    }
  }

  // Every story club has a president today (directory clubs follow the list).
  if (club.status === "APPROVED" && def.story && !club.assignments.some((a) => a.role === "PRESIDENT" && !a.endedAt)) {
    const at = maxDate(addDays(NOW, -rng.float(20, 60)), addDays(club.approvedAt!, 1));
    let u = pick("President", at, 0);
    if (!u) {
      // Small clubs: anyone still active will do.
      const cands = club.members.filter((m) => m.status === "ACTIVE" && m.joinedAt && m.joinedAt < NOW && ctx.person(m.userId).kind === "STUDENT" && !ctx.person(m.userId).persona && !excluded.has(m.userId));
      if (cands.length) u = rng.weighted(cands, (m) => m.eng.base).userId;
    }
    if (u) {
      const start = maxDate(at, addDays(club.byUser.get(u)!.joinedAt!, 1));
      const held = live.find((a) => a.userId === u);
      if (held) end(held, start, "SUCCEEDED");
      make("President", u, minDate(start, addDays(NOW, -1)));
    }
  }
}

function otherLeader(club: ClubM, a: Assignment): string | null {
  const at = addDays(a.startedAt, -0.01);
  const pres = club.assignments.find((x) => x.role === "PRESIDENT" && x.userId !== a.userId && x.startedAt <= at && (!x.endedAt || x.endedAt > at));
  return pres?.userId ?? club.advisorIds[0] ?? null;
}

// ─── Advisors ────────────────────────────────────────────────────────────────

const STAFF_FOR: Record<string, string> = {
  bsu: "multicultural", lia: "multicultural2", firstgen: "multicultural", veterans: "veterans", isa: "international",
  climbing: "rec2", ultimate: "rec", ski: "rec2", pickleball: "rec", rugby: "rec", pride: "lgbt", service: "service",
  anime: "library", chess: "library", boardgames: "library", poker: "success", paintball: "rec", discgolf: "rec2",
};

/** Campus offices whose staff advise directory clubs without a department, by WSUSA category. */
const STAFF_BY_CATEGORY: Record<string, string[]> = {
  CULTURAL: ["multicultural", "multicultural2", "international", "nontrad"],
  SERVICE_ADVOCACY: ["service", "sustain", "womens", "access", "involvement2"],
  FSL: ["involvement", "involvement2"],
  HONOR_SOCIETY: ["honors", "success"],
  RELIGIOUS: ["library", "success", "involvement", "alumni"],
  STUDENT_LIFE: ["involvement", "involvement2", "library", "alumni"],
  ACADEMIC: ["success", "healthadv", "honors"],
};

/** Current advisorships per person, so advisors spread across faculty and staff. */
const advisorLoad = new Map<string, number>();

function advisorFor(ctx: Ctx, club: ClubM, exclude: string[] = []): Person {
  const { rng } = ctx;
  const def = club.def;
  const staffKey = STAFF_FOR[def.key];
  if (def.story && staffKey && !exclude.includes(ctx.refs[`staff:${staffKey}`])) return ctx.person(ctx.refs[`staff:${staffKey}`]);
  const leastLoaded = (xs: Person[]) => {
    const min = Math.min(...xs.map((x) => advisorLoad.get(x.id) ?? 0));
    return rng.pick(xs.filter((x) => (advisorLoad.get(x.id) ?? 0) === min));
  };
  const faculty = ctx.staff.filter((s) => s.departmentId && !exclude.includes(s.id));
  const inDept = faculty.filter((s) => club.departmentId && s.departmentId === club.departmentId);
  if (inDept.length) return def.story ? rng.pick(inDept) : leastLoaded(inDept);
  const inCollege = faculty.filter((s) => club.collegeKey && s.collegeKey === club.collegeKey);
  if (inCollege.length) return def.story ? rng.pick(inCollege) : leastLoaded(inCollege);
  if (!def.story) {
    const keys = club.scope === "SPORTS" ? ["rec", "rec2", "athletics"] : def.topic === "health" ? ["healthadv", "success"] : STAFF_BY_CATEGORY[def.category] ?? ["involvement"];
    const offices = keys.map((k) => ctx.refs[`staff:${k}`]).filter((id) => id && !exclude.includes(id)).map((id) => ctx.person(id));
    // Faculty from any college volunteer too.
    const volunteers = rng.sample(faculty, 3);
    const pool = [...offices, ...volunteers];
    if (pool.length) return leastLoaded(pool);
  }
  const success = ctx.refs["staff:success"];
  return ctx.person(exclude.includes(success) ? rng.pick(faculty).id : success);
}

function addAdvisor(ctx: Ctx, club: ClubM, advisor: Person, start: Date, endAt: Date | null, reason: RoleEndReason | null, invitedBy: string) {
  const { rng, NOW } = ctx;
  club.assignments.push({
    id: ctx.id(), clubId: club.id, userId: advisor.id, positionId: null, seatName: null, role: "ADVISOR", permissions: [], viaClubId: null,
    startedAt: start, endedAt: endAt, endReason: reason, assignedById: null,
  });
  if (!endAt) advisorLoad.set(advisor.id, (advisorLoad.get(advisor.id) ?? 0) + 1);
  if (!club.advisorIds.includes(advisor.id) && !endAt) club.advisorIds.unshift(advisor.id);
  else if (!club.advisorIds.includes(advisor.id)) club.advisorIds.push(advisor.id);
  const m = addMember(ctx, club, advisor.id, { status: endAt ? (club.retiredAt ? "ALUMNI" : "LEFT") : "ACTIVE", source: "ADVISOR", joinedAt: start, endedAt: endAt, eng: { base: 0.08, half: 999, floor: 1 } });
  void m;
  const invitedAt = addDays(start, -rng.float(1, 4));
  ctx.rows.invites.push({
    id: ctx.id(), clubId: club.id, name: advisor.name, email: advisor.email, token: inviteToken(), status: "ACCEPTED",
    invitedById: invitedBy, inviteeId: advisor.id, createdAt: invitedAt < NOW ? invitedAt : NOW, respondedAt: start,
  });
}

/**
 * A directory club's advisors follow the real list: as many current advisors
 * as it shows. Clubs without one had an advisor when they were approved who
 * has since stepped down; dormant clubs' advisor term ended once they went quiet.
 */
function directoryAdvisors(ctx: Ctx, club: ClubM, start: Date) {
  const { rng, NOW } = ctx;
  const def = club.def;
  const first = advisorFor(ctx, club);
  if (def.life === "dormant") {
    const quiet = ctx.term(def.lastActiveTerm!).endsOn;
    const endAt = minDate(maxDate(addDays(quiet, rng.float(20, 120)), addDays(start, 120)), addDays(NOW, -200));
    addAdvisor(ctx, club, first, start, endAt, "TERM_ENDED", club.founderId);
    return;
  }
  const want = def.advisors ?? 0;
  if (want === 0) {
    const options = [H(2025), H(2026)].filter((h) => h > addDays(start, 150) && h < NOW);
    const endAt = options.length ? rng.pick(options) : addDays(NOW, -rng.float(20, Math.max(25, Math.min(150, (NOW.getTime() - start.getTime()) / DAY - 60))));
    addAdvisor(ctx, club, first, start, maxDate(endAt, addDays(start, 30)), rng.pick(["TERM_ENDED", "RESIGNED"] as RoleEndReason[]), club.founderId);
    return;
  }
  addAdvisor(ctx, club, first, start, null, null, club.founderId);
  if (want >= 2) {
    const second = advisorFor(ctx, club, [first.id]);
    const at = maxDate(addDays(start, rng.float(30, 400)), start);
    addAdvisor(ctx, club, second, minDate(at, addDays(NOW, -10)), null, null, ctx.leaderAt(club, at));
  }
}

function buildAdvisors(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const elena = ctx.p("elena");
  advisorLoad.clear();
  for (const club of ctx.clubs) {
    if (club.def.life === "draft") continue;
    const start =
      club.def.life === "submitted" ? addDays(NOW, -30.2) : addDays(club.createdAt, rng.float(3, Math.max(3.5, Math.min(9, ((club.submittedAt ?? NOW).getTime() - club.createdAt.getTime()) / DAY - 0.5))));
    const finalEnd = club.retiredAt;
    if (!club.def.story) {
      directoryAdvisors(ctx, club, start);
      continue;
    }
    if (club.def.key === "robotics") {
      addAdvisor(ctx, club, elena, start, null, null, club.founderId);
      continue;
    }
    if (club.def.key === "premed") {
      const first = advisorFor(ctx, club, [elena.id]);
      addAdvisor(ctx, club, first, start, H(2024), "TERM_ENDED", club.founderId);
      addAdvisor(ctx, club, elena, H(2024), null, null, ctx.leaderAt(club, H(2024)));
      continue;
    }
    if (club.def.key === "boardgames") {
      // An earlier invitee (the Student Success Center advisor) said no before the librarian said yes.
      const declined = ctx.person(ctx.refs["staff:success"]);
      ctx.rows.invites.push({
        id: ctx.id(), clubId: club.id, name: declined.name, email: declined.email, token: inviteToken(), status: "DECLINED",
        invitedById: club.founderId, inviteeId: declined.id, createdAt: addDays(NOW, -36.4), respondedAt: addDays(NOW, -34.1),
      });
    }
    const first = advisorFor(ctx, club);
    const change = club.createdAt < new Date("2024-01-01T00:00:00Z") && club.status === "APPROVED" && rng.chance(0.2);
    if (change) {
      const at = H(rng.pick([2024, 2025]));
      if (at < club.end) {
        addAdvisor(ctx, club, first, start, at, rng.pick(["TERM_ENDED", "RESIGNED"] as RoleEndReason[]), club.founderId);
        const second = advisorFor(ctx, club, [first.id]);
        addAdvisor(ctx, club, second, at, finalEnd, finalEnd ? "CLUB_RETIRED" : null, ctx.leaderAt(club, at));
        continue;
      }
    }
    addAdvisor(ctx, club, first, start, finalEnd, finalEnd ? "CLUB_RETIRED" : null, club.founderId);
  }

  // Frank's draft club: invite to Prof. Nathan Reed, waiting on him.
  const bee = ctx.club("beekeeping");
  const nathan = ctx.p("nathan");
  const invite = {
    id: ctx.id(), clubId: bee.id, name: nathan.name, email: nathan.email, token: inviteToken(), status: "PENDING" as const,
    invitedById: ctx.p("frank").id, inviteeId: nathan.id, createdAt: addDays(NOW, -3.2), respondedAt: null,
  };
  ctx.rows.invites.push(invite);
  ctx.refs.beeInviteId = invite.id;
  ctx.refs.beeInviteToken = invite.token;
}

// ─── Founding-stage clubs ────────────────────────────────────────────────────

function foundingRoles(ctx: Ctx, club: ClubM) {
  const mk = (seatName: string, userId: string, start: Date) => {
    const seat = club.seats.get(seatName)!;
    club.assignments.push({
      id: ctx.id(), clubId: club.id, userId, positionId: seat.id, seatName, role: seat.role,
      permissions: seat.role === "OFFICER" ? [...seat.defaultPermissions] : [], viaClubId: null, startedAt: start, endedAt: null, endReason: null,
      assignedById: seatName === "President" ? null : club.founderId,
    });
  };
  mk("President", club.founderId, club.createdAt);
  const friends = club.members.filter((m) => m.source === "FOUNDER" && m.userId !== club.founderId);
  const seats = ["Vice President", "Treasurer", "Secretary"];
  friends.forEach((m, i) => {
    if (seats[i]) mk(seats[i], m.userId, addDays(club.createdAt, 1 + i));
  });
}

// ─── College ambassador placements ───────────────────────────────────────────

function placements(ctx: Ctx) {
  const { rng, NOW } = ctx;
  for (const org of ctx.clubs.filter((c) => c.type === "COLLEGE_AMBASSADORS")) {
    // Reps go to the college's clubs that meet (not the small or dormant ones on the list).
    const targets = ctx.clubs.filter((c) => c.collegeKey === org.collegeKey && c.type !== "COLLEGE_AMBASSADORS" && c.approvedAt && (c.status === "APPROVED" || c.status === "RETIRED") && c.def.life !== "dormant" && c.def.life !== "small");
    const place = (target: ClubM, userId: string, start: Date, endAt: Date | null, reason: RoleEndReason | null) => {
      const seat = target.seats.get("College Ambassador")!;
      target.assignments.push({
        id: ctx.id(), clubId: target.id, userId, positionId: seat.id, seatName: "College Ambassador", role: "AMBASSADOR", permissions: [],
        viaClubId: org.id, startedAt: start, endedAt: endAt, endReason: reason, assignedById: ctx.leaderAt(org, start),
      });
      const p = ctx.person(userId);
      const existing = target.byUser.get(userId);
      if (existing && (existing.status === "PENDING" || existing.status === "DECLINED")) {
        // A placement settles any join request: they're in from the placement on.
        const graduated = endAt && p.gradDate && p.gradDate <= endAt;
        existing.status = endAt ? (graduated ? "ALUMNI" : "LEFT") : "ACTIVE";
        existing.joinedAt = start;
        existing.requestedAt = start;
        existing.endedAt = endAt;
        existing.source = "REGISTER";
      } else if (existing?.joinedAt && existing.joinedAt > start) {
        // Placed before they'd joined on their own: the placement is when they joined.
        existing.joinedAt = start;
        existing.requestedAt = start;
        existing.viaCheckin = false;
        existing.source = "REGISTER";
      }
      if (!existing) {
        const graduated = endAt && p.gradDate && p.gradDate <= endAt;
        addMember(ctx, target, userId, {
          status: endAt ? (graduated ? "ALUMNI" : "LEFT") : "ACTIVE",
          source: "REGISTER",
          joinedAt: start,
          endedAt: endAt,
          eng: engagement(ctx, "regular"),
        });
      }
    };
    const covered = (target: ClubM, s: Date, e: Date) =>
      target.assignments.filter((a) => a.viaClubId === org.id && a.startedAt < e && (a.endedAt ?? NOW) > s).length;

    if (org.def.key === "gsbe-amb") {
      const amir = org.assignments.find((a) => a.userId === ctx.p("amir").id && a.seatName === "Club Representative Ambassador")!;
      for (const key of ["accounting", "marketing"]) place(ctx.club(key), amir.userId, addDays(amir.startedAt, 7.1), null, null);
    }
    const reps = org.assignments.filter((a) => a.seatName === "Club Representative Ambassador" && a.userId !== ctx.p("amir").id);
    for (const r of reps.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
      const start = addDays(r.startedAt, rng.float(7, 14));
      const endAt = r.endedAt;
      if (start > NOW || (endAt && endAt <= start)) continue;
      const open = rng.shuffle(targets.filter((t) => t.approvedAt! < start && (!t.retiredAt || t.retiredAt > start) && covered(t, start, endAt ?? NOW) === 0));
      for (const t of open.slice(0, rng.int(1, 2))) place(t, r.userId, start, endAt && t.retiredAt && t.retiredAt < endAt ? t.retiredAt : endAt, endAt ? r.endReason : null);
    }
  }
  // PERSONAS: RC Wrecker Bots and SWE have no College Ambassador right now. A placement there, if
  // the draw made one, ended this term, so Priya can ask for a new one (steps/inbox) and Vanessa can
  // ask too. This runs after the draw and uses no randomness, so nothing else shifts.
  const termEnd = addDays(NOW, -20);
  for (const key of ["robotics", "swe"]) {
    for (const a of ctx.club(key).assignments) {
      if (a.role !== "AMBASSADOR" || !a.viaClubId || a.endedAt) continue;
      a.endedAt = a.startedAt < termEnd ? termEnd : new Date(Math.min(NOW.getTime() - 60_000, a.startedAt.getTime() + 60_000));
      a.endReason = "TERM_ENDED";
    }
  }
}

// ─── Mid-term officer changes (people still inside their requirement grace period) ──

function recentSuccessions(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const skip = new Set(["robotics", "swe", "psych", "ailab", "fic", "gsbe-amb", "east-amb", "premed", "service", "climbing", "polisci"]);
  const clubs = rng.shuffle(ctx.clubs.filter((c) => c.status === "APPROVED" && c.def.life === "active" && !skip.has(c.def.key)));
  let done = 0;
  for (const club of clubs) {
    if (done >= 10) break;
    const current = club.assignments.filter((a) => a.role === "OFFICER" && !a.endedAt && !a.pinned && a.startedAt < addDays(NOW, -60));
    if (!current.length) continue;
    const a = rng.pick(current);
    const endAt = addDays(NOW, -rng.float(19, 30));
    a.endedAt = endAt;
    a.endReason = "RESIGNED";
    const start = addDays(NOW, -rng.float(3, 20));
    const busy = new Set(club.assignments.filter((x) => !x.endedAt).map((x) => x.userId));
    const cands = club.members.filter((m) => {
      const p = ctx.person(m.userId);
      return m.status === "ACTIVE" && m.joinedAt! < addDays(start, -30) && !busy.has(m.userId) && !p.persona && p.kind === "STUDENT" && (p.gradDate ?? NOW) > addDays(NOW, 150);
    });
    if (!cands.length) continue;
    const u = rng.weighted(cands, (m) => m.eng.base).userId;
    const seat = club.seats.get(a.seatName!)!;
    club.assignments.push({
      id: ctx.id(), clubId: club.id, userId: u, positionId: seat.id, seatName: seat.name, role: "OFFICER", permissions: [...seat.defaultPermissions],
      viaClubId: null, startedAt: start, endedAt: null, endReason: null, assignedById: ctx.leaderAt(club, start),
    });
    done++;
  }
}

// ─── Wildcat Investors' line (steps/community buildElections) ───────────────

/**
 * PERSONAS: Wildcat Investors' Next in line vote needs an officer seated behind
 * Oscar (Treasurer), so someone behind him can say yes while his answer still
 * decides it. If the draw left those seats empty, the club's most engaged
 * member without a seat became Events Coordinator a few days after Oscar took
 * his seat. This uses no randomness, so nothing else shifts.
 */
function ficLine(ctx: Ctx) {
  const { NOW } = ctx;
  const club = ctx.club("fic");
  const line = seatsFor(club.type).filter((s) => s.role !== "AMBASSADOR").map((s) => s.name);
  const behind = new Set(line.slice(line.indexOf("Treasurer") + 1));
  const live = club.assignments.filter((a) => !a.endedAt);
  const seated = (a: Assignment) => a.seatName !== null && behind.has(a.seatName) && ctx.person(a.userId).kind === "STUDENT" && ctx.person(a.userId).status === "ACTIVE";
  if (live.some(seated)) return;
  const start = addDays(NOW, -15.6);
  const busy = new Set(live.map((a) => a.userId));
  const pick = club.members
    .filter((m) => {
      const p = ctx.person(m.userId);
      return m.status === "ACTIVE" && !m.viaCheckin && m.joinedAt! < addDays(start, -30) && !busy.has(m.userId) && !p.persona && p.kind === "STUDENT" && p.status === "ACTIVE" && (p.gradDate ?? NOW) > addDays(NOW, 150);
    })
    .sort((a, b) => b.eng.base - a.eng.base || a.joinedAt!.getTime() - b.joinedAt!.getTime())[0];
  if (!pick) return;
  const seat = club.seats.get("Events Coordinator")!;
  club.assignments.push({
    id: ctx.id(), clubId: club.id, userId: pick.userId, positionId: seat.id, seatName: seat.name, role: seat.role, permissions: [...seat.defaultPermissions],
    viaClubId: null, startedAt: start, endedAt: null, endReason: null, assignedById: ctx.leaderAt(club, start), pinned: true,
  });
}

// ─── Review trail with WSUSA ─────────────────────────────────────────────────

function decisions(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const jordan = ctx.refs["admin:jordan"];
  const rosa = ctx.refs["admin:rosa"];
  const alex = ctx.p("alex").id;
  const adminAt = (at: Date) => (at < new Date("2025-06-01T00:00:00Z") ? rng.pick([jordan, jordan, rosa]) : rng.pick([alex, alex, jordan]));
  const push = (clubId: string, action: Parameters<typeof ctx.rows.decisions.push>[0]["action"], byId: string, at: Date, note: string | null = null) =>
    ctx.rows.decisions.push({ id: ctx.id(), clubId, action, byId, at, note });

  for (const club of ctx.clubs) {
    const def = club.def;
    if (def.life === "draft") continue;
    const sub = club.submittedAt!;
    if (def.life === "submitted") {
      push(club.id, "SUBMITTED", club.founderId, sub);
      continue;
    }
    if (def.life === "changes") {
      push(club.id, "SUBMITTED", club.founderId, sub);
      push(
        club.id, "CHANGES_REQUESTED", alex, addDays(NOW, -6.3),
        "Thanks for submitting Aviation Club! Two things before we can approve it: (1) Sponsored clubs need a sponsoring department. You typed in \"Aviation Technology\", which isn't on our list yet — we've asked to add it, and once it's there please select it on your profile. (2) Your bylaws don't say how the next president is chosen. Name your primary way of choosing leaders in the Constitution Builder's succession section (Advisor & President is the recommended default), then resubmit.",
      );
      ctx.refs.aviationChangesAt = addDays(NOW, -6.3).toISOString();
      continue;
    }
    push(club.id, "SUBMITTED", club.founderId, sub);
    if (def.life === "rejected") {
      push(club.id, "REJECTED", alex, addDays(sub, 12), def.rejectedNote ?? null);
      continue;
    }
    if (club.approvedAt) {
      if (rng.chance(0.25)) {
        const cr = addDays(sub, rng.float(2, Math.max(2.5, (club.approvedAt.getTime() - sub.getTime()) / DAY / 2)));
        push(club.id, "CHANGES_REQUESTED", adminAt(cr), cr, rng.pick([
          "Please add a short description and choose a focus major or discipline, then resubmit.",
          "Your constitution needs a non-discrimination statement. The builder's default module covers it.",
          "Please confirm your advisor in the platform — the invite is still pending.",
        ]));
        push(club.id, "SUBMITTED", club.founderId, addDays(cr, (club.approvedAt.getTime() - cr.getTime()) / DAY / 2));
      }
      push(club.id, "APPROVED", adminAt(club.approvedAt), club.approvedAt, `Welcome to Wildcat Clubs! ${club.name} is approved. Next step: set up your calendar and invite members.`);
    }
    if (club.retiredAt) push(club.id, "RETIRED", ctx.leaderAt(club, addDays(club.retiredAt, -1)), club.retiredAt, def.retired?.reason ?? null);
  }
}

export function buildRoles(ctx: Ctx) {
  buildAdvisors(ctx);
  const pins = pinsFor(ctx);
  for (const club of ctx.clubs) {
    if (["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "REJECTED"].includes(club.status)) foundingRoles(ctx, club);
    else history(ctx, club, pins.get(club.def.key) ?? []);
  }
  placements(ctx);
  recentSuccessions(ctx);
  ficLine(ctx);
  decisions(ctx);
  // Keep the advisor list current-first for leaderAt().
  for (const club of ctx.clubs) {
    club.advisorIds = club.assignments.filter((a) => a.role === "ADVISOR").sort((a, b) => Number(Boolean(a.endedAt)) - Number(Boolean(b.endedAt))).map((a) => a.userId);
  }
}
