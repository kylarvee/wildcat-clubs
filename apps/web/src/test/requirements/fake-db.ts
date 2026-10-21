/**
 * An in-memory stand-in for the slice of Prisma the requirement code uses
 * (old and new), so the equivalence tests can run both against the same
 * fixture data. Strict on purpose: an operator, option or relation it
 * doesn't model throws instead of quietly matching nothing.
 */

type Row = Record<string, unknown>;
type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Relation = { model: string; kind: "one" | "many"; from: string; to: string };
type Model = { key?: string; relations?: Record<string, Relation>; uniques?: Record<string, string[]>; defaults?: () => Row };

const one = (model: string, from: string, to = "id"): Relation => ({ model, kind: "one", from, to });
const many = (model: string, to: string, from = "id"): Relation => ({ model, kind: "many", from, to });
const now = () => new Date();

const MODELS: Record<string, Model> = {
  user: { relations: { details: one("personalDetails", "id", "userId"), roleAssignments: many("roleAssignment", "userId"), memberships: many("membership", "userId") } },
  personalDetails: { key: "userId" },
  club: {},
  office: {},
  position: {},
  membership: { relations: { club: one("club", "clubId"), user: one("user", "userId") }, uniques: { userId_clubId: ["userId", "clubId"] } },
  roleAssignment: { relations: { club: one("club", "clubId"), user: one("user", "userId"), position: one("position", "positionId") } },
  roleRequirement: { relations: { test: one("test", "testId"), trainingEvent: one("event", "trainingEventId") } },
  term: {},
  test: {},
  event: {},
  eventOccurrence: { relations: { event: one("event", "eventId") } },
  attendance: { relations: { occurrence: one("eventOccurrence", "occurrenceId") } },
  testAttempt: {},
  testAssignment: { relations: { test: one("test", "testId") }, uniques: { testId_userId_cycleKey: ["testId", "userId", "cycleKey"] }, defaults: () => ({ status: "ASSIGNED", createdAt: now(), resolvedAt: null }) },
  task: {
    relations: { club: one("club", "clubId") },
    defaults: () => ({ status: "OPEN", required: false, description: null, href: null, dueAt: null, clubId: null, capability: null, sourceType: null, sourceId: null, createdById: null, completedAt: null, completedById: null, createdAt: now(), officeId: null }),
  },
  notification: { defaults: () => ({ body: null, href: null, readAt: null, createdAt: now() }) },
  reminderLog: { key: "key", defaults: () => ({ sentAt: now() }) },
};

export type Tables = Record<string, Row[]>;

const clone = <T,>(v: T): T => (v instanceof Date ? (new Date(v.getTime()) as T) : Array.isArray(v) ? (v.map(clone) as T) : v);
const cloneRow = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clone(v)]));
export const cloneTables = (t: Tables): Tables => Object.fromEntries(Object.entries(t).map(([m, rows]) => [m, rows.map(cloneRow)]));

const eq = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
const cmp = (a: unknown, b: unknown) => {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
};

export class FakeDb {
  /** Shared by every copy, so a run on a copy of another run's tables never reuses a generated id. */
  private static seq = 0;
  constructor(public tables: Tables) {
    for (const m of Object.keys(MODELS)) this.tables[m] ??= [];
  }

  private keyOf(model: string) {
    return MODELS[model].key ?? "id";
  }

  private related(model: string, row: Row, name: string): Row[] {
    const rel = MODELS[model].relations?.[name];
    if (!rel) throw new Error(`fake db: ${model}.${name} isn't a relation`);
    return this.tables[rel.model].filter((r) => row[rel.from] !== null && row[rel.from] !== undefined && eq(r[rel.to], row[rel.from]));
  }

