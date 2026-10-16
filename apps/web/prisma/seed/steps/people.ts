import type { Prisma } from "@prisma/client";
import { PERSONAS } from "@/lib/auth/personas";
import { emailKind } from "@/lib/institution";
import type { Ctx, Person } from "../ctx";
import { COLLEGES, type CollegeKey } from "../data/reference";
import { FIRST_NAMES, LAST_NAMES, PRONOUNS } from "../data/names";
import { CAREERS, HEADLINES, JOBS } from "../data/text";
import { addDays, maxDate } from "../lib/dates";
import { decGraduation, fallStartDate, mayGraduation } from "./reference";

/**
 * People: every test persona (exact names and emails from lib/auth/personas),
 * WSUSA admins, faculty and staff, and ~440 students with realistic
 * timelines — alumni who held the early leadership roles, and current
 * students from seniors graduating in December to this fall's freshmen.
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
    major: "Psychology", minor: "Spanish", grad: mayGraduation(2027), enroll: fallStartDate(2023), pronouns: "she/her",
    headline: "Psychology student · aspiring clinical researcher",
    about: "<p>Junior studying psychology with a Spanish minor. I'm interested in how sleep affects memory and hope to do research in a clinical lab after graduation.</p><p>Usually found climbing at the Stromberg wall or working the morning shift at the coffee bar.</p>",
  },
  oscar: { major: "Finance", minor: "Economics", grad: mayGraduation(2028), enroll: fallStartDate(2024), pronouns: "he/him", headline: "Finance student · Treasurer, Finance & Investment Club" },
  vanessa: {
    major: "Mechanical Engineering", grad: mayGraduation(2027), enroll: fallStartDate(2023), pronouns: "she/her",
    headline: "Mechanical engineering · VP, Society of Women Engineers",
    about: "<p>Mechanical engineering student focused on thermal systems. I help run SWE's outreach days because I didn't meet a woman engineer until college — I want girls in Ogden to meet dozens.</p>",
  },
  priya: {
    major: "Electrical Engineering", minor: "Computer Science", grad: mayGraduation(2027), enroll: fallStartDate(2023), pronouns: "she/her",
    headline: "Electrical engineering · President, Wildcat Robotics",
    about: "<p>I lead Wildcat Robotics and spend most Tuesday nights in the Noorda makerspace. Interested in embedded systems and space robotics — our team is building a Lunabotics rover this year.</p>",
  },
  amir: { major: "Marketing", minor: "Information Systems & Technologies", grad: mayGraduation(2028), enroll: fallStartDate(2024), pronouns: "he/him", headline: "Marketing student · Goddard School Ambassador" },
  frank: {
    major: "Botany", minor: "Business Administration", grad: mayGraduation(2028), enroll: fallStartDate(2024), pronouns: "he/him",
    headline: "Botany student · founder of the Wildcat Beekeeping Society (in progress)",
  },
  gwen: {
    major: "Information Systems & Technologies", minor: "Business Analytics", grad: mayGraduation(2026), enroll: fallStartDate(2022), alumni: true, pronouns: "she/her",
    headline: "Junior Data Analyst · Weber State '26",
    about: "<p>Weber State alum (IS&amp;T, 2026). I led the Applied AI Lab for two years — we grew from a dozen people in a borrowed classroom to project teams working with campus offices. Now analyzing data for a living and still mentoring Lab teams when I can.</p>",
  },
  elena: { dept: "Electrical & Computer Engineering", jobTitle: "Associate Professor, Electrical & Computer Engineering", pronouns: "she/her", createdDaysAgo: 1500 },
  nathan: { dept: "Botany", jobTitle: "Professor of Botany", pronouns: "he/him", createdDaysAgo: 1400 },
  alex: { jobTitle: "Clubs & Organizations Coordinator, WSUSA", role: "ADMIN", pronouns: "they/them", createdDaysAgo: 900 },
  sydney: { jobTitle: "Platform Administrator, Information Technology Division", role: "SYSADMIN", pronouns: "she/her", createdDaysAgo: 950 },
};

const EXTRA_ADMINS = [
  { name: "Jordan Whitaker", jobTitle: "Assistant Director, Student Involvement & Leadership (WSUSA)", createdAt: new Date("2022-08-01T16:00:00Z") },
  { name: "Rosa Delgado", jobTitle: "WSUSA Funding & Budget Coordinator", createdAt: new Date("2023-01-09T16:00:00Z") },
];

/** Staff who advise university-wide, independent and sports clubs. */
export const STAFF_ROLES = [
  { key: "multicultural", name: "Monique Ellison", jobTitle: "Coordinator, Center for Multicultural Excellence" },
  { key: "multicultural2", name: "Rafael Ortega", jobTitle: "Program Coordinator, Center for Multicultural Excellence" },
  { key: "veterans", name: "Curtis Halvorsen", jobTitle: "Director, Veterans Services" },
  { key: "international", name: "Mei-Ling Hsu", jobTitle: "Advisor, International Student & Scholar Center" },
  { key: "rec", name: "Brett Sorensen", jobTitle: "Assistant Director, Campus Recreation" },
  { key: "rec2", name: "Kayla Draper", jobTitle: "Outdoor Program Coordinator, Campus Recreation" },
  { key: "lgbt", name: "Sam Whitfield", jobTitle: "Coordinator, LGBTQ+ Resource Center" },
  { key: "service", name: "Teresa Montoya", jobTitle: "Program Manager, Community Engaged Learning Center" },
  { key: "library", name: "Gordon Pace", jobTitle: "Librarian, Stewart Library" },
  { key: "success", name: "Alicia Barnes", jobTitle: "Academic Advisor, Student Success Center" },
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
  const freshName = () => {
    for (let i = 0; i < 50; i++) {
      const first = rng.pick(FIRST_NAMES);
      const last = rng.pick(LAST_NAMES);
      if (!usedNames.has(`${first} ${last}`)) {
        usedNames.add(`${first} ${last}`);
        return { first, last };
      }
    }
    return { first: rng.pick(FIRST_NAMES), last: rng.pick(LAST_NAMES) };
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
      id: ctx.id(), name: a.name, first, last, email, handle: handleFor(email), kind: "FACULTY_STAFF", status: "ACTIVE",
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
      id: ctx.id(), name: s.name, first, last, email, handle: handleFor(email), kind: "FACULTY_STAFF", status: "ACTIVE",
      collegeKey: null, majorId: null, majorName: null, departmentId: null, departmentName: null, jobTitle: s.jobTitle,
      enrollStart: createdAt, gradDate: null, propensity: 1, createdAt,
    };
    add(p, { lastSeenAt: addDays(NOW, -rng.float(0.5, 20)) });
    ctx.staff.push(p);
    ctx.refs[`staff:${s.key}`] = p.id;
  }

  // Faculty: 3–4 per college, spread over departments that have clubs first.
  for (const college of COLLEGES) {
    const depts = rng.shuffle(college.departments);
    const n = college.key === "east" || college.key === "gsbe" ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const d = depts[i % depts.length];
      const { first, last } = freshName();
      const email = emailFor(first, last, "weber.edu");
      const dept = ctx.departments.get(d.name)!;
      const createdAt = addDays(new Date("2022-08-15T16:00:00Z"), rng.int(0, 500));
      const p: Person = {
        id: ctx.id(), name: `${first} ${last}`, first, last, email, handle: handleFor(email), kind: "FACULTY_STAFF", status: "ACTIVE",
        collegeKey: college.key, majorId: null, majorName: null, departmentId: dept.id, departmentName: d.name,
        jobTitle: `${rng.pick(FACULTY_RANKS)}, ${d.name}`, enrollStart: createdAt, gradDate: null, propensity: 1, createdAt,
      };
      add(p, { pronouns: rng.chance(0.4) ? rng.pick(PRONOUNS) : null, lastSeenAt: addDays(NOW, -rng.float(0.5, 30)) });
      ctx.staff.push(p);
    }
  }
  // Make sure the departments with sponsored/affiliate clubs have a faculty member to advise them.
  for (const deptName of ["Information Systems & Technologies", "School of Accounting & Taxation", "Business Administration", "Mechanical Engineering", "School of Computing", "Automotive Technology", "Chemistry & Biochemistry", "Physics & Astronomy", "Mathematics", "Psychology", "Criminal Justice", "Political Science & Philosophy", "Teacher Education", "Kinesiology", "Annie Taylor Dee School of Nursing", "Dental Hygiene", "Performing Arts", "English Language & Literature", "Visual Art & Design", "Finance"]) {
    if (ctx.staff.some((s) => s.departmentName === deptName)) continue;
    const dept = ctx.departments.get(deptName)!;
    const { first, last } = freshName();
    const email = emailFor(first, last, "weber.edu");
    const createdAt = addDays(new Date("2022-08-15T16:00:00Z"), rng.int(0, 400));
    const p: Person = {
      id: ctx.id(), name: `${first} ${last}`, first, last, email, handle: handleFor(email), kind: "FACULTY_STAFF", status: "ACTIVE",
      collegeKey: dept.collegeKey, majorId: null, majorName: null, departmentId: dept.id, departmentName: deptName,
      jobTitle: `${rng.pick(FACULTY_RANKS)}, ${deptName}`, enrollStart: createdAt, gradDate: null, propensity: 1, createdAt,
    };
    add(p, { lastSeenAt: addDays(NOW, -rng.float(0.5, 30)) });
    ctx.staff.push(p);
  }

  // ─── Students ──────────────────────────────────────────────────────────────
  const cohorts: { grad: Date; n: number; dec: boolean }[] = [
    { grad: mayGraduation(2023), n: 12, dec: false },
    { grad: decGraduation(2023), n: 4, dec: true },
    { grad: mayGraduation(2024), n: 15, dec: false },
    { grad: decGraduation(2024), n: 5, dec: true },
    { grad: mayGraduation(2025), n: 17, dec: false },
    { grad: decGraduation(2025), n: 6, dec: true },
    { grad: mayGraduation(2026), n: 19, dec: false },
    { grad: decGraduation(2026), n: 26, dec: true },
    { grad: mayGraduation(2027), n: 84, dec: false },
    { grad: decGraduation(2027), n: 15, dec: true },
    { grad: mayGraduation(2028), n: 80, dec: false },
    { grad: mayGraduation(2029), n: 78, dec: false },
    { grad: mayGraduation(2030), n: 76, dec: false },
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
      const { first, last } = freshName();
      const email = emailFor(first, last, "mail.weber.edu");
      const alumni = cohort.grad <= NOW;
      const createdAt = maxDate(addDays(enrollStart, -rng.int(3, 20)), new Date("2022-08-15T16:00:00Z"));
      const p: Person = {
        id: ctx.id(), name: `${first} ${last}`, first, last, email, handle: handleFor(email), kind: "STUDENT", status: alumni ? "ALUMNI" : "ACTIVE",
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
        pronouns: rng.chance(0.35) ? rng.pick(PRONOUNS) : null,
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
  return rows;
}

/** Current and former students available for generated memberships and roles (personas excluded). */
export function generatedStudents(ctx: Ctx) {
  return ctx.people.filter((p) => p.kind === "STUDENT" && !p.persona);
}
