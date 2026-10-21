import type { EmergencyRelationship, Gender, Prisma, YearInSchool } from "@prisma/client";
import { PERSONAS } from "@/lib/auth/personas";
import { emailKind } from "@/lib/institution";
import type { Ctx, Person } from "../ctx";
import { CLUBS } from "../data/clubs";
import { COLLEGES, GRID_DIRECTIONS, HOME_TOWNS, type CollegeKey } from "../data/reference";
import { FEMALE_FIRST, FIRST_NAMES, LAST_NAMES, MALE_FIRST, NEUTRAL_FIRST, PRONOUNS_FOR } from "../data/names";
import { CAREERS, HEADLINES, JOBS } from "../data/text";
import { addDays, DAY, maxDate } from "../lib/dates";
import { createRng, type Rng } from "../lib/rng";
import { decGraduation, fallStartDate, mayGraduation } from "./reference";

/**
 * People: every test persona (exact names and emails from lib/auth/personas),
 * WSUSA admins, faculty and staff, and ~1,000 students with realistic
 * timelines — alumni who held the early leadership roles, and current
 * students from seniors graduating in December to this fall's freshmen —
 * plus everyone's member details (all invented, obviously fake).
 */

// Same rules as lib/auth/accounts.ts (server-only, so replicated here).
const AVATAR_COLORS = ["#4b2e83", "#6d28d9", "#0f766e", "#b45309", "#be123c", "#1d4ed8", "#4d7c0f", "#a21caf", "#0e7490", "#9a3412"];
export function colorFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export type UserRows = Map<string, Prisma.UserCreateManyInput>;

type PersonaSpec = {
  gender?: Gender;
  major?: string;
  minor?: string;
  grad?: Date;
  enroll?: Date;
  alumni?: boolean;
  dept?: string;
  jobTitle?: string;
  role?: "ADMIN" | "SYSADMIN";
  pronouns?: string;
  headline?: string;
  about?: string;
  createdDaysAgo?: number;
};

const PERSONA_SPECS: Record<string, PersonaSpec> = {
  sam: { createdDaysAgo: 0.1 },
  maya: {
    gender: "FEMALE", major: "Psychology", minor: "Spanish", grad: mayGraduation(2027), enroll: fallStartDate(2023), pronouns: "she/her",
    headline: "Psychology student · aspiring clinical researcher",
    about: "<p>Senior studying psychology with a Spanish minor. I'm interested in how sleep affects memory and hope to do research in a clinical lab after graduation.</p><p>Usually found climbing at the Stromberg wall or working the morning shift at the coffee bar.</p>",
  },
  oscar: { gender: "MALE", major: "Finance", minor: "Economics", grad: mayGraduation(2028), enroll: fallStartDate(2024), pronouns: "he/him", headline: "Finance student · Treasurer, Wildcat Investors" },
  vanessa: {
    gender: "FEMALE", major: "Mechanical Engineering", grad: mayGraduation(2027), enroll: fallStartDate(2023), pronouns: "she/her",
    headline: "Mechanical engineering · VP, Society of Women Engineers (SWE)",
    about: "<p>Mechanical engineering student focused on thermal systems. I help run SWE's outreach days because I didn't meet a woman engineer until college — I want girls in Ogden to meet dozens.</p>",
  },
  priya: {
    gender: "FEMALE", major: "Electrical Engineering", minor: "Computer Science", grad: mayGraduation(2027), enroll: fallStartDate(2023), pronouns: "she/her",
    headline: "Electrical engineering · President, RC Wrecker Bots Club",
    about: "<p>I lead the RC Wrecker Bots Club and spend most Tuesday nights in the Noorda makerspace building combat robots. Interested in embedded systems and motor control — this year our team is finishing its first heavyweight bot.</p>",
  },
  amir: { gender: "MALE", major: "Marketing", minor: "Information Systems & Technologies", grad: mayGraduation(2028), enroll: fallStartDate(2024), pronouns: "he/him", headline: "Marketing student · Goddard School Ambassador" },
  frank: {
    gender: "MALE", major: "Botany", minor: "Business Administration", grad: mayGraduation(2028), enroll: fallStartDate(2024), pronouns: "he/him",
    headline: "Botany student · founder of the Wildcat Beekeeping Society (in progress)",
  },
  gwen: {
    gender: "FEMALE", major: "Information Systems & Technologies", minor: "Business Analytics", grad: mayGraduation(2026), enroll: fallStartDate(2022), alumni: true, pronouns: "she/her",
    headline: "Junior Data Analyst · Weber State '26",
    about: "<p>Weber State alum (IS&amp;T, 2026). I led the Applied AI Lab for two years — we grew from a dozen people in a borrowed classroom to project teams working with campus offices. Now analyzing data for a living and still mentoring Lab teams when I can.</p>",
  },
  elena: { gender: "FEMALE", dept: "Electrical & Computer Engineering", jobTitle: "Associate Professor, Electrical & Computer Engineering", pronouns: "she/her", createdDaysAgo: 1500 },
  nathan: { gender: "MALE", dept: "Botany", jobTitle: "Professor of Botany", pronouns: "he/him", createdDaysAgo: 1400 },
  alex: { gender: "NON_BINARY", jobTitle: "Clubs & Organizations Coordinator, WSUSA", role: "ADMIN", pronouns: "they/them", createdDaysAgo: 900 },
  sydney: { gender: "FEMALE", jobTitle: "Platform Administrator, Information Technology Division", role: "SYSADMIN", pronouns: "she/her", createdDaysAgo: 950 },
  // Office staff (lib/offices): built after everyone else (officePersonas), so they draw nothing from the shared RNG.
  rowan: { gender: "NON_BINARY", jobTitle: "Sport Clubs Coordinator, Campus Recreation", pronouns: "they/them", createdDaysAgo: 700 },
};

