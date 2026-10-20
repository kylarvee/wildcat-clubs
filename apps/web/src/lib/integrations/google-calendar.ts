import "server-only";
import { randomUUID } from "node:crypto";
import type { calendar_v3 } from "@googleapis/calendar";
import { db } from "@/lib/db";
import { integrationLive } from "@/lib/config";
import { CLUB_ACCOUNT_FIELDS, clubGoogleAccount, googleJwt, PLATFORM_SENDER } from "@/lib/integrations/google";
import { richToText } from "@/lib/rich/sanitize";
import { splitEventLinks } from "@/lib/events/links";
import { isHybrid, roomLabel } from "@/lib/events/labels";
import { appUrl, campusMapQuery } from "@/lib/events/share";
import { addDaysToDateInput, campusParts, toDateInput } from "@/lib/events/wallclock";
import { TZ } from "@/lib/time";

/**
 * Google Calendar mirror. The data lake is the source of truth; when a sysadmin
 * turns on "Google Calendar" sync, each club event is copied into the club's own
 * Workspace calendar (running as Club.contactEmail through the service account,
 * only for approved clubs whose account WSUSA verified — clubGoogleAccount),
 * and university events into the platform account's calendar.
 *
 * One Google event per platform event: the first scheduled occurrence is the
 * start, the rest are RDATEs, so moved, cancelled and semester-based meetings
 * mirror exactly. With sync off every call is a no-op that says so — and no
 * Meet link is ever invented.
 *
 * Workspace setup (once, by WSU's Google Workspace admin): add this OAuth scope
 * to the service account's domain-wide delegation:
 *   https://www.googleapis.com/auth/calendar
 * It is the full Calendar scope, broader than the adapter needs, because
 * university events go on the platform account's primary calendar. Delegation
 * grants a scope for every user in the domain, so narrowing it to
 * calendar.app.created (only the calendars this app creates) needs university
 * events moved to an app-created calendar whose id is stored somewhere first.
 */

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export type GoogleSyncResult = {
  status: "synced" | "off" | "skipped" | "failed";
  /** Set when a Google Meet link was created on this sync. */
  meetUrl?: string | null;
  message?: string;
};

/** Whether events for this club (null = university) will mirror to Google right now. */
export async function googleCalendarReady(clubId: string | null): Promise<{ live: boolean; reason?: string }> {
  if (!(await integrationLive("googleCalendar"))) return { live: false, reason: "Google Calendar sync is off." };
  if (!clubId) return { live: true };
  const account = clubGoogleAccount(await db.club.findUnique({ where: { id: clubId }, select: CLUB_ACCOUNT_FIELDS }));
  return account.email ? { live: true } : { live: false, reason: account.reason };
}

/** Loaded on first use, so mock mode never pulls in the Google client. */
async function client(subject: string) {
  const { calendar } = await import("@googleapis/calendar");
  return calendar({ version: "v3", auth: googleJwt(subject, SCOPES) });
}

