import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bell } from "lucide-react";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS } from "@/components/notifications/catalog";
import { notificationIcon } from "@/components/notifications/kinds";

/**
 * The kind catalog has to match what the code sends. These tests read the
 * source: the `kind` of every notify(), notifyAdmins(), notifyClubCapability(),
 * notifyInBatches() and notifyEach() call in src must be in NOTIFICATION_KINDS,
 * and every catalog kind must be sent somewhere. (prisma/seed/verify.ts then
 * checks the seeded bells against the catalog.)
 */

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CALLEES = ["notify", "notifyAdmins", "notifyClubCapability", "notifyInBatches", "notifyEach"];

/**
 * Call sites whose kind the file alone can't spell out: a template, a spread
 * of an object built elsewhere in the file, or a value passed in. Key:
 * "<path from apps/web>::<the kind expression, or ...spread>". Each value must
 * appear somewhere in src as a quoted string (or, for a status template, the
 * file must name the upper-case status), so the list can't quietly go stale.
 */
const DYNAMIC: Record<string, string[]> = {
  "src/lib/domain/clubs.ts::`club.${d.status.toLowerCase()}`": ["club.approved", "club.changes_requested", "club.rejected"],
  "src/lib/domain/funding.ts::`funding.${status.toLowerCase()}`": ["funding.approved", "funding.partially_approved", "funding.denied"],
  'src/lib/domain/tests.ts::`test.${trigger === "PASSED" ? "completed" : trigger === "FAILED" ? "failed" : "missed"}`': ["test.completed", "test.failed", "test.missed"],
  "src/lib/domain/tests.ts::...m": ["test.completed", "test.missed", "test.failed"],
  "src/lib/domain/event-notices.ts::notice.kind": ["event.changed", "event.cancelled"],
};

// ─── A small, string-aware scanner ───────────────────────────────────────────

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Index just past the end of the string, template or comment starting at `i`, or -1 when none starts there. */
function skip(src: string, i: number): number {
  const c = src[i];
  if (c === "/" && src[i + 1] === "/") {
    const end = src.indexOf("\n", i);
    return end === -1 ? src.length : end;
  }
  if (c === "/" && src[i + 1] === "*") return src.indexOf("*/", i + 2) + 2;
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  if (c === "`") {
    let j = i + 1;
    while (j < src.length && src[j] !== "`") {
      if (src[j] === "\\") j += 2;
      else if (src[j] === "$" && src[j + 1] === "{") j = closing(src, j + 1);
      else j++;
    }
    return j + 1;
  }
  return -1;
}

/** Index just past the bracket closing the one that opens at `open`. */
function closing(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; ) {
    const next = skip(src, i);
    if (next !== -1) {
      i = next;
      continue;
    }
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return src.length;
}

/** Splits at top-level occurrences of `sep` (outside brackets, strings and templates). */
function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; ) {
    const next = skip(src, i);
    if (next !== -1) {
      i = next;
      continue;
    }
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && src.startsWith(sep, i)) {
      out.push(src.slice(start, i));
      start = i + sep.length;
      i += sep.length;
      continue;
    }
    i++;
  }
  out.push(src.slice(start));
  return out;
}

/** String literals and ternaries of them; null when the expression alone can't say. */
function resolve(raw: string): string[] | null {
  const expr = raw.trim().replace(/^\(([\s\S]*)\)$/, "$1").trim();
  const literal = /^(["'`])([a-z_]+\.[a-z_]+)\1$/.exec(expr);
  if (literal) return [literal[2]];
  const q = splitTop(expr, "?");
  if (q.length >= 2) {
    const parts = splitTop(q.slice(1).join("?"), ":");
    if (parts.length === 2) {
      const a = resolve(parts[0]);
      const b = resolve(parts[1]);
      return a && b ? [...a, ...b] : null;
    }
  }
  return null;
}

type Call = { where: string; kinds: string[]; dynamic: string | null };

function calls(file: string): Call[] {
  const rel = path.relative(WEB, file).split(path.sep).join("/");
  // The definitions themselves pass the caller's kind along.
  if (rel === "src/lib/domain/notify.ts") return [];
  const src = readFileSync(file, "utf8");
  const out: Call[] = [];
  const re = new RegExp(`(?<![\\w.$])(${CALLEES.join("|")})\\(`, "g");
  for (const m of src.matchAll(re)) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
    const open = m.index + m[1].length;
    const args = splitTop(src.slice(open + 1, closing(src, open) - 1), ",").map((a) => a.trim());
    const obj = args.find((a) => a.startsWith("{"));
    if (!obj) continue;
    const props = splitTop(obj.slice(1, -1), ",").map((p) => p.trim());
    const kindProp = props.find((p) => p === "kind" || /^kind\s*:/.test(p));
    const expr = kindProp ? (kindProp === "kind" ? "kind" : kindProp.replace(/^kind\s*:/, "").trim()) : props.find((p) => p.startsWith("..."));
    if (!expr) continue;
    const where = `${rel}:${src.slice(0, m.index).split("\n").length}`;
    const resolved = kindProp ? resolve(expr) : null;
    const key = `${rel}::${expr.replace(/\s+/g, " ")}`;
    out.push({ where, kinds: resolved ?? DYNAMIC[key] ?? [], dynamic: resolved ? null : key });
  }
  return out;
}

const SRC = files(path.join(WEB, "src")).flatMap(calls);
const CATALOG = new Set<string>(NOTIFICATION_KINDS);
const ALL_SOURCE = files(path.join(WEB, "src"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("notification kind catalog", () => {
  it("finds the call sites it checks", () => {
    expect(SRC.length).toBeGreaterThan(70);
  });

  it("knows every kind expression it can't read on its own", () => {
    expect(SRC.filter((c) => c.dynamic && !DYNAMIC[c.dynamic]).map((c) => `${c.where} — add "${c.dynamic}" to DYNAMIC with its kinds`)).toEqual([]);
  });

  it("keeps the DYNAMIC list honest", () => {
    const stale = Object.entries(DYNAMIC).flatMap(([key, kinds]) => {
      const [file] = key.split("::");
      if (!SRC.some((c) => c.dynamic === key)) return [`${key} — no call site uses this expression any more`];
      const own = readFileSync(path.join(WEB, file), "utf8");
      return kinds.filter((k) => !ALL_SOURCE.includes(`"${k}"`) && !own.includes(`"${k.split(".")[1].toUpperCase()}"`)).map((k) => `${key} — "${k}" isn't written anywhere`);
    });
    expect(stale).toEqual([]);
  });

  it("lists every kind the code sends", () => {
    expect(SRC.flatMap((c) => c.kinds.filter((k) => !CATALOG.has(k)).map((k) => `${c.where} sends "${k}"`))).toEqual([]);
  });

  it("only lists kinds something sends", () => {
    const sent = new Set(SRC.flatMap((c) => c.kinds));
    expect(NOTIFICATION_KINDS.filter((k) => !sent.has(k))).toEqual([]);
  });

  it("lists each kind once, sorted", () => {
    expect([...NOTIFICATION_KINDS]).toEqual([...new Set(NOTIFICATION_KINDS)].sort());
  });

  it("gives event changes, reminders and unlocked reviews their own icons", () => {
    for (const k of ["event.changed", "event.cancelled", "event.starting_soon", "requirement.due_soon", "review.unlocked"]) {
      const family = `${k.split(".")[0]}.anything_else`;
      expect(notificationIcon(k), k).not.toBe(Bell);
      expect(notificationIcon(k), `${k} has its own icon, not its family's`).not.toBe(notificationIcon(family));
    }
  });
});
