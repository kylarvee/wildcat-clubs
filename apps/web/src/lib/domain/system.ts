import "server-only";
import type { TermKind } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { CONFIG_DEFAULTS, getConfig, writeConfigValue, type Config, type ConfigKey } from "@/lib/config";
import { emailKind } from "@/lib/institution";
import { logActivity } from "@/lib/lake/activity";
import { runAllJobs, type JobReport } from "@/lib/jobs/tick";
import { campusDate, fmtLongDate } from "@/lib/time";
import { assertCan, conflict, DomainError, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { CONFIG_COPY, withUnit } from "@/components/system/config-copy";

/**
 * System administration (sysadmins only): platform rules (system config),
 * the academic calendar, administrators, and running scheduled jobs.
 * lib/config owns the keys and defaults; this module is its only write path.
 */

// ─── Platform rules ──────────────────────────────────────────────────────────

const int = (min: number, max: number, unit: string) =>
  z
    .union([z.number(), z.string().trim().min(1, `Enter a number of ${unit}.`)], { error: `Enter a number of ${unit}.` })
    .pipe(
      z.coerce
        .number<string | number>({ error: `Enter a whole number of ${unit}.` })
        .int(`Enter a whole number of ${unit}.`)
        .min(min, `Use at least ${withUnit(min, unit)}.`)
        .max(max, `Use at most ${withUnit(max, unit)}.`),
    );

const optionalHttps = (label: string) =>
  z
    .string()
    .trim()
    .max(500, `Keep the ${label} under 500 characters.`)
    .refine((v) => v === "" || /^https:\/\/[^\s]+\.[^\s]+$/i.test(v), `The ${label} must start with https://`);

const email = z.string().trim().toLowerCase().max(200).email("Enter a valid email address.");

/** One validator per key. Every CONFIG_DEFAULTS key must be listed (checked by the type). */
export const CONFIG_SCHEMAS: { [K in ConfigKey]: z.ZodType<Config[K]> } = {
  "activity.studentWindowDays": int(1, 365, "days"),
  "activity.studentRecentEvents": int(1, 20, "events"),
  "activity.clubMinEvents": int(0, 50, "events"),
  "activity.clubMinMembers": int(0, 500, "members"),
  "reviews.minAttendance": int(1, 50, "events"),
  "reviews.bombingCount": int(2, 100, "ratings"),
  "reviews.bombingMaxRating": int(1, 4, "stars"),
  "reviews.bombingWindowHours": int(1, 720, "hours"),
  "reviews.flagThreshold": int(1, 50, "reports"),
  "checkin.opensMinutesBefore": int(0, 240, "minutes"),
  "checkin.closesMinutesAfter": int(0, 240, "minutes"),
  "checkin.qrRotateSeconds": int(10, 300, "seconds"),
  "ai.assistantEnabled": z.boolean(),
  "ai.gradingEnabled": z.boolean(),
  "integrations.googleCalendar": z.boolean(),
  "integrations.googleDrive": z.boolean(),
  "integrations.googleChat": z.boolean(),
  "integrations.email": z.boolean(),
  "integrations.push": z.boolean(),
  "wsusa.office": z.object({
    name: z.string().trim().min(2, "Enter the office name.").max(120, "Keep the office name under 120 characters."),
    location: z.string().trim().max(200, "Keep the location under 200 characters."),
    hours: z.string().trim().max(120, "Keep the hours under 120 characters."),
    email: z.union([z.literal(""), email]),
    phone: z
      .string()
      .trim()
      .max(40, "Keep the phone number under 40 characters.")
      .refine((v) => v === "" || /^[+\d][\d\s().\-x]{6,}$/i.test(v), "Enter a phone number like 801-626-0000, or leave it blank."),
    reviewDays: int(1, 90, "days"),
  }) as unknown as z.ZodType<Config["wsusa.office"]>,
  "wsusa.reviewers": z
    .array(
      z.object({
        name: z.string().trim().min(2, "Each reviewer needs a name.").max(80, "Keep reviewer names under 80 characters."),
        title: z.string().trim().max(120, "Keep titles under 120 characters."),
        email,
      }),
    )
    .max(12, "List up to 12 reviewers.") as unknown as z.ZodType<Config["wsusa.reviewers"]>,
  "platform.supportEmail": email,
  "app.iosUrl": optionalHttps("App Store link"),
  "app.androidUrl": optionalHttps("Google Play link"),
};

function isConfigKey(key: unknown): key is ConfigKey {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS, key);
}