/** Personas who staff an office (steps/offices), by office key. Built last; see officePersonas. */
const OFFICE_PERSONAS: Record<string, string> = { rowan: "campus-rec" };

const EXTRA_ADMINS: { name: string; gender: Gender; jobTitle: string; createdAt: Date }[] = [
  { name: "Jordan Whitaker", gender: "MALE", jobTitle: "Assistant Director, Student Involvement & Leadership (WSUSA)", createdAt: new Date("2022-08-01T16:00:00Z") },
  { name: "Rosa Delgado", gender: "FEMALE", jobTitle: "WSUSA Funding & Budget Coordinator", createdAt: new Date("2023-01-09T16:00:00Z") },
];

/** Staff who advise university-wide, independent and sports clubs. */
export const STAFF_ROLES: { key: string; name: string; gender: Gender; jobTitle: string }[] = [
  { key: "multicultural", name: "Monique Ellison", gender: "FEMALE", jobTitle: "Coordinator, Center for Multicultural Excellence" },
  { key: "multicultural2", name: "Rafael Ortega", gender: "MALE", jobTitle: "Program Coordinator, Center for Multicultural Excellence" },
  { key: "veterans", name: "Curtis Halvorsen", gender: "MALE", jobTitle: "Director, Veterans Services" },
  { key: "international", name: "Mei-Ling Hsu", gender: "FEMALE", jobTitle: "Advisor, International Student & Scholar Center" },
  { key: "rec", name: "Brett Sorensen", gender: "MALE", jobTitle: "Assistant Director, Campus Recreation" },
  { key: "rec2", name: "Kayla Draper", gender: "FEMALE", jobTitle: "Outdoor Program Coordinator, Campus Recreation" },
  { key: "lgbt", name: "Sam Whitfield", gender: "NON_BINARY", jobTitle: "Coordinator, LGBTQ+ Resource Center" },
  { key: "service", name: "Teresa Montoya", gender: "FEMALE", jobTitle: "Program Manager, Community Engaged Learning Center" },
  { key: "library", name: "Gordon Pace", gender: "MALE", jobTitle: "Librarian, Stewart Library" },
  { key: "success", name: "Alicia Barnes", gender: "FEMALE", jobTitle: "Academic Advisor, Student Success Center" },
  { key: "involvement", name: "Derek Lindqvist", gender: "MALE", jobTitle: "Coordinator, Student Involvement & Leadership" },
  { key: "involvement2", name: "Hannah Okoro", gender: "FEMALE", jobTitle: "Program Coordinator, Student Involvement & Leadership" },
  { key: "womens", name: "Leticia Barrios", gender: "FEMALE", jobTitle: "Coordinator, Women's Center" },
  { key: "nontrad", name: "Russell Pickett", gender: "MALE", jobTitle: "Program Manager, Nontraditional Student Center" },
  { key: "access", name: "Janine Covey", gender: "FEMALE", jobTitle: "Coordinator, Disability Services" },
  { key: "honors", name: "Victor Amador", gender: "MALE", jobTitle: "Advisor, Honors Program" },
  { key: "athletics", name: "Keisha Rowland", gender: "FEMALE", jobTitle: "Coordinator, Athletics Student Services" },
  { key: "healthadv", name: "Martin Szabo", gender: "MALE", jobTitle: "Advisor, Health Professions Advising" },
  { key: "sustain", name: "Ingrid Fallon", gender: "FEMALE", jobTitle: "Coordinator, Sustainability Center" },
  { key: "alumni", name: "Paul Henrie", gender: "MALE", jobTitle: "Associate Director, Alumni Relations" },
];

