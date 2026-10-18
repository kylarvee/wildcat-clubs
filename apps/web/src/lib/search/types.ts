import type { PassageKind } from "./doc";

/**
 * Search result shapes shared by the server (lib/search/engine), the clubs
 * list components and the mobile contract. No server imports here.
 */

export type SearchMode = "all" | "close" | "some";

/** A run of text; `hit` runs are the matched words (shown with <mark>). */
export type Segment = { text: string; hit: boolean };

export type SearchMatch = {
  kind: PassageKind;
  /** "Event", "Announcement", "Constitution"… */
  label: string;
  /** The item's title with matched words marked (empty for About, Club details…). */
  title: Segment[];
  /** The passage around the match, or null when only the title matched. */
  snippet: Segment[] | null;
  /** Where the text lives: the event, a section of the club page… */
  href: string;
};

export const segmentsText = (segments: Segment[] | null | undefined) => (segments ?? []).map((s) => s.text).join("");