  matches(model: string, row: Row, where: Args | undefined): boolean {
    for (const [k, v] of Object.entries(where ?? {})) {
      if (v === undefined) continue;
      if (k === "AND") {
        if (!(Array.isArray(v) ? v : [v]).every((w) => this.matches(model, row, w))) return false;
      } else if (k === "OR") {
        if (!v.some((w: Args) => this.matches(model, row, w))) return false;
      } else if (k === "NOT") {
        if ((Array.isArray(v) ? v : [v]).some((w) => this.matches(model, row, w))) return false;
      } else if (MODELS[model].relations?.[k]) {
        const rel = MODELS[model].relations![k];
        const list = this.related(model, row, k);
        if (rel.kind === "one") {
          if (v === null ? list.length > 0 : !list[0] || !this.matches(rel.model, list[0], v)) return false;
        } else {
          for (const [op, sub] of Object.entries(v as Args)) {
            const ok = op === "some" ? list.some((r) => this.matches(rel.model, r, sub)) : op === "every" ? list.every((r) => this.matches(rel.model, r, sub)) : op === "none" ? !list.some((r) => this.matches(rel.model, r, sub)) : null;
            if (ok === null) throw new Error(`fake db: unsupported list filter ${op}`);
            if (!ok) return false;
          }
        }
      } else if (MODELS[model].uniques?.[k]) {
        for (const f of MODELS[model].uniques![k]) if (!eq(row[f], v[f])) return false;
      } else if (!this.field(row[k], v)) return false;
    }
    return true;
  }

  private field(value: unknown, cond: unknown): boolean {
    if (cond === null || typeof cond !== "object" || cond instanceof Date) return eq(value, cond);
    const c = cond as Args;
    const insensitive = c.mode === "insensitive";
    const norm = (x: unknown) => (insensitive && typeof x === "string" ? x.toLowerCase() : x);
    for (const [op, arg] of Object.entries(c)) {
      const ok = (() => {
        switch (op) {
          case "mode":
            return true;
          case "equals":
            return eq(norm(value), norm(arg));
          case "in":
            return (arg as unknown[]).some((a) => eq(value, a));
          case "notIn":
            return value !== null && !(arg as unknown[]).some((a) => eq(value, a));
          case "not":
            return arg !== null && typeof arg === "object" && !(arg instanceof Date) ? !this.field(value, arg) : arg === null ? value !== null && value !== undefined : value !== null && !eq(value, arg);
          case "lt":
            return value !== null && value !== undefined && cmp(value, arg) < 0;
          case "lte":
            return value !== null && value !== undefined && cmp(value, arg) <= 0;
          case "gt":
            return value !== null && value !== undefined && cmp(value, arg) > 0;
          case "gte":
            return value !== null && value !== undefined && cmp(value, arg) >= 0;
          case "has":
            return Array.isArray(value) && value.some((x) => eq(x, arg));
          default:
            throw new Error(`fake db: unsupported operator ${op}`);
        }
      })();
      if (!ok) return false;
    }
    return true;
  }

  private sort(model: string, rows: Row[], orderBy: Args | Args[] | undefined): Row[] {
    const keys = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return [...rows].sort((a, b) => {
      for (const o of keys)
        for (const [f, d] of Object.entries(o as Record<string, "asc" | "desc" | { sort: "asc" | "desc"; nulls?: "first" | "last" }>)) {
          if (MODELS[model].relations?.[f]) throw new Error(`fake db: ordering by a relation (${model}.${f}) isn't modeled`);
          const dir = typeof d === "object" ? d.sort : d;
          const nulls = typeof d === "object" ? d.nulls : undefined;
          const x = a[f];
          const y = b[f];
          const xn = x === null || x === undefined;
          const yn = y === null || y === undefined;
          if (xn || yn) {
            if (xn && yn) continue;
            // Postgres: nulls sort last ascending, first descending, unless told.
            const first = nulls ? nulls === "first" : dir === "desc";
            return xn === first ? -1 : 1;
          }
          const c = cmp(x, y) * (dir === "desc" ? -1 : 1);
          if (c) return c;
        }
      return 0;
    });
  }

  private project(model: string, row: Row, args: Args = {}): Row {
    const rel = (name: string, sub: Args | true) => {
      const r = MODELS[model].relations![name];
      const s = sub === true ? {} : sub;
      if (r.kind === "one") {
        const hit = this.related(model, row, name)[0];
        return hit ? this.project(r.model, hit, s) : null;
      }
      const list = this.sort(r.model, this.related(model, row, name).filter((x) => this.matches(r.model, x, s.where)), s.orderBy);
      return list.map((x) => this.project(r.model, x, s));
    };
    if (args.select) {
      const out: Row = {};
      for (const [k, v] of Object.entries(args.select as Args)) {
        if (!v) continue;
        if (k === "_count") throw new Error("fake db: _count isn't modeled");
        out[k] = MODELS[model].relations?.[k] ? rel(k, v) : clone(row[k]);
      }
      return out;
    }
    const out = cloneRow(row);
    for (const [k, v] of Object.entries((args.include ?? {}) as Args)) if (v) out[k] = rel(k, v);
    return out;
  }

