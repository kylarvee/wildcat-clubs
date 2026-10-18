import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIONS, actionLabel, actionPhrase, BUSY_ACTIONS, isPublicByDefault, type ActionEntry } from "@/lib/lake/actions";

/**
 * The action catalog has to match what the code writes. These tests read the
 * source: every `logActivity({ action: … })` in src (and every seeded
 * `ctx.activity({ action: … })`) must name a catalog action, every catalog
 * action must be written somewhere, and a literal `isPublic` at a call site
 * must agree with the catalog's default.
 */

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Call sites whose action isn't a literal: a template, or a parameter passed
 * in from elsewhere in the file. Key: "<path from apps/web>::<the action
 * expression>". Each value must still appear in that file as a quoted string
 * (or, for a `${status.toLowerCase()}` template, its upper-case status), so
 * this list can't quietly go stale.
 */
const DYNAMIC: Record<string, string[]> = {
  "src/lib/domain/clubs.ts::`club.${d.status.toLowerCase()}`": ["club.approved", "club.changes_requested", "club.rejected"],
  "src/lib/domain/funding.ts::`funding.${status.toLowerCase()}`": ["funding.approved", "funding.partially_approved", "funding.denied"],
  "src/lib/domain/events.ts::action": ["event.created", "event.university_created", "event.updated", "event.moved"],
  "src/lib/domain/system.ts::action": ["system.admin_granted", "system.admin_revoked", "system.sysadmin_granted", "system.sysadmin_revoked"],
  "prisma/seed/steps/inbox.ts::action": ["club.submitted", "club.approved", "club.changes_requested", "club.rejected", "club.retired"],
  "prisma/seed/steps/money.ts::`funding.${status.toLowerCase()}`": ["funding.approved", "funding.partially_approved", "funding.denied", "funding.withdrawn"],
};

// ─── A small, string-aware scanner ───────────────────────────────────────────

function files(dir: string, keep: (f: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(p, keep);
    return keep(p) ? [p] : [];
  });
}

/** Index just past the bracket that closes the one opening at `open`, skipping strings, templates and comments. */
function closing(src: string, open: number): number {
  const stack: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  let i = open;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      i = src.indexOf("\n", i);
      if (i === -1) return src.length;
      continue;
    }
    if (c === "/" && next === "*") {
      i = src.indexOf("*/", i + 2) + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "`") {
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") i += 2;
        else if (src[i] === "$" && src[i + 1] === "{") i = closing(src, i + 1);
        else i++;
      }
      i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      stack.pop();
      if (!stack.length) return i + 1;
    }
    i++;
  }
  return src.length;
}

/** Splits at top-level occurrences of `sep` (not inside brackets, strings or templates). */
function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`" || c === "(" || c === "[" || c === "{") {
      if (c === "(" || c === "[" || c === "{") depth++;
      else {
        // Jump over the whole string or template.
        const end = c === "`" ? closingTemplate(src, i) : closingQuote(src, i);
        i = end - 1;
      }
      continue;
    }
    if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && src.startsWith(sep, i)) {
      out.push(src.slice(start, i));
      start = i + sep.length;
    }
  }
  out.push(src.slice(start));
  return out;
}
function closingQuote(src: string, at: number) {
  let i = at + 1;
  while (i < src.length && src[i] !== src[at]) i += src[i] === "\\" ? 2 : 1;
  return i + 1;
}
function closingTemplate(src: string, at: number) {
  let i = at + 1;
  while (i < src.length && src[i] !== "`") {
    if (src[i] === "\\") i += 2;
    else if (src[i] === "$" && src[i + 1] === "{") i = closing(src, i + 1);
    else i++;
  }
  return i + 1;
}

/** `a ? b : c` at the top level → [b, c]; anything else → null. */
function ternary(expr: string): [string, string] | null {
  const q = splitTop(expr, "?");
  if (q.length < 2) return null;
  const rest = q.slice(1).join("?");
  // The ":" that matches the first "?": count nested ternaries in the true branch.
  let depth = 0;
  const parts = splitTop(rest, ":");
  for (let k = 0; k < parts.length - 1; k++) {
    depth += splitTop(parts[k], "?").length - 1;
    if (depth === 0) return [parts.slice(0, k + 1).join(":"), parts.slice(k + 1).join(":")];
    depth--;
  }
  return null;
}

type Call = { file: string; line: number; actions: string[]; dynamic: string | null; isPublic: string | null };

/** Every `callee({ … })` in the file, with its action(s) resolved as far as the file itself allows. */
function calls(file: string, callee: string): Call[] {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(WEB, file).split(path.sep).join("/");
  const out: Call[] = [];
  let at = src.indexOf(`${callee}(`);
  while (at !== -1) {
    const open = at + callee.length;
    const args = src.slice(open + 1, closing(src, open) - 1).trim();
    const line = src.slice(0, at).split("\n").length;
    at = src.indexOf(`${callee}(`, open);
    // The definition (`function logActivity(input…`) and other non-literal calls are skipped.
    if (!args.startsWith("{")) continue;
    const props = splitTop(args.slice(1, closing(args, 0) - 1), ",").map((p) => p.trim());
    const prop = (name: string) => {
      const p = props.find((x) => x === name || x.startsWith(`${name}:`));
      return p === undefined ? null : p === name ? name : p.slice(name.length + 1).trim();
    };
    const actionExpr = prop("action");
    if (actionExpr === null) continue;
    const resolved = resolve(actionExpr, src);
    const key = `${rel}::${actionExpr.replace(/\s+/g, " ")}`;
    out.push({ file: rel, line, actions: resolved ?? DYNAMIC[key] ?? [], dynamic: resolved ? null : key, isPublic: prop("isPublic") });
  }
  return out;
}

