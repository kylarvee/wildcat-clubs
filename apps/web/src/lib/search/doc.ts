import type { ClubCategory, ClubScope, ClubType } from "@prisma/client";
import { CLUB_CATEGORY_LABEL, CLUB_SCOPE_LABEL, CLUB_TYPE_LABEL } from "@/components/clubs/labels";
import { chunkText, cleanText, clip, fileWords, htmlToText, indexable, nameAliases } from "./text";

/**
 * What one club's search document holds, decided in one pure function so the
 * visibility rules are easy to read and test. The indexer (index-build.ts)
 * loads the rows and turns these texts into weighted tsvectors in SQL.
 *
 *   A  name and other names (acronym, initials)
 *   B  category, type, where it sits, focus, college, department, short description
 *   C  about, officer seat names, event titles and descriptions
 *   D  public announcements, constitution and bylaws, other document titles,
 *      student reviews, public file names
 *
 * `public` holds only what anyone may see. `campus` adds events marked for
 * signed-in Weber State accounts (Visibility UNIVERSITY). Members- and
 * leaders-only content is never loaded at all.
 */

export type PassageKind = "about" | "details" | "event" | "announcement" | "constitution" | "bylaws" | "document" | "review" | "seats" | "files";

/** One piece of visible text a "Found in" snippet can come from. */
export type Passage = { kind: PassageKind; title: string; text: string; href: string; campusOnly: boolean };

export type ClubDocSource = {
  club: {
    id: string;
    slug: string;
    name: string;
    type: ClubType;
    category: ClubCategory | null;
    scope: ClubScope;
    shortDescription: string;
    descriptionHtml: string | null;
    focus: string | null;
    college: { name: string; shortName: string } | null;
    department: string | null;
  };
  seats: string[];
  /** Scheduled (not draft, not cancelled) events the club hosts or co-hosts, newest first. */
  events: { id: string; title: string; descriptionHtml: string | null; campusOnly: boolean }[];
  /** PUBLIC announcements, newest first. */
  announcements: { id: string; title: string; bodyHtml: string }[];
  /** Documents in effect (ACTIVE). */
  documents: { id: string; kind: "CONSTITUTION" | "BYLAWS" | "OTHER"; title: string; contentHtml: string | null }[];
  /** Visible, unreported reviews with text, newest first. */
  reviews: { id: string; body: string }[];
  /** Files anyone may open (PUBLIC, directly or through their folder), not in the trash. */
  files: string[];
};

export type ClubDoc = {
  public: { a: string; b: string; c: string; d: string };
  /** Extra C text only signed-in accounts may see (added to the public text for campusDoc). */
  campusC: string;
  passages: Passage[];
};

/** Plain words people use for each category, so "volunteer" or "greek life" finds the right clubs. */
export const CATEGORY_KEYWORDS: Record<ClubCategory, string> = {
  ACADEMIC: "academic professional career major",
  CULTURAL: "culture cultural heritage identity international",
  FSL: "FSL Greek life fraternity sorority",
  HONOR_SOCIETY: "honor society honors scholars",
  SERVICE_ADVOCACY: "service volunteer volunteering community advocacy",
  STUDENT_LIFE: "student life special interest hobby social",
  RELIGIOUS: "religious faith spiritual worship",
};

const SCOPE_KEYWORDS: Partial<Record<ClubScope, string>> = { SPORTS: "sports club sports athletics", UNIVERSITY: "university-wide campus-wide" };

/** Passage budget per club (the whole set is capped at MAX_PASSAGES). */
const CAP = { about: 4, events: 16, announcements: 8, documents: 8, reviews: 6 } as const;
export const MAX_PASSAGES = 48;
export const PASSAGE_CHARS = 600;

const join = (parts: (string | null | undefined)[]) =>
  parts
    .map((p) => indexable(p))
    .filter(Boolean)
    .join(" \n ");

