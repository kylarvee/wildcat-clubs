import type { MembershipSource, MembershipStatus } from "@prisma/client";
import { seatsFor } from "@/lib/roles/defaults";
import type { ClubM, Ctx, Engagement, Member, Person } from "../ctx";
import { CLUBS, type ClubDef, type Topic } from "../data/clubs";
import { addDays, campusDate, DAY, maxDate, minDate } from "../lib/dates";
import { generatedStudents } from "./people";
import { fallStartDate, mayGraduation, springStartDate } from "./reference";

/**
 * Clubs, their org-chart seats and their memberships. Approved clubs get
 * members sampled with college affinity (so business students cluster in
 * business clubs), joins bunched at the start of each semester, and a mix of
 * core, regular and drop-in members whose engagement fades at different rates.
 * Directory clubs end up with about as many members as their real roster;
 * dormant ones keep only a past roster and at most a couple of members.
 */

export function engagement(ctx: Ctx, kind?: "core" | "regular" | "casual"): Engagement {
  const { rng } = ctx;
  const r = rng.next();
  const k = kind ?? (r < 0.24 ? "core" : r < 0.6 ? "regular" : "casual");
  if (k === "core") return { base: rng.float(0.66, 0.86), half: rng.float(60, 160), floor: 0.6 };
  if (k === "regular") return { base: rng.float(0.42, 0.62), half: rng.float(20, 50), floor: 0.4 };
  return { base: rng.float(0.26, 0.44), half: rng.float(5, 14), floor: 0.12 };
}

/** A join time inside [a, b), bunched in the first weeks of fall and spring terms. */
export function joinTime(ctx: Ctx, a: Date, b: Date): Date | null {
  const { rng } = ctx;
  if (b.getTime() - a.getTime() < DAY) return null;
  const terms = ctx.terms.filter((t) => t.endsOn > a && t.startsOn < b);
  if (!terms.length) return clamp(new Date(a.getTime() + rng.next() * (b.getTime() - a.getTime())), a, b);
  const t = rng.weighted(terms, (x) => {
    const overlap = Math.min(x.endsOn.getTime(), b.getTime()) - Math.max(x.startsOn.getTime(), a.getTime());
    return Math.max(0, overlap) * (x.kind === "SUMMER" ? 0.12 : 1);
  });
  const lo = maxDate(a, t.startsOn);
  const hi = minDate(b, t.endsOn);
  const r = rng.next();
  const offsetDays = r < 0.55 ? rng.float(-6, 20) : r < 0.85 ? rng.float(21, 60) : rng.float(61, 110);
  let d = addDays(t.startsOn, offsetDays);
  if (d < lo || d >= hi) d = new Date(lo.getTime() + rng.next() * Math.max(DAY, hi.getTime() - lo.getTime()));
  // Daytime, campus-ish hours.
  const withHour = new Date(Math.floor(d.getTime() / DAY) * DAY + rng.int(15, 27) * 3_600_000 + rng.int(0, 59) * 60_000);
  return clamp(withHour, a, addDays(b, -0.01));
}

function clamp(d: Date, a: Date, b: Date) {
  return d < a ? a : d > b ? b : d;
}

export function addMember(
  ctx: Ctx,
  club: ClubM,
  userId: string,
  m: { status: MembershipStatus; source: MembershipSource; joinedAt: Date | null; endedAt?: Date | null; requestedAt?: Date; eng?: Engagement; viaCheckin?: boolean },
): Member {
  const existing = club.byUser.get(userId);
  if (existing) return existing;
  const member: Member = {
    id: ctx.id(),
    userId,
    clubId: club.id,
    status: m.status,
    source: m.source,
    requestedAt: m.requestedAt ?? m.joinedAt ?? ctx.NOW,
    joinedAt: m.joinedAt,
    endedAt: m.endedAt ?? null,
    internalTitle: null,
    eng: m.eng ?? engagement(ctx),
    viaCheckin: m.viaCheckin,
  };
  club.members.push(member);
  club.byUser.set(userId, member);
  return member;
}

