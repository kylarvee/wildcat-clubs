import type { EventKind, EventPerk, FundingSource, LocationType, Visibility } from "@prisma/client";
import { earnedMinutes, fmtServiceHours } from "@/lib/metrics/service";

/** Words people see for event enums. Client-safe (no server imports). */

export const EVENT_KINDS: EventKind[] = ["MEETING", "PRACTICE", "SOCIAL", "WORKSHOP", "SERVICE", "COMPETITION", "FUNDRAISER", "TRAINING", "OTHER"];

export const KIND_LABEL: Record<EventKind, string> = {
  MEETING: "Meeting",
  PRACTICE: "Practice",
  SOCIAL: "Social",
  WORKSHOP: "Workshop",
  SERVICE: "Service project",
  COMPETITION: "Competition",
  FUNDRAISER: "Fundraiser",
  TRAINING: "Training",
  OTHER: "Other",
};

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  PUBLIC: "Public",
  UNIVERSITY: "Weber State only",
  MEMBERS: "Members only",
};

export const VISIBILITY_HINT: Record<Visibility, string> = {
  PUBLIC: "Anyone can see it, even without signing in. It shows on the public calendar and feeds.",
  UNIVERSITY: "Anyone signed in with a Weber State account.",
  MEMBERS: "Members of the host club and approved co-host clubs.",
};

export const LOCATION_LABEL: Record<LocationType, string> = {
  CAMPUS: "On campus",
  ADDRESS: "Off campus",
  VIRTUAL: "Online",
  TBD: "To be decided",
};

/** The one order funding sources appear in, everywhere (ARCHITECTURE.md §6). */
export const FUNDING_SOURCES: FundingSource[] = ["UNIVERSITY", "WSUSA", "COLLEGE", "DEPARTMENT"];

export const FUNDING_LABEL: Record<FundingSource, string> = {
  UNIVERSITY: "University",
  WSUSA: "WSUSA",
  COLLEGE: "College",
  DEPARTMENT: "Department",
};

export const COST_CATEGORIES = [
  "Food & drink",
  "Supplies",
  "Venue",
  "Equipment",
  "Printing & marketing",
  "Travel",
  "Speaker or honorarium",
  "Prizes & awards",
  "Other",
] as const;

/** FullCalendar color for university (admin) events: Weber State purple. */
export const UNIVERSITY_COLOR = "#492365";

/** "404" → "Room 404"; leaves "Room 404", "Rm 2" or "Ballroom B" alone. */
export function roomLabel(room: string) {
  const r = room.trim();
  return /^\d/.test(r) ? `Room ${r}` : r;
}

/** One-line location text ("Shepherd Union Building, Room 404", "Online", "Location to be decided"). */
export function locationText(e: {
  locationType: LocationType;
  building?: { name: string } | null;
  room?: string | null;
  address?: string | null;
  virtualUrl?: string | null;
  roomOverride?: string | null;
}): string {
  switch (e.locationType) {
    case "CAMPUS": {
      const room = e.roomOverride || e.room;
      if (!e.building) return room ? roomLabel(room) : "On campus";
      return room ? `${e.building.name}, ${roomLabel(room)}` : e.building.name;
    }
    case "ADDRESS":
      return e.address || "Off campus";
    case "VIRTUAL":
      return "Online";
    default:
      return "Location to be decided";
  }
}

// ─── Perks, hybrid and badges ────────────────────────────────────────────────

/** What an event offers attendees, in the order chips and badges show them. */
export const EVENT_PERKS: EventPerk[] = ["FREE_FOOD", "FREE_STUFF"];

export const PERK_LABEL: Record<EventPerk, string> = {
  FREE_FOOD: "Free food",
  FREE_STUFF: "Free stuff",
};

/** In person (on or off campus) with an online link too, so people can watch or join remotely. */
export function isHybrid(e: { locationType: LocationType; virtualUrl?: string | null }): boolean {
  return (e.locationType === "CAMPUS" || e.locationType === "ADDRESS") && Boolean(e.virtualUrl?.trim());
}

/** How people take part: in person, online, both (hybrid), or not decided yet. */
export type EventMode = "in_person" | "online" | "hybrid" | "tbd";

export function eventMode(e: { locationType: LocationType; virtualUrl?: string | null }): EventMode {
  if (e.locationType === "VIRTUAL") return "online";
  if (e.locationType === "TBD") return "tbd";
  return isHybrid(e) ? "hybrid" : "in_person";
}

export type EventBadgeKey = "food" | "stuff" | "service" | "online" | "hybrid" | "members";
export type EventBadge = { key: EventBadgeKey; label: string };

/**
 * The badges an event wears everywhere it's listed (Events page cards, the
 * event page, club pages, the month view), in this order: perks, service
 * hours ("Service hours · 2", from lib/metrics/service), online or hybrid,
 * members only. One function, so every surface says the same thing.
 */
export function eventBadges(e: {
  perks?: readonly EventPerk[] | null;
  serviceMinutes?: number | null;
  locationType: LocationType;
  virtualUrl?: string | null;
  visibility: Visibility;
}): EventBadge[] {
  const out: EventBadge[] = [];
  const perks = new Set(e.perks ?? []);
  if (perks.has("FREE_FOOD")) out.push({ key: "food", label: PERK_LABEL.FREE_FOOD });
  if (perks.has("FREE_STUFF")) out.push({ key: "stuff", label: PERK_LABEL.FREE_STUFF });
  const minutes = earnedMinutes(e.serviceMinutes);
  if (minutes) out.push({ key: "service", label: `Service hours · ${fmtServiceHours(minutes)}` });
  const mode = eventMode(e);
  if (mode === "online") out.push({ key: "online", label: "Online" });
  if (mode === "hybrid") out.push({ key: "hybrid", label: "Hybrid" });
  if (e.visibility === "MEMBERS") out.push({ key: "members", label: VISIBILITY_LABEL.MEMBERS });
  return out;
}

/** Compact location for lists ("NB 220", "Online"): the building's code instead of its name. */
export function shortLocationText(e: Parameters<typeof locationText>[0] & { building?: { name: string; code?: string | null } | null }): string {
  if (e.locationType === "CAMPUS" && e.building?.code) {
    const room = (e.roomOverride || e.room || "").trim().replace(/^(room|rm\.?)\s+/i, "");
    return room ? `${e.building.code} ${room}` : e.building.name;
  }
  return locationText(e);
}