function validate<K extends ConfigKey>(key: K, value: unknown): Config[K] {
  const r = CONFIG_SCHEMAS[key].safeParse(value);
  if (!r.success) {
    // Name the setting (and the reviewer row) so the message points at the field.
    const first = r.error.issues[0];
    const row = typeof first?.path?.[0] === "number" ? ` (reviewer ${first.path[0] + 1})` : "";
    throw invalid(`${CONFIG_COPY[key].label}${row}: ${first?.message ?? "that value isn't valid."}`);
  }
  return r.data;
}

/** Cross-key rules that a single field can't check. */
function checkCombined(next: Partial<Config>) {
  const flag = next["reviews.bombingMaxRating"];
  if (flag !== undefined && flag >= 5) throw invalid("The low-rating cutoff must be below 5 stars.");
}

/** Change one platform rule. */
export async function setConfig<K extends ConfigKey>(actor: Actor | null, key: K, value: unknown) {
  return setConfigs(actor, { [key]: value } as Partial<Record<ConfigKey, unknown>>);
}

/**
 * Change several platform rules at once (one form section). Everything is
 * validated before anything is written; unchanged values are skipped.
 */
export async function setConfigs(actor: Actor | null, values: Partial<Record<ConfigKey, unknown>>) {
  assertCan(actor, "system.config");
  const entries = Object.entries(values ?? {});
  if (!entries.length) throw invalid("Nothing to save.");
  const parsed: Partial<Config> = {};
  for (const [key, value] of entries) {
    if (!isConfigKey(key)) throw invalid(`“${key}” isn't a platform setting.`);
    (parsed as Record<string, unknown>)[key] = validate(key, value);
  }
  checkCombined(parsed);

  const current = await db.systemConfig.findMany({ where: { key: { in: Object.keys(parsed) } } });
  const stored = new Map(current.map((r) => [r.key, JSON.stringify(r.value)]));
  const changed: ConfigKey[] = [];
  for (const [key, value] of Object.entries(parsed) as [ConfigKey, Config[ConfigKey]][]) {
    const before = stored.get(key) ?? JSON.stringify(CONFIG_DEFAULTS[key]);
    if (before === JSON.stringify(value)) continue;
    await writeConfigValue(key, value, actor.id);
    await logActivity({ actorId: actor.id, action: "system.config_changed", entityType: "systemConfig", entityId: key, data: { key, value: value as never } });
    changed.push(key);
  }
  return { changed };
}

/**
 * Records that a sysadmin checked settings that still hold their shipped
 * values (the WSUSA contacts ship as placeholders). Saving the current value
 * marks them as confirmed, so the placeholder warning goes away.
 */
export async function confirmConfig(actor: Actor | null, keys: unknown) {
  assertCan(actor, "system.config");
  const list = Array.isArray(keys) ? [...new Set(keys.filter(isConfigKey))] : [];
  if (!list.length) throw invalid("Nothing to confirm.");
  const cfg = await getConfig();
  for (const key of list) await writeConfigValue(key, cfg[key], actor.id);
  await logActivity({ actorId: actor.id, action: "system.config_confirmed", entityType: "systemConfig", entityId: list.join(","), data: { keys: list } });
  return { confirmed: list };
}

// ─── Academic calendar ───────────────────────────────────────────────────────

const dateString = (label: string) =>
  z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label} as YYYY-MM-DD.`);

const TermInput = z
  .object({
    name: z.string({ error: "Enter the term name." }).trim().min(3, "Enter the term name, like “Fall 2027”.").max(40, "Keep the term name under 40 characters."),
    kind: z.enum(["FALL", "SPRING", "SUMMER"], { error: "Pick Fall, Spring or Summer." }),
    academicYear: z
      .string({ error: "Enter the academic year." })
      .trim()
      .regex(/^\d{4}-\d{4}$/, "Write the academic year like 2027-2028.")
      .refine((v) => Number(v.slice(5)) === Number(v.slice(0, 4)) + 1, "The academic year's second year must follow the first, like 2027-2028."),
    startsOn: dateString("first day"),
    endsOn: dateString("last day"),
    countsForActivity: z.boolean(),
  })
  .refine((t) => t.endsOn > t.startsOn, { message: "The last day must come after the first day.", path: ["endsOn"] });

function termRange(t: { startsOn: string; endsOn: string }) {
  const [sy, sm, sd] = t.startsOn.split("-").map(Number);
  const [ey, em, ed] = t.endsOn.split("-").map(Number);
  // Campus midnight on the first day through 11:59 PM on the last day, like the seeded calendar.
  const startsOn = campusDate(sy, sm, sd, 0, 0);
  const endsOn = campusDate(ey, em, ed, 23, 59);
  if (Number.isNaN(startsOn.getTime()) || Number.isNaN(endsOn.getTime())) throw invalid("Check the dates — one of them isn't a real date.");
  if (endsOn.getTime() - startsOn.getTime() > 200 * 86_400_000) throw invalid("Terms can be at most 200 days long.");
  return { startsOn, endsOn };
}

async function checkTermConflicts(input: { name: string; startsOn: Date; endsOn: Date }, excludeId: string | null) {
  const others = await db.term.findMany({ where: excludeId ? { id: { not: excludeId } } : {}, select: { id: true, name: true, startsOn: true, endsOn: true } });
  const sameName = others.find((t) => t.name.toLowerCase() === input.name.toLowerCase());
  if (sameName) throw conflict(`There's already a term named “${sameName.name}”.`);
  const overlap = others.find((t) => t.startsOn <= input.endsOn && input.startsOn <= t.endsOn);
  if (overlap) throw conflict(`These dates overlap ${overlap.name} (${fmtLongDate(overlap.startsOn)} – ${fmtLongDate(overlap.endsOn)}). Terms can't overlap.`);
}