const FACULTY_RANKS = ["Assistant Professor", "Associate Professor", "Professor", "Lecturer", "Instructor"];

function cleanHandle(base: string) {
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "") || "wildcat";
}

export function buildPeople(ctx: Ctx): UserRows {
  const { rng, NOW } = ctx;
  const rows: UserRows = new Map();
  const usedHandles = new Set<string>();
  const usedEmails = new Set<string>();
  const usedNames = new Set<string>(PERSONAS.map((p) => p.name));

  const handleFor = (email: string) => {
    const clean = cleanHandle(email.split("@")[0]);
    let h = clean;
    for (let i = 2; usedHandles.has(h); i++) h = `${clean}${i}`;
    usedHandles.add(h);
    return h;
  };
  const emailFor = (first: string, last: string, domain: string) => {
    const base = `${first}.${last}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z.]+/g, "");
    let e = `${base}@${domain}`;
    for (let i = 2; usedEmails.has(e); i++) e = `${base}${i}@${domain}`;
    usedEmails.add(e);
    return e;
  };
  /** A gender in roughly the campus mix, then a first name and pronouns that go with it. */
  const pickGender = (): Gender => {
    const r = rng.next();
    return r < 0.5 ? "FEMALE" : r < 0.975 ? "MALE" : r < 0.993 ? "NON_BINARY" : "PREFER_NOT_TO_SAY";
  };
  const firstFor = (g: Gender) =>
    g === "FEMALE" ? (rng.chance(0.93) ? rng.pick(FEMALE_FIRST) : rng.pick(NEUTRAL_FIRST)) :
    g === "MALE" ? (rng.chance(0.93) ? rng.pick(MALE_FIRST) : rng.pick(NEUTRAL_FIRST)) :
    rng.chance(0.5) ? rng.pick(NEUTRAL_FIRST) : rng.pick(FIRST_NAMES);
  const pronounsFor = (g: Gender, p: number) => (g === "NON_BINARY" || rng.chance(p) ? rng.pick(PRONOUNS_FOR[g]) : null);
  const freshName = (g: Gender) => {
    for (let i = 0; i < 50; i++) {
      const first = firstFor(g);
      const last = rng.pick(LAST_NAMES);
      if (!usedNames.has(`${first} ${last}`)) {
        usedNames.add(`${first} ${last}`);
        return { first, last };
      }
    }
    return { first: firstFor(g), last: rng.pick(LAST_NAMES) };
  };

  const add = (p: Person, extra: Partial<Prisma.UserCreateManyInput>) => {
    ctx.people.push(p);
    ctx.byId.set(p.id, p);
    rows.set(p.id, {
      id: p.id,
      email: p.email,
      name: p.name,
      handle: p.handle,
      kind: p.kind,
      status: p.status,
      avatarColor: colorFor(p.email),
      departmentId: p.departmentId,
      jobTitle: p.jobTitle,
      createdAt: p.createdAt,
      ...extra,
    });
  };

  const majorInfo = (name: string) => {
    const m = ctx.majors.get(name);
    if (!m) throw new Error(`Unknown major ${name}`);
    return m;
  };

  // ─── Personas ──────────────────────────────────────────────────────────────
  for (const persona of PERSONAS) {
    if (OFFICE_PERSONAS[persona.key]) continue;
    const spec = PERSONA_SPECS[persona.key] ?? {};
    const kind = emailKind(persona.email);
    if (!kind) throw new Error(`Persona ${persona.key} has a non-university email`);
    const [first, ...rest] = persona.name.replace(/^(Dr\.|Prof\.)\s+/, "").split(" ");
    const major = spec.major ? majorInfo(spec.major) : null;
    const dept = spec.dept ? ctx.departments.get(spec.dept) : undefined;
    const createdAt =
      spec.createdDaysAgo !== undefined ? addDays(NOW, -spec.createdDaysAgo) : maxDate(addDays(spec.enroll ?? NOW, -12), new Date("2022-08-15T16:00:00Z"));
    const p: Person = {
      id: ctx.id(),
      name: persona.name,
      first,
      last: rest.join(" "),
      email: persona.email,
      handle: handleFor(persona.email),
      kind,
      status: spec.alumni ? "ALUMNI" : "ACTIVE",
      gender: spec.gender ?? null,
      persona: persona.key,
      collegeKey: major?.collegeKey ?? dept?.collegeKey ?? null,
      majorId: major?.id ?? null,
      majorName: spec.major ?? null,
      departmentId: dept?.id ?? null,
      departmentName: spec.dept ?? null,
      jobTitle: spec.jobTitle ?? null,
      enrollStart: spec.enroll ?? ctx.termFor(NOW).startsOn,
      gradDate: kind === "STUDENT" ? (spec.grad ?? mayGraduation(2030)) : null,
      propensity: 1,
      createdAt,
    };
    usedHandles.add(p.handle);
    usedEmails.add(p.email);
    add(p, {
      platformRole: spec.role ?? "USER",
      pronouns: spec.pronouns ?? null,
      headline: spec.headline ?? null,
      aboutHtml: spec.about ?? null,
      classYear: kind === "STUDENT" && spec.grad ? spec.grad.getUTCFullYear() : null,
      graduatedAt: spec.alumni ? spec.grad : null,
      lastSeenAt: persona.key === "sam" ? NOW : addDays(NOW, -rng.float(0.05, 3)),
      hasMobileApp: ["maya", "priya", "oscar", "vanessa", "amir"].includes(persona.key),
      appPromptDismissedAt: persona.key === "gwen" ? addDays(NOW, -200) : null,
    });
    ctx.persona.set(persona.key, p);
    if (spec.role) ctx.admins.push(p);
    if (major) ctx.rows.userMajors.push({ userId: p.id, majorId: major.id, isMinor: false });
    if (spec.minor) ctx.rows.userMajors.push({ userId: p.id, majorId: majorInfo(spec.minor).id, isMinor: true });
  }

  // ─── Admins and staff ──────────────────────────────────────────────────────
  for (const a of EXTRA_ADMINS) {
    const [first, last] = a.name.split(" ");
    usedNames.add(a.name);
    const email = emailFor(first, last, "weber.edu");
    const p: Person = {
      id: ctx.id(), name: a.name, first, last, email, handle: handleFor(email), kind: "FACULTY_STAFF", status: "ACTIVE", gender: a.gender,
      collegeKey: null, majorId: null, majorName: null, departmentId: null, departmentName: null, jobTitle: a.jobTitle,
      enrollStart: a.createdAt, gradDate: null, propensity: 1, createdAt: a.createdAt,
    };
    add(p, { platformRole: "ADMIN", lastSeenAt: addDays(NOW, -rng.float(0.1, 4)) });
    ctx.admins.push(p);
    ctx.refs[`admin:${first.toLowerCase()}`] = p.id;
  }

  for (const s of STAFF_ROLES) {
    const [first, last] = s.name.split(" ");
    usedNames.add(s.name);
    const email = emailFor(first, last, "weber.edu");
    const createdAt = addDays(new Date("2022-08-20T16:00:00Z"), rng.int(0, 300));
    const p: Person = {
      id: ctx.id(), name: s.name, first, last, email, handle: handleFor(email), kind: "FACULTY_STAFF", status: "ACTIVE", gender: s.gender,
      collegeKey: null, majorId: null, majorName: null, departmentId: null, departmentName: null, jobTitle: s.jobTitle,
      enrollStart: createdAt, gradDate: null, propensity: 1, createdAt,
    };
    add(p, { lastSeenAt: addDays(NOW, -rng.float(0.5, 20)) });
    ctx.staff.push(p);
    ctx.refs[`staff:${s.key}`] = p.id;
  }

  // Faculty: one per department, two where several clubs look to the department for advisors,
  // plus a couple more per college for clubs without a department.
  const clubsPerDept = new Map<string, number>();
  for (const d of CLUBS) if (d.department) clubsPerDept.set(d.department, (clubsPerDept.get(d.department) ?? 0) + 1);
  const faculty = (deptName: string, collegeKey: CollegeKey) => {
    const g: Gender = rng.chance(0.5) ? "FEMALE" : rng.chance(0.97) ? "MALE" : "NON_BINARY";
    const { first, last } = freshName(g);
    const email = emailFor(first, last, "weber.edu");
    const dept = ctx.departments.get(deptName)!;
    const createdAt = addDays(new Date("2022-08-15T16:00:00Z"), rng.int(0, 500));
    const p: Person = {
      id: ctx.id(), name: `${first} ${last}`, first, last, email, handle: handleFor(email), kind: "FACULTY_STAFF", status: "ACTIVE", gender: g,
      collegeKey, majorId: null, majorName: null, departmentId: dept.id, departmentName: deptName,
      jobTitle: deptName === "Military Science" ? "Instructor, Military Science" : `${rng.pick(FACULTY_RANKS)}, ${deptName}`, enrollStart: createdAt, gradDate: null, propensity: 1, createdAt,
    };
    add(p, { pronouns: pronounsFor(g, 0.4), lastSeenAt: addDays(NOW, -rng.float(0.5, 30)) });
    ctx.staff.push(p);
  };
  for (const college of COLLEGES) {
    for (const d of college.departments) {
      const clubs = clubsPerDept.get(d.name) ?? 0;
      const n = clubs >= 3 ? 2 : 1;
      for (let i = 0; i < n; i++) faculty(d.name, college.key);
    }
    for (const d of rng.sample(college.departments, 2)) faculty(d.name, college.key);
  }

  // ─── Students ──────────────────────────────────────────────────────────────
  const cohorts: { grad: Date; n: number; dec: boolean }[] = [
    { grad: mayGraduation(2023), n: 24, dec: false },
    { grad: decGraduation(2023), n: 8, dec: true },
    { grad: mayGraduation(2024), n: 30, dec: false },
    { grad: decGraduation(2024), n: 10, dec: true },
    { grad: mayGraduation(2025), n: 34, dec: false },
    { grad: decGraduation(2025), n: 12, dec: true },
    { grad: mayGraduation(2026), n: 40, dec: false },
    { grad: decGraduation(2026), n: 58, dec: true },
    { grad: mayGraduation(2027), n: 196, dec: false },
    { grad: decGraduation(2027), n: 36, dec: true },
    { grad: mayGraduation(2028), n: 190, dec: false },
    { grad: mayGraduation(2029), n: 186, dec: false },
    { grad: mayGraduation(2030), n: 180, dec: false },
  ];
  const collegeWeights = COLLEGES.map((c) => ({ c, w: c.studentWeight }));
  const allMajors = [...ctx.majors.entries()];

  for (const cohort of cohorts) {
    const gradYear = cohort.grad.getUTCFullYear();
    for (let i = 0; i < cohort.n; i++) {
      // Some students transfer in two years before graduating (not possible for classes that haven't reached that point).
      const transfer = rng.chance(0.2) && fallStartDate(gradYear - 2) <= NOW;
      const enrollStart = fallStartDate(gradYear - (transfer ? 2 : 4));
      if (enrollStart > NOW) continue;
      let majorName: string;
      let collegeKey: CollegeKey | null;
      if (rng.chance(0.03)) {
        majorName = rng.pick(["Integrated Studies", "General Studies"]);
        collegeKey = null;
      } else {
        const college = rng.weighted(collegeWeights, (x) => x.w).c;
        const dept = rng.weighted(college.departments.filter((d) => d.majors.length), (d) => d.majors.length);
        majorName = rng.pick(dept.majors);
        collegeKey = college.key;
      }
      const major = majorInfo(majorName);
      const gender = pickGender();
      const { first, last } = freshName(gender);
      const email = emailFor(first, last, "mail.weber.edu");
      const alumni = cohort.grad <= NOW;
      const createdAt = maxDate(addDays(enrollStart, -rng.int(3, 20)), new Date("2022-08-15T16:00:00Z"));
      const p: Person = {
        id: ctx.id(), name: `${first} ${last}`, first, last, email, handle: handleFor(email), kind: "STUDENT", status: alumni ? "ALUMNI" : "ACTIVE", gender,
        collegeKey, majorId: major.id, majorName, departmentId: null, departmentName: null, jobTitle: null,
        enrollStart, gradDate: cohort.grad, propensity: Math.exp(rng.normal(0, 0.55)), createdAt,
      };
      const career = collegeKey ? CAREERS[collegeKey] : "professional";
      const headline = rng.chance(0.3)
        ? rng.pick(HEADLINES).replace("{major}", majorName).replace("{career}", career).replace("{year}", String(gradYear))
        : null;
      const about = rng.chance(0.12)
        ? `<p>${majorName} student at Weber State. ${rng.pick([
            "I like meeting people from other majors and trying new clubs every semester.",
            "Outside of class you'll find me hiking in Ogden Canyon or at a club meeting.",
            "Working part-time while in school, so I love clubs that respect my time.",
            "Here for the people, the projects and the free pizza.",
          ])}</p>`
        : null;
      add(p, {
        pronouns: pronounsFor(gender, 0.35),
        headline,
        aboutHtml: about,
        classYear: gradYear,
        graduatedAt: alumni ? cohort.grad : null,
        lastSeenAt: alumni ? addDays(cohort.grad, rng.int(-20, 60)) : rng.chance(0.85) ? addDays(NOW, -rng.float(0.02, 25)) : null,
        hasMobileApp: !alumni && rng.chance(0.45),
        subscribeUniversity: rng.chance(0.85),
      });
      ctx.rows.userMajors.push({ userId: p.id, majorId: major.id, isMinor: false });
      if (rng.chance(0.28)) {
        const [, minor] = rng.pick(allMajors.filter(([, m]) => m.departmentId !== major.departmentId));
        ctx.rows.userMajors.push({ userId: p.id, majorId: minor.id, isMinor: true });
      }
      if (rng.chance(0.14)) {
        const job = rng.pick(JOBS);
        const start = addDays(enrollStart, rng.int(30, 500));
        if (start < NOW) {
          const end = addDays(start, rng.int(90, 400));
          ctx.rows.experiences.push({
            id: ctx.id(), userId: p.id, title: job.title, organization: job.organization, location: job.location, startDate: start,
            endDate: rng.chance(0.5) || end >= NOW ? null : end,
            description: null, source: rng.chance(0.15) ? "LINKEDIN_IMPORT" : "MANUAL", createdAt: addDays(start, 10) < NOW ? addDays(start, 10) : NOW,
          });
        }
      }
    }
  }
  officePersonas(ctx, add, handleFor);
  buildMemberDetails(ctx);
  return rows;
}

/**
 * Office staff personas (Rowan, Campus Recreation): faculty/staff accounts
 * on their office's staff (an OfficeMember row, added by Alex). They're built
 * after every generated person, with fixed values instead of RNG draws, so
 * adding them leaves the rest of the seed exactly as it was.
 */
function officePersonas(ctx: Ctx, add: (p: Person, extra: Partial<Prisma.UserCreateManyInput>) => void, handleFor: (email: string) => string) {
  const { NOW } = ctx;
  for (const persona of PERSONAS) {
    const officeKey = OFFICE_PERSONAS[persona.key];
    if (!officeKey) continue;
    const spec = PERSONA_SPECS[persona.key] ?? {};
    const kind = emailKind(persona.email);
    if (kind !== "FACULTY_STAFF") throw new Error(`Office persona ${persona.key} needs a faculty/staff (@weber.edu) email`);
    const office = ctx.offices.get(officeKey);
    if (!office || office.umbrella) throw new Error(`Office persona ${persona.key}: no office ${officeKey}`);
    const [first, ...rest] = persona.name.split(" ");
    const createdAt = addDays(NOW, -(spec.createdDaysAgo ?? 365));
    const p: Person = {
      id: ctx.id(), name: persona.name, first, last: rest.join(" "), email: persona.email, handle: handleFor(persona.email), kind, status: "ACTIVE",
      gender: spec.gender ?? null, persona: persona.key, collegeKey: null, majorId: null, majorName: null, departmentId: null, departmentName: null,
      jobTitle: spec.jobTitle ?? null, enrollStart: createdAt, gradDate: null, propensity: 1, createdAt,
    };
    add(p, { platformRole: "USER", pronouns: spec.pronouns ?? null, headline: spec.jobTitle ?? null, lastSeenAt: addDays(NOW, -0.2) });
    // Not in ctx.staff: nothing should pick them as a club advisor.
    ctx.persona.set(persona.key, p);
    // Alex (WSUSA) put them on the office's staff in Admin → Offices.
    ctx.officeStaff.push({ officeId: office.id, userId: p.id, addedAt: addDays(createdAt, 2), addedById: ctx.persona.get("alex")?.id ?? null });
  }
}

// ─── Member details ──────────────────────────────────────────────────────────

const ascii = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, "");
const fakePhone = (r: Rng, area = "801") => `${area}-555-01${String(r.int(0, 99)).padStart(2, "0")}`;

function yearInSchool(ctx: Ctx, grad: Date): YearInSchool {
  const ayEnd = Number(ctx.academicYear(ctx.NOW).label.slice(-4));
  const gradAyEnd = grad.getUTCMonth() >= 6 ? grad.getUTCFullYear() + 1 : grad.getUTCFullYear(); // December grads finish the next academic year's fall
  const left = gradAyEnd - ayEnd;
  return left <= 0 ? "SENIOR" : left === 1 ? "JUNIOR" : left === 2 ? "SOPHOMORE" : "FRESHMAN";
}

const BASE_AGE: Record<YearInSchool, number> = { FRESHMAN: 18, SOPHOMORE: 19, JUNIOR: 20, SENIOR: 21, GRADUATE: 23, OTHER: 18 };

/** A birthday that makes someone `age` (on the start of this academic year, give or take their birthday). */
function birthDateFor(ctx: Ctx, r: Rng, age: number): Date {
  const start = ctx.academicYear(ctx.NOW).start;
  const at = addDays(start, -age * 365.25 - r.float(0, 364));
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  // Never under 18 (the one concurrent-enrollment student is set separately) or over 30 today.
  const max = new Date(Date.UTC(ctx.NOW.getUTCFullYear() - 18, ctx.NOW.getUTCMonth(), ctx.NOW.getUTCDate()));
  const min = new Date(Date.UTC(ctx.NOW.getUTCFullYear() - 31, ctx.NOW.getUTCMonth(), ctx.NOW.getUTCDate() + 1));
  return d > max ? max : d < min ? min : d;
}

function homeAddress(r: Rng) {
  const town = r.weighted(HOME_TOWNS, (t) => t.weight);
  const grid = r.chance(0.55);
  const n = r.int(1, 58) * 100 + r.int(0, 99);
  // Grid: "1234 W 4000 S" is house 1234 West on 4000 South, so the two directions are on different axes.
  const dir = r.pick(GRID_DIRECTIONS);
  const cross = dir === "N" || dir === "S" ? r.pick(["E", "W"]) : r.pick(["N", "S"]);
  const line = grid ? `${n} ${dir} ${r.int(4, 60) * 100 + r.pick([0, 0, 25, 50, 75])} ${cross}` : `${n} ${r.pick(town.streets)}`;
  const unit = r.chance(0.3) ? ` Apt ${r.int(1, 40)}${r.chance(0.3) ? r.pick(["A", "B", "C"]) : ""}` : "";
  return { addressLine: `${line}${unit}`, addressCity: town.city, addressState: "UT", addressZip: r.pick(town.zips) };
}

function emergencyFor(r: Rng, p: Person, age: number) {
  const roll = r.next();
  const rel: EmergencyRelationship =
    age >= 24 && roll < 0.35 ? "SPOUSE_PARTNER" :
    roll < 0.76 ? "PARENT_GUARDIAN" : roll < 0.84 ? "SPOUSE_PARTNER" : roll < 0.91 ? "SIBLING" : roll < 0.95 ? "RELATIVE" : roll < 0.98 ? "FRIEND" : "OTHER";
  const first = rel === "PARENT_GUARDIAN" ? r.pick([...FEMALE_FIRST.slice(0, 50), ...MALE_FIRST.slice(0, 50), "Lisa", "Jennifer", "Michelle", "Kimberly", "David", "Michael", "Brent", "Todd", "Maria", "Juan", "Rosa"]) : r.pick(FIRST_NAMES);
  const last = rel === "PARENT_GUARDIAN" || rel === "SIBLING" || rel === "RELATIVE" ? (r.chance(0.85) ? p.last : r.pick(LAST_NAMES)) : r.pick(LAST_NAMES);
  return {
    emergencyName: `${first} ${last}`,
    emergencyRelationship: rel,
    emergencyPhone: fakePhone(r, r.pick(["801", "801", "385", "435"])),
    emergencyEmail: `${ascii(first)}.${ascii(last)}${r.chance(0.3) ? r.int(1, 99) : ""}@example.com`,
  };
}

/** Optional on purpose: what people most often leave blank. */
const SKIPPABLE = ["emergencyEmail", "emergencyPhone", "addressZip", "phone", "emergencyRelationship", "gender", "birthDate"] as const;

/**
 * One PersonalDetails row per active student and most faculty and staff, all
 * invented: W0-numbers, 801-555-01xx phones, example.com emails, generated
 * street numbers. About 70% of active students confirmed them this academic
 * year; the rest owe the yearly "Member details" requirement (unconfirmed,
 * confirmed last year, or a field or two missing). Vanessa is unconfirmed
 * for the requirement demo; Maya, Priya and Oscar are complete and confirmed.
 * Sam (account created minutes ago) and alumni have no row.
 */
function buildMemberDetails(ctx: Ctx) {
  const r = createRng(18102026); // its own stream, so details don't shift the rest of the seed
  const { NOW } = ctx;
  const ay = ctx.academicYear(NOW);
  const usedIds = new Set<string>();
  const studentId = () => {
    for (;;) {
      const id = `W0${r.int(1_000_000, 9_999_999)}`;
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
  };
  const confirmedThisYear = (p: Person) => {
    const from = maxDate(ay.start, addDays(p.createdAt, 1));
    return new Date(from.getTime() + r.next() * Math.max(DAY, NOW.getTime() - 2 * 3_600_000 - from.getTime()));
  };
  const COMPLETE = new Set(["maya", "priya", "oscar", "amir", "frank", "elena", "nathan", "alex", "sydney"]);

  for (const p of ctx.people) {
    if (p.status !== "ACTIVE" || p.persona === "sam") continue;
    const student = p.kind === "STUDENT";
    if (!student && !p.persona && r.chance(0.15)) continue; // a few faculty and staff never opened Settings → Member details
    const year = student && p.gradDate ? yearInSchool(ctx, p.gradDate) : null;
    let age = year ? BASE_AGE[year] : 40;
    if (year) {
      const roll = r.next();
      age += roll < 0.68 ? 0 : roll < 0.84 ? 1 : roll < 0.92 ? r.int(2, 3) : r.int(4, 9); // a few returning and nontraditional students
      age = Math.min(age, 29);
    }
    const row: Prisma.PersonalDetailsCreateManyInput = {
      userId: p.id,
      studentId: student ? studentId() : null,
      birthDate: student ? birthDateFor(ctx, r, age) : null,
      gender: p.gender ?? (r.chance(0.5) ? "FEMALE" : "MALE"),
      phone: fakePhone(r),
      contactEmail: student && r.chance(0.33) ? `${ascii(p.first)}${r.chance(0.5) ? "." : ""}${ascii(p.last)}${r.chance(0.5) ? r.int(1, 99) : ""}@example.com` : null,
      yearInSchool: year,
      ...homeAddress(r),
      ...emergencyFor(r, p, age),
      confirmedAt: null,
    };
    if (r.chance(0.04) && student) row.gender = "PREFER_NOT_TO_SAY";
    const persona = p.persona;
    if (persona === "vanessa") {
      row.confirmedAt = null; // the yearly confirmation demo
    } else if (persona && COMPLETE.has(persona)) {
      row.confirmedAt = confirmedThisYear(p);
    } else {
      const roll = r.next();
      if (roll < (student ? 0.7 : 0.75)) row.confirmedAt = confirmedThisYear(p);
      else if (roll < 0.8 && p.createdAt < ay.start) row.confirmedAt = addDays(ay.start, -r.float(20, 300)); // confirmed last year, due again
      else if (roll < 0.9) row.confirmedAt = null; // filled in, never confirmed
      else for (const f of r.sample(SKIPPABLE.filter((k) => student || k !== "birthDate"), r.int(1, 2))) row[f] = null; // incomplete
    }
    ctx.rows.personalDetails.push(row);
  }
}

/**
 * The one 17-year-old: a concurrent-enrollment freshman (not a persona) who
 * belongs to at least one club, so minors show up on a roster. Runs after
 * memberships.
 */
export function markConcurrentEnrollment(ctx: Ctx) {
  const inClub = new Set(ctx.clubs.flatMap((c) => c.members.filter((m) => m.status === "ACTIVE").map((m) => m.userId)));
  const rows = new Map(ctx.rows.personalDetails.map((d) => [d.userId, d]));
  const pick = ctx.people.find((p) => p.kind === "STUDENT" && p.status === "ACTIVE" && !p.persona && inClub.has(p.id) && rows.get(p.id)?.yearInSchool === "FRESHMAN" && rows.get(p.id)?.confirmedAt);
  if (!pick) return;
  const row = rows.get(pick.id)!;
  // Turned 17 about four months ago.
  const n = ctx.NOW;
  const b = addDays(new Date(Date.UTC(n.getUTCFullYear() - 17, n.getUTCMonth(), n.getUTCDate())), -120);
  row.birthDate = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
  ctx.refs.concurrentEnrollmentUserId = pick.id;
}

/** Current and former students available for generated memberships and roles (personas excluded). */
export function generatedStudents(ctx: Ctx) {
  return ctx.people.filter((p) => p.kind === "STUDENT" && !p.persona);
}