function clubTiming(ctx: Ctx, def: ClubDef) {
  const { rng, NOW } = ctx;
  const termStart = ctx.termFor(NOW).startsOn;
  let createdAt: Date;
  let submittedAt: Date | null = null;
  let approvedAt: Date | null = null;
  let retiredAt: Date | null = null;
  switch (def.life) {
    case "pilot": {
      createdAt = minDate(addDays(termStart, rng.float(5, 13)), addDays(NOW, -32 + rng.float(0, 4)));
      submittedAt = addDays(createdAt, rng.float(3, 6));
      approvedAt = minDate(addDays(submittedAt, rng.float(4, 8)), addDays(NOW, -12));
      break;
    }
    case "draft":
      createdAt = addDays(NOW, -9.3);
      break;
    case "submitted":
      createdAt = addDays(NOW, -38.2);
      submittedAt = addDays(NOW, -5.1);
      break;
    case "changes":
      createdAt = addDays(NOW, -33.4);
      submittedAt = addDays(NOW, -14.2);
      break;
    default: {
      const [y, m] = def.founded ?? [2023, 9];
      createdAt = campusDate(y, m, rng.int(3, 20), rng.int(10, 19), rng.int(0, 59));
      submittedAt = addDays(createdAt, rng.float(5, 16));
      if (def.status === "APPROVED" || def.status === "RETIRED") approvedAt = addDays(submittedAt, rng.float(6, 18));
      if (def.retired) retiredAt = campusDate(def.retired.at[0], def.retired.at[1], def.retired.at[2], 15, 0);
    }
  }
  return { createdAt, submittedAt, approvedAt, retiredAt };
}

function pickFounder(ctx: Ctx, def: ClubDef, createdAt: Date): Person {
  const { rng } = ctx;
  if (def.key === "beekeeping" || def.key === "boardgames") return ctx.p("frank");
  const pool = generatedStudents(ctx).filter((s) => {
    if (s.enrollStart > addDays(createdAt, -45) || !s.gradDate) return false;
    if (def.key === "ailab") return s.gradDate.getTime() === mayGraduation(2024).getTime();
    return s.gradDate > addDays(createdAt, 300);
  });
  const usable = pool.length ? pool : generatedStudents(ctx).filter((s) => s.enrollStart <= createdAt && (s.gradDate ?? createdAt) > addDays(createdAt, 120));
  const majorId = def.focusMajor ? ctx.majors.get(def.focusMajor)?.id : null;
  return rng.weighted(usable, (s) => (s.majorId && s.majorId === majorId ? 8 : def.college && s.collegeKey === def.college ? 4 : 1) * (ctx.refs[`founder:${s.id}`] ? 0.05 : 1));
}

export function buildClubs(ctx: Ctx) {
  for (const def of CLUBS) {
    const t = clubTiming(ctx, def);
    const founder = pickFounder(ctx, def, t.createdAt);
    ctx.refs[`founder:${founder.id}`] = def.key;
    const club: ClubM = {
      id: ctx.id(),
      def,
      slug: def.slug,
      name: def.name,
      type: def.type,
      status: def.status,
      scope: def.scope,
      collegeKey: def.college ?? null,
      collegeId: def.college ? ctx.colleges.get(def.college)!.id : null,
      departmentId: def.department ? (ctx.departments.get(def.department)?.id ?? null) : null,
      focusMajorId: def.focusMajor ? (ctx.majors.get(def.focusMajor)?.id ?? null) : null,
      createdAt: t.createdAt,
      submittedAt: t.submittedAt,
      approvedAt: t.approvedAt,
      retiredAt: t.retiredAt,
      founderId: founder.id,
      end: t.retiredAt ?? ctx.NOW,
      seats: new Map(),
      members: [],
      byUser: new Map(),
      assignments: [],
      events: [],
      advisorIds: [],
    };
    for (const s of seatsFor(def.type)) {
      club.seats.set(s.name, { id: ctx.id(), role: s.role, name: s.name, defaultPermissions: [...s.defaultPermissions], maxHolders: s.maxHolders });
    }
    ctx.clubs.push(club);
    ctx.clubByKey.set(def.key, club);
    ctx.clubById.set(club.id, club);
  }
}

