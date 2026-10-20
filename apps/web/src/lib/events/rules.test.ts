import { describe, expect, it } from "vitest";
import { coverFileId, coverProblem, defaultServiceMinutes, hoursText, normalizePerks, onlineLinkFor, resolveServiceMinutes, type CoverFile } from "@/lib/events/rules";
import { eventBadges, eventMode, isHybrid } from "@/lib/events/labels";
import { allowsTapCheckIn } from "@/lib/attendance/rules";

const club = { id: "club1", name: "RC Wrecker Bots Club" };
const image = (over: Partial<CoverFile> = {}): CoverFile => ({ name: "Build night.png", clubId: "club1", ownerId: null, isFolder: false, mimeType: "image/png", trashedAt: null, effective: "PUBLIC", ...over });

describe("a cover is one of the host club's public image files", () => {
  it("takes the club's own public image", () => {
    expect(coverProblem(image(), club)).toBeNull();
    expect(coverProblem(image({ mimeType: "image/svg+xml", name: "Flyer.svg" }), club)).toBeNull();
  });

  it("refuses another club's file, someone's personal file, or a university file", () => {
    expect(coverProblem(image({ clubId: "club2" }), club)).toMatch(/one of RC Wrecker Bots Club's own images/);
    expect(coverProblem(image({ clubId: null, ownerId: "user1" }), club)).toMatch(/own images/);
    expect(coverProblem(image({ clubId: null, ownerId: null }), club)).toMatch(/own images/);
  });

  it("a university event's cover comes from University files", () => {
    expect(coverProblem(image({ clubId: null, ownerId: null }), null)).toBeNull();
    expect(coverProblem(image(), null)).toMatch(/University files/);
    expect(coverProblem(image({ clubId: null, ownerId: "user1" }), null)).toMatch(/University files/);
  });

  it("refuses what isn't an image, a folder, a missing or trashed file, or one that isn't public", () => {
    expect(coverProblem(image({ mimeType: "application/pdf", name: "Minutes.pdf" }), club)).toMatch(/isn't an image/);
    expect(coverProblem(image({ mimeType: null }), club)).toMatch(/isn't an image/);
    expect(coverProblem(image({ isFolder: true }), club)).toMatch(/Choose the cover again/);
    expect(coverProblem(null, club)).toMatch(/Choose the cover again/);
    expect(coverProblem(image({ trashedAt: new Date() }), club)).toMatch(/in the trash/);
    expect(coverProblem(image({ effective: "MEMBERS" }), club)).toMatch(/isn't public/);
    expect(coverProblem(image({ effective: "LEADERS" }), club)).toMatch(/Make it public in Club files/);
  });

  it("is stored as the file's link, like a club logo", () => {
    expect(coverFileId("/api/files/cm1abcdef123")).toBe("cm1abcdef123");
    expect(coverFileId("/api/files/cm1abcdef123?download=1")).toBeNull();
    expect(coverFileId("https://example.com/cat.png")).toBeNull();
    expect(coverFileId("/api/files/../../etc")).toBeNull();
  });
});

describe("service hours: quarter hours, never more than the event's length", () => {
  const meeting = (durationMinutes: number) => ({ durationMinutes, kind: "MEETING" as const, existing: null });

  it("takes quarter hours up to the event's length", () => {
    expect(resolveServiceMinutes(120, meeting(120))).toEqual({ ok: true, minutes: 120 });
    expect(resolveServiceMinutes(45, meeting(60))).toEqual({ ok: true, minutes: 45 });
  });

  it("refuses more than the length, odd minutes, and zero", () => {
    expect(resolveServiceMinutes(135, meeting(120))).toEqual({ ok: false, error: "Service hours can't be more than the event's length (2 hours)." });
    expect(resolveServiceMinutes(70, meeting(120))).toMatchObject({ ok: false, error: expect.stringMatching(/quarter hours/) });
    expect(resolveServiceMinutes(0, meeting(120))).toMatchObject({ ok: false });
    expect(resolveServiceMinutes(-15, meeting(120))).toMatchObject({ ok: false });
  });

  it("null means it doesn't count", () => {
    expect(resolveServiceMinutes(null, { durationMinutes: 120, kind: "SERVICE", existing: { serviceMinutes: 120 } })).toEqual({ ok: true, minutes: null });
  });

  it("new Service projects count by default, for their length (up to 8 hours); other new events don't", () => {
    expect(resolveServiceMinutes(undefined, { durationMinutes: 150, kind: "SERVICE", existing: null })).toEqual({ ok: true, minutes: 150 });
    expect(resolveServiceMinutes(undefined, { durationMinutes: 24 * 60, kind: "SERVICE", existing: null })).toEqual({ ok: true, minutes: 480 });
    expect(resolveServiceMinutes(undefined, { durationMinutes: 50, kind: "SERVICE", existing: null })).toEqual({ ok: true, minutes: 45 });
    expect(resolveServiceMinutes(undefined, { durationMinutes: 120, kind: "SOCIAL", existing: null })).toEqual({ ok: true, minutes: null });
    expect(defaultServiceMinutes(10)).toBeNull();
  });

  it("a saved event keeps its hours, trimmed when it gets shorter (a drag on the calendar)", () => {
    expect(resolveServiceMinutes(undefined, { durationMinutes: 120, kind: "SOCIAL", existing: { serviceMinutes: 90 } })).toEqual({ ok: true, minutes: 90 });
    expect(resolveServiceMinutes(undefined, { durationMinutes: 50, kind: "SOCIAL", existing: { serviceMinutes: 90 } })).toEqual({ ok: true, minutes: 45 });
    expect(resolveServiceMinutes(undefined, { durationMinutes: 120, kind: "SERVICE", existing: { serviceMinutes: null } })).toEqual({ ok: true, minutes: null });
  });

  it("says hours plainly", () => {
    expect(hoursText(60)).toBe("1 hour");
    expect(hoursText(90)).toBe("1.5 hours");
    expect(hoursText(45)).toBe("0.75 hours");
  });
});

describe("hybrid events", () => {
  it("an in-person event may keep an online link; one not decided yet can't", () => {
    expect(onlineLinkFor("CAMPUS", " https://meet.google.com/abc-defg-hij ")).toBe("https://meet.google.com/abc-defg-hij");
    expect(onlineLinkFor("ADDRESS", "https://zoom.us/j/1")).toBe("https://zoom.us/j/1");
    expect(onlineLinkFor("VIRTUAL", "https://zoom.us/j/1")).toBe("https://zoom.us/j/1");
    expect(onlineLinkFor("TBD", "https://zoom.us/j/1")).toBeNull();
    expect(onlineLinkFor("CAMPUS", "")).toBeNull();
  });

  it("reads as Hybrid, while check-in stays in person (no one-tap)", () => {
    const hybrid = { locationType: "CAMPUS" as const, virtualUrl: "https://meet.google.com/x" };
    expect(isHybrid(hybrid)).toBe(true);
    expect(eventMode(hybrid)).toBe("hybrid");
    expect(allowsTapCheckIn(hybrid)).toBe(false);
    expect(isHybrid({ locationType: "VIRTUAL", virtualUrl: "https://x.test" })).toBe(false);
    expect(eventMode({ locationType: "VIRTUAL", virtualUrl: null })).toBe("online");
    expect(allowsTapCheckIn({ locationType: "VIRTUAL" })).toBe(true);
  });
});

describe("badges", () => {
  it("say the same words in the same order everywhere", () => {
    const labels = eventBadges({ perks: ["FREE_STUFF", "FREE_FOOD"], serviceMinutes: 120, locationType: "ADDRESS", virtualUrl: "https://zoom.us/j/1", visibility: "MEMBERS" }).map((b) => b.label);
    expect(labels).toEqual(["Free food", "Free stuff", "Service hours · 2", "Hybrid", "Members only"]);
    expect(eventBadges({ perks: [], serviceMinutes: 90, locationType: "VIRTUAL", virtualUrl: null, visibility: "PUBLIC" }).map((b) => b.label)).toEqual(["Service hours · 1.5", "Online"]);
    expect(eventBadges({ perks: [], serviceMinutes: null, locationType: "CAMPUS", virtualUrl: null, visibility: "UNIVERSITY" })).toEqual([]);
  });

  it("perks are stored once each, in badge order", () => {
    expect(normalizePerks(["FREE_STUFF", "FREE_FOOD", "FREE_STUFF"])).toEqual(["FREE_FOOD", "FREE_STUFF"]);
  });
});
