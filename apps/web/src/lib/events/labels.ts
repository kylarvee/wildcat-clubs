import type { EventKind, FundingSource, LocationType, Visibility } from "@prisma/client";

/** Words people see for event enums. Client-safe (no server imports). */

export const EVENT_KINDS: EventKind[] = ["MEETING", "SOCIAL", "WORKSHOP", "SERVICE", "COMPETITION", "FUNDRAISER", "TRAINING", "OTHER"];

export const KIND_LABEL: Record<EventKind, string> = {
  MEETING: "Meeting",
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

export const FUNDING_SOURCES: FundingSource[] = ["WSUSA", "DEPARTMENT", "COLLEGE", "UNIVERSITY"];

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