const TITLES: Record<Topic, string[]> = {
  tech: ["Build Team Lead", "Lead Mentor", "Webmaster", "CAD Lead"],
  business: ["Portfolio Manager", "Alumni Liaison", "Social Chair"],
  health: ["Study Group Lead", "Service Hours Coordinator"],
  science: ["Demo Lead", "Lab Liaison"],
  socsci: ["Discussion Moderator", "Historian"],
  education: ["Outreach Lead"],
  arts: ["Stage Manager", "Photographer", "Props Lead"],
  culture: ["Social Chair", "Historian", "Photographer"],
  service: ["Project Lead", "Volunteer Captain"],
  sports: ["Trip Leader", "Gear Manager", "Captain"],
  games: ["Tournament Director", "Social Chair"],
  ambassadors: ["Tour Lead"],
  faith: ["Outreach Lead", "Music Lead", "Social Chair"],
  advocacy: ["Campaign Lead", "Outreach Lead", "Social Media Lead"],
  greek: ["Recruitment Chair", "Philanthropy Chair", "Social Chair", "Historian"],
  honor: ["Induction Chair", "Tutoring Coordinator"],
  media: ["Producer", "Editor", "Photographer"],
  music: ["Section Leader", "Librarian"],
  dance: ["Choreographer", "Costume Lead"],
  spirit: ["Chant Leader", "Banner Captain"],
  film: ["Programming Chair", "Projectionist"],
  general: ["Social Chair", "Historian"],
};

