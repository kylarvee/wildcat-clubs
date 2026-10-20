import type { EventKind, LocationType, Recurrence, Visibility } from "@prisma/client";
import type { EventBadge, EventMode } from "@/lib/events/labels";

/**
 * Shapes shared by the calendar feed (GET /api/calendar), CalendarView and the
 * Events Builder. Client-safe.
 */

export type CalendarScope = "club" | "me" | "university" | "trainings";

export type CalendarEventProps = {
  eventId: string;
  occurrenceId: string;
  /** Host club; null for university events. */
  clubId: string | null;
  clubName: string | null;
  clubSlug: string | null;
  clubColor: string;
  /** In club scope: false when the club co-hosts someone else's event. */
  hostedHere: boolean;
  cohostNames: string[];
  location: string;
  locationType: LocationType;
  /** What a map pin searches for (campus building or address). */
  mapQuery: string | null;
  /** The online link: online events, and hybrid ones (in person with a link). */
  virtualUrl: string | null;
  coverUrl: string | null;
  /** lib/events/labels eventBadges: perks, service hours, online/hybrid, members only. */
  badges: EventBadge[];
  kind: EventKind;
  visibility: Visibility;
  cancelled: boolean;
  note: string | null;
  /** Real instants (ISO, UTC). `start`/`end` on the event are campus wall clock. */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurrence: Recurrence;
  scheduleLabel: string;
  /** The viewer may edit this event (Events Builder / admin trainings). */
  canManage: boolean;
  /** Present only for viewers with the host club's budget or events capability. */
  expectedCostCents?: number;
  eventTotalCents?: number;
};

export type CalendarEventJson = {
  id: string;
  title: string;
  /** Campus wall clock without offset ("2026-10-20T18:00:00"), or a date for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  editable: boolean;
  classNames: string[];
  extendedProps: CalendarEventProps;
};

/** One date of an event as an Events page card (lib/events/browse). Times are real instants (ISO). */
export type EventCardData = {
  occurrenceId: string;
  eventId: string;
  title: string;
  kind: EventKind;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** Campus date "2026-10-23", for grouping by day. */
  dayKey: string;
  /** "Shepherd Union Building, Room 404", "Online", "Location to be decided". */
  location: string;
  mode: EventMode;
  coverUrl: string | null;
  /** Null for university events. */
  club: { name: string; slug: string; logoUrl: string | null; logoColor: string } | null;
  cohostNames: string[];
  badges: EventBadge[];
  cancelled: boolean;
  /** Why a cancelled date was cancelled, when the club said. */
  note: string | null;
  happeningNow: boolean;
};

/** Serialized term for client-side recurrence previews (expandOccurrences needs Term rows). */
export type TermJson = { id: string; name: string; kind: "FALL" | "SPRING" | "SUMMER"; academicYear: string; startsOn: string; endsOn: string; countsForActivity: boolean };
