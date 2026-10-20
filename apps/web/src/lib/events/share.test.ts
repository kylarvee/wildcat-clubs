import { describe, expect, it } from "vitest";
import { eventGoogleCalendarUrl, googleCalendarTemplateUrl } from "@/lib/events/share";
import { campusDate } from "@/lib/time";

const params = (url: string) => new URL(url).searchParams;

describe("Add to calendar → Google Calendar", () => {
  const base = {
    title: "Open Build Night",
    hostName: "RC Wrecker Bots Club",
    start: campusDate(2026, 10, 23, 18, 30),
    end: campusDate(2026, 10, 23, 21, 0),
    about: "Bring your subsystem.",
    pageUrl: "https://clubs.weber.edu/events/e1?o=o1",
  };

  it("prefills the title, UTC times, campus time zone, place and details", () => {
    const url = eventGoogleCalendarUrl({ ...base, place: "Noorda Building, Room 150, Weber State University, Ogden, UT", onlineUrl: null });
    expect(url.startsWith("https://calendar.google.com/calendar/render?")).toBe(true);
    const q = params(url);
    expect(q.get("action")).toBe("TEMPLATE");
    expect(q.get("text")).toBe("Open Build Night (RC Wrecker Bots Club)");
    expect(q.get("dates")).toBe("20261024T003000Z/20261024T030000Z");
    expect(q.get("ctz")).toBe("America/Denver");
    expect(q.get("location")).toBe("Noorda Building, Room 150, Weber State University, Ogden, UT");
    expect(q.get("details")).toBe("Bring your subsystem.\n\nDetails: https://clubs.weber.edu/events/e1?o=o1");
  });

  it("hybrid: the place is the location and the online link goes in the details", () => {
    const q = params(eventGoogleCalendarUrl({ ...base, place: "Noorda Building, Room 150", onlineUrl: "https://meet.google.com/abc-defg-hij" }));
    expect(q.get("location")).toBe("Noorda Building, Room 150");
    expect(q.get("details")).toBe("Bring your subsystem.\n\nJoin online: https://meet.google.com/abc-defg-hij\n\nDetails: https://clubs.weber.edu/events/e1?o=o1");
  });

  it("online: the link is the location", () => {
    const q = params(eventGoogleCalendarUrl({ ...base, about: null, place: null, onlineUrl: "https://zoom.us/j/1" }));
    expect(q.get("location")).toBe("https://zoom.us/j/1");
    expect(q.get("details")).toBe("Details: https://clubs.weber.edu/events/e1?o=o1");
  });

  it("all-day events use dates, ending the day after (campus days)", () => {
    const q = params(googleCalendarTemplateUrl({ title: "Day of Service", start: campusDate(2026, 10, 24), end: campusDate(2026, 10, 25), allDay: true }));
    expect(q.get("dates")).toBe("20261024/20261025");
  });
});
