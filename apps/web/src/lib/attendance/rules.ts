import type { CheckInMethod } from "@prisma/client";
import { fmtDate, fmtTime } from "@/lib/time";

/**
 * The check-in rules, as pure functions so they can be tested without a
 * database. lib/domain/attendance.ts applies them; pages use the same
 * functions to explain *why* someone can't check in before they tap anything.
 */

// ─── The check-in window ────────────────────────────────────────────────────

export type CheckinWindowConfig = { opensMinutesBefore: number; closesMinutesAfter: number };
export type CheckinWindow = { opensAt: Date; closesAt: Date };
export type WindowState = "NOT_OPEN" | "OPEN" | "CLOSED";

/** Check-in runs from `opensMinutesBefore` the start to `closesMinutesAfter` the end. */
export function checkinWindow(occ: { startsAt: Date; endsAt: Date }, cfg: CheckinWindowConfig): CheckinWindow {
  return {
    opensAt: new Date(occ.startsAt.getTime() - Math.max(0, cfg.opensMinutesBefore) * 60_000),
    closesAt: new Date(occ.endsAt.getTime() + Math.max(0, cfg.closesMinutesAfter) * 60_000),
  };
}

/** Both edges are inclusive: arriving exactly when it opens or closes still counts. */
export function windowState(w: CheckinWindow, now: Date): WindowState {
  const t = now.getTime();
  if (t < w.opensAt.getTime()) return "NOT_OPEN";
  if (t > w.closesAt.getTime()) return "CLOSED";
  return "OPEN";
}

function sameCampusDay(a: Date, b: Date) {
  return fmtDate(a, "yyyy-MM-dd") === fmtDate(b, "yyyy-MM-dd");
}

/** "6:00 PM" today, "Thu, Oct 16 at 6:00 PM" any other day. */
export function whenLabel(at: Date, now: Date) {
  return sameCampusDay(at, now) ? fmtTime(at) : `${fmtDate(at)} at ${fmtTime(at)}`;
}

/** The sentence shown when check-in isn't open. Null when it is. */
export function windowMessage(state: WindowState, w: CheckinWindow, now: Date): string | null {
  if (state === "NOT_OPEN") return `Check-in hasn't opened yet — it opens ${sameCampusDay(w.opensAt, now) ? "at " : ""}${whenLabel(w.opensAt, now)}.`;
  if (state === "CLOSED") return `Check-in for this event closed ${sameCampusDay(w.closesAt, now) ? "at " : "on "}${whenLabel(w.closesAt, now)}. If you were there, ask a club leader to add you.`;
  return null;
}

// ─── How someone is checking in ─────────────────────────────────────────────

export type BlockReason = "NOT_MEMBER" | "EXPIRED_SCAN";
export type MethodDecision = { ok: true; method: Extract<CheckInMethod, "QR" | "SELF"> } | { ok: false; reason: BlockReason };

/**
 * A live scan (rotating token or pass) is always a QR check-in. Without one,
 * the event's code is enough only for active members of the host or an
 * approved co-host club (method SELF, shown as "Code") — so a code passed
 * around can't sign in strangers who weren't in the room. In person, the code
 * is only ever shown at the event (the QR screen); online events, which have
 * nothing to scan, are the only ones the app offers a one-tap check-in for
 * (allowsTapCheckIn).
 */
export function decideMethod(input: { scanValid: boolean; scanPresented: boolean; isParticipatingMember: boolean }): MethodDecision {
  if (input.scanValid) return { ok: true, method: "QR" };
  if (input.isParticipatingMember) return { ok: true, method: "SELF" };
  if (input.scanPresented) return { ok: false, reason: "EXPIRED_SCAN" };
  return { ok: false, reason: "NOT_MEMBER" };
}

/** In-person events need the QR code or the code shown at the event; only online events get a one-tap "Check in". */
export function allowsTapCheckIn(event: { locationType: string }): boolean {
  return event.locationType === "VIRTUAL";
}

export function blockMessage(reason: BlockReason, rotateSeconds: number) {
  switch (reason) {
    case "EXPIRED_SCAN":
      return `That QR code has expired — it changes every ${rotateSeconds} seconds. Scan the code on the screen again.`;
    case "NOT_MEMBER":
      return "Scan the QR code shown at the event. Checking in with just the code is for the club's members.";
  }
}

// ─── Codes ──────────────────────────────────────────────────────────────────

export const CODE_LENGTH = 6;

/**
 * Tidies a typed code ("abc-234 " → "ABC234"). Generated codes are 6
 * characters without look-alikes (lib/attendance/token), but any code that
 * exists must work, so this only rejects things that can't be a code; the
 * hints for typos come from codeNotFoundMessage() after a failed lookup.
 */
export function normalizeCode(raw: string): { ok: true; code: string } | { ok: false; error: string } {
  const code = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!code) return { ok: false, error: `Type the ${CODE_LENGTH}-character code shown under the QR code.` };
  if (code.length < 4 || code.length > 12) return { ok: false, error: `Check-in codes are ${CODE_LENGTH} characters — that one has ${code.length}.` };
  return { ok: true, code };
}

/** "No event uses that code", plus the most likely typo. */
export function codeNotFoundMessage(code: string) {
  const hint =
    code.length !== CODE_LENGTH
      ? ` Check-in codes are ${CODE_LENGTH} characters — that one has ${code.length}.`
      : /[01IO]/.test(code)
        ? " Codes don't usually use 0, O, 1 or I — check those characters."
        : "";
  return `We couldn't find an event with that check-in code.${hint} Double-check the code on the screen.`;
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export const METHOD_LABEL: Record<CheckInMethod, string> = {
  QR: "QR scan",
  SELF: "Event code",
  MANUAL: "Added by a leader",
};

export const METHOD_SHORT: Record<CheckInMethod, string> = { QR: "QR", SELF: "Code", MANUAL: "Manual" };

/** "Maya C." — how names show on a projected screen, where the whole room can read them. */
export function publicShortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "Someone";
  const first = parts[0].replace(/[.,]$/, "");
  const honorific = /^(dr|prof|mr|mrs|ms|mx)\.?$/i.test(first);
  const given = honorific && parts.length > 2 ? parts[1] : first;
  return `${given} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
