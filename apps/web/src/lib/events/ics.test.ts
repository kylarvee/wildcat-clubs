import { describe, expect, it } from "vitest";
import { buildCalendar, buildVEvent, CRLF, escapeText, foldLine, formatDate, formatUtc } from "@/lib/events/ics";
import { campusDate } from "@/lib/time";

const octets = (s: string) => new TextEncoder().encode(s).length;

describe("escapeText", () => {
  it("escapes backslashes, semicolons, commas and newlines", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });
  it("normalizes CRLF and CR to \\n", () => {
    expect(escapeText("one\r\ntwo\rthree")).toBe("one\\ntwo\\nthree");
  });
  it("leaves colons and plain text alone", () => {
    expect(escapeText("Room 101: Union")).toBe("Room 101: Union");
  });
});

describe("foldLine", () => {
  it("does not touch lines of 75 octets or fewer", () => {
    const line = "X".repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it("folds long lines so every physical line is at most 75 octets", () => {
    const line = "DESCRIPTION:" + "a".repeat(300);
    const folded = foldLine(line);
    const parts = folded.split(CRLF);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75);
    parts.slice(1).forEach((p) => expect(p.startsWith(" ")).toBe(true));
    // Unfolding (remove CRLF + one space) restores the original.
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("never splits a multi-byte character", () => {
    const line = "SUMMARY:" + "é🐾".repeat(40);
    const folded = foldLine(line);
    for (const p of folded.split(CRLF)) {
      expect(octets(p)).toBeLessThanOrEqual(75);
      expect(p).not.toContain("�");
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("dates", () => {
  it("formats UTC timestamps", () => {
    expect(formatUtc(new Date("2026-10-21T00:30:05Z"))).toBe("20261021T003005Z");
  });
  it("formats all-day dates in campus time", () => {
    // 11 PM in Ogden on Oct 20 is already Oct 21 in UTC.
    expect(formatDate(campusDate(2026, 10, 20, 23, 0))).toBe("20261020");
  });
});

describe("buildVEvent", () => {
  const base = {
    uid: "occ1@wildcatclubs",
    start: new Date("2026-10-21T00:00:00Z"),
    end: new Date("2026-10-21T01:30:00Z"),
    summary: "Robotics Club: Build night",
    description: "Bring a laptop, snacks provided.\nSee you there!",
    location: "Engineering Technology, Room 101",
    url: "https://clubs.weber.edu/events/evt1",
    updatedAt: new Date("2026-10-01T12:00:00Z"),
  };

  it("writes a confirmed timed event in UTC", () => {
    const lines = buildVEvent(base);
    expect(lines[0]).toBe("BEGIN:VEVENT");
    expect(lines.at(-1)).toBe("END:VEVENT");
    expect(lines).toContain("UID:occ1@wildcatclubs");
    expect(lines).toContain("DTSTART:20261021T000000Z");
    expect(lines).toContain("DTEND:20261021T013000Z");
    expect(lines).toContain("DTSTAMP:20261001T120000Z");
    expect(lines).toContain("SUMMARY:Robotics Club: Build night");
    expect(lines).toContain("DESCRIPTION:Bring a laptop\\, snacks provided.\\nSee you there!");
    expect(lines).toContain("LOCATION:Engineering Technology\\, Room 101");
    expect(lines).toContain("URL:https://clubs.weber.edu/events/evt1");
    expect(lines).toContain("STATUS:CONFIRMED");
  });

  it("marks cancelled occurrences", () => {
    expect(buildVEvent({ ...base, status: "CANCELLED" })).toContain("STATUS:CANCELLED");
  });

  it("writes all-day events as campus dates with an exclusive end", () => {
    const start = campusDate(2026, 11, 3, 0, 0);
    const lines = buildVEvent({ ...base, allDay: true, start, end: new Date(start.getTime() + 86_400_000) });
    expect(lines).toContain("DTSTART;VALUE=DATE:20261103");
    expect(lines).toContain("DTEND;VALUE=DATE:20261104");
  });

  it("gives zero-length events a one-hour end", () => {
    const lines = buildVEvent({ ...base, end: base.start });
    expect(lines).toContain("DTEND:20261021T010000Z");
  });
});

describe("buildCalendar", () => {
  const ics = buildCalendar(
    {
      name: "Wildcat Clubs, Robotics; Club",
      description: "Public events",
      events: [
        { uid: "a@wildcatclubs", start: new Date("2026-10-21T00:00:00Z"), end: new Date("2026-10-21T01:00:00Z"), summary: "One" },
        { uid: "b@wildcatclubs", start: new Date("2026-10-28T00:00:00Z"), end: new Date("2026-10-28T01:00:00Z"), summary: "Two", status: "CANCELLED", description: "x".repeat(200) },
      ],
    },
    new Date("2026-10-16T00:00:00Z"),
  );

  it("uses CRLF line endings everywhere and ends with CRLF", () => {
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("wraps events in a VCALENDAR with the required properties", () => {
    const lines = ics.split(CRLF);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.some((l) => l.startsWith("PRODID:"))).toBe(true);
    expect(lines).toContain("X-WR-CALNAME:Wildcat Clubs\\, Robotics\\; Club");
    expect(lines).toContain("X-WR-TIMEZONE:America/Denver");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(2);
    expect(lines).toContain("DTSTAMP:20261016T000000Z");
  });

  it("keeps every physical line within 75 octets", () => {
    for (const l of ics.split(CRLF)) expect(octets(l)).toBeLessThanOrEqual(75);
  });

  it("always carries the campus VTIMEZONE, so a feed with no events still has a component", () => {
    const empty = buildCalendar({ name: "Quiet Club", events: [] }).split(CRLF);
    expect(empty).toContain("BEGIN:VTIMEZONE");
    expect(empty).toContain("TZID:America/Denver");
    expect(empty).toContain("END:VTIMEZONE");
    expect(empty.indexOf("END:VTIMEZONE")).toBeLessThan(empty.indexOf("END:VCALENDAR"));
  });
});
