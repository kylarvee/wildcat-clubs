import "server-only";
import { z } from "zod";
import type { Actor } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getClubAccess, type Capability, type ClubAccess, type PlatformAction } from "@/lib/authz";

/**
 * Shared plumbing for the domain layer (src/lib/domain/*).
 *
 * Domain functions are the ONLY write path into the data lake. Each one:
 *   1. checks permission through lib/authz (assertCan / assertClubCap),
 *   2. validates input (zod),
 *   3. writes,
 *   4. appends to the activity stream (lib/lake/activity),
 *   5. notifies / opens or resolves tasks if someone's court the ball is now in.
 * Server actions, API routes, the mobile API and AI tools all call these.
 */

export type DomainErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT";

export class DomainError extends Error {
  constructor(
    public code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const forbidden = (msg = "You don't have permission to do that.") => new DomainError("FORBIDDEN", msg);
export const notFound = (what = "That item") => new DomainError("NOT_FOUND", `${what} wasn't found.`);
export const invalid = (msg: string) => new DomainError("INVALID", msg);
export const conflict = (msg: string) => new DomainError("CONFLICT", msg);

export function assertSignedIn(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Please sign in first.");
  if (actor.status === "DEACTIVATED") throw forbidden("This account is deactivated.");
}

export function assertCan(actor: Actor | null, action: PlatformAction): asserts actor is Actor {
  assertSignedIn(actor);
  if (!can(actor, action)) throw forbidden();
}

/** Loads club access and requires a capability. Returns the access for further checks. */
export async function assertClubCap(actor: Actor | null, clubId: string, cap: Capability): Promise<ClubAccess> {
  assertSignedIn(actor);
  const access = await getClubAccess(actor, clubId);
  if (!access) throw notFound("Club");
  if (!access.capabilities.has(cap)) {
    if (access.suspended) throw forbidden("Your leadership permissions are paused until you finish your required training or test.");
    throw forbidden();
  }
  return access;
}

/**
 * Control characters (newlines, tabs, NUL…) become one space. For one-line
 * text that ends up in email subjects and headers (names, titles):
 * `z.string().overwrite(oneLine).trim()`.
 */
export const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ");

/** Parses input with a zod schema, turning failures into a readable INVALID error. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
    throw invalid(`${path}${first?.message ?? "Invalid input."}`);
  }
  return r.data;
}

// ─── Server-action wrapper ───────────────────────────────────────────────────

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; code: DomainErrorCode | "ERROR" };

/**
 * Wraps a server action body: resolves the current user, runs the domain call,
 * and converts DomainErrors into `{ ok: false }` so forms can show them.
 *
 *   export async function saveThing(input: X) {
 *     "use server";
 *     return act((actor) => things.save(actor, input));
 *   }
 */
export async function act<T>(fn: (actor: Actor | null) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const actor = await getCurrentUser();
    const data = await fn(actor);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message, code: e.code };
    // Next's redirect()/notFound() throw special errors that must propagate.
    if (e && typeof e === "object" && "digest" in e && typeof (e as { digest?: unknown }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_")) throw e;
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again.", code: "ERROR" };
  }
}

/** For route handlers (mobile API etc.): maps DomainErrors to HTTP responses. */
export async function apiRoute<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    const data = await fn();
    return Response.json({ ok: true, data });
  } catch (e) {
    if (e instanceof DomainError) {
      const status = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400, CONFLICT: 409 }[e.code];
      return Response.json({ ok: false, error: e.message, code: e.code }, { status });
    }
    console.error(e);
    return Response.json({ ok: false, error: "Something went wrong.", code: "ERROR" }, { status: 500 });
  }
}