  private findRows(model: string, args: Args = {}) {
    let rows = this.sort(model, this.tables[model].filter((r) => this.matches(model, r, args.where)), args.orderBy);
    if (args.distinct) {
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        const k = JSON.stringify((args.distinct as string[]).map((f) => r[f]));
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    if (args.skip) rows = rows.slice(args.skip);
    if (args.take !== undefined) rows = rows.slice(0, args.take);
    return rows;
  }

  private insert(model: string, data: Row, skipDuplicates = false): Row | null {
    for (const [k, v] of Object.entries(data)) if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) throw new Error(`fake db: nested write ${model}.${k} isn't modeled`);
    const key = this.keyOf(model);
    const row: Row = { ...(MODELS[model].defaults?.() ?? {}), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clone(v)])) };
    if (row[key] === undefined) row[key] = `${model}-new-${++FakeDb.seq}`;
    const clash =
      this.tables[model].some((r) => eq(r[key], row[key])) ||
      Object.values(MODELS[model].uniques ?? {}).some((fields) => this.tables[model].some((r) => fields.every((f) => eq(r[f], row[f]))));
    if (clash) {
      if (skipDuplicates) return null;
      throw Object.assign(new Error(`fake db: unique constraint on ${model}`), { code: "P2002" });
    }
    this.tables[model].push(row);
    return row;
  }

  private apply(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) throw new Error(`fake db: update operator on ${k} isn't modeled`);
      row[k] = clone(v);
    }
  }

  delegate(model: string) {
    return {
      findMany: async (args: Args = {}) => this.findRows(model, args).map((r) => this.project(model, r, args)),
      findFirst: async (args: Args = {}) => {
        const r = this.findRows(model, args)[0];
        return r ? this.project(model, r, args) : null;
      },
      findUnique: async (args: Args) => {
        const r = this.tables[model].find((x) => this.matches(model, x, args.where));
        return r ? this.project(model, r, args) : null;
      },
      findUniqueOrThrow: async (args: Args) => {
        const r = this.tables[model].find((x) => this.matches(model, x, args.where));
        if (!r) throw Object.assign(new Error(`fake db: no ${model}`), { code: "P2025" });
        return this.project(model, r, args);
      },
      count: async (args: Args = {}) => this.findRows(model, args).length,
      create: async (args: Args) => this.project(model, this.insert(model, args.data)!, args),
      createMany: async (args: Args) => ({ count: (args.data as Row[]).filter((d) => this.insert(model, d, Boolean(args.skipDuplicates))).length }),
      update: async (args: Args) => {
        const r = this.tables[model].find((x) => this.matches(model, x, args.where));
        if (!r) throw Object.assign(new Error(`fake db: no ${model} to update`), { code: "P2025" });
        this.apply(r, args.data);
        return this.project(model, r, args);
      },
      updateMany: async (args: Args) => {
        const rows = this.tables[model].filter((x) => this.matches(model, x, args.where));
        for (const r of rows) this.apply(r, args.data);
        return { count: rows.length };
      },
      deleteMany: async (args: Args = {}) => {
        const before = this.tables[model].length;
        this.tables[model] = this.tables[model].filter((x) => !this.matches(model, x, args.where));
        return { count: before - this.tables[model].length };
      },
    };
  }
}

/**
 * The `db` the code under test sees: a stable object over whichever FakeDb is
 * current. Writes run as they're called, so a $transaction of them just waits.
 */
export function fakeClient(current: () => FakeDb): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "$transaction") return async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(fakeClient(current)));
      if (prop === "$disconnect" || prop === "$connect" || prop === "$on") return async () => undefined;
      return prop in MODELS ? current().delegate(prop) : undefined;
    },
  });
}