export async function createTerm(actor: Actor | null, input: unknown) {
  assertCan(actor, "system.config");
  const v = parse(TermInput, input);
  const range = termRange(v);
  await checkTermConflicts({ name: v.name, ...range }, null);
  const term = await db.term.create({ data: { name: v.name, kind: v.kind as TermKind, academicYear: v.academicYear, countsForActivity: v.countsForActivity, ...range } });
  await logActivity({ actorId: actor.id, action: "term.created", entityType: "term", entityId: term.id, data: { name: term.name } });
  return term;
}

export async function updateTerm(actor: Actor | null, termId: string, input: unknown) {
  assertCan(actor, "system.config");
  const v = parse(TermInput, input);
  const term = await db.term.findUnique({ where: { id: String(termId ?? "") } });
  if (!term) throw notFound("That term");
  const range = termRange(v);
  await checkTermConflicts({ name: v.name, ...range }, term.id);
  const updated = await db.term.update({ where: { id: term.id }, data: { name: v.name, kind: v.kind as TermKind, academicYear: v.academicYear, countsForActivity: v.countsForActivity, ...range } });
  await logActivity({ actorId: actor.id, action: "term.updated", entityType: "term", entityId: term.id, data: { name: updated.name, previousName: term.name } });
  return updated;
}

/** Terms that budgets or funding requests point to stay; edit their dates instead. */
export async function deleteTerm(actor: Actor | null, termId: string) {
  assertCan(actor, "system.config");
  const term = await db.term.findUnique({ where: { id: String(termId ?? "") }, include: { _count: { select: { budgetItems: true, fundingRequests: true } } } });
  if (!term) throw notFound("That term");
  const uses = term._count.budgetItems + term._count.fundingRequests;
  if (uses) throw conflict(`${term.name} can't be deleted — ${term._count.budgetItems} budget item${term._count.budgetItems === 1 ? "" : "s"} and ${term._count.fundingRequests} funding request${term._count.fundingRequests === 1 ? "" : "s"} belong to it. Edit its dates instead.`);
  await db.term.delete({ where: { id: term.id } });
  await logActivity({ actorId: actor.id, action: "term.deleted", entityType: "term", entityId: term.id, data: { name: term.name } });
}

// ─── Administrators ──────────────────────────────────────────────────────────

const GrantInput = z.object({
  email: z.string({ error: "Enter their Weber State email." }).trim().toLowerCase().email("Enter a valid email address, like jane.doe@weber.edu."),
});

/**
 * Makes a faculty or staff member a WSUSA administrator. They must already
 * have signed in once (so the account exists) with a @weber.edu email.
 */
