import type { Prisma, Term } from "@prisma/client";
import type { Ctx } from "../ctx";
import { BUILDINGS, CAMPUS_ADDRESS, COLLEGES, UNAFFILIATED_MAJORS } from "../data/reference";
import { calAdd, calDow, campusDate, local } from "../lib/dates";

/**
 * Colleges, departments, majors, buildings and the academic calendar.
 * Term dates follow WSU's usual pattern: Fall starts the last Monday of
 * August, Spring the first Monday on/after Jan 5, both run 16 weeks with
 * finals; Summer runs May to early August and doesn't count for activity.
 */

export type RefRows = {
  colleges: Prisma.CollegeCreateManyInput[];
  departments: Prisma.DepartmentCreateManyInput[];
  majors: Prisma.MajorCreateManyInput[];
  buildings: Prisma.BuildingCreateManyInput[];
  terms: Prisma.TermCreateManyInput[];
};

export function fallStart(y: number) {
  let d = 31;
  while (calDow(y, 8, d) !== 1) d--;
  return { y, m: 8, d };
}

export function springStart(y: number) {
  let d = 5;
  while (calDow(y, 1, d) !== 1) d++;
  return { y, m: 1, d };
}

const at = (p: { y: number; m: number; d: number }, H = 0, M = 0) => campusDate(p.y, p.m, p.d, H, M);

export function springEnd(y: number) {
  const s = springStart(y);
  return calAdd(s.y, s.m, s.d, 109); // Friday of week 16
}

export function fallEnd(y: number) {
  const s = fallStart(y);
  return calAdd(s.y, s.m, s.d, 109);
}

/** Spring commencement (a week after finals end), 10 AM. */
export function mayGraduation(y: number): Date {
  const e = springEnd(y);
  return at(calAdd(e.y, e.m, e.d, 7), 10);
}

/** December graduation (last day of fall finals), 10 AM. */
export function decGraduation(y: number): Date {
  return at(fallEnd(y), 10);
}

/** First day of fall classes, 8 AM. */
export function fallStartDate(y: number): Date {
  return at(fallStart(y), 8);
}

export function springStartDate(y: number): Date {
  return at(springStart(y), 8);
}

/** Why there's no meeting on this day, if it's a campus holiday or break. */
export function holidayNote(day: Date): string | null {
  const p = local(day);
  const nthWeekday = (y: number, m: number, dow: number, n: number) => {
    let d = 1;
    while (calDow(y, m, d) !== dow) d++;
    return d + (n - 1) * 7;
  };
  if (p.m === 9 && p.d === nthWeekday(p.y, 9, 1, 1)) return "No meeting — Labor Day";
  if (p.m === 1 && p.d === nthWeekday(p.y, 1, 1, 3)) return "No meeting — Martin Luther King Jr. Day";
  if (p.m === 2 && p.d === nthWeekday(p.y, 2, 1, 3)) return "No meeting — Presidents' Day";
  if (p.m === 11) {
    const thanks = nthWeekday(p.y, 11, 4, 4);
    if (p.d >= thanks - 1 && p.d <= thanks + 1) return "No meeting — Thanksgiving break";
  }
  const ss = springStart(p.y);
  const breakStart = calAdd(ss.y, ss.m, ss.d, 63);
  const offset = Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(breakStart.y, breakStart.m - 1, breakStart.d)) / 86_400_000);
  if (offset >= 0 && offset <= 4) return "No meeting — spring break";
  return null;
}

export function buildReference(ctx: Ctx): RefRows {
  const rows: RefRows = { colleges: [], departments: [], majors: [], buildings: [], terms: [] };

  for (const c of COLLEGES) {
    const id = ctx.id();
    ctx.colleges.set(c.key, { id, name: c.name, shortName: c.shortName });
    rows.colleges.push({ id, name: c.name, shortName: c.shortName, slug: c.slug });
    for (const d of c.departments) {
      const deptId = ctx.id();
      ctx.departments.set(d.name, { id: deptId, collegeKey: c.key });
      rows.departments.push({ id: deptId, name: d.name, collegeId: id, createdAt: new Date("2022-07-01T12:00:00Z") });
      for (const m of d.majors) {
        const majorId = ctx.id();
        ctx.majors.set(m, { id: majorId, collegeKey: c.key, departmentId: deptId });
        rows.majors.push({ id: majorId, name: m, collegeId: id, departmentId: deptId });
      }
    }
  }
  for (const m of UNAFFILIATED_MAJORS) {
    const majorId = ctx.id();
    ctx.majors.set(m, { id: majorId, collegeKey: null, departmentId: null });
    rows.majors.push({ id: majorId, name: m });
  }

  for (const b of BUILDINGS) {
    const id = ctx.id();
    ctx.buildings.set(b.code, { id, name: b.name, lat: b.lat, lng: b.lng, rooms: b.rooms });
    rows.buildings.push({ id, code: b.code, name: b.name, campus: b.campus, address: CAMPUS_ADDRESS[b.campus], lat: b.lat, lng: b.lng });
  }

  const terms: Term[] = [];
  for (let y = 2022; y <= 2027; y++) {
    const ay = `${y}-${y + 1}`;
    const fs = fallStart(y);
    const fe = fallEnd(y);
    terms.push({ id: ctx.id(), name: `Fall ${y}`, kind: "FALL", academicYear: ay, startsOn: at(fs), endsOn: at(fe, 23, 59), countsForActivity: true });
    const ss = springStart(y + 1);
    const se = springEnd(y + 1);
    terms.push({ id: ctx.id(), name: `Spring ${y + 1}`, kind: "SPRING", academicYear: ay, startsOn: at(ss), endsOn: at(se, 23, 59), countsForActivity: true });
    const sus = calAdd(se.y, se.m, se.d, 10);
    const sue = calAdd(sus.y, sus.m, sus.d, 95);
    terms.push({ id: ctx.id(), name: `Summer ${y + 1}`, kind: "SUMMER", academicYear: ay, startsOn: at(sus), endsOn: at(sue, 23, 59), countsForActivity: false });
  }
  ctx.terms = terms;
  rows.terms = terms.map((t) => ({ ...t }));
  return rows;
}
