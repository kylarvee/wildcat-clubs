import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import { blockMessage, checkinWindow, codeNotFoundMessage, decideMethod, normalizeCode, publicShortName, windowMessage, windowState } from "./rules";

const cfg = { opensMinutesBefore: 30, closesMinutesAfter: 30 };
// Fri Oct 16 2026, 6:00–7:30 PM campus time.
const occ = { startsAt: campusDate(2026, 10, 16, 18, 0), endsAt: campusDate(2026, 10, 16, 19, 30) };
const at = (h: number, m = 0, day = 16) => campusDate(2026, 10, day, h, m);

describe("check-in window", () => {
  const w = checkinWindow(occ, cfg);

  it("opens before the start and closes after the end", () => {
    expect(w.opensAt.getTime()).toBe(at(17, 30).getTime());
    expect(w.closesAt.getTime()).toBe(at(20, 0).getTime());
  });

  it("is inclusive at both edges", () => {
    expect(windowState(w, at(17, 29))).toBe("NOT_OPEN");
    expect(windowState(w, at(17, 30))).toBe("OPEN");
    expect(windowState(w, at(18, 45))).toBe("OPEN");
    expect(windowState(w, at(20, 0))).toBe("OPEN");
    expect(windowState(w, new Date(at(20, 0).getTime() + 1))).toBe("CLOSED");
  });

  it("treats negative config as zero", () => {
    const tight = checkinWindow(occ, { opensMinutesBefore: -5, closesMinutesAfter: 0 });
    expect(tight.opensAt.getTime()).toBe(occ.startsAt.getTime());
    expect(tight.closesAt.getTime()).toBe(occ.endsAt.getTime());
  });

  it("says when it opens — just the time on the same day", () => {
    expect(windowMessage("NOT_OPEN", w, at(12, 0))).toBe("Check-in hasn't opened yet — it opens at 5:30 PM.");
  });

  it("says the date when it opens on another day", () => {
    expect(windowMessage("NOT_OPEN", w, at(12, 0, 14))).toBe("Check-in hasn't opened yet — it opens Fri, Oct 16 at 5:30 PM.");
  });

  it("explains a closed window and what to do", () => {
    expect(windowMessage("CLOSED", w, at(21, 0))).toBe("Check-in for this event closed at 8:00 PM. If you were there, ask a club leader to add you.");
    expect(windowMessage("OPEN", w, at(18, 0))).toBeNull();
  });
});

describe("check-in method", () => {
  const base = { scanValid: false, scanPresented: false, allowSelfCheckIn: true, isParticipatingMember: false };

  it("a live scan is always a QR check-in, member or not", () => {
    expect(decideMethod({ ...base, scanValid: true, scanPresented: true })).toEqual({ ok: true, method: "QR" });
    expect(decideMethod({ ...base, scanValid: true, scanPresented: true, allowSelfCheckIn: false })).toEqual({ ok: true, method: "QR" });
  });

  it("members may check themselves in when the event allows it", () => {
    expect(decideMethod({ ...base, isParticipatingMember: true })).toEqual({ ok: true, method: "SELF" });
  });

  it("an expired scan still works as a self check-in for members", () => {
    expect(decideMethod({ ...base, scanPresented: true, isParticipatingMember: true })).toEqual({ ok: true, method: "SELF" });
  });

  it("non-members need the QR code", () => {
    expect(decideMethod(base)).toEqual({ ok: false, reason: "NOT_MEMBER" });
  });

  it("QR-only events refuse code-only check-ins, even from members", () => {
    expect(decideMethod({ ...base, allowSelfCheckIn: false, isParticipatingMember: true })).toEqual({ ok: false, reason: "SELF_OFF" });
  });

  it("an expired scan by a non-member asks for a fresh scan", () => {
    const d = decideMethod({ ...base, scanPresented: true });
    expect(d).toEqual({ ok: false, reason: "EXPIRED_SCAN" });
    expect(blockMessage("EXPIRED_SCAN", 30)).toContain("every 30 seconds");
  });
});

describe("codes", () => {
  it("tidies case, spaces and dashes", () => {
    expect(normalizeCode(" abc-234 ")).toEqual({ ok: true, code: "ABC234" });
  });

  it("accepts any code that could exist, including hand-picked ones", () => {
    expect(normalizeCode("build8")).toEqual({ ok: true, code: "BUILD8" });
    expect(normalizeCode("")).toMatchObject({ ok: false });
    expect(normalizeCode("AB2")).toEqual({ ok: false, error: "Check-in codes are 6 characters — that one has 3." });
  });

  it("explains the likely typo when nothing matches", () => {
    expect(codeNotFoundMessage("ABC23")).toContain("that one has 5");
    expect(codeNotFoundMessage("ABC0EF")).toContain("0, O, 1 or I");
    expect(codeNotFoundMessage("ABC234")).toBe("We couldn't find an event with that check-in code. Double-check the code on the screen.");
  });
});

describe("public names", () => {
  it("shortens to first name and last initial", () => {
    expect(publicShortName("Maya Chen")).toBe("Maya C.");
    expect(publicShortName("Dr. Elena Alvarez")).toBe("Elena A.");
    expect(publicShortName("Cher")).toBe("Cher");
  });
});
