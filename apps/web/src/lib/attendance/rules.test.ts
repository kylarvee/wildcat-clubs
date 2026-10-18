import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import {
  allowsTapCheckIn,
  blockMessage,
  CHECKIN_METHODS,
  checkinWindow,
  codeClubsPhrase,
  codeNotFoundMessage,
  decideMethod,
  METHOD_LABEL,
  METHOD_SHORT,
  normalizeCode,
  publicShortName,
  windowMessage,
  windowState,
} from "./rules";

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
  const base = { scanValid: false, scanPresented: false, isParticipatingMember: false };

  it("a live scan is always a QR check-in, member or not", () => {
    expect(decideMethod({ ...base, scanValid: true, scanPresented: true })).toEqual({ ok: true, method: "QR" });
  });

  it("members may check in with the event's code", () => {
    expect(decideMethod({ ...base, isParticipatingMember: true })).toEqual({ ok: true, method: "SELF" });
  });

  it("an expired scan still works as a typed code for members", () => {
    expect(decideMethod({ ...base, scanPresented: true, isParticipatingMember: true })).toEqual({ ok: true, method: "SELF" });
  });

  it("the one-tap prompt at an online event is a TAP check-in", () => {
    expect(decideMethod({ ...base, isParticipatingMember: true, tapped: true, tapAllowed: true })).toEqual({ ok: true, method: "TAP" });
  });

  it("typing the code at an online event is still a typed code", () => {
    expect(decideMethod({ ...base, isParticipatingMember: true, tapped: false, tapAllowed: true })).toEqual({ ok: true, method: "SELF" });
  });

  it("a tap at an in-person event counts as the code it carried", () => {
    expect(decideMethod({ ...base, isParticipatingMember: true, tapped: true, tapAllowed: false })).toEqual({ ok: true, method: "SELF" });
  });

  it("a tap never lets a non-member in, and a live scan still wins", () => {
    expect(decideMethod({ ...base, tapped: true, tapAllowed: true })).toEqual({ ok: false, reason: "NOT_MEMBER" });
    expect(decideMethod({ ...base, scanValid: true, scanPresented: true, isParticipatingMember: true, tapped: true, tapAllowed: true })).toEqual({ ok: true, method: "QR" });
  });

  it("non-members need the QR code", () => {
    expect(decideMethod(base)).toEqual({ ok: false, reason: "NOT_MEMBER" });
  });

  it("only online events get a one-tap check-in", () => {
    expect(allowsTapCheckIn({ locationType: "VIRTUAL" })).toBe(true);
    expect(allowsTapCheckIn({ locationType: "CAMPUS" })).toBe(false);
    expect(allowsTapCheckIn({ locationType: "ADDRESS" })).toBe(false);
  });

  it("an expired scan by a non-member asks for a fresh scan", () => {
    const d = decideMethod({ ...base, scanPresented: true });
    expect(d).toEqual({ ok: false, reason: "EXPIRED_SCAN" });
    expect(blockMessage("EXPIRED_SCAN", 30)).toContain("every 30 seconds");
  });
});

describe("method labels", () => {
  it("names every method once, the same way everywhere", () => {
    expect(METHOD_LABEL).toEqual({ QR: "QR scan", SELF: "Typed code", TAP: "One-tap (online)", MANUAL: "Added by a leader" });
    expect(METHOD_SHORT).toEqual({ QR: "QR", SELF: "Code", TAP: "Tap", MANUAL: "Leader" });
    expect([...CHECKIN_METHODS].sort()).toEqual(Object.keys(METHOD_LABEL).sort());
  });
});

describe("who may use the code", () => {
  it("names the host and its co-hosts", () => {
    expect(codeClubsPhrase("Chess Club", [])).toBe("Chess Club");
    expect(codeClubsPhrase("RC Wrecker Bots Club", ["CSWS"])).toBe("RC Wrecker Bots Club or CSWS");
    expect(codeClubsPhrase("RC Wrecker Bots Club", ["CSWS", "SWE"])).toBe("RC Wrecker Bots Club and its co-host clubs");
  });

  it("is nobody at a university event", () => {
    expect(codeClubsPhrase(null, [])).toBeNull();
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