/** String literals, ternaries of them, and `const NAME = "…"` in the same file. Null when the file alone can't say. */
function resolve(raw: string, src: string): string[] | null {
  const expr = raw.trim().replace(/^\(([\s\S]*)\)$/, "$1").trim();
  const literal = /^(["'`])([a-z_]+\.[a-z_]+)\1$/.exec(expr);
  if (literal) return [literal[2]];
  const t = ternary(expr);
  if (t) {
    const a = resolve(t[0], src);
    const b = resolve(t[1], src);
    return a && b ? [...a, ...b] : null;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
    const m = new RegExp(`const ${expr}\\s*=\\s*(["'])([a-z_]+\\.[a-z_]+)\\1`).exec(src);
    if (m) return [m[2]];
  }
  return null;
}

const keepSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f);
const SRC = files(path.join(WEB, "src"), keepSource).flatMap((f) => calls(f, "logActivity"));
const SEED = files(path.join(WEB, "prisma/seed"), keepSource).flatMap((f) => calls(f, "ctx.activity"));
const where = (c: Call) => `${c.file}:${c.line}`;
const entry = (a: string) => (ACTIONS as Record<string, ActionEntry>)[a];

describe("activity action catalog", () => {
  it("finds the call sites it checks", () => {
    expect(SRC.length).toBeGreaterThan(150);
    expect(SEED.length).toBeGreaterThan(10);
  });

  it("knows every action expression it can't read on its own", () => {
    const unknown = [...SRC, ...SEED].filter((c) => c.dynamic && !DYNAMIC[c.dynamic]).map((c) => `${where(c)} — add "${c.dynamic}" to DYNAMIC with its values`);
    expect(unknown).toEqual([]);
  });

  it("keeps the DYNAMIC list honest", () => {
    const stale = Object.entries(DYNAMIC).flatMap(([key, values]) => {
      const [file] = key.split("::");
      if (![...SRC, ...SEED].some((c) => c.dynamic === key)) return [`${key} — no call site uses this expression any more`];
      const src = readFileSync(path.join(WEB, file), "utf8");
      return values.filter((v) => !src.includes(`"${v}"`) && !src.includes(`"${v.split(".")[1].toUpperCase()}"`)).map((v) => `${key} — ${v} doesn't appear in ${file}`);
    });
    expect(stale).toEqual([]);
  });

  it("has an entry for every action the code writes", () => {
    const missing = SRC.flatMap((c) => c.actions.filter((a) => !entry(a)).map((a) => `${where(c)} writes "${a}"`));
    expect(missing).toEqual([]);
  });

  it("has an entry for every action the seed writes", () => {
    const missing = SEED.flatMap((c) => c.actions.filter((a) => !entry(a)).map((a) => `${where(c)} seeds "${a}"`));
    expect(missing).toEqual([]);
  });

  it("only lists actions something writes", () => {
    const written = new Set(SRC.flatMap((c) => c.actions));
    expect(Object.keys(ACTIONS).filter((a) => !written.has(a))).toEqual([]);
  });

  it("agrees with every literal isPublic at a call site", () => {
    const disagree = SRC.flatMap((c) =>
      c.isPublic === "true" || c.isPublic === "false"
        ? c.actions.filter((a) => entry(a) && entry(a).public !== (c.isPublic === "true")).map((a) => `${where(c)} passes isPublic: ${c.isPublic} for "${a}", the catalog says ${entry(a).public}`)
        : [],
    );
    expect(disagree).toEqual([]);
  });
});

describe("catalog wording", () => {
  const roles = { PRESIDENT: "President", VP: "Vice President", OFFICER: "Officer", ADVISOR: "Advisor" };

  it("gives every action a label and a phrase, even with no data", () => {
    for (const a of Object.keys(ACTIONS)) {
      expect(actionLabel(a), a).toMatch(/^[A-Z]/);
      expect(actionPhrase(a, undefined, roles), a).toMatch(/^[a-z]/);
      expect(actionPhrase(a, { title: 1, name: null }, roles), a).not.toMatch(/undefined|null|\[object/);
    }
  });

  it("reads like a sentence, never like a machine name", () => {
    expect(actionPhrase("budget.item_added", { description: "Pizza" })).toBe("added “Pizza” to the budget");
    expect(actionPhrase("event.cohost_approved", { title: "Robot Day" })).toBe("agreed to co-host “Robot Day”");
    expect(actionPhrase("club.google_account_verified", {})).toBe("verified the club's Google account");
    expect(actionPhrase("role.assigned", { role: "OFFICER", position: "Treasurer" }, roles)).toBe("filled the Treasurer seat");
    expect(actionPhrase("role.ended", { role: "ADVISOR" }, roles)).toBe("ended an Advisor role");
    expect(actionPhrase("role.ended", { role: "VP" }, roles)).toBe("ended a Vice President role");
    expect(actionPhrase("never.written", {})).toBe("made a change");
    expect(actionLabel("legacy.thing_done")).toBe("Legacy: thing done");
  });

  it("keeps public and busy defaults where feeds expect them", () => {
    expect(isPublicByDefault("role.assigned")).toBe(true);
    expect(isPublicByDefault("membership.requested")).toBe(false);
    expect(isPublicByDefault("unknown.action")).toBe(false);
    expect(BUSY_ACTIONS).toEqual(expect.arrayContaining(["attendance.checkin", "calendar.subscribed", "vote.cast"]));
    expect(BUSY_ACTIONS).not.toContain("role.assigned");
  });
});