/** Memberships for every club (personas first, then sampled students). */
export function buildMemberships(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const students = generatedStudents(ctx);
  const f24 = fallStartDate(2024);

  // ─── Personas ──────────────────────────────────────────────────────────────
  const P = (k: string) => ctx.p(k).id;
  const persona = (key: string, clubKey: string, joinedAt: Date, kind: "core" | "regular" | "casual", extra: Partial<Member> = {}) => {
    const club = ctx.club(clubKey);
    const m = addMember(ctx, club, P(key), { status: "ACTIVE", source: joinedAt < f24 ? "IMPORT" : "REGISTER", joinedAt, eng: engagement(ctx, kind) });
    Object.assign(m, extra);
    return m;
  };
  persona("maya", "psych", addDays(fallStartDate(2024), 9.4), "core");
  persona("maya", "premed", addDays(springStartDate(2025), 10.3), "regular").eng = { base: 0.62, half: 90, floor: 0.55 };
  persona("maya", "climbing", addDays(fallStartDate(2025), 12.2), "core");
  persona("maya", "service", addDays(NOW, -14.2), "casual");
  persona("priya", "robotics", addDays(fallStartDate(2023), 8.3), "core");
  persona("priya", "climbing", addDays(fallStartDate(2024), 20.1), "regular");
  persona("priya", "acm", addDays(springStartDate(2024), 15.2), "casual");
  persona("vanessa", "swe", addDays(fallStartDate(2023), 10.1), "core");
  persona("vanessa", "robotics", addDays(fallStartDate(2024), 15.4), "regular");
  persona("oscar", "fic", addDays(fallStartDate(2024), 12.2), "core");
  persona("oscar", "accounting", addDays(springStartDate(2025), 20.3), "casual");
  persona("oscar", "ski", addDays(fallStartDate(2025), 5.2), "regular");
  persona("amir", "gsbe-amb", addDays(fallStartDate(2024), 30.2), "core");
  persona("amir", "entre", addDays(springStartDate(2025), 10.1), "regular");
  persona("frank", "chess", addDays(fallStartDate(2024), 20.3), "regular");
  persona("frank", "service", addDays(springStartDate(2025), 18.2), "casual");
  const gwenLab = persona("gwen", "ailab", addDays(ctx.club("ailab").createdAt, 0.2), "core", { source: "FOUNDER" });
  gwenLab.status = "ALUMNI";
  gwenLab.endedAt = ctx.p("gwen").gradDate;
  const gwenAcm = persona("gwen", "acm", addDays(fallStartDate(2022), 22.2), "casual");
  gwenAcm.status = "ALUMNI";
  gwenAcm.endedAt = ctx.p("gwen").gradDate;
  gwenAcm.source = "IMPORT";

  // Spread memberships: someone already in several clubs is less likely to be drawn for another.
  const load = new Map<string, number>();
  for (const c of ctx.clubs) for (const m of c.members) if (m.status === "ACTIVE") load.set(m.userId, (load.get(m.userId) ?? 0) + 1);
  const spread = (s: Person) => 1 / (1 + 0.7 * (load.get(s.id) ?? 0));
  const counted = (club: ClubM) => {
    for (const m of club.members) if (m.status === "ACTIVE" && !ctx.person(m.userId).persona) load.set(m.userId, (load.get(m.userId) ?? 0) + 1);
  };

  // ─── Sampled members ───────────────────────────────────────────────────────
  for (const club of ctx.clubs) {
    const def = club.def;
    if (def.life === "dormant") {
      dormantRoster(ctx, club, students);
      counted(club);
      continue;
    }
    const founder = ctx.person(club.founderId);
    const founderEnd = founder.gradDate && founder.gradDate < club.end ? founder.gradDate : null;
    addMember(ctx, club, founder.id, {
      status: founderEnd ? "ALUMNI" : club.retiredAt ? "ALUMNI" : "ACTIVE",
      source: "FOUNDER",
      joinedAt: club.createdAt,
      endedAt: founderEnd ?? club.retiredAt,
      eng: engagement(ctx, "core"),
    });

    if (!["APPROVED", "RETIRED"].includes(def.status)) {
      // Founding team only: a couple of friends who'll take the first officer seats.
      const n = def.life === "draft" ? 1 : def.life === "rejected" ? 2 : 3;
      const pool = students.filter((s) => s.status === "ACTIVE" && s.enrollStart < club.createdAt && !club.byUser.has(s.id));
      for (const s of rng.sample(pool, n)) {
        addMember(ctx, club, s.id, { status: "ACTIVE", source: "FOUNDER", joinedAt: addDays(club.createdAt, rng.float(0, 2)), eng: engagement(ctx, "core") });
      }
      continue;
    }

    // Co-founders: 2–4 friends of the founder who join on day one (fewer in clubs with a small roster).
    const coPool = students.filter((s) => s.enrollStart < club.createdAt && (s.gradDate ?? NOW) > addDays(club.createdAt, 200) && !club.byUser.has(s.id));
    const coFounders = def.story ? rng.int(2, 4) : def.size <= 2 ? 0 : rng.int(1, Math.min(3, def.size - 1));
    for (const s of rng.weightedOrder(coPool, (s) => (def.college && s.collegeKey === def.college ? 5 : 1)).slice(0, coFounders)) {
      const end = s.gradDate && s.gradDate < club.end ? s.gradDate : club.retiredAt;
      addMember(ctx, club, s.id, { status: end ? "ALUMNI" : "ACTIVE", source: "FOUNDER", joinedAt: addDays(club.createdAt, rng.float(0, 3)), endedAt: end, eng: engagement(ctx, "core") });
    }

    const start = club.approvedAt ?? club.createdAt;
    const end = club.end;
    const inactive = def.life === "inactive";
    const retired = def.status === "RETIRED";
    const target = retired ? rng.int(18, 26) : def.size;
    const countNow = () => club.members.filter((m) => (retired ? true : m.status === "ACTIVE")).length;
    const majorId = club.focusMajorId;

    const pool = students.filter((s) => {
      if (club.byUser.has(s.id) || !s.gradDate) return false;
      const a = maxDate(start, s.enrollStart);
      const b = minDate(end, s.gradDate);
      return b.getTime() - a.getTime() > 21 * DAY;
    });
    const affinity = (s: Person) => {
      let w = s.propensity * spread(s);
      if (def.scope === "COLLEGE") w *= s.collegeKey === def.college ? 7 : 0.45;
      else if (def.scope === "UNIVERSITY") w *= 1.3;
      if (majorId && s.majorId === majorId) w *= 3;
      if (def.type === "COLLEGE_AMBASSADORS") w *= s.collegeKey === def.college ? 3 : 0.02;
      return w;
    };
    for (const s of rng.weightedOrder(pool, affinity)) {
      if (countNow() >= target) break;
      const a = maxDate(start, s.enrollStart);
      const graduatesFirst = s.gradDate! <= end;
      const b = graduatesFirst ? addDays(s.gradDate!, -30) : addDays(end, retired ? -20 : -2);
      const joinedAt = joinTime(ctx, a, b);
      if (!joinedAt) continue;
      let status: MembershipStatus = "ACTIVE";
      let endedAt: Date | null = null;
      const leaveP = inactive ? 0.5 : retired ? 0.35 : 0.12;
      if (rng.chance(leaveP)) {
        const lo = addDays(joinedAt, 21);
        const hi = graduatesFirst ? s.gradDate! : addDays(end, -2);
        if (hi > lo) {
          status = "LEFT";
          endedAt = new Date(lo.getTime() + rng.next() * (hi.getTime() - lo.getTime()));
        }
      }
      if (status === "ACTIVE" && (graduatesFirst || retired)) {
        status = "ALUMNI";
        endedAt = graduatesFirst ? s.gradDate! : club.retiredAt!;
      }
      const viaCheckin = def.joinPolicy !== "APPROVAL" && joinedAt >= f24 && !retired && rng.chance(0.18);
      addMember(ctx, club, s.id, {
        status,
        source: viaCheckin ? "CHECKIN" : joinedAt < f24 ? "IMPORT" : "REGISTER",
        joinedAt,
        endedAt,
        eng: inactive ? { ...engagement(ctx), base: rng.float(0.2, 0.45) } : engagement(ctx),
        viaCheckin,
      });
    }

    // Directory clubs: no more on the roster today than the real list shows.
    if (!def.story) {
      const over = club.members.filter((m) => m.status === "ACTIVE").length - def.size;
      const leavers = rng.shuffle(club.members.filter((x) => x.status === "ACTIVE" && x.joinedAt && x.joinedAt < addDays(NOW, -45)));
      for (const m of leavers.slice(0, Math.max(0, over))) {
        m.status = "LEFT";
        m.endedAt = new Date(m.joinedAt!.getTime() + 21 * DAY + rng.next() * (NOW.getTime() - m.joinedAt!.getTime() - 30 * DAY));
      }
    }
    counted(club);

    if (retired) continue;

    // Join requests waiting on the club's approval gate, plus a few decided ones.
    if (def.joinPolicy === "APPROVAL") {
      const current = students.filter((s) => s.status === "ACTIVE" && !club.byUser.has(s.id));
      const pending = def.key === "robotics" ? 5 : rng.int(1, 3);
      for (const s of rng.weightedOrder(current, affinity).slice(0, pending)) {
        addMember(ctx, club, s.id, { status: "PENDING", source: "REGISTER", joinedAt: null, requestedAt: addDays(NOW, -rng.float(0.3, 9)) });
      }
      for (const s of rng.weightedOrder(current.filter((x) => !club.byUser.has(x.id)), affinity).slice(0, rng.int(1, 2))) {
        const req = addDays(NOW, -rng.float(40, 300));
        if (req < start || req < s.enrollStart) continue;
        addMember(ctx, club, s.id, { status: "DECLINED", source: "REGISTER", joinedAt: null, requestedAt: req, endedAt: addDays(req, rng.float(1, 5)) });
      }
    }

    // Club-defined secondary titles on a few active members.
    if (rng.chance(0.55)) {
      const titles = TITLES[def.topic] ?? TITLES.general;
      const active = club.members.filter((m) => m.status === "ACTIVE" && !ctx.person(m.userId).persona);
      for (const m of rng.sample(active, rng.int(1, 3))) m.internalTitle = rng.pick(titles);
    }
  }

  // Two removals, for the roster history.
  for (const key of ["paintball", "discgolf"]) {
    const club = ctx.club(key);
    const m = rng.pick(club.members.filter((x) => x.status === "ACTIVE" && x.source !== "FOUNDER" && !ctx.person(x.userId).persona));
    m.status = "REMOVED";
    m.endedAt = addDays(NOW, -rng.float(20, 120));
    if (m.joinedAt && m.endedAt < m.joinedAt) m.endedAt = addDays(m.joinedAt, 14);
  }
}