export function buildClubDoc(src: ClubDocSource): ClubDoc {
  const c = src.club;
  const page = `/clubs/${c.slug}`;
  const about = htmlToText(c.descriptionHtml);
  const category = c.category ? CLUB_CATEGORY_LABEL[c.category] : null;
  const placement = c.scope === "COLLEGE" && c.college ? c.college.name : CLUB_SCOPE_LABEL[c.scope];

  // Same title + description twice (a series re-created each term) counts once.
  const seenEvents = new Set<string>();
  const events = src.events.filter((e) => {
    const key = `${e.campusOnly ? 1 : 0}|${e.title.trim().toLowerCase()}|${htmlToText(e.descriptionHtml).slice(0, 200).toLowerCase()}`;
    if (seenEvents.has(key)) return false;
    seenEvents.add(key);
    return true;
  });
  const eventText = (e: (typeof events)[number]) => join([e.title, htmlToText(e.descriptionHtml)]);
  const governing = src.documents.filter((d) => d.kind !== "OTHER");

  const doc: ClubDoc = {
    public: {
      a: join([c.name, ...nameAliases(c.name)]),
      b: join([
        category,
        c.category ? CATEGORY_KEYWORDS[c.category] : null,
        CLUB_TYPE_LABEL[c.type],
        placement,
        SCOPE_KEYWORDS[c.scope],
        c.focus,
        c.college?.name,
        c.college?.shortName,
        c.department,
        c.shortDescription,
      ]),
      c: join([about, ...src.seats, ...events.filter((e) => !e.campusOnly).map(eventText)]),
      d: join([
        ...src.announcements.map((a) => join([a.title, htmlToText(a.bodyHtml)])),
        ...governing.map((d) => join([d.title, htmlToText(d.contentHtml)])),
        ...src.documents.filter((d) => d.kind === "OTHER").map((d) => d.title),
        ...src.reviews.map((r) => r.body),
        ...src.files.map(fileWords),
      ]),
    },
    campusC: join(events.filter((e) => e.campusOnly).map(eventText)),
    passages: [],
  };

  const passages: Passage[] = [];
  // Events and announcements may be just a title; everything else needs text.
  const add = (p: Passage) => {
    const text = cleanText(p.text).replace(/\n/g, " ");
    const title = clip(cleanText(p.title).replace(/\n/g, " "), 140);
    if (text || ((p.kind === "event" || p.kind === "announcement") && title)) passages.push({ ...p, title, text });
  };

  for (const chunk of chunkText(about, PASSAGE_CHARS).slice(0, CAP.about)) add({ kind: "about", title: "About", text: chunk, href: `${page}#about`, campusOnly: false });
  add({
    kind: "details",
    title: "Club details",
    text: [category ? `Category: ${category}` : null, `Type: ${CLUB_TYPE_LABEL[c.type]}`, placement, c.focus ? `Focus: ${c.focus}` : null, c.department ? `Department: ${c.department}` : null]
      .filter(Boolean)
      .join(" · "),
    href: `${page}#details`,
    campusOnly: false,
  });
  for (const e of events.slice(0, CAP.events)) {
    add({ kind: "event", title: e.title, text: clip(htmlToText(e.descriptionHtml), PASSAGE_CHARS), href: `/events/${e.id}`, campusOnly: e.campusOnly });
  }
  for (const a of src.announcements.slice(0, CAP.announcements)) {
    add({ kind: "announcement", title: a.title, text: clip(htmlToText(a.bodyHtml), PASSAGE_CHARS), href: `${page}#announcements`, campusOnly: false });
  }
  let docChunks = 0;
  for (const d of governing) {
    for (const chunk of chunkText(htmlToText(d.contentHtml), PASSAGE_CHARS)) {
      if (docChunks++ >= CAP.documents) break;
      add({ kind: d.kind === "CONSTITUTION" ? "constitution" : "bylaws", title: d.title, text: chunk, href: `${page}#resources`, campusOnly: false });
    }
  }
  const others = src.documents.filter((d) => d.kind === "OTHER").map((d) => d.title);
  if (others.length) add({ kind: "document", title: "Documents", text: others.join(" · "), href: `${page}#resources`, campusOnly: false });
  if (src.seats.length) add({ kind: "seats", title: "Leadership roles", text: src.seats.join(" · "), href: `${page}#org-chart`, campusOnly: false });
  if (src.files.length) add({ kind: "files", title: "Files", text: clip(src.files.map(fileWords).join(" · "), PASSAGE_CHARS), href: `${page}#resources`, campusOnly: false });
  for (const r of src.reviews.slice(0, CAP.reviews)) add({ kind: "review", title: "Student review", text: clip(r.body, PASSAGE_CHARS), href: `${page}#reviews`, campusOnly: false });

  doc.passages = passages.slice(0, MAX_PASSAGES);
  return doc;
}

/** "Found in …" labels for each kind of passage. */
export const PASSAGE_LABEL: Record<PassageKind, string> = {
  about: "About",
  details: "Club details",
  event: "Event",
  announcement: "Announcement",
  constitution: "Constitution",
  bylaws: "Bylaws",
  document: "Documents",
  review: "Student review",
  seats: "Leadership roles",
  files: "Files",
};