function status(e: unknown): number | undefined {
  const s = (e as { code?: unknown; status?: unknown; response?: { status?: number } })?.response?.status ?? (e as { code?: unknown }).code ?? (e as { status?: unknown }).status;
  return typeof s === "number" ? s : undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Campus-local "YYYYMMDDTHHMMSS" for RDATE;TZID lines. */
function localStamp(d: Date) {
  const p = campusParts(d);
  return `${p.y}${pad(p.m)}${pad(p.d)}T${pad(p.H)}${pad(p.M)}00`;
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadEvent>>>;

function loadEvent(eventId: string) {
  return db.event.findUnique({
    where: { id: eventId },
    include: {
      club: { select: { id: true, name: true, googleCalendarId: true, ...CLUB_ACCOUNT_FIELDS } },
      building: { select: { name: true } },
      occurrences: { where: { status: "SCHEDULED" }, orderBy: { startsAt: "asc" }, select: { startsAt: true, endsAt: true, roomOverride: true } },
    },
  });
}

function locationText(e: Loaded) {
  switch (e.locationType) {
    case "CAMPUS":
      return e.building ? `${campusMapQuery(e.building.name)}${e.room ? ` (${roomLabel(e.room)})` : ""}` : null;
    case "ADDRESS":
      return e.address;
    case "VIRTUAL":
      return e.virtualUrl;
    default:
      return null;
  }
}

function eventBody(e: Loaded): calendar_v3.Schema$Event {
  const [first, ...rest] = e.occurrences;
  const { body, links } = splitEventLinks(e.descriptionHtml);
  // Hybrid: the place is the location; the link people use from afar goes here (as in the ICS feeds).
  const details = [isHybrid(e) ? `Join online: ${e.virtualUrl}` : null, richToText(body, 6000), links.map((l) => `${l.label || "Link"}: ${l.url}`).join("\n"), `Details and check-in: ${appUrl(`/events/${e.id}`)}`]
    .filter(Boolean)
    .join("\n\n");
  const start: calendar_v3.Schema$EventDateTime = e.allDay ? { date: toDateInput(first.startsAt) } : { dateTime: first.startsAt.toISOString(), timeZone: TZ };
  const end: calendar_v3.Schema$EventDateTime = e.allDay
    ? { date: addDaysToDateInput(toDateInput(first.startsAt), 1) }
    : { dateTime: first.endsAt.toISOString(), timeZone: TZ };
  const recurrence = rest.length
    ? [e.allDay ? `RDATE;VALUE=DATE:${rest.map((o) => toDateInput(o.startsAt).replace(/-/g, "")).join(",")}` : `RDATE;TZID=${TZ}:${rest.map((o) => localStamp(o.startsAt)).join(",")}`]
    : [];
  return {
    summary: e.club ? `${e.title} · ${e.club.name}` : e.title,
    description: details,
    location: locationText(e) ?? undefined,
    start,
    end,
    recurrence,
    source: { title: "Wildcat Clubs", url: appUrl(`/events/${e.id}`) },
    status: "confirmed",
  };
}

/** Finds or creates the club's calendar in its Workspace account. */
async function calendarIdFor(cal: calendar_v3.Calendar, e: Loaded): Promise<string> {
  if (!e.club) return "primary";
  if (e.club.googleCalendarId) return e.club.googleCalendarId;
  const created = await cal.calendars.insert({
    requestBody: { summary: `${e.club.name} events`, description: "Kept in sync by Wildcat Clubs. Edit events on the platform.", timeZone: TZ },
  });
  const id = created.data.id!;
  // Mirror bookkeeping only (not user data), so the adapter records it itself.
  await db.club.update({ where: { id: e.club.id }, data: { googleCalendarId: id } });
  return id;
}

/**
 * Creates or updates the Google copy of an event (or cancels it when the event
 * is cancelled or has no scheduled meetings left). Never throws.
 */
export async function syncEventToGoogle(eventId: string, opts: { createMeet?: boolean } = {}): Promise<GoogleSyncResult> {
  try {
    const e = await loadEvent(eventId);
    if (!e) return { status: "skipped" };
    if (!(await integrationLive("googleCalendar"))) return { status: "off", message: "Google Calendar sync is off." };
    const account = e.club ? clubGoogleAccount(e.club) : { email: PLATFORM_SENDER };
    if (!account.email) return { status: "off", message: account.reason };

    const cal = await client(account.email);
    const calendarId = await calendarIdFor(cal, e);

    if (e.status === "CANCELLED" || e.occurrences.length === 0) {
      if (e.googleEventId) await cal.events.patch({ calendarId, eventId: e.googleEventId, requestBody: { status: "cancelled" } }).catch(() => undefined);
      return { status: "synced" };
    }

    const body = eventBody(e);
    const wantsMeet = Boolean(opts.createMeet && e.locationType === "VIRTUAL" && !e.virtualUrl);
    if (wantsMeet) body.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };

    let saved: calendar_v3.Schema$Event | null = null;
    if (e.googleEventId) {
      try {
        saved = (await cal.events.patch({ calendarId, eventId: e.googleEventId, requestBody: body, conferenceDataVersion: 1 })).data;
      } catch (err) {
        // Deleted on the Google side: make a fresh copy below.
        if (status(err) !== 404 && status(err) !== 410) throw err;
      }
    }
    if (!saved) {
      saved = (await cal.events.insert({ calendarId, requestBody: body, conferenceDataVersion: 1 })).data;
      await db.event.update({ where: { id: e.id }, data: { googleEventId: saved.id ?? null } });
    }

    const meetUrl = wantsMeet ? (saved.hangoutLink ?? saved.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null) : null;
    return { status: "synced", meetUrl };
  } catch (err) {
    console.error("[google-calendar] sync failed", eventId, err);
    return { status: "failed", message: "We couldn't update the club's Google Calendar. The event is saved here and will sync on the next change." };
  }
}

/** Removes the Google copy of an event that is being deleted. Never throws. */
export async function removeEventFromGoogle(e: { googleEventId: string | null; clubId: string | null }): Promise<GoogleSyncResult> {
  if (!e.googleEventId) return { status: "skipped" };
  try {
    if (!(await integrationLive("googleCalendar"))) return { status: "off" };
    const club = e.clubId ? await db.club.findUnique({ where: { id: e.clubId }, select: { googleCalendarId: true, ...CLUB_ACCOUNT_FIELDS } }) : null;
    const subject = e.clubId ? clubGoogleAccount(club).email : PLATFORM_SENDER;
    if (!subject) return { status: "off" };
    if (e.clubId && !club?.googleCalendarId) return { status: "skipped" };
    const cal = await client(subject);
    await cal.events.delete({ calendarId: club?.googleCalendarId ?? "primary", eventId: e.googleEventId }).catch((err) => {
      if (status(err) !== 404 && status(err) !== 410) throw err;
    });
    return { status: "synced" };
  } catch (err) {
    console.error("[google-calendar] delete failed", err);
    return { status: "failed" };
  }
}