/**
 * A dormant club's roster: a handful of people joined while it ran (founder
 * first); by now all but `size` (0–2) of them have left or graduated.
 */
function dormantRoster(ctx: Ctx, club: ClubM, students: Person[]) {
  const { rng, NOW } = ctx;
  const def = club.def;
  const lastEnd = ctx.term(def.lastActiveTerm!).endsOn;
  const founder = ctx.person(club.founderId);
  const pool = students.filter((s) => s.id !== founder.id && s.enrollStart < addDays(lastEnd, -60) && s.gradDate && s.gradDate > addDays(club.createdAt, 90));
  const others = rng.weightedOrder(pool, (s) => s.propensity * (def.college ? (s.collegeKey === def.college ? 6 : 0.4) : 1)).slice(0, rng.int(2, 8));
  const roster = [founder, ...others];
  const stillHere = roster.filter((p) => p.gradDate && p.gradDate > addDays(NOW, 30) && p.kind === "STUDENT");
  const keep = new Set(rng.sample(stillHere, def.size).map((p) => p.id));
  roster.forEach((p, i) => {
    const joinedAt = i === 0 ? club.createdAt : i <= 2 ? addDays(club.createdAt, rng.float(0, 3)) : joinTime(ctx, maxDate(club.createdAt, p.enrollStart), minDate(lastEnd, p.gradDate!));
    if (!joinedAt || joinedAt >= addDays(NOW, -30)) return;
    let status: MembershipStatus = "ACTIVE";
    let endedAt: Date | null = null;
    if (!keep.has(p.id)) {
      const lo = addDays(joinedAt, 30);
      const hi = minDate(addDays(lastEnd, 150), addDays(NOW, -30));
      const leave = hi > lo ? new Date(lo.getTime() + rng.next() * (hi.getTime() - lo.getTime())) : lo;
      if (p.gradDate && p.gradDate <= leave) {
        status = "ALUMNI";
        endedAt = p.gradDate;
      } else {
        status = "LEFT";
        endedAt = minDate(leave, addDays(NOW, -30));
      }
    }
    addMember(ctx, club, p.id, {
      status, source: i <= 2 ? "FOUNDER" : joinedAt < fallStartDate(2024) ? "IMPORT" : "REGISTER", joinedAt, endedAt,
      eng: { ...engagement(ctx), base: rng.float(0.25, 0.5) },
    });
  });
}

/** Ensure a club has an active, generated member graduating at `grad` (for election storylines). */
export function ensureMemberGraduating(ctx: Ctx, club: ClubM, grad: Date, joinedBy: Date): Person {
  const { rng } = ctx;
  const has = club.members.filter(
    (m) => m.status === "ACTIVE" && m.joinedAt && m.joinedAt <= joinedBy && ctx.person(m.userId).gradDate?.getTime() === grad.getTime() && !ctx.person(m.userId).persona,
  );
  if (has.length) return ctx.person(rng.pick(has).userId);
  const pool = generatedStudents(ctx).filter((s) => s.gradDate?.getTime() === grad.getTime() && !club.byUser.has(s.id) && s.enrollStart < joinedBy);
  const s = rng.weighted(pool, (x) => (club.collegeKey && x.collegeKey === club.collegeKey ? 6 : 1));
  addMember(ctx, club, s.id, { status: "ACTIVE", source: "IMPORT", joinedAt: maxDate(addDays(joinedBy, -rng.float(30, 120)), addDays(s.enrollStart, 10), club.approvedAt ?? club.createdAt), eng: engagement(ctx, "core") });
  return s;
}