export async function grantAdmin(actor: Actor | null, input: unknown) {
  assertCan(actor, "system.admins");
  const { email: address } = parse(GrantInput, input);
  if (emailKind(address) !== "FACULTY_STAFF") throw invalid("Administrators must use a faculty or staff (@weber.edu) account.");
  const user = await db.user.findUnique({ where: { email: address }, select: { id: true, name: true, kind: true, status: true, platformRole: true } });
  if (!user) throw new DomainError("NOT_FOUND", `Nobody has signed in as ${address} yet. They need to sign in to Wildcat Clubs once, then you can make them an administrator.`);
  if (user.kind !== "FACULTY_STAFF") throw invalid("Administrators must use a faculty or staff account.");
  if (user.status !== "ACTIVE") throw invalid(`${user.name}'s account isn't active. Reactivate it in People first.`);
  if (user.platformRole === "ADMIN") throw conflict(`${user.name} is already an administrator.`);
  if (user.platformRole === "SYSADMIN") throw conflict(`${user.name} is a system administrator, which already includes everything an administrator can do.`);
  await setRole(actor, user, "ADMIN", "system.admin_granted");
  await notify({
    userIds: [user.id],
    kind: "system.admin_granted",
    title: "You're now a WSUSA administrator on Wildcat Clubs",
    body: "Admin tools are in your account menu: club approvals, funding, policies, reports and more.",
    href: "/admin",
  });
  return { name: user.name };
}

export async function revokeAdmin(actor: Actor | null, userId: string) {
  assertCan(actor, "system.admins");
  const user = await loadAdmin(userId);
  if (user.platformRole !== "ADMIN") throw conflict(user.platformRole === "SYSADMIN" ? `Remove ${user.name}'s system administrator role first.` : `${user.name} isn't an administrator.`);
  await setRole(actor, user, "USER", "system.admin_revoked");
  await notify({ userIds: [user.id], kind: "system.admin_revoked", title: "Your Wildcat Clubs administrator access was removed", href: "/dashboard", email: false });
  return { name: user.name };
}

/** Promotes an administrator to system administrator (full access, including these settings). */
export async function grantSysadmin(actor: Actor | null, userId: string) {
  assertCan(actor, "system.admins");
  const user = await loadAdmin(userId);
  if (user.platformRole === "SYSADMIN") throw conflict(`${user.name} is already a system administrator.`);
  if (user.platformRole !== "ADMIN") throw invalid("Make them an administrator first.");
  if (user.status !== "ACTIVE") throw invalid(`${user.name}'s account isn't active.`);
  await setRole(actor, user, "SYSADMIN", "system.sysadmin_granted");
  await notify({ userIds: [user.id], kind: "system.sysadmin_granted", title: "You're now a system administrator on Wildcat Clubs", body: "System settings are in your account menu.", href: "/system" });
  return { name: user.name };
}

/** Steps a system administrator back to administrator. Nobody can demote themselves, so one always remains. */
export async function revokeSysadmin(actor: Actor | null, userId: string) {
  assertCan(actor, "system.admins");
  const user = await loadAdmin(userId);
  if (user.id === actor.id) throw forbidden("You can't remove your own system administrator role. Ask another system administrator.");
  if (user.platformRole !== "SYSADMIN") throw conflict(`${user.name} isn't a system administrator.`);
  await setRole(actor, user, "ADMIN", "system.sysadmin_revoked");
  await notify({ userIds: [user.id], kind: "system.sysadmin_revoked", title: "Your system administrator role was removed", body: "You're still a WSUSA administrator.", href: "/admin", email: false });
  return { name: user.name };
}

async function loadAdmin(userId: string) {
  const user = await db.user.findUnique({ where: { id: String(userId ?? "") }, select: { id: true, name: true, kind: true, status: true, platformRole: true } });
  if (!user) throw notFound("That person");
  return user;
}

async function setRole(actor: Actor, user: { id: string; platformRole: string }, role: "USER" | "ADMIN" | "SYSADMIN", action: string) {
  if (user.id === actor.id) throw forbidden("You can't change your own platform role. Ask another system administrator.");
  await db.user.update({ where: { id: user.id }, data: { platformRole: role } });
  await logActivity({ actorId: actor.id, action, entityType: "user", entityId: user.id, data: { from: user.platformRole, to: role } });
}

// ─── Scheduled jobs ──────────────────────────────────────────────────────────

/** "Run jobs now": the same jobs the cron runs. Each job is idempotent, so running early is safe. */
export async function runJobsNow(actor: Actor | null): Promise<{ ranAt: string; reports: JobReport[] }> {
  assertCan(actor, "system.config");
  const ranAt = new Date();
  let reports: JobReport[];
  try {
    reports = await runAllJobs(ranAt);
  } catch (e) {
    reports = [{ name: "Scheduled jobs", ok: false, detail: e instanceof Error ? e.message : String(e) }];
  }
  await logActivity({
    actorId: actor.id,
    action: "system.jobs_run",
    entityType: "system",
    entityId: "jobs",
    data: { manual: true, reports: reports.map((r) => ({ name: r.name, ok: r.ok, detail: r.detail.slice(0, 500) })) },
  });
  return { ranAt: ranAt.toISOString(), reports };
}
