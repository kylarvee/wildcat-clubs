import type { EventKind, EventPerk, LocationType } from "@prisma/client";
import { fmtServiceHours, serviceHours } from "@/lib/metrics/service";
import { EVENT_PERKS } from "@/lib/events/labels";

/**
 * The Events Builder's rules for covers, perks, service hours and hybrid
 * events, as plain functions (no database), so the write path
 * (lib/domain/events), the editor and the tests agree. Client-safe.
 */

// ─── Cover image ─────────────────────────────────────────────────────────────

/**
 * A cover is stored like Club.logoUrl: the file's link, "/api/files/<id>".
 * It's one of the host club's own image files (a university event's comes
 * from University files), and it's public, because the cover shows to
 * everyone who can see the event, on cards and feeds alike.
 */
export const COVER_URL = /^\/api\/files\/([A-Za-z0-9_-]{6,64})$/;

/** Covers can be up to 5 MB, like club logos. */
export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export const COVER_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

export function coverFileId(url: string): string | null {
  return COVER_URL.exec(url.trim())?.[1] ?? null;
}

/** What the write path loads about the chosen file. `effective` is its visibility with INHERIT resolved. */
export type CoverFile = {
  name: string;
  clubId: string | null;
  ownerId: string | null;
  isFolder: boolean;
  mimeType: string | null;
  trashedAt: Date | null;
  effective: "PUBLIC" | "MEMBERS" | "LEADERS";
};

/** Why a file can't be the event's cover, or null when it can. `host` is null for a university event. */
export function coverProblem(file: CoverFile | null, host: { id: string; name: string } | null): string | null {
  const area = host ? "Club files" : "University files";
  if (!file || file.isFolder) return "Choose the cover again. That image isn't in the files anymore.";
  const ownFile = host ? file.clubId === host.id : file.clubId === null && file.ownerId === null;
  if (!ownFile) {
    return host
      ? `The cover has to be one of ${host.name}'s own images. Pick it from Club files, or upload it here.`
      : "A university event's cover has to come from University files. Pick it there, or upload it here.";
  }
  if (!file.mimeType?.startsWith("image/")) return `“${file.name}” isn't an image. Covers can be PNG, JPG, WebP, GIF or SVG.`;
  if (file.trashedAt) return `“${file.name}” is in the trash. Restore it in ${area}, or pick another image.`;
  if (file.effective !== "PUBLIC") return `“${file.name}” isn't public, and a cover shows to everyone who can see the event. Make it public in ${area}, or upload a new cover.`;
  return null;
}

// ─── Perks ───────────────────────────────────────────────────────────────────

/** Each perk once, in the order badges show them. */
export function normalizePerks(perks: readonly EventPerk[]): EventPerk[] {
  const set = new Set(perks);
  return EVENT_PERKS.filter((p) => set.has(p));
}

// ─── Hybrid ──────────────────────────────────────────────────────────────────

/**
 * The online link a place keeps. Online events need one (or a Meet request);
 * in-person events, on or off campus, may have one too, which makes them
 * hybrid. Check-in doesn't change: in person still takes the QR code or the
 * typed code, and only online events get one-tap (lib/attendance/rules).
 */
export function onlineLinkFor(locationType: LocationType, virtualUrl: string | null | undefined): string | null {
  if (locationType === "TBD") return null;
  return virtualUrl?.trim() || null;
}

// ─── Service hours ───────────────────────────────────────────────────────────

export const QUARTER_HOUR = 15;
/** The default stops at a full day's work, so an all-day service day doesn't default to 24 hours. */
export const DEFAULT_SERVICE_CAP_MINUTES = 8 * 60;

export const floorToQuarter = (minutes: number) => Math.max(0, Math.floor(minutes / QUARTER_HOUR) * QUARTER_HOUR);

/** "2 hours", "1.5 hours", "1 hour", "0.75 hours". */
export function hoursText(minutes: number): string {
  return `${fmtServiceHours(minutes)} ${serviceHours(minutes) === 1 ? "hour" : "hours"}`;
}

/** What "Hours per attendee" starts at: the event's length (up to 8 hours), in whole quarter hours. Null when the event is too short to count. */
export function defaultServiceMinutes(durationMinutes: number): number | null {
  const m = floorToQuarter(Math.min(durationMinutes, DEFAULT_SERVICE_CAP_MINUTES));
  return m > 0 ? m : null;
}

/**
 * The service minutes a save stores (Event.serviceMinutes: what each attendee
 * earns per date they check in; null = doesn't count).
 *   undefined  not sent. A new Service project counts by default; a saved
 *              event keeps its hours, trimmed when the event got shorter.
 *   null       doesn't count.
 *   a number   whole quarter hours, more than zero, no more than the event's length.
 */
export function resolveServiceMinutes(
  input: number | null | undefined,
  ctx: { durationMinutes: number; kind: EventKind; existing: { serviceMinutes: number | null } | null },
): { ok: true; minutes: number | null } | { ok: false; error: string } {
  if (input === undefined) {
    if (!ctx.existing) return { ok: true, minutes: ctx.kind === "SERVICE" ? defaultServiceMinutes(ctx.durationMinutes) : null };
    const kept = ctx.existing.serviceMinutes;
    if (kept == null || kept <= 0) return { ok: true, minutes: null };
    const fit = Math.min(kept, floorToQuarter(ctx.durationMinutes));
    return { ok: true, minutes: fit > 0 ? fit : null };
  }
  if (input === null) return { ok: true, minutes: null };
  if (!Number.isFinite(input) || input <= 0) return { ok: false, error: "Enter the hours each attendee earns, or turn service hours off." };
  if (input % QUARTER_HOUR !== 0) return { ok: false, error: "Service hours go in quarter hours, like 1.25 or 2.5." };
  if (input > ctx.durationMinutes) return { ok: false, error: `Service hours can't be more than the event's length (${hoursText(ctx.durationMinutes)}).` };
  return { ok: true, minutes: input };
}
