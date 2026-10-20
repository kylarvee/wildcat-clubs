import { formatDate, formatUtc } from "@/lib/events/ics";
import { campusParts } from "@/lib/events/wallclock";
import { INSTITUTION } from "@/lib/institution";
import { TZ } from "@/lib/time";

/**
 * Links that put our events into other calendars. Client-safe.
 */

/** Public URL of this deployment (links in feeds, emails and Google). */
export function appUrl(path = "") {
  const base = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return base + path;
}

/** "Add to Google Calendar" — opens a prefilled event in the viewer's own Google Calendar. */
export function googleCalendarTemplateUrl(e: { title: string; start: Date; end: Date; allDay?: boolean; details?: string; location?: string | null }) {
  let dates: string;
  if (e.allDay) {
    const last = new Date(Math.max(e.start.getTime(), e.end.getTime() - 1));
    const p = campusParts(last);
    const u = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    const next = `${u.getUTCFullYear()}${String(u.getUTCMonth() + 1).padStart(2, "0")}${String(u.getUTCDate()).padStart(2, "0")}`;
    dates = `${formatDate(e.start)}/${next}`;
  } else {
    dates = `${formatUtc(e.start)}/${formatUtc(e.end)}`;
  }
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates, ctz: TZ });
  if (e.details) q.set("details", e.details.slice(0, 1500));
  if (e.location) q.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/**
 * "Add to calendar → Google Calendar" for one date of an event. The place is
 * the location; an online event's location is its link, and a hybrid event's
 * link goes in the details, after the description and before the page link.
 */
export function eventGoogleCalendarUrl(e: {
  title: string;
  /** The host club, or the university. */
  hostName: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  /** The description as plain text. */
  about?: string | null;
  /** The event page for this date (absolute). */
  pageUrl: string;
  /** Where it is ("Shepherd Union Building, Room 404, Weber State University, Ogden, UT"); null online or not decided. */
  place: string | null;
  onlineUrl: string | null;
}) {
  const hybrid = Boolean(e.place && e.onlineUrl);
  const details = [e.about?.trim() || null, hybrid ? `Join online: ${e.onlineUrl}` : null, `Details: ${e.pageUrl}`].filter(Boolean).join("\n\n");
  return googleCalendarTemplateUrl({ title: `${e.title} (${e.hostName})`, start: e.start, end: e.end, allDay: e.allDay, details, location: e.place ?? e.onlineUrl });
}

/** webcal:// form of a feed URL (opens Apple Calendar / Outlook subscribe dialogs). */
export function webcalUrl(httpUrl: string) {
  return httpUrl.replace(/^https?:\/\//, "webcal://");
}

/** Google Calendar "add by URL" link for a feed. */
export function googleSubscribeUrl(httpUrl: string) {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(httpUrl))}`;
}

/** The text a map pin searches for: "<Building>, Weber State University, Ogden, UT". */
export function campusMapQuery(buildingName: string) {
  return `${buildingName}, ${INSTITUTION.mapsSuffix}`;
}
